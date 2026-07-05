---
phase: 99-auditoria-integral
reviewed: 2026-07-02T00:00:00Z
depth: standard
status: issues
files_reviewed: 8
files_reviewed_list:
  - src/wa/index.js
  - src/wa/data.js
  - src/wa/routes.js
  - src/wa/gateway.js
  - src/wa/campaigns.js
  - src/wa/campaign-engine.js
  - src/enrichment.js
  - scripts/pre-deploy.js
findings:
  critical: 2
  warning: 8
  info: 7
  total: 17
---

# Auditoría integral — Módulos WA / Enrichment / Pre-deploy

**Reviewed:** 2026-07-02
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

## Summary

Se revisaron los 6 archivos del módulo WhatsApp, el módulo de enrichment y el script de pre-deploy, con foco en auth/ownership, race conditions, corrupción de datos, leaks de secrets y lógica de retry/timeout. Cada hallazgo fue verificado contra el código real (incluyendo cross-checks en `index.js` para deps, sesiones y helpers).

**Invariantes verificadas que SÍ se cumplen (no son hallazgos):**
- `publicAccount()` tapa `proxy.pass` en `GET /api/wa/accounts` y en `PATCH /accounts/:id/proxy` (routes.js:198-204, 266). `proxy-credentials` (owner-only) y `admin/export` lo exponen a propósito, como está documentado.
- El stripper de pre-deploy limpia los 5 secrets de Telnyx (pre-deploy.js:140-147) ANTES del loop que escribe `telnyx_config.json`, y limpia `proxy.pass` de `wa_accounts.json` (pre-deploy.js:176-180). Orden correcto, funciona.
- Los ownership checks del audit 2026-05-23 siguen intactos: `account:status` (gateway.js:157), `account:event` (gateway.js:182), warming inbound HTTP (routes.js:1172-1179). El de `POST /api/wa/events` está PARCIALMENTE intacto — ver WR-02.
- `loginLimiter` sí se pasa a `mountWa` y se aplica en `desktop-login` (index.js:13033, routes.js:176).
- El emit `followup:send-message` (no `campaign:send-message`) y el skip del engine en test son intencionales — no flagueados.
- CRUD síncrono de campañas vs `mutateCampaigns` del tick: NO hay interleaving real (los mutators no hacen await de I/O; microtasks completan antes del próximo macrotask). Descartado como falso positivo.

**Los 2 críticos comparten raíz:** los endpoints de campañas drip validan ownership de la CAMPAÑA pero no de los RECURSOS que la campaña usa (cuentas WA ajenas, leads ajenos). El módulo está parkeado pero los endpoints están montados y accesibles para cualquier setter autenticado hoy.

## Critical Issues

### CR-01: Un setter puede enviar mensajes desde cuentas WhatsApp de OTROS setters vía campañas

**File:** `src/wa/routes.js:332-342` (create), `src/wa/routes.js:368-414` (launch), `src/wa/campaign-engine.js:171-187` (send)
**Issue:** `POST /api/wa/campaigns` permite role `setter` y `sanitizeCampaign` acepta cualquier `accountIds` (campaigns.js:72-76) sin validar ownership. El launch (routes.js:368) solo chequea `canActOnCampaign` (que el setter sea dueño de la campaña — siempre true porque él la creó) y la policy de proxy. Nunca se valida que las cuentas de `accountIds` estén asignadas al setter (`canActOnAccount` existe en routes.js:110-114 pero no se usa acá). El engine luego resuelve el recipient al DUEÑO real de la cuenta (campaign-engine.js:103-107) y su desktop wa-multi ejecuta `followup:send-message` desde esa cuenta. Resultado: un setter malicioso crea una campaña con `accountIds: ["cuenta_de_otro"]`, openers con texto arbitrario, la lanza, y el sistema manda WhatsApps escritos por él desde el número de otro setter — bypass total del modelo de ownership que `account:status`/`account:event`/`proxy` sí aplican.
**Fix:** En `POST /api/wa/campaigns` y en `POST /:id/launch` (defensa doble: el PATCH puede cambiar accountIds), validar cada cuenta para roles no-admin:
```js
if (user.role !== "admin") {
  const ajenas = (clean.accountIds || c.accountIds).filter((aid) => {
    const acc = getAccount(aid);
    return !acc || !canActOnAccount(user, acc);
  });
  if (ajenas.length) return res.status(403).json({ error: `Cuentas no asignadas a vos: ${ajenas.join(", ")}` });
}
```

### CR-02: Un setter puede targetear y leer TODOS los leads del sistema vía `leadFilter` sin scoping

**File:** `src/wa/routes.js:389-406` (launch), `src/wa/routes.js:309-330` (GET leads), `src/wa/campaigns.js:161-169` + `345-361` (filtro)
**Issue:** `leadFilter.setterId` es opcional y lo controla el cliente (campaigns.js:165: `setterId: f.setterId ? ... : ""`). Con `setterId: ""`, `selectLeadsFromMap` (campaigns.js:356: `if (setterId && ...)`) matchea leads de TODOS los setters. Un setter puede: (1) lanzar una campaña que le manda mensajes a los 5000+ leads del sistema, incluyendo los asignados a otros, y (2) leer nombre + teléfono + país de todos esos leads vía `GET /api/wa/campaigns/:id/leads` (routes.js:317-328), datos a los que su rol no tiene acceso por ningún otro endpoint (el RBAC de `/api/setters/*` se lo impide). Es exfiltración de la base completa de leads + envío masivo no autorizado, en contradicción con los fixes de RBAC #25/#26 del audit previo.
**Fix:** Forzar el scope para no-admin en create/PATCH y re-forzarlo en launch:
```js
// en POST /api/wa/campaigns y PATCH, después de sanitizeCampaign:
if (user.role !== "admin" && clean.leadFilter) {
  clean.leadFilter.setterId = user.setterId; // siempre el suyo
}
// en launch, antes de selectLeadsFromMap:
const filter = { ...(c.leadFilter || {}) };
if (user.role !== "admin") filter.setterId = req.auth.user.setterId;
```
Y en `GET /:id/leads`, para no-admin, filtrar la salida a leads con `lead.assignedTo === user.setterId`.

## Warnings

### WR-01: `proxy.pass` se devuelve en claro en 5 endpoints admin que no pasan por `publicAccount()`

**File:** `src/wa/routes.js:456-460, 468-476, 502-508, 734-739, 741-751`
**Issue:** El invariante documentado es "el panel NUNCA ve el pass" (solo `proxy-credentials` owner-only y `admin/export`). Pero estos endpoints devuelven el objeto cuenta crudo de `updateAccount`/`setAssignment`/`attachRoutine`/`resetWarming`/`markBannedTemporarily`, que incluye `proxy.pass` en claro: `PATCH /api/wa/accounts/:id` (l.459), `POST /accounts/:id/assign` (l.475), `POST /routines/attach` (l.507), `POST /accounts/:id/reset-warming` (l.738), `POST /accounts/:id/mark-banned` (l.750). Son admin-only (no hay escalación de privilegios), pero el secret viaja al browser del panel en operaciones rutinarias (asignar cuenta, marcar ban), quedando expuesto a DevTools, extensiones y logs de red — exactamente lo que `publicAccount()` intenta evitar.
**Fix:** Envolver la respuesta en `publicAccount()` en los 5 endpoints:
```js
res.json(publicAccount(updated));
```

### WR-02: `POST /api/wa/events` — el ownership check solo corre si viene `status`; sin status, un setter puede forjar eventos de cuentas ajenas

**File:** `src/wa/routes.js:864-873`
**Issue:** El guard del audit 2026-05-23 está condicionado a `if (accountId && status)`. Si un setter manda `{accountId: "cuenta_ajena", type: "message-send-attempted"}` SIN `status`, el check se saltea y `appendEvent` (l.875) registra el evento atribuido a la cuenta ajena. El espejo del socket (`account:event`, gateway.js:182) rechaza CUALQUIER evento con accountId no propio — este endpoint HTTP (que existe justamente como fallback del socket) es más débil. Impacto: polución del log por cuenta (`GET /events?accountId=`), inflado de `msgsLast24h`/`eventsByHour` del dashboard admin, y ruido en el ban-detection basado en eventos.
**Fix:** Aplicar el mismo check que el gateway, para cualquier evento con accountId:
```js
if (accountId && req.auth.user.role !== "admin") {
  const acc = getAccount(accountId);
  const isOwner = acc?.assignment?.kind === "setter" && acc?.assignment?.refId === req.auth.user.setterId;
  if (!isOwner) return res.status(403).json({ error: "no autorizado sobre esta cuenta" });
}
```

### WR-03: JWTs desktop de 30 días sin revocación ni chequeo de usuario activo — un setter dado de baja retiene acceso

**File:** `src/wa/routes.js:145-162, 182-186`; `src/wa/gateway.js:69-84`
**Issue:** `desktop-login` firma JWT con `expiresIn: "30d"` (l.185). Tanto el `requireAuth` HTTP (l.151-158) como el middleware del socket (gateway.js:72-79) construyen `req.auth.user`/`socket.data.user` SOLO del payload, sin verificar que el user siga existiendo con `status === "active"` (el check de status solo corre en el login, index.js:12758). Si se desactiva/borra un usuario (caso real: rotación de setters — Yesxander, Ivi, Genaro hidden), su desktop conserva hasta 30 días de acceso a toda la API WA y al socket (incluyendo `proxy-credentials` de sus cuentas y comandos). Tampoco hay `jti`/lista de revocación; la única mitigación es rotar `JWT_SECRET` (desloguea a todos).
**Fix:** En ambos verificadores, tras `jwt.verify`, resolver el user real y cortar si no está activo. Cachear el lookup si preocupa el costo:
```js
const payload = jwt.verify(m[1], jwtSecret);
const live = deps.getUserById?.(payload.sub); // helper nuevo: lee auth.json
if (!live || live.status !== "active") return res.status(401).json({ error: "Usuario inactivo" });
req.auth = { user: { id: live.id, role: live.role, name: live.name, setterId: live.setterId || "" }, session: null };
```
(Exponer `getUserById` en las deps de `mountWa`. Aplica igual en gateway.js.)

### WR-04: `resolveRecipient` — el tercer fallback devuelve un user OFFLINE: el mensaje se emite a una room vacía pero el lead queda marcado como "enviado"

**File:** `src/wa/campaign-engine.js:113-117`, `171-187`, `219-250`
**Issue:** Los dos primeros pasos de `resolveRecipient` chequean online (owner: l.107; admin: l.110 `p.online`). El tercero NO: `if (uid) return uid` (l.115) devuelve el userId del setter de la campaña aunque esté desconectado. `sendToUser` (gateway.js:336-340) emite a `user:<uid>` — si no hay sockets, el mensaje se pierde silenciosamente pero devuelve `true`. Entonces `send()` retorna true, se incrementa el cap diario, y el estado del lead avanza a `awaiting_opener_reply` con `nextActionAt = null` (l.227) — estado de espera del que solo sale si el lead responde a un mensaje que NUNCA recibió. El lead queda perdido para siempre en la campaña, y el diseño explícito de "nadie online → requeue" (comentario l.174) queda anulado. Nota: `userIdFromSetterIdHelper` (index.js:12762) hace fallback al admin único, así que este path se alcanza siempre que ni el dueño ni un admin estén online.
**Fix:** Exigir online también en el tercer fallback:
```js
if (campSetterId && deps.userIdFromSetterId) {
  const uid = deps.userIdFromSetterId(campSetterId);
  if (uid && (!deps.isUserOnline || deps.isUserOnline(uid))) return uid;
}
return null; // nadie online → send() devuelve false → requeue al próximo tick
```

### WR-05: El cap diario anti-ban es POR CAMPAÑA, no por cuenta — dos campañas sobre la misma cuenta duplican el volumen permitido

**File:** `src/wa/campaign-engine.js:150-169`
**Issue:** El contador vive en `camp._dailySends.byAccount` (l.151-154), es decir, cada campaña lleva SU propio conteo por cuenta. `accountReady` (l.168) compara `sentToday(accId) < capOf(accId)` contra ese contador local. Si N campañas running comparten una cuenta (nada lo impide), la cuenta puede enviar N × su cap de warming por día (ej.: cuenta día 1-2 con cap 12 → 24, 36...). El gap anti-ráfaga `_accountLastSend` sí es global (l.85) pero solo limita el ritmo, no el total diario, y además se resetea en cada restart del server. El propósito del cap (curva de warming anti-ban, `warmingCapByDay`) queda derrotado exactamente en el escenario que más riesgo de ban tiene.
**Fix:** Mover el contador diario a nivel módulo, keyed por cuenta+día, compartido entre campañas (y persistirlo en `wa_campaigns.json` como sibling, igual que `leadStates`, para sobrevivir restarts):
```js
// en el mutator del tick, sibling de data.campaigns:
if (!data.dailySends || data.dailySends.key !== todayKey(nowDate)) {
  data.dailySends = { key: todayKey(nowDate), byAccount: {} };
}
const sentToday = (accId) => data.dailySends.byAccount[accId] || 0;
// y en send(): data.dailySends.byAccount[accId] = sentToday(accId) + 1;
```

### WR-06: Persistencia JSON: un archivo corrupto/truncado se "cura" con el fallback vacío y el próximo write WIPEA todo el dataset

**File:** `src/wa/data.js:27-43`; `src/wa/campaigns.js:16-35`
**Issue:** Dos defectos que se combinan en pérdida total de datos: (1) `saveJson`/`save` escriben con `fs.writeFileSync` directo sobre el archivo final — un crash/OOM/kill de Railway a mitad de write deja `wa_accounts.json` o `wa_campaigns.json` truncado (JSON inválido). (2) `loadJson`/`load` atrapan el parse error y devuelven el fallback vacío (`{accounts:[]}` / `{campaigns:[], leadStates:{}}`). Cualquier operación de escritura posterior (un `appendEvent`, un `updateAccount`, el próximo tick del engine) hace load→fallback-vacío→save y persiste el dataset vacío, destruyendo silenciosamente todas las cuentas (con sus proxies/estado de warming) o todas las campañas. El error solo aparece en un log de consola que nadie mira. El mismo patrón está en los 4 archivos del data layer WA.
**Fix:** (a) Write atómico: escribir a `file + ".tmp"` y `fs.renameSync(tmp, file)`. (b) Fail-closed en la corrupción: distinguir "no existe" (fallback OK) de "existe pero no parsea" (lanzar o renombrar a `.corrupt-<ts>` y loguear fuerte, nunca devolver el fallback escribible):
```js
function loadJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (e) {
    const quarantine = `${file}.corrupt-${Date.now()}`;
    fs.renameSync(file, quarantine);
    throw new Error(`[wa] ${file} corrupto — movido a ${quarantine}, restaurar de backup`);
  }
}
```

### WR-07: Anti-SSRF del enrichment bypasseable vía redirect: `isBlockedHost` solo chequea el host inicial y el fetch sigue redirects

**File:** `src/enrichment.js:394` (check), `src/enrichment.js:257-259` (`redirect: "follow"`)
**Issue:** `enrichFromWebsite` valida `isBlockedHost(host)` sobre el hostname del website ANTES del fetch, pero `safeFetch` usa `redirect: "follow"` sin re-validar los hops. Un sitio externo (el campo `website` llega de scraping/CSV — semi-confiable) puede responder `302 Location: http://169.254.169.254/latest/meta-data/` o hacia la red interna de Railway, y el fetch lo sigue, anulando el guard que el propio comentario del código (l.392-393) declara como objetivo ("no exfiltrar metadata cloud ni pegarle a la red privada"). La exfiltración está acotada a lo que extraen los parsers (email/ads/social/age del body), pero el request interno se ejecuta igual (SSRF ciego + posible GET con side effects).
**Fix:** Usar `redirect: "manual"` y seguir los redirects a mano (cap 3), re-validando `isBlockedHost` en cada hop:
```js
let res, hops = 0, cur = url;
while (hops++ < 3) {
  res = await fetchImpl(cur, { signal, redirect: "manual", headers });
  if (![301, 302, 303, 307, 308].includes(res.status)) break;
  const loc = new URL(res.headers.get("location"), cur);
  if (isBlockedHost(loc.hostname.replace(/^www\./i, ""))) return { ok: false, error: "blocked_redirect" };
  cur = loc.href;
}
```
(Nota: el rebinding DNS puro queda fuera del alcance razonable para este caso de uso, pero el redirect es el bypass trivial y barato de cerrar.)

### WR-08: Pre-deploy commitea `auth.json` con session IDs vivos (= cookies `gs_session` válidas) al repo, mientras sí limpia los demás secrets

**File:** `scripts/pre-deploy.js:107-112`
**Issue:** El script tiene higiene de secrets para Telnyx (l.140-147) y `proxy.pass` (l.176-180), pero guarda `data.auth` COMPLETO, incluyendo el array `sessions`. Verificado: `data/auth.json` está git-trackeado (el flujo documentado commitea todo `data/`), hoy contiene 9 sesiones, y el `id` de cada sesión ES el valor del cookie `gs_session` (index.js:369, 1449) — es decir, bearer tokens vivos de admin/setters en el historial de git, válidos hasta su `expiresAt`. Cualquiera con acceso de lectura al repo puede secuestrar una sesión admin. A diferencia de los proxies/Telnyx, acá el strip NO tiene costo de restore: perder sesiones solo fuerza re-login.
**Fix:** Vaciar las sesiones antes de guardar (mismo patrón que los otros strippers):
```js
if (data.auth) {
  const stripped = Array.isArray(data.auth.sessions) ? data.auth.sessions.length : 0;
  data.auth.sessions = [];
  if (stripped) console.log(`  lock auth.json: ${stripped} session token(s) limpiados (los users re-loguean)`);
  saveFile("auth.json", data.auth, `...`);
}
```
Adicional recomendado (fuera de este script): invalidar las sesiones ya commiteadas en el historial (borrarlas de `auth.json` en prod vía import o rotarlas).

## Info

### IN-01: `requireRole` crea el middleware interno y nunca lo usa (dead code)

**File:** `src/wa/routes.js:164-172`
**Issue:** `const inner = cookieRequireRole(...roles);` (l.165) se construye y se descarta — el closure que sigue re-implementa el check. Confunde: parece que delega al RBAC del server padre pero no.
**Fix:** Borrar la línea 165, o delegar de verdad: `return (req, res, next) => req.auth?.user ? inner(req, res, next) : res.status(401)...`.

### IN-02: Match de teléfono por sufijo: input sin dígitos produce `endsWith("")` === true y matchea la PRIMERA cuenta con phone

**File:** `src/wa/gateway.js:198-203`; `src/wa/routes.js:1188`
**Issue:** `a.phone.replace(/\D/g,"").endsWith(String(x).replace(/\D/g,"").slice(-8))` — si `contactPhone`/`fromPhone` es truthy pero sin dígitos (ej. `"+++"`), el sufijo es `""` y `endsWith("")` es true para cualquier cuenta → el inbound se atribuye a una cuenta arbitraria del pool y contamina el historial del par de warming. `phoneMatches` de campaign-engine.js:276-282 SÍ maneja este caso (`if (!da || !db) return false`) — estos dos sitios no.
**Fix:** Extraer los dígitos primero y cortar si quedan vacíos (o reusar `phoneMatches`): `const suf = String(fromPhone).replace(/\D/g, "").slice(-8); if (!suf) return res.json({ ok:false, reason:"phone inválido" });`

### IN-03: Ventana horaria con `hourStart === hourEnd` nunca envía, sin error ni aviso

**File:** `src/wa/campaign-engine.js:29-31`; `src/wa/campaigns.js:106-115`
**Issue:** `sanitizeCampaign` acepta hourStart==hourEnd (ambos clampeados 0-23 independientes). En `isWithinWindow`, `hourStart <= hourEnd` → `hour >= h && hour < h` → siempre false: la campaña queda running para siempre sin mandar nada y sin feedback.
**Fix:** En `sanitizeCampaign`, rechazar la igualdad: `if (out.window.hourStart === out.window.hourEnd) return ["window: hourStart y hourEnd no pueden ser iguales"];`

### IN-04: Leads borrados dejan `leadStates` huérfanos en `queued` → la campaña nunca llega a `done`

**File:** `src/wa/campaign-engine.js:211-213, 268-269`
**Issue:** El tick hace `if (!lead) continue` (l.213) para leads que ya no existen en `setters.json` (borrados por dedupe/limpiezas, que este proyecto ejecuta seguido). Su estado queda `queued`/`opener_sending` para siempre, así que `terminal === Object.keys(states).length` (l.269) nunca se cumple y la campaña queda `running` eternamente (el drip además los sigue "liberando" en cada intervalo, quemando el batch en leads muertos).
**Fix:** En el loop, si `!lead`, marcar terminal: `if (!lead) { if (ls.state !== "orphaned") { ls.state = "orphaned"; ls.nextActionAt = null; } continue; }` y sumar `orphaned` al conteo de terminales de l.268.

### IN-05: `PATCH /api/wa/accounts/:id` (admin) mergea el body crudo: puede pisar `id`, `proxy` (sin pasar por `sanitizeProxy`), counters y `assignment`

**File:** `src/wa/routes.js:456-460`; `src/wa/data.js:169-176`
**Issue:** `updateAccount(req.params.id, req.body || {})` sin whitelist. Un typo del panel (o un body malformado) puede corromper el registro: cambiar `id` (rompe referencias de routing/pares de warming), setear `proxy` como string (rompe `publicAccount`, que hace destructuring de `account.proxy`), o pisar `msgsSentToday`. Es admin-only, pero es el único write de cuentas sin sanitización del módulo.
**Fix:** Whitelistear campos editables: `const ALLOWED = ["label", "notes", "status", "phone", "minSendGapMinutes"]; const patch = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => ALLOWED.includes(k)));`

### IN-06: El launch no excluye leads ya activos en OTRA campaña running → doble outreach al mismo lead

**File:** `src/wa/campaigns.js:345-361`; `src/wa/routes.js:389-406`
**Issue:** `selectLeadsFromMap` filtra por país/setter/estado pero no consulta `leadStates` de otras campañas. Dos campañas con filtros solapados le mandan openers/pitches en paralelo al mismo teléfono desde (posiblemente) dos cuentas distintas — quemadura de lead y señal de spam para WhatsApp. Además `handleCampaignInbound` corta en la primera campaña que matchea (`break`, campaign-engine.js:352), así que la segunda queda desincronizada (sigue esperando reply que ya llegó).
**Fix:** En el launch, armar un set de leadIds activos en campañas running y filtrarlos antes de `bulkInitLeadStates`: `const busy = new Set(); for (const other of listCampaigns()) if (other.status === "running") for (const [lid, ls] of Object.entries(listLeadStates(other.id))) if (!["no_reply","disqualified","replied_for_setter"].includes(ls.state)) busy.add(lid); const finalIds = leadIds.filter((id) => !busy.has(id));`

### IN-07: Users con `setterId` vacío (campañas creadas por admin sin setter): visibles para cualquier setter/supervisor sin setterId, y el creador supervisor no puede gestionarlas

**File:** `src/wa/routes.js:284-296, 332-342`
**Issue:** Dos efectos del mismo hueco: (1) `GET /campaigns` filtra con `c.setterId === user.setterId` — si un user no-admin tiene `setterId: ""` (el JWT lo defaultea a `""`, routes.js:153) ve todas las campañas creadas por admin sin setterId explícito (metadata + stats). (2) Un supervisor sin setterId crea una campaña con `setterId: ""` y después `canActOnCampaign` (l.287: `campaign.setterId && ...`) le devuelve false sobre su propia campaña — no puede lanzarla ni editarla ni borrarla.
**Fix:** En el filtro del GET, exigir setterId no vacío: `list = list.filter((c) => c.setterId && c.setterId === user.setterId)`. En el POST, rechazar creación no-admin sin setterId: `if (user.role !== "admin" && !user.setterId) return res.status(400).json({ error: "Tu usuario no tiene setterId." });` (mismo patrón que ya usa `POST /accounts`, l.444).

---

_Reviewed: 2026-07-02_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

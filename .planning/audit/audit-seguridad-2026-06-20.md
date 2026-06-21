# Auditoría de Seguridad — SCM Dental

**Fecha:** 2026-06-20
**Alcance:** secrets, npm audit, auth/RBAC, validación/inyección/SSRF/XSS, webhook Telnyx, JWT/cookies, rate limiting.
**Metodología:** solo se reportan hallazgos **verificados leyendo el código real**. Cada uno cita `archivo:línea` + el fix concreto.

---

## Resumen ejecutivo

El proyecto está **sólido en seguridad** para un monolito JSON-file sin DB. El equipo ya hizo varias rondas de hardening (auditorías 2026-05-23 y 2026-06-20) y se nota: passwords con scrypt + timingSafeEqual, JWT_SECRET fail-fast en prod, cookie Secure/HttpOnly/SameSite, webhook Telnyx con firma ed25519 + anti-replay + fail-closed, RBAC consistente con `requireRole`, impersonación (`getEffectiveAuth`) que NO permite elevar privilegios, secrets fuera del repo (`.env` gitignoreado y nunca commiteado, Telnyx vía env vars con JSON vacío, backups/PII dumps destrackeados). Los hallazgos que quedan son de severidad media/baja y de "defensa en profundidad", salvo el riesgo de configuración de `NODE_ENV` que puede degradar varios controles a la vez.

**Conteo por severidad:** CRÍTICO 0 · ALTO 2 · MEDIO 4 · BAJO 3

---

## ALTO

### A-1. `NODE_ENV=production` no está explícito en la config de deploy — 5 controles de seguridad quedan condicionados a una env var implícita

**Severidad:** ALTO (condicional)
**Archivos:**
- `Procfile:1` → `web: node index.js` (no setea NODE_ENV)
- `nixpacks.toml` → `cmd = "node index.js"` (no setea NODE_ENV)
- `index.js:1290` `const _COOKIE_SECURE = process.env.NODE_ENV === 'production' ? '; Secure' : '';`
- `index.js:11226` webhook Telnyx fail-closed (`if (process.env.NODE_ENV === "production")`)
- `index.js:12768` error handler no-leak de `err.message`
- `index.js:12789` JWT_SECRET fail-fast
- `src/wa/gateway.js` Socket.IO CORS (env-driven solo en prod, ver doc CLAUDE.md #24)

**Descripción:** CINCO protecciones se activan SOLO si `process.env.NODE_ENV === 'production'`. No está seteado en ningún archivo commiteado, y la lista de 12 env vars de Railway documentada en CLAUDE.md (nota #43) **no incluye `NODE_ENV`**. Si Railway no lo inyecta (nixpacks a veces lo hace por default, pero NO está garantizado y acá es `node index.js` directo, no `npm start` con build de prod), entonces en producción: la cookie de sesión viaja **sin flag Secure**, el webhook Telnyx **acepta POSTs sin firmar**, los errores 500 **filtran `err.message`** (paths, stack, contenido de archivos), y el server **arranca con JWT_SECRET derivado de ADMIN_PASSWORD** en vez de fallar. Es un único punto de falla que apaga varios controles en silencio.

**Fix:** hacer `NODE_ENV` explícito y no dependiente del default de la plataforma:
1. En Railway dashboard → Variables, agregar `NODE_ENV=production` (y documentarlo en CLAUDE.md nota #43).
2. Como cinturón-y-tirantes, setearlo en el arranque: `nixpacks.toml` →
   ```toml
   [start]
   cmd = "NODE_ENV=production node index.js"
   ```
   (o `Procfile`: `web: NODE_ENV=production node index.js`).
3. Verificar tras deploy: `curl -sI https://<dominio>/api/auth/login` debería mostrar `Set-Cookie: ...; Secure` y un POST sin firma a `/api/telnyx/webhook` debería dar 503.

---

### A-2. `/api/auth/desktop-login` no tiene rate limiting → bypass del anti-brute-force

**Severidad:** ALTO
**Archivo:** `src/wa/routes.js:176`
```js
app.post("/api/auth/desktop-login", express_json(app), async (req, res) => {
    const { email, password } = req.body || {};
    ...
    const auth = deps.verifyCredentials(email, password);
    if (!auth) return res.status(401).json({ error: "credenciales inválidas" });
```
**Descripción:** `/api/auth/login` está protegido por `loginLimiter` (5 intentos/15min, `index.js:1347`), pero `/api/auth/desktop-login` valida las **mismas credenciales** (`verifyCredentials`) y **no tiene ningún rate limiter**. Un atacante puede hacer fuerza bruta de passwords contra este endpoint sin tope, evadiendo completamente la protección del login normal. Ambos endpoints comparten la misma base de usuarios/passwords.

**Fix:** aplicar el mismo limiter al desktop-login. Como el módulo WA se monta con `mountWa(app)` y recibe `deps`, pasar `loginLimiter` por `deps` (o exportarlo) y montarlo:
```js
app.post("/api/auth/desktop-login", deps.loginLimiter, express_json(app), async (req, res) => { ... });
```
Si no se quiere acoplar, crear un limiter local idéntico en `routes.js` (sliding window por IP, 5/15min) y aplicarlo. Verificar que el 6º intento devuelva 429.

---

## MEDIO

### M-1. SSRF: `enrichFromWebsite` (src/enrichment.js) no valida contra localhost/IPs privadas/metadata

**Severidad:** MEDIO (mitigado por gating admin)
**Archivos:**
- `src/enrichment.js:348` `enrichFromWebsite(website, opts)` — solo filtra dominios "basura" (wa.me, redes) en `:363`, **no** localhost/RFC1918/169.254.169.254.
- Consumido por `index.js:2072` (`/api/admin/enrich-leads`, admin-only) y `index.js:5386` (`/api/setters/leads/enrich-from-maps`, admin-only).

**Descripción:** El SSRF guard real (`index.js:8645-8659`) protege **solo** el endpoint `/api/enrich` (línea 8588). Los OTROS dos endpoints de enrichment usan `enrichFromWebsite` del módulo `src/enrichment.js`, que hace `fetch(url)` con `redirect:"follow"` sobre `lead.website` **sin ninguna validación de IP/host interno**. El `website` proviene de datos scrapeados (SerpApi) pero también de **alta manual de leads y de import CSV** (superficie influenciable). Un lead con `website: "http://169.254.169.254/latest/meta-data/"` o `http://localhost:PORT/...` haría que el server fetchee recursos internos. El gating admin baja el riesgo, pero un admin no espera que cargar un CSV dispare requests a la red interna; además `redirect:"follow"` permite que un sitio público redirija a una IP interna (bypass de filtros basados solo en el host inicial).

**Fix:** centralizar el guard SSRF y aplicarlo dentro de `safeFetch`/`enrichFromWebsite`. Reusar la lógica de `index.js:8657` pero más completa (también `::1`, `fc00::/7`, todo el rango `172.16–172.31`, no solo `172.`):
```js
function isBlockedHost(hostname) {
  const h = hostname.toLowerCase();
  if (['localhost','127.0.0.1','0.0.0.0','::1','169.254.169.254'].includes(h)) return true;
  if (h.endsWith('.internal') || h.endsWith('.local')) return true;
  if (/^10\./.test(h) || /^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;   // bug del guard actual: "172." bloquea de más Y de menos
  if (/^127\./.test(h) || /^0\./.test(h)) return true;
  return false;
}
```
Llamarlo en `enrichFromWebsite` después de `hostFromUrl(url)` (`src/enrichment.js:361`) → si bloqueado, `return {email:null, error:"blocked_host"}`. Idealmente resolver el redirect manualmente (`redirect:"manual"`) y re-validar el host de cada hop, o usar `redirect:"error"` para no seguir redirects en absoluto en este contexto.

---

### M-2. Rate limiters confían en `X-Forwarded-For` sin `trust proxy` configurado → spoofeable

**Severidad:** MEDIO
**Archivos:**
- `index.js:133` `keyFn: (req) => 'login:' + ((req.headers['x-forwarded-for'] || ...))`
- `index.js:352` (`attachAuth`) idem para presencia/logging de IP
- No existe `app.set('trust proxy', ...)` en `index.js` (verificado: grep `trust proxy` → 0 hits).

**Descripción:** Los limiters (login, ai, scrape, enrich) usan `req.headers['x-forwarded-for']` como clave de identificación. Ese header es **enteramente controlable por el cliente**. Sin `app.set('trust proxy', ...)`, Express no normaliza `req.ip` y el código lee el header crudo: un atacante puede mandar `X-Forwarded-For: <random>` distinto en cada request y **resetear su cuenta de rate-limit en cada intento**, anulando el loginLimiter (y los demás). El fallback a `req.socket.remoteAddress` solo se usa si el header está ausente — el atacante simplemente lo manda siempre.

**Fix:**
1. `app.set('trust proxy', 1)` (o el nº de proxies de Railway) cerca del top de `index.js`, así Express expone el IP real del primer proxy confiable en `req.ip`.
2. Cambiar los `keyFn` para usar `req.ip` en vez de parsear `x-forwarded-for` a mano:
   ```js
   keyFn: (req) => 'login:' + req.ip
   ```
   Con `trust proxy` seteado, `req.ip` ignora los XFF inyectados por el cliente y toma el que puso el proxy de Railway. Lo mismo en `attachAuth:352` para que el `lastIp` registrado sea confiable.

---

### M-3. `/api/auth/accept-invite` sin rate limiting (token-guessing)

**Severidad:** MEDIO
**Archivo:** `index.js:1625`
```js
app.post('/api/auth/accept-invite', (req, res) => {
  const { token, password } = req.body || {};
  ...
  const invite = data.invites.find((item) => item.token === token && item.status === 'pending');
```
**Descripción:** El endpoint busca una invitación por `token` y, si matchea, **crea un usuario activo + auto-login con cookie de sesión**. No tiene rate limiter ni lockout. Si los tokens de invitación fueran adivinables o cortos, un atacante podría enumerarlos para crear cuentas. El riesgo real depende de la entropía del token (no verifiqué la generación del token en el endpoint de creación de invites `index.js:1570` — recomendable confirmar que use `crypto.randomUUID()`/`randomBytes`, no `Date.now()`/`Math.random()`). Aun con tokens fuertes, no hay defensa de tasa contra enumeración.

**Fix:**
1. Aplicar un limiter (p.ej. el `loginLimiter` o uno propio por IP) a `accept-invite`.
2. Verificar/forzar que el token de invitación se genere con `crypto.randomBytes(32).toString('hex')` o `crypto.randomUUID()` (revisar `index.js:1570`).
3. Opcional: expirar invitaciones (`expiresAt`) y rechazar las vencidas.

---

### M-4. Dependencia `ws` con CVEs high en runtime de producción (via socket.io)

**Severidad:** MEDIO
**Evidencia:** `npm audit` →
```
ws  8.0.0 - 8.20.1   Severity: high
  - Uninitialized memory disclosure (GHSA-58qx-3vcg-4xpx)
  - Memory exhaustion DoS from tiny fragments (GHSA-96hv-2xvq-fx4p)
```
Árbol (`npm ls ws`): `ws@8.18.3` entra por **`socket.io@4.8.3` (engine.io 6.6.6 → ws)** y por `openai@6.33.0` — ambas **dependencias de producción**. El gateway WA (`src/wa/gateway.js`) expone Socket.IO a clientes autenticados, así que el `ws` vulnerable está en la ruta de datos en vivo.

**Descripción:** `form-data` (high, CRLF injection — usado por libs HTTP de prod) y `qs` (moderate, DoS) también vienen de deps de runtime. `vite` (high) es **solo devDependency** (vía vitest) → no llega a producción, prioridad baja.

**Fix:** `npm audit fix` (debería bumpear socket.io/engine.io/ws y form-data/qs a versiones parcheadas sin breaking changes mayores). Tras el fix correr la suite completa (`npm test`, especialmente `wa.test.js` y `smoke:wa`) para confirmar que socket.io sigue funcionando. **Importante (regla de deploy del proyecto):** correr `npm run pre-deploy` antes de commitear el `package-lock.json` actualizado. Si `npm audit fix` quisiera saltar a un major de socket.io, evaluarlo aparte.

---

## BAJO

### B-1. `.env` con secrets vivos en el working directory (no commiteado, pero presente en disco)

**Severidad:** BAJO
**Archivo:** `.env` (NO tracked — confirmado: `git ls-files .env` vacío, y `git log --all -S` de los valores → 0 hits; nunca estuvo en historia).
**Descripción:** El `.env` local contiene API keys reales en claro: `API_KEY` (SerpApi), `QWEN_API_KEY` (OpenRouter), `APIFY_TOKEN`. Correctamente gitignoreado y nunca commiteado — no es un leak en el repo. El riesgo es operativo: estos secrets están en `OneDrive/Desktop`, o sea **sincronizados a la nube de OneDrive**. Si la cuenta de OneDrive se compromete, las keys se filtran.
**Fix:** sin acción urgente en el repo. Recomendación: (a) considerar rotar las keys que estuvieron mucho tiempo en disco sincronizado, (b) idealmente no tener el `.env` con secrets de prod dentro de una carpeta OneDrive (mover el proyecto fuera de la carpeta sincronizada, o excluir `.env` de OneDrive). Las keys de prod ya viven en Railway env vars, así que el `.env` local podría tener solo valores dummy.

---

### B-2. PII de usuarios y leads commiteada en `data/*.json` versionados

**Severidad:** BAJO (decisión de arquitectura conocida)
**Archivos:** `data/auth.json` (emails, IPs `lastIp`, user-agents de usuarios reales), `data/setters.json` (14MB, PII de ~5000 leads: nombres, teléfonos, direcciones, emails), `data/history.json`, `data/mercury_generations.json`.
**Descripción:** Por diseño (persistencia file-based en el repo para sobrevivir deploys, ver CLAUDE.md), todos los JSON con PII están **trackeados en git**. `auth.json` incluye IPs y user-agents de los usuarios. Las passwords están hasheadas (scrypt) así que no son el problema; el problema es la PII de leads + las IPs/UAs del staff. Cualquiera con acceso de lectura al repo (o a un fork/clon) tiene la base de datos completa de prospectos. Esto NO es un leak de secrets, pero es una exposición de datos personales relevante para compliance (GDPR/cold-calling EU/USA, que el propio proyecto ya considera con DNC).
**Fix:** es un trade-off ya asumido por el proyecto, no un bug. Mitigaciones si se quiere endurecer: (a) mantener el repo estrictamente privado y auditar accesos/colaboradores, (b) considerar migrar la persistencia a un volumen/DB no versionada (saca la PII de git por completo — es el cambio "correcto" a largo plazo), (c) como mínimo, dejar de commitear `auth.json` con `lastIp`/`lastUserAgent` (esos campos no son necesarios en el repo; podrían vivir solo en el volumen de Railway).

---

### B-3. Bug menor en el guard SSRF existente: `hostname.startsWith('172.')` bloquea de más y de menos

**Severidad:** BAJO
**Archivo:** `index.js:8657`
```js
... || hostname.startsWith('172.') || ...
```
**Descripción:** El rango privado RFC1918 de clase B es `172.16.0.0/12` (172.16–172.31), no todo `172.`. `startsWith('172.')` **bloquea de más** (172.1.x, 172.200.x, que son IPs públicas legítimas) y, en otros guards, este patrón bloquearía de menos si se confiara solo en prefijos. No es explotable como SSRF (bloquea de más, no de menos, en este caso puntual), pero la lógica es incorrecta y conviene unificarla con el helper propuesto en M-1. Además este guard solo valida el host **inicial** y usa `fetch` con redirect por default → un sitio público que redirige a `169.254.169.254` no sería re-validado.
**Fix:** reemplazar por el regex `^172\.(1[6-9]|2\d|3[01])\.` del helper `isBlockedHost` de M-1, y compartir ese único helper entre `index.js:8657` y `src/enrichment.js`. Considerar `redirect:"manual"` + re-validación por hop.

---

## Lo que está BIEN (verificado, no requiere acción)

- **Passwords:** scrypt (`index.js:163`) + comparación con `crypto.timingSafeEqual` (`index.js:173`). Sin plaintext en `auth.json` (verificado).
- **Secrets fuera del repo:** `.env` gitignoreado y **nunca** en historia (`git log --all -S` → 0). `data/telnyx_config.json` con `apiKey/sipPassword/...` vacíos (env-sourced); el `git log -p` de ese archivo nunca tuvo secrets. `wa_accounts.json` sin `proxy.pass` en claro (proxies aún null).
- **Backups/PII dumps destrackeados:** `data/*.bak*` y `paula-old.json` (9MB PII) NO trackeados (verificado con `git ls-files`).
- **JWT_SECRET fail-fast** en prod (`index.js:12785`): exit(1) si falta o <16 chars; ya no deriva de ADMIN_PASSWORD en prod.
- **Cookie de sesión:** `HttpOnly; SameSite=Lax; Secure` (en prod) (`index.js:1293`).
- **RBAC:** endpoints admin con `requireRole('admin')` (export-data, import-data, enrich-leads, scrape, backfills, reset-to-seed, etc. — verificados). Setters scopeados por `assignedTo`/`setterId`.
- **Impersonación segura:** `getEffectiveAuth` (`index.js:462`) solo aplica `viewAs` si el rol REAL es admin; un setter que mande `?viewAs=admin` se ignora. No eleva privilegios.
- **Webhook Telnyx:** firma ed25519 (`index.js:11198`), anti-replay 5min (`index.js:11191`), usa `req.rawBody` capturado vía verify hook de express.json solo para esa ruta (`index.js:91`), **fail-closed en producción** si falta la public key (`index.js:11226`, 503). Cada evento persiste `verified: true|false|"skipped"`.
- **XSS:** `escHtml` (`public/app.js:490`) escapa `& < > " '`; usado en los hot paths de render de leads (notas en `:5136-5137`, ids en `onclick`). Interpolaciones de campos de lead sin escapar van a `.textContent` (seguro) o pasan por `encodeURIComponent` (map queries). Hardening previo VULN-A1 bloquea `javascript:`/`data:` URLs.
- **Rate limiting:** sliding-window propio en login, AI (faqs/suggest), scrape (apify/scrape), enrich (`index.js:130-151`), todos wired. (Gaps puntuales: A-2 desktop-login, M-3 accept-invite, M-2 confiabilidad del IP key.)
- **Socket.IO WA:** auth fail-closed (JWT o cookie; rechaza con "no auth", `gateway.js:98`), ownership checks (`userCanActOnAccount`, `gateway.js:105`).
- **Error handler:** no filtra `err.message` en prod (`index.js:12768`) — depende de A-1.
- **`proxy-credentials`** (`routes.js:274`) devuelve el pass completo solo al dueño; `publicAccount()` (`routes.js:97`) tapa `proxy.pass` en el listado.

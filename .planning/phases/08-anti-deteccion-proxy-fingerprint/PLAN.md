# Phase 8 — Anti-detección wa-multi: Proxy + Fingerprint por cuenta

> Infraestructura anti-baneo para correr Phase 7 (campañas) a volumen.
> Proxy opt-in por cuenta + completar el fingerprint existente con
> coherencia geo (timezone/idioma/UA).

**Fecha:** 2026-06-10
**Status:** Planned — listo para ejecutar
**Context:** ver [08-CONTEXT.md](08-CONTEXT.md)

---

## Goal

Que cada cuenta de WhatsApp en wa-multi pueda salir por su propio proxy
(opt-in) y que, cuando lo haga, el navegador reporte timezone/idioma/UA
coherentes con el país de ese proxy — de modo que varias cuentas en la
misma máquina no se delaten ni por IP compartida ni por mismatch geo.

**Lo que YA existe (no se toca):** el fingerprint de canvas/WebGL/audio/
cores/RAM/Chrome por seed determinista en
[whatsapp.js:80-183](../../../wa-multi/src-v058-work/out/preload/whatsapp.js).

---

## Success criteria (verificable)

1. Admin asigna un proxy (HTTP o SOCKS5, con o sin auth user:pass) a una
   cuenta desde el panel y la cuenta sale por esa IP. Verificable con el
   botón "Probar proxy" → muestra IP + país saliente ≠ IP local.
2. Cuenta SIN proxy abre y funciona exactamente como hoy (opt-in real).
3. Reabrir una cuenta da el MISMO fingerprint (seed estable) — log
   `[scm-fp]` muestra los mismos valores entre aperturas.
4. Con proxy de país X, `Intl.DateTimeFormat().resolvedOptions().timeZone`,
   `navigator.language` y el User-Agent reportan valores de X (no de la
   máquina real). Verificable en DevTools de la ventana de la cuenta.
5. Proxy caído → la ventana NO abre con la IP real; muestra error claro
   al user (fail-safe, no leak de IP del operador).
6. `wa_accounts.json` con campos proxy/geo sobrevive un redeploy
   (export-data + pre-deploy lo incluyen).
7. Flag de política consumible por Phase 7: una campaña puede negarse a
   encolar volumen en cuentas sin proxy.

---

## Out of scope

- Reescribir el fingerprint canvas/webgl/audio existente (funciona).
- Protocolos V2Ray/vmess/vless/shadowsocks (solo HTTP/SOCKS5).
- El motor de campañas (Phase 7) y Mercury (Phase 4).
- Rotación automática de proxies / pool compartido (futuro).

---

## Data model — extensión de `wa_accounts.json`

Cada cuenta (array `accounts[]`) gana campos opcionales:

```jsonc
{
  // ...campos existentes (id, label, phone, status, assignment, warming...)
  "proxy": {                 // null o ausente = sin proxy (comportamiento actual)
    "type": "http",          // "http" | "socks5"
    "host": "1.2.3.4",
    "port": 8080,
    "user": "",              // opcional (proxy con auth)
    "pass": ""               // opcional
  },
  "geo": {                   // se aplica SOLO si hay proxy
    "country": "MX",         // ISO-2; deriva timezone/locale por defecto
    "timezone": "America/Mexico_City",
    "locale": "es-MX"
  },
  "fingerprintSeed": 123456, // ya implícito hoy (deriva de accountId);
                             // se persiste explícito para poder regenerarlo
  "proxyLastTest": {         // resultado del último "Probar proxy"
    "at": "2026-06-10T...",
    "ok": true,
    "ip": "201.x.x.x",
    "country": "MX"
  }
}
```

Mapa país → {timezone por defecto, locale} hardcoded en un helper
`GEO_DEFAULTS` (MX, AR, ES, US, CO, CL, PE, etc. — los países donde
operan los setters). Si el admin no especifica timezone/locale, se
derivan de `country`.

---

## Plan de ejecución (waves)

### Wave 1 — Backend: schema + CRUD proxy/geo (server, testeable) ~2h

**T1.1** En `src/wa/data.js`: extender el normalizador de cuenta
(donde se hace `ensureAccountDefaults` o equivalente) para aceptar y
persistir `proxy`, `geo`, `fingerprintSeed`, `proxyLastTest`. Defaults:
`proxy: null`, `geo: null`. `fingerprintSeed`: si falta, derivarlo del
`id` (mismo hash que usa hoy el preload, para no cambiar fingerprints de
cuentas ya conectadas).
- read_first: `src/wa/data.js`
- acceptance: `data.js` contiene `proxy` y `geo` en la función de
  defaults; una cuenta cargada sin esos campos los devuelve como `null`
  sin romper; cuenta con ellos los preserva en save→load roundtrip.

**T1.2** En `src/wa/routes.js`: nuevo endpoint
`PATCH /api/wa/accounts/:id/proxy` (admin, y setter dueño de la cuenta).
Body: `{proxy, geo}`. Valida: `type ∈ {http,socks5}`, `host` no vacío,
`port` 1-65535. Si `proxy:null` → limpia proxy/geo (volver a sin-proxy).
Deriva geo defaults de `country` si timezone/locale no vienen. Usa el
patrón de mutex si hay await antes del save (ver `mutateSettersData` en
index.js para el patrón).
- read_first: `src/wa/routes.js` (ver el RBAC/ownership de los endpoints
  existentes de accounts), `GEO_DEFAULTS` helper nuevo
- acceptance: PATCH con type inválido → 400; PATCH válido → 200 y
  `loadAccounts()` devuelve el proxy; PATCH `{proxy:null}` → cuenta sin
  proxy; setter ajeno → 403 (reusa `userCanActOnAccount`/ownership ya
  existente).

**T1.3** GEO secrets: el `proxy.pass` NO debe viajar al frontend en las
respuestas GET de accounts. En el serializador de cuenta para el cliente
(equivalente a `_publicAccount` si existe, o crearlo), reemplazar
`proxy.pass` por `"***"` si está seteado, y `proxy.user` se puede
mostrar. El PATCH acepta pass nuevo; si llega vacío y ya había uno, NO
lo pisa (mismo patrón que Telnyx config: campos omitidos no se tocan).
- read_first: `src/wa/routes.js` (GET accounts), CLAUDE.md sección
  "env vars > JSON" para el patrón de no-leak
- acceptance: GET /api/wa/accounts nunca devuelve `pass` en claro;
  PATCH sin pass preserva el pass anterior.

**T1.4** Verificar export/pre-deploy: confirmar que `wa_accounts.json`
ya entra en `/api/admin/export-data` y `scripts/pre-deploy.js` (línea
~167 ya lo baja). Si los nuevos campos viven dentro de `accounts[]`,
viajan solos. Documentar en el commit que no requiere cambio de export.
- read_first: `scripts/pre-deploy.js`, el handler export-data en index.js
- acceptance: un export incluye las cuentas con sus campos proxy/geo.

**T1.5** Flag de política para Phase 7: agregar a la config del módulo
WA (o a `alert_config.json`/un nuevo `wa_policy`) un booleano
`requireProxyForCampaigns` (default false). Solo se persiste y se expone
por GET; Phase 7 lo consumirá. No hace nada todavía.
- acceptance: el flag se persiste y se lee; default false.

**Tests (T1.6):** `tests/wa-proxy.test.js` siguiendo el patrón de
`tests/wa.test.js` (DATA_DIR=tmp, pre-popular auth.json + wa_accounts.json
antes de importar index.js). Cubre T1.1-T1.3: roundtrip de schema,
validación del PATCH, RBAC, no-leak de pass.

Commit: `feat(wa): backend proxy+geo config por cuenta (opt-in)`

---

### Wave 2 — Desktop: aplicar proxy en la sesión + auth + fail-safe ~3h

> Edita `wa-multi/src-v058-work/out/main/index.js`. Recordar: el source
> .ts está extraído; estos son los .js compilados que se repackean. Build
> con `npm run build` (electron-vite) dentro de src-v058-work.

**T2.1** En `openAccountWindow` (index.js ~380-445), ANTES de
`win.loadURL(WA_URL)`: si la cuenta tiene `proxy`, construir proxyRules y
aplicarlo a la sesión de la partición:
```js
const ses = electron.session.fromPartition(partition);
if (account.proxy && account.proxy.host) {
  const { type, host, port } = account.proxy;
  const rules = type === "socks5"
    ? `socks5://${host}:${port}`
    : `http=${host}:${port};https=${host}:${port}`;
  await ses.setProxy({ proxyRules: rules });
} else {
  await ses.setProxy({ mode: "direct" });   // explícito: sin proxy
}
```
- read_first: `wa-multi/src-v058-work/out/main/index.js` (openAccountWindow),
  `tmp/app_source/dist/electron/main.js` (buscar `setProxy` para confirmar
  el shape de proxyRules de WAWarmer)
- acceptance: el código contiene `ses.setProxy` con rama socks5 y rama
  http; cuenta sin proxy llama `setProxy({mode:"direct"})`.

**T2.2** Auth de proxy (user:pass). En el main, registrar UNA vez
`electron.app.on("login", (event, webContents, details, authInfo, cb) => {...})`.
Resolver la cuenta dueña por la webContents (mismo patrón que
`reset-activity` usa `webContents.id` para mapear a accountId en
openWindows). Si esa cuenta tiene `proxy.user/pass` y `authInfo.isProxy`,
`event.preventDefault(); cb(user, pass)`. Si no, dejar pasar (no llamar cb
o cb() para que falle controladamente).
- read_first: index.js (el handler `reset-activity` ~254 para el patrón
  webContents.id → accountId)
- acceptance: existe `app.on("login"` que chequea `authInfo.isProxy` y
  llama `cb(user,pass)` con las creds de la cuenta dueña.

**T2.3** Fail-safe anti-leak de IP. Tras setProxy, ANTES de cargar
WhatsApp, hacer una verificación de salida: cargar una URL de echo-IP en
la sesión (o un `net.request` por esa sesión) con timeout 8s. Si falla
(proxy caído) → NO cargar WA_URL; cerrar la ventana y emitir un evento
`emitEvent(account.id, "proxy-error", {reason})` + `notify(...)` para que
el panel/usuario lo vea. Solo si la verificación pasa (o no hay proxy) se
hace `win.loadURL(WA_URL)`.
- read_first: index.js (openAccountWindow, emitEvent, notify), doc Electron
  `net.request`/`session` (usar `ses.fetch` si disponible en Electron 41)
- acceptance: con proxy host inválido, la ventana no navega a
  web.whatsapp.com y se emite `proxy-error`; con proxy válido o sin proxy,
  carga normal.

**T2.4** Reload coherente: si una cuenta YA está abierta y se le cambia el
proxy desde el panel (evento socket nuevo `account:proxy-changed` o al
reabrir), aplicar setProxy + `win.webContents.reload()`. MVP: basta con
aplicar al abrir; documentar que cambiar proxy requiere cerrar/reabrir la
cuenta. (Reload en caliente = nice-to-have, dejar TODO.)
- acceptance: documentado el comportamiento; al reabrir, el proxy nuevo
  aplica.

Commit: `feat(wa-multi): proxy por cuenta (http/socks5) + auth + fail-safe anti-leak`

---

### Wave 3 — Desktop: coherencia geo en el preload (tz/locale/UA) ~3h

> Edita `wa-multi/src-v058-work/out/preload/whatsapp.js` (extiende
> `applyFingerprintPatches`) y el paso de args en `index.js`.
> Referencia de cómo spoofear: `tmp/app_source/.../fingerprint-template/`
> (timezone_value, location_value, language_value, useragent_value).

**T3.1** Pasar la geo al preload vía `additionalArguments` del
BrowserWindow (mismo mecanismo que `--wa-account-id=` hoy). En
`openAccountWindow`, si hay `account.geo`, agregar:
`--wa-geo=${encodeURIComponent(JSON.stringify(account.geo))}` al array
`additionalArguments`.
- read_first: index.js (webPreferences.additionalArguments ~412)
- acceptance: index.js agrega `--wa-geo=` cuando la cuenta tiene geo.

**T3.2** En el preload, helper `getGeo()` análogo a `getAccountId()`:
parsea `--wa-geo=` de process.argv → `{country,timezone,locale}` o null.
- read_first: whatsapp.js (getAccountId ~172)
- acceptance: existe `getGeo()` que devuelve el objeto o null.

**T3.3** Si hay geo, dentro de `applyFingerprintPatches` (o una función
nueva `applyGeoPatches(geo)` llamada justo después), spoofear:
- **Timezone**: override `Intl.DateTimeFormat.prototype.resolvedOptions`
  para devolver `timeZone: geo.timezone`, y `Date.prototype.getTimezoneOffset`
  para devolver el offset correcto del timezone (calcular el offset real
  del timezone, no hardcodear — usar un mapa offset por timezone o derivarlo).
- **Locale**: override `navigator.language` y `navigator.languages`
  (defineProperty) → `geo.locale` + fallback `['es', 'en']`.
- **User-Agent**: ya hay `chromeMajor` derivado del seed; construir un UA
  coherente (Windows/Mac segun el navigator que ya falsea) y aplicarlo.
  Importante: el UA del PROCESO se setea en main con `setUserAgent`
  (index.js 401/415) — para que varíe por cuenta, mover ese setUserAgent a
  ser por-seed (derivar de fingerprintSeed) en main, y que el preload
  override `navigator.userAgent` sea consistente con ese.
- read_first: whatsapp.js (applyFingerprintPatches, el bloque de
  navigator/chromeMajor ~80-170), los templates
  `tmp/app_source/.../fingerprint-template/{timezone_value,language_value,useragent_value}_fingerprint.js`
- acceptance: con `--wa-geo` de MX, en DevTools de la ventana
  `Intl.DateTimeFormat().resolvedOptions().timeZone === "America/Mexico_City"`,
  `navigator.language === "es-MX"`; el log `[scm-fp]` incluye tz/locale.

**T3.4** UA por seed en main: cambiar el `CHROME_UA` fijo
(index.js 400-401, 415) por una función `uaForAccount(account)` que
derive del `fingerprintSeed` (versión de Chrome + plataforma coherente con
lo que el preload falsea en navigator.platform). Sin geo, igual varía por
cuenta (no contradice nada). Con geo, la plataforma puede ajustarse.
- read_first: index.js (CHROME_UA const + los 2 setUserAgent)
- acceptance: dos cuentas distintas → dos UA distintos en
  `win.webContents.getUserAgent()`.

Commit: `feat(wa-multi): coherencia geo (timezone/locale/UA por cuenta) cuando hay proxy`

---

### Wave 4 — Panel admin: UI de proxy + botón "Probar proxy" ~2.5h

> Edita `public/wa.js` (view-wa-accounts, las cards de cuenta) +
> `public/index.html`. BUMPEAR cache-buster de wa.js (hoy v=20260523a).

**T4.1** En la card de cada cuenta (donde se renderiza en `public/wa.js`),
agregar una sección colapsable "🛡️ Proxy + Fingerprint" con:
- Select tipo (Sin proxy / HTTP / SOCKS5)
- Inputs host, port, user, pass (pass como password; placeholder "***" si
  ya hay uno guardado, vacío = no cambiar)
- Select país (GEO_DEFAULTS) que autocompleta timezone/locale (editables)
- Botón "Guardar" → PATCH /api/wa/accounts/:id/proxy
- Botón "🔌 Probar proxy"
- Indicador del último test (`proxyLastTest`: ✓ IP país / ✗ error)
- read_first: `public/wa.js` (render de account card), `public/index.html`
  (view-wa-accounts), `public/style.css` (tokens del design system, NO
  editar style.css salvo necesario)
- acceptance: la card muestra la sección; guardar persiste y re-render
  muestra los valores (pass como ***).

**T4.2 — MOVIDA A WAVE 2 (decisión 2026-06-10).** El test del proxy NO se
hace server-side. Razones: (1) Node 20 no expone un proxy-agent (sin
`undici.ProxyAgent` accesible, sin socks-proxy-agent) y no quiero sumar
una dependencia nueva; (2) testear desde Railway es ENGAÑOSO — probaría el
proxy desde la IP de Railway, no desde la compu del setter donde realmente
se usa (muchos proxies residenciales están whitelisteados por IP). El test
fiel lo hace Electron desde la sesión real al abrir la cuenta. Por eso el
"Probar proxy" vive en el desktop (Wave 2, T2.3 fail-safe ya hace el echo-IP
real). En Wave 4 el botón explica esto; cuando Wave 2 esté distribuida,
muestra el resultado real vía evento socket.

**T4.3** Bumpear cache-buster: en `public/index.html` subir wa.js de
`v=20260523a` a `v=20260610a` (o la fecha del día). Verificar que
`express.static` sirve la versión nueva.
- read_first: `public/index.html` (los `<script src>`)
- acceptance: index.html referencia `wa.js?v=20260610a`.

Commit: `feat(wa): UI de proxy por cuenta + probar proxy + cache-buster`

---

### Wave 5 — Verificación + docs ~1.5h

**T5.1** `VERIFICATION.md` manual (Electron no se testea unit). Checklist
modelado en `.planning/phases/warming-lunes/VERIFICATION.md`:
- Abrir cuenta SIN proxy → funciona como hoy, log [scm-fp] presente.
- Asignar proxy MX a una cuenta → "Probar proxy" muestra IP MX.
- Abrir esa cuenta → en DevTools: timezone=America/Mexico_City,
  navigator.language=es-MX, UA coherente; IP saliente = proxy (verificar
  en whatsapp web o un whoer.net).
- Proxy con auth user:pass → conecta sin pedir credenciales manualmente.
- Proxy host inválido → ventana NO abre, aparece notif de error, NO se
  filtra la IP real (verificar con echo-IP que la ventana nunca cargó).
- Reabrir la misma cuenta dos veces → mismo fingerprint (seed estable).
- Dos cuentas distintas → fingerprints y UA distintos.

**T5.2** Doc operativo `docs/proxy-setup.md`: cómo comprar un proxy
residencial, qué tipo (HTTP/SOCKS5), cómo cargarlo en el panel, cuándo
conviene (3-4+ cuentas), y la regla de coherencia geo (proxy del país de
los leads que trabaja esa cuenta).

**T5.3** Actualizar CLAUDE.md con una nota nueva (sección "Notas para otra
IA") sobre el sistema de proxy+geo: dónde vive cada cosa, el fail-safe, y
que V2Ray quedó excluido a propósito.

**T5.4** Repack del wa-multi: `npm run build` en src-v058-work + generar
el portable nuevo (v0.5.9) en `wa-multi/versiones/`. Actualizar
`wa-multi/README.txt` con los cambios.

Commit: `docs(phase-8): verification + proxy setup + repack wa-multi v0.5.9`

---

## Orden de deploy

1. Waves 1 (backend) se puede deployar sola al server (Railway) sin
   romper nada — son campos opt-in nullables.
2. Waves 2-3 (desktop) NO van a Railway — son el wa-multi que corre en la
   compu. Se distribuyen como build nuevo.
3. Wave 4 (panel) va a Railway con el cache-buster.
4. **Antes del push a `main`: `npm run pre-deploy`** (baja la data viva
   incluyendo wa_accounts.json). Luego `git push origin main` y
   `git push origin main:master`.

---

## Riesgos / notas

- **Electron timezone**: no hay override nativo per-BrowserWindow del TZ
  del sistema. El spoof a nivel JS (Intl/Date en preload) es el camino
  fiable. Asumir eso; si WhatsApp leyera el TZ por otra vía, ampliar el
  patch.
- **SOCKS5 con auth**: Electron soporta SOCKS5 pero la auth user:pass por
  SOCKS5 puede no dispararse vía `app.on('login')` igual que HTTP — validar
  en Wave 2; si falla, documentar que SOCKS5 con auth requiere proxy
  whitelisteado por IP, o usar HTTP con auth.
- **proxy-test server-side vs desktop**: el MVP testea desde Railway. Eso
  valida que el proxy funciona y por dónde sale, pero la IP que ve
  WhatsApp es la del desktop saliendo por el proxy — esa se valida en la
  apertura real (Wave 2 fail-safe). Dejar claro en la doc.

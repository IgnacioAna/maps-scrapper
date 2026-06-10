# Phase 8 — Anti-detección wa-multi: Proxy + Fingerprint — CONTEXT

> Capturado el 2026-06-10. El user mostró el instalador de Dolphin Anty
> y pidió: proxy por cada WAMULTI + sesiones con fingerprint que parezcan
> otro dispositivo. "Sacá lo que pueda servir, no tenés que hacerlo tal
> cual."

## Hallazgo central: WAWarmer ya es la referencia

`tmp/app_source/` (GITIGNORED — verificado, no se commitea) contiene
**WAWarmer 1.1.2** decompilado: una herramienta comercial de warmeo de
WhatsApp que YA implementa proxy + fingerprint por cuenta y está probada
contra WhatsApp Web. No reinventar — copiar el modelo.

### Proxy (cómo lo hace WAWarmer)
- Nativo de Electron, sin libs:
  ```js
  const ses = session.fromPartition('persist:acc-X');
  await ses.setProxy({ proxyRules: `http=${h}:${p};https=${h}:${p};socks5=${h}:${p}` });
  webview.reload();
  ```
- Para protocolos avanzados (vmess/vless/shadowsocks) WAWarmer levanta un
  subproceso **V2Ray** local y apunta el proxy de la sesión a localhost.
  → **EXCLUIDO de nuestro scope**: los proxies residenciales que el user
  va a comprar son HTTP o SOCKS5 estándar. KISS.
- Modo "system proxy": `setProxy({mode:'system'})` (fallback sin proxy
  custom).

### Fingerprint (modelo Dolphin, idéntico)
- Carpeta `tmp/app_source/dist/electron/static/fingerprint-template/`:
  canvas / webgl / audio / navigator / dom (advanced + number) +
  timezone_value + location_value + language_value + useragent_value +
  fingerprint-manager.
- Cada script tiene plantillas `{{canvas_advanced_seed}}` etc. que se
  reemplazan por cuenta antes de inyectar como preload.
- El seed alimenta un **LCG determinista** (`t=(9301*t+49297)%233280`)
  → mismo seed = mismo "dispositivo" SIEMPRE. Esto es clave: la cuenta
  debe parecer el MISMO teléfono en cada apertura, no uno nuevo cada vez.
- `fingerprint-manager.js` expone `debugFingerprint()` para validar que
  todos los hooks se inyectaron.

## Estado actual de wa-multi (base correcta ya existe)
- `out/main/index.js:399` — `session.fromPartition('persist:acc-{id}')`
  por cuenta (partición persistente). ✅ base correcta.
- `:401` y `:415` — `setUserAgent(CHROME_UA)` fijo (mismo UA para todas
  las cuentas). ⚠️ a randomizar por seed.
- preload actual: `../preload/whatsapp.js`. El fingerprint se inyectaría
  ANTES o como parte del preload de la partición.

## Diseño propuesto

### Data (`wa_accounts.json`, extender cada cuenta)
```
proxy: { type: 'http'|'socks5', host, port, user?, pass? } | null
fingerprintSeed: <int estable, generado 1 vez por cuenta>
geo: { timezone: 'America/Mexico_City', locale: 'es-MX', country: 'MX' }
```

### Coherencia geo↔proxy (CRITERIO CENTRAL)
El mismatch delata más que no tener proxy. Si el proxy es MX, la sesión
debe reportar timezone MX + locale es-MX + UA coherente. Idealmente
derivar `geo` del país del proxy (o del país del lead objetivo de la
cuenta). Validar en el plan si auto-derivar o pedir manual.

### Gotchas Electron
- **Proxy con auth user:pass**: `setProxy` NO pasa credenciales. Hay que
  manejar `app.on('login', (event, webContents, request, authInfo, cb) =>
  cb(user, pass))` resolviendo las creds por la cuenta dueña de esa
  webContents/partition.
- **Fail-safe**: si el proxy está caído, la cuenta NO debe abrir con la
  IP real (filtraría la IP local del operador). Detectar y avisar.
- Reload del webview tras setProxy (el proxy no aplica retroactivamente
  a requests ya en vuelo).

### UI
- Sección "Proxy + Fingerprint" en la card de cada cuenta (panel admin,
  view-wa-accounts).
- Botón "Probar proxy" → abre la partición headless o liviana y hace
  fetch a un echo-IP (ej. api.ipify.org) para confirmar IP saliente +
  país, antes de asignar.
- Mostrar 🔒 / país / estado del proxy en la card.

## Relación con otras fases
- **Phase 7 (campañas)** se apoya en esto: opción de política "no encolar
  volumen por cuentas sin proxy". No es bloqueante para construir Phase 7,
  pero sí para operarla a volumen sin quemar cuentas.
- **Warming (Phase 2.x ya hecho)**: el warming-network existente debería
  seguir funcionando con proxy puesto (las cuentas chatean entre sí); el
  proxy es transparente al warming.

## Gotchas del repo (CLAUDE.md)
- wa-multi: el SOURCE no vive en git, se extrae del asar y se repackea
  (ver wa-multi/README.txt). El source de trabajo actual está en
  `wa-multi/src-v058-work/`. Build: `npm run build` (electron-vite).
- `wa_accounts.json` ya está en el export-data / pre-deploy (verificar).
- No tocar style.css/app.js sin bumpear cache-buster (esta fase es
  mayormente desktop + un poco de panel admin).

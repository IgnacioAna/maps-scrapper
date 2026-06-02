# Plan WAMULTI v0.5.8 — abrir chat desde SCM + tracking de envío

> Estado: PLANIFICADO (research hecho contra el source real de v0.5.7). Build pendiente — hacer con el user presente para test inmediato.
> Fecha: 2026-05-30

## Objetivo (pedido del user)

1. Botón de WhatsApp en el SCM → en vez de abrir WhatsApp normal, abre **WAMULTI** con el chat del lead + **mensaje de apertura precargado** (sin enviar — el user revisa y manda).
2. Como el user tiene **2 cuentas abiertas en WAMULTI**, al clickear debe poder **elegir desde cuál cuenta** abrir (popover de selección).
3. El tracking de "contactado" se registra **cuando el mensaje se ENVÍA** (no cuando se abre el chat — el user puede abrir y arrepentirse). Queda guardado: qué lead, desde qué cuenta/número WA se le escribió, y cuándo.
4. Solo aplica a los leads del user **Ignacio** (admin/setter_ignacio) en fase de testing. Paula y demás siguen con `wa.me/` normal.

## Research verificado (source v0.5.7 extraído del app.asar)

### Arquitectura WAMULTI
- Cada cuenta WA = una `BrowserWindow` con partition `persist:acc-<id>`, guardadas en el Map `openWindows` (accountId → win). Ref: `out/main/index.js:308`.
- `WA_URL = "https://web.whatsapp.com/"`. Las ventanas solo navegan dentro de `web.whatsapp.com` (will-navigate/will-redirect bloquean el resto).
- **Ya navega a `web.whatsapp.com/send?phone=X&text=Y`** para mandar — ESO YA PRECARGA EL TEXTO en el composer (`sendMessageInWindowInner`, `index.js:498`). El flujo de envío hace después un OS-click en el send button o Enter. Para "abrir sin enviar" = ese código cortado antes del click-send.
- `bringToFront(win)` ya existe para focusear una ventana.
- Handlers socket que YA escucha: `account:open`, `account:close`, `account:send-message`, `routine:start/stop`, `warming:send-message`, `followup:send-message`. NO hay "abrir chat sin enviar" ni protocolo custom.

### Preload (out/preload/whatsapp.js)
- Sistema de detectores con `MutationObserver` sobre document.body + `setInterval(evaluate, 3000)`.
- Emite eventos al main con `send(type, payload)` → `ipcRenderer.send("wa:event", {accountId, type, payload})`.
- Detecta: qr, connected, loading, inbound-message (unread), pending-too-long, banned-banner, cant-send.
- **NO detecta envío saliente manual todavía** — hay que agregarlo.

## Implementación por componente

### A) WAMULTI main process (out/main/index.js)
1. **Registrar protocolo custom**: `app.setAsDefaultProtocolClient('wamulti')` + manejar `open-url` (mac) y segundo-instance/argv (win) para parsear `wamulti://send?phone=X&text=Y&accountId=Z&leadId=L`.
   - En Windows el protocolo llega como argumento del proceso (segundo instance). Usar `app.requestSingleInstanceLock()` + evento `second-instance` para capturar el argv con la URL.
2. **Nueva función `openChatInAccount(account, phone, text)`**: reusa la lógica de `sendMessageInWindowInner` PERO corta antes del send. O sea: abrir ventana si no existe → `bringToFront` → `loadURL(/send?phone&text)` → esperar composer → FIN (no click-send). El texto queda precargado, el user manda a mano.
3. **Handler del protocolo**: parsea URL → busca account por accountId → llama `openChatInAccount`. Si accountId no existe/cuenta cerrada, abrir la primera disponible o avisar.
4. **Registrar tracking pendiente**: al abrir vía protocolo, guardar `pendingContactTracking.set(accountId, {phone, leadId, openedAt})`. Se usa para correlacionar el envío manual.
5. **Recibir `outgoing-sent` del preload**: cuando llega, buscar si hay pendingContactTracking para ese accountId con phone que matchee → emitir al SCM server vía socket `lead:contacted` con `{leadId, accountId, fromPhone: account.phone, sentAt}`. Limpiar el tracking.

### B) WAMULTI preload (out/preload/whatsapp.js)
1. **Detector de mensaje saliente nuevo**: en `evaluate()`, contar mensajes salientes del chat actual (`document.querySelectorAll('div.message-out').length` — VERIFICAR selector real en runtime, puede ser `[data-id*="true_"]` o `.message-out`). Mantener baseline al entrar al chat.
2. Cuando el count sube respecto al baseline → emitir `send('outgoing-sent', {phone: <del URL actual o chat header>})`.
3. ⚠️ RIESGO: selectores de WhatsApp Web cambian. Testear en vivo. Plan B si el observer falla: botón flotante manual "✓ Le escribí" inyectado en la ventana, que el user clickea post-envío.

### C) SCM backend (index.js / src/wa)
1. **Endpoint cuentas del user** para el popover: ya existe `GET /api/wa/accounts` (filtra por setter). Confirmar que devuelve `{id, label, phone, status}`. El frontend lo usa para armar el popover.
2. **Recibir `lead:contacted` por socket** (gateway WA): registrar en el lead → `lead.contactedFromAccountId`, `lead.contactedFromPhone`, `lead.contactedAt` + entry en `lead.interactions[]` con `{action:'wa_sent', via:'wamulti', accountId, fromPhone, ts}`. Cruza módulos (gateway WA → setters.json) — usar mutateSettersData.

### D) SCM frontend (public/app.js)
1. Solo para admin/setter_ignacio: el botón 💬 abre un **popover** con las cuentas activas (de `/api/wa/accounts`).
2. Click en cuenta → `window.location.href = 'wamulti://send?phone=...&text=...&accountId=...&leadId=...'` (dispara el protocolo, Windows abre WAMULTI).
3. Chip en la card del lead: "📤 Contactado desde <label> · <hora>" cuando `lead.contactedAt` existe.

## Checklist de la sesión conjunta (build + test)

- [ ] Paso 0 (ya hecho): cuentas reasignadas a setter_ignacio.
- [ ] Test baseline: programar follow-up a 3min con WAMULTI v0.5.7 abierto → confirmar que se manda solo. Valida el pipeline antes de tocar nada.
- [ ] Build v0.5.8: extraer asar → aplicar cambios A+B → repack → build portable en versiones/ (NO tocar v0.5.7).
- [ ] User abre v0.5.8, conecta sus 2 cuentas.
- [ ] Test abrir chat: click botón en SCM → elegir cuenta A → confirmar abre WAMULTI cuenta A con texto precargado. Repetir cuenta B.
- [ ] Test tracking: enviar el mensaje a mano → confirmar que el lead queda con `contactedFromPhone` = número de la cuenta elegida.
- [ ] Si observer de envío falla → activar Plan B (botón manual "Le escribí").
- [ ] Backup de app.asar v0.5.7 en backups/ antes de reemplazar.

## Riesgos
- **Selectores DOM de WhatsApp Web** (observer de envío): frágil, requiere test real. Plan B listo.
- **Protocolo en Windows**: el registro del custom protocol con app portable (no instalada) puede necesitar que el .exe se registre manualmente la primera vez. Verificar.
- **Repack del asar**: siempre backup antes. v0.5.7 queda como fallback.

## Addendum 2026-06-01 — Paste-as-human NATIVO en WAMULTI

Problema reportado: al pegar en WAMULTI un texto copiado con el botón "pegar
como humano" del panel SCM, aparecía el marcador literal `__SCM_TYPE__:` porque
WAMULTI (Electron) no tiene cargada la extensión Chrome `scm-paste-as-human`.

Solución: porté la lógica de la extensión al preload de WAMULTI
(out/preload/whatsapp.js, IIFE initPasteAsHuman). Ahora WAMULTI intercepta el
evento paste en capture phase, detecta el marcador `__SCM_TYPE__:`, lo saca y
tipea humano carácter por carácter (delays variables + thinking pauses + typos
ocasionales, preset velocidad media). Si no hay marcador → paste normal.

Resultado: el user ya NO necesita la extensión Chrome. Copia con "pegar como
humano" desde el SCM y pega directo en WAMULTI — funciona nativo. Aplica tanto
al flujo de respuestas (Asistente/Banco) como a cualquier texto con marcador.

Repackeado en el mismo build v0.5.8.

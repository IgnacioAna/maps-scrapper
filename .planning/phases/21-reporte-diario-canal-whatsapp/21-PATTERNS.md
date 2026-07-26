# Phase 21: Reporte diario + canal WhatsApp - Pattern Map

**Mapped:** 2026-07-26
**Files analyzed:** 9 superficies (index.js ×4 bloques, src/wa/gateway.js, wa-multi desktop ×2 archivos, public/index.html + public/app.js, tests)
**Analogs found:** 9 / 9 (todas tienen analog fuerte en el propio repo — no hay superficie sin precedente)

---

## File Classification

| Archivo a crear/modificar | Rol | Data Flow | Analog más cercano | Calidad de match |
|---|---|---|---|---|
| `index.js` — `buildDailyReportData()` (nuevo) | service/builder | transform (agregación) | `buildWeeklyReportData` — `index.js:1793-1843` | exacto (mismo dominio, misma fase previa) |
| `index.js` — `buildDailyReportText()` (nuevo) | service/builder | transform (texto plano) | `buildWeeklyReportHtml` — `index.js:1845-1851` | rol-match (misma función, formato de salida distinto) |
| `index.js` — `maybeRunDailyReportCron(nowTs, sendFn)` (nuevo) | service/cron | event-driven (scheduled) | `maybeRunWeeklyReportCron` — `index.js:1894-1912` | exacto |
| `index.js` — cola de envío al grupo (nuevo, ej. `reportQueueTick()`) | service/queue | event-driven + retry | `scheduledMessagesTick` — `index.js:5187-5300` | exacto (CONTEXT.md lo pide explícito, sin reusar el módulo) |
| `index.js` / `src/wa/gateway.js` — emisión del comando | service (transporte) | event-driven (socket) | uso de `globalThis.__waGateway.sendToUser` dentro de `scheduledMessagesTick` — `index.js:5268-5279`; helpers en `src/wa/gateway.js:328-348` | exacto |
| `wa-multi/src-v058-work/out/main/index.js` — handler `report:send-message` + envío a grupo (nuevo) | controller/handler (desktop) | event-driven | `sendMessageInWindowInner` (`:707-838`) + handler `followup:send-message` (`:1292-1323`) | exacto (mismo archivo, mismo patrón de socket handler) |
| `wa-multi/src-v058-work/out/preload/whatsapp.js` — picker de grupo + generalización de `unreadChats()` (nuevo) | utility (DOM scraping) | transform (extracción DOM) | `detectors.unreadChats()` (`:275-304`) + `injectSpeedSelector()` (`:549-569`) | rol-match (mismo archivo, patrón de overlay ya probado) |
| `public/index.html` + `public/app.js` — bloque config admin (grupo, pausa, "mandar ahora") | component (admin UI) | request-response | bloque "Preview reporte semanal" / "Enviar reporte ahora" — `index.html:1675-1701` + `app.js:12787-12820` | exacto (mismo dominio: reporte, mismos helpers) |
| `tests/daily-report.test.js` (nuevo) | test | — | `tests/weekly-report.test.js` (completo) + `tests/metrics-consistency.test.js` (setup) | exacto |
| `reports.json` (schema extendido, NO archivo nuevo por decisión) | model/persistencia | file I/O | registro de `reports.json`/`pending_calls.json` en export-data/import-data/seedVolumeFromRepo/BACKUP_FILES/pre-deploy.js | exacto — ya está resuelto, no hay trabajo de registro nuevo si se reusa el archivo |

---

## Pattern Assignments

### 1. `buildDailyReportData()` (nuevo, en `index.js`)

**Analog:** `buildWeeklyReportData` — `index.js:1793-1843`

**Por qué es el analog correcto:** es la MISMA fase de negocio (reporte automático derivado del CALL METRICS CORE), construida en la fase inmediatamente anterior (Phase 19), con el mismo autor y las mismas reglas transversales (visibleSet, ADMIN_ONLY_SETTER_IDS, `_ccCollectCalls`/`_ccFunnelAggregate`, TZ de negocio). El diario es literalmente "la misma función con una ventana `today` en vez de `[lunes, lunes)`".

**Forma a replicar** (`index.js:1793-1843`):
```js
function buildWeeklyReportData() {
  const settersData = loadSettersData();
  // Regla milestone v2.0: solo vendedoras nuevas — Ignacio y Paula (admin-only)
  // fuera de todo reporte. Mismo pseudo-set que usa el supervisor sin lista.
  const visibleSet = _SUPERVISOR_EXCLUSION_SET;
  const calendar = (settersData.calendar || []).filter(e => !ADMIN_ONLY_SETTER_IDS.has(e.setterId));
  // Semana pasada completa (lunes a lunes) en TZ de negocio (audit 2026-07-08).
  const nowTs = Date.now();
  const todayStart = _bizStartOfDay(nowTs);
  const dayOfWeek = _bizDayOfWeek(todayStart) || 7;
  const thisMonday = todayStart - (dayOfWeek - 1) * 86400000;
  const fromTs = thisMonday - 7 * 86400000;
  const toTs = thisMonday;
  // CALL METRICS CORE (regla v2.0): jamás re-implementar el funnel inline.
  const calls = _ccCollectCalls(settersData, { visibleSet });
  const agg = _ccFunnelAggregate(calls, calendar, fromTs, toTs, { visibleSet });
  const weekCalls = calls.filter(c => c.ts >= fromTs && c.ts < toTs);
  ...
  const perSetter = _filterSettersVisible(settersData.setters || [], visibleSet).map(s => {
    const w = weekCalls.filter(c => c.setterId === s.id);
    return {
      name: s.name,
      leadsAsignados: allLeads.filter(l => l.assignedTo === s.id).length,
      llamadas: w.length,
      atendidas: w.filter(c => COLD_CALL_CONNECT_OUTCOMES.has(c.outcome)).length,
      agendadosLlamada: w.filter(c => c.outcome === 'scheduled_with_admin').length,
    };
  }).filter(s => s.llamadas > 0);
  return { period: {...}, calls: {...}, calendar: {...}, perSetter, leadsTotal: allLeads.length };
}
```

**Diferencias que introduce el diario (D-10..D-25), a construir a partir de este esqueleto:**
- Rango: `_ccResolveRange('today')` en vez del cálculo manual de semana (ya existe en el core, `index.js:5804`: `if (p === 'today') return { period: 'today', fromTs: startOfDay, toTs: now };`). NO calcular `todayStart` a mano — usar directamente `globalThis.__callCore._ccResolveRange('today')` o las funciones importadas si están en el mismo módulo.
- `perSetter` acá NO debe filtrar `.filter(s => s.llamadas > 0)` como el semanal — el diario necesita la lista COMPLETA de vendedoras que ya arrancaron (para D-14/D-15/D-16: distinguir "cero llamadas hoy" de "nunca arrancó"). Filtrar en la capa de texto (surface 2), no acá.
- "Nunca arrancó" (D-14/D-15): usar el mismo criterio que `_setterCalledLead`/`_callSetterId` (`index.js:5618-5638`) pero sobre TODO el histórico (`fromTs=0`), no sobre el día: `_ccCollectCalls(settersData, {visibleSet, setterId: s.id})` con `length === 0` en `_ccFunnelAggregate(calls, calendar, 0, Date.now())`, o más barato: recorrer `calls` ya coleccionadas (sin filtrar por rango) y ver si `calls.some(c => c.setterId === s.id)`.
- "Escalada a los 5 días hábiles" (D-16): el analog de "días sin actividad" YA existe en `team-performance` — `index.js:10070-10137` (`lastActivityBySetter` Map + `_bumpActivity` + el cálculo `Math.floor((Date.now() - lastActivity) / 86400000)` en la línea 10130). Replicar ESE patrón (última actividad = max ts de callLog atribuido, sobre TODO el histórico, no solo el día) en vez de escribir lógica de fechas nueva.
- Excepción D-18 ("de licencia"): nuevo campo en el setter (ver surface 7/8) — NO reusar `setter.hidden` (ver `PATCH /api/setters/team/:id`, `index.js:5461-5470`, que solo setea `activeVariantId`/`name`/`hidden`). Agregar un campo análogo (`onLeaveUntil`) al mismo PATCH, filtrando por fecha de vencimiento en el builder (`if (setter.onLeaveUntil && new Date(setter.onLeaveUntil) > now) → línea "de licencia"`).
- D-22 (canal manual sin minutos) y D-23 (llamadas sin marcar): D-23 se lee directo de `pending_calls.json` (`loadPendingCalls()`, `index.js:1771-1779`) filtrando por `createdAt` de hoy y `endedAt === null` — NO sumar esto a `dials` (regla explícita del CONTEXT). D-22 se deriva de `_ccCollectCalls` filtrando `channel !== 'telnyx_webrtc'` dentro del rango de hoy (mismo shape que usa `channel` en `_ccCollectCalls(data, {channel: 'telnyx_webrtc'})`, `index.js:5701`, pero acá se quiere el complemento).

---

### 2. `buildDailyReportText()` (nuevo, texto plano para WhatsApp)

**Analog:** `buildWeeklyReportHtml` — `index.js:1845-1851`

**Por qué:** misma responsabilidad (data → string de salida), mismo punto de inserción en el flujo (`sendWeeklyReport` llama a `buildWeeklyReportHtml(data)` inmediatamente después de `buildWeeklyReportData()`, `index.js:1876-1877`). El formato de salida es TOTALMENTE distinto (texto plano con `*negrita*`/`_cursiva_` de WhatsApp en vez de HTML con tablas), así que el match es de ROL, no de contenido — no copiar el HTML, copiar el LUGAR y la FIRMA.

**Forma a replicar (firma + punto de invocación):**
```js
function buildWeeklyReportHtml(data) {
  const { period, calls, calendar: cal, perSetter, leadsTotal } = data;
  const card = (label, value, color = '#9D85F2') => `...`;
  const rowsSetter = perSetter.map(s => `...`).join('') || `...sin actividad...`;
  return `<!DOCTYPE html>...`;
}
```
El nuevo `buildDailyReportText(data)` debe tener la MISMA firma (recibe el objeto que devuelve el builder de datos, no vuelve a leer disco) y devolver un `string` (no HTML). El molde exacto está en CONTEXT.md D-19/D-20 (validado con datos reales) — no inventar formato, usarlo literal:
```
*Sin actividad hoy: Judith, Teresa*
Reporte diario · mié 22/07

*Brenda* 13 llam · 8 at · 23 min

_Equipo 13 llam · 8 at (62%) · 23 min_
_Ayer 66 llam · 23 at (35%)_
_Sin arrancar: Dalia, Adela, Melissa_
```
Reusar el mismo `card`-style de composición por líneas condicionales que ya usa `buildWeeklyReportHtml` (cada bloque se arma solo si aplica — p.ej. `rowsSetter` cae a un string por defecto si `perSetter` está vacío, línea 1848-1849) para las líneas condicionales del diario (D-21 interesados, D-22 canal manual, D-23 sin marcar, D-25 escalado): construir cada línea como `string | ''` y unirlas con `.filter(Boolean).join('\n')`.

---

### 3. Cron diario — `maybeRunDailyReportCron(nowTs, sendFn)` (nuevo)

**Analog:** `maybeRunWeeklyReportCron` — `index.js:1894-1912`, registrado en `index.js:1913-1916`

**Por qué:** es EXACTAMENTE el patrón pedido por CONTEXT.md ("cron inyectable, testeable sin reloj real") y ya lleva un comentario explícito citando el bug que resolvió (REP-01, el ReferenceError que duplicó 16 mails) — el planner debe evitar ese mismo bug de raíz copiando la firma completa, no solo la idea.

**Forma completa a replicar:**
```js
// nowTs y sendFn son inyectables para los tests (patrón campaignEngineTick, regla #72).
async function maybeRunWeeklyReportCron(nowTs = Date.now(), sendFn = sendWeeklyReport) {
  // Lunes 8am en TZ de negocio (antes era TZ del server = UTC → 5am AR).
  if (_bizDayOfWeek(nowTs) !== 1 || _bizHour(nowTs) < 8) return { ran: false, reason: 'fuera_de_ventana' };
  const state = loadReportsState();
  const last = state.lastWeeklyReportAt ? new Date(state.lastWeeklyReportAt).getTime() : 0;
  if (last && (nowTs - last) < 6 * 24 * 60 * 60 * 1000) return { ran: false, reason: 'ya_enviado' };
  const recipients = _reportRecipients();
  if (!recipients.length) { console.warn('...'); return { ran: false, reason: 'sin_destinatarios' }; }
  const result = await sendFn(recipients);
  if (result.sent) {
    state.lastWeeklyReportAt = new Date(nowTs).toISOString();
    state.lastWeeklyReportTo = recipients;
    saveReportsState(state);
    return { ran: true, sent: true, to: recipients };
  }
  return { ran: true, sent: false, reason: result.reason };
}
if (process.env.NODE_ENV !== 'test') {
  setInterval(() => maybeRunWeeklyReportCron().catch(e => console.warn('weekly cron:', e.message)), 60 * 60 * 1000);
  setTimeout(() => maybeRunWeeklyReportCron().catch(e => console.warn('weekly cron:', e.message)), 60 * 1000);
}
```

**Ajustes para el diario (D-10..D-13):**
- Ventana: `_bizHour(nowTs) === 23` (o `>= 23`, con el mismo guard anti-duplicado por período que evita el bug de los 16 mails — el guard NO debe ser "ya pasaron N horas" sino **"ya se cubrió este período"**, D-28). Guardar `lastDailyReportDate` (string `YYYY-MM-DD` vía `_bizDayStr(nowTs)`, `index.js:5602`) en vez de un timestamp — comparar por STRING de día es más robusto que "hace cuánto" para el guard de D-28.
- D-11/D-12: `_bizDayOfWeek(nowTs)` devuelve 0=domingo..6=sábado (`getUTCDay()`, ver `index.js:5604`). Lunes a viernes = `dow >= 1 && dow <= 5` → SIEMPRE manda. Sábado(6)/domingo(0) → solo manda si `agg.dials > 0` (chequear ANTES de armar el texto completo, evita construir un mensaje que después se descarta).
- D-13: el domingo a las 23:00 el cron del DIARIO debe ceder el paso al SEMANAL (mismo canal, mismo momento — "un solo mensaje" según D-13). Esto probablemente signifique: correr el chequeo semanal PRIMERO en el mismo tick, y si corrió, saltear el diario de ese día (o directamente fusionar: el "semanal corto" reemplaza al diario los domingos). Documentar la decisión exacta que tome el planner — CONTEXT.md deja esto abierto ("el user aún no validó el molde exacto", D-19 nota final).
- Reusar `_reportRecipients()` (`index.js:1855-1868`) NO aplica directo — el diario va a un GRUPO (transporte wa-multi), no a emails. El análogo de "a quién" acá es la config nueva del panel (D-29: `whatsappTransport` en `reports.json`, ver surface 7), no env vars de email.

---

### 4. Cola de envío con retry, consolidación y expiración (nuevo)

**Analog a COPIAR (no reusar el módulo):** `scheduledMessagesTick` completo — `index.js:5127-5306` (helpers `loadScheduledMessages`/`saveScheduledMessages` en `:5127-5156`, `pickStaggerOffset` en `:5160-5162`, `_isSetterReachable` en `:5168-5184`, el tick en `:5187-5300`, registro del `setInterval` en `:5302-5306`).

**Por qué COPIAR y no reusar:** CONTEXT.md lo dice explícito — el módulo existente está atado a `leadId`/`setterId`/`targetPhone` (ver el bloque `emitter(userId, 'followup:send-message', {scheduledMsgId, accountId, targetPhone, text, leadId})`, `index.js:5268-5275`). La cola nueva necesita `queueId`/`kind: 'group'|'dm'`/`groupJid` — shape distinto, mismo ESQUELETO (load/save FIFO, stagger, guard de alcanzabilidad, tick con contador de resultados).

**Forma exacta del load/save con cap FIFO** (`index.js:5127-5156`) — replicar el mismo mecanismo de cap (separar por status, no cortar los `pending`):
```js
const SCHEDULED_FILE = path.join(DATA_DIR, "scheduled_messages.json");
const SCHEDULED_CAP = 5000;
const SCHEDULED_MAX_ATTEMPTS = 288; // 24h * 60min / 5min retry

function loadScheduledMessages() {
  try {
    if (!fs.existsSync(SCHEDULED_FILE)) {
      const seed = { scheduledMessages: [] };
      fs.writeFileSync(SCHEDULED_FILE, JSON.stringify(seed, null, 2), "utf8");
      return seed;
    }
    const raw = JSON.parse(fs.readFileSync(SCHEDULED_FILE, "utf8"));
    if (!Array.isArray(raw.scheduledMessages)) raw.scheduledMessages = [];
    return raw;
  } catch (e) { console.error("[scheduled] load error:", e.message); return { scheduledMessages: [] }; }
}
function saveScheduledMessages(data) {
  try {
    if (Array.isArray(data.scheduledMessages) && data.scheduledMessages.length > SCHEDULED_CAP) {
      const pending = data.scheduledMessages.filter(m => m.status === 'pending');
      const terminal = data.scheduledMessages.filter(m => m.status !== 'pending');
      const trimmed = terminal.slice(-(SCHEDULED_CAP - pending.length));
      data.scheduledMessages = [...pending, ...trimmed];
    }
    fs.writeFileSync(SCHEDULED_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch (e) { console.error("[scheduled] save error:", e.message); }
}
```
Para la cola del reporte, el cap FIFO análogo cubre D-26 (expiración de diarios a 3 días) y D-27 (historial 30 enviados): en vez de un solo cap numérico, dos reglas de retención —`pending`/`sending` viejos de más de 3 días → transicionar a `expired` (D-26); terminales (`sent`/`failed`/`expired`) → conservar los últimos 30 (D-27). Mismo patrón de "separar por status antes de cortar" que la función de arriba.

**Diferencia CLAVE que RESEARCH.md encontró y que el planner NO debe repetir** (`index.js:5279-5282`):
```js
msg.status = 'sent';           // ← optimista, SIN esperar confirmación del desktop
msg.sentAt = new Date().toISOString();
msg.attempts = (msg.attempts || 0) + 1;
sent++; dirty = true;
```
Esto es fire-and-forget — el único feedback que existe hoy (`followup-failed`, emitido por wa-multi en `wa-multi/src-v058-work/out/main/index.js:1316-1320`) llega a `account:event` y termina solo en un log de auditoría (`appendEvent`, nunca correlaciona de vuelta). **La cola nueva NO debe hacer esto**: al emitir, marcar `status = 'sending'` + `sentAtAttempt`/timeout, y transicionar a `'sent'`/`'failed'` recién cuando llegue el evento de vuelta `report:send-result` (ver surface 5/6) O venza el timeout (recomendado 45-60s por RESEARCH.md Q5). Ese es el ÚNICO cambio estructural respecto al esqueleto de `scheduledMessagesTick` — todo lo demás (stagger, guard de alcanzabilidad, reintentos con backoff, cap) se copia igual.

**Guard de alcanzabilidad a replicar** (`index.js:5168-5184`, patrón `_isSetterReachable`):
```js
function _isSetterReachable(setterId, authDataIn) {
  if (!setterId) return false;
  const authData = authDataIn || loadAuthData();
  const user = (authData.users || []).find(u => u.setterId === setterId || u.id === setterId);
  if (!user) return false;
  const presence = onlinePresence.get(user.id);
  if (presence && (Date.now() - presence.lastSeen) < 5 * 60 * 1000) return true;
  if (globalThis.__waGateway && typeof globalThis.__waGateway.isUserConnected === 'function') {
    return globalThis.__waGateway.isUserConnected(user.id);
  }
  return false;
}
```
Para el reporte, el "reachable" es más simple (un solo user dueño de la cuenta dedicada, no un setter con lead) — se reduce a `globalThis.__waGateway.isUserConnected(userId)` directo (=`isUserOnline`, `src/wa/gateway.js:328-331`). RESEARCH.md (REP-07/L4) marca la limitación: esto solo confirma que el SOCKET está conectado, NO que la cuenta de WhatsApp dedicada esté `CONNECTED` — ese segundo chequeo (vía `account.status`) debe ir en el DESKTOP (fail-fast, surface 6), no acá.

**Registro del tick** (patrón a copiar, `index.js:5302-5306`):
```js
if (process.env.NODE_ENV !== 'test') {
  setInterval(scheduledMessagesTick, 60 * 1000);
  setTimeout(scheduledMessagesTick, 5000);
}
```

---

### 5. Emisión server → desktop (Socket.io)

**Analog:** el propio `scheduledMessagesTick` mostrando CÓMO se llama a `sendToUser` (`index.js:5252-5279`) + los helpers en `src/wa/gateway.js:328-348`.

**Forma exacta del helper de transporte** (`src/wa/gateway.js:328-348`):
```js
export function isUserOnline(userId) {
  const p = presence.get(userId);
  return !!(p && p.sockets.size > 0);
}
export function sendToUser(userId, event, payload) {
  if (!io) return false; // en tests / sin WS, los comandos se aceptan pero no se despachan
  io.to(`user:${userId}`).emit(event, payload);
  return true;
}
export function exposeGlobals() {
  globalThis.__waGateway = { sendToUser, isUserConnected: isUserOnline, getPresenceList };
}
```

**Forma exacta de la emisión desde el tick** (`index.js:5268-5279`):
```js
const emitter = globalThis.__waGateway && globalThis.__waGateway.sendToUser;
const user = (authData.users || []).find(u => u.setterId === msg.setterId);
const userId = user?.id;
...
if (emitter) {
  emitter(userId, 'followup:send-message', {
    scheduledMsgId: msg.id,
    accountId: msg.setterPhoneId || null,
    targetPhone,
    text: msg.message,
    leadId: msg.leadId,
  });
} else {
  console.warn('[scheduled] wa gateway no disponible — msg marcado sent pero NO se envio');
}
```

**Evento nuevo a emitir (contrato definido en RESEARCH.md Q5, NO diseñar de nuevo):**
```js
emitter(userId, 'report:send-message', {
  queueId,                // clave de correlación — NUEVO, no existe en el patrón viejo
  accountId,              // cuenta wa-multi dedicada
  text,                   // mensaje ya armado (buildDailyReportText output)
  target: { kind: 'group', groupName, groupJid },  // kind:'dm' para el fallback D-02
  dmFallback: [tel1, tel2, tel3],
});
```
**Recibir el evento de vuelta** (contrato NUEVO, `report:send-result`) requiere un handler en el server análogo a como `account:event`/`lead:contacted`/`wamulti:file-result` ya se reciben en `src/wa/gateway.js` (ver bloque `socket.on("wamulti:file-result", ...)`, `src/wa/gateway.js:275-282`, y `socket.on("lead:contacted", ...)`, `:287-307`) — mismo patrón: `socket.on('report:send-result', (payload) => { ... correlacionar por queueId contra la cola nueva ... })`, agregado dentro de `mountWaSocket`/el bloque de listeners de `gateway.js` (junto a los otros `socket.on`).

**Por qué NO usar acks nativos de Socket.IO** (documentado en RESEARCH.md, aplica directo): `sendToUser` hace `io.to(room).emit(...)` (broadcast a room), y los acks de Socket.IO (`emit(event, payload, cb)`) solo funcionan en emits directos socket-a-socket. Por eso el patrón correcto es un evento de vuelta separado y correlacionado por id — exactamente lo que ya hace este código para `lead:contacted`/`wamulti:file-result`, no una preferencia nueva.

---

### 6. Handler de envío en el desktop (wa-multi)

**Analogs (mismo archivo `wa-multi/src-v058-work/out/main/index.js`):**
- `sendMessageInWindowInner(account, phone, text, emitEvent)` — `:707-838`: el pipeline COMPLETO reusable tal cual desde el paso 4 en adelante (esperar composer, click, `osTypeText`, click en enviar) — el ÚNICO paso phone-específico es el `loadURL('...?phone=' + cleanPhone)` en la línea `:736-743`.
- Handler de socket `followup:send-message` — `:1292-1323`: patrón exacto de cómo cablear un evento nuevo del server (resolver cuenta, notify, try/catch con reporte de fallo).
- `sendReplyInActiveChat(account, text)` — `:839-862`: prueba en código de que "abrir un chat" y "tipear+enviar" son pasos independientes — el segundo no le importa CÓMO se llegó al chat.

**Forma exacta del handler a copiar como esqueleto** (`:1292-1323`):
```js
socket.on(
  "followup:send-message",
  async (p) => {
    let account = p.accountId ? cachedAccounts.find((a) => a.id === p.accountId) : null;
    if (!account && cachedAccounts.length > 0) account = cachedAccounts[0];
    if (!account) {
      console.warn(`[ws] followup:send-message sin cuenta disponible, msgId=${p.scheduledMsgId}`);
      return;
    }
    console.log(`[ws] followup:send-message msgId=${p.scheduledMsgId} from ${account.label} to ${p.targetPhone}: "${p.text.slice(0, 60)}"`);
    notify("wa-multi · Seguimiento automático", `Mandando a ${p.targetPhone} desde ${account.label}`);
    try {
      const { sendMessageInWindow: sendMessageInWindow2 } = await Promise.resolve().then(() => windowManager);
      await sendMessageInWindow2(account, p.targetPhone, p.text, (accId, type, payload) => {
        emitAccountEvent(accId, type, { ...payload || {}, scheduledMsgId: p.scheduledMsgId, leadId: p.leadId, isFollowup: true });
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      emitAccountEvent(account.id, "followup-failed", { scheduledMsgId: p.scheduledMsgId, leadId: p.leadId, reason: errMsg.slice(0, 200) });
    }
  }
);
```
El handler NUEVO (`report:send-message`) debe ser una función SEPARADA (no reusar `followup:send-message` — está atado a `targetPhone`), pero puede reusar `sendMessageInWindowInner` PARA el fallback `kind:'dm'` (mismo camino que ya existe: teléfono → `?phone=`). Para `kind:'group'`, reemplazar el paso 3 (`loadURL('...?phone=')`, `:736-743`) por la secuencia de localización de grupo (pin + primera fila de `#pane-side`, ver RESEARCH.md Q2) — los pasos 4-8 (esperar composer, click, `osTypeText`, click enviar, `emitEvent`) se REUSAN sin cambios, ya que `sendReplyInActiveChat` (`:839-862`) prueba que son independientes de cómo se abrió el chat.

**Helpers de bajo nivel 100% reusables sin cambios** (`:188-249`):
```js
async function osClickAt(win, x, y) { ... }   // :188-197
async function osTypeText(win, text) { ... }  // :199-211
async function osPressKey(win, keyCode) { ... } // :212-217
async function getElementCoords(win, jsExpr) { ... } // :218-241
async function bringToFront(win) { ... }       // :242-249
```

**Overlay de setup (picker de grupo) — analog en `wa-multi/src-v058-work/out/preload/whatsapp.js`:**
- `detectors.unreadChats()` (`:275-304`) — generalizar quitando el filtro `if (!badge) continue;` para listar TODAS las filas de `#pane-side`, no solo las con badge de no-leído (cambio mínimo, mismos selectores `[data-testid="cell-frame-container"], div[role="listitem"]` y `span[title]`).
- `injectSpeedSelector()` (`:549-569`) + su hook de inyección (`:590-597`) — patrón exacto para el botón flotante "Configurar grupo de reportes": `document.createElement('div')` + `document.body.appendChild(box)`, reintentado en `DOMContentLoaded` + `setTimeout` a los 3s/8s por si WhatsApp Web tarda en pintar.
- Envío del resultado al main: mismo canal ya usado (`electron.ipcRenderer.send('wa:event', {accountId, type, payload})`, ver `whatsapp.js:255-257` función `send()`), con un `type` nuevo (`'report-group-selected'`), recibido en `ipcMain.on('wa:event', ...)` (`out/main/index.js:268-...`) y reenviado por el socket YA conectado con `socket?.emit('report:group-configured', {...})`.
- JID checksum: formato documentado en el propio código (`whatsapp.js:349-351`, comentario): `data-id` de un mensaje saliente empieza con `true_<chatId>_<msgId>`; leer `document.querySelectorAll('[data-id^="true_"]').length` (mismo selector que `_countOutBubbles()`, `whatsapp.js:359-364`) para el criterio de "el mensaje salió" (Q4 de RESEARCH.md).

---

### 7. Persistencia — `reports.json` (schema extendido, registro en los 4 lugares si se agrega un archivo nuevo)

**Ya resuelto si se reusa `reports.json`:** el archivo YA está registrado en los 4 lugares (regla #21/#128). Nada nuevo que hacer ahí — solo agregar claves al objeto que ya persiste `lastWeeklyReportAt`/`lastWeeklyReportTo`.

**Los 4 lugares, con el excerpt EXACTO por si el planner decide un archivo separado (ej. `report_queue.json`):**

1. **`seedVolumeFromRepo()`** (`index.js:4072-4088`), agregar el nombre de archivo al array:
```js
for (const file of ['history.json', 'auth.json', 'setters.json', 'faqs.json', 'training.json',
  'wa_accounts.json', 'wa_routines.json', 'wa_events.json', 'wa_campaigns.json',
  'scrape_batches.json', 'reports.json', 'pending_calls.json' /* + nuevo archivo acá */]) {
  const volumePath = path.join(DATA_DIR, file);
  const repoPath = path.join(repoData, file);
  if (!fs.existsSync(volumePath) && fs.existsSync(repoPath)) {
    fs.copyFileSync(repoPath, volumePath);
  }
}
```

2. **`BACKUP_FILES`** (`index.js:4133`), agregar al array (usado por `makeBackup()`, cron cada 6hs):
```js
const BACKUP_FILES = ['setters.json', 'auth.json', 'history.json', 'faqs.json', 'training.json',
  'wa_accounts.json', 'wa_routines.json', 'wa_events.json', 'wa_campaigns.json',
  'telnyx_config.json', 'telnyx_events.json', 'call_scripts.json',
  'reports.json', 'pending_calls.json' /* + nuevo archivo acá */];
```

3. **`GET /api/admin/export-data`** (`index.js:2126-2186`), patrón exacto — loader en try/catch + agregar al `res.json({...})`:
```js
let reports = null;
try { reports = loadReportsState(); } catch {}
...
res.json({ ..., reports, /* + nuevoBloque */ });
```

4. **`POST /api/admin/import-data`** (`index.js:2189-2300`), patrón exacto — destructure + validación de shape + persistencia condicional:
```js
const { ..., reports, pending_calls /* + nuevoBloque */ } = req.body || {};
if (reports !== undefined && (!reports || typeof reports !== 'object' || Array.isArray(reports))) {
  errors.push('reports debe ser objeto');
}
...
if (reports) { saveReportsState(reports); restored.push('reports'); }
```

5. **`scripts/pre-deploy.js`** (líneas 173-193), agregar tupla `[key, filename]` al array `extras`:
```js
const extras = [
  ...
  ['reports', 'reports.json'],
  ['pending_calls', 'pending_calls.json'],
  // ['nuevoBloque', 'nuevo_archivo.json'],
];
for (const [key, fname] of extras) { saveFile(fname, data[key]); }
```

**Recomendación explícita (no solo del research, también de las notas de CLAUDE.md #21/#128):** reusar `reports.json` en vez de crear un archivo nuevo evita repetir estos 5 puntos de registro — es la opción de menor riesgo operativo (menos superficie donde un olvido de registro pierde datos en un redeploy).

**Shape propuesto** (de RESEARCH.md Q3, ya validado contra el código — el planner puede ajustar nombres de campo):
```js
reports.json:
{
  lastWeeklyReportAt, lastWeeklyReportTo,     // YA existe (Phase 19)
  whatsappTransport: {
    accountId, groupName, groupJid, jidCapturedAt, pinned
  },
  dailyState: {
    lastDailyReportDate,      // "YYYY-MM-DD" en TZ negocio — guard D-28 por período cubierto
    pendingDays: [],          // días no enviados aún (para la consolidación D-05/D-26)
  },
  queue: [ /* items status: pending|sending|sent|failed|expired, mismo shape que scheduledMessages */ ],
  history: [ /* últimos 30 enviados, D-27 */ ],
}
```

---

### 8. Config admin en el panel

Un UI-SPEC separado cubre el detalle visual — acá solo el analog y los helpers.

**Analog de bloque completo (botones + modal + fetch):** `index.html:1675-1701` (vista `view-system`, sección con `system-report-preview-btn`/`system-report-send-btn` + `report-preview-modal`) + `app.js:12787-12820` (handlers).

**Nota importante de ubicación:** CONTEXT.md dice "Centro de Comando" (`view-command`, `index.html:1844`), pero el analog MÁS cercano por CONTENIDO (reporte semanal, botón "mandar ahora", preview) vive hoy en `view-system` (Sistema), no en `view-command`. El planner debe decidir si el bloque nuevo va en `view-command` (como pide CONTEXT.md) o se agrega junto al existente en `view-system` (como el precedente directo) — ambos son `data-roles="admin"` y usan los mismos helpers.

**Helpers a reusar (ya expuestos globalmente, NO reinventar):**
- `window.showToast(msg, {type, duration})` — definido en `app.js:16034` (hay una segunda definición legacy en `:3835`; usar la de `:16034`, que es la vigente al final del archivo).
- `window.askConfirm(opts)` — modal de confirmación, definido en `app.js:16001-16018`, reemplaza `confirm()` nativo.
- `apiUrl(path)` — wrapper de fetch que agrega `?viewAs=&asSetterId=` cuando corresponde (impersonación); usarlo SIEMPRE en vez de `fetch` crudo (regla reforzada en CLAUDE.md notas #135/#146 — "TODO fetch de una vista visible para supervisor/setter DEBE usar `apiUrl()`").
- Patrón de botón con estado de carga (`app.js:12774-12786`, `system-backup-now-btn`): `btn.disabled = true; btn.textContent = 'Creando...'` → fetch → `btn.textContent = 'Backup creado'` → `setTimeout` de vuelta al label original.

**Cache-buster obligatorio:** cualquier edit a `app.js`/`index.html` requiere bump del cache-buster (actual `v=20260725c` según nota CLAUDE.md — verificar el valor MÁS reciente al momento de implementar, la nota se actualiza en cada sesión).

---

### 9. Tests backend

**Analog principal:** `tests/weekly-report.test.js` (completo, 246 líneas) — mismo dominio exacto (cron inyectable + builder + persistencia round-trip).

**Patrón de setup a copiar literal** (líneas 1-47):
```js
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `daily-report-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-dr@local.test";
process.env.ADMIN_PASSWORD = "drpass1234";
process.env.JWT_SECRET = "test-secret-dr";
process.env.BUSINESS_TZ = "America/Argentina/Buenos_Aires";
process.env.RESEND_API_KEY = "";  // regla #121: NUNCA delete, sí definida-vacía
process.env.REPORT_EMAILS = "";

function pwd(plain) { /* scryptSync, igual que el resto de los tests */ }
fs.writeFileSync(path.join(tmpData, "auth.json"), JSON.stringify({ users: [...], invites: [], sessions: [] }, null, 2));
fs.writeFileSync(path.join(tmpData, "setters.json"), JSON.stringify({ setters: [...], variants: [], leads: {}, calendar: [], sessions: [] }, null, 2));

const { app } = await import("../index.js");  // DESPUÉS de escribir los fixtures
const W = globalThis.__weeklyReport;           // o el nuevo globalThis.__dailyReport
const M = globalThis.__metricsAudit;
```

**Patrón de fake sender inyectado** (líneas 65-71, evita pegarle a Resend/wa-multi real):
```js
const mkSend = (result = { sent: true }) => {
  const calls = [];
  const fn = async (to) => { calls.push(to); return result; };
  fn.calls = calls;
  return fn;
};
```
Para el envío al grupo, el análogo NO es un `sendFn` de email sino un fake de `globalThis.__waGateway.sendToUser` — inyectar/mockear ese objeto antes de correr la cola (mismo espíritu: nunca pegarle a un socket real en tests).

**Casos a replicar del propio archivo** (por nombre de `describe`, adaptando al diario):
- `"cron ... — ventana ... en TZ de negocio"` → ventana 23:00 en vez de lunes 8am; incluir el mismo caso "TZ: medianoche UTC = hora de negocio distinta" (línea 145-152, `MONTZ`).
- `"el bug de los ... mails: primer tick manda, el segundo da ya_enviado"` (líneas 132-143) → replicar el guard por PERÍODO (D-28): dos ticks el mismo día NO duplican.
- `"shape del reporte — sin WSP, sin admin-only"` (líneas 202-225) → agregar aserciones de D-14/D-15/D-16 (nunca-arrancó vs escalada) y D-21/D-22/D-23 (líneas condicionales).
- `"persistencia — round-trip export/import de reports.json"` (líneas 227-245) → mismo test, agregando el bloque `whatsappTransport`/`queue` nuevo.

**Analog de garantía anti-regresión:** `tests/metrics-consistency.test.js` (setup idéntico, líneas 1-90) — el nuevo test de daily report NO necesita reescribir esta suite, pero SÍ debe reusar `globalThis.__callCore._ccResolveRange('today')` en vez de recalcular el rango a mano en el test, para que si el core cambia de semántica el test lo detecte igual que el resto de la app.

**Regla #121 (crítica, ya rota 3 veces históricamente según CLAUDE.md):** `process.env.X_API_KEY = ""`, NUNCA `delete process.env.X_API_KEY` — dotenv repone las borradas en cada `import("../index.js")`.

---

## Shared Patterns

### Atribución de llamadas
**Fuente:** `globalThis.__callCore` (`_ccCollectCalls`, `_ccFunnelAggregate`, `_ccResolveRange`, `_ccFunnelSeries` — `index.js:5833`) + `_callSetterId`/`_buildUserSetterMap`/`_setterCalledLead` (`index.js:5613-5638`, expuestos en `globalThis.__metricsAudit`, `:5640`).
**Aplica a:** `buildDailyReportData`, cualquier cómputo de "nunca llamó"/"última actividad".
**Regla dura:** jamás re-implementar el funnel inline — es exactamente lo que rompió 4 veces antes de la CALL METRICS CORE (comentario en `index.js:5680-5697`).

### TZ de negocio
**Fuente:** `_bizOffsetMs`, `_bizStartOfDay`, `_bizDayStr`, `_bizHour`, `_bizDayOfWeek` — `index.js:5588-5604`.
**Aplica a:** el cron diario (ventana 23:00), el corte "hoy"/"ayer" del builder, el guard D-28 por período (usar `_bizDayStr` como clave de día, no timestamps).

### Alcance de vendedoras (REP-09)
**Fuente:** `ADMIN_ONLY_SETTER_IDS` (`index.js:5649`), `_SUPERVISOR_EXCLUSION_SET` (`:5653`), `_filterSettersVisible` (`:5670-5673`).
**Aplica a:** `buildDailyReportData` — usar el MISMO patrón que `buildWeeklyReportData` (`visibleSet = _SUPERVISOR_EXCLUSION_SET`, filtrar `calendar`/`setters` con él). NO escribir un filtro nuevo.

### Persistencia en los 4 lugares
**Fuente:** ver surface 7 completo arriba.
**Aplica a:** cualquier JSON nuevo que el planner decida crear. Si se reusa `reports.json`, este trabajo ya está hecho.

### Mutex en writes async (regla #19)
**Fuente:** `mutateSettersData` (`index.js:5104-5114`) — patrón de referencia, aunque probablemente NO aplica directo acá: los handlers de `reports.json`/`pending_calls.json` son SÍNCRONOS (`loadReportsState`/`saveReportsState`, sin `await` entre medio, `index.js:1748-1754`), atómicos por el single-thread de Node. Si el builder del diario o el tick de la cola nueva introducen un `await` ENTRE el load y el save (ej. esperar el resultado de `sendFn` antes de persistir el estado), envolver en un mutex nuevo tipo `mutateReportsState` calcado de `mutateSettersData` — NO hacer `loadX() → await algo → saveX()` naive.

### Transporte desktop → server (Socket.io)
**Fuente:** `src/wa/gateway.js:328-360` (`isUserOnline`, `sendToUser`, `exposeGlobals`).
**Aplica a:** surface 4/5. `sendToUser` devuelve `true` con room vacía — NO usarlo como señal de éxito (REP-07); el guard real es `isUserOnline` ANTES de emitir, y el resultado real llega por el evento de vuelta `report:send-result` (surface 5/6).

---

## No hay superficies sin analog

Las 9 superficies de esta fase tienen un analog fuerte (exacto o rol-match) en el propio repo. La única pieza genuinamente NUEVA en términos de MECANISMO (no de patrón) es la localización de un chat de GRUPO en WhatsApp Web (pin + primera fila de `#pane-side`, RESEARCH.md Q2) — pero incluso ahí, los selectores DOM y el pipeline de tipeo/envío posterior son 100% reusables de `sendMessageInWindowInner`/`sendReplyInActiveChat`.

## Metadata

**Archivos leídos para este mapeo:**
- `.planning/phases/21-reporte-diario-canal-whatsapp/21-CONTEXT.md`
- `.planning/phases/21-reporte-diario-canal-whatsapp/21-RESEARCH.md`
- `index.js` (líneas 1700-1960, 2126-2400, 4050-4200, 5080-5310, 5460-5510, 5588-6000, 9700-9730, 10060-10160)
- `src/wa/gateway.js` (líneas 150-360)
- `wa-multi/src-v058-work/out/main/index.js` (líneas 60-460, 605-880, 1210-1420)
- `wa-multi/src-v058-work/out/preload/whatsapp.js` (líneas 255-420, 540-610)
- `public/app.js` (líneas 12760-12834)
- `public/index.html` (líneas 1670-1710, y ubicación de `view-command`)
- `scripts/pre-deploy.js` (líneas 150-215)
- `tests/weekly-report.test.js` (completo)
- `tests/metrics-consistency.test.js` (líneas 1-90)

**Pattern extraction date:** 2026-07-26

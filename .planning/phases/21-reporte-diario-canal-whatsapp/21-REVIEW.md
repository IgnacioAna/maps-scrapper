---
phase: 21-reporte-diario-canal-whatsapp
reviewed: 2026-07-26T20:45:00Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - index.js
  - src/wa/gateway.js
  - public/app.js
  - public/index.html
  - wa-multi/src-v058-work/out/main/index.js
  - wa-multi/src-v058-work/out/preload/whatsapp.js
  - tests/daily-report.test.js
  - tests/report-queue.test.js
  - tests/daily-cron.test.js
findings:
  critical: 3
  warning: 16
  info: 0
  total: 19
status: issues_found
---

# Phase 21: Code Review Report

**Reviewed:** 2026-07-26T20:45:00Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

> Nota de formato: en este documento los caracteres de control se nombran con
> notacion escapada en texto plano (CR-LF, TAB, U+2028, U+2029) — nunca literales.

## Summary

Se revisó el bloque nuevo de `index.js` (builders del diario, cola de envío, crons,
3 endpoints admin), los 2 listeners nuevos de `src/wa/gateway.js`, el panel y el
modal de licencia en `public/{app.js,index.html}`, y las funciones nuevas de los 2
archivos gitignored de `wa-multi/` (`sendReportToGroup*`, `osShiftEnter`, el handler
`report:send-message`, el relay `report-group-selected`, `detectors.allChats` y el
overlay del picker). Las 3 suites nuevas + `weekly-report` + `metrics-consistency`
corren verdes (111/111 verificado en esta revisión).

Lo que está bien y no hace falta re-discutir: cero `setHours(0` /
`toISOString().slice(0,10)` en el código de fechas nuevo (todo por `_biz*`), el funnel
deriva del CORE sin re-implementarse, `ADMIN_ONLY_SETTER_IDS` queda fuera vía
`_SUPERVISOR_EXCLUSION_SET` tanto en llamadas como en la lista de vendedoras, los 3
endpoints son `requireRole('admin')`, el mutex cubre los 2 writers de Phase 19 que
tenían `await` entre load y save, `groupName` se pinta con `textContent` y las filas
del picker se construyen con `createElement`, el cache-buster de `app.js` se bumpeó y
`style.css` no se tocó, y las clases/variables CSS usadas existen todas.

Los hallazgos se concentran en tres zonas:

1. **El guard de alcanzabilidad (REP-07) no distingue el desktop de una pestaña del
   navegador.** El presence del gateway acepta cookie de sesión, y `wa.js` abre un
   socket para CUALQUIER usuario logueado — incluido el admin que es justamente
   `config.transport.userId`. El panel informa "Desktop ahora: conectada" y el chip
   dice "Al día" con la computadora apagada, y la cola emite al vacío quemando el
   presupuesto de reintentos que se separó explícitamente para no quemarlo.
2. **El protocolo de correlación reusa el mismo `queueId` entre intentos**, y el
   desktop deduplica por `queueId` con TTL de 15 min. Un timeout del server (muy
   alcanzable: `enqueueSend` serializa el reporte detrás de cualquier otro envío de
   la cuenta) descarta la confirmación real y termina tipeando el mismo reporte dos
   veces en el grupo — exactamente lo que T-21-14/L1 querían evitar.
3. **El picker asocia el nombre del chat clickeado con el JID de otro chat.** Si el
   user tenía abierto un grupo distinto al elegir, se persiste un `@g.us` equivocado
   y la verificación por JID rechaza para siempre el grupo correcto, con
   `jidCaptured: true` en el panel y sin forma de limpiarlo desde la UI.

## Critical Issues

### CR-01 (BLOCKER): El guard de alcanzabilidad cuenta la pestaña del navegador como "desktop conectado"

**File:** `index.js:2630`, `index.js:2855`, `src/wa/gateway.js:87-99,116-127,352-354`
**Issue:**
`reportQueueTick` decide si emitir con `gw.isUserConnected(t.userId)` y el panel
publica `desktopOnline` con la misma llamada. `isUserConnected` es `isUserOnline`,
que consulta el Map `presence` del gateway — y ese Map se puebla con **cualquier**
socket del user, incluidas las conexiones autenticadas por cookie
(`gateway.js:87-99`, vía 2 del `io.use`). `public/wa.js:1188-1196` arranca solo con un
`setInterval` que espera `window.__CURRENT_USER__` y llama `connectSocket()`
(`wa.js:66`) para **todos** los roles, sin gate de vista ni de rol.
`config.transport.userId` es siempre un admin (lo setea `handleReportGroupConfigured`
con `user.id`), o sea el mismo user que tiene el panel abierto.

Consecuencias, todas contra el objetivo declarado de la fase:

- El panel miente en el único dato que existe para diagnosticar: con wa-multi cerrado
  y el navegador abierto, "Desktop ahora: conectada" y el chip pinta `Al día` (la
  precedencia del chip evalúa `!d.desktopOnline` antes que todo lo demás,
  `public/app.js:10582`).
- `reportQueueTick` pasa el guard, emite `report:send-message` a la room
  `user:<adminId>` donde solo escucha el browser (que no tiene ningún handler), y
  marca el item `sending` (`index.js:2651`). Nadie responde, y a los 150 s el tick lo
  timeoutea e incrementa `sendAttempts` (`index.js:2576,2655`).
- Ese contador es el presupuesto que la decisión 2 de `21-02-SUMMARY.md` separó de
  `attempts` precisamente "para que 20 minutos offline no lo quemen". Con el browser
  abierto se quema igual: ~20 vueltas de 150 s y el reporte queda `failed` definitivo
  aunque el desktop solo estuviera apagado. El caso principal de la fase ("la
  computadora apagada N días") es el que rompe.

El gateway ya sabe distinguirlos: `socket.data.user.source` es `"desktop"` o
`"browser"` (`gateway.js:81,96`), pero `presence` no lo guarda.

**Fix:**
```js
// src/wa/gateway.js - guardar el source en presence
p.sockets.add(socket.id);
if (!p.desktopSockets) p.desktopSockets = new Set();
if (user.source === "desktop") p.desktopSockets.add(socket.id);
// ...en disconnect: p.desktopSockets?.delete(socket.id);

export function isDesktopConnected(userId) {
  const p = presence.get(userId);
  return !!(p && p.desktopSockets && p.desktopSockets.size > 0);
}
// exposeGlobals(): { sendToUser, isUserConnected: isUserOnline, isDesktopConnected, getPresenceList }
```
```js
// index.js:2630 y :2855 - usar el guard especifico, con fallback conservador
const desktopUp = gw && typeof gw.isDesktopConnected === 'function'
  ? gw.isDesktopConnected(t.userId)
  : false;   // sin el helper NO se emite: mejor pending que quemar sendAttempts
```

---

### CR-02 (BLOCKER): El picker guarda el JID de un chat que no es el elegido y rompe el canal para siempre

**File:** `wa-multi/src-v058-work/out/preload/whatsapp.js:678-684,745-749`;
`wa-multi/src-v058-work/out/main/index.js:961-969` (`_reportVerifyChat`);
`index.js:2765-2795` (`handleReportGroupConfigured`)
**Issue:**
`choose(box, name)` combina dos fuentes sin relación:

```js
function choose(box, name) {
  const jid = readOpenChatJid();   // JID del chat ABIERTO ahora mismo
  send("report-group-selected", { groupName: name, groupJid: jid });  // name = fila clickeada
}
```

`readOpenChatJid()` hace `document.querySelector("[data-id]")` y acepta cualquier id
que termine en `@g.us`. El propio comentario dice "El picker NO abre el chat", así que
si el user tiene abierto **otro grupo** cuando clickea la fila del grupo de reportes
(escenario normal: estaba leyendo otro grupo, o abrió uno para verificarlo y después
bajó por la lista), se persiste el JID de ESE otro grupo asociado al nombre del
correcto.

`handleReportGroupConfigured` valida solo el formato del JID (`index.js:2778`) — no que
corresponda al nombre. Después:

- `_reportVerifyChat` (main:961) prioriza el JID cuando existe de los dos lados, así
  que al abrir el grupo CORRECTO devuelve `jid-mismatch`.
- El fallback `search-by-name` abre otra vez el grupo correcto y vuelve a dar
  `jid-mismatch` (main:1070-1072).
- El server marca `failed` y cae al DM (o queda `failed` sin `REPORT_DM_FALLBACK`).
  El canal al grupo queda **muerto de forma permanente y silenciosa**.
- El diagnóstico apunta al lado contrario: el panel muestra `jidCaptured: true`
  (`index.js:2853`) y "Grupo destino: <el nombre correcto>". No hay ningún endpoint
  para limpiar `groupJid` — `PUT /config` solo acepta `paused` y `backupEmails`
  (`index.js:2870-2900`). La única salida es re-usar el picker sin ningún grupo
  abierto, que no está documentado en ninguna parte.

**Fix:** no capturar el JID de un chat que no es el seleccionado.

```js
// preload - solo mandar el JID si el chat abierto ES el elegido
const DIACRITICS_RE = new RegExp('[\\u0300-\\u036f]', 'g');   // mismo rango que _reportNormalizeName
function openChatHeaderName() {
  const h = document.querySelector('#main header span[title]');
  return h ? String(h.getAttribute('title') || h.textContent || '').trim() : '';
}
function choose(box, name) {
  const norm = (s) => String(s || '').normalize('NFD').replace(DIACRITICS_RE, '').toLowerCase().trim();
  const jid = norm(openChatHeaderName()) === norm(name) ? readOpenChatJid() : null;
  send("report-group-selected", { groupName: name, groupJid: jid });
}
```
Y como red de seguridad server-side, permitir des-fijar el JID (p. ej. aceptar
`groupJid: null` explícito en `PUT /api/admin/daily-report/config`, o auto-limpiarlo
tras N `jid-mismatch` consecutivos y volver a la verificación por nombre en vez de
quedar bloqueado para siempre).

---

### CR-03 (BLOCKER): El `queueId` se reusa entre intentos, un timeout descarta la confirmación real y el grupo recibe el reporte dos veces

**File:** `index.js:2568-2578,2651-2659,2685-2686`;
`wa-multi/src-v058-work/out/main/index.js:1522-1528,1659-1662`
**Issue:**
El id del item es el id de correlación y no cambia entre reintentos
(`enqueueReportMessage` lo crea una vez, `index.js:2495`). El desktop deduplica por
`queueId` con TTL de 15 min (`_reportAlreadyHandled`, main:1522) y **no responde nada**
cuando dedupea (main:1659-1662). El server, al vencer `REPORT_SEND_TIMEOUT_MS`
(150 s), vuelve el item a `pending` (`index.js:2568-2578`) y descarta cualquier
resultado posterior con `item_no_en_vuelo` (`index.js:2685-2686`).

Secuencia concreta y realista:

1. El tick emite. En el desktop, `sendReportToGroup` entra a
   `enqueueSend(account.id, ...)` (main:922), que **serializa por cuenta**: si hay un
   `followup:send-message` o una rutina de warming en vuelo, el reporte espera detrás
   sin límite. Basta con eso para pasar los 150 s (el camino "limpio" ya suma ~100 s
   en el peor caso: 5 s de apertura + 4,5 s de reload + 21 s de polling del pane +
   21 s del composer + ~37 s de tipeo letra por letra + verificación).
2. El server timeoutea, marca `pending`, `sendAttempts++`.
3. El desktop termina, el mensaje **sí salió**, y emite
   `report:send-result {ok:true}`. El server lo tira (`item_no_en_vuelo`). Queda un
   reporte entregado registrado como no entregado, y además se confiesa como bache en
   el próximo mensaje (D-05).
4. El tick re-emite el MISMO `queueId`. El desktop dedupea en silencio, nadie
   responde, otro timeout, otro `sendAttempts`. Se repite hasta que expira el TTL de
   15 min.
5. Pasados los 15 min la re-emisión sí se procesa y **el reporte se tipea otra vez en
   el grupo**. Los socios reciben el mismo mensaje duplicado.

Con `REPORT_MAX_ATTEMPTS = 20` el ciclo también puede terminar al revés (item `failed`
sin haberse tipeado nunca de verdad) cuando el motivo es no-accionable: `exception`
(p. ej. `text.length > 4000`, main:1663) y `composer-not-found` se reintentan igual que
un fallo transitorio.

**Fix:** correlacionar por intento, no por item, y reconciliar resultados tardíos.

```js
// index.js - al emitir
it.attemptId = `${it.id}#${(it.sendAttempts || 0) + 1}`;
gw.sendToUser(t.userId, 'report:send-message', { queueId: it.attemptId, /* ... */ });

// al recibir: resolver el item por prefijo del attemptId y ACEPTAR ok:true aunque el
// item ya haya vuelto a 'pending' por timeout (idempotencia real: un ok tardio cierra
// el item en vez de descartarse).
const itemId = queueId.split('#')[0];
const item = _reportFindItem(state, itemId);
if (item && payload.ok === true && item.status !== 'sent') { /* marcar sent */ }
```
Complementos necesarios en el mismo cambio:
- Los reason no-accionables (`composer-not-found`, `exception` por texto largo)
  deberían consumir el presupuesto de golpe o cortar, como ya se hace con
  `account-not-connected` (`index.js:2718-2723`).
- El desktop debería contestar también cuando dedupea
  (`reply(false, null, 'duplicate')`), para que el server no espere 150 s a ciegas.

## Warnings

### WR-01: Off-by-one en la escalada de D-16 (dispara al 6to día hábil, no al 5to)

**File:** `index.js:2126-2127`
**Issue:** `_reportWeekdaysSince(lastTs, nowTs)` cuenta días hábiles **estrictamente
entre** el día de la última llamada y hoy (excluye los dos extremos,
`index.js:2056-2062`). Verificado numéricamente: última llamada lunes 20/07, el lunes
27/07 (5to día hábil consecutivo sin llamar: 21, 22, 23, 24, 27) da `wd = 4` y NO
escala; escala el martes 28/07 con `wd = 5`, que es el 6to día hábil. D-16 dice "a los
5 días hábiles seguidos sin llamar".
**Fix:** contar también el día de hoy como día sin llamar, o bajar el umbral:
```js
const dow = _bizDayOfWeek(nowTs);
const wd = _reportWeekdaysSince(everTs, nowTs) + (dow >= 1 && dow <= 5 ? 1 : 0);
if (wd >= 5) escalated.push(...);
```
(y ajustar el test correspondiente en `tests/daily-report.test.js`).

### WR-02: Un diario en cola entregado días después sigue diciendo "Hoy"

**File:** `index.js:2176-2181`
**Issue:** `buildDailyReportText` arma el encabezado con `*Hoy no llamó nadie*` /
`*Sin actividad hoy: ...*` y el texto se congela al **encolar**. El camino consolidado
usa `buildDailyReportLine` (que sí dice `*jue 24/07*`), pero cuando queda **un solo**
diario pendiente de un día pasado — el caso más frecuente después de un día fallado —
se emite el `text` crudo: "Sin actividad hoy: Judith" arriba de "Reporte diario ·
jue 24/07". El mensaje se contradice justo en el escenario para el que existe la cola.
**Fix:** que la primera línea use el día del reporte, no "hoy":
```js
const dl = d.dayLabel;
const head = d.team.dials === 0
  ? `*${dl}: no llamó nadie*`
  : (d.idleToday.length ? `*Sin actividad ${dl}: ${d.idleToday.join(', ')}*` : `*Todas trabajaron ${dl}*`);
```
o pasar un flag `{ delayed: true }` desde el tick cuando
`item.dayStr !== _bizDayStr(nowTs)`.

### WR-03: El reintento re-emite el mismo `queueId` y el desktop lo dedupea 15 min en silencio

**File:** `wa-multi/src-v058-work/out/main/index.js:1522-1528,1659-1662`, `index.js:2578`
**Issue:** Mismo defecto de raíz que CR-03, pero con impacto propio incluso sin
duplicado: después de **cualquier** fallo reintentable, las siguientes 5-6 vueltas del
tick emiten un `queueId` ya visto, el desktop retorna sin hacer nada ni responder, y el
server las cuenta como emisiones reales (`sendAttempts++`) hasta que expira el TTL. El
reporte queda indisponible ~15 min y se consume ~30% del presupuesto sin que una sola
letra llegue a WhatsApp. En los logs solo se ve `timeout`, sin pista del dedupe.
**Fix:** ver CR-03 (attemptId por intento). Mínimo intermedio: que el desktop responda
`reply(false, method, 'duplicate')` al dedupear, y que el server trate `duplicate` como
"sigue en vuelo" en vez de como emisión consumida.

### WR-04: El lock de "un envío en vuelo" de `send-now` es un TOCTOU (doble POST = doble mensaje al grupo)

**File:** `index.js:2913-2921`
**Issue:** El chequeo se hace con un `loadReportsState()` **fuera** del mutex:
```js
const pre = _reportStateDefaults(loadReportsState());
if ((pre.queue || []).some((i) => i && i.status === 'sending')) { /* busy */ }
```
Dos POST casi simultáneos (doble click que gane la carrera al `disabled`, un retry del
navegador, dos pestañas del panel) leen los dos el mismo snapshot sin `sending`, los
dos encolan un `custom`, y como el tick emite de a uno el segundo sale después: el
grupo recibe el reporte **dos veces**. `21-04-SUMMARY.md` afirma que "la defensa dura
es el lock server-side (T-21-20)" — ese lock no es atómico.
**Fix:** mover el chequeo dentro del mismo `mutateReportsState` que encola:
```js
const enq = await mutateReportsState((s) => {
  const busy = (s.queue || []).some((i) => i && (i.status === 'sending'
    || (i.kind === 'custom' && i.status === 'pending')));
  if (busy) return { queued: false, reason: 'busy' };
  return enqueueReportMessage(s, { kind: 'custom', /* ... */ });
});
if (!enq.queued && enq.reason === 'busy') {
  return res.json({ ok: true, status: 'queued', reason: 'busy' });
}
```

### WR-05: `_reportVerifyChat` acepta coincidencias de nombre por substring en las dos direcciones

**File:** `wa-multi/src-v058-work/out/main/index.js:961-969`
**Issue:** Cuando no hay JID de los dos lados (siempre, hasta el primer envío exitoso,
y para siempre si el picker nunca lo capturó) la verificación es:
```js
if (a && b && (a.includes(b) || b.includes(a))) return { ok: true, reason: null };
```
`b.includes(a)` hace que un chat con header **más corto** que el nombre del grupo
verifique: grupo "Reportes SCM" + un contacto llamado "SCM" da verificado, y el reporte
con nombres y métricas de las vendedoras se tipea en ese chat. No hay mínimo de
longitud ni de similitud, y `handleReportGroupConfigured` acepta `groupName` de 1
carácter (`index.js:2777`). Es la última defensa antes de tipear (T-21-24) y es
demasiado laxa para el dato que transporta. Se agrava con WR-06 (la lista de chats
queda filtrada por una búsqueda anterior, así que `items[0]` puede ser cualquier chat).
**Fix:** exigir igualdad normalizada, y aceptar substring solo con un umbral:
```js
if (a === b) return { ok: true, reason: null };
if (b.length >= 6 && a.includes(b)) return { ok: true, reason: null };  // header con sufijos de WhatsApp
return { ok: false, reason: 'group-not-found' };
```

### WR-06: La caja de búsqueda no se limpia, el mecanismo primario `pinned-row0` queda inutilizado en los envíos siguientes

**File:** `wa-multi/src-v058-work/out/main/index.js:1044-1077,1003-1018`
**Issue:** El fallback `search-by-name` tipea el nombre del grupo en la caja de
búsqueda y nunca la limpia (no hay `Escape` ni click en la "x"). El reset a la lista
completa solo ocurre si en el próximo envío la URL es un deeplink `send?phone=` o no es
`web.whatsapp.com` (main:1010) — pero después de un envío al grupo la URL **es**
`web.whatsapp.com`, así que no se recarga. El siguiente reporte lee `items[0]` de una
lista todavía filtrada: el mecanismo primario documentado (el chat fijado en la fila 0)
deja de aplicar y todo depende del texto residual. Combinado con WR-05, `items[0]`
filtrado por una búsqueda vieja es una vía concreta a verificar el chat equivocado.
**Fix:** limpiar el estado siempre antes de localizar:
```js
// tras usar la busqueda (exito o fallo)
await osPressKey(win, 'Escape');
// o, mas simple, hacer el reload incondicional al empezar:
try { await win.loadURL(WA_URL); } catch { return fail('exception', null, null); }
await sleep(rand$1(3500, 4500));
```

### WR-07: La confirmación de envío cuenta burbujas de TODO el documento y puede dar falso negativo

**File:** `wa-multi/src-v058-work/out/main/index.js:946-948,1085,1134-1148`
**Issue:** `outCount` es `document.querySelectorAll('[data-id^="true_"]').length` (sin
scope a `#main`) y se compara antes/después. La lista de mensajes de WhatsApp Web está
virtualizada: al enviar, el scroll al fondo puede **desmontar** burbujas viejas mientras
monta la nueva, con lo que `after.outCount <= bubblesBefore` aunque el mensaje haya
salido. Eso devuelve `composer-not-found` sobre un envío exitoso, que es el disparador
más probable de CR-03 (reintento y duplicado en el grupo).
**Fix:** scopear al panel del chat y no depender solo del conteo:
```js
const root = document.querySelector('#main') || document;
const outs = root.querySelectorAll('[data-id^="true_"]');
// devolver tambien el data-id de la ultima burbuja: si cambio respecto del previo, salio
return { name, jid, lastOutId: outs[outs.length - 1]?.getAttribute('data-id') || null, outCount: outs.length };
```
comparando `lastOutId` antes/después en vez de (o además de) el conteo.

### WR-08: Los sanitizadores solo quitan CR-LF; TAB, U+2028 y U+2029 llegan al tipeo OS-level

**File:** `index.js:2068-2070`, `index.js:2775` (groupName),
`wa-multi/src-v058-work/out/main/index.js:215-227,1107-1115`
**Issue:** `_reportSafeName` hace `replace(/[\r\n]+/g, ' ')` y corta a 40; el mismo
criterio se aplica a `groupName`. Pero el texto termina en
`sendInputEvent({ type: 'char', keyCode: ch })` por cada carácter, y `split(/\r?\n/)`
no separa U+2028 / U+2029. Un TAB en el nombre de una SDR (o del grupo, que se tipea en
la caja de búsqueda) se envía como `char` de tabulación: Chromium puede tratarlo como
Tab y **mover el foco fuera del composer**, con lo que el resto del mensaje se tipea en
otro elemento y el click al botón de enviar manda un mensaje truncado. El nombre del
setter es texto libre sin ninguna validación: `index.js:6497`
(`if (req.body.name) setter.name = req.body.name;`) no limita longitud ni charset.
**Fix:** whitelist en vez de blacklist, en el único lugar por donde pasan los nombres:
```js
// control chars C0/C1 + separadores de linea Unicode, con el rango escapado
const UNSAFE_RE = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]+', 'g');
function _reportSafeName(name) {
  return String(name || '').replace(UNSAFE_RE, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
}
```
Aplicar el mismo saneo a `groupName` en `handleReportGroupConfigured` y,
defensivamente, en `osTypeText` (saltar cualquier `ch` con code point menor a 0x20).

### WR-09: La authz de `handleReportSendResult` se evalúa dentro del mutex (escritura de disco y log por cada evento rechazado)

**File:** `index.js:2674-2682`
**Issue:** El chequeo de authz está **adentro** del mutator de `mutateReportsState`, y
`mutateReportsState` siempre hace `saveReportsState(_reportPrune(state))` sin importar
el resultado (`index.js:2412-2417`). Cualquier usuario autenticado con un socket
abierto (un SDR con el panel abierto) puede emitir `report:send-result` en loop y
forzar una reescritura completa de `reports.json` más un `console.warn` por evento:
write amplification + flood de logs, y serialización del mutex que comparte con el tick
y los crons. `handleReportGroupConfigured` sí valida antes del mutex
(`index.js:2769-2772`): la asimetría es el bug.
**Fix:** mover el guard afuera y no entrar al mutex:
```js
async function handleReportSendResult(payload = {}, user = null) {
  const queueId = String(payload?.queueId || '');
  if (!queueId) return { ok: false, reason: 'sin_queueId' };
  const t = _reportStateDefaults(loadReportsState()).config.transport;
  if (!(user && (user.role === 'admin' || (t.userId && user.id === t.userId)))) {
    return { ok: false, reason: 'no_autorizado' };   // sin log por evento, sin write
  }
  return mutateReportsState((state) => { /* ... */ });
}
```

### WR-10: `accountId` no valida charset y se interpola en un `console.log` (log forging)

**File:** `index.js:2776,2790`
**Issue:** `groupName` se limpia de saltos de línea y `groupJid` se valida por regex,
pero `accountId` solo se recorta y se chequea longitud (`accountId.length > 64`).
Después se interpola crudo en el `console.log` de "canal configurado". Un `accountId`
con un salto de línea inyecta líneas falsas en los logs de Railway, que son el único
rastro de auditoría de "quién cambió el destino del reporte".
**Fix:**
```js
if (!/^[\w.:-]{1,64}$/.test(accountId)) return { ok: false, reason: 'accountId_invalido' };
```

### WR-11: `data/reports.json` está gitignored, la cadena de persistencia que el comentario afirma no existe

**File:** `index.js:2314-2319`, `.gitignore:12`, `scripts/pre-deploy.js:186`
**Issue:** El comentario del bloque nuevo dice: "`reports.json` ya está registrado en
los 5 lugares ... así que el esquema extendido viaja solo. Un archivo nuevo obligaría a
repetir ese registro y un olvido lo borraría en el próximo redeploy". Es inexacto:
`data/reports.json` está en `.gitignore:12` (bloque "Logs y state local, nunca
commitear"). `pre-deploy` lo baja a disco (línea 186) pero git **nunca** lo lleva, así
que `seedVolumeFromRepo` (`index.js:5114`) no tiene nada que sembrar. Con el volumen de
Railway vivo no se nota; si el volumen se recrea, se pierde silenciosamente
`config.transport` (grupo elegido, userId, accountId) y el reporte deja de salir con el
chip en `Sin configurar`, sin ningún aviso — y recuperarlo exige volver a abrir
wa-multi y re-elegir el grupo. Antes de esta fase el archivo tenía dos timestamps y la
pérdida era irrelevante; ahora es la configuración del canal.
**Fix:** elegir una de las dos y dejarla escrita:
1. Sacar `data/reports.json` del `.gitignore` y stripear `queue`/`history` en
   `scripts/pre-deploy.js` (mismo patrón que los secrets de Telnyx), commiteando solo
   `config` + `dailyState`/`weeklyState`; o
2. Corregir el comentario y aceptar la pérdida explícitamente, dejando en
   `21-CONTEXT.md` / CLAUDE.md la nota "si se recrea el volumen hay que volver a elegir
   el grupo".

### WR-12: El cron semanal inyecta `nowTs` para la ventana pero los datos salen de `Date.now()`

**File:** `index.js:1937,1952`
**Issue:** `maybeRunWeeklyReportCron(nowTs = Date.now())` usa `nowTs` para la ventana
horaria y para `periodKey`, pero `buildWeeklyReportData()` no acepta parámetros y
resuelve la semana con `Date.now()` internamente. El diario sí es inyectable en las dos
dimensiones (`buildDailyReportData(nowTs, dayTs)`), así que el semanal quedó como la
excepción: el `periodKey` y el contenido del mail/mensaje pueden describir semanas
distintas si se inyecta un `nowTs` (backfill, reenvío diferido), y los tests de
`weekly-report` afirman sobre datos del reloj real, no del que inyectan.
**Fix:** propagar el reloj, igual que en el diario:
```js
function buildWeeklyReportData(nowTs = Date.now()) { /* usar nowTs en vez de Date.now() */ }
// ...
const data = buildWeeklyReportData(nowTs);
```

### WR-13: Las filas del picker aceptan clicks sintéticos (JS de la página puede redirigir el destino del reporte)

**File:** `wa-multi/src-v058-work/out/preload/whatsapp.js:736-749`
**Issue:** El overlay se inyecta en el DOM de la página y sus handlers son closures del
preload que llaman `send('report-group-selected', ...)`, que va a `ipcMain('wa:event')`
y de ahí a `socket.emit('report:group-configured')`. Cualquier script que corra en el
contexto de la página (WhatsApp Web mismo, o una inyección en él) puede hacer
`document.querySelectorAll('#scm-report-group-picker button')[i].click()` y, como los
nombres de la lista salen del DOM que ese mismo script controla, fijar un `groupName`
arbitrario como destino del reporte. A diferencia de los overlays preexistentes
(selector de velocidad, badge de actividad), este control **cambia a dónde se manda
data nominal de empleadas**.
**Fix:** exigir un evento de usuario real:
```js
row.addEventListener("click", (ev) => { if (!ev.isTrusted) return; choose(box, c.name); });
```
(idem en `mkButton`/`mkClose` y en el botón colapsado).

### WR-14: `allChats()` corta en 40 y solo ve las filas renderizadas (el grupo puede ser inseleccionable)

**File:** `wa-multi/src-v058-work/out/preload/whatsapp.js:308-320,730-734`
**Issue:** La lista de chats de WhatsApp Web está virtualizada: solo hay ~15-25 filas en
el DOM. Si el grupo de reportes no está cerca del tope (cuenta nueva con varios chats,
o el grupo no es el más reciente), no aparece en el picker y no hay forma de elegirlo.
El mensaje del caso vacío ("Abrí la lista de chats de WhatsApp y probá de nuevo") no
menciona scrollear, y el caso "lista corta que no incluye el grupo" no tiene copy
ninguno. El campo `index` que devuelve `allChats()` además no se usa en ningún lado.
**Fix:** decirle al user qué hacer y dar una vía alternativa:
```js
const foot = document.createElement("div");
foot.textContent = "No lo ves? Scrolleá la lista de chats de WhatsApp (o buscá el grupo) y volvé a abrir esto.";
list.appendChild(foot);
```
y borrar `index` de `allChats()` (dead field) o usarlo.

### WR-15: La vigencia del badge de licencia se compara en la zona del navegador, no en `BUSINESS_TZ`

**File:** `public/app.js:15174-15176`
**Issue:** El comentario afirma "La vigencia se compara como STRING de día, igual que el
backend (`_reportOnLeave`)", pero el día "hoy" se calcula con
`new Date().getTimezoneOffset()` — la zona del **navegador**, mientras el backend usa
`BUSINESS_TZ` (`_bizDayStr`). Para un admin con la máquina en otra zona (viaje, TZ del
SO mal configurada) el badge puede desaparecer o aparecer un día antes/después que el
criterio del reporte, que es exactamente la incoherencia panel-vs-reporte que el
auto-fix #2 de `21-04-SUMMARY.md` decía cerrar.
**Fix:** que el backend mande el booleano ya resuelto junto a `leaveUntil` en
`perSetter` de `team-performance`, y que el frontend solo lo pinte:
```js
// index.js (team-performance perSetter)
leaveUntil: s.leaveUntil || null,
onLeave: _reportOnLeave(s, Date.now()),
// public/app.js
const onLeave = !!s.onLeave;
```

### WR-16: `neverStarted` de `buildConsolidatedReportText` nunca se pasa, y el DM confiesa el bache que él mismo entrega

**File:** `index.js:2229-2234,2614`; `index.js:2597-2612,2704-2716`
**Issue:** Dos incoherencias de contenido, menores pero visibles para los socios:
1. `buildConsolidatedReportText(lines, { gapNote, neverStarted })` acepta `neverStarted`
   y ningún llamador lo pasa (`index.js:2614` solo manda `gapNote`), así que el mensaje
   consolidado pierde la línea de D-15. Parámetro muerto que sugiere una cobertura que
   no existe.
2. En el camino de `group-not-found`, el item padre se marca `failed` y se encolan los
   DM con `text: item.lastText`. Cuando el tick emite cada DM, `_reportGapNote` ya ve al
   padre como bache no confesado, así que el DM sale con "_No pude enviar el reporte de
   jue 24/07._" **arriba del reporte de jue 24/07 que está entregando**.
**Fix:** pasar `neverStarted` en el camino consolidado (sale de
`buildDailyReportData(...).neverStarted` del día más reciente, o guardarlo en el item al
encolar), y excluir del `gapNote` los baches cuyo `parentId`/`periodKey` coincide con el
item que se está emitiendo:
```js
const gapNote = _reportGapNote(state, nowTs, { skipIds: [first.id, first.parentId].filter(Boolean) });
```

---

_Reviewed: 2026-07-26T20:45:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

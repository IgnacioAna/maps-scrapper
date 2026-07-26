---
phase: 21-reporte-diario-canal-whatsapp
plan: 05
subsystem: infra
tags: [wa-multi, electron, whatsapp-web, dom-scraping, socket.io, transporte]

# Dependency graph
requires:
  - phase: 08-anti-deteccion-proxy-fingerprint
    provides: "out/ como source editable del desktop (NUNCA npm run build) + patrón de repack del app.asar"
provides:
  - "sendReportToGroup(account, text, target) — envío a un chat de GRUPO de WhatsApp desde wa-multi"
  - "sendReportToGroupInner — localiza (pinned-row0 / search-by-name), VERIFICA header+JID antes de tipear y confirma el envío contando burbujas salientes"
  - "socket.on('report:send-message') — comando genérico server → desktop (D-06), con dedupe por queueId"
  - "socket.emit('report:send-result', {queueId, ok, method, reason, matchedName, matchedJid, sentAt}) — resultado correlacionado"
  - "socket.emit('report:group-configured') — relay del picker de setup (wa:event 'report-group-selected')"
  - "osShiftEnter — salto de línea dentro del composer sin disparar el envío"
  - "auto-apertura de la cuenta al bootear cuando hay UNA sola (L2)"
affects: [21-02 cola de envío server-side, 21-06 picker del preload + repack v0.5.11, 21-07 prueba en vivo, 23 alertas por excepción]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "localización de chat por UI (fila fijada) + checksum de identidad (header/JID) ANTES de tipear"
    - "resultado del desktop correlacionado por queueId (los acks de Socket.IO no funcionan con io.to(room).emit)"
    - "dedupe en memoria por queueId con TTL — defensa contra broadcast a room y reconexión"

key-files:
  created: []
  modified:
    - wa-multi/src-v058-work/out/main/index.js

key-decisions:
  - "El fallback de búsqueda por nombre también se prueba cuando la fila fijada da jid-mismatch (el research §Q2 describe exactamente ese caso: 'si el pin se rompe'); nunca se tipea en un chat sin verificar"
  - "Los saltos de línea del reporte van con Shift+Enter: un '\\n' tipeado como char en WhatsApp Web dispara el ENVÍO y partiría el mensaje en N pedazos"
  - "El envío al grupo NO consume el cap diario de 80 (DAILY_SEND_CAP): es un grupo propio, no outreach frío"
  - "Los 2 commits de tareas son --allow-empty: wa-multi/ está gitignored en este repo (.gitignore:32, 0 archivos trackeados históricamente)"

patterns-established:
  - "Todo comando nuevo del server que haga TIPEAR al desktop valida el payload antes de ejecutar (T-21-23) y responde SIEMPRE, con reason específico"
  - "Los reason codes son un contrato cerrado: account-not-connected | group-not-found | jid-mismatch | composer-not-found | not-on-whatsapp | exception"

# REP-06 lo comparten 5 planes (21-02 cola, 21-04 panel, 21-05 transporte,
# 21-06 picker+repack, 21-07 prueba en vivo). Este plan entrega SOLO la parte
# de transporte del desktop: no se marca completo hasta que el mensaje llegue
# al grupo de verdad (21-07).
requirements-completed: []

# Metrics
duration: 12min
completed: 2026-07-26
---

# Phase 21 Plan 05: Transporte a grupo en wa-multi Summary

**El desktop ya sabe mandar a un chat de GRUPO: abre la fila fijada de `#pane-side` (o busca por nombre), verifica el header y el JID del chat abierto ANTES de tipear una letra, tipea el reporte multilínea como humano con Shift+Enter y confirma el envío contando burbujas salientes — devolviendo al server un resultado correlacionado por `queueId` con motivo específico.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-07-26T21:20Z
- **Completed:** 2026-07-26T21:35Z
- **Tasks:** 2
- **Files modified:** 1 (`wa-multi/src-v058-work/out/main/index.js`)

## Accomplishments

- `sendReportToGroup` / `sendReportToGroupInner`: el ÚNICO camino del sistema que puede hablar con WhatsApp ahora cubre grupos, no solo el deeplink `?phone=`. Nunca lanza; devuelve `{ok, method, reason, matchedName, matchedJid}`.
- Verificación obligatoria antes de escribir (T-21-24): si el chat abierto no es el grupo, aborta con `group-not-found`/`jid-mismatch` en vez de escribirle a un desconocido, y el server dispara el fallback por DM (D-02).
- Fail-fast por `account.status !== 'CONNECTED'` (L4): no quema ~21s de polling cuando la cuenta perdió el QR, y el reason permite que el reporte siguiente confiese algo específico (D-05).
- Handler `report:send-message` con dedupe por `queueId` (TTL 15 min): la misma orden recibida dos veces (reconexión del socket, o wa-multi abierto en dos computadoras) manda UNA sola vez.
- Relay `report-group-selected` → `report:group-configured`: el picker del preload (plan 21-06) llega al server por el socket ya conectado, sin ningún endpoint REST nuevo en el desktop.
- Auto-apertura de la cuenta al bootear cuando hay una sola (L2): la ventana está caliente cuando llega el reporte de las 23:00.

## Task Commits

1. **Task 1: sendReportToGroup — localizar el grupo, verificar y tipear** — `6614be4` (feat)
2. **Task 2: handler report:send-message + relay del setup + auto-apertura** — `b3a1f2e` (feat)

**Plan metadata:** ver commit `docs(21-05)` de cierre.

⚠️ Los dos commits de tarea son `--allow-empty` **a propósito** — ver "Deviations".

## Files Created/Modified

- `wa-multi/src-v058-work/out/main/index.js` — todo el plan. Bloques nuevos:
  - `SEARCH_SELECTORS_JS`, `CHAT_LIST_JS`, `CHAT_ROW_SELECTOR` (junto a `COMPOSER_SELECTORS_JS`)
  - `osShiftEnter` (junto a `osPressKey`)
  - tipeo multilínea en `sendMessageInWindowInner` (por donde sale el fallback por DM)
  - `sendReportToGroup`, `sendReportToGroupInner`, `_reportNormalizeName`, `_reportReadOpenChat`, `_reportVerifyChat` (después de `sendReplyInActiveChat`)
  - `sendReportToGroup` exportada en `windowManager`
  - `_reportSeen` / `_reportAlreadyHandled` (arriba de `connectSocket`)
  - `socket.on('report:send-message')` (después de `followup:send-message`)
  - `report-group-selected` en `ipcMain.on('wa:event')`
  - auto-apertura al final de `bootSessionFromStore`

**NO se corrió ningún build**: `out/` ES el source de ese proyecto (CLAUDE.md #68). El resto de `out/` quedó intacto.

## Contrato de eventos (para el plan 21-02)

```js
// server → desktop
socket.emit('report:send-message', {
  queueId,            // string, <=80 chars, OBLIGATORIO (clave de dedupe y correlación)
  accountId,          // opcional: si falta, usa la primera cuenta cacheada
  text,               // 1..4000 chars, multilínea OK
  target: { kind: 'group', groupName, groupJid }   //  | { kind: 'dm', phone }
});

// desktop → server (SIEMPRE llega, salvo payload sin queueId o duplicado)
socket.on('report:send-result', ({
  queueId, accountId, ok,
  method,   // 'pinned-row0' | 'search-by-name' | 'dm' | null
  reason,   // null | 'account-not-connected' | 'group-not-found' | 'jid-mismatch'
            // | 'composer-not-found' | 'exception'
  matchedName, matchedJid, sentAt
}));

// desktop → server (setup, plan 21-06)
socket.on('report:group-configured', ({ accountId, groupName, groupJid }));
```

Notas para el server:
- **Un payload sin `queueId`, o con un `queueId` ya visto, NO responde nada** (dedupe silencioso). El timeout de la cola (45-60s) es el que resuelve esos casos.
- `matchedJid` viene del `data-id` de la última burbuja saliente: sirve para **backfillear `groupJid`** en el primer envío real (hasta ahí la verificación es solo por nombre).
- `reason: 'jid-mismatch'` significa que el chat abierto NO es el grupo configurado: el pin se rompió o el JID persistido quedó viejo. Es un caso de fallback a DM + aviso, no de reintento infinito.

## Decisions Made

- **El fallback de búsqueda se prueba también ante `jid-mismatch` de la fila 0.** El PLAN decía abortar directo; el research §Q2 describe el fallback justamente para "si el pin se rompe (…o aparece otro chat fijado por encima)", que es exactamente lo que produce ese mismatch. Se prueba la búsqueda y, si tampoco verifica, se devuelve el reason de la última verificación. La garantía de seguridad (nunca tipear en un chat sin verificar) se mantiene intacta.
- **El envío al grupo no toca `DAILY_SEND_CAP` ni los contadores de warming** — es un grupo propio (D-06 / discreción del CONTEXT), no outreach frío. `enqueueSend` sí se respeta (serializa por cuenta, L6).
- **`_reportVerifyChat` compara por JID solo si existe de los dos lados**; si el grupo todavía no tiene JID persistido (o el chat no tiene mensajes), cae a comparación de nombre normalizado (sin acentos, case-insensitive, `includes` en cualquier sentido).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Un reporte multilínea se enviaba partido en N mensajes**

- **Found during:** Task 1 (tipeo del mensaje)
- **Issue:** `osTypeText` manda un evento `char` por letra. El molde D-19 tiene saltos de línea, y un `\n` en el composer de WhatsApp Web **dispara el envío**: el reporte habría salido como 6-8 mensajes sueltos al grupo (o con los saltos perdidos). El plan copiaba los pasos 4-8 de `sendMessageInWindowInner` sin contemplarlo porque los followups existentes son de UNA línea.
- **Fix:** helper `osShiftEnter(win)` (keyDown/keyUp de `Return` con `modifiers:['shift']`) y tipeo línea por línea. El camino de una sola línea queda **idéntico** (`await osTypeText(win, text)`), así que los followups no cambian de comportamiento.
- **Files modified:** `wa-multi/src-v058-work/out/main/index.js` (`osShiftEnter`, `sendReportToGroupInner`, `sendMessageInWindowInner`)
- **Verification:** `node --check` OK; el camino single-line es byte-idéntico al anterior; la rama multilínea solo se activa con `\n` en el texto (hoy imposible en followups).
- **Committed in:** `6614be4`

**2. [Rule 2 - Missing critical functionality] El fallback por DM heredaba el mismo bug**

- **Found during:** Task 2 (rama `kind:'dm'`)
- **Issue:** la rama DM reusa `sendMessageInWindow` (por diseño del plan, D-02), que tipea con `osTypeText(win, text)` — o sea que el reporte por DM también habría salido partido.
- **Fix:** el mismo tratamiento multilínea dentro de `sendMessageInWindowInner`, preservando exactamente la llamada original para mensajes de una línea.
- **Files modified:** `wa-multi/src-v058-work/out/main/index.js`
- **Verification:** `node --check` OK; `grep -c "osTypeText(win, text)"` sigue en 3 (declaración + los dos call sites de una línea).
- **Committed in:** `6614be4`

### Desvíos de proceso (no de código)

**3. [Rule 3 - Blocking] Los commits de tarea no pueden llevar contenido: `wa-multi/` está gitignored**

- **Found during:** Task 1 (commit)
- **Issue:** el criterio de aceptación del plan pedía verificar con `git status --porcelain wa-multi/src-v058-work/out/`, pero **`.gitignore:32` excluye toda la carpeta** (`# Carpeta de assets del desktop WAMULTI — no pertenece a este repo`) y `git ls-files wa-multi/` devuelve 0 archivos: el desktop **nunca** estuvo versionado acá (tampoco en la Phase 8, que lo editó igual).
- **Fix:** se respetó la política del repo (no se forzó `git add -f`, que metería un árbol con binarios y contradice una decisión explícita del user). Las dos tareas se commitearon con `--allow-empty` y el mensaje describe exactamente qué cambió en disco. El artefacto de registro del cambio es el archivo en disco + el repack del plan 21-06.
- **Verification:** `git status --porcelain` limpio (salvo `.claude/worktrees/...`, ajeno a este plan); `node --check` sobre el archivo modificado; los greps de aceptación corridos sobre el archivo real.
- **Committed in:** `6614be4`, `b3a1f2e`

**4. [Info] Dos criterios de aceptación del plan estaban mal calibrados**

- `grep -c "execCommand('insertText'" = 1`: el baseline REAL del archivo ya era **3** (`sendMessageInBackgroundInner:668`, `sendReplyInActiveChat:855`, `sendFileInWindow:967`). La intención — *el envío nuevo NO usa `execCommand`* — se cumple: se agregaron 0.
- `grep -c "text.length > 4000" = 1`: el archivo usa notación de bundler (`4e3`, `5e3`). Se escribió `4000` literal para cumplir el criterio y ganar legibilidad; es el mismo valor.

---

**Total deviations:** 2 auto-fixes de código (Rule 1, Rule 2) + 2 desvíos de proceso documentados (Rule 3 + 1 informativo)
**Impact on plan:** los dos auto-fixes son de correctitud pura sobre la función que este plan entrega (sin ellos el reporte llegaba partido en pedazos al grupo). Cero scope creep: no se tocó ningún handler preexistente más allá del tipeo multilínea, y los 7 handlers de socket existentes quedaron intactos.

## Issues Encountered

- El rango de diacriticos combinantes de _reportNormalizeName quedo primero con los caracteres crudos (invisibles) copiados del PLAN; se reemplazo por el rango escapado en notacion u0300 a u036f para que el archivo sobreviva copias y repacks sin sorpresas.

## Verificación

```
node --check wa-multi/src-v058-work/out/main/index.js   → OK
npm test                                               → 892/892 (64 files) verde
```

Greps de aceptación (todos cumplidos):

| Criterio | Esperado | Real |
|---|---|---|
| `function sendReportToGroup(` + `async function sendReportToGroupInner(` | 2 | 2 |
| `sendReportToGroup` | >=3 | 5 |
| `SEARCH_SELECTORS_JS` | >=2 | 2 |
| reason codes | >=4 | 9 |
| `osTypeText(win, text)` | >=2 | 3 |
| `pane-side` | >=1 | 2 |
| `"report:send-message"` | 1 | 1 |
| `"report:send-result"` | >=1 | 1 |
| `"report:group-configured"` | 1 | 1 |
| `report-group-selected` | 1 | 1 |
| `_reportAlreadyHandled`/`_reportSeen` | >=3 | 6 |
| `text.length > 4000` | 1 | 1 |
| `"followup:send-message"` (intacto) | 1 | 1 |
| `accounts.length === 1` | 1 | 1 |
| build corrido | NO | NO (`out/` sin regenerar) |

Handlers preexistentes verificados presentes: `account:open`, `account:close`, `account:send-message`, `routine:start`, `routine:stop`, `warming:send-message`, `followup:send-message`, `wamulti:test-send-file`.

## Sin verificar en vivo (hereda los Assumptions del research)

Nada de esto se pudo probar sin una sesión real de WhatsApp Web — queda para el plan 21-07 con el user:

- **A1** — que fijar el grupo lo deje SIEMPRE en la fila 0 de `#pane-side`.
- **A2** — que el `data-id` de un mensaje de grupo traiga el chatId `…@g.us` en la build actual.
- **A3** — los `SEARCH_SELECTORS_JS`: **nunca se probaron**, este código jamás había tocado la caja de búsqueda. Si ninguno matchea, el camino falla limpio (`group-not-found`) y el server manda por DM.
- **Shift+Enter** en el composer de WhatsApp Web (comportamiento estándar, pero no verificado con `sendInputEvent`).
- Tiempos reales de cold start (el polling de 30×700ms es el mismo que ya usa el followup).

## User Setup Required

None en este plan. Las acciones del user (número dedicado, grupo cerrado, escanear QR y **fijar el grupo**) siguen bloqueando solo la prueba en vivo (plan 21-07), no la construcción.

## Next Phase Readiness

- **21-02 (cola server-side):** el contrato de eventos está congelado arriba. Emitir con `status:'sending'` + timeout 45-60s; resolver con `report:send-result` por `queueId`; backfillear `groupJid` con `matchedJid`.
- **21-06 (picker + repack):** el main ya escucha `wa:event` con `type:'report-group-selected'` y `payload:{groupName, groupJid}` — al preload solo le falta el overlay y ese `ipcRenderer.send`. El repack de v0.5.10 → v0.5.11 tiene que copiar **este** `out/main/index.js`.
- **Riesgo abierto:** el archivo modificado NO está versionado (gitignored). Hasta que el plan 21-06 lo empaquete en el `app.asar`, el único lugar donde vive es el disco del user.

---
*Phase: 21-reporte-diario-canal-whatsapp*
*Completed: 2026-07-26*

## Self-Check: PASSED

- `wa-multi/src-v058-work/out/main/index.js` — FOUND (modificado; único archivo
  de `out/` con mtime de esta sesión → **ningún build regeneró `out/`**, los
  otros 7 archivos quedaron intactos)
- `.planning/phases/21-reporte-diario-canal-whatsapp/21-05-SUMMARY.md` — FOUND
- commit `6614be4` — FOUND
- commit `b3a1f2e` — FOUND
- `node --check wa-multi/src-v058-work/out/main/index.js` — exit 0
- `npm test` — 892/892 (64 files)

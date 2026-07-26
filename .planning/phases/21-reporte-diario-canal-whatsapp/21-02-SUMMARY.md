---
phase: 21-reporte-diario-canal-whatsapp
plan: 02
subsystem: infra
tags: [cola-persistida, socket.io, whatsapp, mutex, reintentos, consolidacion, authz]

# Dependency graph
requires:
  - phase: 19-encender-reporte-semanal
    provides: "reports.json + loadReportsState/saveReportsState ya registrados en los 5 lugares de persistencia (se extendió el esquema, cero archivos nuevos)"
  - phase: 21-reporte-diario-canal-whatsapp
    provides: "21-01: buildDailyReportLine / buildConsolidatedReportText (el texto que la cola transporta) · 21-05: contrato congelado report:send-message / report:send-result del desktop"
provides:
  - "enqueueReportMessage(state, {...}) — encolado GENÉRICO de cualquier texto (D-06) con guard por período cubierto (D-28)"
  - "reportQueueTick(nowTs) — expira, timeoutea, consolida, antepone la nota de baches, guardea alcanzabilidad y emite UN mensaje por vuelta"
  - "handleReportSendResult / handleReportGroupConfigured — correlación por queueId + authz + backfill del groupJid"
  - "mutateReportsState — mutex de reports.json (regla #19)"
  - "esquema extendido de reports.json: config.transport / config.paused / dailyState / weeklyState / queue / history"
  - "deps.onReportEvent en mountWa + listeners report:send-result y report:group-configured en el gateway"
  - "globalThis.__reportQueue — superficie de test (incluye consts)"
affects: [21-03 cron diario y disparo manual, 21-04 panel de config, 21-06 picker del desktop, 21-07 prueba en vivo, 23 alertas por excepción]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "estado intermedio 'sending' + resultado correlacionado por queueId (NUNCA 'sent' optimista)"
    - "presupuesto de reintentos sobre EMISIONES reales (sendAttempts), separado de las vueltas offline (attempts)"
    - "terminales MIGRAN de queue a history (una sola copia por id) para que el sello confessedAt no se duplique"
    - "authz de eventos de socket en index.js (donde vive el estado), no en el gateway — mismo criterio que lead:contacted"

key-files:
  created:
    - tests/report-queue.test.js
  modified:
    - index.js
    - src/wa/gateway.js

key-decisions:
  - "Los terminales se MUEVEN a history en vez de vivir también en queue: con el item duplicado, marcar confessedAt en una copia y no en la otra repetiría la nota de baches para siempre"
  - "El presupuesto REPORT_MAX_ATTEMPTS cuenta emisiones reales (sendAttempts); las vueltas con el desktop apagado suben attempts pero no lo queman"
  - "config.paused se honra en el tick desde ya (el flag lo declaraba el esquema y nada lo miraba); 21-04 solo cablea la UI"
  - "Los dos writers de reports.json de Phase 19 pasaron al mutex: tenían await entre load y save y habrían pisado la cola"
  - "El fallback por DM reusa el texto REALMENTE emitido (lastText), no el text del item — en el camino consolidado son distintos"

patterns-established:
  - "Cola de mensajes al grupo: enqueue → tick (1 en vuelo) → sending → resultado por queueId → sent/failed/pending. Toda feature que quiera mandar algo al grupo llama a enqueueReportMessage y no toca el transporte"
  - "Los caps se aplican separando por status ANTES de cortar (calcado de saveScheduledMessages): un recorte nunca descarta pendientes"
  - "Tests de la cola sin fake timers ni sockets: nowTs inyectado + gateway doble que captura lo emitido"

requirements-completed: []   # REP-06/07/08 los comparte con 21-03/04/06/07: no se marcan hasta que el mensaje llegue al grupo real (21-07)

# Metrics
duration: 11min
completed: 2026-07-26
---

# Phase 21 Plan 02: Cola de envío al grupo de WhatsApp Summary

**El transporte ya funciona de punta a punta del lado server: cualquier texto se encola en `reports.json`, sale UNO por vuelta solo si el desktop está conectado, queda en `sending` hasta que llega el resultado correlacionado por `queueId`, y si nada llega en 2,5 min reintenta — con N diarios apilados saliendo en un único mensaje consolidado y una confesión inline de los días que no se pudieron enviar.**

## Performance

- **Duration:** ~11 min
- **Started:** 2026-07-26T21:44:17Z
- **Completed:** 2026-07-26T21:54:58Z
- **Tasks:** 3/3
- **Files modified:** 3 (1 creado, 2 modificados)

## Accomplishments

- **Se eliminó el `sent` optimista del analog.** `scheduledMessagesTick` marca `status='sent'` en el mismo instante en que emite, sin esperar nada (T-21-09: hoy es imposible saber si un followup salió). Acá el item queda en `sending` y solo pasa a `sent` cuando el desktop confirma con el mismo `queueId`. **Verificado por mutación**: cambiar `'sending'` por `'sent'` en el tick rompe 10 de los 26 tests nuevos.
- **El guard de alcanzabilidad corre ANTES de emitir (REP-07)** y `sendToUser` no se usa como señal de éxito en ningún punto — devuelve `true` con la room vacía. Sin gateway, con el desktop offline o sin grupo configurado, el item queda `pending` y reintenta; nunca se pierde ni se marca entregado.
- **Consolidación real (D-26):** 3 diarios pendientes producen UN solo `report:send-message` con `*Reporte acumulado · 3 días*` y una línea por día; los hermanos se marcan juntos y el `ok` del líder los cierra a los 3. El semanal está excluido explícitamente de la consolidación y de la expiración.
- **La nota de baches (D-05) se aplica a TODO envío**, no solo al consolidado: el caso de estado estable (un solo diario pendiente después de un día fallado) lleva la nota arriba, igual que un `weekly` o un `custom`. Nunca sale duplicada en el camino consolidado, y el sello `confessedAt` se pone recién cuando el envío se confirma — si falla, el próximo intento la vuelve a llevar.
- **Cero archivos JSON nuevos:** todo el estado (config del canal, cola, historial) vive en `reports.json`, que ya estaba registrado en los 5 lugares de persistencia. El round-trip `export-data` → `import-data` del esquema extendido está testeado (regla #21/#128 cubierta sin trabajo nuevo).
- **26 tests nuevos**, suite completa **918/918** (era 892) sin flaky en esta corrida.

## Task Commits

1. **Task 1: esquema de reports.json + helpers de cola con mutex + enqueueReportMessage** — `a0acab2` (feat)
2. **Task 2: reportQueueTick + handlers de resultado + listeners de socket con authz** — `aadc9a1` (feat)
3. **Task 3: tests/report-queue.test.js** — `10f2a4f` (test)

## Files Created/Modified

- `index.js` — sub-bloque `// ── Phase 21: cola de envío al grupo de WhatsApp ──` (después de `globalThis.__dailyReport`): 5 constantes, `_reportStateDefaults`, `_reportPrune`, `mutateReportsState`, `_reportExpireStale`, `_reportGapItems`, `_reportGapNote`, `enqueueReportMessage`, `_reportTransportReady`, `_reportDmFallback`, `_reportFindItem`, `reportQueueTick` (+ registro del `setInterval` de 60s), `handleReportSendResult`, `handleReportGroupConfigured`, `globalThis.__reportQueue`. Además: los 2 writers de `reports.json` de Phase 19 pasaron al mutex, y `onReportEvent` inyectado en `mountWa`.
- `src/wa/gateway.js` — listeners `report:send-result` y `report:group-configured` junto a `lead:contacted`, delegando en `deps.onReportEvent` (la authz vive en index.js).
- `tests/report-queue.test.js` — 26 tests (476 líneas).

## Contrato para los planes siguientes

```js
// 21-03 (cron diario / botón "mandar ahora"):
await mutateReportsState((state) => enqueueReportMessage(state, {
  kind: 'daily',            // 'daily' | 'weekly' | 'custom' | 'dm'
  periodKey: data.dayStr,   // clave del guard D-28 — un período entregado no se re-manda
  dayStr: data.dayStr,      // día en TZ de negocio: alimenta la expiración y la nota de baches
  text: buildDailyReportText(data),
  line: buildDailyReportLine(data),   // lo que usa el consolidado
}));
// → { queued: true, id } | { queued: false, reason: 'periodo_ya_cubierto' | 'texto_vacio' }
await reportQueueTick();    // avanza la cola una vuelta; devuelve { emitted, reason, queueId, text }
```

`reportQueueTick` devuelve `reason` ∈ `envio_en_vuelo | pausado | cola_vacia | sin_grupo | desktop offline | error_de_emision`
— el `send-now` de 21-03 puede pollear buscando su propio `queueId` y distinguir "sigue pending" de "salió".

## Decisiones Tomadas

1. **Los terminales MIGRAN de `queue` a `history`, no viven en las dos listas.** El plan describía la cola conservando "los últimos terminales hasta `REPORT_QUEUE_CAP`" además de moverlos a `history`. Con el mismo item duplicado en dos arrays, marcar `confessedAt` en una copia y no en la otra hace que la nota de baches se repita en cada mensaje para siempre (`_reportGapItems` escanea las dos listas). Se implementó una sola copia por id; `REPORT_QUEUE_CAP` quedó como guard de último recurso contra el crecimiento patológico de pendientes (T-21-10), que recorta solo por encima de 200 items vivos (~7 meses sin poder entregar nada).
2. **`sendAttempts` separado de `attempts`.** El plan usaba un solo contador y lo incrementaba también cuando el desktop está apagado. Con el tick cada 60s, 20 minutos offline habrían agotado `REPORT_MAX_ATTEMPTS`, y el primer fallo real después de reconectar habría sido definitivo — justo en el escenario principal de la fase (desktop apagado N días). `attempts` cuenta todas las vueltas (y sube en el camino offline, como pedía el plan), `sendAttempts` cuenta emisiones reales y es el que gobierna el presupuesto.
3. **`config.paused` se honra desde ya.** El esquema del plan lo declaraba y nada lo leía; el tick devuelve `{emitted:false, reason:'pausado'}` antes de elegir pendiente. 21-04 solo tiene que cablear el interruptor de D-29. Efecto lateral útil: el test de timeout usa `paused:true` para aislar el paso 2 del re-emitido dentro del mismo tick.
4. **El fallback por DM reusa `lastText`, no `text`.** En el camino consolidado el texto emitido (N días + nota) no es el `text` de ningún item. Guardar en el líder lo que realmente se emitió hace que los 3 DMs lleven el mismo mensaje que falló, no el reporte de un solo día.
5. **La nota de baches ignora los items `kind:'dm'`.** Un DM es el respaldo de un item que ya se confiesa por su cuenta; incluirlo nombraría el mismo día varias veces.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] Los dos writers de `reports.json` de Phase 19 podían borrar la cola**

- **Found during:** Task 1 (esquema)
- **Issue:** `maybeRunWeeklyReportCron` y `POST /api/admin/weekly-report/send` hacen `loadReportsState()` → `await sendWeeklyReport(...)` → `saveReportsState(state)`. Mientras Resend responde (cientos de ms, o segundos si hay reintento HTTP), el `reportQueueTick` puede escribir la cola; el save posterior con el snapshot viejo la pisa entera. Antes de este plan el archivo solo tenía dos claves y el riesgo era invisible; el estado que agrega este plan lo convierte en pérdida de reportes (regla #19).
- **Fix:** las dos escrituras pasan por `mutateReportsState`. La lectura del anti-duplicado se dejó afuera a propósito (no necesita atomicidad: el guard es de 6 días).
- **Files modified:** `index.js`
- **Verification:** `npx vitest run tests/weekly-report.test.js` → 12/12 (el test del bug de los 16 mails sigue verde, incluido el caso "fallo de envío NO persiste `lastWeeklyReportAt`").
- **Committed in:** `a0acab2`

**2. [Rule 1 - Bug] La nota de baches se habría repetido para siempre con los terminales duplicados**

- **Found during:** Task 1 (`_reportPrune`)
- **Issue:** ver Decisión 1. El esquema del plan dejaba el mismo item en `queue` y en `history`; `handleReportSendResult` marca `confessedAt` buscando por id y habría sellado una sola de las dos copias, con lo que `_reportGapNote` seguiría viendo el bache sin confesar y lo anunciaría en cada mensaje siguiente.
- **Fix:** `_reportPrune` mueve los terminales (dedupe por id, se conserva la versión más nueva) y la cola queda solo con `pending` + `sending`. `_reportFindItem` busca en las dos listas para que el sellado funcione después de la migración.
- **Files modified:** `index.js`
- **Verification:** test "tras una expiración… sella `confessedAt`" comprueba además que `_reportGapNote` devuelve `''` después del envío exitoso.
- **Committed in:** `a0acab2`

**3. [Rule 2 - Missing critical] El presupuesto de reintentos se consumía con el desktop apagado**

- **Found during:** Task 2 (tick)
- **Issue:** ver Decisión 2.
- **Fix:** `sendAttempts` para emisiones reales; `attempts` sigue subiendo en el camino offline como pedía el plan.
- **Files modified:** `index.js`
- **Verification:** test "desktop offline: pending, attempts sube y sendAttempts NO"; el test de timeout comprueba que el presupuesto sí se agota con emisiones reales.
- **Committed in:** `aadc9a1`

### Desvíos de proceso (no de código)

**4. [Rule 3 - Blocking] La Task 3 estaba marcada `tdd="true"` pero el orden del plan hace imposible el RED**

- **Found during:** Task 3
- **Issue:** el gate RED exige un test que falle antes de la implementación, pero las Tasks 1 y 2 del propio plan entregan la implementación completa y la Task 3 es explícitamente "crear `tests/report-queue.test.js`" con un bloque `<behavior>` de regresión. Escribir los tests antes habría requerido reordenar el plan.
- **Fix:** se ejecutó como task de regresión (commit `test(...)` único) y se sustituyó el valor del gate RED por una **verificación por mutación**: se cambió `it.status = 'sending'` por `'sent'` en el tick, se comprobó que 10 tests fallan, y se revirtió con `git checkout -- index.js`. Eso demuestra lo mismo que el RED (los tests miden el comportamiento, no lo acompañan) sin inventar un orden que el plan no tiene.
- **Verification:** 26/26 con el código sano · 16/26 con la mutación aplicada · `git status` limpio tras revertir.
- **Committed in:** `10f2a4f`

---

**Total deviations:** 3 auto-fixes de código (1 Rule 1, 2 Rule 2) + 1 desvío de proceso documentado
**Impact on plan:** los tres auto-fixes son de correctitud sobre el artefacto que este plan entrega (sin ellos: se pierde la cola en cada mail semanal, la confesión se repite eternamente, y el reporte falla definitivo tras un rato de desktop apagado). Cero scope creep: no se agregó ningún endpoint, ninguna vista, ningún archivo de datos.

## Issues Encountered

- **Dos criterios de aceptación se medían con `grep -A80` desde la declaración del tick**, y la primera versión del tick tenía la marca `status = 'sending'` en la línea 96 — fuera de la ventana. No era un defecto de código sino de densidad de comentarios: se movió el razonamiento largo (por qué el analog está mal, por qué hay dos contadores) al bloque de arriba de la función y se compactaron los comentarios de paso. La marca quedó a 79 líneas y los dos criterios se cumplen. Ningún comportamiento cambió.

## Claves declaradas sin escritor (contrato para 21-03)

`dailyState.lastDailyPeriodKey` y `weeklyState.lastWeeklyPeriodKey` existen en el esquema (los pide el plan) pero **este plan no las escribe**: el guard de D-28 se implementó escaneando `queue` + `history` por `kind`+`periodKey`, que es más fuerte (sobrevive a que se salte un día y no depende de que el cron acierte el orden). Quedan disponibles para el bookkeeping del cron de 21-03 si le sirven; si no las usa, se pueden borrar del normalizador sin tocar nada más.

`config.backupEmails` se persiste y **nadie lo lee**: es D-04 explícito (el email queda cableado y apagado; encenderlo debe ser configuración, no construcción).

## Verificación

```
node --check index.js                → 0
node --check src/wa/gateway.js       → 0
npx vitest run tests/report-queue.test.js tests/daily-report.test.js \
  tests/weekly-report.test.js tests/wa.test.js tests/security-rbac.test.js \
  tests/hardening.test.js            → 218 passed (6 files)
npx vitest run (suite completa)      → 918/918 (65 files)
git diff --stat 1a2231b HEAD         → index.js, src/wa/gateway.js, tests/report-queue.test.js
```

Greps de aceptación:

| Criterio | Esperado | Real |
|---|---|---|
| constantes de la cola | >=8 | 10 |
| `async function mutateReportsState(` | 1 | 1 |
| los 7 helpers de la Task 1 | 7 | 7 |
| `globalThis.__reportQueue` | >=1 | 1 (+`Object.assign` en Task 2) |
| `periodo_ya_cubierto` | >=1 | 1 |
| `async function reportQueueTick(` | 1 | 1 |
| `'report:send-message'` | 1 | 1 |
| `report:send-result` en gateway | >=1 | 2 |
| `report:group-configured` en gateway | >=1 | 2 |
| `onReportEvent` (index + gateway) | >=3 | 5 |
| `status = 'sent'` dentro del tick | 0 | 0 |
| `status = 'sending'` dentro del tick | >=1 | 1 |
| `isUserConnected` antes del emit (-B20) | >=1 | 1 |
| `buildConsolidatedReportText` | >=2 | 3 |
| `_reportGapNote(` dentro del tick, fuera del `if` de consolidación | >=1 | 1 |
| `report_queue.json` / `reports_queue.json` | 0 | 0 |
| `delete process.env` en el test | 0 | 0 |
| `vi.useFakeTimers` en el test | 0 | 0 |
| tests de la cola | >=15 | 26 |

Backend puro: **no se bumpeó cache-buster** (correcto, no se tocó `public/`).

## Cobertura de decisiones y requisitos

| Ítem | Estado |
|---|---|
| REP-06 (transporte server-side) | parte server completa; se marca con el mensaje real al grupo (21-07) |
| REP-07 (guard de alcanzabilidad, sin fallback a email por D-04) | completo |
| REP-08 (cola persistida, éxito/fallo confiable, espaciado, período cubierto) | completo |
| D-02 (fallback por DM orquestado por el server) | completo (los teléfonos se cargan en `REPORT_DM_FALLBACK`) |
| D-05 (confesión de baches en todo envío) | completo |
| D-06 (transporte genérico para Phase 23) | completo |
| D-26 (consolidación + expiración a 3 días, semanal exento) | completo |
| D-27 (historial de 30) · D-28 (guard por período) | completos |
| D-03 (backfill del `groupJid` con `matchedJid`) | completo del lado server |
| D-04 (email cableado y apagado) | `config.backupEmails` persistido, sin lector — por diseño |

## Sin verificar en vivo

- El evento nunca viajó por un socket real: el gateway es un doble en los tests. Lo que sí está verificado es que el payload cumple el contrato congelado de `21-05-SUMMARY.md` campo por campo.
- `REPORT_SEND_TIMEOUT_MS` (150s) es una estimación del cold start de WhatsApp Web + tipeo letra por letra. El primer envío real (21-07) es el que dice si sobra o falta; cambiarlo es una constante.
- La authz de `handleReportSendResult` se probó llamando al handler directamente. El camino completo socket → `deps.onReportEvent` → handler queda cubierto por el wiring (`node --check` + los 152 tests del módulo WA verdes), pero no por un test de socket end-to-end.

## User Setup Required

- **Opcional, para D-02:** `REPORT_DM_FALLBACK` en Railway → Variables, CSV de hasta 5 teléfonos E.164 (los de los 3 socios). Sin esa variable, un `group-not-found` deja el reporte como `failed` y se confiesa en el próximo mensaje, pero no sale por DM.
- Las acciones que ya bloqueaban 21-07 (número dedicado, grupo cerrado, escanear el QR y **fijar el grupo**) siguen igual: no bloquean nada de este plan.

## Next Phase Readiness

- **21-03 (cron diario + "mandar ahora"):** listo. Encolar con `mutateReportsState(s => enqueueReportMessage(s, {...}))` y avanzar con `reportQueueTick()`; los `reason` del tick ya distinguen los casos que el polling del botón necesita mostrar. El disparo manual debe quedar admin-only + one-in-flight (riesgo T-21-04 heredado de 21-01: `buildDailyReportData` recorre leads × callLog).
- **21-04 (panel):** `config.paused` ya se honra; `config.transport` es el objeto a mostrar/editar (`groupName`, `accountId`, `groupJid` de solo lectura + `configuredAt`/`configuredBy` para auditoría). El panel NO debe tocar `queue`/`history`.
- **21-06 (picker + repack):** el server ya escucha `report:group-configured` y persiste el grupo elegido; el desktop solo tiene que emitirlo (el relay ya existe desde 21-05).
- **Riesgo abierto:** con `config.transport.userId` apuntando a un user y wa-multi abierto en dos máquinas de ESE user, `sendToUser` emite a las dos. La defensa es el dedupe por `queueId` del desktop (21-05) más el `item_no_en_vuelo` del server ante el segundo resultado — ambos implementados, ninguno probado con dos máquinas reales.

---
*Phase: 21-reporte-diario-canal-whatsapp*
*Completed: 2026-07-26*

## Self-Check: PASSED

- `index.js` — FOUND (contiene `reportQueueTick`, `enqueueReportMessage`, `globalThis.__reportQueue`, `onReportEvent` en `mountWa`)
- `src/wa/gateway.js` — FOUND (`report:send-result` + `report:group-configured` → `deps.onReportEvent`, 4 ocurrencias)
- `tests/report-queue.test.js` — FOUND (476 líneas, > 220 requeridas; 26 tests)
- `.planning/phases/21-reporte-diario-canal-whatsapp/21-02-SUMMARY.md` — FOUND
- Commits `a0acab2`, `aadc9a1`, `10f2a4f` — FOUND en `git log`
- Key links verificados: `isUserConnected` ✓ (guard antes del emit), `'report:send-message'` ✓, `onReportEvent` ✓ en los dos archivos
- `node --check` de los 2 archivos de código → 0 · suite completa 918/918

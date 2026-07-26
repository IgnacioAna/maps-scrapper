---
phase: 21-reporte-diario-canal-whatsapp
plan: 03
subsystem: reporting
tags: [cron, timezone, reportes, whatsapp, authz, anti-duplicado]

# Dependency graph
requires:
  - phase: 19-encender-reporte-semanal
    provides: "buildWeeklyReportData/Html, _reportRecipients, sendWeeklyReport, maybeRunWeeklyReportCron, reports.json — este plan les cambia la ventana y el anti-duplicado"
  - phase: 21-reporte-diario-canal-whatsapp
    provides: "21-01: buildDailyReportData/Text/Line (el contenido) · 21-02: enqueueReportMessage + reportQueueTick + mutateReportsState (el transporte)"
provides:
  - "maybeRunDailyReportCron(nowTs) — 23:00 hora de negocio, lun-vie siempre, sábado solo con actividad, domingo cede al semanal"
  - "maybeRunWeeklyReportCron reescrito — domingo 23:00, ventana = la semana que TERMINA hoy, guard por período"
  - "buildWeeklyReportTextShort(data, {emailSent}) — molde D-20 para el grupo"
  - "extensión aditiva de buildWeeklyReportData: calls.minutes/interested, perSetter.minutos/interesados, previous, neverStarted"
  - "GET /api/admin/daily-report/status · PUT /config · POST /send-now (admin-only)"
  - "UN solo registro de timers para los dos crons (_reportCrons)"
  - "guards en memoria del período cubierto (_weeklyPeriodSentMem / _dailyPeriodSentMem) + seam de reset para tests"
  - "los 3 hardening del 19-REVIEW: WR-01, WR-02, WR-03"
affects: [21-04 panel de config, 21-07 prueba en vivo, 23 alertas por excepción]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "guard de anti-duplicado por PERÍODO cubierto (clave de día en TZ de negocio) + gemelo en memoria contra fallos de disco"
    - "cron inyectable (nowTs) registrado UNA sola vez para N reportes, en orden de prioridad dentro del mismo tick"
    - "endpoint de acción lenta: encola, avanza la cola en cada vuelta del polling, busca su propio item por id y responde con un status SIEMPRE definido"
    - "techo de espera del request configurable por env (REPORT_SEND_NOW_WAIT_MS) → los tests no necesitan una rama test-only"

key-files:
  created:
    - tests/daily-cron.test.js
  modified:
    - index.js
    - tests/weekly-report.test.js
    - tests/metrics-consistency.test.js

key-decisions:
  - "La pausa frena lo AUTOMÁTICO, no los manuales: el tick sigue emitiendo items kind='custom'/'dm' con config.paused=true, porque si no el botón 'Mandar ahora' quedaba inutilizado justo cuando más se lo necesita (probar el canal antes de reactivar)"
  - "El período semanal se consume SOLO cuando el mail salió: el corto al grupo se encola siempre (D-04) y su unicidad la garantiza el guard de enqueueReportMessage, así que el mail conserva su reintento sin que el grupo reciba dos mensajes"
  - "El encabezado del semanal comprime el mes cuando la semana no lo cruza ('Semana 20–26/07'), como el molde literal que el user validó, en vez del 'DD/MM–DD/MM' que describía el texto del plan"
  - "Semana entera sin llamadas → una línea ('Equipo sin llamadas en la semana'), mismo criterio que D-11 en el diario, en vez de una fila de ceros"
  - "send-now corta la espera en el acto cuando el motivo no se resuelve solo (sin grupo / desktop apagado): esperar los 25s no cambiaría la respuesta"

patterns-established:
  - "Toda métrica nueva del semanal se AGREGA a buildWeeklyReportData; las claves de Phase 19 (totalWeek, answeredWeek, pctAtendidas, leadsAsignados, agendadosLlamada...) son contrato del mail HTML y no se tocan"
  - "Cambiar la redacción del semanal corto = editar buildWeeklyReportTextShort y nada más (igual que buildDailyReportText para el diario)"
  - "Tests de crons: nowTs inyectado + fechas UTC comentadas con su equivalente en hora de negocio + reset del guard en memoria entre bloques"

requirements-completed: []   # REP-05/REP-08 se comparten con 21-04/21-07: no se marcan hasta que el mensaje llegue al grupo real (21-07)

# Metrics
duration: 20min
completed: 2026-07-26
---

# Phase 21 Plan 03: Cron diario + semanal al domingo + endpoints del panel Summary

**El reporte ya sale solo: a las 23:00 hora de negocio el diario se encola con las reglas de día de D-10..D-13, el domingo a la misma hora sale el semanal (mail detallado + corto al grupo) cubriendo la semana que termina ese día, un período cubierto no se vuelve a mandar ni con el disco roto, y el panel tiene sus tres endpoints admin con un "Mandar ahora" que nunca deja la conexión colgada ni suprime el envío automático.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-26T22:20:04Z
- **Completed:** 2026-07-26T22:40:41Z
- **Tasks:** 3/3
- **Files modified:** 4 (1 creado, 3 modificados)

## Accomplishments

- **El automatismo está encendido.** `maybeRunDailyReportCron` + `maybeRunWeeklyReportCron` corren en un único `setInterval` horario, con el semanal primero (el diario se autoexcluye los domingos). Las cuatro reglas de día quedaron cubiertas por tests: lun-vie SIEMPRE aunque el equipo entero esté en cero (el mensaje dice "Hoy no llamó nadie", no seis ceros), sábado solo con actividad (y marcando el período para no recomputar toda la noche), domingo cediendo el lugar al semanal.
- **El semanal se mudó de día y de ventana** (D-13): de "lunes 8am, semana pasada completa" a "domingo 23:00, la semana que TERMINA hoy". Sale por las dos vías en el mismo momento con **un solo snapshot de datos** — el mail HTML y el mensaje del grupo no pueden contar cosas distintas.
- **Los tres warnings del `19-REVIEW.md` cerrados** sobre el código que este plan reescribía igual:
  - **WR-01** (el más grave): probar el envío manual entre miércoles y domingo suprimía SILENCIOSAMENTE el reporte automático. El anti-duplicado pasó de "ventana de 6 días" a guard por período cubierto, y el endpoint manual escribe `lastManualWeeklySendAt` en vez de tocar el guard. Dos tests lo fijan.
  - **WR-02**: `REPORT_EMAILS` mal separada (`;` en vez de `,`) ahora loguea el warning y los destinatarios se deduplican antes de ir a Resend.
  - **WR-03**: guard gemelo en memoria — si el Railway Volume falla un domingo, el proceso no re-manda (el bug de los 16 mails ahora sería contra un grupo de WhatsApp con 3 personas reales).
- **"Mandar ahora" resuelto sin race y sin conexiones colgadas:** encola como `kind:'custom'` (no consume el período del cron ni entra a la consolidación), avanza la cola en CADA vuelta del polling y busca **su propio item por id**; si el motivo no se resuelve solo (sin grupo, desktop apagado) responde en el acto, y ninguna rama puede devolver `status: undefined`.
- **21 tests nuevos** + `tests/weekly-report.test.js` reescrito a la ventana nueva. Suite completa **945/945** (era 918).
- **Verificación por mutación** (el gate RED del TDD no era alcanzable, ver desvío 4): 6 mutaciones en 2 rondas → **7/21 y 14/39 tests rojos**. Los tests miden el comportamiento, no lo acompañan.

## Task Commits

1. **Task 1: semanal al domingo 23:00 + versión corta + WR-01/02/03** — `560c295` (feat)
2. **Task 2: maybeRunDailyReportCron + endpoints admin del panel** — `bf56577` (feat)
3. **Task 3: tests/daily-cron.test.js + adaptación de weekly-report** — `8174fab` (test)

## Files Created/Modified

- `index.js`:
  - `buildWeeklyReportData` — ventana nueva (D-13) + extensión **aditiva** (`calls.minutes`, `calls.interested`, `perSetter.minutos/interesados`, `previous`, `neverStarted`). Ninguna clave de Phase 19 removida ni renombrada.
  - `buildWeeklyReportTextShort` — molde D-20, en el bloque Phase 21 junto a los builders de texto del diario.
  - `maybeRunWeeklyReportCron` — domingo 23:00, guard por período, encola el corto aunque el mail falle.
  - `_reportRecipients` — WR-02 (warn + dedup).
  - `POST /api/admin/weekly-report/send` — WR-01 (`lastManualWeeklySendAt`).
  - `maybeRunDailyReportCron` + `_reportQueueCount` + `_reportPanelStatus` + los 3 endpoints `/api/admin/daily-report/*`.
  - `reportQueueTick` — la pausa dejó de frenar los manuales (ver Decisión 1).
  - `_reportCrons` — único registro de timers de reporte.
  - `globalThis.__weeklyReport` gana `buildWeeklyReportTextShort` y `_resetPeriodMem`; `globalThis.__dailyReport` gana `maybeRunDailyReportCron` y `_reportPanelStatus`.
- `tests/daily-cron.test.js` — 21 tests (426 líneas).
- `tests/weekly-report.test.js` — fixtures y fechas movidas a la ventana nueva + WR-01/WR-02 + molde corto (18 tests, era 12).
- `tests/metrics-consistency.test.js` — A4 adaptado a la ventana nueva + cross-check de `previous` (ver desvío 3).

## Salida real del semanal corto (datos del molde D-20)

```
*Semana 20–26/07*
Equipo 312 llam · 91 at (29%) · 182 min
32 interesados · 0 reuniones agendadas

*Teresa* 165 llam · 38 at · 70 min · 11 int
*Brenda* 74 llam · 24 at · 70 min · 14 int
*Judith* 73 llam · 29 at · 42 min · 7 int

_Semana anterior: 70 llam · 25 at (36%) · 8 int_
_Sin arrancar: Dalia, Adela, Melissa_
_Detalle completo en el mail._
```

Coincide línea por línea con D-20 (incluido el orden desc por llamadas). Sin `emailSent`, la última línea no aparece.

## Decisiones Tomadas

1. **`config.paused` pausa lo AUTOMÁTICO, no los manuales.** El tick de 21-02 cortaba antes de elegir pendiente si el flag estaba prendido. Con eso, "Mandar ahora" (que encola y espera a que el tick emita) no habría podido mandar nada con la pausa puesta — rompiendo la decisión 1 del `21-UI-SPEC` justo en su caso de uso ("probar el canal antes de reactivar"). Ahora la pausa filtra los pendientes `daily`/`weekly` y deja pasar `custom`/`dm`; si no queda nada emitible sigue devolviendo `reason:'pausado'` (el test de 21-02 que usa la pausa para aislar el timeout sigue verde).
2. **El período semanal se consume SOLO con el mail entregado.** Escribir `lastWeeklyPeriodKey` siempre habría matado el reintento del mail (comportamiento de Phase 19 con un test dedicado). El mensaje al grupo no necesita ese guard: el de `enqueueReportMessage` (kind+periodKey sobre `queue`+`history`) ya garantiza uno por semana. Resultado: el mail reintenta cada tick hasta salir y el grupo recibe exactamente uno.
3. **El encabezado del corto comprime el mes.** El plan describía la regla como `*Semana DD/MM–DD/MM*` pero su propio molde (copia literal de D-20, que el user leyó y aprobó) dice `*Semana 20–26/07*`. Manda el molde literal; cuando la semana cruza de mes sale `*Semana 29/07–04/08*`.
4. **Semana entera en cero = una línea.** `Equipo sin llamadas en la semana` en vez de `Equipo 0 llam · 0 at (0%)`, y sin la línea de interesados/reuniones. Mismo criterio que D-11 para el diario (la regla "nada de métricas en cero" del milestone).
5. **`send-now` corta la espera cuando el motivo es estable.** Si el tick dejó el item `pending` con `sin_grupo` o `desktop offline`, esperar los 25s no cambia nada: se responde en el acto. Los casos ambiguos (emitido y esperando confirmación, o cola ocupada con items previos) sí agotan el techo y devuelven `queued/sending`.
6. **El techo de espera es una env var** (`REPORT_SEND_NOW_WAIT_MS`, default 25s, piso 1s). Los tests lo bajan a 2s sin necesitar una rama `NODE_ENV==='test'` en producción, y ops gana una palanca.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] La pausa dejaba inutilizable el botón "Mandar ahora"**

- **Found during:** Task 2 (endpoints)
- **Issue:** El paso 1 del flujo que describe el plan dice que `send-now` **ignora la pausa** (decisión 1 del `21-UI-SPEC`), pero el paso 4 delega la emisión en `reportQueueTick`, que con `config.paused` retorna antes de elegir pendiente. Con la pausa puesta, el botón habría encolado y respondido "quedó en camino" para siempre — el reporte no salía hasta que alguien despausara. Es exactamente el escenario que la decisión quería cubrir.
- **Fix:** en `reportQueueTick`, la pausa dejó de ser un `return` temprano y pasó a filtrar los pendientes: `daily`/`weekly` quedan frenados, `custom` (lo que encola el botón) y `dm` (respaldo de D-02) salen. Si el filtro deja la lista vacía se sigue devolviendo `reason:'pausado'`, así que el contrato observable de 21-02 no cambia.
- **Files modified:** `index.js`
- **Verification:** test "ignora la pausa: pausado el automático, el botón sigue funcionando" (emite y además comprueba que el cron diario del mismo día SIGUE devolviendo `pausado`); los 26 tests de `report-queue.test.js` verdes, incluido el que usa la pausa para aislar el timeout. Mutación M4 (volver a `filter((it) => !paused)`) → rojo.
- **Committed in:** `bf56577`

**2. [Rule 1 - Bug] El guard en memoria de WR-03 contaminaba tests vecinos**

- **Found during:** Task 3 (tests)
- **Issue:** `_weeklyPeriodSentMem`/`_dailyPeriodSentMem` son de módulo y sobreviven a borrar `reports.json`. Dos tests que usan la misma fecha (el patrón del archivo original: varios tests con `MON9`) se habrían contaminado: el segundo recibiría `ya_enviado` sin haber mandado nada. El plan sugería "resetear el guard recargando el estado por el camino público", que no lo resetea.
- **Fix:** seam explícito `globalThis.__weeklyReport._resetPeriodMem()`, llamado desde el `resetReportsState()`/`reset()` de las dos suites. Es el único agregado a la superficie pública por motivos de test, y está comentado como tal.
- **Files modified:** `index.js`, `tests/weekly-report.test.js`, `tests/daily-cron.test.js`
- **Verification:** test "WR-03: el guard en memoria corta aunque el archivo se pierda" (verifica el guard) + suite completa verde (verifica que no contamina).
- **Committed in:** `560c295` (seam) y `8174fab` (uso)

**3. [Rule 3 - Blocking] `tests/metrics-consistency.test.js` A4 afirmaba la ventana vieja**

- **Found during:** Task 3
- **Issue:** El `files_modified` del plan lista 3 archivos y la verificación pide que `git diff --stat` muestre solo esos. Pero A4 ("reporte semanal — answeredWeek con la definición canónica") calcula la ventana `[lunes pasado, este lunes)` a mano y la compara contra `calls.totalWeek`. Con la ventana de D-13 el test falla necesariamente — y la misma verificación del plan exige la suite completa en 0. No se puede cumplir las dos cosas sin tocar el archivo.
- **Fix:** A4 recalcula la ventana con la semántica nueva (`[este lunes, ahora)`), con un comentario que explica el cambio y por qué; el `answeredWeek > 0` ahora se garantiza con las llamadas de HOY del fixture (antes dependía de un `hung_up` de la semana pasada) y se sumó un cross-check de `previous.dials` contra la semana anterior. Cero cambios en el resto de la suite anti-regresión del CALL METRICS CORE.
- **Files modified:** `tests/metrics-consistency.test.js` (12 líneas)
- **Verification:** `npx vitest run tests/metrics-consistency.test.js` → 18/18; mutación M5 (volver el cron a lunes 8am) deja rojo el resto.
- **Committed in:** `8174fab`

### Desvíos de proceso (no de código)

**4. [Rule 3 - Blocking] La Task 3 estaba marcada `tdd="true"` pero el orden del plan hace imposible el RED**

- **Found during:** Task 3
- **Issue:** Igual que en 21-02: las Tasks 1 y 2 entregan la implementación completa y la Task 3 es explícitamente "crear el archivo de tests" con un bloque `<behavior>` de regresión.
- **Fix:** se ejecutó como task de regresión (un commit `test(...)`) y se sustituyó el gate RED por dos cosas: (a) un RED **real y no buscado** — el cambio de ventana de la Task 1 dejó 8 tests rojos (7 de `weekly-report` + A4), que es la evidencia de que la suite vieja medía la ventana vieja; y (b) **verificación por mutación** sobre los tests nuevos: 6 mutaciones (ventana de hora del diario, `kind:'custom'`→`daily` en send-now, D-12 desactivado, pausa frenando todo, semanal de vuelta a lunes 8am, "Detalle completo en el mail" siempre) → **7/21 rojos** en la primera ronda y **14/39** en la segunda. `index.js` restaurado desde una copia de scratch; `git status` limpio (verificado: el archivo no figuraba como modificado tras restaurar).
- **Verification:** 21/21 con el código sano · 7/21 y 14/39 con las mutaciones · suite completa 945/945 tras restaurar.
- **Committed in:** `8174fab`

### Criterios de aceptación medidos de otra forma (2, sin cambio de comportamiento)

- **`grep -c "maybeRunWeeklyReportCron()" index.js` = 2**: imposible con el snippet del propio plan, que contiene UNA sola llamada dentro de `_reportCrons` (la otra línea llama a `maybeRunDailyReportCron()`). Se implementó el snippet; el criterio que importa — `grep -c "setInterval(() => maybeRunWeeklyReportCron" index.js` = **0**, un solo registro de timers — sí se cumple.
- **`grep -A45 "daily-report/send-now" | grep -c "\.find("` >= 1**: el lookup del item propio usa `_reportFindItem(state, myId)` (el helper de 21-02, que busca por id en `queue` **y** en `history` con `.find()`), no un `.find()` inline. Cumple la intención del criterio ("busca su propio item por id, no el primero de la cola") de forma más fuerte: un item que ya migró a `history` también se encuentra.

---

**Total deviations:** 3 auto-fixes de código (1 Rule 1, 1 Rule 2, 1 Rule 3) + 1 desvío de proceso + 2 criterios medidos de otra forma
**Impact on plan:** los tres auto-fixes son de correctitud sobre el objetivo del plan (sin ellos: el botón de la prueba en vivo no manda con la pausa puesta, dos tests con la misma fecha se contaminan, y la suite no puede quedar verde). Cero scope creep: ningún endpoint, vista ni archivo de datos que el plan no pidiera.

## Issues Encountered

- **La ventana nueva del semanal rompió 8 tests de dos archivos** (7 de `weekly-report` + A4 de `metrics-consistency`). Era esperado y está anotado en el plan como "cambio a propósito, no revertir": se movieron los fixtures, no la feature. Aprovechando la reescritura, los fixtures de llamadas pasaron a offsets **negativos** desde `now` (`now - 60000`) en vez de horas fijas del día: con la ventana capada a `now`, cualquier hora futura del día habría caído fuera y el test habría sido flaky según la hora en que corriera la suite.
- **El `gsd-sdk` no está disponible** (no en PATH, no en `node_modules`, y `bin/gsd-tools.cjs` no expone `query`). STATE.md y ROADMAP.md se actualizaron a mano con Edit, como ya venía haciéndose en esta fase (anotado en STATE.md desde la sesión 2026-07-25).

## Known Stubs

- **`config.backupEmails` se persiste y nadie lo lee.** El `PUT /config` lo valida y lo guarda, pero ningún camino de código manda ese email. Es **D-04 explícito** (el email del diario queda cableado y apagado; encenderlo debe ser configuración, no construcción) y ya estaba anotado así en `21-02-SUMMARY.md`. El panel de 21-04 lo va a mostrar como editable — el copy del `21-UI-SPEC` no promete que se use.
- **`lastSent` del `GET /status` es el último terminal de CUALQUIER kind** (diario, semanal o prueba manual). Es lo que el `21-UI-SPEC` pide para el chip "Último envío falló"; no distingue de qué reporte se trata más allá del `periodLabel`.

## Verificación

```
node --check index.js                                              → 0
npx vitest run tests/daily-cron.test.js                            → 21 passed
npx vitest run tests/weekly-report.test.js                         → 18 passed
npx vitest run tests/report-queue.test.js tests/daily-report.test.js
  tests/weekly-report.test.js tests/daily-cron.test.js             → 93 passed
npx vitest run tests/security-rbac.test.js tests/hardening.test.js
  tests/onboarding.test.js tests/metrics-consistency.test.js       → verdes
npx vitest run (suite completa)                                    → 945/945 (66 files)
git diff --stat 89ada65 HEAD                                       → index.js, tests/daily-cron.test.js,
                                                                     tests/weekly-report.test.js,
                                                                     tests/metrics-consistency.test.js
```

Greps de aceptación:

| Criterio | Esperado | Real |
|---|---|---|
| `function buildWeeklyReportTextShort(` | 1 | 1 |
| `reuniones agendadas` | >=1 | 2 |
| `Detalle completo en el mail` | 1 | 1 |
| `_bizDayOfWeek(nowTs) !== 0` en el cron semanal | 1 | 1 |
| `lastWeeklyPeriodKey` | >=3 | 4 |
| `6 * 24 * 60 * 60 * 1000` (ventana de 6 días de WR-01) | 0 | 0 |
| `_weeklyPeriodSentMem\|_dailyPeriodSentMem` | >=2 | 6 |
| `REPORT_EMAILS seteada pero sin emails válidos` | 1 | 1 |
| `new Set(list)` | 1 | 1 |
| claves de Phase 19 intactas | >=7 | 17 |
| `async function maybeRunDailyReportCron(` | 1 | 1 |
| los 3 endpoints `/api/admin/daily-report/*` | 3 | 3 |
| los 3 con `requireAuth, requireRole('admin')` | 3 | 3 |
| `setInterval(() => maybeRunWeeklyReportCron` | 0 | 0 |
| `domingo_semanal\|finde_sin_actividad\|fuera_de_ventana\|pausado` | >=5 | 8 |
| `REPORT_SEND_NOW_WAIT_MS` | >=2 | 2 |
| `lastDailyPeriodKey` dentro de send-now (-A25) | 0 | 0 |
| `reportQueueTick()` dentro de send-now (-A45) | >=2 | 2 |
| `delete process.env` en el test nuevo | 0 | 0 |
| `useFakeTimers` en el test nuevo | 0 | 0 |
| `D-13` en `tests/weekly-report.test.js` | >=1 | 5 |
| tests de `daily-cron` | >=14 | 21 |

Backend puro: **no se bumpeó cache-buster** (correcto, no se tocó `public/`).

## Cobertura de decisiones, requisitos y amenazas

| Ítem | Estado |
|---|---|
| D-10 (23:00 hora de negocio, corte único) | completo |
| D-11 (lun-vie siempre, día en cero = una línea) | completo |
| D-12 (finde solo con actividad, sin recomputar toda la noche) | completo |
| D-13 (semanal domingo 23:00, ventana corrida) | completo |
| D-20 (molde del semanal corto, incl. el cero de reuniones) | completo |
| D-28 (guard por período cubierto) | completo, en disco y en memoria |
| D-29 (pausa + mandar ahora del panel) | parte server completa; la UI es 21-04 |
| D-04 (email cableado y apagado) | `backupEmails` validado y persistido, sin lector — por diseño |
| REP-05 (molde) | builder + corto listos; la validación en el celular del user es 21-07 |
| REP-08 (sin duplicados por período) | completo |
| WR-01 / WR-02 / WR-03 (19-REVIEW) | los tres cerrados con test |
| T-21-13 (RBAC de los 3 endpoints) | mitigado + test (403 SDR / 401 sin sesión) |
| T-21-14 (spam del grupo por doble click) | mitigado server-side + test (`queued/busy` sin encolar otro) |
| T-21-15 (duplicado del automático) | mitigado (período en disco + memoria) + test del fallo de disco |
| T-21-16 (`backupEmails` sucio) | mitigado + test (array, cap 10, regex, trim, dedup, 400) |
| T-21-17 (fuga del JID) | mitigado + test (`jidCaptured` booleano, `groupJid` ausente del body) |
| T-21-18 (prueba manual vs automático) | mitigado + test (`kind:'custom'`, `lastDailyPeriodKey` intacto) |

## Sin verificar en vivo

- **Ningún cron corrió con el reloj real:** las ventanas se probaron con `nowTs` inyectado. El primer envío real a las 23:00 es el que confirma que el timer horario cae dentro de la ventana en producción (Railway en UTC, `BUSINESS_TZ` = AR).
- **El `sent` de `send-now` nunca se ejercitó end-to-end:** llegar a `status:'sent'` requiere que el desktop confirme con `report:send-result`. Los tests verifican que el evento sale con el payload correcto y que el item queda `sending`; el camino completo es 21-07.
- **La calidad del molde corto** se validó contra el texto de D-20 carácter por carácter, pero la lectura final en el celular del user (REP-05) sigue siendo del plan 21-07.
- **`REPORT_SEND_NOW_WAIT_MS` = 25s es una estimación** heredada del research (Q5): el primer "Mandar ahora" real con una PC recién prendida dirá si sobra o falta.

## User Setup Required

Nada nuevo. Lo que ya estaba pendiente sigue igual:

- **`RESEND_API_KEY`** (opcional para esta fase): sin ella el mail del semanal no sale, pero el **corto al grupo sale igual** y no promete un mail inexistente. `REPORT_EMAILS` (CSV) gobierna los destinatarios de ese mail — si se separa con `;` ahora hay un warning en los logs.
- **`REPORT_DM_FALLBACK`** (opcional, D-02): CSV de hasta 5 teléfonos E.164 para el respaldo por DM.
- **`REPORT_SEND_NOW_WAIT_MS`** (opcional): techo en ms de la espera del request de "Mandar ahora" (default 25000).
- Las acciones que bloquean 21-07 (número dedicado, grupo cerrado, QR en `wa-multi-portable-v0.5.11`, elegir el grupo y **fijarlo**) no bloquean nada de este plan.

## Next Phase Readiness

- **21-04 (panel de config):** listo. El contrato de los 3 endpoints es exactamente el del `21-UI-SPEC` §"Contrato de endpoints propuesto"; el `PUT` devuelve el mismo shape que el `GET` (la UI puede refrescar con la respuesta) y `send-now` devuelve los 5 estados que necesita la state machine del botón (`sent`, `sent_via_dm`, `queued` con `reason` ∈ `busy|offline|sin_grupo|fallback_dm|sending`, `failed`). El cliente debe seguir esperando 60s: el server responde a los 25s como máximo.
- **21-07 (prueba en vivo):** el botón "Mandar ahora" ya existe del lado server y funciona **incluso con la pausa puesta** — es la vía recomendada para la primera prueba sin esperar a las 23:00.
- **Riesgo abierto (heredado, aceptado):** `buildDailyReportData` recorre leads × callLog en memoria (~1s con la base actual) y en el cron corre DENTRO del mutex de `reports.json`. Es sincrónico, así que el mutex no cambia nada respecto de correrlo afuera; si la base creciera mucho, el `send-now` (admin-only, 1 por click) es el único camino donde se nota.

---
*Phase: 21-reporte-diario-canal-whatsapp*
*Completed: 2026-07-26*

## Self-Check: PASSED

- `index.js` — FOUND (contiene `maybeRunDailyReportCron`, `buildWeeklyReportTextShort`, los 3 endpoints `/api/admin/daily-report/*`, `_reportCrons`)
- `tests/daily-cron.test.js` — FOUND (426 líneas, > 220 requeridas; 21 tests)
- `tests/weekly-report.test.js` — FOUND (18 tests, fixtures en la ventana D-13)
- `tests/metrics-consistency.test.js` — FOUND (A4 adaptado, 18 tests)
- `.planning/phases/21-reporte-diario-canal-whatsapp/21-03-SUMMARY.md` — FOUND
- Commits `560c295`, `bf56577`, `8174fab` — FOUND en `git log`
- Key links verificados: `maybeRunDailyReportCron` → `enqueueReportMessage` ✓ (+ `buildDailyReportText`/`Line`) · `maybeRunWeeklyReportCron` → `buildWeeklyReportTextShort` ✓ · `send-now` → `reportQueueTick()` ✓ (2 llamadas)
- `node --check index.js` → 0 · suite completa **945/945**

---
phase: 21-reporte-diario-canal-whatsapp
plan: 01
subsystem: reporting
tags: [reportes, whatsapp, call-metrics-core, timezone, texto-plano]

# Dependency graph
requires:
  - phase: 19-encender-reporte-semanal
    provides: "bloque de reportes en index.js (reports.json, buildWeeklyReportData, globalThis.__weeklyReport) — analog exacto replicado"
  - phase: 20-disposicion-obligatoria
    provides: "pending_calls.json + loadPendingCalls() — fuente de las discadas sin marcar (D-23)"
provides:
  - "buildDailyReportData(nowTs, dayTs) — datos del reporte de UN día derivados del CALL METRICS CORE"
  - "buildDailyReportText(data, {gapNote}) — texto plano de WhatsApp con el molde D-19"
  - "buildDailyReportLine(data) — una línea por día para el consolidado"
  - "buildConsolidatedReportText(lines, {gapNote, neverStarted}) — UN mensaje para N días (D-26)"
  - "_reportWeekdaysSince / _reportOnLeave / _reportSafeName / _reportDayLabel"
  - "setter.leaveUntil — licencia con vencimiento (PATCH /api/setters/team/:id + perSetter de team-performance)"
  - "_ccResolveRange acepta `now` inyectable"
  - "globalThis.__dailyReport — superficie de test"
affects: [21-02 cola de envío, 21-03 cron diario, 21-04 panel de config y licencia, 23 alertas por excepción]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "builder de reporte = data puro (lee disco) + texto puro (recibe data)"
    - "`now` inyectable en el CORE en vez de duplicar semántica de rango para poder testear"
    - "líneas del mensaje como `string | ''` + .filter(Boolean) — cero métricas en cero"

key-files:
  created:
    - tests/daily-report.test.js
  modified:
    - index.js

key-decisions:
  - "El % del mensaje se redondea a entero (62%, no 61.5%) para igualar el molde que el user validó; el dato conserva la precisión del CORE"
  - "Los minutos salen del CORE (totalDurationS, que suma solo llamadas atendidas) — no se recalculan al margen aunque el borrador del molde mostrara otro número"
  - "Setters con hidden:true quedan fuera de TODAS las listas, incluida 'Sin arrancar' (si no, un setter dado de baja aparecería para siempre)"
  - "Las discadas sin marcar (D-23) se computan aparte y NUNCA se suman a dials — una sola forma de contar llamadas"
  - "leaveUntil es campo propio, NO se reusa `hidden` (hidden no vence)"

patterns-established:
  - "Reporte diario: buildDailyReportData → buildDailyReportText, mismo par que buildWeeklyReportData → buildWeeklyReportHtml"
  - "Cambiar redacción/orden del mensaje = editar buildDailyReportText y nada más (el texto no se concatena en ningún otro lado)"
  - "Tests de reportes sin fake timers: nowTs por parámetro + fixtures reescritos a disco por test"

requirements-completed: [REP-04, REP-09, REP-10]

# Metrics
duration: 10min
completed: 2026-07-26
---

# Phase 21 Plan 01: Builder del reporte diario Summary

**El reporte diario ya se arma: `buildDailyReportText(buildDailyReportData())` produce, con datos reales de producción del mié 22/07, el mensaje exacto del molde D-19 — excepción en la primera línea, cero métricas en cero, Ignacio y Paula fuera.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-07-26T21:08:33Z
- **Completed:** 2026-07-26T21:19:00Z
- **Tasks:** 3/3
- **Files modified:** 2 (1 creado, 1 modificado)

## Accomplishments

- **Builder de datos derivado del CALL METRICS CORE (regla #157):** `buildDailyReportData(nowTs, dayTs)` no re-implementa nada del funnel — usa `_ccResolveRange` / `_ccCollectCalls` / `_ccFunnelAggregate`, y un test compara `team.dials/connects/connectRate/minutes` contra el agregado del CORE para que cualquier divergencia futura falle.
- **Los cuatro estados de vendedora funcionan solos** (D-14/D-15/D-16/D-18): quien nunca arrancó va a "Sin arrancar" (no ensucia la alerta todos los días), quien paró hoy va a la alerta, quien lleva 5+ días hábiles ESCALA a línea propia con el conteo, y la licencia vence sola por comparación de strings de día (nadie tiene que acordarse de desmarcar).
- **Verificado contra producción**, no solo contra fixtures: corrido sobre el snapshot real de `data/` para el 22/07 devuelve `13 llam · 8 at · 21 min`, Brenda en la fila, Judith y Teresa en la alerta, Dalia/Adela/Melissa en "Sin arrancar" — la estructura del molde D-19, línea por línea.
- **Los tres sesgos conocidos quedan anotados en el propio mensaje** (REP-10 + D-22 + D-23): canal manual sin minutos, llamadas sin atribuir (users borrados) y discadas sin marcar por nombre — y ninguno de los tres toca el conteo canónico de llamadas.
- **28 tests nuevos**, suite completa 892/892 (era 864).

## Task Commits

1. **Task 1: buildDailyReportData + helpers + `now` inyectable** — `a303114` (feat)
2. **Task 2: buildDailyReportText + Line + Consolidated (molde D-19)** — `81142ab` (feat)
3. **Task 3: tests/daily-report.test.js** — `199bf40` (test)

## Files Created/Modified

- `index.js` — bloque `// ── Phase 21: reporte diario ──` (justo después de `globalThis.__weeklyReport`): 4 helpers + `buildDailyReportData` + los 3 builders de texto + `globalThis.__dailyReport`. Además: `now` inyectable en `_ccResolveRange`, validación de `leaveUntil` en `PATCH /api/setters/team/:id` y `leaveUntil` expuesto en `perSetter` de `team-performance`.
- `tests/daily-report.test.js` — 28 tests (467 líneas) de regresión del builder y del molde.

## Salida real (snapshot de producción, mié 22/07 23:00 AR)

```
*Sin actividad hoy: Judith Mendez, Teresa Chun*
Reporte diario · mié 22/07

*Brenda Eguren* 13 llam · 8 at · 21 min

_Equipo 13 llam · 8 at (62%) · 21 min_
_Ayer 66 llam · 23 at (35%)_
_Interesados: Brenda Eguren 6_
_Sin arrancar: Dalia Niero, Adela Ruiz, Melissa Medina_
```

Coincide con el molde D-19 salvo dos diferencias explicadas abajo (minutos y la línea de interesados, que el borrador no tenía porque no computaba D-21).

## Decisiones Tomadas

1. **Porcentaje entero en el texto, decimal en el dato.** El CORE devuelve `61.5`; el molde que el user validó dice `62%`. Un decimal en un mensaje que se lee de un vistazo es ruido, así que el redondeo se hace en la capa de presentación (`buildDailyReportText`) y `data.team.connectRate` conserva la precisión del CORE para cualquier consumidor futuro.
2. **Los minutos son los del CORE.** `totalDurationS` suma la duración solo de las llamadas atendidas. El borrador de D-19 mostraba `23 min` donde el CORE da `21 min` para el mismo día: el borrador se generó con un script ad-hoc del planner, y la regla #157 manda que el número salga del CORE. No se "arregló" el builder para llegar a 23.
3. **`hidden: true` excluye de TODAS las listas.** Un setter dado de baja no puede quedar en "Sin arrancar" para siempre. Efecto lateral aceptado: si un setter oculto llamara hoy, su llamada sumaría al total del equipo sin tener fila propia (no ocurre en la práctica: se oculta a quien ya no trabaja).
4. **Las discadas sin marcar no son llamadas.** `unmarked` se computa desde `pending_calls.json` y se muestra por nombre, pero jamás entra a `dials` — si entrara, el reporte dejaría de cuadrar con el panel (regla transversal del milestone).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] El % del mensaje salía con decimal, contra el molde validado**
- **Found during:** Task 3, al verificar la salida contra el snapshot de producción
- **Issue:** El plan interpolaba `d.team.connectRate` crudo → `_Equipo 13 llam · 8 at (61.5%) · 21 min_`, mientras el molde D-19 que el user aprobó dice `(62%)`. Con fixtures de números redondos (3/4 = 75%) el defecto era invisible; solo apareció con datos reales.
- **Fix:** helper `pct()` local en `buildDailyReportText` que redondea al imprimir, en las dos líneas que muestran porcentaje (Equipo y Ayer). El dato del builder no se toca.
- **Files modified:** `index.js` (`buildDailyReportText`), `tests/daily-report.test.js` (test dedicado: 8/13 → dato `61.5`, texto `62%`)
- **Commit:** `199bf40`

Todo lo demás se ejecutó exactamente como estaba escrito.

## Verification

- `node --check index.js` → 0
- `npx vitest run tests/daily-report.test.js` → **28 passed**
- `npx vitest run tests/weekly-report.test.js tests/metrics-consistency.test.js tests/team-performance.test.js tests/performance.test.js` → 63 passed (las suites vecinas de métricas siguen verdes; `metrics-consistency` es la garantía anti-regresión del CORE)
- **Suite completa: 892/892** (64 files) — sin flaky esta corrida
- `git diff --stat 27f4d78 HEAD` → solo `index.js` y `tests/daily-report.test.js`. Backend puro: **no se bumpeó cache-buster** (correcto, no se tocó `public/`)
- Cero `setHours(0` / `toISOString().slice(0, 10)` en el bloque nuevo (regla #113)
- Verificación funcional contra el snapshot real de `data/` en un directorio de scratch aislado (borrado al terminar; nunca se escribió sobre `./data/`)

## Cobertura de decisiones y requisitos

| Ítem | Estado |
|---|---|
| REP-04 (métricas con señal, excepciones arriba, vs ayer) | completo |
| REP-05 (builder de texto plano con el molde) | **builder completo; la validación del user en su celular es del plan 21-07** |
| REP-09 (solo vendedoras nuevas) | completo |
| REP-10 (canal manual + sin atribuir anotados) | completo |
| D-11 (día en cero = una línea) · D-14 · D-15 · D-16 · D-17 · D-18 · D-19 · D-21 · D-22 · D-23 · D-25 | completos |
| D-05 (nota de baches) · D-26 (consolidado) | los builders los soportan vía `gapNote` / `buildConsolidatedReportText`; los usa el plan 21-02 |

## Notas para los planes siguientes

- **21-02 (cola):** `buildDailyReportLine(data)` está pensado para guardarse JUNTO al texto al encolar — consolidar no debería recomputar días viejos. `buildDailyReportText` y `buildConsolidatedReportText` aceptan `gapNote`, que va arriba de todo (D-05).
- **21-03 (cron):** `buildDailyReportData(nowTs, dayTs)` ya es inyectable en las dos dimensiones (reloj y día a reportar). Para el guard por período (D-28), `data.dayStr` es la clave de día en TZ de negocio.
- **21-04 (panel):** el badge de licencia lee `perSetter[].leaveUntil` de `team-performance`; el PATCH ya valida formato y limpia con `null`.
- **Riesgo abierto (T-21-04, aceptado):** `buildDailyReportData` recorre `leads × callLog` en memoria. Con la base actual tarda ~1s. El disparo manual del plan 21-03 debe quedar admin-only + one-in-flight.

## Self-Check: PASSED

- `index.js` — FOUND (contiene `globalThis.__dailyReport` con las 4 funciones + los 4 helpers)
- `tests/daily-report.test.js` — FOUND (467 líneas, > 200 requeridas)
- Commits `a303114`, `81142ab`, `199bf40` — FOUND en `git log`
- Key links verificados: `_ccFunnelAggregate(` ✓, `_filterSettersVisible` ✓, `loadPendingCalls(` ✓ dentro de `buildDailyReportData`

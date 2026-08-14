---
phase: 28-quick-alivio-inmediato
plan: 02
subsystem: ui
tags: [vanilla-js, popover, calendar, wiring, timezone]

# Dependency graph
requires:
  - phase: 28-quick-alivio-inmediato (plan 01)
    provides: "window._dtPicker (attach/sync/set/close) + helpers puros DTPICKER-PURE"
provides:
  - "Los 5 campos de fecha de la app (call-cb-fecha, call-ph-fecha, call-sched-fecha, agendar-fecha, schedule-datetime) usan el calendario propio del popover"
  - "window._leadLocalTimeAt(lead, date): hora local del lead para una fecha arbitraria, sin semáforo"
  - "Carga por día (D-07) en el popover: badges .dtp-load con callbacks manuales + reuniones agendadas"
affects: [ui, dialer, hoy, calendario, call-disposition]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "attach idempotente en los 5 call sites reales, inmediatamente después del default del input"
    - "getLead() como callback lazy — se evalúa recién al abrir/commitear, nunca en el momento de attach"
    - "fetch cacheado con TTL (120s) + guard de mes-todavía-visible para no pintar sobre un popover ya navegado"

key-files:
  created:
    - tests/dtpicker-wiring.test.js
  modified:
    - public/app.js
    - public/index.html

key-decisions:
  - "D-07 se carga SIEMPRE por default en los 5 inputs (ninguno pasa load:false) — la carga por día es info de equipo, no depende de si hay lead en ese punto de entrada"
  - "_dtpRefreshLoad nunca bloquea el render de la grilla: se dispara sin await y solo pinta si el popover sigue mostrando el mismo mes cuando la red resuelve"

requirements-completed: [GATE-03]

# Metrics
duration: 15min
completed: 2026-08-14
---

# Phase 28 Plan 02: Wiring del calendario + hora local del lead + carga por día Summary

**Los 5 `datetime-local` reales de la app (callback, hold de calendario, agendar reunión, agendar desde llamada, mensaje programado) quedaron enchufados a `window._dtPicker`, con hora local del lead en texto plano (D-06) y badges de carga por día (D-07) en el popover — cero cambios en los handlers de guardado.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-08-14T14:46 (base commit del wave 1)
- **Completed:** 2026-08-14T15:00
- **Tasks:** 2 completadas
- **Files modified:** 3 (`public/app.js`, `public/index.html`, `tests/dtpicker-wiring.test.js`)

## Accomplishments

- **Task 1 — Wiring:** 5 llamadas a `_dtPickerAttach` (una por input, cada una con `getLead` resuelto según el lead disponible en ese punto de entrada) + 3 llamadas a `_dtPickerSync` en los atajos existentes (`.cb-quickpick`, `.ph-quickpick`, `[data-schedule-preset]`) para que sigan siendo un click directo sin abrir el calendario (D-05). Ningún `onclick` de confirmar/guardar fue tocado — verificado con diff explícito de esos 5 bloques.
- **Task 2 — D-06 + D-07:** bloque `LEADTIME-AT` (hoisted, junto a `_leadLocalTime`) con `_leadTimeAtTz`/`_leadLocalTimeAt` — misma lógica país→IANA que ya usa el chip del Power Dialer, pero para una fecha ARBITRARIA (la elegida en el calendario) y sin el flag `ok` (D-06 prohíbe el semáforo acá, solo mostrar). El popover pinta `.dtp-leadtime` con `= HH:MM para el lead (País)` en texto plano. Para D-07, `_dtpFetchCalendar` (cache TTL 120s, `catch` que degrada a `[]` sin romper la elección de fecha) + `_dtpLocalCallbackLeads` (lee `_callsLeadsById` en memoria, sin fetch extra) alimentan `_dtpCountByDay` (ya existía de 28-01) para pintar badges `.dtp-load` por celda vía `_dtpPaintLoad`.

## Task Commits

1. **Task 1: Cablear los 5 campos de fecha al componente** - `d40f199` (feat)
2. **Task 2: Hora local del lead (D-06) y carga por día (D-07)** - `a75239b` (feat)

## Files Created/Modified

- `public/app.js` — 5 `_dtPickerAttach`, 3 `_dtPickerSync`, bloque `LEADTIME-AT` (`_leadTimeAtTz`/`_leadLocalTimeAt`/`window._leadLocalTimeAt`), `_dtpRenderLeadTime`, y el bloque D-07 (`_dtpCalCache`, `_dtpFetchCalendar`, `_dtpLocalCallbackLeads`, `_dtpPaintLoad`, `_dtpRefreshLoad`) cableado en `_dtpOpen` + los handlers de `.dtp-nav`/`.dtp-today`/`.dtp-grid`.
- `public/index.html` — cache-buster de `app.js` bumpeado a `v=20260814b` (único bump para las 2 tasks del plan, ya que se commitean juntas).
- `tests/dtpicker-wiring.test.js` (nuevo) — 30 tests: 13 de código fuente sobre el wiring de Task 1 + 17 de Task 2 (11 del bloque `LEADTIME-AT` extraído y evaluado aislado con `_LEAD_TZ`/`window` stubeados, 6 de aserciones de código fuente sobre D-07).

## Decisions Made

- **`_dtpRenderLeadTime` se llama en `_dtpOpen` Y en `_dtpCommit`** (no solo al abrir): así el texto `= HH:MM para el lead` se actualiza en vivo cuando el user cambia el día/hora dentro del mismo popover, no solo al primer render.
- **`_dtpRefreshLoad` respeta `opts.load === false`** (flag que ningún call site de este plan usa todavía, pero queda disponible para futuros puntos de entrada que quieran saltear el fetch de calendario).
- **El test que extrae `LEADTIME-AT` stubea `window = {}`** dentro del wrapper de `new Function(...)`, porque el bloque hace `window._leadLocalTimeAt = _leadLocalTimeAt;` y Node no tiene `window` — mismo patrón de extracción aislada que `DTPICKER-PURE` (28-01), con un stub adicional necesario por esta única línea.

## Deviations from Plan

None — plan ejecutado tal como estaba escrito. Las líneas de los call sites difirieron de las citadas en el `<context>` del plan (10101/10165/10412/17866 originales) porque 28-01 insertó ~315 líneas del componente ANTES de esos puntos — el plan ya anticipaba esto explícitamente ("app.js líneas 4605-4630 — presets... y el bloque del picker insertado por 28-01"), así que se ubicaron los call sites reales por búsqueda de texto (`openCallbackModal`, `openPlaceholderModal`, etc.) en vez de por número de línea literal.

## Issues Encountered

- El primer intento de correr el test del bloque `LEADTIME-AT` tiró `ReferenceError: window is not defined` (el bloque real hace `window._leadLocalTimeAt = ...`). Se resolvió agregando `const window = {};` al wrapper de `new Function(...)`, mismo espíritu que la inyección de `_LEAD_TZ` que ya pedía el plan.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Los 5 inputs de fecha de la app ya usan el calendario propio; los 3 atajos rápidos existentes siguen intactos.
- El `<human-check>` de ambas tasks (abrir "Volver a llamar" y ver el trigger/popover en vivo, verificar hora local del lead sin ámbar, verificar badges de carga por día) **NO se ejecutó** — este ejecutor no tuvo disponible ninguna herramienta de browser/preview (`preview_start`, `javascript_tool`, screenshot) en su set de tools (solo Read/Write/Edit/Bash/Grep/Glob), igual que el ejecutor de 28-01. La verificación se hizo por la vía disponible más fuerte: lectura línea por línea del código contra la especificación exacta del plan, `node --check` (sintaxis OK), greps de TODOS los acceptance criteria del plan, diff explícito confirmando que ningún handler de guardado cambió, y 30 tests nuevos (13 Task 1 + 17 Task 2) que fijan el contrato de wiring y de los helpers `_leadTimeAtTz`/`_leadLocalTimeAt` contra casos reales de UTC↔zona horaria. **Queda pendiente la verificación visual en el próximo ciclo con el user** (o un ejecutor con acceso a browser/preview): confirmar que el popover se ve bien anclado al input real dentro de cada modal, que el texto de hora local no tiene ningún color de alerta, y que los numeritos de carga aparecen en los días correctos.
- No hay bloqueadores para el resto de Phase 28 (paneles arrastrables, D-08..D-11) — ese es alcance de otro plan/wave, sin dependencia de este.

## Self-Check

- `public/app.js`: FOUND
- `public/index.html`: FOUND
- `tests/dtpicker-wiring.test.js`: FOUND
- Commit `d40f199` (Task 1): FOUND en `git log`
- Commit `a75239b` (Task 2): FOUND en `git log`
- Commit `ce04263` (docs: SUMMARY): FOUND en `git log`
- `npm test` completo: **1221/1221 PASS** (baseline 1204 tras Task 1 + 17 nuevos de Task 2)

## Self-Check: PASSED

---
*Phase: 28-quick-alivio-inmediato*
*Completed: 2026-08-14*

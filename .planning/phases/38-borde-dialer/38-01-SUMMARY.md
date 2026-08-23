---
phase: 38-borde-dialer
plan: 01
subsystem: ui
tags: [power-dialer, telnyx, disposition, vitest, call-metrics-core]

# Dependency graph
requires:
  - phase: 35-scr-atribucion-guion
    provides: "_pdHandleDisposition, el grid de disposición del Power Dialer"
  - phase: 36-disp-disposicion-responde
    provides: "_dispoBusyOn/_dispoBusyOff, telnyxCallMeta síncrono, _pendingTranscribes FIFO"
  - phase: 37-ses-sesion-discado
    provides: "_pdExit en dos fases, _pdShowClosing, _sesClosingModel (fuente canónica del cierre)"
provides:
  - "Guard compartido _pdAnyDispoModalOpen() en _pdHandleDisposition y el handler global de teclado del dialer"
  - "Chip 'hoy' del Power Dialer alimentado del CALL METRICS CORE (/cold-call-metrics?period=today), con fallback local"
  - "_actButtonsHTML(variant:'pd') ya no depende de los quick-links opcionales"
  - "Toast de fin de llamada branch por _dispoReal — llamada manual no promete disposición"
  - "hookTimeout de vitest en 30000 con evidencia documentada"
affects: [39, dialer, metrics, tests]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Constante + helper compartido para una condición repetida en dos call sites (_PD_DISPO_MODAL_IDS / _pdAnyDispoModalOpen), mismo criterio que _DISPO_MODAL_OUTCOMES de la fase 36"
    - "Chip de UI alimentado del CALL METRICS CORE con cache en memoria + fallback local, nunca re-implementando el funnel (nota #157 de CLAUDE.md)"

key-files:
  created:
    - tests/dialer-edges.test.js
  modified:
    - public/app.js
    - public/index.html
    - vitest.config.js
    - tests/dial-hold.test.js
    - tests/gate-next-step-ui.test.js
    - .planning/REQUIREMENTS.md

key-decisions:
  - "EDGE-02 resuelto con la opción 1 del plan (chip alimentado del servidor), no la opción 2 (renombrar la etiqueta) — el endpoint /cold-call-metrics ya soporta period=today y el patrón de refresco de _mypLoad era directamente reusable"
  - "El funnel canónico no expone 'interesados' aislado — el chip lo omite en vez de re-implementar el funnel para rellenarlo"
  - "El cache-buster se bumpeó una sola vez (en el commit de EDGE-05, el último que tocó app.js), no una vez por tarea"

patterns-established:
  - "Verificación por mutación documentada en el propio proceso de ejecución (no en el árbol): romper cada fix uno a la vez, confirmar el/los test(s) exacto(s) en rojo, restaurar, confirmar diff vacío"

requirements-completed: [EDGE-01, EDGE-02, EDGE-04, EDGE-05]

# Metrics
duration: 26min
completed: 2026-08-23
---

# Phase 38 Plan 01: Bordes de interacción del Power Dialer Summary

**Guard de modales compartido en el teclado del dialer, chip de meta alimentado del CALL METRICS CORE, botones de acción independientes de los quick-links, y un toast que deja de prometer una disposición imposible en llamadas manuales.**

## Performance

- **Duration:** 26 min
- **Started:** 2026-08-23T18:22:00Z (aprox., hora de creación del plan)
- **Completed:** 2026-08-23T18:48:00Z
- **Tasks:** 5 (4 edges + 1 config de test)
- **Files modified:** 7 (public/app.js, public/index.html, vitest.config.js, tests/dial-hold.test.js, tests/gate-next-step-ui.test.js, tests/dialer-edges.test.js [nuevo], .planning/REQUIREMENTS.md)

## Accomplishments

- **EDGE-01**: con un modal de disposición abierto (callback/agendar/objeción/próximo paso), el handler global de teclado del dialer ya no reacciona a NADA — ni 1-9 (dispararía una segunda disposición sobre el mismo lead) ni S/B (moverían la cola por debajo del modal) ni Escape (el modal maneja el suyo). `_PD_DISPO_MODAL_IDS` + `_pdAnyDispoModalOpen()` quedan como fuente única, reusada también por `_pdHandleDisposition` (que antes tenía su propio array local `modalIds`).
- **EDGE-02**: el chip "hoy" del header del Power Dialer dejó de re-implementar el funnel con su propia definición de "conversación" y su propio corte de día (medianoche del navegador). Ahora se alimenta de `/api/setters/cold-call-metrics?period=today` (CALL METRICS CORE), con fallback al cálculo local si el fetch falla o todavía no resolvió, y respeta el modo "Ver como SDR" (reglas #135/#146).
- **EDGE-04**: un lead sin Maps, sin sitio web, sin Instagram y sin email conserva sus botones de acción (WhatsApp + Descartar) en la ficha del Power Dialer — el contenedor ya no depende de que exista al menos un quick-link.
- **EDGE-05**: colgar una llamada manual (número suelto sin lead real) ya no muestra "Marcá el resultado abajo ↓" ni dispara el scroll/flash/foco a una fila que nunca existe (`_focusDispositionRow` reintentaba 12 veces cada 400ms y se rendía en silencio).
- **EDGE-03**: `hookTimeout` de vitest subido de 20000 a 30000, con la evidencia de las dos corridas (14:45 con 3 timeouts de `beforeAll` bajo presión de máquina vs. 15:17 limpia 124/124·2274/2274) documentada al lado del valor, mismo estilo que el comentario de `testTimeout`.

## Task Commits

Cada tarea se commiteó atómicamente, separando los hunks de `public/app.js` por tarea (varias tareas tocaban el mismo archivo en regiones no contiguas):

1. **Task 1 (EDGE-01): guard de modales en el teclado** — `220b15b` (feat) — incluye el fix de 2 tests preexistentes (`tests/dial-hold.test.js`, `tests/gate-next-step-ui.test.js`) que pineaban el array local viejo `modalIds`.
2. **Task 2 (EDGE-02): chip alimentado del canon** — `f4181e2` (feat)
3. **Task 3 (EDGE-04): botones de acción independientes de los quick-links** — `0c52bc4` (fix)
4. **Task 4 (EDGE-05): toast de llamada manual** — `8a9db28` (fix) — incluye el bump del cache-buster (`public/index.html`, `app.js?v=20260823d`)
5. **Test de cobertura de los 4 bordes** — `2cca8c8` (test) — `tests/dialer-edges.test.js`
6. **Task 5 (EDGE-03): hookTimeout de vitest** — `a6693a7` (chore)

**Plan metadata:** (este commit, docs) — incluye `38-01-SUMMARY.md`, `38-01-PLAN.md` (antes untracked), `.planning/REQUIREMENTS.md`.

## Files Created/Modified

- `public/app.js` — `_PD_DISPO_MODAL_IDS`/`_pdAnyDispoModalOpen()` (EDGE-01), `_pdTodayCanon`/`_pdFetchTodayCanon()` + wiring en `_pdStart`/`_pdHold` (EDGE-02), contenedor de quick-links/acciones sin condición (EDGE-04), toast + guard `if (_dispoReal)` en `_onTelnyxCallEnded` (EDGE-05).
- `public/index.html` — cache-buster `app.js?v=20260823d` (style.css sin tocar, sigue en `20260822a`).
- `vitest.config.js` — `hookTimeout: 30000` con comentario de evidencia.
- `tests/dial-hold.test.js`, `tests/gate-next-step-ui.test.js` — actualizados para verificar la constante compartida nueva en vez del array local viejo (mismo propósito, nueva ubicación).
- `tests/dialer-edges.test.js` (nuevo) — 46 tests: aserciones de fuente + comportamiento real (funciones extraídas y evaluadas con `new Function`, sin browser/jsdom).
- `.planning/REQUIREMENTS.md` — sección `### EDGE` nueva (4 requirements marcados `[x]` + EDGE-03 como nota de config), fila de Traceability, contador actualizado.

## Decisions Made

- **EDGE-02, opción elegida: 1 (alimentar el chip del canon del servidor)**, no la opción 2 (renombrar la etiqueta). Razón: `/api/setters/cold-call-metrics?period=today` ya existe y ya es la fuente que usa la pantalla de cierre de la sesión (`_sesClosingModel`, fase 37); el patrón de refresco con setter explícito en modo "Ver como SDR" ya estaba resuelto en `_mypLoad` (Mi rendimiento) y se pudo copiar sin inventar nada nuevo. La opción 2 hubiera dejado el chip mintiendo menos, pero seguiría siendo un número distinto en la misma pantalla — la opción 1 unifica de verdad.
- El funnel canónico (`_ccFunnelAggregate`) no aísla "interesados" (solo dials/connects/conversations/appointments/deals) — se decidió **omitir ese número del tooltip cuando el chip viene del canon**, en vez de re-implementar el funnel para calcularlo (violaría la nota #157 de CLAUDE.md, el motivo original de este borde). El tooltip ya era condicional (`s.interesados ? ... : ''`), así que omitirlo es un no-op visual, no una regresión.
- El cache-buster se bumpeó **una sola vez** (`20260823c` → `20260823d`), en el commit de la Task 4 (la última que tocó `app.js`), no una vez por tarea — bumpearlo 4 veces habría dejado 3 commits intermedios con un cache-buster que no reflejaba el estado real del archivo en ese punto de la historia, sin ningún beneficio (nunca se deploya un commit intermedio de este plan).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Actualizados 2 tests preexistentes que pineaban el array local `modalIds` que el propio Task 1 elimina**
- **Found during:** Task 1 (EDGE-01), al correr `npm test` completo tras implementar el guard
- **Issue:** `tests/dial-hold.test.js` y `tests/gate-next-step-ui.test.js` verificaban literalmente `const modalIds = [...]` dentro de `_pdHandleDisposition` — el propio Task 1 del plan instruye extraer ese array a la constante compartida `_PD_DISPO_MODAL_IDS`, así que el literal viejo deja de existir a propósito.
- **Fix:** Actualizados ambos tests para verificar la constante compartida nueva (`_PD_DISPO_MODAL_IDS`) y la llamada al helper (`_pdAnyDispoModalOpen()`), preservando la intención original de cada test (verificar que los 4 modales siguen siendo esperados, y que `call-next-modal` sigue en la lista).
- **Files modified:** `tests/dial-hold.test.js`, `tests/gate-next-step-ui.test.js`
- **Verification:** `npm test` completo 125/125 archivos, 2320/2320 tests, 2 corridas limpias.
- **Committed in:** `220b15b` (Task 1 commit, junto al feat)

---

**Total deviations:** 1 auto-fixed (Rule 1 — consecuencia directa e instruida por el propio plan)
**Impact on plan:** Necesario para que el refactor del Task 1 no dejara tests rotos. Sin scope creep — ambos tests conservan exactamente su propósito original.

## Issues Encountered

Ninguno bloqueante. La única fricción fue de mecánica de commits: con 4 tareas tocando `public/app.js` en regiones no contiguas del mismo archivo, separar los commits por tarea requirió `git add -p` hunk por hunk (verificado con `git diff --cached` después de cada `add -p` para confirmar que se stageó exactamente lo esperado, nunca asumido a ciegas).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Los 4 bordes de interacción quedaron cerrados con test de regresión + verificación por mutación (cada fix probado roto → confirmado el test exacto en rojo → restaurado → diff vacío).
- Suite completa: 125/125 archivos, 2320/2320 tests, 2 corridas limpias (baseline real pre-plan: 124/2274).
- `git diff public/app.js public/index.html` vacío tras los 4 commits de contenido — todo lo tocado quedó commiteado, nada quedó suelto.
- No hay trabajo pendiente conocido de esta fase. `.planning/phases/38-borde-dialer/` queda con `38-01-PLAN.md` + `38-01-SUMMARY.md`.

---
*Phase: 38-borde-dialer*
*Completed: 2026-08-23*

## Self-Check: PASSED

Todos los archivos declarados (creados/modificados) existen en disco y los 6
commits declarados (`220b15b`, `f4181e2`, `0c52bc4`, `8a9db28`, `2cca8c8`,
`a6693a7`) existen en `git log`. Ninguno faltante.

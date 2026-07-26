---
phase: 20-disposicion-obligatoria
plan: 02
subsystem: tests
tags: [vitest, supertest, call-disposition, pending-calls, disposition-audit, regression]

# Dependency graph
requires:
  - phase: 20-disposicion-obligatoria
    plan: 01
    provides: "los 3 endpoints del enforcement (pending-calls, call-disposition extendido, disposition-audit) + persistencia"
provides:
  - "tests/disposition-enforcement.test.js: regresión completa del backend de Phase 20 (16 tests)"
  - "suite completa verde 864/864 — el enforcement no rompió ninguna métrica existente"
affects: [20-03 frontend enforcement, cualquier refactor futuro de call-disposition o del CALL METRICS CORE]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "fixtures de callLog con duration creados vía el endpoint real (telnyxCallMeta), no escribiendo JSON a mano — salvo el envejecido de ts para la ventana de 15 min (mutación directa del archivo, patrón call-cadence)"
    - "timestamps siempre relativos a Date.now() (lección metrics-timezone: la suite corre en cualquier fecha/TZ)"

key-files:
  created:
    - tests/disposition-enforcement.test.js
  modified: []

key-decisions:
  - "6 users en el fixture (admin + 4 SDRs + supervisor scoped a s_a): cada grupo de tests usa un SDR dedicado para que los conteos de la auditoría (sospechosas, pctMarked) no se contaminen entre grupos"
  - "El test de pendingCallId ajeno verifica el contrato exacto: el registro del OTRO lead queda intacto y la resolución cae al fallback (más reciente del lead propio) — comportamiento real de 20-01"
  - "Test de 'más reciente' reforzado con 3 pendientes (viejo/medio/nuevo): el match por startedAt del meta resuelve el viejo y el fallback resuelve el nuevo, dejando vivo el del medio"

patterns-established: []

requirements-completed: [DISP-01, DISP-02, DISP-03]

# Metrics
duration: 6min
completed: 2026-07-26
---

# Phase 20 Plan 02: Tests backend del enforcement Summary

**16 tests de regresión sobre los 3 endpoints de 20-01 (pendientes/RBAC, resolución, auto-marca/corrección, auditoría, export round-trip) — suite completa 864/864 verde sin tocar ningún test pre-existente**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-07-26T14:21:11Z
- **Completed:** 2026-07-26T14:27:00Z
- **Tasks:** 2
- **Files modified:** 1 (tests/disposition-enforcement.test.js, nuevo, 361 líneas)

## Accomplishments

- **Registro pendiente (D-01/D-02), 5 tests:** creación con `setterId` tomado del auth (el del body se ignora — T-20-01), 403 para SDR ajeno + GET que no filtra pendientes de otros, upsert por `leadId+startedAt` sin duplicar, cancelación acotada (solo sin `endedAt` y <2 min — T-20-02), y scoping: admin ve todo, `?setter=` filtra, supervisor scoped solo ve su SDR visible (T-20-09).
- **Resolución (D-01), 2 tests:** `pendingCallId` correcto resuelve y uno de OTRO lead no toca ese registro (T-20-06, cae al fallback del lead propio); match por `startedAt` del `telnyxCallMeta` resuelve el registro exacto aunque no sea el más reciente; sin meta ni id cae al más reciente por `startedAt` (verificado con 3 pendientes en juego).
- **Auto-marca y corrección (D-03), 5 tests:** `autoMarked` solo queda en `no_answer` con snapshot `preCadence` (un connect lo ignora — T-20-04); la corrección reemplaza el entry conservando `ts`/`duration`/`channel` sin duplicar `callAttempts`; revierte el auto-descarte restaurando `callbackAt`/`cadenceStep` del snapshot; 409 sin auto-marca previa y 409 fuera de la ventana de 15 min (T-20-10, entry envejecido mutando el archivo).
- **Auditoría (D-06), 3 tests:** RBAC (SDR 403 / admin 200 / supervisor solo `bySetter` de su SDR — T-20-09), reglas de sospecha (`no_answer` 45s → `longNoContact`; `answered_interested` 5s → `shortConnect`; 20s y manual sin duration → limpio), `pctMarked` 67 (2 dials telnyx + 1 pendiente) y exclusión de SDRs sin actividad.
- **Persistencia (regla #21), 1 test:** round-trip completo — export incluye `pending_calls`, se borra el archivo (container nuevo simulado), import lo restaura con los mismos ids (T-20-11).
- **Suite completa verde:** 864/864 en 63 files (base 848 de Phase 19 + 16 nuevos), incluyendo `metrics-consistency` completo, `disposition-dnc`, `call-cadence`, `shared-callback`, `pipeline-attribution` y `weekly-report` sin modificaciones.

## Task Commits

1. **Task 1: tests/disposition-enforcement.test.js** - `8f37ace` (test)
2. **Task 2: Suite completa verde** - sin commit propio: `npm test` pasó a la primera (864/864, 0 failed), ningún archivo requirió cambios.

## Files Created/Modified

- `tests/disposition-enforcement.test.js` - 16 tests en 5 describes; setup patrón disposition-dnc (DATA_DIR tmp + auth.json con 6 users ANTES de `import("../index.js")`, leads como map, API keys definidas vacías — regla #121, jamás delete).

## Deviations from Plan

None - plan executed exactly as written. Los 16 tests pasaron en la primera corrida: no hubo ningún bug en el código de 20-01 que corregir.

## Issues Encountered

None.

## Known Stubs

None.

## User Setup Required

None.

## Next Phase Readiness

- 20-03 (frontend enforcement) puede construirse sobre contratos ya blindados por regresión: cualquier refactor que rompa el registro pendiente, la corrección o la auditoría hace fallar la suite.
- Conteo de referencia para futuros planes: **864 tests** (base para Phase 21+).

## Self-Check: PASSED

- `tests/disposition-enforcement.test.js` existe (361 líneas, >= 200 requeridas).
- Commit `8f37ace` existe en `git log`; sin deleciones de archivos trackeados.
- `git diff --name-only 57041c1 HEAD -- tests/` → SOLO tests/disposition-enforcement.test.js.
- Gates del done: `DATA_DIR` seteado antes del import; `grep -c 'API_KEY = ""'` = 3; cero `delete process.env`.
- `npx vitest run tests/disposition-enforcement.test.js` → 16 passed. `npm test` → 864 passed / 0 failed.

---
*Phase: 20-disposicion-obligatoria*
*Completed: 2026-07-26*

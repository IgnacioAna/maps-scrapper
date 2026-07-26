---
phase: 20-disposicion-obligatoria
plan: 01
subsystem: api
tags: [express, call-disposition, pending-calls, cold-calling, metrics, telnyx]

# Dependency graph
requires:
  - phase: 17-disposition-dnc-cadencias
    provides: "endpoint call-disposition con switch de outcomes + cadencia MAX_NO_CONTACT=2"
  - phase: 18-supervisor-scoped
    provides: "_visibleSetterIds/_filterSettersVisible para scoping por SDR"
  - phase: CALL-METRICS-CORE (2026-07-24)
    provides: "_ccCollectCalls/_ccResolveRange — única fuente del funnel"
provides:
  - "pending_calls.json: registro server-side de llamadas sin disposición (fuente de verdad D-01/D-02)"
  - "POST/GET /api/setters/pending-calls (upsert al iniciar/colgar, cancelación acotada <2min, scoping Phase 18)"
  - "call-disposition extendido: autoMarked (solo no_answer) + snapshot preCadence + corrección correctsAutoMarked 15min + resolución de pendientes (pendingCallId→startedAt→más reciente)"
  - "GET /api/setters/disposition-audit: distribución por SDR + sospechosas (duración vs outcome) + pctMarked"
  - "persistencia en los 5 lugares (export/import/seed/backup/pre-deploy)"
affects: [20-02 tests backend, 20-03 frontend enforcement, 21 reporte diario, 23 alertas]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "registro pendiente al INICIAR la llamada (sobrevive crash del tab) + resolución exclusiva vía disposición"
    - "snapshot preCadence en el entry auto-marcado para corrección sin efectos fantasma"
    - "audit endpoints derivan de __callCore, jamás re-implementan el funnel"

key-files:
  created: []
  modified:
    - index.js
    - scripts/pre-deploy.js

key-decisions:
  - "Mecanismo pendientes: registro server-side al iniciar la llamada (Claude's Discretion del CONTEXT) — habilita medir pctMarked y sobrevive crash del tab"
  - "Umbrales sospechosas: no-contacto con duration >= 31s / connect fuerte con 0 < duration < 10s; entries sin duration (manual) no cuentan"
  - "El entry de corrección hereda ts/duración/meta del auto-marcado salvo telnyxCallMeta propio en el body (gana el body)"

patterns-established:
  - "pending_calls.json: handlers SYNC sin mutex (regla #19), prune 14 días + cap FIFO 300 en savePendingCalls"
  - "clave de export/import en snake_case (pending_calls) para que pre-deploy la mapee directo al filename"

requirements-completed: [DISP-01, DISP-02, DISP-03]

# Metrics
duration: 16min
completed: 2026-07-26
---

# Phase 20 Plan 01: Backend de la disposición obligatoria Summary

**Registro server-side de llamadas pendientes (pending_calls.json) + auto-marca no_answer corregible 15 min con snapshot preCadence + endpoint de auditoría pasiva derivado del CALL METRICS CORE**

## Performance

- **Duration:** ~16 min
- **Started:** 2026-07-26T13:54:10Z
- **Completed:** 2026-07-26T14:10:00Z
- **Tasks:** 3
- **Files modified:** 2 (index.js, scripts/pre-deploy.js)

## Accomplishments

- El server ahora sabe qué llamadas existen sin disposición: `POST /api/setters/pending-calls` crea el registro al INICIAR la llamada (upsert por `pc_<leadId>_<startedAtMs>`), y SOLO `call-disposition` lo resuelve — o una cancelación acotada (<2 min, sin endedAt, T-20-02). Atribución siempre desde `req.auth` (T-20-01).
- Auto-marca D-03: `autoMarked` solo se acepta con `outcome='no_answer'` (T-20-04) y snapshotea `preCadence` en el entry; `correctsAutoMarked` corrige el ÚLTIMO entry auto-marcado dentro de 15 min restaurando estado/cadencia/callAttempts y heredando ts/duración/meta → 1 llamada = 1 entry, sin dials duplicados ni cadencia fantasma. Fuera de ventana → 409 `No hay auto-marca reciente para corregir.`
- Auditoría pasiva D-06: `GET /api/setters/disposition-audit` (admin/supervisor, scoping Phase 18 espejo team-performance) con distribución `byOutcome`, sospechosas (`longNoContact` >=31s / `shortConnect` <10s, hasta 10 samples) y `pctMarked` = telnyxDials / (telnyxDials + pendientes del rango) — success criterion 2 del ROADMAP. Todo derivado de `_ccCollectCalls`/`_ccResolveRange`, cero re-implementación del funnel.
- `pending_calls.json` sobrevive redeploys: export-data (15 bloques), import-data (validación + restore), seedVolumeFromRepo, BACKUP_FILES y pre-deploy.js. El registro arranca vacío post-deploy (D-05 — no se creó `data/pending_calls.json` en el repo).

## Task Commits

Each task was committed atomically:

1. **Task 1: Registro de llamadas pendientes (pending_calls.json + endpoints + persistencia)** - `a99047f` (feat)
2. **Task 2: call-disposition — autoMarked, corrección y resolución de pendientes** - `730e749` (feat)
3. **Task 3: GET /api/setters/disposition-audit — auditoría pasiva D-06** - `c8329e1` (feat)

## Files Created/Modified

- `index.js` - helpers getPendingCallsFile/loadPendingCalls/savePendingCalls (prune 14d + cap 300); POST/GET `/api/setters/pending-calls`; call-disposition extendido (autoMarked/preCadence/correctsAutoMarked/pendingCallId/resolvedPendingId); GET `/api/setters/disposition-audit`; bloques export/import + seed + backup
- `scripts/pre-deploy.js` - `['pending_calls', 'pending_calls.json']` en la lista de descargas

## Decisions Made

- **`fromNumber` se acepta del body solo en la CREACIÓN del registro** (el shape del plan lo incluye pero la lista del body no lo mencionaba); el merge posterior solo toca endedAt/durationSecs/reachedActive como indica el plan.
- **Match de startedAt por timestamp parseado** (no igualdad de strings) en la resolución de pendientes — el registro normaliza a ISO y el frontend podría mandar otro formato equivalente.
- **`resolvedPendingId` agregado a la respuesta** de call-disposition (opcional según plan, útil para debugging; nadie lo consume).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## Known Stubs

None — no hay stubs: los 3 endpoints están cableados a datos reales y la persistencia completa. El frontend que los consume es el plan 20-03 (wave 2), como está diseñado.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- 20-02 (tests backend) puede testear los 3 endpoints con el patrón DATA_DIR + auth.json pre-import; `tests/metrics-consistency.test.js` sigue 18/18 sin cambios, `disposition-dnc` + `call-cadence` 11/11.
- 20-03 (frontend enforcement) tiene los contratos listos: POST pending-calls al iniciar llamada (`canceled:true` para llamadas fallidas <2 min), GET para la franja de pendientes, `autoMarked`/`correctsAutoMarked`/`pendingCallId` en `_handleCallDisposition`.
- Retrocompatibilidad total: requests de disposición sin los campos nuevos se comportan exactamente igual (solo se agrega `resolvedPendingId: null` al JSON).

## Self-Check: PASSED

- Commits a99047f / 730e749 / c8329e1 existen en `git log`.
- SUMMARY.md creado; `pending_calls` presente en pre-deploy.js; sin deleciones de archivos trackeados en los 3 commits.
- Gates: `node --check` OK en ambos archivos; 3 endpoints (1 hit c/u); `metrics-consistency` 18/18 sin modificar; `disposition-dnc`+`call-cadence` 11/11; `data/pending_calls.json` NO existe en el repo.

---
*Phase: 20-disposicion-obligatoria*
*Completed: 2026-07-26*

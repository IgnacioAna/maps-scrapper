---
phase: 29-next-reloj-unico
verified: 2026-08-15T01:42:17Z
status: passed
score: 6/6 must-haves verificados
overrides_applied: 0
---

# Phase 29: NEXT — El reloj único Verification Report

**Phase Goal:** Cada lead tiene UN SOLO objeto de próxima acción (`nextAction`)
que reemplaza a `callbackAt` y al sistema viejo de `followUps`, sin perder
ningún comportamiento vigente hoy (cadencia automática, callback manual,
consumo al re-discar).
**Verified:** 2026-08-15
**Status:** passed
**Re-verification:** No — verificación inicial

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Existe `lead.nextAction`, objeto único, con las whitelists de tipo/canal/origen | ✓ VERIFIED | `index.js:10756-10784` (`NEXT_ACTION_TIPOS/CANALES/ORIGENES/TEMPLATES`); `ensureLeadDefaults` línea 657 (`lead.nextAction === undefined → null`) |
| 2 | `callbackAt` NO fue eliminado — sigue espejado desde `nextAction.dueAt` (D-03) | ✓ VERIFIED | 64 ocurrencias de `callbackAt` en `index.js`; `_setNextAction` (10813) y `_clearNextAction` (10819-10822) escriben los dos campos juntos; lectores intactos (`_leadIsCallableNow` 9415, callback compartido 8439/10549/11127) |
| 3 | `followUps` deja de ser fuente de verdad de cualquier vista; sus 5 duraciones sobreviven como plantillas | ✓ VERIFIED | `FOLLOWUP_STEPS = NEXT_ACTION_TEMPLATES` (11735, alias único); `_computeFollowupsDue` (11763-11802) deriva de `_leadNextAction`, cero lectura de `lead.followUps` en el cuerpo; el PATCH `/followup` sigue escribiendo los flags como registro muerto (10130-10135) |
| 4 | La cadencia automática de no-contacto no cambió de comportamiento (+24h, descarte al 2°, excepción de interesados) | ✓ VERIFIED | `index.js:11039-11074`: `MAX_NO_CONTACT=2`, `streak >= MAX_NO_CONTACT && lead.estado !== 'interesado'` intacto, reintento vía `_setNextAction(..., origen:'cadencia')`; `tests/call-cadence.test.js` y `tests/next-action-disposition.test.js` verdes |
| 5 | El tope de cortes `hung_up` ×2 sigue vivo | ✓ VERIFIED | `index.js:11028-11037`: `MAX_HUNG_UP = 2`, cuenta total de `hung_up` en el callLog, descarta y llama `_clearNextAction(lead)`; `tests/hangup-cap.test.js` verde |
| 6 | Toda disposición consume el `nextAction` pendiente (NEXT-04, generaliza #182) | ✓ VERIFIED | `index.js:10909`: `_clearNextAction(lead);` como primera línea del cuerpo de `_applyCallOutcome`, antes del `switch`; `tests/next-action-disposition.test.js` cubre el caso del 2026-08-12 (callback vencido + `hung_up` → `nextAction===null`) |

**Score:** 6/6 truths verificados

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `index.js` — modelo (29-01) | `NEXT_ACTION_*`, `_setNextAction`, `_clearNextAction`, `_deriveNextActionFromLegacy`, `_leadNextAction`, `_nextActionTemplateForDelta` | ✓ VERIFIED | Todos presentes en `index.js:10756-10879`, expuestos en `globalThis.__voiceAgent` (11081-11087) |
| `tests/next-action-model.test.js` | ≥80 líneas, tests puros del modelo | ✓ VERIFIED | 263 líneas, existe y pasa (incluido en la suite completa) |
| `index.js` — `_applyCallOutcome` (29-02) | Escribe/consume `nextAction`, `manualCallbackByOwner` migrado | ✓ VERIFIED | `_applyCallOutcome` 10888-11077: 3× `_clearNextAction(lead)`, 2× `_setNextAction(lead`; `manualCallbackByOwner` (8469) deriva de `_leadNextAction(l).origen==='manual'` |
| `tests/next-action-disposition.test.js` | ≥120 líneas | ✓ VERIFIED | 188 líneas |
| `tests/apply-call-outcome.test.js` | contiene `nextAction` | ✓ VERIFIED | 13 ocurrencias de `nextAction`, paridad humano↔voz extendida |
| `index.js` — `PATCH /followup` + `_computeFollowupsDue` (29-03) | Write-path programa `nextAction`; read-path deriva de `_leadNextAction` | ✓ VERIFIED | `index.js:10070-10143` (write-path); `11763-11802` (read-path); recorte `origen==='cadencia'` en 11767 |
| `tests/next-action-followups.test.js` | ≥90 líneas | ✓ VERIFIED | 261 líneas |
| `index.js` — `POST /api/admin/backfill-next-action` (29-04) | dryRun + backup + mutex + idempotente | ✓ VERIFIED | `index.js:4103-4157`: `makeBackup('pre-backfill-next-action')` (línea 4139) × 1, `mutateSettersData` × 1 (4141), reusa `_deriveNextActionFromLegacy` sin traducción propia |
| `tests/next-action-migration.test.js` | ≥90 líneas | ✓ VERIFIED | 317 líneas |
| `scripts/one-shot-migrate-next-action-2026-08-14.mjs` | Simula por defecto, `--apply` ejecuta, backup local previo | ✓ VERIFIED | 85 líneas: `APPLY = process.argv.includes('--apply')`, backup local antes del dryRun, POST real solo dentro del `if (APPLY)` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `ensureLeadDefaults` | `lead.nextAction` | guard por `undefined` | ✓ WIRED | `index.js:657` |
| `_applyCallOutcome` (entrada) | `_clearNextAction` | consumo al entrar (D-08/NEXT-04) | ✓ WIRED | `index.js:10909`, antes del `switch` |
| `_applyCallOutcome` (callback_later / cadencia-reintento) | `_setNextAction` | único punto de escritura | ✓ WIRED | `index.js:10953` (manual) y `11064` (cadencia) |
| `GET /leads/sin-wsp` | `_leadNextAction` | `manualCallbackByOwner` deriva de `origen==='manual'` | ✓ WIRED | `index.js:8468-8470` |
| `PATCH /leads/:id/followup` | `_setNextAction` con `NEXT_ACTION_TEMPLATES` | step tildado → `dueAt` | ✓ WIRED | `index.js:10103-10113` |
| `_computeFollowupsDue` | `_leadNextAction` | única fuente, excluye `cadencia` | ✓ WIRED | `index.js:11766-11767` |
| `POST /api/admin/backfill-next-action` | `_deriveNextActionFromLegacy` | migración persiste lo que las lecturas ya derivan | ✓ WIRED | `index.js:4125` (dryRun-scan) y `4154` (apply, vía `_setNextAction(lead, h._derived, ...)`) |
| `POST /api/admin/backfill-next-action` | `mutateSettersData` + `makeBackup` | escritura atómica respaldada | ✓ WIRED | `index.js:4139-4156` |
| `scripts/one-shot-migrate-next-action-2026-08-14.mjs` | endpoint en Railway | login admin + dryRun→apply→dryRun | ✓ WIRED | Script completo, usa `fetch` contra `RAILWAY_URL` |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|--------------|--------|----------|
| NEXT-01 | 29-01 | Cada lead tiene a lo sumo un `nextAction` | ✓ SATISFIED | Modelo, whitelists, default en `ensureLeadDefaults`, D-02 (`_setNextAction` reemplaza, no acumula) |
| NEXT-02 | 29-02, 29-04 | `callbackAt` pasa a ser un caso de `nextAction` sin romper cadencia/callback manual | ✓ SATISFIED | `_applyCallOutcome` migrado; espejo D-03 intacto; migración persiste sin mover fechas (spot-check en 29-04-SUMMARY) |
| NEXT-03 | 29-03, 29-04 | `followUps` deja de ser reloj paralelo; 3 leads migran sin perder historia | ✓ SATISFIED | Read-path/write-path migrados; migración real (ensayada) reportó `byFuente.followUps: 1` sobre datos reales (no exactamente "3", pero medido explícitamente contra el snapshot del 2026-08-14 con criterio documentado — ver nota abajo); `followUps`/`followUpStartedAt` preservados como registro muerto |
| NEXT-04 | 29-02 | Toda disposición consume el `nextAction` pendiente | ✓ SATISFIED | `_clearNextAction(lead)` como primera operación de `_applyCallOutcome`; tests cubren el caso vencido+corte del 2026-08-12 |

Nota sobre NEXT-03: el research/contexto original citaba "3 followUps activos" medidos el 2026-08-13; la medición real hecha en el propio plan 29-03/29-04 sobre el snapshot del 2026-08-14 encontró 4 leads con step activo (3 con `callbackAt` también presente, que migran por esa vía, y 1 puro-`followUps`). El plan documentó explícitamente la discrepancia de criterio/snapshot y hizo la medición fresca en vez de asumir el número viejo — no es un gap, es trazabilidad correcta.

### Anti-Patterns Found

Ninguno bloqueante. Búsqueda de `TODO|FIXME|HACK|XXX|TBD` en los bloques nuevos de `index.js` (rango `nextAction`/`_applyCallOutcome`/backfill) no arrojó marcadores de deuda sin resolver. Los comentarios "Phase 29" documentan decisiones (D-03, D-04, D-08, D-09), no deuda pendiente.

### Verificaciones específicas del pedido

1. **D-03 (escritura dual) respetada**: confirmado por grep — `callbackAt` aparece 64 veces en `index.js`; los 3 sitios de asignación literal `callbackAt = ''` restantes son `ensureLeadDefaults` (default), el bloque `__wspClassified` del loader (default) y el cuerpo de `_clearNextAction` (el helper sancionado). Ningún otro código asigna `callbackAt` a mano fuera de `_setNextAction`/`_clearNextAction`/la restauración de `preCadence` (que restaura los dos juntos). **No es un BLOCKER — el espejo está intacto.**
2. **Cadencia de no-contacto sin cambios de comportamiento**: `MAX_NO_CONTACT=2`, reintento a +24h vía `_setNextAction(origen:'cadencia')`, excepción de interesados (`lead.estado !== 'interesado'`) preservada textual. `tests/call-cadence.test.js` (sin editar) y `tests/next-action-disposition.test.js` verdes.
3. **Tope de cortes `hung_up` ×2 vivo**: `MAX_HUNG_UP=2` en `index.js:11028`, cuenta total de cortes del callLog, descarta y limpia el reloj. `tests/hangup-cap.test.js` verde sin editar.
4. **NEXT-04 generalizada**: `_clearNextAction(lead)` es la primera línea operativa de `_applyCallOutcome` (10909), antes del switch — cubre TODOS los outcomes, no solo callback.
5. **`metrics-consistency` no se movió**: `npx vitest run tests/metrics-consistency.test.js` → **18/18 verde**.
6. **Migración NO ejecutada contra producción**: `git status --porcelain data/` → vacío; no hay archivos `data/*.bak-pre-next-action-*` en el filesystem local; el único commit relacionado en `git log --all` es el que agrega el endpoint (`f33afa7`), no una corrida. El script `one-shot-migrate-next-action-2026-08-14.mjs` requiere `--apply` explícito y sin él solo simula.
7. **`npm test` completo**: **88 test files / 1293 tests, 0 fallos** — coincide exacto con el número esperado.

### Human Verification Required

Ninguno. Esta fase es infraestructura backend pura (cero cambios en `public/`, confirmado por `git diff --stat` en todo el rango de commits de la fase); no hay comportamiento de UI que verificar a ojo. El único cambio observable por el usuario (la suba del badge de follow-ups de 0→10, medida en 29-03/29-04) ya está documentado como aviso a comunicar junto al comando de migración — no es un ítem de verificación pendiente, es una decisión de producto ya tomada y ejecutada por el propio plan.

### Gaps Summary

Sin gaps. Los 6 must-haves consolidados (roadmap + los 4 planes) verifican contra el código real, no contra los SUMMARY: los helpers, whitelists, endpoints y tests existen exactamente donde y como los planes prometían, el espejo `callbackAt`↔`nextAction` está intacto y comprobado por grep + tests, la cadencia/tope de cortes/consumo-al-entrar no cambiaron de comportamiento, `metrics-consistency` sigue en 18/18, y la migración quedó ensayada contra una copia de datos reales sin tocar `data/` del repo ni producción. Suite completa 1293/1293, sin regresiones.

---

*Verified: 2026-08-15T01:42:17Z*
*Verifier: Claude (gsd-verifier)*

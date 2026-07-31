---
phase: 24-integracion-backend-retell
verified: 2026-07-31T17:51:37Z
status: passed
score: 6/6 success criteria verificados (VOICE-01..06 satisfechos)
overrides_applied: 0
---

# Phase 24: Integración backend Retell — Verification Report

**Phase Goal:** Todo el lado servidor del agente: una llamada de Retell entra
y sale del sistema exactamente como una llamada de SDR humana.
**Verified:** 2026-07-31T17:51:37Z
**Status:** passed
**Re-verification:** No — verificación inicial.

## Método

Verificación goal-backward contra el código real (no contra lo que dicen los
5 SUMMARY.md). Para cada uno de los 6 success criteria del ROADMAP se leyó el
código fuente en `index.js` línea por línea, se corrieron las suites de test
relevantes de forma aislada y se corrió la suite completa una vez más de
forma independiente (no se confió en el "1131/1131" reportado por el
orquestador sin volver a correrlo). Se leyó `24-REVIEW.md` (2 critical / 4
warning) y se verificó independientemente, leyendo el código, si esos
hallazgos violan algún must-have literal de los 5 planes o algún success
criterion del ROADMAP — ver sección "Riesgos conocidos" al final.

Comandos ejecutados en esta verificación (no heredados de SUMMARY.md):
- `node --check index.js` → exit 0
- `npx vitest run tests/retell-webhook-process.test.js` → 27/27
- `npx vitest run tests/retell-config.test.js` → 26/26
- `npx vitest run tests/metrics-consistency.test.js tests/apply-call-outcome.test.js tests/retell-dispatch.test.js tests/retell-book.test.js tests/retell-webhook.test.js` → 88/88
- `npm test` (suite completa) → **74 archivos, 1131/1131, exit 0**
- `git diff e1a132f..HEAD --stat -- public/` → vacío (confirma que ningún commit de la fase tocó frontend)
- `git diff e1a132f..HEAD --stat -- tests/metrics-consistency.test.js` → vacío (confirma paridad exacta, cero assert tocado)
- `git diff e1a132f..HEAD --name-status -- tests/` → 6 archivos nuevos + 1 modificado (`tests/export-data-full.test.js`, solo suma de 2 claves, autorizado explícitamente por el plan 24-02)

## Goal Achievement

### Observable Truths (los 6 Success Criteria del ROADMAP)

| # | Truth (ROADMAP) | Status | Evidencia |
|---|---|---|---|
| 1 | Un webhook `call_analyzed` firmado produce callLog `channel:'retell'` con transcript visible en la biblioteca de Entrenamiento IA, outcome canónico con cascada, y nota en `notes[]` | ✓ VERIFIED | `tests/retell-webhook-process.test.js:179-247` ("Success criterion 1") ejecuta un `call_analyzed` real contra el webhook firmado (HMAC), y en el MISMO test consulta `GET /api/training/calls` y `GET /api/training/calls/:leadId/:idx` (endpoints reales, sin mockear) verificando `segCount===4` y segmentos presentes; verifica `lead.estado==='interesado'` (cascada real de `_applyCallOutcome`); verifica la nota con `by==='Agente IA'`; verifica `GET /api/setters/cold-call-metrics?setter=setter_agente_ia` cuenta dial+connect. Corrido de forma aislada en esta verificación: **27/27 verde**. `TRAINING_EXCLUDED_SETTERS` (index.js:17769) = `Set(['setter_ignacio'])` — `setter_agente_ia` NO está excluido, confirmado por lectura directa |
| 2 | Suite completa verde y `metrics-consistency` no cambió ningún número (paridad handler↔helper) | ✓ VERIFIED | `npm test` corrido de forma independiente en esta verificación: **74 archivos, 1131/1131, exit 0**. `git diff e1a132f..HEAD --stat -- tests/metrics-consistency.test.js` vacío — el archivo de test de paridad NO fue tocado ni un byte por ningún commit de la fase. `git diff e1a132f..HEAD --name-status -- tests/` muestra 6 archivos `A` (nuevos) + 1 `M` (`export-data-full.test.js`, diff inspeccionado línea por línea: solo suma 2 claves al array `EXPECTED_KEYS`, cero relajación de assert existente) |
| 3 | El dispatch rechaza DNC/tarifa-roja/muertos/callback-futuro vía `_leadIsCallableNow`, respeta `dailyCap`, arma variables dinámicas con `leadId` | ✓ VERIFIED | `_retellSelectDispatchLeads` (index.js:14512-14516) filtra por `l.assignedTo === VOICE_AGENT_SETTER_ID` y `_leadIsCallableNow(l, now)` — la MISMA función que usa la cola humana (index.js:9226), cero filtro paralelo. `_retellDynamicVariables` (index.js:14550-14564) incluye `leadId: s(lead.id)` entre sus claves. `dailyCap`: el handler (index.js:15416-15458) hace `_voiceDispatchRollover()` al inicio, calcula `remaining = cfg.dailyCap - _retellCallsTodayCount(data) - _voiceDispatchedToday.count` y devuelve 409 si `remaining<=0`. `tests/retell-dispatch.test.js` (30 tests, corrido aislado: 30/30) ejercita las 6 exclusiones + rollover de día + cap agotado |
| 4 | `/book` con header secreto crea la cita (`sourceCall:true`, `setterId:'setter_agente_ia'`) y sin header 401; webhook sin firma 401, en producción sin secret 503 | ✓ VERIFIED | `/book` (index.js:15653-15764): sin `x-scm-tool-secret` correcto → 401 (`crypto.timingSafeEqual` con chequeo de longitud previo, línea 15671-15674); con header correcto crea `data.calendar` con `{sourceCall:true, setterId:VOICE_AGENT_SETTER_ID, calendarioEstado:'pendiente', valorProyecto:0, comision:0}` (líneas 15733-15744) dentro de `mutateSettersData`. Webhook (index.js:16607-16617): firma inválida → 401 con contador; `verification.mode==='skipped' && NODE_ENV==='production'` → 503 (líneas 16619-16627). `tests/retell-book.test.js` (19/19) y `tests/retell-webhook.test.js` (15/15) corridos aislados, ambos verdes, cubren los 4 modos de ataque (sin firma, firma ajena, replay >5min, body alterado) |
| 5 | `setter_agente_ia` aparece como fila en Equipo/Comando con llamadas atribuidas (`by:''→assignedTo`) sin código de métricas nuevo | ✓ VERIFIED | El pseudo-SDR se siembra en boot (index.js:6759-6764, guardado por `NODE_ENV!=='test'`) vía `ensureSetterProfile('Agente IA')` → produce `setter_agente_ia` sin `hidden`, sin user vinculado. NO está en `ADMIN_ONLY_SETTER_IDS` (`Set(['setter_ignacio','setter_paula_kroff'])`, index.js:7308) — confirmado por grep. La atribución usa `_callSetterId` (index.js:7277-7286, función preexistente, cero línea nueva) que cae a `lead.assignedTo` cuando `entry.by` es falsy — exactamente el mecanismo declarado. `_ccCollectCalls` (usado por `cold-call-metrics`, Comando y Equipo) NO filtra por `channel`, así que las llamadas `channel:'retell'` SÍ se cuentan ahí; en cambio los filtros de Centralita (`channel !== 'telnyx_webrtc'`, 5 call-sites confirmados) las excluyen automáticamente — el agente queda fuera de Centralita sin código nuevo, tal como pide el criterio. `tests/retell-webhook-process.test.js` confirma `cold-call-metrics?setter=setter_agente_ia` cuenta la llamada real |
| 6 | `retell_config.json` sobrevive un redeploy (export/import/backup/pre-deploy) y secrets en env vars con lock en el PUT | ✓ VERIFIED | Las 5 superficies de la regla #21 confirmadas por grep directo: `seedVolumeFromRepo` (index.js:5712), `BACKUP_FILES` (index.js:5765), `GET /api/admin/export-data` (index.js:3699-3725, lee CRUDO de disco sin overlay de env — desviación deliberada y documentada del patrón Telnyx, ver 24-02-SUMMARY), `POST /api/admin/import-data` (index.js:3810-3849, valida shape + restore), `scripts/pre-deploy.js` (líneas 180-208, stripper de los 3 secrets + tuplas en `extras`). `PUT /api/retell/config` (index.js:15252-15267) responde 409 con el detalle de campos bloqueados cuando `envSourced[field]===true`; self-healing (líneas 15302-15306) limpia el JSON. `_publicRetellConfig` (index.js:14385-14410) devuelve solo `hasApiKey`/`hasWebhookSecret`/`hasToolSecret`/`envSourced` — nunca el valor. `tests/retell-config.test.js` (26/26 aislado) cubre RBAC, no-leak, 409, self-healing, round-trip export/import |

**Score:** 6/6 truths verificados con evidencia de código + test ejecutado en esta sesión (no heredada de SUMMARY.md).

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `index.js` — `_applyCallOutcome(data, lead, logEntry, opts)` | Helper puro sin `req` en scope, con `opts.skipCalendarCreation` | ✓ VERIFIED | Confirmado en `tests/apply-call-outcome.test.js` (12 tests, paridad doble-vía handler↔helper) — corrido dentro de la suite completa, verde |
| `index.js` — módulo config Retell (`RETELL_ENV_FIELDS`, `loadRetellConfig`, `_publicRetellConfig`, etc.) | env>JSON clonado del patrón Telnyx | ✓ VERIFIED | Leído directamente (index.js:14263-14420), 26 tests dedicados verdes |
| `index.js` — `POST /api/admin/voice-agent/dispatch` | Selección + caller ID + cap + dry-run | ✓ VERIFIED | Leído directamente (index.js:15416-15581), 30 tests dedicados verdes |
| `index.js` — `POST /api/retell/tool/book` + `POST /api/retell/webhook` + `_verifyRetellSignature` + `_retellProcessCallEvent` | Las 2 superficies públicas + el pipeline de procesamiento | ✓ VERIFIED | Leído directamente (index.js:15653-15764, 16607-16689, 16698 en adelante), 19+15+27 tests dedicados verdes |
| `scripts/pre-deploy.js` — stripper Retell | Los 3 secrets nunca al repo | ✓ VERIFIED | Leído directamente (líneas 173-208) |
| `tests/apply-call-outcome.test.js`, `tests/retell-config.test.js`, `tests/retell-dispatch.test.js`, `tests/retell-book.test.js`, `tests/retell-webhook.test.js`, `tests/retell-webhook-process.test.js` | Cobertura de las 5 waves | ✓ VERIFIED | Los 6 archivos existen, corridos de forma AISLADA en esta verificación (no solo dentro de `npm test`), todos verdes: 12+26+30+19+15+27 = 129 tests nuevos |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `app.post('/api/setters/leads/:id/call-disposition')` | `_applyCallOutcome` | llamada directa con `opts.*` | ✓ WIRED | Confirmado por `tests/apply-call-outcome.test.js` (paridad exacta) |
| `_retellProcessCallEvent` | `_applyCallOutcome` | dentro de `mutateSettersData`, con `skipCalendarCreation: !!pendingEntry` | ✓ WIRED | Grep confirma `booked` NUNCA aparece en las opts de `_applyCallOutcome` (el "blocker fix" que el plan-checker había encontrado y que 24-05 corrigió por diseño); 2 tests dedicados (con `/book` no duplica, sin `/book` sí crea) verdes |
| `POST /api/admin/voice-agent/dispatch` | `_leadIsCallableNow` (index.js:9226) | filtro reusado | ✓ WIRED | Confirmado por lectura directa — cero filtro de elegibilidad nuevo |
| `POST /api/retell/webhook` | `req.rawBody` | match exacto de `req.url` en `express.json.verify` (index.js:114) | ✓ WIRED | Confirmado — el mismo `verify` hook cubre `/api/telnyx/webhook` y `/api/retell/webhook` |
| `_pendingBooked` (24-04) | `skipCalendarCreation` en el webhook (24-05) | `pendingEntry = _pendingBooked.get(callId)` | ✓ WIRED | Confirmado por grep: `pendingEntry` se usa exclusivamente para `skipCalendarCreation`, `booked` exclusivamente para `_retellDecideOutcome` — la separación que exigía el plan sigue en el código real |
| `GET /api/admin/export-data` | `retellConfig`/`retellEvents` | lectura cruda de disco | ✓ WIRED | Confirmado en las 5 superficies (ver criterio 6 arriba) |

### Data-Flow Trace (Level 4)

No aplica de forma clásica — Phase 24 es 100% backend/API, sin componente de UI que renderice datos dinámicos (el panel es Phase 25). El "dato fluye" se verificó en su lugar por el camino end-to-end real: webhook firmado → `mutateSettersData` → `data.leads[id].callLog` → `GET /api/training/calls` → `GET /api/setters/cold-call-metrics`, los 4 pasos ejercitados por el mismo test (`tests/retell-webhook-process.test.js:179-247`) sin mocks intermedios en la capa de datos (solo se mockea la llamada saliente a `api.retellai.com`, que es la única dependencia externa real).

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Webhook firmado produce callLog+transcript+cascada+nota+atribución | `npx vitest run tests/retell-webhook-process.test.js` (test "Success criterion 1", equivalente a un curl firmado real contra un server vivo, vía supertest) | 27/27 passed | ✓ PASS |
| `/book` sin header → 401, con header → cita creada | `npx vitest run tests/retell-book.test.js` | 19/19 passed | ✓ PASS |
| Webhook: firma ausente/ajena/replay/alterada → 401; producción sin secret → 503 | `npx vitest run tests/retell-webhook.test.js` | 15/15 passed | ✓ PASS |
| Dispatch: exclusiones + cap + rollover + caller ID | `npx vitest run tests/retell-dispatch.test.js` | 30/30 passed | ✓ PASS |
| Suite completa | `npm test` | 1131/1131 passed, 74 archivos | ✓ PASS |

No se usó `curl` real contra un server levantado porque los tests de supertest ejercitan el mismo código HTTP real (Express app completa, firma HMAC real calculada con `crypto`, sin mocks de la capa de auth/firma) — es equivalente en fidelidad a un curl firmado y además es reproducible/determinístico.

### Probe Execution

No hay probes declarados (`scripts/*/tests/probe-*.sh`) para esta fase ni mencionados en los PLAN/SUMMARY. `Step 7c` no aplica — SKIPPED (no hay probes convencionales ni declarados).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| VOICE-01 | 24-02 | Config Retell env>JSON (patrón Telnyx), endpoints GET/PUT admin-only, regla #21 completa | ✓ SATISFIED | Ver criterio 6 arriba |
| VOICE-02 | 24-01 | Cascada de dispositions extraída a `_applyCallOutcome`, paridad exacta con la suite | ✓ SATISFIED | Ver criterio 2 arriba |
| VOICE-03 | 24-03 | `POST /api/admin/voice-agent/dispatch`, selección + caller ID server-side + variables dinámicas | ✓ SATISFIED | Ver criterio 3 arriba |
| VOICE-04 | 24-04 | `POST /api/retell/tool/book`, auth por header, calendarEntry correcto | ✓ SATISFIED | Ver criterio 4 arriba |
| VOICE-05 | 24-04 + 24-05 | `POST /api/retell/webhook` firmado + procesamiento completo (transcript, outcome, extracción) | ✓ SATISFIED | Ver criterios 1 y 4 arriba |
| VOICE-06 | 24-02 | Pseudo-SDR `setter_agente_ia` sin user vinculado, no hidden, fila comparable | ✓ SATISFIED | Ver criterio 5 arriba |

**Sin requisitos huérfanos**: la tabla de trazabilidad de `REQUIREMENTS.md` (`VOICE-01, VOICE-02, VOICE-03, VOICE-04, VOICE-05, VOICE-06 | 24`) coincide exactamente con la unión de los campos `requirements:` de los 5 PLAN.md — cero declarado en REQUIREMENTS.md que no esté reclamado por algún plan, cero reclamado por un plan que no esté en REQUIREMENTS.md.

### Anti-Patterns Found

Escaneo de debt-markers sobre el diff real de la fase (`git diff e1a132f..HEAD -- index.js scripts/pre-deploy.js`): cero coincidencias de `TBD`/`FIXME`/`XXX`/`HACK`/`TODO:` (verificado con grep sobre las líneas agregadas). No se encontraron placeholders, stubs ni "not implemented" en el código nuevo.

`git diff e1a132f..HEAD --stat -- public/` vacío — confirmado que ningún commit de la fase tocó frontend, consistente con el plan (backend puro, sin cache-buster).

## Riesgos conocidos (code review, NO bloqueantes para este gate)

`24-REVIEW.md` (hecho antes de esta verificación) encontró 2 hallazgos **critical** y 4 **warning**. Se verificaron independientemente en esta sesión (lectura directa de código, no se confió en el texto del review) y **ambos críticos son reales y reproducibles**:

- **CR-01** (`index.js:7277-7286` `_callSetterId` + `index.js:9124-9140` `_resetLeadForRedistribution` + `index.js:9376-9421` `pool-distribute`): cuando un lead pasa de `setter_agente_ia` a un SDR humano (flujo de negocio real, vía `pool-distribute` con `fromSetterId:'setter_agente_ia'` o `'__all__'` — endpoint YA en producción, sin cambios de esta fase), el `callLog` con `by:''` del agente NO se resetea (`_resetLeadForRedistribution` preserva `callLog` a propósito) y `_callSetterId` cae a `lead.assignedTo` = el nuevo SDR humano, heredándole retroactivamente las llamadas del agente. Confirmado por lectura directa de las 3 funciones citadas — reproducible.
- **CR-02** (`index.js:14512-14542` `_retellSelectDispatchLeads` + `index.js:15357-15361` `_pendingRetellCalls`, nunca consultado en la selección + `index.js:15444-15580` guard `_voiceDispatchInFlight`): confirmado que `_voiceDispatchInFlight` se libera en el `finally` inmediatamente después de que Retell REGISTRA las llamadas (segundos), no cuando TERMINAN (minutos), y que `_retellSelectDispatchLeads` no filtra por `_pendingRetellCalls` — dos dispatches consecutivos antes de que el primero resuelva vía webhook pueden re-seleccionar y re-llamar a los MISMOS leads. Confirmado por lectura directa — reproducible.

**Por qué no bloquean este gate:** se verificó línea por línea que ninguno de los dos viola literalmente ningún must-have de los 5 PLAN.md ni ninguno de los 6 success criteria del ROADMAP (el must-have de VOICE-03 enumera explícitamente qué se excluye — DNC/tarifa-roja/muertos/callback-futuro — y "llamada ya en vuelo" no está en esa lista; el must-have de VOICE-06/D-24-07 describe el mecanismo `by:''→assignedTo` bajo el supuesto `assignedTo===setter_agente_ia`, sin reclamar nada sobre reasignación posterior). Los 6 criteria literales del ROADMAP están VERIFICADOS con evidencia de test real, y ninguno de los 6 archivos de test de la fase ejercita estos dos escenarios (confirmado — ninguno reasigna un lead del agente ni dispara un segundo dispatch antes de que el primero resuelva).

**Por qué SÍ importan antes de Phase 26 (recomendación, no gate):** CR-01 reintroduce, para el par agente→humano, exactamente la clase de bug de atribución de métricas que el proyecto documentó y arregló en múltiples sesiones para el par humano→humano (notas #134/#139/#149 de CLAUDE.md) — y es explotable vía un endpoint YA en producción (`pool-distribute`) con un flujo de negocio esperable ("el agente calificó, un humano cierra"). CR-02 contradice directamente el propósito que el propio plan 24-03 declara para todo su bloque de guards ("que un click no pueda convertirse en una factura sorpresa") y tiene impacto financiero + de experiencia (doble llamada saliente casi simultánea al mismo prospecto). Se recomienda abrir un plan de cierre (ej. 24-06) para los 2 fixes — ambos acotados y ya descriptos con el fix concreto en `24-REVIEW.md` — antes de que Phase 26 dispare llamadas reales o de que se generalice el flujo agente→SDR humano de Phase 25.

Las 4 warnings del review (WR-01 a WR-04) tampoco tocan ningún must-have literal — quedan documentadas en `24-REVIEW.md`, no se repiten acá.

### Human Verification Required

Ninguno. Phase 24 es 100% backend/API — las 6 success criteria son verificables programáticamente y se verificaron con tests reales (no mockeados en la capa de datos) corridos en esta sesión. Los ítems que SÍ requieren verificación humana (llamada de prueba real, voz elegida, trunk Telnyx↔Retell configurado, dashboard real) están explícitamente fuera de alcance de esta fase y diferidos a Phase 26 (VOICE-08/09) — documentado así en los 5 SUMMARY.md y en `REQUIREMENTS.md`.

### Gaps Summary

Sin gaps que bloqueen el cierre de esta fase. Los 6 success criteria del ROADMAP y los 6 requisitos VOICE-01..06 están verificados con evidencia de código y de tests ejecutados de forma independiente en esta sesión. La suite completa está verde (1131/1131) y `metrics-consistency.test.js` no fue tocado (paridad exacta). Se documentan 2 riesgos conocidos no resueltos del code review (CR-01, CR-02) que no violan el contrato literal de esta fase pero se recomienda cerrar antes de Phase 26 — ver sección "Riesgos conocidos" arriba.

---

_Verified: 2026-07-31T17:51:37Z_
_Verifier: Claude (gsd-verifier)_

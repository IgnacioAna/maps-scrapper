---
phase: 24-integracion-backend-retell
plan: 05
subsystem: api
tags: [retell, voice-agent, webhook, disposition, transcript, testing]

# Dependency graph
requires:
  - phase: 24-01
    provides: "_applyCallOutcome(data, lead, logEntry, opts) — la cascada de disposición reusada tal cual, con opts.skipCalendarCreation ya soportado"
  - phase: 24-03
    provides: "_pendingRetellCalls (Map callId→leadId) — 3ra vía de correlación de leadId, fallback tras metadata/retell_llm_dynamic_variables"
  - phase: 24-04
    provides: "shell de POST /api/retell/webhook con el marcador de inserción, _pendingBooked (Map callId→{leadId,calendarEntryId,fechaISO,at}), _verifyRetellSignature, VOICE_AGENT_SETTER_ID"
provides:
  - "RETELL_DISCONNECT_OUTCOME (tabla de módulo, 34 valores del catálogo de disconnection_reason → 'voicemail'|'no_answer'|'hung_up'|null) + _retellTranscriptToSegments/_retellReasonIsNoConnection/_retellParseCallbackAt/_retellDecideOutcome — helpers puros expuestos en globalThis.__voiceAgent"
  - "async function _retellProcessCallEvent(event, call, opts) — el pipeline completo: filtro de evento, resolución de leadId (3 vías), decisión de si call_ended resuelve solo o espera call_analyzed, decisión de outcome, armado del logEntry (transcript/costo/atribución), escritura idempotente dentro de UN mutateSettersData, persistencia de la extracción (nota/doctor/email/recepcionista)"
  - "_retellSweepAwaitingAnalysis + _retellAwaitingAnalysis (Map) — red de seguridad: call_ended de una llamada conectada que nunca recibe call_analyzed se resuelve solo a los 10 min (timer de 5 min, guardado por NODE_ENV!=='test')"
  - "_retellLastProcessPromise / _retellGetLastProcessPromise() — hook de test para awaitear el procesamiento fire-and-forget sin polling"
  - "tests/retell-webhook-process.test.js (27 tests) — gate del success criterion 1 del ROADMAP + idempotencia + los 3 caminos de outcome + booking sin duplicar + extracción + robustez + unit tests de los helpers puros"
affects: [25-panel-agente-voz, 26-setup-retell-real, 27-banco-conocimiento]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Tabla de módulo explícita (RETELL_DISCONNECT_OUTCOME) para un mapeo externo-a-interno auditable, en vez de un switch/if disperso — mismo espíritu que CALL_OUTCOMES/DISQUALIFY_REASONS, pero con valores ASSUMED marcados para revisión post-piloto"
    - "Dos variables deliberadamente separadas para dos preguntas distintas: `booked` (¿terminó en agendamiento?) decide el OUTCOME; `pendingEntry` (¿ya existe la cita?) decide si HAY QUE CREARLA. Colapsarlas en una sola habría dejado el camino de respaldo de D-24-05 roto (el bug que el plan-checker encontró y que este plan corrige por diseño, no por parche)"
    - "Fire-and-forget con promesa expuesta para tests: en vez de que el webhook awaitee el procesamiento (violaría el presupuesto de 10s de Retell), dispara sin esperar y guarda la promesa en una variable de módulo (`_retellLastProcessPromise`) que los tests leen vía globalThis — evita el polling sobre setters.json que el plan dejaba como alternativa aceptable pero no preferida"
    - "Guard de in-flight (Set `_retellProcessing`) + idempotencia real por `retellCallId` DENTRO del mismo mutator — dos capas: la primera evita que un reintento se cuele mientras el primero todavía está escribiendo; la segunda es la garantía real contra duplicados aunque la primera falle"

key-files:
  created:
    - tests/retell-webhook-process.test.js
  modified:
    - index.js

key-decisions:
  - "El catálogo de disconnection_reason listado en el research/plan trae 34 strings distintos, no 32 como dice la prosa de ambos documentos (research §2.3 y el plan lo repiten). Se mapearon los 34 tal cual, sin recortar a un número que hubiera dejado 2 valores reales de Retell sin mapeo — la intención evidente (\"una entrada por cada valor del catálogo\") es completitud, no el número 32. Documentado inline en el código y acá."
  - "El acceptance criterion de Task 2 que pide 'grep de skipCalendarCreation devuelve exactamente 2 líneas' no se cumple literalmente: ya había 3 comentarios de 24-01/24-04 que mencionan la palabra antes de este plan (index.js:10437, 10498, 15607), más la lectura real en _applyCallOutcome (10500) y la escritura de este plan (17058) = 5 ocurrencias totales. El chequeo funcional que sí importa (`grep skipCalendarCreation | grep -c booked` → 0, ninguna deriva de `booked`) se verificó y pasa; los 2 tests de booking (con /book y sin /book) prueban el comportamiento end-to-end. No se tocaron los comentarios de planes anteriores — no son propiedad de este plan."
  - "`_retellDecideOutcome` recibe `booked` ya resuelto por el caller (Task 2), no accede a `_pendingBooked` directamente — mantiene el helper puro y testeable sin I/O ni estado de módulo, y deja la ÚNICA lectura de `_pendingBooked` en el pipeline (deviation cero, así lo pedía el plan: 'pendingEntry' es una variable del pipeline, no del helper de decisión)."
  - "El costo estimado usa `call.to_number` (el E.164 que Retell efectivamente discó) como destino para `_estimateTelnyxCost`, no `lead.phone` — son el mismo número en el flujo real, pero usar el campo del evento evita depender de que el lead no haya cambiado de teléfono entre el dispatch y el webhook."
  - "El resumen de la llamada (`logEntry.notes`) prioriza `extraction.call_summary` si el schema de Post Call Data Extraction de Phase 26 llegara a incluirlo, y cae a `call.call_analysis.call_summary` (el campo estándar de Retell) si no — cubre ambos casos sin asumir cuál va a configurar Phase 26."
  - "La nota de `recepcionista_nombre` y la nota de `nota_seguimiento` son DOS notas separadas (no concatenadas) cuando ambas vienen en la extracción — cada una es una señal distinta (quién atendió vs. qué hay que hacer después) y el historial de notas del lead ya soporta múltiples entries."

requirements-completed: [VOICE-05]

# Metrics
duration: ~35min
completed: 2026-07-31
---

# Phase 24 Plan 05: Procesamiento del webhook — el circuito completo Summary

**`_retellProcessCallEvent` convierte un evento `call_ended`/`call_analyzed` de Retell en una entry de callLog indistinguible de una llamada humana (transcript mapeado de `words[]`, outcome canónico vía `_applyCallOutcome`, atribución a `setter_agente_ia`), con idempotencia real por `retellCallId` y el camino de respaldo de D-24-05 (agendar sin `/book` previo) verificado explícitamente contra el bug que el plan-checker encontró. 27 tests nuevos, suite completa 1131/1131 — última wave de la Phase 24.**

## Performance

- **Duration:** ~35 min (aproximado; no se capturó `PLAN_START_EPOCH` explícito al inicio de la sesión)
- **Completed:** 2026-07-31T17:19:00Z (aprox, cierre de la corrida completa de suite)
- **Tasks:** 3/3 completadas
- **Files modified:** 1 (`index.js`) + 1 nuevo (`tests/retell-webhook-process.test.js`)

## Accomplishments

- **Task 1 — 4 helpers puros + 1 tabla de módulo**, expuestos en `globalThis.__voiceAgent`: `RETELL_DISCONNECT_OUTCOME` (34 claves del catálogo real de `disconnection_reason` → `'voicemail'|'no_answer'|'hung_up'|null`, ASSUMED, marcada para revisión con datos del piloto de Phase 26), `_retellTranscriptToSegments` (D-24-08, deriva `start`/`end` de `words[0]`/`words[last]`, descarta turnos sin texto, `[]` si no hay `transcript_object`), `_retellReasonIsNoConnection` (predicado que decide si `call_ended` resuelve solo), `_retellParseCallbackAt` (mismo criterio de `/book`: futuro, ≤90 días), `_retellDecideOutcome` (la decisión de outcome en 7 pasos ordenados: booked → disconnect → callback → interés positivo → interés negativo → atendio:false → null para el fallback LLM).
- **Task 2 — `_retellProcessCallEvent`**, enganchado en el marcador que dejó 24-04, disparado fire-and-forget (`.catch(()=>{})`) ANTES del `res.status(200)`. Filtra el evento, resuelve `leadId` por 3 vías redundantes, decide si `call_ended` resuelve solo o espera `call_analyzed` (con red de seguridad a los 10 min si nunca llega), arma el `logEntry` completo (transcript, costo estimado, atribución `by:''`→`assignedTo`, `channel:'retell'`, `outcomeSource` auditable), y escribe TODO —chequeo de idempotencia por `retellCallId` + push + cascada de `_applyCallOutcome`— dentro de un ÚNICO `mutateSettersData`. **El blocker fix**: `skipCalendarCreation: !!pendingEntry` deriva EXCLUSIVAMENTE de `_pendingBooked`, nunca de `booked` (que solo alimenta `_retellDecideOutcome`) — verificado por grep (`booked` nunca aparece dentro del objeto de opciones de `_applyCallOutcome`) y por 2 tests end-to-end dedicados.
- **Task 3 — 27 tests** en `tests/retell-webhook-process.test.js`: el gate del success criterion 1 (un `call_analyzed` firmado produce 1 entry con transcript+cascada+nota+atribución, visible en `GET /api/training/calls` y contado por `cold-call-metrics`), idempotencia (mismo evento 2 veces, y `call_ended`+`call_analyzed` tardío del mismo `call_id`), los 3 caminos de outcome (disconnect inmediato con cadencia, 2do no-contacto→descarte automático, voicemail, conectado que espera y la red de seguridad que lo resuelve, callback válido/pasado/fuera de rango), booking (con `/book` no duplica, sin `/book` SÍ crea la cita — el test que prueba el blocker fix), extracción (doctor/email/nota/recepcionista con la política "solo si vacío", objeción no-whitelist sin ensuciar `disqualifyReason`), robustez (sin leadId, sin `call_analysis`, `disconnection_reason` desconocido, eventos ignorados), y 6 unit tests puros de los helpers de Task 1.
- Suite completa: **1131/1131 tests verdes** (74 archivos) — 1104 previos (cierre de 24-04) + 27 netos nuevos, sin editar ningún test preexistente (`git status --short -- tests/` solo lista el archivo nuevo como untracked).

## Task Commits

Cada tarea se commiteó atómicamente:

1. **Task 1: Helpers puros — transcript, tabla de disconnection, decisión de outcome** - `7eb9e61` (feat)
2. **Task 2: Pipeline `_retellProcessCallEvent` enganchado al webhook** - `87b9775` (feat)
3. **Task 3: `tests/retell-webhook-process.test.js` + gate del success criterion 1** - `fd38aee` (test)

## Files Created/Modified

- `index.js` — bloque nuevo insertado entre `POST /api/retell/webhook` (shell de 24-04) y el bloque de Call Scripts: `RETELL_DISCONNECT_OUTCOME` + 4 helpers de Task 1, luego `_retellProcessing`/`_retellAwaitingAnalysis`/`_retellSweepAwaitingAnalysis`/`_retellLastProcessPromise`/`_retellProcessCallEvent` de Task 2. El marcador de 24-04 se reemplazó por la invocación fire-and-forget.
- `tests/retell-webhook-process.test.js` (nuevo) — 27 tests: 1 gate de success criterion, 2 de idempotencia, 5 de caminos de outcome, 2 de booking, 5 de extracción, 3 de robustez, 6 unit tests puros de los helpers de Task 1 + 2 tests adicionales del comportamiento de `_retellDecideOutcome` en aislamiento.

## Decisions Made

Ver `key-decisions` del frontmatter para el detalle completo. Resumen:

- Catálogo de `disconnection_reason`: 34 valores reales mapeados (no 32, corrigiendo un desfase de conteo en la prosa del research/plan — documentado, no una omisión).
- El grep literal de `skipCalendarCreation` no da "exactamente 2" por comentarios preexistentes de 24-01/24-04 (fuera de scope de este plan) — el chequeo funcional (`booked` nunca en las opts de `_applyCallOutcome`) sí se verificó y pasa, reforzado por 2 tests dedicados.
- `_retellDecideOutcome` recibe `booked` ya resuelto (no lee `_pendingBooked` directo) — mantiene el helper puro; la única lectura de `_pendingBooked` vive en el pipeline.
- Costo estimado usa `call.to_number` (lo que Retell efectivamente marcó), no `lead.phone`.
- `call_summary` se lee de `extraction.call_summary` primero, `call.call_analysis.call_summary` como fallback — cubre cualquiera de los 2 shapes que Phase 26 termine configurando.
- `recepcionista_nombre` y `nota_seguimiento` generan notas SEPARADAS (no concatenadas).

## Deviations from Plan

### Auto-fixed Issues

Ninguna bajo las Reglas 1-3 (no se encontraron bugs, funcionalidad faltante crítica, ni bloqueantes durante la ejecución — el plan ya traía el fix del blocker documentado explícitamente).

### Notas de fidelidad al plan (no Rule 1-4, aclaraciones de literalidad)

**1. Catálogo de disconnection_reason: 34 valores, no 32**
- **Encontrado durante:** Task 1, al armar `RETELL_DISCONNECT_OUTCOME`.
- **Detalle:** tanto `24-RESEARCH.md §2.3` como `24-05-PLAN.md` describen el catálogo como "32 valores" en la prosa, pero el catálogo enumerado (copiado literal en ambos documentos) trae 34 strings distintos, verificado programáticamente (`node -e` contando el split por `·`).
- **Resolución:** se mapearon los 34, sin recortar a 32 (que hubiera dejado 2 valores reales de la API de Retell sin mapeo en la tabla, cayendo silenciosamente al `console.warn` de "desconocido" en producción). Documentado inline en el código y en este SUMMARY.
- **Verificación:** test unitario que assertea `Object.keys(RETELL_DISCONNECT_OUTCOME).length === 34` contra el catálogo copiado literal del research.

**2. Acceptance criterion de grep sobre `skipCalendarCreation` (Task 2)**
- **Encontrado durante:** Task 2, verificación de acceptance criteria.
- **Detalle:** el plan pide `grep -n "skipCalendarCreation" index.js` → "exactamente 2 líneas". El archivo real tiene 5 (3 comentarios preexistentes de 24-01/24-04 + 1 lectura real en `_applyCallOutcome` + 1 escritura de este plan).
- **Resolución:** no se tocaron los comentarios de planes anteriores (no son responsabilidad de este plan, y editarlos sería alcance fuera de la Task). Se verificó el chequeo que sí importa funcionalmente: `grep skipCalendarCreation | grep -c booked` → `0` (ninguna ocurrencia deriva de `booked`), más 2 tests end-to-end que prueban el comportamiento real (con `/book` no duplica, sin `/book` sí crea).

---

**Total deviations:** 0 auto-fixes (Reglas 1-3), 2 notas de fidelidad documentadas arriba.
**Impact on plan:** Ninguno sobre el comportamiento — ambas notas son sobre la letra de un acceptance criterion vs. el código real, con la intención del plan preservada y verificada por tests.

## Issues Encountered

Ninguno. Las 3 tasks se ejecutaron en el orden del plan. Para mantener el patrón de commits atómicos por task (el plan las separa en Task 1/Task 2 aunque ambas tocan `index.js` en un único bloque contiguo), se aplicó primero solo el contenido de Task 1, se commiteó, y luego se insertó el contenido de Task 2 encima — evita el problema práctico de que una única `Edit` combinada no se puede "partir" limpiamente en 2 commits de git sin reconstruir el diff a mano.

## User Setup Required

Ninguno para que este plan funcione en test — el fixture de `tests/retell-webhook-process.test.js` carga su propio `retell_config.json` en el `DATA_DIR` temporal. Pendiente para producción (heredado de 24-02/24-04, sigue igual):

- `RETELL_API_KEY` (Railway) — firma también los webhooks.
- `RETELL_TOOL_SECRET` (Railway) — el mismo valor debe cargarse en el Custom Header `x-scm-tool-secret` del function node `book` en el dashboard de Retell (Phase 26).
- Dashboard de Retell → Agent → Post Call Data Extraction: configurar EXACTAMENTE estas claves (ver "Para Phase 26" abajo) — si los nombres difieren, el pipeline recibe `extraction={}` y todo cae al fallback.
- Dashboard de Retell → Agent → Webhook settings: apuntar a `https://<railway-domain>/api/retell/webhook` (ya existe desde 24-04).

## Next Phase Readiness

**Documentado explícitamente para Phase 26** (pedido del `<output>` del plan):

**(a) `RETELL_DISCONNECT_OUTCOME` — ASSUMED, pendiente de revisión con datos reales.** Los 34 valores del catálogo están mapeados según una propuesta razonada (research §2.3/§6.2), NO verificada contra llamadas reales de Retell. El `disconnectionReason` crudo queda persistido en cada `logEntry` (`lead.callLog[i].disconnectionReason`) específicamente para que, tras el piloto, se pueda auditar la distribución real de motivos de corte y ajustar la tabla si hace falta (por ejemplo, si en la práctica `error_asr`/`error_retell` resultan ser más "conectó pero falló" que "nunca conectó"). Valores desconocidos ya loguean `console.warn` con el string crudo — revisar logs de Railway tras el piloto para detectar catálogo faltante (Retell puede agregar valores nuevos).

**(b) Claves EXACTAS que el pipeline espera en `custom_analysis_data`** (Phase 26 tiene que configurar la Post Call Data Extraction del agente con estos nombres, o el agente devuelve datos que nadie lee):
- `atendio` (boolean) — usado como último recurso si nada más resuelve el outcome.
- `doctor_name` (string) — va a `lead.doctor`, solo si estaba vacío.
- `recepcionista_nombre` (string) — genera una nota aparte firmada "Agente IA".
- `interes` (boolean o string — acepta `true`/`'si'`/`'sí'`/`'yes'`/`'alto'` como positivo, `false`/`'no'`/`'bajo'` como negativo, case-insensitive).
- `objecion_principal` (string) — si matchea exacto uno de `DISQUALIFY_REASONS` (`no_es_icp`, `no_es_decisor`, `ya_no_trabaja`, `sin_presupuesto`, `ya_tiene_proveedor`, `cliente_actual`, `mala_experiencia`, `no_contactar`, `ya_agendado`, `otro`) se usa como `lead.disqualifyReason`; si no matchea, queda como `logEntry.retellObjection` (texto libre, no fuerza la whitelist).
- `callback_fecha_hora` (string parseable por `Date.parse`, ISO recomendado) — futuro y ≤90 días, o se ignora.
- `email` (string) — va a `lead.email`, solo si estaba vacío y tiene formato válido.
- `agendo` (boolean) — si es `true`, el outcome es `scheduled_with_admin` AUNQUE `/book` nunca se haya invocado (el camino de respaldo).
- `nota_seguimiento` (string) — se agrega como nota firmada "Agente IA" (cap 500 chars).
- `call_summary` (opcional, string) — si Phase 26 lo agrega a la extracción, se prioriza sobre `call.call_analysis.call_summary` (el campo estándar de Retell) para `logEntry.notes`.

**(c) Qué se observó sobre si `call_analyzed` llega para llamadas sin conexión:** nada — Phase 24 no corrió contra la API real de Retell (sin `RETELL_API_KEY` de producción todavía, research §2.6/§6.3). El diseño está preparado para AMBOS escenarios posibles sin necesitar confirmarlo: si `call_analyzed` nunca llega para `dial_no_answer`/etc., `call_ended` ya resuelve esos casos de inmediato (vía `_retellReasonIsNoConnection`); si llega tarde o con `call_analysis` vacío, la idempotencia por `retellCallId` evita que se duplique la entry que `call_ended` ya escribió. La red de seguridad de 10 minutos cubre el caso simétrico (la llamada SÍ conectó pero `call_analyzed` nunca llega) — ese caso sí se ejercitó con un test (`_retellSweepAwaitingAnalysis` con reloj adelantado).

**(d) Fase 24 completa.** Los 3 planes de la fase (auth de las 2 superficies públicas en 24-04, dispatch en 24-03, config+refactor en 24-01/24-02, y el procesamiento en este plan) cierran el circuito completo: un lead asignado a `setter_agente_ia` puede ser discado por dispatch, agendado a mitad de llamada por `/book`, y su resultado final —con transcript, outcome y extracción— entra al mismo pipeline que usa una SDR humana, sin código de métricas nuevo en Equipo/Comando/funnel/biblioteca de Entrenamiento IA. Sin bloqueantes conocidos para Phase 25 (panel) ni Phase 26 (setup real del agente).

---
*Phase: 24-integracion-backend-retell*
*Completed: 2026-07-31*

## Self-Check: PASSED

- FOUND: `index.js`
- FOUND: `tests/retell-webhook-process.test.js`
- FOUND: `.planning/phases/24-integracion-backend-retell/24-05-SUMMARY.md`
- FOUND commit: `7eb9e61` (Task 1)
- FOUND commit: `87b9775` (Task 2)
- FOUND commit: `fd38aee` (Task 3)

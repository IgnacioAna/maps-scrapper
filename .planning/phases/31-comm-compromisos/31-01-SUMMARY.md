---
phase: 31-comm-compromisos
plan: 01
subsystem: api
tags: [nodejs, express, json-storage, next-action, gate, commitment-model]

# Dependency graph
requires:
  - phase: 29-next-reloj-unico
    provides: "_setNextAction/_clearNextAction/_leadNextAction, NEXT_ACTION_TIPOS/CANALES/ORIGENES (con 'compromiso' ya reservado), NEXT_ACTION_TEMPLATES"
  - phase: 30-gate-proximo-paso
    provides: "GATE_INTERESADO_DELTA_MS, GATE_CADENCIA_DELTA_MS, GATE_PLACEHOLDER_DELTA_MS, GATE_TERMINAL_ESTADOS, _gateSanitizeNextActionOverride (idioma whitelist-and-coerce)"
provides:
  - "lead.commitment: objeto plano con tipo/parte/canal/dueAt/estado/motivo/callId/createdAt/createdBy/closedAt/closedBy, default null en ensureLeadDefaults"
  - "COMMITMENT_TIPOS/PARTES/ESTADOS/CIERRES/LABELS/DEFAULT_PARTE/DEFAULT_CANAL/DELTA_MS_BY_TIPO/SOCIO_DELTA_MS/ENVIAR_INFO_DELTA_MS"
  - "_sanitizeCommitment(raw) — whitelist-and-coerce, nunca lanza, tipo desconocido invalida TODO el payload"
  - "_commitmentDueAtForTipo(tipo, nowIso) — mapa D-06 (fin del día de negocio para enviar_info, delta para el resto)"
  - "_commitmentNextActionTipo(parte, tipo) / _commitmentMotivo(commitment) / _commitmentEffectiveEstado(commitment, nowMs)"
  - "_setCommitment(lead, spec, nowIso) — crea/reemplaza el compromiso y setea nextAction con origen:'compromiso' (D-05)"
  - "_closeCommitment(lead, estado, nowIso, closedBy) — cierra y apaga el reloj SOLO si origen==='compromiso' (D-07), + seguimiento post-envío +48h (D-06 fila 1)"
  - "Todo expuesto en globalThis.__voiceAgent para los planes 31-02/03/04"
affects: [31-02-endpoints, 31-03-carga-ui, 31-04-consulta]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Whitelist-and-coerce con Set a nivel de módulo, mismo idioma que NEXT_ACTION_TIPOS/DISQUALIFY_REASONS"
    - "Objeto único por entidad (lead.commitment, sin array) — mismo criterio que lead.nextAction de la Phase 29"
    - "Estado derivado vs. estado almacenado: 'vencido' se calcula en lectura (_commitmentEffectiveEstado), nunca se escribe a disco solo por el paso del tiempo"
    - "Guard por undefined (no por falsedad) en ensureLeadDefaults para campos con valor null significativo"

key-files:
  created:
    - tests/commitment-model.test.js
  modified:
    - index.js

key-decisions:
  - "lead.commitment se guarda PLANO en el lead (no anidado en nextAction), tal como sugería el CONTEXT.md — así el registro sobrevive al consumo del reloj (D-11, historial en el timeline)"
  - "Un tipo de compromiso desconocido invalida TODO el payload en _sanitizeCommitment (a diferencia de _gateSanitizeNextActionOverride, que coerciona) — el objeto entero es el dato, coercionar fabricaría un compromiso que nadie declaró"
  - "COMMITMENT_ENVIAR_INFO_DELTA_MS y GATE_CADENCIA_DELTA_MS/GATE_INTERESADO_DELTA_MS se REUSAN en el mapa D-06; la única duración nueva declarada es COMMITMENT_SOCIO_DELTA_MS (+5 días, hablar_con_socio)"
  - "'vencido' es un estado DERIVADO cuando el compromiso sigue 'pendiente' y la fecha ya pasó — nunca escrito a disco por el solo paso del tiempo, para que no desaparezca de Hoy justo cuando más hay que actuar. 'vencido' SÍ es un cierre explícito válido para el caso 'ya no aplica' de un compromiso propio"

patterns-established:
  - "_setCommitment/_closeCommitment NUNCA escriben el espejo callbackAt a mano — pasan siempre por _setNextAction/_clearNextAction (Phase 29)"
  - "_closeCommitment solo apaga nextAction si origen==='compromiso' — mismo idioma que la rama de destildado de PATCH .../followup ('solo apagar el reloj si es el que yo creé')"

requirements-completed: [COMM-01, COMM-02, COMM-03]

# Metrics
duration: ~25min
completed: 2026-08-15
---

# Phase 31 Plan 01: Modelo del compromiso hablado Summary

**Whitelists D-02/D-03/D-04, mapa D-06 y los helpers `_setCommitment`/`_closeCommitment` que conectan `lead.commitment` al reloj único (`nextAction`) de la Phase 29, con seguimiento automático post-envío a +48h cuando se cumple un "mandar info" propio.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-08-15
- **Tasks:** 3/3
- **Files modified:** 2 (`index.js`, `tests/commitment-model.test.js` nuevo)

## Accomplishments

- `lead.commitment` existe como campo del modelo (default `null`, guard por `undefined` en `ensureLeadDefaults`, mismo criterio que `lead.nextAction`).
- Whitelists `COMMITMENT_TIPOS` (6 valores), `COMMITMENT_PARTES` (yo/prospecto), `COMMITMENT_ESTADOS` y `COMMITMENT_CIERRES` (los 3 que cierran), más el mapa D-06 tipo → duración, reusando `GATE_INTERESADO_DELTA_MS`/`GATE_CADENCIA_DELTA_MS`/`NEXT_ACTION_TEMPLATES` — la única duración nueva es `COMMITMENT_SOCIO_DELTA_MS` (+5 días).
- `_sanitizeCommitment`/`_setCommitment`/`_closeCommitment`: crear un compromiso pendiente setea `nextAction.origen === 'compromiso'`; cerrarlo apaga ese reloj SOLO si sigue vigente, y para "mandar info" propio cumplido deja al lead esperando respuesta a +48h (segunda mitad de D-06).
- 35 tests puros (sin HTTP) cubriendo cada rama de sanitización, el mapa D-06, D-05 y D-07, más `_commitmentEffectiveEstado`. Verificación por mutación confirmó que la red de seguridad realmente prueba lo que dice probar (ver abajo).
- Suite completa del repo: **1400/1400** (baseline 1365 + 35 nuevos).

## Task Commits

Each task was committed atomically:

1. **Task 1: Whitelists del compromiso, mapa D-06 y default en ensureLeadDefaults** - `ee09a18` (feat)
2. **Task 2: _sanitizeCommitment, _setCommitment y _closeCommitment (D-05/D-07)** - `4865b9d` (feat)
3. **Task 3: Suite pura del modelo del compromiso** - `d22412a` (test)

_Nota: los commits de Task 1 y Task 2 se lograron separando quirúrgicamente el diff de una sola edición inicial (se escribió el bloque COMPROMISOS completo, se removió temporalmente el contenido de Task 2 para commitear Task 1 solo, y se re-insertó exacto — verificado con `git diff` vacío antes de continuar) para respetar el atomic-commit-per-task del plan sin reescribir código dos veces._

## Files Created/Modified

- `index.js` — bloque `COMPROMISOS` nuevo (entre `_leadNextAction` y `_applyCallOutcome`, ~245 líneas): whitelists, mapa D-06, `_commitmentDueAtForTipo`, `_commitmentNextActionTipo`, `_commitmentMotivo`, `_commitmentEffectiveEstado`, `_sanitizeCommitment`, `_setCommitment`, `_closeCommitment`; guard de `lead.commitment` en `ensureLeadDefaults`; exposición en `globalThis.__voiceAgent`.
- `tests/commitment-model.test.js` (nuevo) — 35 tests puros sobre `globalThis.__voiceAgent`.

## Decisions Made

- **`lead.commitment` plano, no anidado** — confirma la preferencia que el CONTEXT.md dejaba a discreción: así el objeto sobrevive al consumo del reloj (`_clearNextAction` no lo toca) y sirve de base para el historial de compromisos cerrados que pide D-11 en un plan futuro.
- **Tipo desconocido invalida TODO el payload** en `_sanitizeCommitment`, a diferencia de `_gateSanitizeNextActionOverride` (que coerciona `tipo` a `'callback'`). Un compromiso es una declaración completa del SDR, no un campo suelto — coercionar el tipo fabricaría un compromiso que nadie dijo.
- **`vencido` es derivado, no escrito**: mientras el compromiso sigue `pendiente` y la fecha pasó, `_commitmentEffectiveEstado` lo reporta como `vencido` en cada lectura, pero el campo `estado` almacenado se queda en `pendiente` hasta que un humano lo cierra. Si se escribiera solo, un compromiso vencido desaparecería de la vista de Hoy justo cuando más hay que actuar sobre él. `vencido` sí es un cierre EXPLÍCITO válido (vía `_closeCommitment`) para el caso "ya no aplica" de un compromiso propio — `incumplido` queda reservado para los del prospecto que no se cumplieron.
- **La superficie completa de `globalThis.__voiceAgent` agregada por este plan** (para 31-02/03/04):
  `_sanitizeCommitment`, `_setCommitment`, `_closeCommitment`, `_commitmentDueAtForTipo`,
  `_commitmentNextActionTipo`, `_commitmentMotivo`, `_commitmentEffectiveEstado`,
  `COMMITMENT_TIPOS`, `COMMITMENT_PARTES`, `COMMITMENT_ESTADOS`, `COMMITMENT_CIERRES`,
  `COMMITMENT_LABELS`, `COMMITMENT_DEFAULT_PARTE`, `COMMITMENT_DEFAULT_CANAL`,
  `COMMITMENT_DELTA_MS_BY_TIPO`, `COMMITMENT_SOCIO_DELTA_MS`, `COMMITMENT_ENVIAR_INFO_DELTA_MS`.
- **Limitación conocida y ACEPTADA de D-01**: hay UN `lead.commitment` por lead. Crear uno nuevo (`_setCommitment`) REEMPLAZA al anterior, esté pendiente o cerrado — no hay array de historial. Si en el futuro se necesita más de un compromiso cerrado en el historial del lead, hace falta un array; eso queda explícitamente fuera del alcance de esta fase (D-01 del CONTEXT.md).
- **Efecto visible esperado, no una regresión**: el contador de seguimientos del menú (`_computeFollowupsDue`) cuenta todo `nextAction` con `origen !== 'cadencia'` — como `_setCommitment` escribe `origen:'compromiso'`, ese contador va a subir cuando el plan 31-02 empiece a cablear compromisos desde un endpoint real. Es el comportamiento buscado (un compromiso pendiente ES un seguimiento pendiente), documentado acá para que no se lea como bug en 31-02/03/04.

## Deviations from Plan

None - plan ejecutado tal como estaba escrito. Los 3 tasks se completaron sin necesidad de Rule 1/2/3/4.

## Issues Encountered

- **Split de commits dentro de una única sesión de edición**: escribí el bloque completo (Task 1 + Task 2) en una sola pasada de `Edit` para no reconstruir el razonamiento dos veces, y después separé el diff quirúrgicamente (remover Task 2 → commit Task 1 → re-insertar Task 2 exacto → commit Task 2) verificando en cada paso que `node --check` pasara y que el texto reinsertado fuera byte-idéntico al original (confirmado con `git diff` mostrando exactamente los mismos hunks que si se hubiera escrito directo). No afecta el resultado final, solo el proceso de commit atómico.
- **Verificación por mutación (Task 3, pedida explícitamente por el plan)**: se comentó temporalmente la llamada a `_setNextAction` dentro de `_setCommitment`. Resultado: **7 de 35 tests se pusieron en rojo** (los que verifican que `_setCommitment` deja `lead.nextAction` seteado con `origen:'compromiso'`, el `tipo` correcto según `parte`, el `motivo` legible, y que un `dueAt` explícito se propaga al `nextAction`). Se restauró el código exacto; `git diff index.js` quedó vacío y `grep -n "MUTATION" index.js` devolvió 0 resultados — confirmado antes de continuar a Task 3's commit.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- El cimiento del modelo está listo para que **31-02** cablee `commitment` en el body de `POST /api/setters/leads/:id/call-disposition` (junto al override de `nextAction` ya existente de la Phase 30) y para el endpoint nuevo `PATCH /api/setters/leads/:id/commitment` (editar/cerrar desde la ficha, D-09).
- **31-03** (carga en UI) puede extender `#call-next-modal` con el selector de tipo de compromiso — el mapa D-06 y los defaults de parte/canal ya están listos para poblar la propuesta de fecha.
- **31-04** (consulta, D-10/D-11) puede leer `lead.commitment` directo (ya viene en cada lead vía `GET /leads/sin-wsp`, porque `ensureLeadDefaults` lo inicializa) para armar la sección "Compromisos" de Hoy y el historial en el timeline del lead — no hace falta ningún endpoint agregado nuevo para eso.
- Sin bloqueantes. `public/` no fue tocado — cero bump de cache-buster, tal como pedía el objective del plan.

---
*Phase: 31-comm-compromisos*
*Completed: 2026-08-15*

## Self-Check: PASSED

- FOUND: `tests/commitment-model.test.js`
- FOUND: `index.js`
- FOUND: `.planning/phases/31-comm-compromisos/31-01-SUMMARY.md`
- FOUND commit `ee09a18` (Task 1)
- FOUND commit `4865b9d` (Task 2)
- FOUND commit `d22412a` (Task 3)

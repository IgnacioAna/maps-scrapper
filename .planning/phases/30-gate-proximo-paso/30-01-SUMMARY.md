---
phase: 30-gate-proximo-paso
plan: 01
subsystem: api
tags: [call-disposition, next-action, gate, backend, telnyx]

# Dependency graph
requires:
  - phase: 29-next-reloj-unico
    provides: "el reloj único nextAction (_setNextAction/_clearNextAction/_leadNextAction), sus whitelists (NEXT_ACTION_TIPOS/CANALES/ORIGENES/TEMPLATES), y _applyCallOutcome como helper puro compartido entre el handler humano y el webhook del agente de voz"
provides:
  - "defaults D-02 por outcome dentro de _applyCallOutcome (answered_interested +3d manual, hung_up 1er corte +24h cadencia, placeholder_sent +48h esperar_respuesta)"
  - "red de seguridad GATE-01: cualquier outcome no-terminal que llegue a _applyCallOutcome sin nextAction recibe un default de cadencia +24h, nunca un 4xx"
  - "override de próximo paso sanitizado (_gateSanitizeNextActionOverride) sobre POST /call-disposition, respetando D-01 (nunca 400) y T-30-02 (el estado terminal siempre gana)"
affects: ["30-02 (frontend del gate)", "31 (compromisos hablados, origen:'compromiso' sigue reservado)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Defaults derivados de NEXT_ACTION_TEMPLATES por búsqueda de key (nunca escribir 24h/48h a mano) — GATE_CADENCIA_DELTA_MS / GATE_PLACEHOLDER_DELTA_MS"
    - "Precedencia fija dentro de _applyCallOutcome: _clearNextAction de entrada → switch (defaults por outcome) → DNC → tope de cortes → cadencia de no-contacto → override del cliente → red de seguridad → return"
    - "Whitelist-and-coerce para input del cliente que nunca lanza ni devuelve 4xx (mismo idioma que cleanReason/disqualifyReason)"

key-files:
  created:
    - tests/gate-next-action.test.js
  modified:
    - index.js
    - tests/hangup-cap.test.js
    - tests/disposition-enforcement.test.js
    - tests/next-action-disposition.test.js

key-decisions:
  - "El backend nunca devuelve 400 por falta de próximo paso (D-01): la red de seguridad asigna un default de cadencia en vez de rechazar, porque _applyCallOutcome lo comparte el webhook del agente de voz (v3.0 parkeado)"
  - "El override del cliente NUNCA puede escribir origen:'compromiso' (reservado Phase 31) — se fuerza a 'manual' siempre, incluso si el body lo manda explícito"
  - "hung_up 1er corte y answered_interested (incluso vía corrección de auto-marca) SIEMPRE sobrescriben cualquier callback viejo arrastrado con un valor fresco — 2 tests preexistentes que esperaban callbackAt vacío tras esos outcomes tuvieron que actualizarse porque D-02 los reemplaza en vez de dejarlos en blanco"

patterns-established:
  - "GATE_TERMINAL_ESTADOS (descartado/agendado/cerrado): un lead en cualquiera de estos nunca lleva nextAction, ni por default, ni por override, ni por la red de seguridad"

requirements-completed: [GATE-01, GATE-02]

# Metrics
duration: 45min
completed: 2026-08-15
---

# Phase 30 Plan 01: GATE backend — defaults D-02 + red de seguridad + override Summary

**El backend garantiza por construcción que ningún outcome no-terminal deja un lead sin próximo paso: mapa D-02 completo en `_applyCallOutcome`, override sanitizado del cliente en `call-disposition`, `esperar_respuesta` en `send-placeholder`, y una red de seguridad final que nunca responde 4xx.**

## Performance

- **Duration:** ~45 min
- **Completed:** 2026-08-15
- **Tasks:** 3/3
- **Files modified:** 5 (1 creado, 4 modificados)

## Accomplishments

- `answered_interested` programa un callback manual a +3 días (D-03: primer paso de la cadencia día 1/3/7/14) sin que el SDR tenga que hacer nada más.
- `hung_up` con 1 solo corte acumulado ya no deja el lead flotando: programa una cadencia de reintento a +24h (antes del gate, un 1er corte no tocaba `nextAction` en absoluto).
- `send-placeholder` (hold de calendario) deja al lead esperando respuesta +48h — sale de la cola de Llamadas y vuelve solo cuando vence.
- El cliente puede proponer su propia fecha (`body.nextAction`) sobre `call-disposition`: se sanitiza (whitelist-and-coerce, `dueAt` re-parseado, `tipo`/`canal` contra las whitelists del reloj único, `origen` forzado siempre a `'manual'`), gana sobre el default D-02, y se ignora en silencio si el lead quedó terminal o si `dueAt` no es una fecha válida — nunca un 400.
- Red de seguridad: cualquier lead que llegue al final de `_applyCallOutcome` en estado no-terminal y sin `nextAction` recibe una cadencia +24h con `motivo:'sin próximo paso definido'`. Protege específicamente el camino compartido con el webhook del agente de voz (Phase 24, v3.0 parkeado).

## Task Commits

1. **Task 1: Defaults D-02 en _applyCallOutcome + red de seguridad GATE-01** - `69b312d` (feat)
2. **Task 2: Override de próximo paso en call-disposition + esperar_respuesta en send-placeholder** - `5ae08e9` (feat)
3. **Task 3: Tests del gate backend + actualizar 2 aserciones desactualizadas** - `48bf13b` (test)

_No hubo commit de plan-metadata separado — este SUMMARY y la actualización de STATE/ROADMAP/REQUIREMENTS se commitean juntos al final._

## Files Created/Modified

- `index.js` - constantes `GATE_INTERESADO_DELTA_MS`/`GATE_CADENCIA_DELTA_MS`/`GATE_PLACEHOLDER_DELTA_MS`/`GATE_TERMINAL_ESTADOS`, helper `_gateSanitizeNextActionOverride`, defaults D-02 en `_applyCallOutcome` (case `answered_interested`, rama `hung_up`), aplicación del override + red de seguridad al final de `_applyCallOutcome`, destructuring + wiring de `nextAction` en `POST /call-disposition`, `_setNextAction` dentro del `mutateSettersData` de `POST /send-placeholder`.
- `tests/gate-next-action.test.js` (nuevo) - 12 tests: mapa D-02 (5), override del cliente (5), red de seguridad (1), source-assertion de `send-placeholder` (1).
- `tests/hangup-cap.test.js` - 1 aserción actualizada (deviation, ver abajo).
- `tests/disposition-enforcement.test.js` - 1 aserción actualizada (deviation, ver abajo).
- `tests/next-action-disposition.test.js` - 2 aserciones que la Phase 29 dejó explícitamente marcadas ("hoy no exige uno; la Phase 30 sí") reescritas al comportamiento nuevo, más el título de `scheduled_with_admin` limpiado del paréntesis que ya no aplicaba.

## Decisions Made

- **La red de seguridad usa el mismo default que la cadencia de no-contacto** (`GATE_CADENCIA_DELTA_MS`, derivado de `NEXT_ACTION_TEMPLATES['24hs']`) en vez de un valor propio — un solo número que significar "reintento estándar" en todo el archivo, no dos constantes equivalentes.
- **`_gateSanitizeNextActionOverride` NO se expone en `globalThis.__voiceAgent`**: el plan pedía "exactamente 2 hits" de esa función en todo `index.js` (declaración + uso en el endpoint) — se ejercita vía HTTP en los tests, no como helper puro. Ajusté un comentario y un export que originalmente sumaban hits de más para cumplir ese grep literal.
- **El override se aplica en un único punto**, después de la cadencia de no-contacto y antes de la red de seguridad — así el orden de precedencia queda: outcome → DNC → tope de cortes → cadencia → override del cliente → red de seguridad. Un override válido siempre desactiva la red de seguridad (el lead ya tiene `nextAction`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `tests/hangup-cap.test.js` — aserción que esperaba `callbackAt` vacío tras un 1er corte con callback viejo arrastrado**
- **Found during:** Task 1 (verify)
- **Issue:** El test `'cualquier disposición consume el callback pendiente arrastrado...'` (agregado en la sesión 2026-08-12, antes de esta fase) asertaba `expect(r.body.lead.callbackAt).toBe('')` después de un `hung_up` (1er corte) sobre un lead con un callback vencido arrastrado. Con D-02, ese mismo evento ahora programa una cadencia FRESCA a +24h en vez de dejar el campo vacío — el comportamiento nuevo es estrictamente mejor para el mismo bug que ese test protegía (el lead ya no queda ni vencido ni vacío, queda con un reintento real).
- **Fix:** Reescrita la aserción: en vez de `toBe('')`, verifica que `callbackAt` NO sea el valor vencido y que esté entre 23-25h en el futuro (mismo patrón `hoursFromNow` que el resto de la suite).
- **Files modified:** `tests/hangup-cap.test.js`
- **Verification:** `npx vitest run tests/hangup-cap.test.js` → 8/8 verde.
- **Committed in:** `69b312d` (Task 1 commit)

**2. [Rule 1 - Bug] `tests/disposition-enforcement.test.js` — aserción que esperaba `callbackAt` vacío tras corregir una auto-marca a `answered_interested`**
- **Found during:** Task 2 (verify)
- **Issue:** El test `'corrección revierte el auto-descarte y restaura la cadencia del snapshot'` (D-03, Phase 20) asertaba `callbackAt` vacío tras una corrección `correctsAutoMarked:true` con outcome `answered_interested`. Con D-02, ese outcome SIEMPRE programa el default de +3 días — también cuando llega vía corrección, porque el case `answered_interested` del switch no distingue el camino de entrada. Al fallar la primera aserción, el mecanismo de retry de vitest (`testTimeout`/`retry:2`, regla #30) re-ejecutaba el resto del test sobre el MISMO lead ya mutado por el intento anterior, produciendo fallos en cascada en aserciones previas del mismo `it` (cadenceStep, estado) que no tenían relación directa con el cambio — confirmado reproduciendo el escenario aislado antes de tocar el archivo.
- **Fix:** Reescrita la aserción de `callbackAt`/`nextAction` para esperar el default D-02 (+3 días, `origen:'manual'`) en vez de vacío. Con la causa raíz arreglada, el test pasa en el primer intento y no dispara el retry que producía las fallas en cascada.
- **Files modified:** `tests/disposition-enforcement.test.js`
- **Verification:** `npx vitest run tests/disposition-enforcement.test.js` → 16/16 verde, sin retries.
- **Committed in:** `5ae08e9` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (Rule 1 — ambos son tests que codificaban el comportamiento PRE-Phase-30, contradicho a propósito por el mapa D-02 del CONTEXT). Ninguno de los dos estaba en `files_modified` del plan, pero ambos son consecuencia directa de implementar D-02 literalmente tal como está escrito — no se encontraron durante la planificación porque esos dos tests fueron agregados en una sesión (2026-08-12/Phase 20) posterior al research que fundamentó D-02.
**Impact on plan:** Ambos ajustes son estrictamente consistentes con el mapa D-02 documentado en el CONTEXT — no hay ninguna decisión de diseño nueva, solo actualizar 2 aserciones que quedaron describiendo el comportamiento viejo.

## Issues Encountered

- Al investigar el fallo de `tests/hangup-cap.test.js`, encontré que el test `'el callback manual NO se puede colgar de un corte'` (preexistente, sin tocar) solo pasa gracias al mecanismo de retry de vitest: la 1ra corrida falla porque un `hung_up` con `callbackAt` adjunto saltea por completo el bloque del tope de cortes (guard `!callbackAt`), y el retry, al reusar el estado YA mutado por el intento fallido, acumula suficientes entries de `hung_up` en el callLog como para cruzar el tope en el segundo intento. Es un comportamiento preexistente (no introducido por este plan) que sobrevive intacto porque mi cambio está anidado dentro del mismo guard — lo dejé documentado acá por si en algún momento se decide arreglar el guard de fondo, pero está fuera del scope de esta fase (D-08: no tocar el enforcement de la Phase 20/17).
- El acceptance criterion de Task 2 pedía "exactamente 2 hits" de `_gateSanitizeNextActionOverride` en todo `index.js`. Mi primer borrador sumaba un comentario y un export en `globalThis.__voiceAgent` que llevaban el conteo a 4 — los quité para cumplir el grep literal (ver Decisions Made).

## User Setup Required

None - no external service configuration required.

## Efectos visibles esperados (pedido explícito del plan, `<output>`)

- **El contador de seguimientos del menú y la lista de follow-ups van a SUBIR.** `_computeFollowupsDue` (`index.js`, `grep -n "function _computeFollowupsDue"`) incluye cualquier `nextAction` con `origen !== 'cadencia'`, y ahora cada `answered_interested` nuevo (y cada `send-placeholder`) escribe uno con `origen:'manual'`. Con la mediana de 21 días sin avanzar reportada en R1 (36 interesados), el badge va a mostrarlos apenas se pase el umbral de "próximo paso" — efecto buscado, no una regresión.
- **Los leads con un `hung_up` reciente o un hold de calendario van a salir de la cola de Llamadas por 24h/48h** (antes volvían al instante en el caso de `hung_up`, o quedaban sin ningún cambio en el caso de `placeholder_sent`). El stock "para llamar" de Comando/Equipo/Distribución puede bajar levemente por esto — consecuencia directa de D-02. Los interesados NO afectan ese stock: `_leadIsCallableNow` (`index.js`, `grep -n "function _leadIsCallableNow"`) ya excluía `estado==='interesado'` desde antes de esta fase (verificado en el código, línea `if (['descartado', 'agendado', 'interesado'].includes(l.estado)) return false;`).
- **`metrics-consistency` no se mueve**: verificado sin editar el archivo — el funnel de llamadas (`_ccFunnelAggregate`/CALL METRICS CORE) deriva 100% del `callLog`, nunca de `nextAction`. `npx vitest run tests/metrics-consistency.test.js` → 18/18 verde.

## Next Phase Readiness

- El backend queda listo para que el plan 30-02 (frontend) construya el control de UI que obliga a elegir un próximo paso o un estado terminal antes de confirmar una disposición (D-01, capa frontend) y el aviso universal de destino (D-05/D-06/D-07).
- La API que 30-02 va a consumir: `body.nextAction = {dueAt, tipo?, canal?, motivo?}` sobre `POST /api/setters/leads/:id/call-disposition` (origen siempre se fuerza server-side a `'manual'`, no hace falta mandarlo). La respuesta siempre trae `lead.nextAction` actualizado — nunca hay que adivinar si el gate disparó un default.
- Sin bloqueos. `origen:'compromiso'` sigue reservado y sin uso — la Phase 31 lo va a activar.

---
*Phase: 30-gate-proximo-paso*
*Completed: 2026-08-15*

## Self-Check: PASSED

All created/modified files found on disk, all 3 task commits (`69b312d`, `5ae08e9`, `48bf13b`) found in git log.

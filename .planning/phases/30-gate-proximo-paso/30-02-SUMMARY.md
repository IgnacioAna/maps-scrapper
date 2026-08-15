---
phase: 30-gate-proximo-paso
plan: 02
subsystem: ui
tags: [call-disposition, next-action, gate, frontend, power-dialer, modal]

# Dependency graph
requires:
  - phase: 30-gate-proximo-paso (plan 01)
    provides: "defaults D-02 en _applyCallOutcome (answered_interested +3d manual), override sanitizado de nextAction sobre POST /call-disposition, red de seguridad GATE-01 que nunca responde 4xx"
provides:
  - "modal #call-next-modal (\"Próximo paso\") con la propuesta D-02 (+3 días) ya cargada, atajos D-03 (1/3/7/15 días) y calendario propio de la Phase 28"
  - "openNextStepModal(leadId), expuesto como window.openNextStepModal, con el patrón cinturón+tiradores del fix #181b"
  - "ruteo de answered_interested a openNextStepModal en los 2 caminos de disposición (lista de Llamadas y Power Dialer)"
  - "fix de regresión: el Power Dialer ya no expulsa la tarjeta de un interesado apenas queda con próximo paso a futuro"
affects: ["30-03 (aviso universal de destino GATE-04, se integra en _dispoAfterSaved/el banner del Power Dialer)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Bloque puro [30-02] GATE-PURE (mismo formato de marcadores que [28-01] DTPICKER-PURE) para helpers de fecha sin DOM/red/localStorage, extraíbles por tests con new Function"
    - "openNextStepModal calca la estructura de openCallbackModal: default cargado al abrir, atajos que setean el input + _dtPickerSync, cinturón+tiradores en el botón de confirmar"

key-files:
  created:
    - tests/gate-next-step-ui.test.js
  modified:
    - public/index.html
    - public/app.js
    - tests/dtpicker-wiring.test.js
    - tests/panel-drag.test.js

key-decisions:
  - "El literal _dtPickerAttach(fechaInput, { getLead: () => _callsLeadsById.get(leadId) }) se reusa TAL CUAL en openNextStepModal (no una variante) — el test dtpicker-wiring lo verifica contando 2 ocurrencias del mismo string"
  - "El aviso de destino (D-05/D-06) NO se agrega en este plan — openNextStepModal deja el comentario explícito de que eso lo universaliza el plan 30-03 desde _dispoAfterSaved, evitando duplicar el toast cuando esa fase lo centralice"
  - "La excepción a la expulsión del Power Dialer se acota a lead.estado === 'interesado', no a 'tiene callbackAt futuro en general' — así no se abre una puerta más ancha de la que pide D-04"

patterns-established:
  - "Cualquier modal nuevo de disposición copia el patrón cinturón (reset antes de mostrar) + tiradores (reset en finally) del fix #181b — verificado con un test de fuente dedicado, no solo revisión manual"

requirements-completed: [GATE-01, GATE-02]

# Metrics
duration: ~35min
completed: 2026-08-15
---

# Phase 30 Plan 02: GATE frontend — modal "Próximo paso" + ruteo + fix del Power Dialer Summary

**Marcar "Interesado" ahora abre un modal con la fecha de +3 días ya cargada (aceptar es un click), no deja confirmar sin fecha, y el Power Dialer conserva la tarjeta del interesado en vez de expulsarla — cierra el único hueco donde un lead podía quedar sin próximo paso.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-08-15
- **Tasks:** 3/3
- **Files modified:** 5 (1 creado, 4 modificados)

## Accomplishments

- `#call-next-modal` ("Próximo paso") en `index.html`, mismo molde que `#call-callback-modal`: párrafo explicativo, atajos (Mañana/En 3 días/En 1 semana/En 15 días — el de 3 días resaltado de entrada), fecha exacta vía el calendario propio de la Phase 28, motivo opcional (200 chars).
- Bloque puro `[30-02] GATE-PURE` en `app.js`: `_gateInteresadoDefaultDate(now)` (+3 días exactos, espejo de la constante D-02 del backend) y `_gateInteresadoPicks(now)` (los 4 saltos de D-03: 1/3/7/15 días).
- `openNextStepModal(leadId)`: abre con la propuesta ya cargada, no deja guardar con la fecha vacía (avisa con toast, sin bloquear el botón para poder reintentar), manda `outcome:'answered_interested'` + `nextAction:{dueAt,tipo:'callback',canal:'llamada',motivo}` a `call-disposition`, lee la nota rápida del Power Dialer (`#pd-call-note`) igual que el resto de los outcomes.
- `_handleCallDisposition` rutea `answered_interested` al modal nuevo en vez de caer al flujo directo (sigue sin abrir la agenda de reuniones — eso es una acción aparte, nota #63).
- `_pdHandleDisposition` espera a que `#call-next-modal` se cierre antes de decidir si avanza (mismo mecanismo que los otros 3 modales de disposición).
- Fix de regresión en `_pdRender`: la expulsión por `callbackAt` futuro ahora excluye `estado==='interesado'` — sin esto, el Power Dialer de "Hoy → Interesados" (Phase 28, nota #179) hubiera echado la tarjeta apenas el lead quedara con su próximo paso a +3 días.

## Task Commits

1. **Task 1: Modal "Próximo paso" con la propuesta cargada (markup + helpers puros + apertura)** - `c567b07` (feat)
2. **Task 2: Rutear "Interesado" al paso nuevo en los dos caminos + no expulsar interesados del Power Dialer** - `b784160` (feat)
3. **Task 3: Tests del paso nuevo + actualizar dtpicker-wiring + cache-buster** - `2b22ee3` (test)

_No hubo commit de plan-metadata separado — este SUMMARY se commitea junto con el resto del wave por el orquestador (modo worktree)._

## Files Created/Modified

- `public/index.html` - bloque `#call-next-modal` insertado inmediatamente después de `#call-callback-modal`; cache-buster de `app.js` bumpeado a `v=20260815a` (`style.css` intacto, sigue en `v=20260814a`).
- `public/app.js` - bloque `[30-02] GATE-PURE` (`GATE_INTERESADO_DELTA_MS`, `_gateInteresadoDefaultDate`, `_gateInteresadoPicks`) junto a `_buildCallbackQuickPicks`; `openNextStepModal` + `window.openNextStepModal` junto a `openCallbackModal`; rama nueva de `answered_interested` en `_handleCallDisposition`; `answered_interested`/`call-next-modal` sumados a `modalOpening`/`modalIds` de `_pdHandleDisposition`; excepción `estado !== 'interesado'` en la expulsión de `_pdRender`.
- `tests/gate-next-step-ui.test.js` (nuevo) - 17 tests: 6 del bloque puro GATE-PURE (delta, default date, forma de los picks, orden ascendente, isDefault único que coincide con el default, los 4 saltos D-03), 3 de markup del modal, 4 de cableado en `app.js` (exposición, ruteo, `modalOpening`/`modalIds`, excepción del Power Dialer), 3 anti-regresión (#181b: reset doble + orden cinturón-antes-de-mostrar; GATE-01: aviso sin fecha), 1 del body del POST.
- `tests/dtpicker-wiring.test.js` - conteo de `_dtPickerAttach(` actualizado de 5 a 6 (título + comentario de cabecera); nuevo `it` que verifica que el literal de `openCallbackModal` se reusa 2 veces (el nuevo call site de `openNextStepModal`); conteo de inputs `type="datetime-local"` actualizado de 5 a 6 (ver Deviations).
- `tests/panel-drag.test.js` - assertion del cache-buster relajada a "≥ baseline" en vez de un valor fijo (ver Deviations).

## Decisions Made

- Ver `key-decisions` en el frontmatter.
- El `<p>` del modal describe el destino ("Hoy → Interesados") y qué representa la fecha, sin nombrar la empresa — no pasa por IA pero el texto lo ve el usuario, mismo criterio general de la regla anti-marca (#119).
- El grid de atajos reusa la clase `cb-quickpick` tal cual (no se define una clase nueva): el CSS de esos botones es 100% inline, `cb-quickpick`/`ph-quickpick` son solo hooks de `querySelectorAll` scopeados por contenedor (`#call-next-quickpicks`), así que reusar el nombre no genera colisión ni requiere tocar `style.css`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `tests/dtpicker-wiring.test.js` — assertion de "5 inputs datetime-local" quedó desactualizada por el input nuevo del Task 1**
- **Found during:** Task 3 (verify, `npm test`)
- **Issue:** El test `"los 5 inputs siguen siendo type=\"datetime-local\" en index.html"` verificaba `countOccurrences(indexHtml, 'type="datetime-local"') === 5`. El plan (Task 3, acción B) solo pedía actualizar el conteo de `_dtPickerAttach(` de 5 a 6 y no mencionaba esta otra assertion, pero `#call-next-fecha` (Task 1, requerido literal por el plan: `<input type="datetime-local" id="call-next-fecha">`) es un 6to input real — la assertion vieja quedó describiendo el estado pre-Fase-30, igual que las 2 aserciones que 30-01 tuvo que actualizar en su Task 3 por la misma razón (comportamiento nuevo documentado en D-02 vs. tests que codificaban el viejo).
- **Fix:** Actualizado el conteo esperado a 6 y el título del `it` para nombrar el campo nuevo.
- **Files modified:** `tests/dtpicker-wiring.test.js`
- **Verification:** `npx vitest run tests/dtpicker-wiring.test.js` → 31/31 verde.
- **Committed in:** `2b22ee3` (Task 3 commit)

**2. [Rule 1 - Bug] `tests/panel-drag.test.js` — assertion que fijaba el cache-buster de app.js a un valor exacto anterior**
- **Found during:** Task 3 (verify, `npm test`)
- **Issue:** El test `"cache-buster de app.js bumpeado a v=20260814c"` (de una fase previa) esperaba ese valor literal — al bumpear el cache-buster de esta fase (Task 3, acción C, instrucción explícita del plan) a `v=20260815a`, ese test rompía. No estaba en `files_modified` del plan porque pertenece a una fase anterior, pero es consecuencia directa e inevitable de seguir la instrucción C del propio Task 3.
- **Fix:** Relajada la assertion al mismo patrón que ya usa `tests/dtpicker-wiring.test.js` para este caso (`"cache-buster de app.js bumpeado desde el baseline de este plan (28-03/20260814c)"`, comparación `>= "20260814c"` en vez de igualdad estricta) — verifica que no quedó en un valor anterior, sin fijar el valor exacto vigente.
- **Files modified:** `tests/panel-drag.test.js`
- **Verification:** `npx vitest run tests/panel-drag.test.js` → 19/19 verde.
- **Committed in:** `2b22ee3` (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (Rule 1 — ambos son aserciones de fuente que fijaban un conteo/valor exacto y quedaron desactualizadas por cambios legítimos y explícitamente pedidos por este mismo plan: el 6to input de fecha del Task 1 y el bump de cache-buster del Task 3).
**Impact on plan:** Ninguna decisión de diseño nueva — ambos ajustes son la consecuencia mecánica de ejecutar las acciones tal como están escritas en el plan. Ningún test fue eliminado; solo se actualizaron 2 valores esperados.

## Issues Encountered

- Al escribir el comentario de cabecera del bloque `[30-02] GATE-PURE`, la primera versión mencionaba la palabra "localStorage" en prosa (dentro de un comentario, no código) — el acceptance criterion de Task 1 pide `grep -c localStorage` = 0 dentro del rango de marcadores, así que se reescribió el comentario para no usar esa palabra literal. No afecta comportamiento, solo redacción del comentario.

## User Setup Required

None - no external service configuration required.

## Efectos visibles esperados (para cruzar contra lo que reporte 30-03/el user)

- **Marcar "Interesado" desde cualquiera de los 3 caminos (lista de Llamadas, Hoy, Power Dialer) abre el modal nuevo** en vez de guardar directo. El flujo de un click sigue siendo un click (Guardar acepta el default de +3 días).
- **El Power Dialer de Hoy → Interesados ya no expulsa la tarjeta** apenas se guarda el resultado — el fix de `_pdRender` es puramente correctivo (antes de este plan, el interesado desaparecía de la cola del dialer de Hoy en cuanto tenía `callbackAt` futuro, lo cual rompía la cola entera de esa vista).
- **Ningún outcome de disposición cambió su comportamiento fuera de `answered_interested`**: los otros 8 (no_answer, voicemail, hung_up, wrong_number, invalid_number, callback_later, scheduled_with_admin, answered_not_interested) se siguen marcando exactamente igual que antes — verificado por `git diff` sobre `pd-disposition-grid` y `_dispoSelectHTML` (sin ediciones) y por el conteo estable de `_dispoGate*` (12 antes y después del plan).
- **`metrics-consistency` no se mueve**: verificado sin editar el archivo (D-09), `npx vitest run tests/metrics-consistency.test.js` → 18/18 verde.

## Qué se pudo verificar vs. qué queda pendiente

**Verificado (fuente + tests, sin browser):**
- Sintaxis (`node --check public/app.js`), todos los greps de acceptance criteria de las 3 tasks, suite completa (`npm test` → 1338/1338, 91 archivos), `metrics-consistency` sin tocar.
- El bloque puro `GATE-PURE` evaluado aislado con `new Function` (17 tests): fecha por defecto exacta, los 4 saltos D-03, el pick default coincide al milisegundo con `_gateInteresadoDefaultDate`.
- El patrón cinturón+tiradores del fix #181b, verificado por assertion de fuente (no solo revisión manual): reset antes de `classList.remove('hidden')` + `finally` que restaura.

**Pendiente de verificación en vivo (no se puede simular en este entorno):**
- No hay tool de preview/browser disponible en esta ejecución (worktree paralelo, toolset reducido a Read/Write/Edit/Bash/Grep/Glob) — la verificación en preview que pide la sección `<verification>` del plan (abrir el modal, vaciar la fecha y confirmar que avisa sin postear, guardar con el default, reabrir sobre otro lead y confirmar que el botón no queda muerto, abrir el Power Dialer desde Hoy → Interesados y confirmar que no salta sola) queda pendiente para quien corra el checklist en preview real o en producción.
- El flujo con `telnyxCallMeta` fresca (una llamada Telnyx real colgada justo antes de marcar Interesado) tampoco se puede simular sin Telnyx — el código reusa `_consumeTelnyxMeta`/`_dispoEnforcementBody` tal cual los usan los otros 3 caminos ya probados en producción, así que el riesgo es bajo, pero no está ejercitado end-to-end en esta sesión.

## Next Phase Readiness

- El plan 30-03 (GATE-04, aviso universal de destino D-05/D-06/D-07) puede apoyarse en `_dispoAfterSaved` sin tocar `openNextStepModal`: el comentario dejado en el código (`"El aviso universal de destino (D-05/D-06) lo agrega el plan 30-03 desde _dispoAfterSaved — no se duplica acá"`) marca exactamente dónde centralizar el toast sin que este modal necesite un segundo cambio.
- Sin bloqueos. Los 8 outcomes restantes y el gate de disposición obligatoria de la Phase 20 (D-08) quedaron intactos y verificados.

---
*Phase: 30-gate-proximo-paso*
*Completed: 2026-08-15*

## Self-Check: PASSED

All created/modified files found on disk, all 3 task commits (`c567b07`, `b784160`, `2b22ee3`) found in git log.

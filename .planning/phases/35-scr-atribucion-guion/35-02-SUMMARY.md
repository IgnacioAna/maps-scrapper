---
phase: 35-scr-atribucion-guion
plan: 02
subsystem: ui
tags: [vanilla-js, telnyx-webrtc, call-scripts, vitest, script-attribution]

# Dependency graph
requires:
  - phase: 35-scr-atribucion-guion (plan 01)
    provides: "call-disposition acepta scriptIdsUsed/scriptIdsAuto en el nivel superior del body + whitelist contra el banco real de guiones + gate por outcome"
provides:
  - "bloque [35-02] SCR-ATTR en public/app.js: estado único de atribución (_dispoScript), builder único del selector (_scriptSelectHTML/_scriptOptionsHTML), precedencia del default (_scriptDefaultId)"
  - "_startTelnyxCall siembra el guion default con auto:true al iniciar CUALQUIER llamada, sin depender de que el SDR abra el panel de guiones"
  - "selector de guion visible y corregible en vivo en el panel de llamada (#telnyx-call-script-wrap)"
  - "_dispoEnforcementBody inyecta scriptIdsUsed/scriptIdsAuto — la atribución viaja desde cualquiera de los 6 call sites de call-disposition"
affects: ["35-03 (selector en las otras 3 superficies: Power Dialer, lista de Llamadas/Hoy, ficha en modal — reusa _scriptSelectHTML)", "35-04 (npm run coverage:script necesita que existan llamadas con scriptIdsUsed real, que recién a partir de este commit pueden nacer con atribución)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Bloque evaluable aislado delimitado por marcadores [35-02] SCR-ATTR: INICIO/FIN, mismo criterio que [28-01] DTPICKER-PURE — el test lo extrae por indexOf de los marcadores, no balanceando llaves"
    - "Builder único + N call sites (_scriptSelectHTML), mismo patrón que _stageChipsHTML/_dispoSelectHTML/_actButtonsHTML"
    - "Flag *auto para distinguir atribución del sistema vs de una persona, mismo idioma que callStageAuto — se apaga PARA SIEMPRE en cuanto hay una elección humana en esa llamada, incluso si después se agrega otro guion en modo append con auto:true"

key-files:
  created:
    - tests/script-attribution-core.test.js
  modified:
    - public/app.js
    - public/index.html

key-decisions:
  - "_setCallScript(id, '') solo limpia el lead de esa llamada — antes de escribir se descartaba el estado de OTRO lead activo, pero limpiar con scriptId vacío para un lead ajeno al estado actual NO debía tocarlo; se resolvió el orden de los checks para que el discard-por-lead-distinto solo ocurra en la rama de escritura (scriptId truthy), no en la de limpieza"
  - "auto nace true solo al CREAR estado nuevo con {auto:true}; en un estado ya existente, cualquier llamada sin auto:true lo apaga para siempre — una re-siembra tardía con {append:true, auto:true} después de una elección humana NO lo reenciende"
  - "La preselección de _renderScriptPanel (que antes caía en el primer guion no-'rules', casi siempre el checklist 'Antes de llamar') ahora usa _scriptDefaultId() con auto:true — preseleccionar no es elegir, y la cobertura manual mentiría al 100% si se marcara como humana"

requirements-completed: [SCR-02]

# Metrics
duration: ~25min
completed: 2026-08-22
---

# Phase 35 Plan 2: Siembra automática de guion + selector en el panel de llamada Summary

**La llamada nace con guion atribuido sin que el SDR toque nada — `_startTelnyxCall` siembra el default con `auto:true` y un selector único en el panel de llamada permite corregirlo en vivo.**

## Performance

- **Duration:** ~25 min (commits entre 18:20 y 18:30 -03:00, más verificación por mutación, suite completa y verificación contra el banco real de 30 guiones en preview)
- **Started:** 2026-08-22T18:15:00-03:00 (aprox)
- **Completed:** 2026-08-22T18:36:26-03:00
- **Tasks:** 3
- **Files modified:** 3 (`public/app.js`, `public/index.html`, `tests/script-attribution-core.test.js` nuevo)

## Accomplishments

- El diagnóstico del CONTEXT.md ("0 de 199 llamadas completaron la cadena de
  captura") quedó atacado en la causa raíz: la llamada YA NACE con guion
  atribuido, sin depender de que el SDR abra el panel de guiones ni
  clickee nada.
- Hay un solo estado de atribución en el frontend (`_dispoScript`):
  `_telnyxCallState.scriptIdsUsed` (Sprint 12, solo se llenaba desde el
  panel en vivo) desapareció del archivo por completo.
- El SDR ve qué guion se le está atribuyendo mientras habla (`<select>` en
  el panel de llamada) y puede corregirlo ahí sin abrir el panel de
  guiones — reemplaza (es una corrección), mientras que abrir un guion
  distinto desde el panel de guiones suma (D-03, se usaron los dos).
- `_dispoEnforcementBody` inyecta `scriptIdsUsed`/`scriptIdsAuto` — la
  atribución viaja desde cualquiera de los 6 call sites de
  `call-disposition` que ya comparten ese helper, y se apaga al guardar la
  disposición (`_dispoAfterSaved` la limpia, es de UNA llamada).

## Task Commits

Each task was committed atomically:

1. **Task 1: bloque SCR-ATTR — estado único, builder y default** - `26d3e2c` (feat)
2. **Task 2: captura automática en vivo — siembra al discar y selector en el panel de llamada** - `93261fb` (feat)
3. **Task 3: tests del núcleo (fuente + comportamiento aislado)** - `80c4e86` (test)

**Plan metadata:** (este commit)

## Files Created/Modified

- `public/app.js` — bloque `[35-02] SCR-ATTR` (líneas ~10407-10622, entre `_clearCallStage` y `_dispoEnforcementBody`): `_SCRIPT_TRIGGER_ORDER`/`_SCRIPT_TRIGGER_LABELS` (fuente única, antes copiadas dentro de `_renderScriptButtons`), `_SCRIPT_META_TRIGGERS`, `_dispoScript` + lectores (`_scriptIdsFor`/`_scriptPrimaryFor`/`_scriptIsAuto`), `window._setCallScript`, `_clearCallScript`, `_scriptDefaultId`, `_scriptOptionsHTML`/`_scriptSelectHTML`, `_syncScriptControls`, `_ensureCallScripts`. `_dispoEnforcementBody` inyecta `scriptIdsUsed`/`scriptIdsAuto`; `_dispoAfterSaved` apaga la atribución. `_telnyxCallState.scriptIdsUsed` eliminado (declaración + 2 reseteos). `_startTelnyxCall` siembra el default + puebla el selector + re-siembra tardía si el banco no estaba en cache. `_onTelnyxCallEnded` toma la meta de `_scriptIdsFor`/`_scriptIsAuto`. `_selectScript(scriptId, opts)` escribe en el estado único en modo append. `_renderScriptPanel` preselecciona con `_scriptDefaultId()` en vez del checklist "Antes de llamar".
- `public/index.html` — `#telnyx-call-script-wrap` en el panel de llamada (entre la etapa y la nota rápida). Cache-buster `app.js` `20260817d` → `20260822a`.
- `tests/script-attribution-core.test.js` (nuevo) — 27 tests: fuente (8) + comportamiento aislado del bloque real extraído por marcadores (19).

## Decisions Made

- Ver `key-decisions` en el frontmatter — las tres relevantes son el orden
  de los checks en `_setCallScript` (limpiar con `''` nunca descarta el
  estado de otro lead), que `auto` se apaga para siempre apenas hay una
  elección humana (incluso ante una re-siembra tardía con `auto:true`), y
  que la preselección del panel de guiones dejó de mentir marcando como
  automático lo que antes caía casi siempre en el checklist "Antes de
  llamar".
- `minWidth: 220` para la variante `'call'` del selector (el default del
  builder es 150): el panel de llamada tiene más ancho disponible que una
  fila densa de la lista, y un guion legible necesita más espacio. Detalle
  cosmético sin impacto funcional.

## Deviations from Plan

None - plan ejecutado tal como estaba escrito. La única corrección fue
interna al propio desarrollo (ajustar el orden de los checks en
`_setCallScript` para que limpiar con `scriptId` vacío nunca descartara el
estado de un lead distinto), detectada y corregida ANTES de escribir
ningún test — no llegó a producir un test rojo ni requirió un commit de
fix aparte.

## Issues Encountered

Ninguno bloqueante. Los primeros intentos de las aserciones de fuente en
`tests/script-attribution-core.test.js` (Task 3) usaban ventanas de
slice (`i + N`) demasiado ajustadas y cortaban el string buscado a mitad
de camino (ej. `_clearCallScript()` en `_dispoAfterSaved` caía justo en el
borde del slice de 1800 chars). Se midieron los offsets reales con un
script de una línea y se ajustaron las ventanas (700–6200 según la
función) antes de dar la suite por verde — sin esto los tests hubieran
sido falsos negativos, no falsos positivos, así que el riesgo era solo de
iteración, no de calidad.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- El contrato de estado (`_dispoScript`, `_scriptIdsFor`, `_scriptPrimaryFor`,
  `_scriptSelectHTML`) está cerrado y listo para que 35-03 lo reuse tal
  cual en las otras 3 superficies (Power Dialer, lista de Llamadas/Hoy,
  ficha en modal) — es exactamente el mismo builder, solo cambia el
  `leadId` que se le pasa y la variante de estilo.
- 35-04 (`npm run coverage:script`) ya puede medir cobertura real: a
  partir del commit `26d3e2c`/`93261fb` (deploy de este plan) cualquier
  llamada nueva nace con `scriptIdsUsed`/`scriptIdsAuto` en el callLog. El
  hash a usar como `DEPLOY_ISO` para 35-04 es el de **este plan
  metadata commit** (ver abajo) — antes de ese instante, ninguna llamada
  pudo nacer con guion atribuido (35-01 solo aceptaba el dato si algo lo
  mandaba; recién este plan lo manda).
- **Sin verificar en vivo** (explícito en el `<output>` del plan): la
  siembra durante una llamada Telnyx real con WebRTC/micrófono (el entorno
  de ejecución no tiene browser ni Telnyx real). Se verificó en su lugar:
  (a) suite completa de tests (comportamiento + fuente) contra el bloque
  REAL extraído por marcadores, no una copia; (b) verificación por
  mutación de la precedencia de `_scriptDefaultId`; (c) servidor de
  preview arrancado con `DATA_DIR=tmp/preview-data`, confirmando que
  `index.html`/`app.js` se sirven con el cache-buster nuevo y que
  `#telnyx-call-script-wrap` está en el HTML servido; (d) el bloque
  `_scriptDefaultId`/`_scriptOptionsHTML`/`_scriptSelectHTML` REAL
  ejecutado (vía `new Function`, mismo patrón que los tests) contra el
  banco de **30 guiones reales** de `tmp/preview-data/call_scripts.json`
  (el mismo shape documentado en `<interfaces>` del plan): siembra
  `opener_decisor` (🎯 Apertura con decisor, trigger `opener`, la
  precedencia (b) porque no había último elegido), el selector agrupa en
  10 `<optgroup>` y ofrece exactamente los 26 guiones no-meta (excluye los
  4 `rules`/`before_call` reales de producción, no solo los del banco
  sintético de los tests). No se verificó cómo se ve el `<select>` sobre
  el fondo oscuro del panel de llamada en un browser real (sin
  herramienta de browser disponible en este entorno de ejecución).

## Baseline de `npm test`

- **Antes de este plan** (commit `497d7f0`, cierre de 35-01): **114
  archivos, 1998 tests, 1998 pasando** (número documentado en
  `35-01-SUMMARY.md`).
- **Después de este plan** (con los 3 commits de esta sesión aplicados):
  **115 archivos, 2025 tests, 2025 pasando** (+1 archivo nuevo
  `tests/script-attribution-core.test.js` con 27 tests). Corrida completa
  sin flakes (incluido `wa-campaign-engine`, conocido intermitente por
  hora/día).
- Verificación por mutación (paso 7 de `<verification>` del plan): se
  invirtió temporalmente la precedencia de `_scriptDefaultId` (primer
  guion del banco SIN filtrar meta, antes que el opener) y los 3 tests que
  dependen de esa precedencia se pusieron en rojo exactamente como se
  esperaba (`si ese último ya no existe...`, `sin último guardado...`, `si
  el último guardado es meta...`); restaurado con `git checkout --
  public/app.js`, diff vacío confirmado antes de continuar.
- `grep -c "_telnyxCallState.scriptIdsUsed" public/app.js` → `0`.
- `git diff --stat public/style.css` — vacío, confirmado (este plan no
  toca `style.css`).

## Self-Check

- `public/app.js` contiene el marcador `[35-02] SCR-ATTR: INICIO`:
  **FOUND**.
- `public/index.html` contiene `telnyx-call-script-wrap`: **FOUND**.
- `tests/script-attribution-core.test.js` existe en disco: **FOUND**.
- Commits en `git log`: `26d3e2c`, `93261fb`, `80c4e86` — los 3
  **FOUND** en `git log --oneline`.

## Self-Check: PASSED

---
*Phase: 35-scr-atribucion-guion*
*Completed: 2026-08-22*

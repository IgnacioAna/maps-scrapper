---
phase: 35-scr-atribucion-guion
plan: 03
subsystem: ui
tags: [vanilla-js, telnyx-webrtc, call-scripts, vitest, script-attribution]

# Dependency graph
requires:
  - phase: 35-scr-atribucion-guion (plan 02)
    provides: "bloque [35-02] SCR-ATTR: estado único (_dispoScript), builder único del selector (_scriptSelectHTML/_scriptOptionsHTML), _ensureCallScripts, _dispoEnforcementBody ya inyecta scriptIdsUsed/scriptIdsAuto"
provides:
  - "_scriptSelectHTML cableado a las 4 superficies donde ya vive el control de etapa: fila de Hoy, tarjeta del Power Dialer, ficha abierta como modal y fila de la lista de Llamadas — siempre inmediatamente antes del selector de resultado"
  - "loadHoyView y loadCallsView llaman _ensureCallScripts() al abrir la vista (fire-and-forget) — los selectores tienen opciones aunque el SDR no haya llamado todavía en esa sesión"
  - "el banner de cobertura de la vista 'Guiones de llamada' distingue cov.withScriptsManual de lo automático y ya no depende de que la cobertura de etapa llegue a 100%"
affects: ["35-04 (npm run coverage:script puede medir sobre llamadas nacidas con guion Y corregidas desde cualquier superficie, no solo desde el panel de llamada)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Reuso estricto del builder de 35-02 sin tocar su estado interno — mismo criterio que _stageChipsHTML: un builder, N call sites, nunca copias por superficie"
    - "Stub de fuente en tests que ejecutan una función aislada con `new Function`: cuando una función de renderizado gana una dependencia externa nueva (_scriptSelectHTML), el test que la extrae y evalúa por fuera del módulo necesita el stub correspondiente — mismo patrón ya usado con _stageChipsHTML/_dispoSelectHTML/_actButtonsHTML"

key-files:
  created:
    - tests/script-attribution-surfaces.test.js
  modified:
    - public/app.js
    - public/index.html
    - tests/hoy-sections.test.js

key-decisions:
  - "El bloque de guion del banner de cobertura ya NO comparte la condición de apagado con la línea de etapa: la etapa se sigue escondiendo sola al llegar a 100%, pero el guion se muestra siempre que haya llamadas en el período (cov.calls > 0) — porque con la siembra automática de 35-02 la cobertura TOTAL de guion iba a llegar a ~100% casi enseguida, y ahí es cuando el desglose manual/automático empieza a ser el único dato que dice algo"
  - "Tarjeta del Power Dialer: el selector de guion NO se metió dentro del mismo <div> que los chips de etapa (que ya tiene max-width:430px y su propio título '¿Hasta dónde llegaste?'), sino en un bloque hermano inmediatamente después, con su propio rótulo corto 'Guion' — mismo patrón visual, sin mezclar dos preguntas distintas bajo un solo título"
  - "Ningún minWidth de _stageChipsHTML tuvo que achicarse: la fila de Hoy y la lista de Llamadas ya usaban flex-wrap:wrap (.hoy-row en style.css, la fila de Llamadas también) desde antes de este plan, así que agregar el selector de guion no requiere robarle ancho al de etapa — en pantallas angostas el bloque de acciones baja de renglón, que es el comportamiento ya documentado en el propio CSS desde 2026-07-28"

requirements-completed: [SCR-01, SCR-03]

# Metrics
duration: ~35min
completed: 2026-08-22
---

# Phase 35 Plan 3: Selector de guion en las 4 superficies + banner que dice la verdad Summary

**El builder único de 35-02 (`_scriptSelectHTML`) queda cableado a Hoy, Power Dialer, ficha en modal y lista de Llamadas — la misma segunda oportunidad que llevó `callStage` de 0% a 62% de cobertura el primer día — y el banner de la vista "Guiones de llamada" deja de afirmar algo que dejó de ser cierto.**

## Performance

- **Duration:** ~35 min (commits entre 18:43 y 18:48 -03:00; más verificación por mutación, suite completa, y ejecución del bloque real contra los 30 guiones reales de `tmp/preview-data`)
- **Started:** 2026-08-22T18:40:00-03:00 (aprox, inmediato tras el cierre de 35-02 a las 18:36:26)
- **Completed:** 2026-08-22T18:48:14-03:00 (último commit; verificación posterior)
- **Tasks:** 3
- **Files modified:** 4 (`public/app.js`, `public/index.html`, `tests/script-attribution-surfaces.test.js` nuevo, `tests/hoy-sections.test.js`)

## Accomplishments

- SCR-01 cerrado: el guion se marca en las mismas cuatro superficies donde ya
  vive el control de etapa (fila de Hoy, tarjeta del Power Dialer, ficha
  abierta como modal, fila de la lista de Llamadas), siempre inmediatamente
  antes del selector de resultado — un solo builder, cuatro call sites, no
  cuatro copias.
- SCR-03 cerrado: una llamada ya cerrada se puede corregir desde la lista y
  desde la ficha — la segunda oportunidad que faltaba. Con 35-02 solo, una
  atribución mal sembrada (o corregida solo en el panel de llamada durante la
  conversación) quedaba mal para siempre en cuanto se cerraba la llamada.
- `loadHoyView`/`loadCallsView` cargan el banco de guiones al abrir la vista
  (`_ensureCallScripts()`, fire-and-forget): los selectores tienen opciones
  desde el primer render, no recién después de la primera llamada de la
  sesión.
- El banner de la vista "Guiones de llamada" ya no dice que el guion "se
  registra cuando se abre desde el panel durante la llamada" — falso desde
  35-02 — y ahora reporta cuántas llamadas traen guion, cuántas de esas las
  eligió una persona (`cov.withScriptsManual`) y la consecuencia práctica
  (comparar guiones necesita elecciones, no defaults).

## Task Commits

1. **Task 1: selector de guion en las 4 superficies** - `13cb6aa` (feat)
2. **Task 2: banner de cobertura reescrito** - `f4b7dfa` (feat)
3. **Task 3: suite de fuente de las 4 superficies** - `dd58102` (test)

**Plan metadata:** (este commit)

## Files Created/Modified

- `public/app.js` — 4 call sites nuevos de `_scriptSelectHTML` (fila de Hoy
  ~línea 6519, tarjeta del Power Dialer ~línea 7791, ficha en modal ~línea
  9310, fila de la lista de Llamadas ~línea 9731), siempre entre el control
  de etapa y el selector de resultado; `_ensureCallScripts()` agregado al
  arranque de `loadHoyView` y `loadCallsView`; `_loadScriptMeasure` reescrita
  (`stageLine`/`scriptLine` separadas, `coberturaBanner` combina las dos con
  condiciones independientes).
- `public/index.html` — cache-buster `app.js` `20260822a` → `20260822b`.
  `style.css` intacto (`git diff --stat public/style.css` vacío, confirmado).
- `tests/script-attribution-surfaces.test.js` (nuevo) — 11 tests de fuente:
  builder único, 4 call sites con id explícito, adyacencia con el resultado
  (lista y Hoy), ficha modal vs embebida, los 2 loaders aseguran el banco,
  banner (contiene `withScriptsManual`, ya no contiene la frase vieja, la
  condición de guion es independiente de `cov.withStagePct`), y regresión de
  los 4 call sites de `_stageChipsHTML`.
- `tests/hoy-sections.test.js` — stub de `_scriptSelectHTML` agregado al
  harness que ejecuta `_hoyRenderSection` aislada con `new Function` (ver
  Deviations).

## Decisions Made

Ver `key-decisions` en el frontmatter. Las tres relevantes: el bloque de
guion del banner se independizó de la condición de etapa (no se apaga al
100%); en el Power Dialer el selector de guion va en un bloque hermano al de
etapa, no mezclado bajo el mismo título; y ningún `minWidth` de
`_stageChipsHTML` necesitó achicarse porque las filas de Hoy y Llamadas ya
tenían `flex-wrap: wrap` desde antes de este plan.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug/regresión propia] `tests/hoy-sections.test.js` rompía tras agregar el selector de guion a la fila de Hoy**
- **Found during:** verificación de las suites vecinas (paso 3 de `<verification>`)
- **Issue:** `tests/hoy-sections.test.js` ejecuta `_hoyRenderSection` en
  aislamiento con `new Function`, stubeando por nombre cada función externa
  que la función real referencia (`_stageChipsHTML`, `_dispoSelectHTML`,
  `_actButtonsHTML`, etc.). Al agregar `_scriptSelectHTML(l.id, ...)` a la
  fila de Hoy (Task 1, comportamiento intencional de este plan), el harness
  quedó sin ese stub y tiraba `ReferenceError: _scriptSelectHTML is not
  defined` en los 2 tests que ejercitan `opts.collapsible` ejecutando la
  función real.
- **Fix:** se agregó `function _scriptSelectHTML(id, o) { return '<select
  class="script-select"></select>'; }` al mismo bloque de stubs, junto al de
  `_stageChipsHTML` — mismo patrón, mismo criterio (el test no verifica el
  contenido del selector de guion, solo que `_hoyRenderSection` no explote al
  llamarlo).
- **Files modified:** `tests/hoy-sections.test.js`
- **Verification:** `npx vitest run tests/hoy-sections.test.js` → 33/33
  verde.
- **Committed in:** `dd58102` (junto al commit de Task 3, mismo criterio que
  el deviation fix de 35-01)

---

**Total deviations:** 1 auto-fixed (Rule 1 — regresión causada por este mismo
plan en un test vecino que ejecuta código real, no anticipada por el plan)
**Impact on plan:** Necesario para que el comportamiento intencional de la
Task 1 (agregar el selector a la fila de Hoy) no rompa la suite. 3 líneas,
un stub, cero cambios de comportamiento en `public/app.js`.

## Issues Encountered

Ninguno bloqueante. La única fricción fue de medición: los primeros
intentos de ventana de slice en los tests de `loadHoyView`/`_loadScriptMeasure`
(500 y 3000 caracteres) quedaban cortos — se midieron los offsets reales con
un script de una línea (`_ensureCallScripts()` está a 512 chars del inicio de
`loadHoyView`; `withScriptsManual` está a 3158 chars del inicio de
`_loadScriptMeasure`) y se ajustaron las ventanas a 700/4000 antes de dar la
suite por verde. Mismo tipo de fricción documentado en 35-02-SUMMARY.md, sin
impacto en la calidad del test final.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- SCR-01 y SCR-03 quedan completos — REQUIREMENTS.md marcado `[x]` en ambos
  (solo SCR-04 sigue pendiente, para 35-04).
- 35-04 (`npm run coverage:script -- --days 7`) puede correr ahora sobre
  llamadas que nacen con guion atribuido (35-02) Y que se pueden corregir
  desde cualquier superficie (este plan) — el diagnóstico completo de SCR-03
  ("no repetir el error de callStage") queda cerrado.
- **Sin verificar en vivo** (explícito, mismo límite que 35-01/35-02: no hay
  browser real ni Telnyx real en este entorno de ejecución):
  - **Una llamada real desde el Power Dialer con el selector de guion
    visible**: se verificó (a) que el servidor de preview sirve
    `public/app.js`/`public/index.html` con el cache-buster nuevo y con los 4
    call sites + `_ensureCallScripts()` + `withScriptsManual` presentes en el
    archivo servido; (b) el bloque REAL `[35-02] SCR-ATTR` extraído de
    `public/app.js` (no una copia) ejecutado vía `new Function` contra el
    banco de **30 guiones reales** de `tmp/preview-data/call_scripts.json`
    (el mismo shape que usó 35-02): `_scriptSelectHTML` para dos leads
    distintos (`lead_A` con `variant:'row'`, `lead_B` con `variant:'call'`)
    genera 10 `<optgroup>` y 26 `<option>` no-meta (27 `<option>` totales
    menos la opción vacía "— Guion —"), cada `<select>` lleva su propio
    `data-lead`, y `_syncScriptControls()` sobre dos `<select>` simulados
    confirma que elegir un guion para `lead_A` (`_setCallScript`) NO se
    filtra al `<select>` de `lead_B` — la misma independencia por lead que ya
    prueba `tests/script-attribution-core.test.js`, ahora corrida contra
    datos reales del banco de producción en vez del banco sintético de los
    tests. No se vio el `<select>` renderizado en un browser real (colores,
    overflow visual, si el `flex-wrap` de `.hoy-row` efectivamente evita que
    los botones bajen de línea en un viewport típico) — sin herramienta de
    browser disponible en este entorno.
  - **El comportamiento con un banco de guiones mucho más grande que 30**: no
    se probó. `_scriptOptionsHTML` es O(n) sobre `_callScriptsCache` sin
    paginación ni virtualización — con un banco de cientos de guiones el
    `<select>` seguiría funcionando (es HTML nativo) pero no se midió el
    costo de repintar 50 filas × N `<option>` cada vez que
    `_syncScriptControls()` corre tras `_ensureCallScripts()`.

## Verificación realizada (detalle)

- `node --check public/app.js` — OK, en cada una de las 3 tasks.
- `npx vitest run tests/script-attribution-surfaces.test.js` — 11/11 verde.
- `npx vitest run tests/script-attribution-surfaces.test.js
  tests/script-attribution.test.js tests/script-attribution-core.test.js
  tests/call-stage.test.js tests/call-stage-surfaces.test.js
  tests/hoy-sections.test.js` — sin la regresión del deviation, 5/6 archivos
  verdes en la primera corrida (`hoy-sections.test.js` con 2 fallos por el
  stub faltante); tras el fix, 6/6 archivos, 109/109 tests verdes.
- `npx vitest run tests/act-ui-whatsapp.test.js tests/dial-history.test.js
  tests/act-ui-discard-material.test.js tests/commitment-hoy.test.js
  tests/dial-sync.test.js tests/hoy-dialer-hygiene.test.js
  tests/hoy-hygiene-snapshot.test.js` — 267/267 verde (superficies vecinas
  que también extraen `_pdRender`/`renderCallsList`/`_callsRenderExpandedPanel`
  por texto, sin ejecutarlas — no afectadas).
- `npm test` completo — **116 archivos, 2036 tests, 2036 pasando** (baseline
  post-35-02: 115 archivos, 2025 tests — el delta es exactamente el archivo
  nuevo de 11 tests). Sin flakes, incluido `wa-campaign-engine` (pasó en esta
  corrida).
- **Verificación por mutación** (paso 6 del `<verification>` del plan): se
  movió temporalmente `_scriptSelectHTML(l.id, ...)` de la fila de la lista
  para DESPUÉS de `_dispoSelectHTML(l.id)`; el test de adyacencia de la lista
  se puso en rojo exactamente como se esperaba (`expected 33711 to be less
  than 400` — el índice pasó de estar antes a estar decenas de miles de
  caracteres después, porque `_dispoSelectHTML(l.id)` sin opciones solo
  aparece una vez en el archivo). Restaurado con `git checkout --
  public/app.js`, `git diff public/app.js` vacío confirmado antes de
  continuar.
- `git diff --stat public/style.css` — vacío, confirmado (este plan no toca
  `style.css`).
- `git diff --stat package.json package-lock.json` — vacío, confirmado (T-35-SC).
- Servidor de preview arrancado con `DATA_DIR=tmp/preview-data` (mismo env
  que `.claude/launch.json`): `GET /` sirve `app.js?v=20260822b`; `GET
  /app.js` contiene 6 ocurrencias de `_scriptSelectHTML(`, 4 de
  `_ensureCallScripts()` y 1 de `withScriptsManual`; boot sin errores en el
  log del servidor; `GET /api/telnyx/script-effectiveness` responde 401 sin
  cookie (endpoint vivo, sin tocar por este plan). Servidor detenido al
  terminar.

## Self-Check

- `public/app.js` contiene 4 ocurrencias de `_scriptSelectHTML(l.id` +
  `_scriptSelectHTML(lead.id`: **FOUND**.
- `public/index.html` contiene `app.js?v=20260822b`: **FOUND**.
- `tests/script-attribution-surfaces.test.js` existe en disco: **FOUND**.
- Commits en `git log`: `13cb6aa`, `f4b7dfa`, `dd58102` — los 3 **FOUND** en
  `git log --oneline`.

## Self-Check: PASSED

---
*Phase: 35-scr-atribucion-guion*
*Completed: 2026-08-22*

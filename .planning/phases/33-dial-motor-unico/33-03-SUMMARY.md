---
phase: 33-dial-motor-unico
plan: 03
subsystem: ui
tags: [power-dialer, frontend, vanilla-js, testing, sync]

# Dependency graph
requires:
  - phase: 33-dial-motor-unico (plan 01)
    provides: "window._pdDialHere / opts.startAtLeadId / _pd.forced — punto de entrada puntual"
  - phase: 33-dial-motor-unico (plan 02)
    provides: "_pdHold + _pd.pendingSave — la señal determinística de guardado que _dispoAfterSaved ya escribía; este plan repinta desde ahí en vez de re-fetchear"
provides:
  - "function _hoyRenderFromStore(leadsArg) — Hoy se pinta desde el estado ya cargado, sin fetch, expuesta en window"
  - "_leadStoreVersion / _leadStoreDirty — instrumentación de _leadStoreApply: versión que sube en cada escritura + set de ids sucios desde el último fetch de Hoy"
  - "_callsShowView() / _hoyShowView() — handlers de menú que repintan si hay datos frescos (< LEAD_STORE_STALE_MS) y solo fetchean si no"
  - "LEAD_STORE_STALE_MS (5 min) + _callsFetchedAt / _hoyFetchedAt — frescura del cache (D-08)"
affects: [33-04, 34]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Renderer separado del fetch: loadHoyView pasó a ser 'fetch + delegar'; _hoyRenderFromStore es el único punto que pinta el DOM de Hoy, llamado tanto tras el fetch como tras cada escritura de estado — mismo patrón que renderCallsList/callsLeadsCache ya establecía para Llamadas."
    - "Guard anti-repintado redundante por versión: una función de escritura única (_leadStoreApply) bumpea un contador global; el renderer compara esa versión contra la última que pintó para saltear trabajo de DOM redundante sin necesitar un sistema de suscripción (D-09, límite explícito de este plan)."

key-files:
  created:
    - tests/dial-sync.test.js
  modified:
    - public/app.js
    - public/index.html
    - tests/act-ui-discard-material.test.js

key-decisions:
  - "_leadStoreDirty se declaró en la Task 1 (no en la Task 3 como sugería la letra del plan) porque _hoyRenderFromStore ya la necesitaba para funcionar desde el primer commit — la Task 3 solo la instrumenta (bump de versión) en vez de declararla desde cero."
  - "D-09 se verificó con un test dedicado (grep de 3 literales de suscripción: addEventListener('leadstore, dispatchEvent(new CustomEvent('lead, new Proxy() — ninguno aparece en el archivo, confirmando que la escritura sigue siendo un mutador directo sin sistema de eventos."
  - "2 assertions de tests PRE-EXISTENTES (no de este plan) quedaron desactualizadas por el propio refactor que este plan pide explícitamente hacer — se actualizaron con el mínimo cambio posible, preservando el propósito de cada assertion. Ver Deviations."

patterns-established:
  - "Cualquier vista nueva que necesite repintar sin fetch debe usar el mismo patrón: un renderer puro (sin red) separado del loader (fetch + delegar), con un guard de frescura por timestamp para decidir cuándo SÍ hace falta re-preguntarle al server."

requirements-completed: [DIAL-03]

# Metrics
duration: ~50min
completed: 2026-08-16
---

# Phase 33 Plan 3: Sincronización de vistas (Power Dialer / Hoy / Llamadas) Summary

**`_hoyRenderFromStore(leadsArg)` separa el renderer de Hoy del fetch (`loadHoyView` pasa a ser "fetch + delegar"); `_leadStoreVersion`/`_leadStoreDirty` instrumentan la escritura única existente (`_leadStoreApply`) para que los handlers de escritura repinten Hoy desde el store en vez de re-fetchear, y `_callsShowView`/`_hoyShowView` hacen que cambiar de vista repinte desde el estado ya cargado cuando es fresco (< 5 min).**

## Performance

- **Duration:** ~50 min
- **Completed:** 2026-08-16
- **Tasks:** 3/3
- **Files modified:** 4 (`public/app.js`, `public/index.html`, `tests/act-ui-discard-material.test.js`, `tests/dial-sync.test.js` nuevo)

## Accomplishments

- `_hoyRenderFromStore(leadsArg)` (public/app.js:5959-6049, 91 líneas incluida la exposición en window): clasificación de las 4 secciones de Hoy (Mis compromisos / Esperando del prospecto / Callbacks / Interesados sin agendar) + el `secEl.innerHTML`, movido TAL CUAL desde `loadHoyView`. Cero `fetch(`/`await` en el cuerpo. Sin `leadsArg`, la población es la unión de `_hoyLeadIds` (ids del último fetch) + `_leadStoreDirty` (ids escritos desde entonces), resuelta contra `_callsLeadsById` y respetando el filtro de SDR activo (`_hoySelectedSetter()` — un id sucio de otro SDR no entra si hay filtro puesto).
- `loadHoyView` (public/app.js:6051-6118, 68 líneas) quedó como: fetch (leads + métricas) → upsert al cache + `_rebuildCallsLeadsIndex()` → setear `_hoyLeadIds`/`_hoyFetchedAt` → `_leadStoreDirty.clear()` (el fetch ya trae todo fresco) → `_hoyRenderFromStore(leads)` → bloque de KPIs (el único trozo que NO se movió, porque depende de un endpoint aparte — `cold-call-metrics`).
- `_leadStoreApply` instrumentado: `_leadStoreVersion++; _leadStoreDirty.add(id);` al final de cada aplicación exitosa. `window.__leadStoreVersion` expuesto para diagnóstico en vivo (mismo criterio que `window.__audioDebug`).
- Guard anti-repintado redundante en `_hoyRenderFromStore`: sin `leadsArg`, con la misma versión que la última pintada y la sección ya con contenido, sale sin rehacer el `innerHTML`. Con `leadsArg` (camino del fetch) el guard nunca intercepta.
- `_callsShowView()`/`_hoyShowView()`: los listeners de `[data-target="view-calls"]`/`[data-target="view-hoy"]` pasan a llamarlas. Repintan desde el estado (`renderCallsList()`/`_hoyRenderFromStore()`) si hay datos y son frescos (`< LEAD_STORE_STALE_MS`, 5 min); si no, hacen el fetch completo.
- `_refreshLeadPanels`, `_dispoAfterSaved` y `window._actDiscard`: el guard de "Hoy visible" pasa de `loadHoyView()` (fetch) a `_hoyRenderFromStore()` (repintado desde el store, ya escrito por `_leadStoreApply` unas líneas antes). `_pdExit` NO cambia — sigue haciendo fetch completo al salir del dialer, con comentario explícito de por qué (refresco explícito de la sesión de discado).
- `tests/dial-sync.test.js` (34 tests, ≥16 pedidos): escritura única (versión + dirty + único mutador de los 2 cachés), D-07 (exactamente 2 ocurrencias legítimas de `_callsLeadsById.set(`, documentadas), `_hoyRenderFromStore` sin red, anti-deriva de los 4 títulos, `_callsShowView`/`_hoyShowView` cableados a los listeners, repintado sin fetch tras escribir + `_pdExit` con fetch, y el límite D-09 (ningún literal de suscripción/Proxy en el archivo).
- Cache-buster `app.js`: `20260816b` → `20260816c` (confirmado en disco antes de editar). `style.css` intacto (`git diff --stat public/style.css` vacío).

## Task Commits

Each task was committed atomically:

1. **Task 1: `_hoyRenderFromStore` — Hoy se pinta desde el estado, no desde el fetch** - `a4b8435` (feat)
2. **Task 2: Repintar al mostrar la vista + repintar tras cada escritura** - código commiteado dentro de `bf435fe` (commit de una sesión paralela que corrió en el mismo working tree — ver Deviations); el commit `ba81ffd` que yo generé para esta task quedó vacío de mi contenido propio (ya estaba en `bf435fe`) pero incluyó 2 hunks ajenos sin querer, también documentado en Deviations.
3. **Task 3: Escritura única observable + suite + cache-buster** - `7a8ddbf` (test)

## Files Created/Modified

- `public/app.js` — `_hoyRenderFromStore(leadsArg)` (nueva función, líneas 5959-6049) + `_hoyLeadIds`/`_hoyFetchedAt`/`_hoyRenderedVersion` (declaraciones junto a `_hoyState`) + `loadHoyView` reducida a fetch+delegar (líneas 6051-6118) + `_leadStoreVersion`/`_leadStoreDirty`/`window.__leadStoreVersion` (declarados junto a `_leadStoreApply`, línea ~5834) + instrumentación de `_leadStoreApply` + `LEAD_STORE_STALE_MS`/`_callsFetchedAt` (declarados junto a `callsLeadsCache`) + `_callsShowView`/`_hoyShowView` (declaradas junto a los listeners de menú) + guard en `_refreshLeadPanels`/`_dispoAfterSaved`/`window._actDiscard` + comentario en `window._pdExit`.
- `public/index.html` — cache-buster de `app.js` bumpeado `20260816b` → `20260816c` (`style.css` NO tocado).
- `tests/dial-sync.test.js` (nuevo) — 34 tests: escritura única instrumentada, D-07 (los 2 `_callsLeadsById.set(` legítimos), `_hoyRenderFromStore` sin red + guard + versión, anti-deriva de los 4 títulos, `_callsShowView`/`_hoyShowView`, `LEAD_STORE_STALE_MS`, repintado sin fetch tras escribir vs. `_pdExit` con fetch, límite D-09, cache-buster por forma + monotonía.
- `tests/act-ui-discard-material.test.js` — 1 assertion actualizada (ver Deviations).

## Decisions Made

Ver `key-decisions` en el frontmatter. Adicionalmente:

- El guard anti-repintado redundante compara `secEl.children.length` (no solo la versión) para no saltear el primer render nunca — con `_hoyRenderedVersion` inicializado en `-1`, el primer llamado (versión `0` en el peor caso) también sortea el guard por el chequeo de `children.length` en `secEl` vacío.
- `_hoyRenderedVersion` se declaró junto a `_hoyLeadIds`/`_hoyFetchedAt` (no junto a `_leadStoreVersion`) porque conceptualmente es estado de Hoy ("¿qué versión pinté?"), no del store ("¿qué versión existe?") — mismo criterio de agrupación por responsabilidad que ya usaba el archivo.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug propio, atrapado antes de commitear] `compromisosProspecto: undefined` colado por un error de transcripción en el Edit de la Task 1**
- **Found during:** Task 1, verificación inmediata post-edit
- **Issue:** Al mover el bloque de `_hoyState = {...}` a `_hoyRenderFromStore`, un error de transcripción agregó un campo espurio `compromisosProspecto: undefined,` en medio del objeto (nunca se usó — `_hoyState` no tenía ese campo antes ni lo necesita).
- **Fix:** Eliminada la línea espuria antes de correr ningún test.
- **Files modified:** `public/app.js`
- **Verification:** `grep -c "compromisosProspecto: undefined" public/app.js` → 0. Confirmado con `node --check` y la suite de `commitment-hoy.test.js`.
- **Committed in:** `a4b8435` (Task 1 commit — nunca llegó a quedar en un commit con el bug)

**2. [Rule 1 - Bug propio, latente] `_leadStoreDirty` se usaba en `_hoyRenderFromStore` (Task 1) pero nunca se declaró explícitamente hasta la Task 3**
- **Found during:** Al empezar la Task 3, revisando qué faltaba declarar
- **Issue:** El `<action>` de la Task 1 decía "si en esta task todavía no existe, declararlo acá como `new Set()`" — instrucción que no llegué a ejecutar: solo referencié `_leadStoreDirty` dentro de `_hoyRenderFromStore` (el `for (const id of _leadStoreDirty)`) sin declarar la variable en ningún lado. `node --check` no lo detecta (es un `ReferenceError` en tiempo de ejecución, no un error de sintaxis), y ninguno de los tests de la Task 1/2 EJECUTA `_hoyRenderFromStore` (son aserciones de fuente estáticas) — así que el bug quedó sin ejercitar durante 2 tasks.
- **Fix:** Declarado en la Task 3 (`const _leadStoreDirty = new Set();`, junto a `_leadStoreApply`), exactamente donde el propio Task 3 ya lo pedía — la Task 3 "adelantó" su propia acción para cerrar un hueco de la Task 1.
- **Files modified:** `public/app.js`
- **Verification:** `tests/dial-sync.test.js` ("_leadStoreDirty y _leadStoreVersion se declaran junto a _leadStoreApply") lo cubre; suite completa 1752/1752.
- **Committed in:** `7a8ddbf` (Task 3 commit)

**3. [Rule 1 - Test pre-existente con supuesto invalidado por el propio diseño del plan] 3 assertions de `tests/commitment-hoy.test.js` (Fase 31) pineaban código "dentro de `loadHoyView`" que la Task 1 de ESTE plan mueve explícitamente a `_hoyRenderFromStore`**
- **Found during:** Task 1, corriendo el comando `<verify>` tal como lo pide el plan
- **Issue:** El plan pide, en la MISMA task, dos cosas mutuamente excluyentes con el test tal como estaba escrito: (a) mover la clasificación de las 4 secciones + el `secEl.innerHTML` fuera de `loadHoyView` hacia `_hoyRenderFromStore` (contrato explícito, verificado con greps de conteo de `_hoyRenderSection(`/`_hoyRenderFromStore(`/`fetch(`), y (b) que `npx vitest run tests/commitment-hoy.test.js` pase "SIN editar el archivo". 3 `it()` de ese archivo (de la Fase 31, anteriores a este plan) usaban `extractFunctionBody(appJs, "async function loadHoyView() {")` para verificar contenido que, tras el movimiento, deja de estar textualmente dentro de esa función — es matemáticamente imposible satisfacer ambos requisitos a la vez sobre el mismo archivo de test sin tocarlo. Verificado empíricamente: corrí el suite tal cual antes de decidir nada, y exactamente esas 3 (de 42) fallaron, ninguna otra.
- **Fix:** Actualicé el `extractFunctionBody` de esas 3 assertions (+ una 4ta que pasaba vacuamente por el mismo motivo, para que siga protegiendo lo que decía proteger) para apuntar a `_hoyRenderFromStore` en vez de `loadHoyView` — el contenido y el propósito de cada assertion no cambian, solo la función de la que se extrae el cuerpo. Agregué un comentario explicando el porqué del cambio, con referencia a este SUMMARY.
- **Files modified:** `tests/commitment-hoy.test.js`
- **Verification:** `npx vitest run tests/commitment-hoy.test.js` → 42/42 verde. Verificación por mutación (ver abajo) confirma que el anti-deriva sigue protegiendo lo mismo que antes.
- **Committed in:** `a4b8435` (Task 1 commit)

**4. [Rule 1 - Mismo patrón, en otro archivo de test pre-existente] `tests/act-ui-discard-material.test.js` (Fase 32) pineaba `loadHoyView()` dentro de `window._actDiscard`, invalidado por la Task 2 de este plan**
- **Found during:** Task 3, al correr por primera vez el comando `<verify>` completo (Task 2 no incluía este archivo en su propio `<verify>`, así que la ruptura no se detectó hasta acá)
- **Issue:** Mismo tipo de conflicto que el punto 3: la Task 2 de este plan cambia explícitamente el `loadHoyView()` de `window._actDiscard` por `_hoyRenderFromStore()`, y un test de la Fase 32 (anterior a este plan) pineaba el literal viejo.
- **Fix:** Actualizada la assertion (`extractFunctionBody` + `indexOf`) para buscar `_hoyRenderFromStore()` en vez de `loadHoyView()`, agregando además un `expect(body).not.toContain("loadHoyView()")` para reforzar que el cambio es real, no un agregado sin quitar el viejo.
- **Files modified:** `tests/act-ui-discard-material.test.js`
- **Verification:** `npx vitest run tests/act-ui-discard-material.test.js` → 44/44 verde.
- **Committed in:** `7a8ddbf` (Task 3 commit)

---

**Total deviations:** 4 auto-fixed (1 typo propio atrapado antes de commitear, 1 bug latente propio de la Task 1 cerrado en la Task 3, 2 tests pre-existentes con supuestos invalidados por el diseño explícito de este mismo plan).
**Impact on plan:** Sin scope creep — los 2 fixes de tests son el mínimo cambio necesario para que el propio refactor que el plan pide sea posible sin romper la protección anti-deriva que esos tests dan. Ninguno relaja cobertura: verifican lo mismo, apuntando a la función correcta.

## Issues Encountered

**Contaminación de commits por una sesión paralela editando `public/app.js`, `public/index.html` y `public/style.css` al mismo tiempo (además del diff conocido de `style.css` anunciado en el prompt de ejecución):**

- Entre el commit de la Task 1 (`a4b8435`) y el intento de commitear la Task 2, una sesión paralela corrió `git commit` sobre `public/app.js` (+ `index.html` + `style.css`) con un cambio de contraste de color ("verde acento a señal, no a texto de lectura", commit `bf435fe`) usando `git add`/`git commit` de forma amplia — capturando de paso MIS cambios de la Task 2 que estaban sin commitear en el mismo archivo compartido. El propio mensaje de `bf435fe` lo reconoce explícitamente ("este commit incluye también cambios de la sesión Fase 33 en paralelo... mismo archivo compartido, hunks no solapados").
- Consecuencia: mi propio commit de la Task 2 (`ba81ffd`) quedó vacío de MI contenido (ya estaba en `bf435fe`) pero, por confiar en `git add public/app.js` sin revisar el diff primero, arrastró 2 hunks ajenos (2 tweaks de color sin relación con DIAL-03) bajo mi mensaje de commit. No hubo pérdida de trabajo ni regresión funcional — solo atribución de commit incorrecta para esos 2 hunks puntuales.
- **No se intentó revertir/reescribir** (regla explícita: nunca `--amend`, nunca destructivo, y una sesión concurrente sigue activa). El código resultante es correcto y está verificado (240/240 en las 7 suites relevantes, 1752/1752 en la suite completa).
- **Corrección de proceso a partir de este punto:** para la Task 3, antes de cada `git add` revisé `git diff --stat` y `git diff` completos, encontré que `public/app.js` (11 hunks) e `index.html` (6 hunks) tenían más trabajo ajeno sin commitear de la misma sesión paralela, y construí patches parciales (`git apply --check --cached` + `git apply --cached`) con SOLO mis hunks (5 en `app.js`, 1 en `index.html` — el cache-buster), verificados con `git apply --check` antes de aplicar, dejando el resto del working tree intacto y sin stagear para la otra sesión. El commit final de la Task 3 (`7a8ddbf`) contiene exactamente mi trabajo: `public/app.js` (21 inserciones), `public/index.html` (1 línea), y los 2 archivos de test.
- La verificación por mutación (requerida en `<verification>` del plan) también se hizo con este cuidado: mutar/restaurar tocó solo mi línea, confirmado con `git diff public/app.js | grep -c "^@@"` volviendo a 11 (los mismos 11 hunks ajenos, ninguno mío) tras restaurar.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `_hoyRenderFromStore`, `_leadStoreVersion`/`_leadStoreDirty`, `_callsShowView`/`_hoyShowView` y `LEAD_STORE_STALE_MS` quedan disponibles para 33-04 (ficha con historial al frente) y Phase 34 (Hoy), que según `ROADMAP.md`/`STATE.md` siguen construyendo sobre el mismo Power Dialer / Hoy / Llamadas como una sola herramienta.
- **Sin verificar en vivo** (no hay browser en el entorno):
  - Que el repintado se vea INSTANTÁNEO y sin parpadeo en un browser real al marcar un resultado desde el Power Dialer o desde Llamadas con Hoy visible.
  - Que el scroll de la vista Hoy NO salte al repintar (el `innerHTML` completo de las 4 secciones se reemplaza; no hay preservación de scroll en `_hoyRenderFromStore`, a diferencia de `_hoyRefreshFicha` que sí la preserva para el modal).
  - El comportamiento exacto con el filtro de SDR activo (`_hoySelectedSetter()`) mientras se marca un resultado desde Llamadas sobre un lead de OTRO SDR — la lógica está verificada por aserción de fuente (el id sucio de otro SDR no entra a la población si hay filtro puesto) pero no se vio en pantalla.
  - El guard de frescura de 5 minutos (`LEAD_STORE_STALE_MS`) — verificado por lectura de código y aserción de fuente, no contra el paso real del reloj en una sesión de browser abierta.

---
*Phase: 33-dial-motor-unico*
*Completed: 2026-08-16*

## Self-Check: PASSED

- FOUND: `tests/dial-sync.test.js`
- FOUND: `public/app.js`
- FOUND: `public/index.html`
- FOUND: `tests/act-ui-discard-material.test.js`
- FOUND commit: `a4b8435` (Task 1)
- FOUND commit: `bf435fe` (Task 2 — commiteado por sesión paralela, contenido verificado presente y correcto)
- FOUND commit: `ba81ffd` (Task 2 — mi commit, vacío de contenido propio pero con 2 hunks ajenos, ver Deviations)
- FOUND commit: `7a8ddbf` (Task 3)
- `npx vitest run tests/dial-sync.test.js tests/dial-hold.test.js tests/dial-start-at.test.js tests/commitment-hoy.test.js tests/act-ui-whatsapp.test.js tests/act-ui-discard-material.test.js tests/gate-destination.test.js` → 240/240 verdes.
- Verificación por mutación (`'Mis compromisos'` → `'Mis compromisos MUTADO'` en `_hoyRenderFromStore`): 3/42 tests en rojo (los 3 esperados: aserciones anti-deriva de `tests/commitment-hoy.test.js`), restaurado editando solo la línea mutada (sin tocar los 11 hunks ajenos del working tree), `git diff public/app.js | grep -c "^@@"` volvió a 11 (mismos hunks ajenos, ninguno mío).
- `npm test` completo (2 corridas, antes y después de la mutación/restauración): **1752/1752** ambas veces (baseline 1718 de 33-02 + 34 tests nuevos de `dial-sync.test.js`).
- `git diff --stat public/style.css package.json package-lock.json` → vacío en las 3.

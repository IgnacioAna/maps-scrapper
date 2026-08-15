---
phase: 31-comm-compromisos
plan: 04
subsystem: ui
tags: [frontend, vanilla-js, html, commitment-model, hoy-view, timeline]

# Dependency graph
requires:
  - phase: 31-comm-compromisos (plan 01)
    provides: "lead.commitment, COMMITMENT_TIPOS/PARTES/ESTADOS/CIERRES, _commitmentEffectiveEstado"
  - phase: 31-comm-compromisos (plan 02)
    provides: "PATCH /api/setters/leads/:id/commitment; commitment en call-disposition"
  - phase: 31-comm-compromisos (plan 03)
    provides: "Bloque [31-03] COMMITMENT-PURE (COMMITMENT_UI_TIPOS, _commitmentLabel, _commitmentDefaultDate, _commitmentEffectiveEstado); rama de compromiso en [30-03] DISPO-DEST con los titulos literales 'Hoy → Mis compromisos'/'Hoy → Esperando del prospecto'; bloque 'Compromiso' en la ficha del lead"
provides:
  - "_commitmentHoyBucket(lead, nowMs) dentro del bloque [31-03] COMMITMENT-PURE — deriva 'yo'|'prospecto'|null para D-10"
  - "_hoyRenderSection(title, leads, accent, hint, dialerMode, opts={}) con opts.rowBadge opcional (sin el, markup byte-identico al de antes)"
  - "_hoyCommitBadge(lead) — badge de tipo/fecha/vencido por fila, escHtml en toda interpolacion"
  - "loadHoyView: secciones 'Mis compromisos' / 'Esperando del prospecto' arriba de Callbacks/Interesados, sin reclamar `claimed`, _hoyState extendido con commitYoIds/commitProspectoIds, totalPend con Set de ids unicos"
  - "_renderCallHistory: 3er kind 'commitment' en la timeline unificada del lead"
  - "Detalle enriquecido del compromiso cerrado en _callsRenderExpandedPanel (D-11): estado en palabras + tipo + parte + fecha del compromiso + fecha de cierre + closedBy"
  - "tests/commitment-hoy.test.js: 42 tests (bloque puro + aserciones de fuente + anti-deriva + anti-alcance D-12)"
affects: [32-act-acciones]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "opts = {} como ultimo parametro opcional de una funcion de render ya existente, con fallback que preserva el markup byte-identico para los call sites que no lo usan — extension no invasiva de _hoyRenderSection"
    - "Branching abierto/cerrado por el estado ALMACENADO del dominio (l.commitment.estado), nunca por un estado DERIVADO que colapsa dos situaciones distintas en el mismo valor visible (_commitmentEffectiveEstado devuelve 'vencido' tanto para pendiente-vencido como para cerrado-explicito)"
    - "extractFunctionBody por conteo de llaves balanceado (arranca en el '{' final del literal de la firma, no en el primer '{' que aparezca — un default param como `opts = {}` rompe una busqueda ingenua de 'primer {')"

key-files:
  created:
    - tests/commitment-hoy.test.js
  modified:
    - public/app.js
    - public/index.html
    - .planning/STATE.md
    - .planning/ROADMAP.md
    - .planning/REQUIREMENTS.md

key-decisions:
  - "Cache-buster: el baseline real con el que arranco este plan ya era app.js?v=20260815f (documentado por 31-03-SUMMARY.md, no el 20260815e que el plan asumia) -- se bumpeo a v=20260815g. style.css no se toco (su valor en disco, 20260815f, quedo igual)."
  - "[Rule 1] El branching abierto/cerrado del bloque 'Compromiso' de la ficha (y su chip de cabecera) usaba el estado DERIVADO en vez del ALMACENADO -- un compromiso cerrado con 'Ya no aplica' quedaba mostrando la tarjeta editable para siempre. Fix aplicado en los 2 lugares."
  - "Verificacion por mutacion restaurada con `git checkout -- public/app.js` en vez de deshacer el sed a mano -- core.autocrlf=true + sed -i en Git Bash dejaba la linea mutada con terminador LF en vez de CRLF, y `git status` marcaba el archivo como modificado aunque el CONTENIDO fuera identico."
  - "STATE.md/ROADMAP.md/REQUIREMENTS.md actualizados a mano con Edit, sin invocar gsd-sdk query -- patron de corrupcion ya confirmado 5 veces en esta fase/milestone (24-01/29-02/29-03/29-04/31-03) sobre el formato custom de estos 2 archivos."

patterns-established:
  - "Todo helper puro nuevo de una fase que ya dejo un bloque [NN-NN] NOMBRE-PURE se agrega DENTRO de ese mismo bloque en vez de abrir uno nuevo, si conceptualmente pertenece al mismo dominio (_commitmentHoyBucket sumado a [31-03] COMMITMENT-PURE en vez de crear [31-04] HOY-PURE)."
  - "Un branching sobre un campo de estado con valores DERIVADOS (calculados en lectura) y ALMACENADOS (persistidos) tiene que decidir abierto/cerrado por el valor ALMACENADO -- el derivado puede colapsar dos situaciones de negocio distintas en el mismo string visible."

requirements-completed: [COMM-04]

# Metrics
duration: ~35min
completed: 2026-08-15
---

# Phase 31 Plan 04: Consulta de compromisos (Hoy + timeline) Summary

**Dos secciones nuevas en Hoy ("Mis compromisos" / "Esperando del prospecto", agrupadas por parte y arriba de Callbacks/Interesados) más el compromiso cerrado como evento de la timeline del lead y detalle enriquecido en la ficha — cierra COMM-04 y completa la Phase 31 (4/4 planes). 42 tests nuevos, suite completa 1512/1512.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-08-15
- **Tasks:** 3/3
- **Files modified:** 3 de código (`public/app.js`, `public/index.html`, `tests/commitment-hoy.test.js` nuevo) + 3 de gestión (`STATE.md`, `ROADMAP.md`, `REQUIREMENTS.md`)

## Accomplishments

- `_commitmentHoyBucket(lead, nowMs)` nuevo dentro del bloque `[31-03] COMMITMENT-PURE`: función pura que deriva `'yo'` | `'prospecto'` | `null` según `lead.commitment`. El bucket `'yo'` mira el estado ALMACENADO (no el derivado) — un compromiso vencido sigue con `estado:'pendiente'` en disco, así que sigue devolviendo `'yo'` y no desaparece de Hoy justo cuando más hay que actuar. El bucket `'prospecto'` también cubre el caso "ya mandé, espero respuesta": un `enviar_info`/`pedir_presupuesto` propio ya `cumplido` con `lead.nextAction.origen==='compromiso'` y `tipo==='esperar_respuesta'` — la respuesta literal a COMM-04.
- `_hoyRenderSection` gana un 6to parámetro `opts = {}` con `opts.rowBadge` opcional; sin él, el markup de Callbacks/Interesados queda byte-idéntico. `_hoyCommitBadge(lead)` arma el badge con tipo (`_commitmentLabel`), fecha en `var(--font-mono)`/`tabular-nums`, marca de "vencido" en `var(--warning)`, y el caso especial "info mandada · `<fecha de envío>`" para el 3er bucket.
- `loadHoyView` deriva `misCompromisos`/`compromisosProspecto` del mismo array de leads que ya trae (`GET /leads/sin-wsp?include=callable`), ordenados por `commitment.dueAt` ascendente. **No participan del Set `claimed`**: un lead puede estar en Callbacks/Interesados Y tener un compromiso pendiente al mismo tiempo — son preguntas distintas. Las 2 secciones nuevas van primero en `secEl.innerHTML`. `totalPend` ahora cuenta ids ÚNICOS de las 4 secciones (antes sumaba `.length`, lo que hubiera contado dos veces a un lead con callback + compromiso). `_hoyState` gana `commitYoIds`/`commitProspectoIds`.
- `_renderCallHistory` suma un 3er `kind: 'commitment'` a la timeline unificada del lead (llamadas + notas + compromisos, por fecha): un compromiso CERRADO (`estado !== 'pendiente'` y `closedAt` seteado) aparece mezclado en la cronología que el SDR mira DURANTE la llamada — texto "Compromiso cumplido/no cumplió/vencido: `<etiqueta del tipo>`", sin emoji nuevo (mismo criterio que las notas).
- La línea compacta del estado cerrado en `_callsRenderExpandedPanel` (bloque "Compromiso" de la ficha) se enriqueció: estado en palabras, tipo, quién se había comprometido, fecha del compromiso (`dueAt`) y fecha de cierre (`closedAt`) en `var(--font-mono)`/`tabular-nums`, y `closedBy` si está. Un `enviar_info`/`pedir_presupuesto` propio cerrado como `cumplido` dice explícitamente "Le mandé la información/el presupuesto · `<fecha>`" — la frase textual que el user pidió.
- `tests/commitment-hoy.test.js` (42 tests): bloque puro `_commitmentHoyBucket` con reloj fijo (incluido el caso vencido que sigue en `'yo'`, y las 2 variantes del bucket `'prospecto'` por cumplimiento), aserciones de fuente sobre `_hoyRenderSection`/`loadHoyView`/`_hoyCommitBadge`/`_renderCallHistory`, el match literal de títulos entre `loadHoyView` y `[30-03] DISPO-DEST` (garantía anti-deriva T-31-13), cache-buster, y el anti-alcance D-12 (`_trainingSummaryLLM`/`_autoDispositionLLM` no mencionan `commitment` en su cuerpo).

## Task Commits

Each task was committed atomically:

1. **Task 1: Secciones "Mis compromisos" y "Esperando del prospecto" en Hoy (D-10)** - `6187f57` (feat)
2. **Task 2: El compromiso cerrado en el historial del lead (D-11)** - `e7e7942` (feat)
3. **Task 3: Tests de la vista de consulta y verificación final de la fase** - `ce045ae` (test)

**Plan metadata:** (este commit — docs: complete plan)

## Files Created/Modified

- `public/app.js` — `_commitmentHoyBucket` dentro de `[31-03] COMMITMENT-PURE`; `_hoyOwnerName`/`_hoyCommitBadge` nuevos; `_hoyRenderSection` con `opts.rowBadge`; `loadHoyView` con las 2 secciones nuevas, `_hoyState` extendido, `totalPend` con `Set`; `_renderCallHistory` con el 3er `kind:'commitment'`; `_callsRenderExpandedPanel` con el branching por estado almacenado (fix Rule 1) y el detalle enriquecido del cierre.
- `public/index.html` — cache-buster de `app.js` bumpeado a `v=20260815g`.
- `tests/commitment-hoy.test.js` (nuevo) — 42 tests sobre el bloque puro y aserciones de fuente.
- `.planning/STATE.md` / `.planning/ROADMAP.md` / `.planning/REQUIREMENTS.md` — Phase 31 marcada COMPLETE (4/4 planes), COMM-04 checkeado, decisiones de ejecución agregadas. Editados a mano (ver Decisions Made).

## Decisions Made

- **Cache-buster real distinto del asumido por el plan**: el plan documentaba baseline `app.js?v=20260815e` y pedía bumpear a `20260815f`. El baseline REAL con el que arrancó este plan ya era `20260815f` (documentado explícitamente por `31-03-SUMMARY.md`, sección "Next Phase Readiness"). Se bumpeó a `20260815g` en vez de reusar `20260815f`. `style.css` no se tocó (queda en `20260815f`, el valor que dejó una sesión de branding ajena a esta fase, ver `31-03-SUMMARY.md`).
- **[Rule 1] Bug encontrado extendiendo el bloque "Compromiso" de la ficha para D-11**: el branching abierto/cerrado usaba `_commitmentEffectiveEstado` (estado DERIVADO), que devuelve `'vencido'` tanto para un compromiso todavía `pendiente` cuya fecha ya pasó (sigue abierto, con botones de cierre) como para uno YA CERRADO explícitamente con "Ya no aplica" (`estado` almacenado: `'vencido'`, `closedAt` seteado). Un compromiso cerrado así quedaba mostrando la tarjeta editable para siempre, y un segundo click en cualquier botón de cierre volvía con 409 ("no había compromiso pendiente"). Fix: branchear por el estado ALMACENADO (`l.commitment.estado`) en los 2 lugares afectados — el bloque de la ficha y el chip de la cabecera (`_expChips`), que tenía el mismo bug.
- **Verificación por mutación restaurada con `git checkout --`**: al mutar temporalmente el título `'Mis compromisos'` con `sed -i` (Git Bash) para confirmar que el test anti-deriva falla, la línea mutada+restaurada quedó con terminador de línea LF en vez de CRLF (`core.autocrlf=true` del repo) — el contenido era byte-idéntico pero `git status`/`git diff --stat` marcaban el archivo como modificado. Se usó `git checkout -- public/app.js` para garantizar cero rastro (contenido y terminadores) en vez de restaurar el `sed` a mano.
- **Gestión de STATE.md/ROADMAP.md/REQUIREMENTS.md a mano, sin `gsd-sdk query`**: el patrón de corrupción de `state.advance-plan`/`roadmap.update-plan-progress` sobre el formato custom de estos 2 archivos ya está confirmado 5 veces en este milestone (24-01, 29-02, 29-03, 29-04, 31-03) — se evitó por completo, siguiendo la advertencia explícita de `<known_gotchas>` de este prompt.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Branching abierto/cerrado del bloque "Compromiso" por estado derivado en vez de almacenado**
- **Found during:** Task 2 (extendiendo el bloque para D-11)
- **Issue:** `_commitEstado === 'pendiente' || _commitEstado === 'vencido'` (y el análogo en el chip de cabecera) usaba el valor de `_commitmentEffectiveEstado`, que colapsa "pendiente-vencido" y "cerrado-explícito-vencido" en el mismo string `'vencido'`. Un compromiso cerrado con "Ya no aplica" nunca llegaba a mostrarse como cerrado — seguía con la tarjeta editable y sus 3 botones de cierre, y reintentar cerrar volvía con 409.
- **Fix:** se introdujo `_commitRaw = l.commitment.estado` (crudo) y se branchea por ese valor: `_commitRaw === 'pendiente'` → tarjeta abierta (usa `_commitEstado` solo para el estilo "vencido" DERIVADO dentro de esa rama); `_commitRaw === 'cumplido' | 'incumplido' | 'vencido'` → línea de cierre enriquecida. Mismo fix en el chip de `_expChips`.
- **Files modified:** `public/app.js`
- **Commit:** `e7e7942` (Task 2)

---

**Total deviations:** 1 auto-fixed (1 bug). Descubierto y arreglado en el mismo bloque de código que la task ya requería tocar para D-11 — sin scope creep.
**Impact on plan:** Sin el fix, D-11 (mostrar el detalle del compromiso cerrado) hubiera sido inalcanzable para el caso `estado:'vencido'` explícito, que es uno de los 2 caminos de cierre de un compromiso propio (D-04).

## Issues Encountered

- **`tests/commitment-ui.test.js` (de 31-03) dependía del comentario literal `Fase 31 (D-09): bloque "Compromiso"`** como marcador de extracción de rango — al reescribir el comentario de cabecera del bloque para documentar el fix de Rule 1, el marcador cambió y 2 tests de 31-03 empezaron a fallar (`s` de `indexOf` devolvía `-1`). Se ajustó el comentario para conservar el literal exacto intacto (agregando la mención a D-11/Rule 1 en líneas nuevas, no reemplazando la primera línea) — los 2 tests volvieron a pasar sin tocar `tests/commitment-ui.test.js`.
- **`extractFunctionBody` (helper del test nuevo) fallaba con `_hoyRenderSection`**: la primera versión buscaba el primer `{` después del literal de inicio, pero `_hoyRenderSection(..., opts = {})` tiene un `{}` vacío (default param) ANTES del `{` real que abre el cuerpo — la extracción cortaba ahí y el body quedaba truncado a una sola línea. Fix: el helper ahora exige que `startLiteral` termine en el `{` que abre el cuerpo (se usa la posición de ESE carácter, no la del primer `{` que aparezca buscando desde `startIdx`).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**Phase 31 (COMM — Compromisos como objeto) queda COMPLETA: 4/4 planes, COMM-01..04 los 4 checkeados.**

Resumen de qué cubrió cada plan:
- **31-01** (modelo): `lead.commitment`, whitelists D-02/D-03/D-04, mapa D-06, `_setCommitment`/`_closeCommitment` atados al reloj único de la Phase 29. → COMM-01, COMM-02, COMM-03.
- **31-02** (endpoints): `commitment` en `call-disposition` (D-08) + `PATCH /api/setters/leads/:id/commitment` (D-09) para cargar/cerrar fuera de una llamada.
- **31-03** (carga UI): selector de compromiso en `#call-next-modal`, bloque "Compromiso" editable en la ficha, rama de destino en `_dispoDestination`.
- **31-04** (este plan, consulta): secciones de Hoy (D-10) + compromiso cerrado en la timeline del lead (D-11). → **COMM-04**.

Suite completa del repo al cierre de la fase: **1512/1512** (1400 tras 31-01, 1424 tras 31-02, 1470 tras 31-03, 1512 tras 31-04). `tests/metrics-consistency.test.js` verde, **sin haber sido editado en ningún plan de la fase**.

**Notas sugeridas para CLAUDE.md** (a consolidar por el orquestador):
1. `lead.commitment` es el objeto del compromiso hablado, uno por lead (D-01, sin array de historial), y su reloj (`lead.nextAction`) se escribe SIEMPRE vía `_setCommitment`/`_closeCommitment` — nunca tocando `nextAction`/`callbackAt` a mano.
2. `origen:'compromiso'` en `nextAction` significa "este reloj lo puso un compromiso" y es lo único que `_closeCommitment` tiene permitido apagar.
3. Los títulos `Mis compromisos` / `Esperando del prospecto` están duplicados a propósito entre `loadHoyView` y `_dispoDestination` (el bloque `[30-03] DISPO-DEST` se evalúa aislado en tests con `new Function`) — hay un test (`tests/commitment-hoy.test.js`) que ata ambos y falla si divergen.
4. Limitación aceptada de D-01: un compromiso por lead — el nuevo reemplaza al anterior, esté pendiente o cerrado. El historial visible (timeline + ficha) es siempre el del ÚLTIMO compromiso.
5. **[Rule 1, nuevo]**: al leer/mostrar `lead.commitment`, distinguir SIEMPRE "abierto" de "cerrado" por el campo `estado` ALMACENADO (`=== 'pendiente'`), nunca por el valor de `_commitmentEffectiveEstado`/`_commitmentHoyBucket` — esas funciones derivan `'vencido'` para dos situaciones de negocio distintas (pendiente-vencido vs. cerrado-explícito), y confundirlas deja la UI mostrando un compromiso cerrado como si siguiera editable.

**Checklist de verificación en vivo pendiente** (no hay browser en el entorno):
1. Abrir Hoy con un lead que tenga un compromiso propio (`parte:'yo'`) pendiente y otro con un compromiso del prospecto (`parte:'prospecto'`) pendiente — confirmar que aparecen en ese orden, arriba de Callbacks e Interesados, con el badge de tipo+fecha en cada fila.
2. Dejar vencer un compromiso propio (fecha pasada, sin cerrarlo) y confirmar que sigue apareciendo en "Mis compromisos" con el badge en color `var(--warning)` y el texto "vencido".
3. Desde la ficha, marcar "Cumplido" sobre un compromiso `enviar_info`/`pedir_presupuesto` propio y confirmar que el lead pasa a aparecer en "Esperando del prospecto" con el badge "info mandada · `<fecha>`".
4. Cerrar un compromiso con "Ya no aplica" (`vencido` explícito) y confirmar que la ficha muestra la línea de cierre enriquecida (no la tarjeta editable) — este es el caso que atrapó el bug de Rule 1.
5. Abrir el panel de una llamada activa sobre un lead con un compromiso ya cerrado y confirmar que aparece como evento en "Histórico de llamadas" (`_renderCallHistory`), mezclado cronológicamente con llamadas y notas.
6. Confirmar que el aviso de destino tras marcar Interesado con un compromiso cargado sigue diciendo "Hoy → Mis compromisos"/"Hoy → Esperando del prospecto" (regresión de 31-03, no debería haber cambiado).
7. Verificar visualmente el contraste de los badges nuevos (`_hoyCommitBadge`) contra el fondo de la fila de Hoy en los 3 estados: pendiente, vencido, "info mandada".

Sin bloqueantes de código para **Phase 32 (ACT — Acciones desde cualquier vista)**, que depende de las Phases 29 y 31, ambas cerradas.

---
*Phase: 31-comm-compromisos*
*Completed: 2026-08-15*

## Self-Check: PASSED

- FOUND: `public/app.js`
- FOUND: `public/index.html`
- FOUND: `tests/commitment-hoy.test.js`
- FOUND: `.planning/phases/31-comm-compromisos/31-04-SUMMARY.md`
- FOUND commit `6187f57` (Task 1)
- FOUND commit `e7e7942` (Task 2)
- FOUND commit `ce045ae` (Task 3)

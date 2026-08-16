---
phase: 33-dial-motor-unico
plan: 02
subsystem: ui
tags: [power-dialer, frontend, vanilla-js, testing]

# Dependency graph
requires:
  - phase: 33-dial-motor-unico (plan 01)
    provides: "window._pdDialHere / opts.startAtLeadId / _pd.forced — el punto de entrada puntual sobre el que este plan generaliza el hold"
  - phase: 30-gate-proximo-paso (plan 03)
    provides: "_dispoDestination(lead, now) puro + _dispoAnnounce/_dispoAfterSaved como punto único post-guardado — este plan escribe la señal ahí"
provides:
  - "function _pdHold(leadId, outcome, opts = {}) — único camino al banner 'Resultado guardado', interno (no expuesto en window)"
  - "_pd.pendingSave ({leadId, outcome, at}) — señal determinística de guardado, escrita por _dispoAfterSaved, consumida por window._pdHandleDisposition"
  - "window._pdHandleDisposition sin la heurística stillActionable — universal en las 4 colas del dialer y en los outcomes con modal"
  - "_autoMarkNoAnswer ruteado por _pdHold en vez de replicar el hold a mano"
affects: [33-03, 33-04, 34]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Señal determinística escrita en el único punto post-guardado (_dispoAfterSaved) en vez de re-derivar estado del lead para adivinar si una operación async terminó — patrón reusable para cualquier flujo futuro que necesite saber 'esto se confirmó de verdad'"
    - "Polling con deadline por Date.now() en vez de contador de iteraciones — evita off-by-one y es más legible que 'N vueltas de 200ms'"

key-files:
  created:
    - tests/dial-hold.test.js
  modified:
    - public/app.js
    - public/index.html

key-decisions:
  - "_pdHold no se expone en window (interna del bloque del dialer) — a diferencia de _pdAdvance/_pdBack/_pdExit que sí lo están porque los llaman botones onclick inline. _pdHold solo se llama desde código JS del mismo módulo (_pdHandleDisposition, _autoMarkNoAnswer)."
  - "_dispoAfterSaved NUNCA llama a _pdHold directamente — corre en el momento del guardado, que puede ser con un modal todavía abierto. Avanzar ahí (autopiloto) dejaría el modal huérfano sobre la tarjeta siguiente. Quien sabe cuándo el flujo terminó de verdad (modal cerrado) es _pdHandleDisposition, y es quien consume la señal."
  - "La rama de outcomes directos pasó de un setTimeout ciego de 600ms a un polling con deadline de 6s — _handleCallDisposition ya está awaited para cuando se llega a esta rama, así que en el caso normal la señal ya está disponible en el primer chequeo; el polling es defensa ante asincronía futura, no necesidad actual medida."
  - "2 acceptance criteria del plan resultaban desactualizados al cerrar la Task 2 (ver Deviations) — se resolvieron verificando la intención real en vez de el número literal escrito en el plan, documentado explícitamente en vez de forzar el código para que un grep coincida con un criterio que el propio plan reconocía transitorio."

patterns-established:
  - "Cualquier función que necesite saber 'esta operación async terminó de guardar' debe consumir una señal escrita en el punto único post-guardado (_dispoAfterSaved), nunca re-derivar el estado del lead para adivinarlo — la heurística stillActionable que este plan elimina es el ejemplo canónico de por qué esa re-derivación falla."

requirements-completed: [DIAL-02]

# Metrics
duration: ~35min
completed: 2026-08-16
---

# Phase 33 Plan 2: Hold universal del Power Dialer Summary

**`_pdHold(leadId, outcome, opts)` es ahora el único camino al banner "✓ Resultado guardado" — universal en las 4 colas del dialer (Llamadas + 3 variantes de Hoy) y en los 4 outcomes que abren modal, gobernado por `_pd.pendingSave`, una señal determinística en vez de la heurística `stillActionable` que re-derivaba el estado del lead para adivinar si se había guardado.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-08-16
- **Tasks:** 3/3
- **Files modified:** 3 (`public/app.js`, `public/index.html`, `tests/dial-hold.test.js` nuevo)

## Accomplishments

- `_pd.pendingSave` ({leadId, outcome, at}): señal escrita por `_dispoAfterSaved` cuando el dialer está activo, en el ÚNICO punto post-guardado que ya usan los 7 caminos de disposición (Phase 30). Reemplaza la re-derivación heurística del estado del lead.
- `_pdHold(leadId, outcome, opts)`: único camino al hold. Guard de tarjeta actual (`!_pd.active || _pd.queue[_pd.currentIdx] !== leadId`), D-05 (autopiloto avanza solo), completa `holdMeta` con `_dispoDestination` cuando está vacío (cubre los caminos que avisaron con `forceToast`).
- `window._pdHandleDisposition` reescrito: limpia `pendingSave` al entrar (antes del `await`, así lo que quede después es de ESTE flujo — T-33-05), consume la señal validando `leadId` y `at`. Rama directa (sin modal) con polling acotado 200ms/techo 6s en vez del `setTimeout` ciego de 600ms (T-33-06). Rama con modal conserva la espera a que cierren los 4 modales y solo holdea si hay señal confirmada — cancelar no toca nada.
- `_autoMarkNoAnswer` ya rutea por `_pdHold` en vez de replicar el hold a mano (2 copias → 1).
- **D-04 verificado leyendo el código, no asumido**: ni `_pdHold` ni el guard de expulsión de `_pdRender` miraban `_pd.mode`/`_pd.hoyFilter` — la premisa histórica del plan ("hoy funciona solo en el dialer de Llamadas") ya no describía el código real; documentado en comentario para que quede asentado con evidencia.
- `_actDiscard` (32-04) sin cambios de comportamiento — solo un comentario que apunta a la decisión de no holdear (un descarte no es una disposición de llamada).

## Task Commits

Each task was committed atomically:

1. **Task 1: `_pdHold` como único camino + `_pd.pendingSave` como señal determinística** - `bc267a1` (feat)
2. **Task 2: `_pdHandleDisposition` universal — modales y las 3 colas de Hoy** - `6993af9` (feat)
3. **Task 3: Suite de DIAL-02 + cache-buster** - `b635317` (test)

## Files Created/Modified

- `public/app.js` — `_pd.pendingSave` en la declaración de estado; `function _pdHold(leadId, outcome, opts={})` (interna, no en `window`) declarada inmediatamente después de `_pdAdvance`; `_dispoAfterSaved` escribe `pendingSave` al principio (sin llamar `_pdHold`); resets de `pendingSave = null` en `_pdStart`/`_pdAdvance`/`_pdBack`; `_autoMarkNoAnswer` ruteado por `_pdHold`; `window._pdHandleDisposition` reescrito (captura `_startedAt`, `_consumeSaved`, polling de la rama directa, consumo en la rama con modal, `stillActionable` eliminada); comentario D-04 en el guard de expulsión de `_pdRender`; comentario de la decisión de `_actDiscard`.
- `public/index.html` — cache-buster de `app.js` bumpeado `20260816a` → `20260816b` (`style.css` NO tocado por este plan).
- `tests/dial-hold.test.js` (nuevo) — 30 tests: un solo hold, D-05 autopiloto, guard de tarjeta actual, D-04 sin branching por modo, ciclo de vida de `pendingSave` (escritura/limpieza/consumo validado), heurística eliminada, los 4 modales siguen esperados, cancelar no holdea, techo del polling (T-33-06), banner D-06, anti-regresión 32-04, cache-buster por forma/monotonía.

## Decisions Made

Ver `key-decisions` en el frontmatter. Adicionalmente:

- El polling de la rama directa usa un `_deadline = Date.now() + 6000` en vez de contar iteraciones — evita off-by-one entre "30 vueltas de 200ms" (como dice el threat model) y el techo real, y es más legible.
- `_pdHold` valida la tarjeta actual como la PRIMERA línea del cuerpo (antes de cualquier otra cosa), verificado con un test dedicado que lee la primera línea real del cuerpo de la función.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug evitado antes de commitear] Comentarios que mencionaban `stillActionable` literal rompían el acceptance criterion "0 ocurrencias"**
- **Found during:** Task 2 (verify, `grep -c "stillActionable" public/app.js`)
- **Issue:** Al documentar por qué se eliminó la heurística, los comentarios nuevos (en Task 1 y Task 2) usaban el nombre literal `stillActionable` para dar contexto — igual que el bug ya conocido de 30-03 con `_dispoWhereToast`. El acceptance criterion pide 0 ocurrencias literales, sin distinguir código de comentarios.
- **Fix:** Reescritos los 2 comentarios para describir la heurística vieja sin usar el identificador literal ("la heurística vieja de acá adentro", "la heurística que este plan elimina").
- **Files modified:** `public/app.js`
- **Verification:** `grep -c "stillActionable" public/app.js` → 0.
- **Committed in:** `6993af9` (Task 2 commit, incluyó el fix retroactivo del comentario de Task 1)

---

**Total deviations:** 1 auto-fixed (Rule 1 — mismo patrón de bug ya documentado en 30-03, atrapado por la propia corrida de verificación antes de commitear).
**Impact on plan:** Sin scope creep. El fix es puramente de redacción de comentarios, no cambia ningún comportamiento.

## Issues Encountered

**Dos acceptance criteria de la Task 1 quedaron descriptos para un estado transitorio del código (documentado como nota de verificación de plan, no como bug de mi implementación):**

1. **`grep -c "_pd.holdCurrent = true" public/app.js` devuelve `1`** — este criterio está en la lista de la Task 1, pero el propio `<done>` de esa misma task dice explícitamente: *"Los caminos con modal siguen usando la heurística vieja hasta la Task 2"* — es decir, al cerrar la Task 1, `_pdHandleDisposition` TODAVÍA tenía su propia copia de `_pd.holdCurrent = true` (heredada, sin tocar hasta la Task 2), así que el conteo real al cerrar Task 1 era 2, no 1. El criterio solo se vuelve verdadero después de que la Task 2 elimina esa copia — verificado que dio `1` al cerrar la Task 2 (el estado final del plan cumple lo que el criterio pedía, solo que el momento de verificación indicado en el plan era prematuro).

2. **`grep -c "_pd.pendingSave = null" public/app.js` devuelve `3`** — este era el conteo correcto al cerrar la Task 1 (los 3 resets de estado: `_pdStart`/`_pdAdvance`/`_pdBack`). La Task 2 agrega, LEGÍTIMAMENTE, 2 ocurrencias más del mismo literal dentro de `window._pdHandleDisposition`: la limpieza al entrar (`_pd.pendingSave = null;` antes del `await`) y el reset dentro de `_consumeSaved` al consumir exitosamente. Son parte explícita de la `<action>` de la Task 2 (paso 2: *"limpiar `_pd.pendingSave = null` ANTES de disparar el guardado"*; paso 2 de `_consumeSaved`: *"`_pd.pendingSave = null; return ps;`"*) — no un error mío, sino una consecuencia necesaria del propio diseño que el plan pide. El total real tras la Task 2 es 5, no 3. La suite `tests/dial-hold.test.js` verifica los 5 con desglose explícito (3 resets de estado del dialer + 2 del ciclo de vida propio de `pendingSave` dentro de `_pdHandleDisposition`), en vez de pinear un número que el propio plan reconoce transitorio.

Ninguno de los dos bloqueó la ejecución — se resolvieron verificando la intención real detrás del criterio (que SÍ se cumple al final del plan completo) en vez de forzar el código para que un grep global coincidiera con un número escrito para un punto intermedio de la implementación.

**Sesión paralela editando `public/style.css` durante la ejecución de este plan**: al llegar a la Task 3 apareció un diff no cometido en `public/style.css` (ajuste de contraste de `--text-tertiary`/`--text-faint`, con comentario fechado "CORRECCIÓN 2026-08-16") que yo no introduje. Confirmado con `git diff` que no forma parte de ningún cambio de este plan. Se dejó el archivo SIN stagear ni commitear en los 3 commits de esta ejecución, tal como pide CLAUDE.md nota #13 (zonas de trabajo en paralelo). El `git diff --stat public/style.css` vacío pedido por el plan aplica a MIS cambios — no controlo ediciones de otra sesión corriendo en simultáneo sobre el mismo working tree.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `_pdHold` y `_pd.pendingSave` quedan disponibles como superficie estable para 33-03 (sincronización de vistas) y 33-04 (ficha con historial al frente), que según `ROADMAP.md`/`STATE.md` siguen construyendo sobre el Power Dialer como motor único.
- **Sin verificar en vivo** (no hay browser en el entorno, según pide el `<output>` del plan):
  - Colgar una llamada real dentro del Power Dialer de Hoy (cualquiera de sus 3 variantes) y confirmar que la grilla de resultado se queda visible con el banner correcto tras marcar.
  - El timing real del polling de la rama directa (200ms/6s) contra un backend lento de verdad — verificado solo por lectura de código y por el mecanismo de deadline, no contra latencia real medida.
  - Que el banner muestre el texto de destino correcto para cada uno de los 8+ ramas de `_dispoDestination` cuando se llega ahí vía `_pdHold` completando `holdMeta` (el camino `forceToast` → `holdMeta` vacío → `_pdHold` lo completa) — la lógica está verificada por aserción de fuente y por los 27 tests preexistentes de `gate-destination.test.js`, pero no se vio pintado en un browser real.

---
*Phase: 33-dial-motor-unico*
*Completed: 2026-08-16*

## Self-Check: PASSED

- FOUND: `tests/dial-hold.test.js`
- FOUND: `public/app.js`
- FOUND: `public/index.html`
- FOUND commit: `bc267a1` (Task 1)
- FOUND commit: `6993af9` (Task 2)
- FOUND commit: `b635317` (Task 3)
- `npx vitest run tests/dial-hold.test.js tests/dial-start-at.test.js tests/gate-destination.test.js tests/act-ui-discard-material.test.js` → 126/126 verdes
- Verificación por mutación (`ps.leadId !== leadId` roto en `_consumeSaved`): 1/30 tests en rojo, restaurado con `git checkout -- public/app.js`, diff vacío confirmado.
- `npm test` completo (2 corridas): 1695-1718/1718 según contención de recursos bajo carga total (mismo patrón conocido de 32-04); los archivos afectados pasaron 100% aislados en ambas corridas.

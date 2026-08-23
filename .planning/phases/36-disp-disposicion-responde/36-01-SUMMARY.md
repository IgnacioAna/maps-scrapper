---
phase: 36-disp-disposicion-responde
plan: 01
subsystem: ui
tags: [frontend, power-dialer, disposicion, feedback-visual, css]

# Dependency graph
requires:
  - phase: 33-dial-motor-unico
    provides: "_pdHold / _pdKeyOutcomes / grid del Power Dialer (D-01/D-02, no se tocan)"
  - phase: 30-gate-proximo-paso
    provides: "_dispoAfterSaved como punto único post-guardado"
provides:
  - "_dispoBusyOn/_dispoBusyOff: fuente única del estado 'guardando' de una disposición"
  - "data-outcome en los 9 botones del grid del Power Dialer"
  - "CSS .is-busy/.is-saving del grid y del select de disposición + @keyframes dispoSavingPulse"
  - "tests/dispo-feedback.test.js: 26 tests de cableado, comportamiento y guardas D-01/D-02"
affects: [36-02-tiempos-disposicion, 36-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Acuse inmediato de UI: prender el feedback ANTES del primer await, apagar en finales explícitos + techo de seguridad (mismo molde que _dispoGateSet/_dispoGateClear)"
    - "Detección de nodo DOM real por CAPACIDAD (typeof x.querySelector === 'function'), nunca por instanceof -- el Power Dialer manda objetos falso {value, disabled}"

key-files:
  created:
    - tests/dispo-feedback.test.js
  modified:
    - public/app.js
    - public/style.css
    - public/index.html

key-decisions:
  - "El techo de seguridad de 15s vive DENTRO de _dispoBusyOn (no en el caller): ningún camino sano debería llegar ahí, es red de seguridad, no temporizador de uso normal."
  - "state.selectEl se marca SIEMPRE que se detecta un select-like real, no solo cuando options[0] existe -- así _dispoBusyOff nunca deja la clase is-saving pegada en el caso patológico de un select sin placeholder (fix aplicado en un commit separado del de Task 1, encontrado al preparar los stubs de test)."

requirements-completed: [RESP-01]

# Metrics
duration: ~20min
completed: 2026-08-23
---

# Phase 36 Plan 01: Acuse inmediato al marcar disposición (RESP-01) Summary

**`_dispoBusyOn`/`_dispoBusyOff` pintan "Guardando…" en el grid del Power Dialer y en el select de Llamadas/Hoy en el mismo frame del clic, con 3 apagados legítimos (guardado, error, modal) + techo de 15s, cableados en `window._handleCallDisposition`/`_dispoAfterSaved` sin tocar hold/autopiloto/atajos/orden del grid.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-08-23T07:05:14Z
- **Completed:** 2026-08-23T07:17:49Z
- **Tasks:** 2 completadas (+ 1 commit de fix intermedio dentro de la Task 1)
- **Files modified:** 4 (3 de código + 1 test nuevo)

## Accomplishments
- Marcar cualquiera de los 9 resultados del Power Dialer, o elegir un resultado en el `<select>` de la lista de Llamadas / de una tarjeta de Hoy, deja el control diciendo "Guardando…" desde el instante del clic — antes de la espera de hasta 4,75s de `_finalizeActiveCallBeforeDisposition` y antes del polling del Power Dialer.
- El indicador se apaga en exactamente 3 finales legítimos (guardado vía `_dispoAfterSaved`, error vía el `catch`, apertura de modal vía `_DISPO_MODAL_OUTCOMES`) más un techo de 15s que lo libera solo si ninguno de los 3 ocurrió — verificado por comportamiento (con timers stub, sin esperar 15s reales) y por mutación (ver abajo).
- `_pdHold`, el autopiloto, los atajos 1-9 y el orden del grid quedan intactos (D-01/D-02): los 7 suites que pinean literales de ese tramo pasan sin editarlos.

## Task Commits

Cada task se commiteó atómicamente:

1. **Task 1: `_dispoBusyOn`/`_dispoBusyOff` + cableado en los 4 puntos + CSS del estado** - `7f8cb37` (feat)
   - **Fix intermedio** (encontrado al preparar los stubs de la Task 2, mismo bloque de código): `7f03212` (fix)
2. **Task 2: Suite RESP-01 (`tests/dispo-feedback.test.js`)** - `5b46cf4` (test)

## Files Created/Modified
- `public/app.js` — bloque `[36-01] RESP-01`: `const _DISPO_MODAL_OUTCOMES`, `let _dispoBusy`, `function _dispoBusyOn`, `function _dispoBusyOff` (declarados entre `_dispoGateClear` y `_dispoAfterSaved`); cableado en `window._handleCallDisposition` (prender antes del `try`, apagar tras el `await` si el outcome abre modal, apagar en el `catch`); una línea en `_dispoAfterSaved` (apaga primero); `data-outcome="${d.v}"` en el template de los 9 botones del grid.
- `public/style.css` — bloque `[36-01] RESP-01` al final de `.pd-disp-*`: `.pd-disposition-grid.is-busy .pd-disp-btn` (apagado), la excepción `.is-saving` (opacidad plena + acento), `select.is-saving:disabled` (especificidad 0,2,1, sin `!important`) y `@keyframes dispoSavingPulse`.
- `public/index.html` — cache-buster `app.js` `20260822b`→`20260822c` y `style.css` `20260816f`→`20260822a`.
- `tests/dispo-feedback.test.js` (nuevo) — 26 tests: fuente/cableado, comportamiento (evaluando las funciones reales con `new Function`), guardas D-01/D-02, cache-buster.

## Decisions Made
- El techo de 15s se implementó con `setTimeout`/`clearTimeout` inyectados como parámetros en el factory de test (en vez de mockear timers globales de vitest), porque el plan pedía explícitamente inyección por parámetro y así el comportamiento del techo se pudo probar sin depender de temporizadores reales de 15s ni de fake timers de vitest.
- `state.selectEl` se setea siempre que se detecta capacidad de select real, no condicionado a que `options[0]` exista — evita que `is-saving` quede pegado en un caso patológico (select sin placeholder) que no debería ocurrir en producción pero que hacía la restauración incompleta. Documentado como commit separado (`7f03212`) porque toca el mismo bloque de la Task 1 pero se descubrió mientras se preparaban los stubs de la Task 2.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `state.selectEl` no se marcaba si `options[0]` no existía**
- **Found during:** preparación de los stubs de comportamiento de la Task 2 (antes de escribir el test, al re-leer el código escrito en la Task 1)
- **Issue:** en `_dispoBusyOn`, la línea `state.selectEl = selectEl;` estaba dentro del `if (opt0) { ... }`, así que si un select real no tuviera `options[0]` (caso patológico, no debería pasar en producción — el placeholder `— Resultado —` siempre está), `selectEl.classList.add('is-saving')` se ejecutaba pero `_dispoBusyOff` nunca podría sacar esa clase (guardada por `if (st.selectEl)`).
- **Fix:** `state.selectEl = selectEl;` se movió arriba, fuera del `if (opt0)`, para que la restauración de clases siempre sea posible cuando se detectó un select real.
- **Files modified:** `public/app.js`
- **Verification:** `node --check public/app.js` OK + los 26 tests de `dispo-feedback.test.js` (que ejercitan `_dispoBusyOff` tras `_dispoBusyOn` con selects reales) pasan.
- **Committed in:** `7f03212`

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug menor, caso patológico no alcanzable en producción con el markup actual)
**Impact on plan:** Ninguno funcional visible; robustece la restauración ante un caso extremo. No cambia ningún comportamiento observado en los tests del plan.

## Issues Encountered

Los saltos de línea de `public/app.js`/`public/index.html` en disco son **CRLF** (`\r\n`), no LF. Los primeros dos intentos de mutación (Bash `verification` del plan) fallaron con `NOT FOUND` porque el literal de reemplazo usaba `\n`. Ajustado a `\r\n` y confirmado con `JSON.stringify` del slice real antes de reintentar — resuelto sin tocar código de producción (fue un problema del script de verificación, no del código).

## Verificación por mutación (paso 5 y 6 de `<verification>`)

Ambas mutaciones se aplicaron con un script de Node (no con edits manuales, para evitar tocar accidentalmente otra cosa), se corrió `tests/dispo-feedback.test.js`, y se restauró con `git checkout -- public/app.js` verificando `git status --short public/app.js` vacío antes de continuar.

1. **Mover `_dispoBusyOn(leadId, outcome, selectEl);` abajo del `await _finalizeActiveCallBeforeDisposition(leadId);`:**
   `AssertionError: expected 582 to be less than 521` en exactamente el test *"el índice de `_dispoBusyOn(` es menor que el del `await`..."* — 25/26 tests siguieron verdes, ningún otro test se movió. Restaurado, diff vacío confirmado.
2. **Borrar `_dispoBusyOff(leadId);` de `_dispoAfterSaved`:**
   Falla exactamente el test *"la primera acción útil del cuerpo apaga `_dispoBusyOff(leadId)`"* — 25/26 verdes. Restaurado, diff vacío confirmado.

## Verificación de suites (paso 3 y 4 de `<verification>`)

- **Baseline REAL leído en disco antes de empezar (sin ningún edit):** `npx vitest run` → **117 archivos / 2054 tests, todos verdes** (confirmado con una corrida completa antes de tocar ningún archivo — coincide con el número que trae el prompt del executor).
- **Los 7 suites que pinean literales de este tramo, corridos SIN editarlos:** `tests/dial-hold.test.js tests/gate-destination.test.js tests/gate-next-step-ui.test.js tests/call-stage-surfaces.test.js tests/dial-sync.test.js tests/commitment-ui.test.js tests/act-ui-discard-material.test.js` → **7 archivos / 214 tests, todos verdes**. `git diff --stat tests/` antes de tocar `tests/dispo-feedback.test.js` estaba vacío (0 ediciones a suites ajenas).
- **Suite nueva sola:** `npx vitest run tests/dispo-feedback.test.js` → **26/26 verdes** (mínimo pedido: 14).
- **`npm test` completo, corrido 2 veces tras cerrar la Task 2 (una antes de commitear el test, otra después del commit):** **118 archivos / 2080 tests, todos verdes** las dos veces. Delta contra el baseline: **+1 archivo, +26 tests, 0 fallos nuevos, 0 regresiones.**
- `git diff --stat package.json package-lock.json` → vacío (no se instaló nada).

## Nota sobre los `grep -c` literales de los `acceptance_criteria` del plan

El plan especifica varios `grep -c` puntuales como criterio de aceptación. Verificados contra el código final, con el resultado real (no se ajustó el código para forzar estos números — se prefirió código correcto y legible; la garantía funcional real la dan los tests, no estos greps):

| Criterio del plan | Esperado | Real | Motivo de la diferencia |
|---|---|---|---|
| `grep -c "function _dispoBusyOn" public/app.js` | 1 | 1 | OK |
| `grep -c "function _dispoBusyOff" public/app.js` | 1 | 1 | OK |
| `grep -c "_dispoBusyOn(leadId, outcome, selectEl)" public/app.js` | 1 | 2 | La declaración `function _dispoBusyOn(leadId, outcome, selectEl) {` **contiene como substring literal** `_dispoBusyOn(leadId, outcome, selectEl)` — el grep matchea tanto la declaración como el único call site real. No hay forma de escribir la firma de la función tal como la pide `<interfaces>` sin que esto ocurra. |
| `grep -c "_dispoBusyOff(leadId)" public/app.js` | 3 | 5 | Mismo fenómeno: la declaración `function _dispoBusyOff(leadId) {` matchea, y el `setTimeout(() => _dispoBusyOff(leadId), 15000)` de adentro de `_dispoBusyOn` **también** contiene el literal `_dispoBusyOff(leadId)` (el plan asumía que no matchearía, pero sí matchea con o sin paréntesis de flecha alrededor). Total real: declaración + setTimeout + 3 call sites (modal, `_dispoAfterSaved`, catch) = 5. El `_dispoBusyOff()` sin argumento de adentro de `_dispoBusyOn` correctamente NO matchea (confirmado). |
| `grep -c "data-outcome=" public/app.js` | 1 | 2 | La segunda aparición es el propio `querySelector('...[data-outcome="' + outcome + '"]')` dentro de `_dispoBusyOn` — necesario para encontrar el botón clickeado, y contiene el mismo literal `data-outcome=`. |
| `grep -c "\.pd-disposition-grid.is-busy" public/style.css` | `>= 2` | 4 | OK (cumple el `>=`). |
| Orden `_dispoBusyOn(` < `await _finalizeActiveCallBeforeDisposition(leadId);` | sí | sí | Confirmado con Node (índices 324 < 571) y con el test dedicado + verificación por mutación. |
| 7 suites pineadas pasan sin editar | sí | sí | Confirmado arriba. |
| `git diff --stat package.json package-lock.json` vacío | sí | sí | Confirmado. |

Estas diferencias son de **conteo de substrings solapados**, no de cableado incorrecto: la funcionalidad real (dónde se prende, dónde se apaga, en qué orden) está cubierta por los tests de fuente + comportamiento + las 2 verificaciones por mutación, que sí pasaron con el resultado esperado exacto.

## Qué queda SIN verificar en vivo

No hay browser en el entorno de ejecución de este plan (solo Node + vitest). Queda pendiente de una pasada por preview/producción:
- Que el pulso del `@keyframes dispoSavingPulse` se lea bien sobre el fondo real del dialer (contraste, velocidad visual).
- Que forzar `selectEl.selectedIndex = 0` en el select de la lista/Hoy no produzca un "salto" visual molesto (el placeholder ya está en `options[0]`, así que en teoría no debería reflow, pero no se pudo confirmar sin DOM real).
- Que el botón del grid, al recibir `is-saving`, se vea claramente distinto del resto (`opacity` plena + `border-color`/`background` de acento) contra los 9 botones apagados al 0.4 de opacidad alrededor.

## Nota para el orquestador (heredada del plan, no de este executor)

El plan advertía: "los IDs RESP-01/02/03 de la Phase 36 colisionan con los RESP-01/02/03 de la Phase 20". **Verificado contra `.planning/REQUIREMENTS.md` al cerrar este plan: no hay tal colisión.** La Phase 20 usa `DISP-01/02/03` (sección "DISP — Disposición obligatoria", línea ~102), no `RESP-*`. `.planning/REQUIREMENTS.md` línea 378 ya documenta el rename explícito: *"Renombrados de DISP a RESP el 2026-08-21: los IDs DISP-01/02/03 ya estaban tomados por la Phase 20"* — es decir, el rename de la Phase 36 (de DISP a RESP) se hizo justamente para evitar esa colisión, y quedó resuelto. No se necesita ninguna acción adicional del orquestador sobre esto; se deja la nota original del plan tachada acá para que quien lea este SUMMARY no repita la misma alarma sin volver a chequear.

## User Setup Required

None — no requiere configuración externa. Los cambios son 100% frontend estático, servidos por el mismo Express existente.

## Next Phase Readiness

- RESP-01 queda protegido por `tests/dispo-feedback.test.js`, incluyendo un test de orden que se pone rojo si una fase futura mueve el acuse abajo del `await` crítico — 36-02 (que sí toca los tiempos de `_finalizeActiveCallBeforeDisposition`) puede apoyarse en esta red sin miedo a romper el acuse silenciosamente.
- `_dispoBusyOn`/`_dispoBusyOff` quedan disponibles como fuente única para cualquier feedback futuro de "guardando" en el flujo de disposición — no crear una quinta copia.
- Pendiente (no bloqueante): una pasada visual en preview/producción de los 3 ítems listados arriba.

---
*Phase: 36-disp-disposicion-responde*
*Completed: 2026-08-23*

## Self-Check: PASSED

- FOUND: `tests/dispo-feedback.test.js`
- FOUND: `public/app.js`
- FOUND: `.planning/phases/36-disp-disposicion-responde/36-01-SUMMARY.md`
- FOUND commit `7f8cb37` (Task 1: feat)
- FOUND commit `7f03212` (fix intermedio de la Task 1)
- FOUND commit `5b46cf4` (Task 2: test)

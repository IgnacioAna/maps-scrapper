---
phase: 36-disp-disposicion-responde
plan: 03
subsystem: ui
tags: [frontend, telnyx, dtmf, ivr, power-dialer]

# Dependency graph
requires:
  - phase: 36-02
    provides: "El panel de llamada ya se abre en 'Conectando…' sin esperas; este plan no depende de ningún dato de esa metadata, solo de que el panel exista en pantalla en el mismo punto (_tlxApplyPos('call'))."
provides:
  - "_dtmfPadPrefOpen() / _applyDtmfPadPref(open) / _setDtmfPadPref(open): preferencia por navegador del pad DTMF, mismo idioma !== '0' que scm_audio_micChain"
  - "El pad #telnyx-dtmf-pad arranca ABIERTO por defecto y recuerda el último estado que el SDR le dejó, reaplicado en cada apertura del panel (se reusa entre llamadas)"
  - "tests/dtmf-pad-pref.test.js: 25 tests de RESP-03, con verificación por mutación del default"
affects: [37-ses-sesion-discado, cualquier plan futuro que toque el panel de llamada compartido (#telnyx-call-panel) o el footer fijo donde vive el pad]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Preferencia 'prendida salvo que la apaguen' por navegador (localStorage, sin userId) — mismo idioma que _audioCfg.micChainEnabled() (scm_audio_micChain, !== '0'). Tercer uso de este patrón en el repo tras el autopiloto (pd_autopilot_<userId>, con userId) y el nivelador de mic."
    - "Reaplicar un estado de UI en cada apertura de un panel reusado entre sesiones, en vez de solo al arrancar el módulo — el style inline queda pegado al último uso del panel anterior."

key-files:
  created:
    - tests/dtmf-pad-pref.test.js
  modified:
    - public/app.js
    - public/index.html
    - tests/script-attribution-core.test.js

key-decisions:
  - "El pad arranca ABIERTO por defecto (no 'cerrado, recuerda si lo abrieron'): el criterio del ROADMAP admitía cualquiera de las dos variantes ('arranca visible o recuerda el último estado'), y acá se hacen las dos — visible desde la llamada 1, y quien no lo quiere lo cierra una vez y no lo ve más."
  - "public/index.html NO cambia el markup del pad (sigue naciendo con display:none): es el JS el que lo abre al arrancar la llamada. Así, si _applyDtmfPadPref fallara por algún motivo, el estado inicial del DOM sigue siendo el de hoy — nunca queda un pad suelto en un panel a medio armar."
  - "La preferencia se reaplica en _startTelnyxCall, no solo al bootear el módulo: el panel #telnyx-call-panel es el mismo <div> reusado en cada llamada, y su style.display inline queda pegado al último toggle. Sin este paso, cerrar el pad en la llamada 1 lo dejaría cerrado (bien) pero abrirlo de nuevo en la llamada 2 no se reflejaría hasta el próximo F5 (mal)."

requirements-completed: [RESP-03]

# Metrics
duration: ~10m (medido por spread de los 2 commits de tareas, 12:52:01 -> 12:57:35 -03:00; el trabajo de lectura de contexto previo no se cronometra aparte)
completed: 2026-08-23
---

# Phase 36 Plan 03: El teclado DTMF arranca visible y recuerda (RESP-03) Summary

**El pad `#telnyx-dtmf-pad` pasó de nacer siempre cerrado detrás de un toggle volátil (`pad.style.display = pad.style.display === 'grid' ? 'none' : 'grid'`, sin persistencia) a arrancar ABIERTO por defecto y recordar el último estado que el SDR le dejó, por navegador (`scm_dtmf_pad`, mismo idioma `!== '0'` que las demás preferencias de audio del repo) — reaplicado en cada apertura del panel de llamada porque el panel se reusa entre llamadas y el estilo inline queda pegado al uso anterior. Las 12 teclas y el envío de tonos al `_telnyx.activeCall` no se tocaron.**

## Performance

- **Duration:** ~10m medido por el spread de los 2 commits de tareas (`0a92bfe` 12:52:01Z → `c267b00` 12:57:35Z, hora local -03:00). No incluye el tiempo de lectura del CONTEXT.md/36-02-SUMMARY.md/PROJECT.md/STATE.md previos a empezar a editar.
- **Started:** 2026-08-23 (justo después de leer el cierre de 36-02, commit `aae31b2`)
- **Completed:** 2026-08-23
- **Tasks:** 2 completadas
- **Files modified:** 4 (2 de código/markup + 1 test nuevo + 1 test ajeno con deviation)

## Accomplishments

- El pad DTMF se ve apenas se abre el panel de llamada, sin ningún clic — que es exactamente cuando una central que tira el menú a los pocos segundos lo necesita.
- Si el SDR lo cierra una vez, se queda cerrado en las llamadas siguientes de ese navegador; si lo vuelve a abrir, se queda abierto. Sobrevive un F5 (persiste en `localStorage`, no depende de que el panel esté abierto para leerse).
- El toggle dejó de ser un flip volátil del `style.display` inline y pasó a tener una única fuente de verdad (`_setDtmfPadPref`), así el botón nunca puede desincronizarse de lo que se va a recordar.
- Las 12 teclas siguen mandando el tono a la llamada activa exactamente igual (`_telnyx.activeCall.dtmf(k)`, misma guarda `if (!k || !_telnyx.activeCall) return;`).

## Task Commits

Cada task se commiteó atómicamente:

1. **Task 1: Preferencia del pad DTMF — default abierto, persistente, aplicada al abrir el panel** - `0a92bfe` (feat)
2. **Task 2: Suite RESP-03 (`tests/dtmf-pad-pref.test.js`) + cierre de la fase** - `c267b00` (test)

## Files Created/Modified

- `public/app.js` — bloque `[36-03] RESP-03`, en 2 zonas:
  - Junto al wiring del DTMF (antes del `addEventListener` del toggle): los 3 helpers `_dtmfPadPrefOpen()` / `_applyDtmfPadPref(open)` / `_setDtmfPadPref(open)`, y el handler del toggle reescrito a `_setDtmfPadPref(!_dtmfPadPrefOpen())`.
  - `_startTelnyxCall`: `_applyDtmfPadPref(_dtmfPadPrefOpen());` justo después de `_tlxApplyPos('call');` (que a su vez va después de `panel.style.display = 'flex';`), con comentario explicando por qué se reaplica en cada apertura.
- `public/index.html` — cache-buster `app.js` `20260822d` → `20260823a`. `style.css` **sin tocar** (`git diff --stat public/style.css` vacío, verificado). El único otro cambio en el diff del archivo es esa línea del cache-buster.
- `tests/dtmf-pad-pref.test.js` (nuevo) — 25 tests: comportamiento de las 3 funciones reales evaluadas con `new Function` + stubs de `document`/`localStorage` (default abierto sin nada guardado, `'0'`/`'1'`/basura, `getItem` que tira, `apply()` en los dos sentidos sin escribir nada y sin tirar con nodos ausentes, `setPref()` persistiendo en los dos sentidos y sin tirar con `localStorage` restringido); fuente/cableado (el toggle llama `_setDtmfPadPref(`, el flip volátil desapareció, las 3 funciones se declaran una sola vez, `scm_dtmf_pad` aparece ≥2 veces, `_applyDtmfPadPref(_dtmfPadPrefOpen())` vive dentro de `_startTelnyxCall` con índice posterior a `panel.style.display = 'flex';`, las 12 teclas y el envío de tonos intactos, `index.html` sigue con 12 `dtmf-key`); cache-buster (forma + estrictamente mayor al baseline real).
- `tests/script-attribution-core.test.js` — 1 línea tocada (ver Deviations): la ventana fija de extracción de `window._startTelnyxCall = async` se amplió de 6200 a 6800 caracteres.

## Decisions Made

- Ver "key-decisions" en el frontmatter: default abierto (no "cerrado, recuerda si lo abrieron"), el markup del pad no cambia (sigue `display:none`, lo abre el JS), y la preferencia se reaplica en cada apertura del panel (no solo al bootear el módulo).

## Deviations from Plan

**1. [Rule 1 - Bug expuesto por una ventana fija de texto ante una inserción legítima y ajena a esta fase]**
- **Found during:** Task 2, corriendo `npm test` completo tras cerrar la suite nueva.
- **Issue:** `tests/script-attribution-core.test.js` (Fase 35, SCR-ATTR) extraía un "bloque" de `public/app.js` con `appJs.slice(i, i + 6200)` a partir de `window._startTelnyxCall = async` para verificar la re-siembra tardía del guion (`_ensureCallScripts().then(` + `!_scriptIdsFor(leadId).length`). La línea de aplicación de `_applyDtmfPadPref(_dtmfPadPrefOpen())` que este plan insertó dentro del mismo cuerpo de `_startTelnyxCall` (antes de esos literales, por diseño explícito del plan) corrió esos dos literales de offset ~6438/6523 — por encima de la ventana de 6200, poniendo el test en rojo.
- **Fix:** se amplió la ventana a 6800 (margen sobre los ~6523 medidos), con comentario que documenta el motivo y referencia el mismo patrón ya visto en 33-03/34-02 (STATE.md). No se tocó el propósito ni las aserciones del test, solo el tamaño de la ventana.
- **Files modified:** `tests/script-attribution-core.test.js`.
- **Commit:** `c267b00` (junto con la Task 2, mismo commit — el fix se descubrió corriendo la verificación completa de esa misma tarea).

Ninguna otra desviación — el resto del plan se ejecutó tal como estaba escrito.

## Issues Encountered

Ninguno más allá de la deviation documentada arriba.

## Verificación por mutación (paso 5 de `<verification>`)

Aplicada con un script de Node (no con edits manuales), corrida `tests/dtmf-pad-pref.test.js`, restaurada con `git checkout -- public/app.js` verificando `git status --short public/app.js` vacío antes de continuar.

**Mutación: cambiar el default de `_dtmfPadPrefOpen` de `!== '0'` a `=== '1'` (o sea, cerrado por defecto salvo que digan `'1'`):**
Fallan exactamente los 2 tests que cubren el default — *"sin nada guardado, `_dtmfPadPrefOpen()` es true"* (`expected false to be true`) y *"con basura ('x') guardada, `_dtmfPadPrefOpen()` es true — solo '0' cierra"* (`expected false to be true`) — 23/25 tests siguieron verdes. Restaurado, diff vacío confirmado.

## Verificación de suites (pasos 2, 3 y 4 de `<verification>`)

- **Suite nueva + neighbours de la fase, Task 1 (`<verify>` de la Task 1):** `node --check public/app.js` OK + `npx vitest run tests/dispo-feedback.test.js tests/dispo-async-meta.test.js` → **53/53 verdes** (sin editar ninguno de los dos).
- **Suite nueva + neighbours, Task 2 (`<verify>` de la Task 2):** `npx vitest run tests/dtmf-pad-pref.test.js tests/dispo-feedback.test.js tests/dispo-async-meta.test.js` → **78/78 verdes** (25 nuevos, mínimo pedido: 10).
- **`npm test` completo, corrido 2 veces tras cerrar la Task 2 (incluyendo el fix de la deviation):** **120 archivos / 2132 tests, todos verdes** las dos veces. Delta vs el baseline real de 36-02 (119 archivos / 2107 tests): **+1 archivo, +25 tests, 0 fallos nuevos, 0 regresiones**.
- `git diff --stat public/style.css package.json package-lock.json` → vacío (no se instaló nada, `style.css` intacto).
- `git diff public/index.html` → solo la línea del cache-buster de `app.js` (verificado con `git diff`, sin ningún otro cambio).

## Cache-buster: antes y después (leído de disco)

| | app.js | style.css |
|---|---|---|
| **Antes** (baseline real, dejado por 36-02) | `20260822d` | `20260822a` |
| **Después** (este plan) | `20260823a` | `20260822a` (sin tocar) |

## Qué queda SIN verificar en vivo

No hay browser en el entorno de ejecución de este plan (solo Node + vitest). Queda pendiente de la primera tanda real de llamadas post-deploy:

- **(a)** Que el pad abierto no empuje el botón "Colgar" (ni ningún otro control del footer) fuera de la vista en pantallas chicas o con el panel arrastrado a una posición baja (Fase 28, D-10: `_tlxApplyPos`). El pad vive en el footer FIJO del panel (`#telnyx-call-panel`, flex column: header fijo + medio scrolleable + footer fijo), así que en teoría el que se achica es el área scrolleable de la ficha, no el footer — pero hay que mirarlo una vez en preview o producción con una pantalla chica o el panel arrastrado abajo.
- **(b)** Que los tonos lleguen de verdad a un IVR real — eso solo se puede comprobar llamando a una central que use menú de opciones.

Ninguno de los dos afecta el código verificado: (a) es un chequeo visual de layout, (b) es el mismo camino de envío de tonos que ya existía sin cambios (`_telnyx.activeCall.dtmf(k)`), solo se verificó por fuente que sigue intacto.

## Cierre de la Fase 36 (DISP — La disposición responde)

**Los 3 criterios de éxito de la fase quedaron entregados:**

- **RESP-01** (acuse inmediato al marcar) — implementado en **36-01**: `_dispoBusyOn`/`_dispoBusyOff` prenden "Guardando…" en el mismo frame del clic (grid del Power Dialer + `<select>` de Llamadas/Hoy), apagan en guardado/error/modal + techo de 15s. Ver `36-01-SUMMARY.md`.
- **RESP-02** (el POST no espera al audio) — implementado en **36-02**: `_metaObj` se arma sincrónicamente en `_onTelnyxCallEnded` (afuera del `setTimeout` de 500ms), `_finalizeActiveCallBeforeDisposition` quedó sin ningún `await`, la espera del audio se mudó a `_flushPendingTranscription` vía `_audioInFlight` sin perder `telnyxCallMeta` en ninguno de los 6 caminos de disposición. Ver `36-02-SUMMARY.md`.
- **RESP-03** (el pad DTMF arranca visible o recuerda) — implementado en **este plan (36-03)**: por defecto abierto Y recuerda el último estado (las dos variantes que admitía el criterio), reaplicado en cada apertura del panel.

**Recordatorio de la colisión de IDs anotada en 36-01-SUMMARY.md:** los IDs `RESP-01/02/03` de esta fase **NO** son los mismos que `DISP-01/02/03` de la Phase 20 (disposición obligatoria) — se renombraron de DISP a RESP el 2026-08-21 precisamente para evitar esa colisión (nota en `REQUIREMENTS.md`, línea 378-379). Si algo en el histórico de commits o STATE.md menciona "DISP-0X" sin más contexto, verificar a cuál de las dos fases se refiere antes de asumir.

**ROADMAP.md** actualizado a mano (verificado en disco antes de editar, no asumido): fila de la tabla `## Progress` de la Phase 36 pasó de `2/3 | Executing | —` a `3/3 | Complete | 2026-08-23`; los 3 checkboxes bajo `**Plans**:` quedaron tildados.

## User Setup Required

None — no requiere configuración externa. Los cambios son 100% frontend estático, servidos por el mismo Express existente.

## Next Phase Readiness

- RESP-03 completo, Phase 36 (DISP) **COMPLETA (3/3 planes)**.
- Siguiente fase del milestone: **Phase 37 (SES — La sesión de discado como partida)**, sin plan generado todavía (requiere plan-phase). No depende de nada de este plan puntual — depende de las Phases 33 y 35, ya completas.

---
*Phase: 36-disp-disposicion-responde*
*Completed: 2026-08-23*

## Self-Check: PASSED

- FOUND: `tests/dtmf-pad-pref.test.js`
- FOUND: `public/app.js`
- FOUND: `public/index.html`
- FOUND: `tests/script-attribution-core.test.js`
- FOUND commit `0a92bfe` (Task 1: feat)
- FOUND commit `c267b00` (Task 2: test)

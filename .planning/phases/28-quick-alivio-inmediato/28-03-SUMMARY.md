---
phase: 28-quick-alivio-inmediato
plan: 03
subsystem: ui
tags: [vanilla-js, drag-and-drop, pointer-events, telnyx, localStorage]

# Dependency graph
requires:
  - phase: 28-quick-alivio-inmediato (plan 02)
    provides: "Sin dependencia funcional — comparten public/app.js secuencialmente (28-02 cableó el calendario; 28-03 tocó el panel de llamada/guion, zona distinta del mismo archivo)"
provides:
  - "window._tlxRecenter(panelKey) para diagnóstico/soporte"
  - "Bloque puro PANEL-DRAG-PURE (_tlxClampPos, _tlxPosKey) reusable si se agrega un tercer panel arrastrable"
  - "Los dos paneles de llamada (#telnyx-call-panel, #telnyx-script-panel) arrastrables con posición persistida por usuario"
affects: [ui, dialer, telnyx-calls]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "extracción de bloque literal por marcadores para tests puros (reusa el patrón DTPICKER-PURE de 28-01, sin jsdom)"
    - "arrastre con Pointer Events nativos: setPointerCapture + umbral de 3px antes de considerar arrastre real (evita que un click suelto en la barra apague el empuje automático)"
    - "resolución de conflicto !important vs estilo inline con selector :not(.clase) en vez de panel.style.setProperty(prop, v, 'important') desde JS — más legible, menos fácil de pasar por alto en review"

key-files:
  created:
    - tests/panel-drag.test.js
  modified:
    - public/app.js
    - public/index.html
    - tests/dtpicker-wiring.test.js

key-decisions:
  - "El botón 'Centrar' reescribe explícitamente los 3 valores originales de home (left/top/transform) en vez de borrar el atributo style — borrarlo hubiera eliminado el centrado que vive en el HTML y el panel se hubiera quedado en 0,0"
  - "_tlxApplyPos se re-clampea contra el viewport ACTUAL en cada apertura (no contra el que tenía al guardar) — un panel guardado en una resolución de pantalla distinta siempre reaparece dentro del viewport nuevo"
  - "Fix del test tests/dtpicker-wiring.test.js (Rule 1): aseraba el cache-buster exacto de 28-02 (v=20260814b) — al bumpearlo a v=20260814c (regla obligatoria de CLAUDE.md) el test rompía. Se relajó a 'no quedó por debajo del baseline de 28-02', dejando que tests/panel-drag.test.js sea quien fija el valor vigente"

requirements-completed: [DIAL-05]

# Metrics
duration: ~20min
completed: 2026-08-14
---

# Phase 28 Plan 03: Paneles de llamada arrastrables Summary

**Los dos paneles de Telnyx (`#telnyx-call-panel`, `#telnyx-script-panel`) se arrastran desde su barra de arriba con Pointer Events nativos, recuerdan su posición por usuario en `localStorage`, y el empuje automático CSS (`body.tlx-script-open`) cede exactamente cuando el usuario ya movió el panel — vía `:not(.tlx-dragged)`, sin `setProperty(..., 'important')` desde JS. Task 1 y Task 2 (autónomas) completadas y verificadas estáticamente; Task 3 (checkpoint humano) queda PENDIENTE — requiere al user probando el flujo real de llamada.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-08-14 (base commit del wave 3, tras 28-02)
- **Completed:** 2026-08-14
- **Tasks:** 2 de 3 completadas (Task 3 es checkpoint humano, queda pendiente)
- **Files modified:** 3 (`public/app.js`, `public/index.html`, `tests/dtpicker-wiring.test.js`) + 1 creado (`tests/panel-drag.test.js`)

## Accomplishments

- **Task 1 — Motor de arrastre + resolución del conflicto CSS:**
  - Bloque puro `PANEL-DRAG-PURE` (`_tlxClampPos`, `_tlxPosKey`) sin dependencias de DOM/`localStorage`/red, extraído por marcadores y evaluado aislado (19 tests).
  - Motor de arrastre (`_tlxRegisterDrag`, `_tlxApplyPos`, `_tlxRecenter`) con Pointer Events: `setPointerCapture`, umbral de 3px antes de marcar arrastre real, ignora clicks sobre `button/input/select/textarea/a` del header.
  - Persistencia por panel y por usuario: `localStorage` con clave `tlx_panel_pos_<panel>_<userId>`, mismo patrón que `_pdAutopilotKey`/`calls_setter_filter_<userId>` ya usados en el proyecto.
  - Selector del empuje automático (`body.tlx-script-open #telnyx-call-panel`) ganó `:not(.tlx-dragged)` — sigue empujando idéntico a paneles nunca arrastrados; cede ante la posición del usuario apenas hay un drag real.
  - `.tlx-dragged { animation:none !important; }` para que un panel con posición propia no salte al centro por 250ms cada vez que se abre (las animaciones `tlxScaleIn`/`tlxSlideIn` están declaradas inline en cada panel).
  - Botones "Centrar" en los dos headers, `display:none` por defecto y visibles solo cuando el panel tiene la clase `.tlx-dragged`.
  - Cache-buster bumpeado a `v=20260814c`.
- **Task 2 — Aplicar la posición al abrir cada panel:**
  - `_tlxApplyPos('call')` inmediatamente después de `panel.style.display = 'flex'` en `_startTelnyxCall` (sin salto visual).
  - `_tlxApplyPos('script')` inmediatamente después de `if (panel) panel.style.display = 'flex';` en `_openScriptPanel`.
  - `_closeTelnyxCallPanel` y `_closeScriptPanel` intactos — verificado con `git diff` explícito, cero líneas tocadas dentro de esas dos funciones (D-10: la posición se recuerda para siempre, no se resetea al cerrar).

## Task Commits

1. **Task 1: Motor de arrastre con persistencia + resolución del conflicto CSS** - `c495e19` (feat)
2. **Task 2: Aplicar la posición al abrir cada panel + fix de test roto por el cache-buster** - `1c46470` (feat)
3. **Task 3: Verificación humana de la fase (calendario + paneles)** - **PENDIENTE** (checkpoint, no requiere código)

## Files Created/Modified

- `public/app.js` — bloque `PANEL-DRAG-PURE` (`_tlxClampPos`, `_tlxPosKey`) + motor (`_TLX_PANELS`, `_tlxLoadPos`, `_tlxSavePos`, `_tlxApplyPos`, `_tlxRecenter`, `_tlxRegisterDrag`) inmediatamente antes de `_openScriptPanel`; llamadas a `_tlxApplyPos('call')`/`_tlxApplyPos('script')` en `_startTelnyxCall`/`_openScriptPanel`.
- `public/index.html` — `id`/`class="tlx-drag-handle"` en los dos headers, botones `#telnyx-call-recenter`/`#telnyx-script-recenter`, selector del empuje con `:not(.tlx-dragged)`, reglas `.tlx-dragged`/`.tlx-drag-handle`/`body.tlx-dragging`/`.tlx-recenter-btn` en el `<style>` embebido, cache-buster `app.js?v=20260814c`.
- `tests/panel-drag.test.js` (nuevo) — 19 tests: 8 de los helpers puros (5 `_tlxClampPos` + 3 `_tlxPosKey`), 1 de limpieza del bloque puro, 6 aserciones de fuente sobre `index.html` (selector `:not`, `!important`+transición, regla `.tlx-dragged`, ids de headers/botones, cache-buster), 4 aserciones de fuente sobre `app.js` (`setPointerCapture`, `_tlxApplyPos`, reescritura explícita en `_tlxRecenter`, registro de los dos paneles + `window._tlxRecenter`).
- `tests/dtpicker-wiring.test.js` (modificado, Rule 1) — el test de cache-buster de 28-02 fijaba el valor exacto `v=20260814b`; se relajó a "no quedó por debajo de ese baseline" para no chocar con el bump legítimo de este plan.

## Decisions Made

- Ver `key-decisions` en el frontmatter — resumen: reescritura explícita de `home` en el recenter (nunca strings vacíos), re-clamp contra el viewport ACTUAL en cada apertura, y el fix del test de cache-buster documentado como deviation Rule 1.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test `tests/dtpicker-wiring.test.js` fijaba el cache-buster exacto de 28-02**
- **Found during:** Task 2, al correr `npm test` completo tras bumpear el cache-buster de `v=20260814b` a `v=20260814c` (acción explícita y obligatoria de la Task 1 de este plan).
- **Issue:** El test `"cache-buster de app.js bumpeado a v=20260814b"` de 28-02 hacía `expect(indexHtml).toMatch(/app\.js\?v=20260814b/)` — un assert de valor exacto que por diseño se rompe con cualquier bump posterior legítimo del cache-buster (y cada plan de esta fase toca `app.js`, así que iba a romperse de nuevo con el próximo plan igual).
- **Fix:** Se cambió el assert a comparar que el valor actual sea `>=` al baseline de 28-02 (`"20260814b"`), en vez de fijar un literal. `tests/panel-drag.test.js` (este plan) es quien fija el valor VIGENTE (`v=20260814c`) — la responsabilidad de "cuál es la versión correcta ahora mismo" queda en el test del plan que la bumpeó por última vez, no en uno de un plan anterior.
- **Files modified:** `tests/dtpicker-wiring.test.js`
- **Verification:** `npx vitest run tests/dtpicker-wiring.test.js` → 30/30 PASS. `npm test` completo → 1240/1240 PASS.
- **Committed in:** `1c46470` (parte del commit de Task 2)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug de fixture de test causado directamente por la acción requerida de este plan)
**Impact on plan:** Necesario para que `npm test` completo quede verde, criterio de aceptación explícito de la Task 2. Sin scope creep — no se tocó ninguna otra aserción de ese archivo.

## Issues Encountered

Ninguno relacionado con la implementación en sí. Limitación de entorno (ver sección siguiente): este ejecutor no tuvo disponible ninguna herramienta de browser/preview (`preview_start`, `javascript_tool`, screenshot) — mismo caveat que 28-01 y 28-02.

### Verificación en preview NO ejecutada (limitación del entorno de este ejecutor)

El `<action>` de la Task 2 pide 7 puntos de verificación manual en el preview server (mostrar los paneles a mano vía consola, arrastrar, activar/desactivar `tlx-script-open` con el panel ya arrastrado, recargar, probar el comportamiento default sin posición guardada, clickear "Centrar", forzar una posición imposible en `localStorage`). Este ejecutor tuvo disponibles únicamente Read/Write/Edit/Bash/Grep/Glob — sin `preview_start`/`javascript_tool`/screenshot — igual que los ejecutores de 28-01 y 28-02. La verificación se hizo por la vía disponible más fuerte:

1. **Los 19 tests de `tests/panel-drag.test.js`** fijan el contrato exacto de `_tlxClampPos` (los 3 casos numéricos del plan + panel más grande que el viewport + valores no numéricos) y `_tlxPosKey` (con/sin userId) — cubre matemáticamente los puntos 2, 4 y 7 del checklist manual (clamp al arrastrar, panel guardado fuera de pantalla tras cambio de resolución).
2. **Revisión de código línea por línea** contra la especificación exacta del plan: `_tlxApplyPos` no toca nada si `_tlxLoadPos` devuelve `null` (comportamiento default intacto — punto 5), `:not(.tlx-dragged)` en el selector CSS del empuje (punto 3 — un panel sin la clase sigue matcheando el selector idéntico a como matcheaba antes; con la clase, dejó de matchear), `_tlxRecenter` reescribe `left`/`top`/`transform` con los 3 valores de `home` y borra la clave de `localStorage` (punto 6).
3. **`node --check public/app.js`** — sintaxis OK.
4. **Greps de TODOS los acceptance criteria** de ambas tasks (documentados abajo en Self-Check).
5. **`git diff` explícito** confirmando que `_closeTelnyxCallPanel`/`_closeScriptPanel` no tienen ni una línea tocada.
6. **`npm test` completo** — 1240/1240 verde, sin regresiones.

**Queda pendiente la verificación visual real** — necesita una llamada Telnyx activa (o simular con la consola del browser en un preview corriendo) para confirmar que el arrastre se siente bien, que el botón "Centrar" aparece/desaparece en el momento correcto, y que no hay salto visual al abrir un panel con posición guardada. Ese es precisamente el contenido de la Task 3 (checkpoint humano), que queda formalmente pendiente — ver sección siguiente.

## Task 3 — Checkpoint humano: PENDIENTE

**Tipo:** `checkpoint:human-verify`, `gate="blocking"` — la Task 3 del plan es un gate bloqueante que este ejecutor NO puede resolver: no escribe código, requiere que el user pruebe el flujo real (llamada Telnyx activa) y confirme o reporte qué falló.

**Qué se le va a presentar al user** (contenido `<what-built>`/`<how-to-verify>` del plan, sin editar):

> Las dos molestias diarias de la Phase 28, ya deployables:
> - Calendario propio en los 5 campos de fecha (modal "Volver a llamar", agendar reunión desde llamada, agendar, hold de calendario por mail, mensaje programado): mes a la vista y clickeable, navegación entre meses, franjas horarias 09:00–19:00 con ajuste fino de minutos, etiqueta "Martes 18/08 · en 4 días · 10:00" al elegir, hora local del lead y numerito de compromisos por día. Los atajos rápidos que ya usabas siguen igual: un click y listo.
> - Los dos paneles de llamada se arrastran desde su barra de arriba y recuerdan dónde los dejaste, con un botón "Centrar" para volver al medio. Abrir el guion ya no te mueve el panel principal si vos lo acomodaste.

Pasos de verificación (6 puntos):
1. Recargar la pestaña una vez (cache-buster cambió: `app.js?v=20260814c`).
2. Llamadas → un lead → "Volver a llamar": ¿el calendario dice sin contar días dónde cae la fecha?
3. Probar un atajo ("Mañana 9am" / "En 2 días") y confirmar que guarda igual que siempre + sale el aviso de a dónde se fue el lead.
4. Llamada real (Power Dialer) → arrastrar el panel a un costado → abrir guiones: ¿el panel principal se quedó donde lo pusiste?
5. Colgar, llamar de nuevo: ¿el panel apareció en el mismo lugar?
6. Clickear "Centrar": ¿vuelve al medio y el guion vuelve a empujarlo como antes?

**Estado:** el user todavía no vio ni respondió a este checkpoint. Ningún commit de código corresponde a esta task porque no se edita código en un checkpoint — la aprobación (o el reporte de qué falló) se transcribe textual acá cuando llegue, ANTES de intentar cualquier arreglo (regla del plan: "si el user reporta un problema, transcribir textual en el SUMMARY qué punto falló, qué esperaba y qué pasó, ANTES de intentar cualquier arreglo").

## User Setup Required

None — no requiere configuración de servicios externos. Sí requiere que el user (u otro ejecutor con acceso a browser real) resuelva el checkpoint de la Task 3.

## Next Phase Readiness

- Task 1 y Task 2 completas, testeadas y commiteadas — el código está listo para deployar.
- La Phase 28 completa (28-01 calendario puro, 28-02 wiring del calendario, 28-03 paneles arrastrables) queda con **1 checkpoint humano pendiente** (esta Task 3), que es también el ÚNICO punto de verificación visual explícito de toda la fase — ninguno de los 3 planes tuvo acceso a herramientas de browser en este entorno.
- No hay bloqueadores de código para el resto del roadmap — Phase 28 es "QUICK — Alivio inmediato", adelantada y sin dependencias hacia atrás.

## Self-Check

- `tests/panel-drag.test.js` existe: FOUND
- `public/app.js` contiene bloque `PANEL-DRAG-PURE` (1 INICIO, 1 FIN): FOUND
- `public/index.html` contiene los 2 ids de header + 2 botones de centrar + selector `:not(.tlx-dragged)` (×1) + regla `.tlx-dragged` + cache-buster `v=20260814c`: FOUND (greps confirmados arriba)
- Commit `c495e19` (Task 1): FOUND en `git log`
- Commit `1c46470` (Task 2): FOUND en `git log`
- `node --check public/app.js`: sin errores
- `npm test` completo: **1240/1240 PASS** (baseline 1221 tras 28-02 + 19 nuevos de `panel-drag.test.js`)

## Self-Check: PASSED

---
*Phase: 28-quick-alivio-inmediato*
*Completed: 2026-08-14 (Task 1 y 2; Task 3 checkpoint pendiente)*

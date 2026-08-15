---
phase: 32-act-acciones
plan: 03
subsystem: ui
tags: [vanilla-js, whatsapp, wa.me, power-dialer, commitment-model]

# Dependency graph
requires:
  - phase: 32-act-acciones
    plan: 01
    provides: "POST /api/setters/leads/:id/whatsapp-send (arma wa.me + registra el envio como compromiso enviar_info/pedir_presupuesto cumplido en el mismo request), ACT_WA_TEMPLATE_IDS"
provides:
  - "Bloque [32-03] ACT-PURE en public/app.js: ACT_WA_TEMPLATES (3 plantillas D-06) + _actTemplateById"
  - "_actButtonsHTML(leadId, opts): builder unico del boton de WhatsApp para las 4 superficies (row/pd/ficha/hoy)"
  - "window._actWhatsApp(leadId): overlay de envio (plantilla editable + destino principal/alternativo/otro numero + CTA que abre wa.me en pestana nueva)"
  - "Rama nueva en _dispoDestination: compromiso propio cumplido + nextAction esperar_respuesta -> vista 'en Hoy -> Esperando del prospecto'"
  - "_dispoAnnounce gana opts.forceToast (el envio es accion explicita del SDR, tira el toast aunque el Power Dialer este activo)"
affects: [32-04-descartar]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Builder unico + N call sites con variante por superficie (mismo patron que _dispoSelectHTML) para evitar la desincronizacion que ya mordio una vez (nota #156 de CLAUDE.md)"
    - "El markup del overlay conserva UNA sola fuente de verdad para el numero alternativo (window._callsAltContact via link 'editar contacto secundario', sin UI paralela)"
    - "opts.forceToast como escape hatch del hold del Power Dialer para acciones explicitas del SDR que no son el cierre de una llamada (precedente para 32-04/descartar)"

key-files:
  created:
    - tests/act-ui-whatsapp.test.js
  modified:
    - public/app.js
    - public/index.html

key-decisions:
  - "_actButtonsHTML declarada como function (no const) inmediatamente despues de _dispoSelectHTML: hay call sites por encima de su posicion en el archivo y las function declarations hoistean"
  - "El bloque ACT-PURE (templates) vive en un lugar del archivo distinto de _actButtonsHTML (builder): las plantillas van despues de COMMITMENT-PURE (~11800) porque el test las extrae con new Function de forma autocontenida; el builder va junto a _dispoSelectHTML (~6100) porque necesita convivir con los otros builders de fila. Los marcadores [32-03] ACT-PURE solo envuelven las plantillas, no el builder"
  - "Los comentarios explicativos del handler evitan los literales '_pdRender(' y '_pd.holdCurrent' (parafraseados en prosa: 'ningun redibujado del Power Dialer', 'el flag que pinta Resultado guardado') para que el acceptance criteria de grep ('no contiene _pdRender( ni _pd.holdCurrent') pase incluso contando comentarios -- mismo criterio que 32-01 aplico con 'setterId'/'callLog'"
  - "forceToast se implementa como un early-return ANTES del if (_pd.active) existente, no modificando esa condicion: el test tests/gate-destination.test.js verifica el literal EXACTO 'if (_pd.active) {' via string match, asi que la condicion vieja queda intacta y forceToast la saltea por completo en vez de anidarse adentro"

patterns-established:
  - "Punto de extension unico para futuros botones de accion del lead: 32-04 agrega el boton de descartar dentro de _actButtonsHTML en vez de tocar las 4 superficies de nuevo"

requirements-completed: [ACT-01, ACT-02, ACT-03]

# Metrics
duration: ~25min
completed: 2026-08-15
---

# Phase 32 Plan 03: Botón de WhatsApp en las 4 superficies Summary

**Un solo componente (`_actButtonsHTML`) cablea el botón "Mandar WhatsApp" en Llamadas/Power Dialer/ficha/Hoy; un click abre un overlay con 3 plantillas editables + selector de destino, y al confirmar abre `wa.me` en pestaña nueva mientras el backend (32-01) deja el envío anotado — con un aviso que dice explícitamente "en Hoy → Esperando del prospecto".**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-08-15
- **Tasks:** 3/3
- **Files modified:** 3 (`public/app.js`, `public/index.html`, `tests/act-ui-whatsapp.test.js` nuevo)

## Accomplishments

- Bloque puro `[32-03] ACT-PURE` con `ACT_WA_TEMPLATES` (3 plantillas: post_llamada / envio_info / reconfirmar_reunion, keys espejadas con `ACT_WA_TEMPLATE_IDS` del backend) y `_actTemplateById(key)` (nunca `undefined`).
- `_actButtonsHTML(leadId, opts)`: builder único con variante por superficie (`row`/`pd`/`ficha`/`hoy`), cableado en `renderCallsList`, `_pdRender`, `_callsRenderExpandedPanel` y `_hoyRenderSection` — 5 ocurrencias totales (1 declaración + 4 call sites).
- Removido el quick-link legacy de wa-multi (`lead.whatsappUrl` + `window._waBtnClick`) del Power Dialer: dos botones de WhatsApp con comportamientos distintos en la misma tarjeta era peor que uno. `_waBtnClick`/`_waMultiClick` NO se tocaron — solo se dejó de usar ese link puntual; el badge "ver chat" de `renderCallsList` (otra cosa: abrir una conversación YA existente) sigue intacto.
- `window._actWhatsApp(leadId)`: overlay con selector de plantilla (reescribe el textarea al cambiar, vía `_interpolateScript`), destino Principal/Alternativo/Otro número (con guardado opcional como contacto secundario + link a `window._callsAltContact` para el editor completo), y CTA `Abrir WhatsApp` que hace `POST /whatsapp-send` → `window.open(whatsappUrl, '_blank', 'noopener')` → `_leadStoreApply` → `_dispoAnnounce(..., {forceToast:true})`. Si el navegador bloquea el popup, avisa con el link para abrirlo a mano — el registro ya quedó hecho igual.
- `_dispoDestination` gana una rama nueva (entre "compromiso pendiente" e "interesado"): `commitment.estado==='cumplido' && parte==='yo'` + `nextAction.origen==='compromiso' && tipo==='esperar_respuesta'` → `vista: 'en Hoy → Esperando del prospecto'`, con texto que distingue canal (`whatsapp` → "le abriste el chat"; cualquier otro → "le mandaste el material"). Antes este caso caía en el genérico "a la cola de Llamadas", que mentía sobre dónde vive el lead.
- `_dispoAnnounce` gana `opts.forceToast`: el envío es una acción explícita del SDR (no el cierre de una llamada), así que tira el toast igual aunque el Power Dialer esté activo — implementado como un early-return ANTES del `if (_pd.active)` existente, sin tocar su literal (protege `tests/gate-destination.test.js`, que lo verifica por match exacto de string).
- Cache-buster `app.js` `20260815g` → `20260815h` (`style.css` intacto, `git diff` confirmado vacío).
- 38 tests nuevos en `tests/act-ui-whatsapp.test.js` (≥18 pedidos): bloque puro (forma, keys, sin marca, sin ¿/¡, vocabulario permitido, máx. 2 párrafos), paridad con `index.js`, cableado de las 4 superficies, la rama nueva de destino (con reloj fijo), anti-deriva del título de Hoy, `forceToast`, y el handler completo (POST, `window.open`, `escHtml`, ausencia de `_pdRender(`/`_pd.holdCurrent` incluso en comentarios).
- **Verificación por mutación**: romper temporalmente la llamada de `_hoyRenderSection` a `_actButtonsHTML` puso en rojo **exactamente 2 de 38 tests** (el conteo total de 5 ocurrencias y el call site específico de `'hoy'`). Restaurado con `git checkout -- public/app.js`, `git diff public/app.js` confirmado vacío antes de continuar.
- `npm test` completo: **1588/1588** (baseline 1550 + 38 nuevos, sin flaky).

## Task Commits

Each task was committed atomically:

1. **Task 1: Plantillas, builder único y cableado en las 4 superficies** - `2197783` (feat)
2. **Task 2: window._actWhatsApp + rama de destino post-envío** - `76db3c0` (feat)
3. **Task 3: Suite de tests + cache-buster** - `53c056b` (test)

## Files Created/Modified

- `public/app.js` — bloque `[32-03] ACT-PURE` (templates + `_actTemplateById`) inmediatamente después de `[31-03] COMMITMENT-PURE: FIN`; `_actButtonsHTML` inmediatamente después de `_dispoSelectHTML`; `window._actWhatsApp` inmediatamente después de `window._callsCloseCommitment`; rama nueva dentro de `[30-03] DISPO-DEST`; `opts.forceToast` en `_dispoAnnounce`; cableado en `renderCallsList`, `_pdRender` (+ remoción del quick-link legacy de WhatsApp), `_callsRenderExpandedPanel`, `_hoyRenderSection`.
- `public/index.html` — cache-buster `app.js?v=20260815h` (única línea tocada).
- `tests/act-ui-whatsapp.test.js` (nuevo) — 38 tests: bloque puro, paridad backend, cableado de superficies, destino, anti-deriva, handler, cache-buster.

## Decisions Made

Ver `key-decisions` en el frontmatter — resumen:

- `_actButtonsHTML` como `function` (no `const`) por hoisting, ya que hay call sites por encima de su posición en el archivo.
- El bloque `ACT-PURE` (solo las plantillas) vive separado del builder `_actButtonsHTML`: las plantillas necesitan estar autocontenidas para el `new Function` del test; el builder necesita convivir con `_dispoSelectHTML`.
- Los comentarios del handler evitan los literales `_pdRender(` / `_pd.holdCurrent` (parafraseados en prosa) porque el acceptance criteria del plan pide que esos tokens NO aparezcan en el cuerpo, ni siquiera en comentarios — mismo criterio que 32-01 aplicó con `setterId`/`callLog`.
- `forceToast` se implementó como early-return ANTES del `if (_pd.active) {` existente (en vez de modificar esa condición a `if (_pd.active && !opts.forceToast)`), porque `tests/gate-destination.test.js` verifica el literal exacto `"if (_pd.active) {"` por string match — cambiar la condición habría roto ese test sin editarlo (prohibido por el plan).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Comentarios propios rompían sus propios acceptance criteria de grep**
- **Found during:** Task 1 y Task 2, durante la verificación de los conteos exigidos por el plan.
- **Issue:** al escribir comentarios explicativos usando los literales `lead.whatsappUrl`, `_waBtnClick`, `_pdRender(` y `_pd.holdCurrent` (para documentar por qué se sacaban/no se usaban), esos mismos comentarios reintroducían las cadenas que los acceptance criteria exigían contar/ausentar — mismo patrón exacto que 32-01 documentó en su SUMMARY con `setterId`/`callLog`.
- **Fix:** los comentarios se reescribieron en prosa evitando los tokens literales exactos, conservando la explicación (ej: "el flag que pinta `✓ Resultado guardado` en el dialer" en vez de `_pd.holdCurrent`).
- **Files modified:** `public/app.js` (dentro de los mismos commits de Task 1/Task 2, corregido antes de cada commit).
- **Verification:** conteos exactos re-verificados por grep tras cada fix (`lead.whatsappUrl` bajó en 2, `_waBtnClick` bajó en 1, `_pdRender(`/`_pd.holdCurrent` ausentes del cuerpo del handler).
- **Committed in:** `2197783` (Task 1) y `76db3c0` (Task 2) — el fix se aplicó ANTES de cada commit, no como commit separado.

---

**Total deviations:** 1 clase de auto-fix (2 ocurrencias, mismo patrón) — Rule 1.
**Impact on plan:** Sin scope creep — los fixes son puramente de fraseo de comentarios, no cambian ningún comportamiento. Los acceptance criteria del plan pasan exactos.

## Issues Encountered

None fuera de lo documentado en Deviations.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **`_actButtonsHTML(leadId, opts)` es el punto de extensión documentado para 32-04**: el botón de descartar se agrega ahí mismo (mismo builder, sin volver a tocar las 4 superficies).
- **`_dispoDestination` y `_dispoAnnounce` quedan con el shape estable** que 32-04 puede reusar tal cual (`forceToast` ya existe para cualquier acción explícita del SDR que no sea el cierre de una llamada).
- **Checklist de lo que quedó SIN verificar en vivo** (no hay browser en el entorno):
  - Que el overlay se vea correctamente posicionado (z-index 10060) por encima de la ficha de Hoy en un browser real.
  - Que `window.open` efectivamente abra `wa.me` con el mensaje pre-cargado en un browser real (el flujo se verificó por extracción de código + `new Function`, no ejecución DOM real).
  - Que el bloqueador de pop-ups dispare el toast de fallback en un browser real con esa política activa.
  - Que cambiar de plantilla en el `<select>` reescriba visualmente el `<textarea>` (verificado por lectura del código, no por click real).
  - Que el radio "Otro número" habilite/deshabilite correctamente los campos dependientes en la UI real.
- Sin bloqueantes de código. Sin instalación de paquetes (`git diff package.json package-lock.json` vacío, threat T-32-SC cerrado).

---
*Phase: 32-act-acciones*
*Completed: 2026-08-15*

## Self-Check: PASSED

- FOUND: `public/app.js`
- FOUND: `public/index.html`
- FOUND: `tests/act-ui-whatsapp.test.js`
- FOUND: `.planning/phases/32-act-acciones/32-03-SUMMARY.md`
- FOUND commit `2197783` (Task 1)
- FOUND commit `76db3c0` (Task 2)
- FOUND commit `53c056b` (Task 3)

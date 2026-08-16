---
phase: 32-act-acciones
plan: 04
subsystem: ui
tags: [vanilla-js, whatsapp, email, resend, power-dialer, commitment-model, brand-marca]

# Dependency graph
requires:
  - phase: 32-act-acciones
    plan: 02
    provides: "POST /api/setters/leads/:id/discard (requireAuth, cualquier rol) y POST /api/setters/leads/:id/send-material (requireAuth, dos vias resend/mailto, mismo modelo de evento que WhatsApp via _actRegisterSendEvent)"
  - phase: 32-act-acciones
    plan: 03
    provides: "_actButtonsHTML(leadId, opts) — builder unico del boton en las 4 superficies; ACT_WA_TEMPLATES + _actTemplateById; _dispoAnnounce(opts.forceToast); rama de destino 'en Hoy -> Esperando del prospecto' en _dispoDestination"
provides:
  - "window._actDiscard(leadId): overlay de un paso (razon opcional + DNC) que descarta el lead desde cualquiera de las 4 superficies"
  - "Segundo botón (Descartar) dentro de _actButtonsHTML, con chip .scm-chip-blocked cuando el lead ya está descartado"
  - "renderCallsList marca la fila descartada con .scm-row-blocked; class=\"scm-phone\" en los telefonos de la lista y de Hoy"
  - "loadHoyView: !terminal(l) en las 2 secciones de compromiso — un lead descartado por cualquier via sale de Hoy tambien"
  - "window._actSendMaterial(leadId): overlay de material por email (dos vias resend/mailto) reusando el catalogo de plantillas D-06"
  - "El link mailto viejo de la ficha se reemplaza por el boton 'Mandar material'"
  - "_renderCallHistory distingue el canal ('por WhatsApp'/'por email') del compromiso cerrado"
  - "tests/act-ui-discard-material.test.js (44 tests)"
affects: [33-dial-power-dialer, 34-hoy-vista-diaria]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Segundo botón agregado DENTRO del builder único existente (_actButtonsHTML) en vez de tocar las 4 superficies de nuevo — el punto de extensión que dejó 32-03 se usó tal como estaba documentado"
    - "Marca de estado bloqueado (D-16): forma + ícono + etiqueta en vez de color — primer consumidor real de .scm-chip-blocked/.scm-row-blocked en public/app.js (existían en style.css desde antes sin uso)"
    - "Red de terminales en Hoy: un filtro !terminal(l) agregado a un derivado client-side (loadHoyView) para cubrir descartes que NO pasan por el endpoint nuevo (bulk admin, disposición de llamada) — mismo criterio que ya usaba virgenesCount en esa misma función"

key-files:
  created:
    - tests/act-ui-discard-material.test.js
  modified:
    - public/app.js
    - public/index.html
    - .planning/REQUIREMENTS.md
    - .planning/ROADMAP.md
    - .planning/STATE.md

key-decisions:
  - "El acceptance criteria del plan pedía 'grep -c \"data-action=\\\"call\\\"\" public/app.js devuelve 0' asumiendo un baseline de 0 — verificado con git stash que el literal YA existía 4 veces antes de este plan (los botones 'Llamar ahora' de las alertas flotantes de speed-to-lead/callback vencido, sin relación con las filas de Llamadas). Ninguna de las 4 apariciones está dentro de renderCallsList/_pdRender ni de ningún componente de Hoy — verificado con extractFunctionBody. La intención real del criterio ('no activar el guard que oculta el botón de llamar en .scm-row-blocked') SÍ se cumple: el diff de este plan no agrega ninguna ocurrencia nueva del literal (4 antes, 4 después). El test de fuente nuevo lo verifica correctamente contra el CUERPO de renderCallsList, no contra el archivo completo."
  - "El CTA de confirmar del overlay de descarte y el botón trigger de la variante 'row' usan colores neutros (transparent + border-subtle + text-secondary), no el verde del botón de WhatsApp ni ningún rojo — D-16 pide explícitamente 'nunca rojo' y el texto del plan sugiere 'mismo lenguaje que .call-action-btn' para el CTA; se aplicó el mismo criterio neutro al trigger de la variante 'row' por consistencia visual (Claude's Discretion, el plan no fija el color exacto del trigger)."
  - "El ícono del chip .scm-chip-blocked es un círculo con una línea diagonal (\"no-entry\"), 10x10, mismo estilo de ícono inline SVG que ya usa el resto del archivo para chips chicos (ej. el reloj de _leadLocalTime) — el kit de marca (BRAND-SCM.md) pide forma+ícono+etiqueta, sin especificar el ícono exacto."
  - "El overlay de material reusa el mismo defaultSubject ('La información que te prometí') que el fallback del backend cuando el asunto llega vacío — mismo texto en los dos lados para que lo que ve el SDR antes de mandar sea lo mismo que terminaría mandando el server si lo dejara en blanco."

patterns-established:
  - "Cierre de fase con 4/4 planes: ACT-01..05 completos. Fase 33 (dial-power-dialer) es la siguiente en el roadmap y depende de esta (D-01 del builder de acciones queda estable para que 33 lo reuse sin tocar las 4 superficies otra vez)."

requirements-completed: [ACT-04, ACT-05]

# Metrics
duration: ~35min
completed: 2026-08-15
---

# Phase 32 Plan 04: Descartar + Material por email Summary

**Botón "Descartar" agregado al builder único de acciones (chip `.scm-chip-blocked` gris cuando ya está descartado, nunca rojo), red `!terminal(l)` en las 2 secciones de compromiso de Hoy, y overlay de "Mandar material" por email con dos vías (Resend / mailto) que reemplaza el link mailto muerto de la ficha — cierra ACT-01..05 y la fase 32 completa.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-08-15
- **Tasks:** 3/3
- **Files modified:** 5 (`public/app.js`, `public/index.html`, `tests/act-ui-discard-material.test.js` nuevo, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md`, `.planning/STATE.md`)

## Accomplishments

- `window._actDiscard(leadId)`: overlay de un solo paso (D-15) — select de razón poblado con `DISQUALIFY_REASONS_UI` (reusado, sin duplicar la lista) por defecto en "Sin razón específica" (D-14: sin razón también descarta) + checkbox DNC. Confirmar hace `POST /api/setters/leads/:id/discard` → `_leadStoreApply(leadId, d.lead)` → `_dispoAnnounce(leadId, { lead: d.lead, forceToast: true })` (nunca `_dispoAfterSaved`, no toca el gate de la Phase 20) → si el lead descartado es la tarjeta actual del Power Dialer, `_pdAdvance()` → si Hoy es la vista visible, `loadHoyView()`. `finally` cierra el overlay y llama `_refreshLeadPanels(leadId)`.
- `_actButtonsHTML` gana el segundo botón dentro del mismo builder (32-03 lo dejó como punto de extensión único): si `lead.estado === 'descartado'`, emite el chip `.scm-chip-blocked` (círculo con línea diagonal + etiqueta "Descartado", gris, nunca rojo — D-16); si no, el botón "Descartar" con la misma clase por variante que el de WhatsApp (`pd-quick-link` / `call-action-btn` / `hoy-ficha-btn` / pill inline en `'row'`).
- `renderCallsList` agrega `scm-row-blocked` a la fila cuando el lead está descartado (degrada visualmente sin ocultar); los `<span>` de teléfono de `renderCallsList` y de `_hoyRenderSection` llevan `class="scm-phone"` (tachado automático vía CSS que ya existía, sin tocar `style.css`).
- `loadHoyView`: las 2 secciones de compromiso ("Mis compromisos"/"Esperando del prospecto") suman `!terminal(l)` a su filtro — un lead descartado por CUALQUIER vía (el bulk de admin, un `answered_not_interested`, no solo `window._actDiscard`) deja de quedar flotando en Hoy para siempre. Es la red que hace verdadera la promesa de ACT-04 ("sale de todas las listas de una").
- `window._actSendMaterial(leadId)`: overlay gemelo del de WhatsApp — campos Para (precargado con `lead.email`, editable), Plantilla (reusa `ACT_WA_TEMPLATES` de 32-03 + `_interpolateScript`), Asunto y Mensaje. Dos CTAs visibles a la vez (D-15): "Mandar por el sistema" (`via:'resend'`) y "Abrir mi cliente de mail" (`via:'mailto'`, abre `window.open(d.mailtoUrl, '_blank', 'noopener')` con fallback de toast si el popup se bloquea). `409` con `resendUnavailable` y `502` no registran nada del lado del cliente (D-04: honesto, nunca miente sobre un envío que no salió); `200` hace `_leadStoreApply` + `_dispoAnnounce(..., { forceToast: true })` (la rama de destino que 32-03 agregó ya distingue el canal `email`). `finally` cierra y refresca — **sin** `_pdRender()` (mismo criterio que 32-03: el envío programa `nextAction` a +48h).
- En `_callsRenderExpandedPanel`, el `<a href="mailto:...">Mandar mail</a>` (abría el cliente de mail con el cuerpo vacío y sin dejar registro) se reemplaza por `<button class="call-action-btn" onclick="window._actSendMaterial(...)">Mandar material</button>`, visible siempre (con o sin `lead.email`, porque el overlay permite tipear el destinatario).
- `_renderCallHistory` (timeline unificada del lead): la línea del compromiso cerrado distingue el canal ("por WhatsApp" / "por email") cuando el compromiso lo tiene — hace verdadera la frase de ACT-05 "mismo timeline del lead" sin necesitar una vista nueva.
- Cache-buster `app.js` `20260815i` → `20260815j` (valor real leído en disco antes de bumpear, no asumido — `style.css` intacto, `git diff public/style.css` vacío).
- **Verificación por mutación**: romper temporalmente el `!terminal(l)` de una de las 2 líneas de Hoy puso en rojo exactamente **1 de 44 tests** nuevos. Restaurado con `git checkout -- public/app.js`, `git diff public/app.js` confirmado vacío antes de continuar.
- 44 tests nuevos en `tests/act-ui-discard-material.test.js` (≥19 pedidos), 0 ocurrencias del literal de fecha del cache-buster pineado.
- `npm test` completo: **1663/1663** (ver nota sobre el run inicial en Deviations — reconfirmado limpio en una segunda corrida completa).

## Task Commits

Each task was committed atomically:

1. **Task 1: Botón de descartar en el builder único + overlay de un paso + Hoy sin descartados** - `adf3e55` (feat)
2. **Task 2: Material por email desde la ficha + canal en el historial** - `9bf6503` (feat)
3. **Task 3: Tests del descarte y del material + cache-buster** - `fda7150` (test)

**Plan metadata (cierre de fase):** `68aa32b` (docs — ROADMAP.md/REQUIREMENTS.md/STATE.md actualizados a mano, `gsd-sdk` no disponible en este entorno)

## Files Created/Modified

- `public/app.js` — `_actButtonsHTML` gana el botón/chip de descarte; `window._actDiscard` declarado inmediatamente después de `window._actWhatsApp`; `window._actSendMaterial` declarado inmediatamente después de `window._actDiscard`; `renderCallsList` (clase `scm-row-blocked` + `scm-phone`); `_hoyRenderSection` (`scm-phone`); `loadHoyView` (`!terminal(l)` en `misCompromisos`/`compromisosProspecto`); `_callsRenderExpandedPanel` (botón "Mandar material" reemplaza el link mailto); `_renderCallHistory` (canal del compromiso cerrado).
- `public/index.html` — cache-buster `app.js?v=20260815j` (única línea tocada).
- `tests/act-ui-discard-material.test.js` (nuevo) — 44 tests: cableado de las 4 superficies, razón/confirmación de un paso, sincronización de destino/Power Dialer/Hoy, marca del estado bloqueado, filtro de Hoy, material por email, reemplazo del link mailto, canal en el historial, cache-buster.
- `.planning/REQUIREMENTS.md` — ACT-04 y ACT-05 marcados `[x]` (ACT-01..05 completos).
- `.planning/ROADMAP.md` — Phase 32 marcada Complete (4/4 planes) en las 3 tablas que la mencionan (Resumen, checklist, Progress) + `32-04-PLAN.md` tildado.
- `.planning/STATE.md` — Current Position actualizado a mano; frontmatter `completed_phases: 4→5`, `completed_plans: 17→18`, `percent: 57→71`.

## Decisions Made

Ver `key-decisions` en el frontmatter — resumen:

- El acceptance criteria "grep -c data-action=\"call\" devuelve 0" del plan asumía un baseline de 0 que ya no era cierto (4 ocurrencias pre-existentes sin relación, verificadas con `git stash`). El test nuevo verifica la intención real (ausencia dentro del cuerpo de `renderCallsList`), no el conteo global del archivo.
- CTA de descarte y trigger de la variante `'row'` en colores neutros (transparent + border-subtle), nunca rojo ni el verde de WhatsApp — D-16.
- Ícono del chip bloqueado: círculo con línea diagonal, mismo estilo de ícono inline chico que ya usa el resto del archivo.
- El asunto por defecto del overlay de material coincide literal con el fallback del backend cuando llega vacío.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Acceptance criteria desactualizado] `grep -c "data-action=\"call\""` no podía dar 0**
- **Found during:** Task 1, al verificar los acceptance criteria del plan tras implementar `_actButtonsHTML`.
- **Issue:** el plan pedía `grep -c "data-action=\"call\"" public/app.js` = 0 ("no se activó el guard que oculta el botón de llamar"), asumiendo que el literal no existía en el archivo. Verificado con `git stash` que el conteo YA era 4 antes de que este plan tocara nada — son los botones "Llamar ahora" de las alertas flotantes de speed-to-lead / callback vencido (`_showSpeedToLeadAlert`, líneas ~787/888), sin ninguna relación con las filas de Llamadas ni con el guard CSS `.scm-row-blocked [data-action="call"]`.
- **Fix:** se verificó que el diff de este plan no agrega NINGUNA ocurrencia nueva (4 antes → 4 después, confirmado con `git stash`/`git stash pop`), que es la intención real del criterio (no activar el guard en la superficie de Llamadas). El test de fuente nuevo (`tests/act-ui-discard-material.test.js`) verifica correctamente contra el CUERPO extraído de `renderCallsList` (que da 0 ocurrencias reales), no contra el archivo completo.
- **Files modified:** ninguno — es una corrección de interpretación del acceptance criteria documentada, no un cambio de código.
- **Verification:** `git stash && grep -c 'data-action="call"' public/app.js && git stash pop` → 4 antes de cualquier edit; `grep -c` tras completar Task 1 → 4 (sin cambio); `extractFunctionBody` sobre `renderCallsList` → 0 ocurrencias.
- **Committed in:** `adf3e55` (Task 1 commit) — el comportamiento del código en sí no necesitó ningún cambio; el ajuste fue exclusivamente de cómo se verifica el criterio en el test nuevo.

**2. [No es un bug — nota operativa] `npm test` completo tuvo 7 archivos con hook-timeout en la primera corrida, verde en la segunda**
- **Found during:** Task 3, al correr la suite completa por primera vez.
- **Issue:** la primera corrida de `npm test` (102 archivos en paralelo) reportó `7 failed | 95 passed` con `Error: Hook timed out in 20000ms` en los `beforeAll` de `tests/admin-only-setters.test.js`, `tests/asistencia.test.js`, `tests/expensive-tariff.test.js`, `tests/export-data-full.test.js`, `tests/mercury-review.test.js`, `tests/phone-repair.test.js` y `tests/wa-proxy.test.js` — ninguno de los 7 toca `app.js`/`index.js` en las zonas que edita este plan.
- **Fix:** no fue necesario ningún fix de código. Se re-corrieron esos 7 archivos en aislado (`npx vitest run <los 7>`) y dieron **80/80 verdes**, confirmando que era contención de recursos (login+scrypt+boot de Express de ~100 suites compitiendo en paralelo en Windows), consistente con el patrón ya documentado en CLAUDE.md nota #30 ("Windows + supertest + handlers async pueden ser slow"). Se corrió una SEGUNDA vez la suite completa (`npm test`) y dio **1663/1663 en un solo run limpio**, sin ningún archivo en rojo.
- **Files modified:** ninguno.
- **Verification:** corrida aislada de los 7 archivos (80/80) + segunda corrida completa (`npm test`, 102/102 archivos, 1663/1663 tests, exit code 0).
- **Committed in:** N/A — no ameritó cambio de código, solo re-verificación.

---

**Total deviations:** 1 auto-fix de interpretación de acceptance criteria (Rule 1) + 1 nota operativa de flakiness ambiental por contención de recursos (no un bug).
**Impact on plan:** Ninguno afecta el contrato ni el comportamiento documentado en `<interfaces>` del plan. Sin scope creep.

## Verificación por mutación (detalle, pedido explícito del plan)

Comentar (quitar) `!terminal(l) && ` de una de las 2 líneas de filtro de compromisos en `loadHoyView` (`misCompromisos`) y correr `tests/act-ui-discard-material.test.js` + `tests/commitment-hoy.test.js`:

- **Antes de restaurar:** **1 de 44 tests** de `act-ui-discard-material.test.js` se puso en rojo ("las 2 líneas de filtro con `_commitmentHoyBucket` contienen `!terminal(l)`" — `AssertionError: expected '...' to contain '!terminal(l)'`). El resto de la suite (85 tests entre los 2 archivos) siguió verde, como se esperaba (ningún otro test ejercita ese literal).
- Restaurado con `git checkout -- public/app.js`; `git diff public/app.js` confirmado vacío antes de seguir.
- Re-corrida `tests/act-ui-discard-material.test.js` post-restauración: **44/44 verdes**.

## Issues Encountered

None fuera de lo documentado en Deviations.

## User Setup Required

None - no external service configuration required. (`RESEND_API_KEY` en producción sigue siendo opcional para `send-material`: sin ella, la vía `via:'resend'` responde `409` con `mailtoUrl` y el frontend ofrece la vía manual — mismo criterio que el resto del proyecto.)

## Checklist de verificación en vivo (no hay browser en el entorno)

Pendiente de que el user (o un agente con browser) lo confirme en producción/preview:

1. Botón de descartar visible y funcionando en las 4 vistas (lista, Power Dialer, ficha, Hoy), incluida la ficha abierta DESDE Hoy (prueba del z-index).
2. Descartar sin elegir ninguna razón (default "Sin razón específica") — confirma que se completa igual (D-14).
3. Descartar con razón "Pidió NO ser contactado (DNC)" — confirmar que el chip de No-llamar aparece después.
4. Confirmar que el lead desaparece de las 3 colas (Llamadas, Power Dialer, Hoy) tras descartar, con el aviso de destino correcto ("queda en Descartados").
5. Ver un lead descartado con el toggle "ver descartados" (si existe en la UI real, o buscándolo): fila atenuada, chip gris "Descartado", teléfono tachado — nada en rojo.
6. Mandar desde el Power Dialer y confirmar que la tarjeta avanza sola (vía `_pdAdvance`) cuando el lead descartado es la tarjeta actual.
7. Mandar material por email por las dos vías (o confirmar el `409` con el aviso correcto si `RESEND_API_KEY` no está configurada en Railway).
8. Confirmar que un compromiso cerrado por email/WhatsApp muestra "por WhatsApp"/"por email" en el histórico del lead durante una llamada real.

## Next Phase Readiness

- **ACT-01..05 completos.** Fase 32 (ACT — Acciones desde cualquier vista) queda **COMPLETA (4/4 planes)**.
- `_actButtonsHTML(leadId, opts)` queda con 2 botones estables (WhatsApp + Descartar) por builder único — la Fase 33 (Power Dialer como motor único) puede reusarlo sin volver a tocar las 4 superficies.
- `window._actDiscard`/`window._actSendMaterial` siguen el mismo molde (`_leadStoreApply` + `_dispoAnnounce(forceToast)` + `finally` con `_refreshLeadPanels`) que cualquier acción futura del lead puede copiar.
- Sin bloqueantes de código. Sin instalación de paquetes (`git diff package.json package-lock.json` vacío, threat T-32-SC cerrado).
- **Suite completa: 1663/1663**, confirmada en una corrida limpia sin flaky.

---
*Phase: 32-act-acciones*
*Completed: 2026-08-15*

## Self-Check: PASSED

- FOUND: `public/app.js`
- FOUND: `public/index.html`
- FOUND: `tests/act-ui-discard-material.test.js`
- FOUND: `.planning/REQUIREMENTS.md`
- FOUND: `.planning/ROADMAP.md`
- FOUND: `.planning/STATE.md`
- FOUND commit `adf3e55` (Task 1)
- FOUND commit `9bf6503` (Task 2)
- FOUND commit `fda7150` (Task 3)
- FOUND commit `68aa32b` (docs: cierre de fase)

---
phase: 32-act-acciones
verified: 2026-08-15T23:15:00Z
status: human_needed
score: 10/10 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Abrir el botón WhatsApp desde la ficha del lead abierta DESDE Hoy (modal sobre modal) y confirmar que el overlay (#act-wa-overlay, z-index 10060) se ve completo por encima, sin quedar tapado."
    expected: "El overlay de WhatsApp/Descartar/Material se ve completo y clickeable por encima de la ficha de Hoy."
    why_human: "Apilamiento visual de z-index solo se puede confirmar en un browser real; el entorno de verificación no tiene DOM renderizado."
  - test: "Click en 'Abrir WhatsApp' con un lead real y confirmar que window.open() abre wa.me en pestaña nueva con el mensaje precargado, y que si el navegador bloquea el popup aparece el toast con el link para abrir a mano."
    expected: "Pestaña nueva con wa.me/<numero>?text=<mensaje interpolado>; con popup bloqueado, toast con el link."
    why_human: "window.open y el comportamiento del bloqueador de pop-ups dependen del navegador real; no verificable con extracción de código ni con new Function."
  - test: "Cambiar la plantilla en el <select> del overlay de WhatsApp y confirmar que el <textarea> se reescribe con el cuerpo interpolado de la nueva plantilla; togglear el radio 'Otro número' y confirmar que los campos dependientes (input tel, checkbox guardar, input label) se habilitan/deshabilitan."
    expected: "El textarea cambia de contenido al cambiar de plantilla; los campos de 'otro número' están deshabilitados salvo que ese radio esté marcado."
    why_human: "Interacción DOM en vivo (onchange/onclick), no verificable por lectura de código."
  - test: "Descartar un lead desde cada una de las 4 superficies (lista de Llamadas, Power Dialer, ficha, Hoy) y confirmar que desaparece de las 3 colas de una sola vez, con el toast de destino diciendo 'queda en Descartados'."
    expected: "El lead sale de Llamadas, Power Dialer y Hoy inmediatamente tras confirmar el descarte."
    why_human: "Requiere sesión de browser real con datos de producción/preview y navegación entre las 4 vistas; no verificable por extracción estática."
  - test: "Descartar con razón 'Pidió NO ser contactado (DNC)' y confirmar que el chip de No-llamar aparece en la fila/ficha del lead después."
    expected: "Chip rojo/naranja 'No-llamar' visible tras el descarte con esa razón."
    why_human: "Verificación visual de un chip en el DOM tras una mutación real."
  - test: "Ver un lead descartado con el toggle 'ver descartados' activo: fila atenuada (scm-row-blocked), chip gris 'Descartado' (scm-chip-blocked), teléfono tachado (scm-phone) — confirmar que en ningún punto aparece rojo de alarma (D-16)."
    expected: "Toda la comunicación visual es gris/atenuada, nunca roja."
    why_human: "Percepción de color y contraste en un render real del CSS, no verificable leyendo las clases en el código fuente."
  - test: "Mandar material por email por las dos vías ('Mandar por el sistema' y 'Abrir mi cliente de mail') contra un lead con y sin RESEND_API_KEY configurada en el entorno, y confirmar el mensaje 409 con el link mailto cuando no está configurada."
    expected: "Vía resend manda de verdad si hay key; sin key, 409 con aviso claro y el botón mailto sigue funcionando."
    why_human: "Depende de la configuración real de RESEND_API_KEY en Railway/producción y del comportamiento del cliente de correo del sistema operativo."
  - test: "Cerrar una llamada real cuyo compromiso terminó cumplido por WhatsApp o por email y confirmar que el histórico del lead (timeline) muestra 'por WhatsApp' / 'por email' en la línea del compromiso cerrado."
    expected: "La línea del timeline distingue el canal correctamente."
    why_human: "Requiere una llamada real end-to-end con Telnyx y datos de producción para poblar el timeline con un caso real; no ejercitado por los tests de fuente."
---

# Phase 32: ACT — Acciones desde cualquier vista Verification Report

**Phase Goal:** Botón de WhatsApp (con número alternativo) y botón de descartar disponibles en toda vista donde aparece el lead, con el envío registrado como evento del mismo modelo que los compromisos.
**Verified:** 2026-08-15T23:15:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Desde Llamadas, Power Dialer, ficha y Hoy hay un botón de WhatsApp que abre `wa.me` con el mensaje precargado, sin navegar a otra vista | ✓ VERIFIED | `_actButtonsHTML` (public/app.js:6121) tiene 5 ocurrencias (1 declaración + 4 call sites) dentro de `renderCallsList` (8905), `_pdRender` (7093), `_callsRenderExpandedPanel` (8594), `_hoyRenderSection` (6181). `window._actWhatsApp` (7898) hace `POST .../whatsapp-send` → `window.open(d.whatsappUrl, '_blank', 'noopener')`, sin ningún `location.href`/navegación a otra vista. |
| 2 | El mismo click registra el envío como evento y arma el próximo paso (compromiso "yo mandé info, espero respuesta") | ✓ VERIFIED | `POST /api/setters/leads/:id/whatsapp-send` (index.js:10701) llama `_actRegisterSendEvent` (11957) en el MISMO request: push a `lead.interactions` (`action:'material_sent'`) + `_setCommitment(...)` + `_closeCommitment(lead,'cumplido',...)`, que programa `nextAction.esperar_respuesta` a +48h (`COMMITMENT_ENVIAR_INFO_DELTA_MS`). Cubierto por `tests/act-whatsapp.test.js` (tests 5-8, 17 tests, todos verdes). |
| 3 | Puede cargar un número alternativo en el momento y mandarle el WhatsApp a ESE número sin perder la asociación con el lead original | ✓ VERIFIED | El endpoint acepta `phone`/`saveAsAltPhone`/`altPhoneLabel`; persiste en `lead.altPhone`/`lead.altPhoneLabel` (nunca en `lead.phone`, D-10, index.js:10751-10754). El overlay (`window._actWhatsApp`) ofrece radios Principal/Alternativo/Otro número. Tests 11-12 de `act-whatsapp.test.js` verifican `lead.phone` intacto tras usar un alternativo. |
| 4 | Hay un botón de descartar en las mismas 4 vistas; al usarlo, el lead sale de Llamadas, Power Dialer y Hoy de una sola vez | ✓ VERIFIED | `_actButtonsHTML` emite también el botón `Descartar` (o el chip `scm-chip-blocked` si ya está descartado) en las mismas 4 superficies. `POST /api/setters/leads/:id/discard` (index.js:10946) cierra el compromiso pendiente (`'vencido'`) y SIEMPRE llama `_clearNextAction(lead)` (10989-10990). `loadHoyView` suma `!terminal(l)` a sus 2 filtros de compromiso (public/app.js:5990,5992) para que un descarte por CUALQUIER vía saque al lead de Hoy también. `window._actDiscard` llama `_pdAdvance()` cuando el lead descartado es la tarjeta activa del Power Dialer. |
| 5 | El envío de material por email queda registrado con el mismo modelo de evento que el WhatsApp, sin ningún tracking de apertura | ✓ VERIFIED | `POST /api/setters/leads/:id/send-material` (index.js:12826) reusa literal `_actRegisterSendEvent(l, {canal:'email', ...})` (12900) dentro de `mutateSettersData`. El `htmlBody` (12870-12875) no contiene `<img` ni pixel alguno — verificado por grep y por el test 20 de `act-discard-email.test.js` / test 18 de `act-ui-discard-material.test.js`. |

**Score:** 5/5 truths (roadmap) verified — más 5 must-haves adicionales del frontmatter de los 4 planes (ver detalle abajo), todos verificados.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `index.js` — bloque `ACCIONES (Phase 32)` | whitelists + `_actSanitizeMessage` + `_actRegisterSendEvent` | ✓ VERIFIED | Líneas 11909-11999, expuesto en `globalThis.__voiceAgent` (12297-12298) |
| `index.js` — `POST /api/setters/leads/:id/whatsapp-send` | arma `wa.me` + registra | ✓ VERIFIED | Línea 10701, delega en `buildWhatsAppUrl` (10740), síncrono |
| `index.js` — `POST /api/setters/leads/:id/discard` | descarte de 1 lead, cualquier rol | ✓ VERIFIED | Línea 10946, `bulk` (10781) intacto y admin-only |
| `index.js` — `POST /api/setters/leads/:id/send-material` | mismo evento que WhatsApp, 2 vías | ✓ VERIFIED | Línea 12826, dentro de `mutateSettersData` (regla #19) |
| `tests/act-whatsapp.test.js` | cobertura HTTP endpoint WhatsApp | ✓ VERIFIED | 275 líneas, 17 tests, todos verdes |
| `tests/act-discard-email.test.js` | cobertura HTTP descarte + email | ✓ VERIFIED | 311 líneas, 21 tests, todos verdes |
| `public/app.js` — `_actButtonsHTML` + 4 call sites | builder único en las 4 superficies | ✓ VERIFIED | Línea 6121; 5 ocurrencias totales confirmadas por grep |
| `public/app.js` — `window._actWhatsApp` / `_actDiscard` / `_actSendMaterial` | overlays de acción | ✓ VERIFIED | Líneas 7898 / 8037 / 8119 |
| `tests/act-ui-whatsapp.test.js` | bloque puro + paridad + cableado WhatsApp | ✓ VERIFIED | 423 líneas, 38 tests, todos verdes |
| `tests/act-ui-discard-material.test.js` | cableado descarte + material | ✓ VERIFIED | 344 líneas, 44 tests, todos verdes |
| `public/index.html` — cache-buster | `app.js?v=` bumpeado | ✓ VERIFIED | `20260815j` en disco; `style.css?v=20260815f` sin tocar por esta fase |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `POST .../whatsapp-send` | `buildWhatsAppUrl` | armado server-side del `wa.me` | ✓ WIRED | index.js:10740, usa el teléfono RAW (no el normalizado) para no perder la señal de paréntesis US — bug real encontrado y corregido en 32-01 |
| `_actRegisterSendEvent` | `_setCommitment`/`_closeCommitment` | crear-y-cerrar en el mismo acto | ✓ WIRED | index.js:11992-11996 |
| `_actRegisterSendEvent` | `lead.interactions` | entry `material_sent` sin `setterId`, sin tocar `callLog` | ✓ WIRED | index.js:11965-11977, verificado por grep dentro del bloque |
| `POST .../discard` | `_closeCommitment`/`_clearNextAction` | cierre `'vencido'` + apagado del reloj | ✓ WIRED | index.js:10989-10990 |
| `POST .../send-material` | `_actRegisterSendEvent` | mismo modelo de evento, canal `'email'` | ✓ WIRED | index.js:12900, dentro de `mutateSettersData` |
| `POST .../send-material` | `_sendPlaceholderEmail` | envío por Resend, sin `.ics` | ✓ WIRED | index.js:12876; `_sendPlaceholderEmail` (12688) generalizada con `attachments` opcional, único call site de Resend confirmado (`api.resend.com/emails` aparece 1 vez) |
| `renderCallsList`/`_pdRender`/`_callsRenderExpandedPanel`/`_hoyRenderSection` | `_actButtonsHTML` | builder único con variante por superficie | ✓ WIRED | 4 call sites confirmados por número de línea dentro de cada función |
| `window._actWhatsApp` | `POST .../whatsapp-send` | fetch + `window.open` | ✓ WIRED | public/app.js:7995-8004 |
| `window._actWhatsApp` | `_dispoAnnounce` | aviso con `forceToast:true` | ✓ WIRED | public/app.js:8019 |
| `_actButtonsHTML` | `window._actDiscard` | segundo botón del mismo builder | ✓ WIRED | public/app.js:6136,6140,6144,6149 |
| `window._actDiscard` | `POST .../discard` | fetch + `_leadStoreApply` + `_dispoAnnounce(forceToast)` | ✓ WIRED | public/app.js:8078-8096 |
| `loadHoyView` | `terminal(l)` | filtro en las 2 secciones de compromiso | ✓ WIRED | public/app.js:5990,5992 (`!terminal(l)`) |

### Data-Flow Trace (Level 4)

No aplica en sentido estricto: esta fase agrega endpoints de ACCIÓN (mutación) y overlays que escriben, no dashboards que renderizan datos derivados de una fuente. El flujo relevante (`commitment`/`nextAction` del backend → `_dispoAnnounce`/badge de Hoy) ya se verificó en la Phase 30/31 y esta fase lo reusa sin reimplementarlo; los tests de este `VERIFICATION.md` confirman que el dato que viaja en la respuesta HTTP (`commitment`, `nextAction`, `lead`) es el mismo que terminan mostrando `_dispoAnnounce`/`loadHoyView` (no hay datos hardcodeados ni mockeados en el camino de producción).

### Behavioral Spot-Checks

No hay servidor corriendo en este entorno de verificación para curlear en vivo. En su lugar, se corrieron los 4 archivos de test HTTP completos de la fase con `supertest` contra la app real (equivalente funcional a un spot-check):

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Camino feliz WhatsApp (MX/US, registro, alternativo, RBAC) | `npx vitest run tests/act-whatsapp.test.js` | 17/17 verdes | ✓ PASS |
| Descarte + material por email (RBAC, DNC, reloj, Resend/mailto) | `npx vitest run tests/act-discard-email.test.js` | 21/21 verdes | ✓ PASS |
| Cableado UI WhatsApp (4 superficies, plantillas, destino) | `npx vitest run tests/act-ui-whatsapp.test.js` | 38/38 verdes | ✓ PASS |
| Cableado UI descarte + material (4 superficies, marca, Hoy) | `npx vitest run tests/act-ui-discard-material.test.js` | 44/44 verdes | ✓ PASS |
| Suite completa del repo | `npm test` | 1663/1663 verdes (102 archivos) | ✓ PASS |

### Probe Execution

SKIPPED (no hay probes declarados para este proyecto/fase — `scripts/*/tests/probe-*.sh` no existe en el repo).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| ACT-01 | 32-01, 32-03 | Botón de WhatsApp visible desde toda vista, abre `wa.me` con mensaje precargado | ✓ SATISFIED | Endpoint + `_actButtonsHTML` + `window._actWhatsApp`, `[x]` en REQUIREMENTS.md |
| ACT-02 | 32-01, 32-03 | El mismo click registra el envío y crea el próximo paso | ✓ SATISFIED | `_actRegisterSendEvent` compone `_setCommitment`+`_closeCommitment` en un solo request |
| ACT-03 | 32-01, 32-03 | Número alternativo cargado en el momento | ✓ SATISFIED | `phone`/`saveAsAltPhone`/`altPhoneLabel` en el body, persistencia en `lead.altPhone` |
| ACT-04 | 32-02, 32-04 | Botón de descartar desde cualquier vista, saca el lead de todas las listas | ✓ SATISFIED | `POST .../discard` (cualquier rol) + `_actButtonsHTML` + `!terminal(l)` en Hoy |
| ACT-05 | 32-02, 32-04 | Envío de material por email con el mismo modelo de evento, sin tracking | ✓ SATISFIED | `POST .../send-material` reusa `_actRegisterSendEvent`; sin `<img>`/pixel |

Cross-referenciado contra `.planning/REQUIREMENTS.md` líneas 308-322: las 5 requirements de ACT están marcadas `[x]` y mapeadas 1:1 a la Phase 32 en la tabla de trazabilidad (línea 412: `ACT-01, ACT-02, ACT-03, ACT-04, ACT-05 | 32`). **Ningún requirement huérfano**: no hay IDs de ACT-* fuera de esta fase ni IDs adicionales mapeados a Phase 32 en REQUIREMENTS.md que no aparezcan en el `requirements:` frontmatter de los 4 planes.

### Anti-Patterns Found

Ninguno. Búsqueda de `TBD|FIXME|XXX|TODO|HACK|placeholder(sin resolver)|not.*implement` sobre el diff completo de la fase (`git diff 9ecac90^..fda7150 -- index.js public/app.js public/index.html`) no arrojó ningún marcador de deuda real (solo falsos positivos de comentarios explicativos y atributos HTML `placeholder="..."` de inputs, que son UX legítima, no deuda técnica). Ningún test `.skip`/`.todo`. `git diff package.json package-lock.json` vacío (sin instalación de paquetes).

**Nota de contexto (no bloqueante):** el rango de commits `9ecac90..fda7150` incluye además trabajo NO relacionado con esta fase (extracción de doctor / higiene de nombres, commits `5687973`..`404caee`, uno de ellos etiquetado por error `test(32-04)` pero cuyo contenido real es `tests/doctor-extraction.test.js`). Se verificó línea por línea que ese trabajo es ajeno a los artefactos de ACT-01..05 (no toca `_actButtonsHTML`, `_actRegisterSendEvent`, ni los 3 endpoints nuevos) y no afecta esta verificación — mencionado únicamente por transparencia del historial de commits.

### Human Verification Required

Ver la sección `human_verification` del frontmatter para el detalle completo (8 ítems). Resumen: todo lo que depende de renderizado visual real (z-index apilado, popup del navegador, `window.open` abriendo `wa.me`, toggle de campos del formulario, color gris vs rojo del estado bloqueado) y de servicios externos configurados en producción (Resend, una llamada Telnyx real) no puede verificarse por extracción de código en este entorno — el propio `32-04-SUMMARY.md` ya lo documenta como "Checklist de verificación en vivo" pendiente. El código, su cableado y su cobertura de test están completos y verdes; falta la confirmación visual/operativa en un browser real (que puede hacer el user en el próximo login, o un agente con browser).

### Gaps Summary

No hay gaps de código. Las 5 Success Criteria del roadmap y los 5 grupos de must-haves de los 4 planes están verificados contra el código real (no contra lo que dicen los SUMMARY): los 3 endpoints backend, los 2 helpers compartidos, los 3 overlays de frontend, el builder único de 2 botones en las 4 superficies, la rama nueva de destino, el filtro `!terminal(l)` de Hoy, y las 120 pruebas HTTP/fuente específicas de la fase — todo pasa (`npx vitest run` en aislado y `npm test` completo: 1663/1663). El único motivo por el que el status no es `passed` es que quedan 8 comportamientos que requieren un browser real (visual, `window.open`, servicios externos) — evaluados como riesgo bajo dado el nivel de detalle del código y de los tests, pero que el propio proceso de verificación no puede cerrar sin un humano.

---

_Verified: 2026-08-15T23:15:00Z_
_Verifier: Claude (gsd-verifier)_

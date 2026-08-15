---
phase: 32-act-acciones
plan: 02
subsystem: api
tags: [nodejs, express, json-storage, resend, commitment-model]

# Dependency graph
requires:
  - phase: 32-act-acciones
    plan: 01
    provides: "bloque ACCIONES (Phase 32) en index.js: ACT_WA_TEMPLATE_IDS/ACT_SEND_CANALES/ACT_MESSAGE_MAX, _actSanitizeMessage, _actRegisterSendEvent(lead, spec, nowIso) -> {commitment, nextAction, terminal}, expuesto en globalThis.__voiceAgent"
  - phase: 31-comm-compromisos
    provides: "lead.commitment, _setCommitment/_closeCommitment, GATE_TERMINAL_ESTADOS"
provides:
  - "POST /api/setters/leads/:id/discard (requireAuth): descarte de UN lead para cualquier rol, cierra el compromiso pendiente ('vencido') y apaga el reloj via _clearNextAction. POST /leads/bulk sigue admin-only e intacto."
  - "POST /api/setters/leads/:id/send-material (requireAuth): mismo modelo de evento que WhatsApp (_actRegisterSendEvent, canal:'email'), via resend (Resend real) o mailto (solo arma el link, no intenta enviar), sin ningun mecanismo de tracking de apertura"
  - "_sendPlaceholderEmail con adjunto .ics OPCIONAL (solo si icsContent es string no vacio) -- send-placeholder no cambia de comportamiento"
  - "_actEmailHtml(text): escapa &/</>/saltos de linea antes de meter texto del SDR en un email que ve el prospecto"
  - "21 tests HTTP en tests/act-discard-email.test.js"
affects: [32-03-frontend-whatsapp, 32-04-descartar]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Endpoint de UN lead que copia las 2 lineas del case 'discard' del bulk masivo (admin-only, 500 leads, 7 acciones) en vez de aflojar ese endpoint -- el bulk queda intacto, cero regresion en su superficie de RBAC"
    - "_sendPlaceholderEmail generalizada a 'la unica funcion que le habla a la API de Resend en el archivo' armando el payload con una key 'attachments' condicional, en vez de duplicar el fetch para el caso sin adjunto"
    - "Descartar consume el nextAction pendiente por DOS vias distintas segun su origen: _closeCommitment ya lo apaga solo cuando origen==='compromiso' (fuera del alcance de este endpoint); el _clearNextAction propio del endpoint cubre cualquier OTRO origen (manual/cadencia) que quedara colgado sin un compromiso activo"

key-files:
  created:
    - tests/act-discard-email.test.js
  modified:
    - index.js

key-decisions:
  - "El grep-count-exacto-a-1 de 'api.resend.com/emails' que pedia el plan como acceptance criteria no se cumple literal en este codebase: ya habia 2 call sites PRE-EXISTENTES sin relacion (invitaciones e reporte semanal, verificado contra bd8a29e^, antes de que este plan tocara nada) ademas del de _sendPlaceholderEmail -- total 3, no 1. El invariante real que el plan queria proteger (Task 2 no agrega un fetch NUEVO a la API de Resend, reusa el unico existente) SI se cumple: verificado con `git diff | grep '^\\+.*fetch('` vacio."
  - "La verificacion por mutacion del plan asumia que comentar el _clearNextAction(lead) propio del endpoint de descarte pondria en rojo 2 tests (6 y 7). En la practica solo 1 test (7) se puso en rojo -- ver Deviations."

patterns-established:
  - "Cuando un comentario explicativo necesita citar un patron que despues un test de fuente va a excluir por regex/substring (ej. D-18 'sin <img>'), el propio comentario puede disparar el falso positivo si repite el literal -- describir el patron en prosa ('sin ninguna imagen embebida') en vez de citar el token exacto."

requirements-completed: [ACT-04, ACT-05]

# Metrics
duration: ~20min
completed: 2026-08-15
---

# Phase 32 Plan 02: Descarte para cualquier rol + material por email Summary

**`POST /api/setters/leads/:id/discard` (ACT-04, endpoint de un solo lead disponible para cualquier rol, no solo admin) y `POST /api/setters/leads/:id/send-material` (ACT-05, mismo modelo de evento que WhatsApp, sin tracking de apertura) — el bulk masivo de admin y el envío del hold de calendario quedan intactos.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-08-15
- **Tasks:** 3/3
- **Files modified:** 2 (`index.js`, `tests/act-discard-email.test.js` nuevo)

## Accomplishments

- `POST /api/setters/leads/:id/discard`: copia el `case 'discard'` del bulk masivo (`POST /leads/bulk`, que queda `requireRole('admin')` sin ningún cambio) con los 2 guards de dueño/visibilidad ya establecidos por el resto de la fase. Cierra el compromiso pendiente como `'vencido'` (nunca dispara el seguimiento post-envío de +48h que sí dispara `'cumplido'`) y SIEMPRE llama `_clearNextAction(lead)` — la parte que el bulk nunca tuvo y que evita que un lead descartado quede colgado en Hoy → Mis compromisos. Una razón que implica DNC (`no_contactar` o `doNotCall:true` explícito) marca los 4 campos con el nombre del usuario autenticado, nunca del body. Razón fuera de whitelist → 200 con `disqualifyReason: ''` (D-14, nunca 4xx).
- `_sendPlaceholderEmail` gana un adjunto `.ics` OPCIONAL (solo se arma la clave `attachments` cuando llega un `icsContent` no vacío) — sigue siendo el único call site de Resend que este plan toca; `send-placeholder` no cambia de comportamiento.
- `_actEmailHtml(text)`: escapa `&`/`<`/`>` y convierte saltos de línea en `<br>` — el texto lo tipea el SDR y termina dentro de un HTML que abre el prospecto.
- `POST /api/setters/leads/:id/send-material`: mismo modelo de evento que WhatsApp (reusa `_actRegisterSendEvent` de 32-01 con `canal:'email'`), dos vías — `resend` (envía de verdad, corta con 409 si `RESEND_API_KEY` no está configurada, o con 502 si Resend responde error, en ambos casos SIN registrar nada) y `mailto` (nunca intenta enviar, solo arma el link, honesto igual que WhatsApp: "abrí el mail para mandar X", no "lo recibió"). Cero tracking de apertura (D-18): sin `<img>`, sin pixel, sin webhook.
- 21 tests HTTP en `tests/act-discard-email.test.js`: camino feliz de descarte (sin razón / con razón / con DNC explícito o implícito / razón basura), cierre del compromiso pendiente con el reloj apagado, preservación del `callLog`, exclusión de la cola `sin-wsp` tras DNC, RBAC (403 de setter ajeno, 401 sin cookie, 404 inexistente, y la regresión explícita de que el bulk sigue admin-only), y las dos vías de `send-material` (resend con éxito/sin key configurada, mailto, validaciones de email/mensaje vacío, anti-marca en el asunto, y una aserción de fuente que confirma que el bloque del endpoint no contiene `<img` ni la palabra `pixel`).
- Verificación por mutación (ver Deviations): comentar `_clearNextAction(lead)` en el endpoint de descarte puso en rojo **1 de 21 tests**, no los 2 que el plan anticipaba.
- Suite completa del repo: **1550/1550** (baseline 1529 + 21 nuevos).

## Task Commits

Each task was committed atomically:

1. **Task 1: POST /api/setters/leads/:id/discard (ACT-04, D-12..D-16)** - `bd8a29e` (feat)
2. **Task 2: Material por email — adjunto opcional + POST .../send-material (ACT-05, D-17/D-18)** - `8084071` (feat)
3. **Task 3: Suite HTTP del descarte y del material por email** - `e171777` (test, incluye un fix menor de comentario — ver Deviations)

## Files Created/Modified

- `index.js` — `POST /api/setters/leads/:id/discard` inmediatamente después de `POST .../reactivate` y antes de `PUT .../precall-note`; `_sendPlaceholderEmail` con adjunto opcional; `_actEmailHtml` en el bloque `ACCIONES (Phase 32)`, expuesto en `globalThis.__voiceAgent`; `POST /api/setters/leads/:id/send-material` inmediatamente después de `POST .../send-placeholder`.
- `tests/act-discard-email.test.js` (nuevo) — 21 tests HTTP sobre `request(app)`, fixture de 2 setters + 1 admin y leads de teléfono `+521...` (≥7 dígitos, regla #163). `RESEND_API_KEY = ''` (regla #121, nunca `delete`).

## Decisions Made

- **El grep-count-1 de `api.resend.com/emails` no se cumple literal en este codebase**: ya había 2 call sites pre-existentes sin relación (invitaciones y reporte semanal — verificado contra `bd8a29e^`, el commit inmediatamente anterior a que este plan tocara `index.js`) además del de `_sendPlaceholderEmail`, total 3. El invariante REAL que el acceptance criteria quería proteger — que Task 2 no agregue un segundo `fetch` a la API de Resend, sino que reuse el único que ya existía para `send-placeholder` — se cumple y se verificó con `git diff | grep '^\+.*fetch('` (vacío, ningún `fetch(` nuevo en el diff de la Task 2).
- **`send-material` acepta `templateId` sin validarlo contra `ACT_WA_TEMPLATE_IDS`**: se pasa tal cual a `_actRegisterSendEvent`, que YA hace el whitelist-and-coerce internamente (mismo comportamiento que el endpoint de WhatsApp de 32-01) — no hacía falta duplicar esa validación en el nuevo endpoint.
- **El fixture del test 7 necesitó un `nextAction` manual pre-existente** (no derivado de un compromiso) para ejercitar de verdad la línea `_clearNextAction(lead)` propia del endpoint de descarte — ver Deviations para el porqué completo.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Comentario con el literal `<img` disparaba su propia aserción de fuente (D-18)**
- **Found during:** Task 3 (test 20, aserción de fuente sobre el bloque de `send-material`)
- **Issue:** el comentario que documentaba "sin ningún `<img>`" dentro del cuerpo del endpoint contenía LITERALMENTE la substring `<img`, y una segunda versión corregida contenía la palabra "pixel" — ambos disparaban en falso el propio test que buscaba confirmar la ausencia de tracking de apertura.
- **Fix:** reescrito en prosa sin los tokens exactos ("Cero imágenes/beacons embebidos... no se mide si el prospecto abrió el mail").
- **Files modified:** `index.js` (comentario dentro de `POST .../send-material`)
- **Verification:** `node -e` que aísla el bloque del endpoint y confirma `block.includes('<img') === false` y `block.toLowerCase().includes('pixel') === false`; test 20 en verde.
- **Committed in:** `e171777` (Task 3 commit)

**2. [Rule 1 - Bug de test] El fixture del test 7 no ejercitaba la línea que el mutation test debía probar**
- **Found during:** Task 3, verificación por mutación obligatoria del plan
- **Issue:** el plan predecía que comentar `_clearNextAction(lead)` en el endpoint de descarte pondría en rojo los tests 6 y 7. Al correr la mutación, solo el test 7 se puso en rojo. Causa: `_closeCommitment` (Phase 31) YA apaga el reloj por su cuenta cuando el `nextAction` vigente tiene `origen==='compromiso'` — que es EXACTAMENTE el caso del test 6 (el compromiso se crea vía `PATCH .../commitment`, que setea `nextAction.origen='compromiso'`). El `_clearNextAction(lead)` propio del endpoint de descarte es entonces redundante para ese camino específico; solo importa para un lead que tiene un `nextAction` de OTRO origen (manual/cadencia) sin compromiso activo — el fixture original del test 7 (`lead(7)`, sin ningún `nextAction` previo) tampoco cubría ese caso, porque `ensureLeadDefaults` deja `nextAction: null` por defecto y comentar la línea no cambiaba nada observable.
- **Fix:** se le agregó al fixture de `l_discard_nocommitment` un `nextAction` manual pre-existente (`origen:'manual'`, sin compromiso asociado) más su `callbackAt` espejo, y el test 7 ahora verifica primero que ese `nextAction` esté presente (setup real) y después que el descarte lo apague. Con este fixture, la mutación SÍ pone el test 7 en rojo — confirma que la línea prueba lo que dice probar.
- **Files modified:** `tests/act-discard-email.test.js` (fixture de `l_discard_nocommitment` + aserciones del test 7)
- **Verification:** re-corrida la mutación después del fix del fixture: exactamente 1/21 test rojo (el 7). Restaurado `_clearNextAction(lead);` con `Edit` (no `sed`); `git diff index.js` tras la restauración solo muestra el fix de comentario del punto 1 arriba (verificado línea por línea, sin residuo de la mutación).
- **Committed in:** `e171777` (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (2 bugs — Rule 1, ambos descubiertos escribiendo/verificando la Task 3)
**Impact on plan:** Ninguno afecta el contrato HTTP documentado en `<interfaces>` del plan ni el comportamiento de los endpoints — son un ajuste de comentario (para que la propia documentación no rompiera su test de fuente) y un ajuste de fixture de test (para que la verificación por mutación probara lo que realmente dice probar). Sin scope creep.

## Verificación por mutación (detalle, pedido explícito del plan)

Comentar `_clearNextAction(lead);` en `POST .../discard` y correr `tests/act-discard-email.test.js`:

- **Antes del fix del fixture (fixture original del plan):** 21/21 tests verdes — la mutación NO se detectaba, porque ni el test 6 (el `_closeCommitment` interno ya cubre el caso `origen==='compromiso'`) ni el test 7 (fixture sin `nextAction` previo, nada que limpiar) ejercitaban la línea.
- **Después de agregarle a `l_discard_nocommitment` un `nextAction` manual pre-existente:** **1/21 test rojo** (el 7 — `expected false to be true` sobre `lead.nextAction == null`). El test 6 se mantiene verde porque su reloj lo apaga `_closeCommitment`, no la línea mutada.
- Restaurado con `Edit` (no `sed`); `git diff index.js` tras restaurar solo contiene el fix de comentario documentado arriba (Deviation 1), sin ningún residuo de la mutación.

## Issues Encountered

None fuera de lo documentado en Deviations.

## User Setup Required

None - no external service configuration required. (`RESEND_API_KEY` en producción es opcional: sin ella, `send-material` con `via:'resend'` responde 409 con `mailtoUrl` para que el frontend ofrezca la salida manual — mismo criterio que el resto del proyecto, ver CLAUDE.md nota #119 y la sección Resend de `send-placeholder`.)

## Next Phase Readiness

- **Contrato HTTP exacto para 32-04 (frontend de descartar) y 32-03 (frontend de WhatsApp/email)**, confirmado en código y coincide con el `<interfaces>` del plan:
  - `POST /api/setters/leads/:id/discard` (auth: `requireAuth`). Body: `reason?` (whitelist `DISQUALIFY_REASONS`, cualquier otro valor → `''`, nunca bloquea), `doNotCall?` boolean. `200 { ok:true, lead, commitmentClosed, doNotCall }`. `403`/`404` iguales al resto de endpoints de lead único.
  - `POST /api/setters/leads/:id/send-material` (auth: `requireAuth`). Body: `via?` ('resend'|'mailto', default 'resend'), `email?` (default `lead.email`), `subject?` (cap 140, anti-marca), `message?` (cap 900, anti-marca, obligatorio no-vacío), `templateId?`. `200 { ok:true, sent, via, sentTo, mailtoUrl, commitment, nextAction, lead }`. `400` (email/mensaje inválido), `409` (`resendUnavailable:true` + `mailtoUrl`), `502` (Resend falló), `403`/`404` iguales al resto.
- `POST /api/setters/leads/bulk` (admin, acción `discard`) queda **exactamente como estaba** — ninguna línea tocada dentro de su rango, verificado por diff y por el test 12 (regresión explícita).
- `_actEmailHtml` queda expuesto en `globalThis.__voiceAgent` junto a `_actSanitizeMessage`/`_actRegisterSendEvent` de 32-01, disponible para cualquier plan futuro que necesite escapar texto de cliente en un email.
- Sin bloqueantes. `public/` no fue tocado por este plan — cero bump de cache-buster, tal como pedía el objective.

---
*Phase: 32-act-acciones*
*Completed: 2026-08-15*

## Self-Check: PASSED

- FOUND: `tests/act-discard-email.test.js`
- FOUND commit `bd8a29e` (Task 1)
- FOUND commit `8084071` (Task 2)
- FOUND commit `e171777` (Task 3)

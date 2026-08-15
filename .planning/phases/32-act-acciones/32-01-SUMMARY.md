---
phase: 32-act-acciones
plan: 01
subsystem: api
tags: [nodejs, express, json-storage, whatsapp, commitment-model]

# Dependency graph
requires:
  - phase: 31-comm-compromisos
    provides: "lead.commitment, COMMITMENT_TIPOS/PARTES/ESTADOS/CIERRES, _sanitizeCommitment/_setCommitment/_closeCommitment, GATE_TERMINAL_ESTADOS, expuestos en globalThis.__voiceAgent"
provides:
  - "bloque ACCIONES (Phase 32) en index.js: ACT_WA_TEMPLATE_IDS/ACT_SEND_CANALES/ACT_MESSAGE_MAX, _actSanitizeMessage, _actRegisterSendEvent(lead, spec, nowIso) -> {commitment, nextAction, terminal}"
  - "POST /api/setters/leads/:id/whatsapp-send (requireAuth): arma el wa.me server-side reusando buildWhatsAppUrl y registra el envio en el mismo request"
  - "17 tests HTTP en tests/act-whatsapp.test.js"
affects: [32-02-material-email, 32-03-frontend-whatsapp, 32-04-descartar]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Registro compartido (_actRegisterSendEvent) que compone _setCommitment+_closeCommitment de la Phase 31 en el mismo acto (crear-y-cerrar), en vez de dos llamadas separadas"
    - "buildWhatsAppUrl recibe el telefono RAW del cliente (o lead.phone), NUNCA un valor pre-normalizado a E.164 -- la normalizacion de validacion y la URL son caminos separados a proposito"
    - "Entry de auditoria en lead.interactions sin la clave setterId y sin tocar callLog, para no distorsionar _perfAggregate (embudo legacy) ni _ccCollectCalls (funnel de cold-calling)"

key-files:
  created:
    - tests/act-whatsapp.test.js
  modified:
    - index.js

key-decisions:
  - "buildWhatsAppUrl(rawTo || lead.phone, ...) en vez de buildWhatsAppUrl(sentTo, ...): pre-normalizar el telefono a E.164 antes de pasarlo borra la senial de parentesis que buildWhatsAppUrl usa para detectar el formato US -- bug real encontrado escribiendo los tests, documentado como Rule 1 abajo"
  - "_actRegisterSendEvent no devuelve templateId en su shape ({commitment, nextAction, terminal}) -- el endpoint calcula el templateId saneado en su propia linea (mismo Set.has que usa el helper) para no tocar el contrato ya committeado de Task 1"
  - "Comentarios de la entry de auditoria evitan los literales 'setterId'/'callLog' (describen el motivo en prosa) para que los greps de conteo del plan (que exigen que esos conteos no se muevan) pasen sin perder la documentacion del por que"

patterns-established:
  - "Un endpoint de 'mandar y registrar' compone helpers existentes (buildWhatsAppUrl + _setCommitment/_closeCommitment) en vez de reimplementar logica -- mismo criterio de 32-PATTERNS.md para el endpoint de material por email (32-02)"

requirements-completed: [ACT-01, ACT-02, ACT-03]

# Metrics
duration: ~25min
completed: 2026-08-15
---

# Phase 32 Plan 01: Backend de "mandar WhatsApp" (ACT-01/02/03) Summary

**Endpoint `POST /api/setters/leads/:id/whatsapp-send` que arma el `wa.me` reusando `buildWhatsAppUrl` tal cual y, en el mismo request, deja el envío registrado como compromiso `enviar_info` ya cumplido (Phase 31), programando el seguimiento a +48h — con soporte de número alternativo que nunca pisa `lead.phone`.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-08-15
- **Tasks:** 3/3
- **Files modified:** 2 (`index.js`, `tests/act-whatsapp.test.js` nuevo)

## Accomplishments

- Bloque `ACCIONES (Phase 32)` en `index.js` (entre `_closeCommitment` y `_applyCallOutcome`): whitelists `ACT_WA_TEMPLATE_IDS` (3 plantillas D-06), `ACT_SEND_CANALES`, `ACT_MESSAGE_MAX`, `_actSanitizeMessage` (anti-marca + tope) y `_actRegisterSendEvent` — el registro COMPARTIDO por WhatsApp (este plan) y email (32-02) que compone `_setCommitment`+`_closeCommitment` en el mismo acto.
- `POST /api/setters/leads/:id/whatsapp-send`: un solo request devuelve el `wa.me` listo Y deja el compromiso `enviar_info`/`yo`/`whatsapp` cumplido, con `nextAction.esperar_respuesta` a +48h. Soporta número alternativo cargado en el momento (ACT-03), con persistencia opcional en `lead.altPhone` sin tocar jamás `lead.phone` (D-10). Si no se puede armar un link confiable, corta con 400 ANTES de registrar nada (D-04).
- **Bug real encontrado y arreglado durante la Task 3** (ver Deviations): la URL se arma con el teléfono RAW del cliente (o `lead.phone`), no con la versión normalizada a E.164 — de lo contrario el caso histórico "US con paréntesis" que `buildWhatsAppUrl` resuelve dejaba de detectarse.
- 17 tests HTTP en `tests/act-whatsapp.test.js`: camino feliz México/US, rechazos sin registrar nada, el ciclo completo del compromiso, la entry de auditoría sin `setterId`/sin tocar `callLog`, `templateId` fuera de whitelist (200, nunca 4xx), envío sobre lead terminal, número alternativo con/sin persistencia, anti-marca, tope de mensaje, y RBAC (403/401/404).
- Verificación por mutación: comentar la llamada a `_closeCommitment` dentro de `_actRegisterSendEvent` puso en rojo **exactamente 2 de 17 tests** (los que verifican el cierre del compromiso — items 5 y 6), confirmando que la suite prueba lo que dice probar. Restaurado con el tool `Edit` (no `sed`), `git diff index.js` confirmado vacío antes de continuar.
- Suite completa del repo: **1529/1529** (baseline 1512 + 17 nuevos).

## Task Commits

Each task was committed atomically:

1. **Task 1: Bloque ACCIONES (Phase 32) — whitelists y _actRegisterSendEvent** - `9ecac90` (feat)
2. **Task 2: POST /api/setters/leads/:id/whatsapp-send (ACT-01/02/03)** - `903d2d4` (feat)
3. **[Rule 1] Fix: buildWhatsAppUrl recibe el teléfono RAW, no el normalizado** - `1f5a7dc` (fix)
4. **Task 3: Suite HTTP del envío por WhatsApp** - `587a218` (test)

## Files Created/Modified

- `index.js` — bloque `ACCIONES (Phase 32)` nuevo (whitelists + `_actSanitizeMessage` + `_actRegisterSendEvent`, expuesto en `globalThis.__voiceAgent`); endpoint `POST /api/setters/leads/:id/whatsapp-send` inmediatamente después de `PATCH .../commitment` y antes del bloque de bulk operations.
- `tests/act-whatsapp.test.js` (nuevo) — 17 tests HTTP sobre `request(app)`, fixture de 2 setters + 1 admin y leads de teléfono `+521...` (≥7 dígitos, regla #163).

## Decisions Made

- **`buildWhatsAppUrl(rawTo || lead.phone, ...)` en vez de `buildWhatsAppUrl(sentTo, ...)`** (el literal que describía el `<action>` del plan): pre-normalizar el teléfono a E.164 (`+3055551234`) ANTES de pasarlo a `buildWhatsAppUrl` borra la señal de paréntesis (`(305) 555-1234`) que esa función usa para su detección histórica de formato US — el resultado sin el fix era una URL sin el prefijo de país (`wa.me/3055551234` en vez de `wa.me/13055551234`). `sentTo` (E.164, normalizado) se sigue usando para persistencia (`lead.altPhone`) y para el campo `sentTo` de la respuesta; `buildWhatsAppUrl` recibe el string RAW del cliente (o `lead.phone` si no hubo override). Ver "Deviations" abajo.
- **`_actRegisterSendEvent` no devuelve `templateId`**: mantiene el shape `{commitment, nextAction, terminal}` documentado en el `<interfaces>` del plan (ya cubierto por los tests puros que Task 1 dejó listos para el resto de la fase). El endpoint calcula `sentTemplateId` con el mismo `ACT_WA_TEMPLATE_IDS.has(...)` en su propia línea — un `Set.has` de una línea no amerita romper un contrato recién comprometido.
- **Los comentarios de la entry de auditoría no usan los literales `setterId`/`callLog`** (dicen "el identificador de vendedor que usa el agregador de rendimiento" / "el historial de llamadas del lead" en su lugar): el plan pide EXPLÍCITAMENTE un comentario que documente esas dos razones (`<action>` de Task 1) pero el acceptance criteria pide que un grep de esos literales dentro del bloque devuelva cero resultados. Se resolvió el conflicto conservando la documentación (obligatoria por el propio `<action>` y por la cultura de "por qué" del proyecto) sin usar los tokens exactos — el grep del acceptance criteria pasa limpio y la razón queda igual de clara para el próximo lector.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `buildWhatsAppUrl` recibía el teléfono normalizado en vez del RAW**
- **Found during:** Task 3 (escribiendo el test del formato US con paréntesis)
- **Issue:** la Task 2, tal como estaba escrita en el `<action>` del plan, pasaba `sentTo` (el teléfono ya normalizado a E.164 con `+` al frente) a `buildWhatsAppUrl`. Esto reintroduce el bug histórico que `buildWhatsAppUrl` existe para evitar: su detección de formato US (`(305) 555-1234` → `wa.me/1305...`) depende de un regex sobre los paréntesis LITERALES del string original — un valor ya normalizado a `+3055551234` no matchea ese regex, y el número perdía el prefijo de país en la URL resultante.
- **Fix:** la URL se arma con `buildWhatsAppUrl(rawTo || lead.phone, lead.country, cleanMessage)` — el string RAW que mandó el cliente (o `lead.phone` sin tocar si no hubo override) — mientras que `sentTo` (E.164, validado/normalizado) queda reservado para persistencia (`lead.altPhone`) y para el campo `sentTo` de la respuesta HTTP.
- **Files modified:** `index.js` (líneas del endpoint `POST /whatsapp-send`, Task 2)
- **Verification:** smoke test manual con supertest ANTES de escribir la suite formal (confirmó `wa.me/521...` para México y `wa.me/1305...` para el caso US-con-paréntesis); luego cubierto por los tests 1 y 2 de `tests/act-whatsapp.test.js`.
- **Committed in:** `1f5a7dc` (commit `fix` separado, entre Task 2 y Task 3 — el bug se descubrió escribiendo los tests de Task 3 pero afectaba código ya commiteado en Task 2)

---

**Total deviations:** 1 auto-fixed (1 bug — Rule 1)
**Impact on plan:** Corrige exactamente el escenario que el `32-PATTERNS.md` advertía prevenir ("duplicar la lógica de teléfono en el frontend reintroduciría esos bugs históricos") — el mismo riesgo aplicaba del lado backend si se le entrega a `buildWhatsAppUrl` un valor ya transformado. Sin scope creep: el fix es una línea de código + comentario explicativo, no cambia el contrato HTTP documentado.

## Issues Encountered

None fuera de lo documentado en Deviations.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **Contrato HTTP exacto para 32-02/32-03** (confirmado en código, coincide con el `<interfaces>` del plan salvo el ajuste de `templateId` documentado arriba):
  - `POST /api/setters/leads/:id/whatsapp-send` (auth: `requireAuth`).
  - Body: `templateId?`, `message?`, `phone?`, `saveAsAltPhone?`, `altPhoneLabel?` — todos opcionales, whitelist-and-coerce, nunca 400 por un `templateId` desconocido.
  - `200 { ok:true, whatsappUrl, sentTo, templateId, commitment, nextAction, lead:{id, ...lead} }`.
  - `400 { error }` — teléfono con formato inválido, o no se pudo armar un `wa.me` confiable (no registra nada).
  - `403 { error }` — setter que no es dueño / lead fuera de visibilidad. `404 { error }` — lead inexistente.
- **`_actRegisterSendEvent(lead, spec, nowIso)`** queda expuesto en `globalThis.__voiceAgent` junto con `_actSanitizeMessage`, `ACT_WA_TEMPLATE_IDS`, `ACT_SEND_CANALES` — **32-02 (material por email) reusa `_actRegisterSendEvent` literal** pasando `spec.canal:'email'`, sin tocar el helper.
- **32-03 (frontend)** puede llamar a este endpoint directo y hacer `window.open(whatsappUrl, '_blank')` con la respuesta — el `templateId` que ve el frontend en la respuesta es el saneado (nunca el crudo del body), útil para el toast de confirmación.
- Sin bloqueantes. `public/` no fue tocado por este plan — cero bump de cache-buster, tal como pedía el objective.

---
*Phase: 32-act-acciones*
*Completed: 2026-08-15*

## Self-Check: PASSED

- FOUND: `tests/act-whatsapp.test.js`
- FOUND: `.planning/phases/32-act-acciones/32-01-SUMMARY.md`
- FOUND commit `9ecac90` (Task 1)
- FOUND commit `903d2d4` (Task 2)
- FOUND commit `1f5a7dc` (Rule 1 fix)
- FOUND commit `587a218` (Task 3)

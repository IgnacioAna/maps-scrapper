# Phase setter-automations-followups — VERIFICATION

**Fecha:** 2026-05-22
**Status:** ✅ PASS — deployado a Railway.

## Tests

| Test file | Resultado |
|---|---|
| `tests/wa.test.js` | ✅ 64/64 verde |
| `tests/hardening.test.js` | ✅ 70/70 verde |

Las pre-existentes failures de faqs/onboarding test (no relacionadas) siguen igual.

## Endpoints nuevos (live test pending)

| Endpoint | Verb | Auth |
|---|---|---|
| `/api/scheduled-messages` | POST | setter/admin (setter solo sus leads) |
| `/api/scheduled-messages` | GET | setter solo sus / admin todos |
| `/api/scheduled-messages/:id` | PATCH | dueño o admin (solo pending) |
| `/api/scheduled-messages/:id` | DELETE | dueño o admin (solo pending) |
| `/api/scheduled-messages/upcoming` | GET | solo cuenta del setter |

## Cambios server-side

- ✅ `index.js`: helpers store + tick scheduler (cada 60s) + 5 endpoints REST
- ✅ `src/wa/gateway.js`: nuevo `exposeGlobals()` que pone `globalThis.__waGateway = {sendToUser, isUserConnected, getPresenceList}`
- ✅ `src/wa/index.js`: `mountWa` llama a `exposeGlobals()` al boot

## Cambios frontend

- ✅ `index.html`:
  - Sección "📅 Programar mensaje" en `lead-modal` (datetime picker, textarea, presets, toggle cancelOnReply)
  - Vista nueva `view-scheduled` con tabs pendientes/enviados/fallidos/cancelados/expirados
  - Item nuevo en sidebar "📅 Mis programados" con badge
- ✅ `app.js`:
  - `_loadScheduledForLead()` lista programados del lead en el modal
  - `_loadScheduled()` lista global con tabs
  - `_cancelScheduled()` cancela un pending
  - `_updateScheduledBadge()` actualiza badge sidebar cada 60s
  - Presets +24h/+48h/+72h/+7d/+15d cargan el datetime picker

## Cómo funciona end-to-end

1. **Setter abre modal del lead** → ve nueva sección "📅 Programar mensaje"
2. Elige fecha/hora (o aprieta preset) + escribe mensaje (precargado con openMessage)
3. Apreta "Programar" → POST → entry en `data/scheduled_messages.json`
4. **Server tick cada 60s** → busca pendientes vencidos
5. Por cada uno:
   - Si lead respondió Y `cancelOnReply=true` → `cancelled`
   - Si setter NO online (chequea presencia + wa gateway) → reagenda +5min, attempt++
   - Si attempt >= 288 (24h de retries) → `expired`
   - Si online → emit `followup:send-message` a wa-multi del setter → `sent`
6. **Pendiente cliente desktop:** wa-multi necesita handler `followup:send-message`
   (mismo flow que `warming:send-message` que ya tiene). Mientras tanto el server
   marca `sent` pero el mensaje NO sale por WhatsApp real.

## Verificación manual pendiente (Ignacio)

1. [ ] Hard refresh (Ctrl+Shift+R)
2. [ ] Sidebar muestra item "📅 Mis programados"
3. [ ] Abrir modal de un lead → ver sección nueva "📅 Programar mensaje"
4. [ ] Programar uno para +5min, ver que aparece en "Mis programados" como pendiente
5. [ ] Esperar el horario, refrescar — debería estar en "sent" (pero NO llega por WhatsApp hasta que wa-multi tenga handler)
6. [ ] Cancelar uno pendiente → cambia a cancelled
7. [ ] Próximo: agregar handler `followup:send-message` al wa-multi desktop client

## Out of scope (ya documentados en PLAN.md)

- Plantillas reusables
- Sugerencia IA Mercury para mensaje
- Stats de efectividad
- Recurrencia (todos los lunes)
- Email/push de fallos

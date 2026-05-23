# Phase setter-automations-followups — PLAN

**Fecha:** 2026-05-22
**Owner:** Ignacio (decisión arquitectura) + Claude (build)
**Goal:** Setter carga "mañana 10am mandar este mensaje a este lead" desde el CRM,
y el sistema lo despacha automáticamente a esa hora via wa-multi del setter.

## Decisión arquitectónica (user-confirmed)

**Mecanismo:** wa-multi en PC del setter (Opción C / la actual del warming).
- Setter tiene que tener PC prendida con wa-multi abierto a la hora programada
- Beneficio: setter usa más la app → onboarding al warming network es natural
- Si PC offline al momento: el scheduler reagenda +5min y reintenta hasta 24h
- Después se notifica al setter ("3 mensajes no se mandaron, tu PC estaba apagada")

## Scope (qué SÍ se hace)

### Backend (`index.js` + `src/wa/gateway.js`)

1. **Storage:** `data/scheduled_messages.json` con shape:
   ```js
   {
     scheduledMessages: [{
       id: 'sched_xxx',
       leadId, setterId, setterPhoneId,
       scheduledFor: ISO,           // cuándo debe mandarse
       message: string,             // texto del WhatsApp
       status: 'pending' | 'sent' | 'failed' | 'cancelled' | 'expired',
       attempts: number,            // cuántas veces se intentó
       createdAt, createdBy,
       sentAt?, failureReason?,
       cancelOnReply: boolean,      // auto-cancela si lead responde
       staggerOffsetMs: number,     // +random 0-5min para evitar bursts
       templateUsed?: string        // 'preset_24h' | 'preset_15d' | 'custom'
     }]
   }
   ```

2. **Scheduler tick:** `setInterval(60s)` busca pendientes con
   `scheduledFor + staggerOffsetMs <= now`. Para cada uno:
   - Si lead.respondio=true Y cancelOnReply → marca `cancelled` con razón
   - Si setter NO está online (chequea `onlinePresence` + `isWaUserConnected`) →
     reagenda +5min, increment `attempts`. Si attempts>=288 (24h*60/5) → marca `expired`
   - Si online → `sendToUser(setterId, 'followup:send-message', payload)` →
     marca `sent` con `sentAt`
   - Log evento en `wa_events.json` para audit

3. **Endpoints REST:**
   - `POST /api/scheduled-messages` body `{leadId, scheduledFor, message,
     setterPhoneId?, cancelOnReply?}` — crea
   - `GET /api/scheduled-messages` — lista (setter: solo suyos, admin: todos)
     filtros: `?status=`, `?leadId=`, `?from=&to=`
   - `PATCH /api/scheduled-messages/:id` — edita (solo si status=pending)
   - `DELETE /api/scheduled-messages/:id` — cancela (solo si pending)
   - `GET /api/scheduled-messages/upcoming` — próximas 24h del setter (para badge)

### Frontend (`public/app.js` + `index.html`)

1. **Tab nueva en modal de lead:** "📅 Programar mensaje"
   - Date/time picker (default: ahora + 24h, hora 10am)
   - Textarea para mensaje (con sugerencia del openMessage actual si está vacío)
   - Presets: botones "+24h" "+48h" "+72h" "+7d" "+15d" que setean el datetime
   - Selector de cuenta WA del setter (si tiene varias)
   - Toggle "Cancelar auto si lead responde antes" (default ON)
   - Botón "📅 Programar" → POST → toast confirmación

2. **Vista nueva sidebar (`view-scheduled`):** "📅 Mis programados"
   - Tabs: Pendientes | Enviados | Fallidos | Cancelados
   - Tabla: fecha programada · lead · setter · mensaje (truncated) · estado · acciones
   - Acciones: Editar (si pending) · Cancelar · Reprogramar (si failed)
   - Badge en sidebar con count de "Pendientes próximas 24h"
   - Admin tab adicional: "Todo el equipo"

### Wa-multi integration (server-side emit)

- Cuando llega la hora, server emite via Socket.io `followup:send-message`
  con payload `{accountId, targetPhone, text, scheduledMsgId}`
- El wa-multi YA tiene infraestructura para `warming:send-message` — el
  handler de `followup:send-message` es esencialmente el mismo flow (reusa
  el send OS-level estable). Solo cambia el evento name + audit log
- **Pendiente vos (Ignacio):** agregar handler en wa-multi cuando puedas.
  Mientras tanto el server emite igual y queda como "fail silent" — los
  mensajes se marcan como sent pero no salen por WhatsApp. Cuando agregues
  el handler arrancan a salir solos.

## Out of scope (NO ahora)

- Plantillas reusables (P2): por ahora cada setter escribe su mensaje cada vez
- Sugerencia IA (P3): después agregamos botón "✨ Generar con Mercury"
- Stats de efectividad: métricas tipo "% respuesta de mensajes programados"
- Recurrencia (todos los lunes): por ahora cada mensaje es one-shot
- Email/push notifications al setter de mensajes fallidos

## Riesgos

1. **Wa-multi no tiene handler todavía** → mensajes marcan sent pero no salen.
   Mitigación: log clarísimo + métrica "sent_but_unconfirmed" para detectar
2. **Volumen → baneo** → stagger automático ±5min
3. **Lead cambió phone** entre programación y envío → wa-multi recibe pero
   manda a número viejo. Mitigación: refresh phone al ejecutar
4. **Setter elimina lead** → mensaje queda huérfano. Mitigación: cancelar
   automáticamente todos los scheduled del lead al borrarlo

## Verificación

- [ ] Tests unitarios de scheduler (overdue detection, stagger, cancelOnReply)
- [ ] Endpoint POST crea con shape correcto + idempotencia básica
- [ ] Endpoint GET filtra por status y por setter
- [ ] Tick del scheduler en `setInterval` no se duplica (lock interno)
- [ ] Frontend renderiza tab nueva sin romper modal existente
- [ ] Vista "Mis programados" responde a cancelar/editar
- [ ] Smoke live: crear scheduled +30seg, ver que el server lo procesa al llegar

## Plan de ejecución (orden)

1. Backend store + helpers
2. Backend scheduler tick (sin emit todavía, solo loguea)
3. Backend endpoints REST
4. Backend emit via `sendToUser` (reuso wa gateway)
5. Frontend tab modal + endpoints
6. Frontend vista "Mis programados"
7. Tests + cache-buster + push

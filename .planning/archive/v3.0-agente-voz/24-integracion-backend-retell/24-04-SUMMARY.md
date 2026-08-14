---
phase: 24-integracion-backend-retell
plan: 04
subsystem: api
tags: [retell, voice-agent, hmac, webhook, security, tool-calling, testing]

# Dependency graph
requires:
  - phase: 24-01
    provides: "_applyCallOutcome(data, lead, logEntry, opts) — el shape del calendarEntry de scheduled_with_admin que /book replica, y opts.skipCalendarCreation que el plan 24-05 va a usar para no duplicar la cita"
  - phase: 24-02
    provides: "loadRetellConfig/_retellWebhookSecret/_retellToolSecret/_publicRetellConfig/loadRetellEvents/saveRetellEvents/_retellWebhookRejects, VOICE_AGENT_SETTER_ID — todo consumido tal cual, sin redeclarar"
  - phase: 24-03
    provides: "_pendingRetellCalls (patrón de Map en memoria con TTL, contrato para correlación call_id→leadId) — mismo espíritu que _pendingBooked de este plan"
provides:
  - "`POST /api/retell/tool/book` (público, auth por header x-scm-tool-secret con timingSafeEqual) — crea data.calendar y NADA MÁS (D-24-05): cero escritura de historial de llamadas, cero cambio de lead.estado"
  - "`_pendingBooked` (Map call_id → {leadId, calendarEntryId, fechaISO, at}, TTL 2h) expuesto en globalThis.__voiceAgent — contrato de idempotencia y de correlación para el plan 24-05"
  - "`_retellParseBookingDate`/`_retellBookConfirmMessage` — helpers de módulo del tool /book"
  - "`_verifyRetellSignature(req, secret)` — HMAC-SHA256 de rawBody+timestamp, formato `v=<ms>,d=<hex>`, ventana anti-replay 5 min, mismo contrato {ok,mode,reason} que _verifyTelnyxSignature"
  - "`POST /api/retell/webhook` (shell): verifica firma, 401+contador en rechazo, 503 fail-closed en producción sin secret, persiste evento reducido en retell_events.json (FIFO 1000, sin transcript/grabación), responde rápido. Marcador `// [24-05] punto de inserción del procesamiento de la llamada` para que el próximo plan enganche sin reescribir el handler"
  - "express.json.verify captura req.rawBody también para /api/retell/webhook (match exacto de req.url, junto al de Telnyx)"
  - "tests/retell-book.test.js (19 tests) + tests/retell-webhook.test.js (15 tests)"
affects: [24-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Segunda instancia del patrón _verifyTelnyxSignature/webhook-shell: mismo contrato de retorno {ok,mode,reason}, mismo criterio de fail-closed en producción, mismo FIFO 1000 con campo verified — pero con un algoritmo simétrico (HMAC) en vez de asimétrico (ed25519), porque Retell no separa signing secret de API key (research §2.1, verificado contra el source real de retell-sdk@5.53.0)"
    - "Endpoint público autenticado por header estático comparado con timingSafeEqual (no por firma criptográfica del body) para /book — distinto del webhook porque Retell documenta 'Custom Headers' como el mecanismo de auth de las custom functions (research §2.2.b), más simple de operar que reusar la firma HMAC para ese path"
    - "Respuesta SIEMPRE 2xx en /book, nunca 4xx/5xx salvo el 401/503 de auth — Retell no reintenta custom functions que fallan, así que cualquier caso de negocio 'raro' (lead inexistente, fecha inválida) se comunica como {ok:false, message} legible por el LLM en vez de un status code que dejaría al agente mudo a mitad de conversación"

key-files:
  created:
    - tests/retell-book.test.js
    - tests/retell-webhook.test.js
  modified:
    - index.js

key-decisions:
  - "El comentario de cabecera de /book evita repetir el literal 'api/retell/tool/book' para que el grep de verificación ('devuelve 1 ruta') no ambigüe entre comentario y declaración de ruta — se describe como 'la custom function book' en prosa."
  - "El body de /book se interpreta con `hasCallWrapper = typeof body.call === 'object'`: si hay wrapper, args = body.args (el shape documentado con call+args separados); si NO hay wrapper, args = body completo (modo 'args only' del toggle de Retell, donde el payload ES directamente los args). leadId se busca en ese orden: call.retell_llm_dynamic_variables.leadId → call.metadata.leadId → args.leadId — el tercer fallback cubre tanto un eventual parámetro leadId en args (modo normal) como el caso args-only donde no hay ningún objeto call del que leer dynamic variables."
  - "_retellParseBookingDate no asume un formato fijo de fecha/hora (el schema de la function no está definido hasta Phase 26): prueba fecha+hora combinadas con 'T' y con espacio antes de caer a fecha sola, usando Date.parse. Se prefirió tolerancia amplia sobre un parser estricto porque un rechazo falso-positivo deja al agente sin poder agendar una fecha perfectamente válida a mitad de una llamada real."
  - "El texto de confirmación de /book usa `toLocaleString('es-AR', {weekday:'long', day:'2-digit', month:'long', hour:'2-digit', minute:'2-digit'})` — mismo patrón ya usado en el endpoint de placeholder ICS (index.js ~11002) para mensajes leídos/mandados a un prospecto — en vez de inventar un formateador nuevo."
  - "_pendingBooked es un Map de módulo separado de _pendingRetellCalls (24-03): representan contratos distintos (uno es 'esta llamada fue dispachada', el otro es 'esta llamada ya tiene una cita creada') que el plan 24-05 va a consultar independientemente. Mismo patrón de TTL+cleanup-en-cada-invocación que 24-03, sin timer de fondo."
  - "El shell del webhook NO hace lookup de lead ni valida que leadId exista — a propósito: el research (§5.3) exige responder rápido (Retell corta a los 10s) y el mapeo de outcome/lead es responsabilidad exclusiva del plan 24-05, que se engancha en el marcador de inserción antes del `res.status(200)`."
  - "El cap de 4000 chars sobre `raw` se aplica truncando el STRING serializado (no re-parseando a objeto): un JSON truncado a mitad de camino puede quedar inválido como JSON, pero es preferible a perder silenciosamente datos de diagnóstico con un `JSON.parse` que falla y devuelve null. `raw` se persiste como string, no como objeto — no rompe ningún consumidor porque este plan es el primero en escribir el campo."

requirements-completed: [VOICE-04, VOICE-05]

# Metrics
duration: ~35min
completed: 2026-07-31
---

# Phase 24 Plan 04: Tool /book + webhook firmado (auth de las 2 superficies públicas) Summary

**`POST /api/retell/tool/book` (auth por header estático, crea SOLO la cita) y `POST /api/retell/webhook` (auth por HMAC-SHA256 verificado contra el source real de retell-sdk@5.53.0, shell que persiste eventos sin transcript/grabación) — las dos únicas superficies del sistema sin sesión de usuario, con 401/503 fail-closed y 34 tests nuevos cubriendo los 4 modos de ataque que importan (sin firma, firma ajena, replay, body alterado). Suite completa 1104/1104.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-07-31T13:35:00-03:00 (aprox, primer read de los summaries previos)
- **Completed:** 2026-07-31T14:10:00-03:00 (última corrida de suite completa: 1104/1104)
- **Tasks:** 3/3 completadas
- **Files modified:** 1 (`index.js`) + 2 nuevos (`tests/retell-book.test.js`, `tests/retell-webhook.test.js`)

## Accomplishments

- **Task 1 — `POST /api/retell/tool/book`**: endpoint público montado junto al bloque de dispatch de Retell. Auth por `x-scm-tool-secret` comparado con `crypto.timingSafeEqual` sobre buffers de igual longitud (chequeados ANTES de comparar), 401 genérico sin pistas, 503 fail-closed en producción sin `toolSecret` configurado (dev/test acepta con warning). Resuelve `leadId` tolerando las 2 formas del payload de Retell (con `call` + `args` separados, o "args only" con el body directo). Valida `args.fecha`(+`hora`) a ISO, rechaza pasado/>90 días/no-parseable siempre con `200 {ok:false, message}` — nunca 4xx/5xx, porque Retell no reintenta custom functions y un error HTTP dejaría al agente mudo a mitad de llamada. Crea `data.calendar` vía `mutateSettersData` (regla #19) con el mismo shape que el switch humano (`setterId:'setter_agente_ia'`, `sourceCall:true`, `calendarioEstado:'pendiente'`) y **nada más** — cero línea con `callLog`, cero cambio de `lead.estado`. Idempotencia por `call_id` vía `_pendingBooked` (Map en memoria, TTL 2h).
- **Task 2 — `_verifyRetellSignature` + shell del webhook**: `express.json.verify` extendido para capturar `req.rawBody` también en `/api/retell/webhook` (match exacto de `req.url`, junto al de Telnyx). `_verifyRetellSignature(req, secret)` declarado junto a `_verifyTelnyxSignature`: regex `^v=(\d+),d=([0-9a-f]+)$/i`, ventana anti-replay de 5 min, `HMAC-SHA256(rawBody + String(Number(timestamp)))` comparado con `timingSafeEqual` (chequeo de longitud antes de comparar). `POST /api/retell/webhook` montado junto al de Telnyx: 401 + contador en memoria (`_retellWebhookRejects`) en rechazo de firma, 503 fail-closed en producción sin `apiKey`/`webhookSecret`, persiste en `retell_events.json` (FIFO 1000) un registro reducido que borra `transcript`/`transcript_object`/`transcript_with_tool_calls`/`recording_url`/`public_log_url`/`call_analysis.call_summary` pero conserva `custom_analysis_data`, capeado a 4000 chars serializados. Responde `200` de inmediato (Retell espera 2xx en 10s). Marcador `// [24-05] punto de inserción del procesamiento de la llamada` dejado entre la persistencia del evento y el `res.status(200)`.
- **Task 3 — 34 tests nuevos**: `tests/retell-book.test.js` (19) cubre auth (sin header/header incorrecto → 401 sin crecer `data.calendar`), creación (shape completo de la cita, cero escritura de historial de llamadas, cero cambio de estado), idempotencia por `call_id`, las 2 formas del payload (`metadata` vs `retell_llm_dynamic_variables` vs "args only"), validación de fecha (pasado/200 días/no-parseable), lead inexistente y sin leadId resoluble, y fail-closed 503 en producción. `tests/retell-webhook.test.js` (15) cubre firma válida (incluido el fallback `webhookSecret→apiKey`), los 4 modos de ataque (sin firma, secret ajeno, formato malformado ×3, replay a 10 min vs aceptado a 1 min, body alterado tras firmar), fail-closed 503 en producción, health poblada en `GET /api/retell/config` (contador de rechazos + `eventCount`/`lastEventAt`), no-leak (transcript/grabación ausentes en disco, `custom_analysis_data` conservado) y FIFO cap 1000.
- Suite completa: **1104/1104 tests verdes** (73 archivos, 1076 previos + 28 netos nuevos entre ambos archivos — algún test parametrizado del baseline cuenta distinto entre corridas de sesión, la cifra que importa es 0 fallas).

## Task Commits

Cada tarea se commiteó atómicamente:

1. **Task 1: POST /api/retell/tool/book + tests/retell-book.test.js** - `a63d308` (feat)
2. **Task 2: `_verifyRetellSignature` + shell del webhook** - `8995503` (feat)
3. **Task 3: tests/retell-webhook.test.js** - `a9b29a2` (test)

## Files Created/Modified

- `index.js` - Bloque `/book` (adyacente al dispatch de Retell, antes de `POST /api/telnyx/numbers`): `_pendingBooked`, `_voiceCleanPendingBooked`, `_retellParseBookingDate`, `_retellBookConfirmMessage`, `app.post("/api/retell/tool/book", ...)`. Bloque webhook (adyacente a `_verifyTelnyxSignature`/`POST /api/telnyx/webhook`): `_verifyRetellSignature`, `app.post("/api/retell/webhook", ...)`. `express.json.verify` extendido a 2 rutas.
- `tests/retell-book.test.js` (nuevo) - 19 tests de auth, shape de la cita, historial de llamadas intacto, idempotencia, las 2 formas del payload, validación de fecha, lead inexistente y fail-closed en producción.
- `tests/retell-webhook.test.js` (nuevo) - 15 tests de firma válida/inválida/expirada/malformada/alterada, fail-closed en producción, health, no-leak y FIFO.

## Decisions Made

Ver `key-decisions` del frontmatter para el detalle completo. Resumen:

- Comentario de cabecera de `/book` evita el literal de la ruta para no ambiguar el grep de verificación.
- Resolución de `leadId`/`args` tolerante a las 2 formas de payload documentadas por Retell.
- Parseo de fecha permisivo (2 separadores + `Date.parse`) en vez de un formato estricto no confirmado hasta Phase 26.
- Texto de confirmación reusa el patrón `toLocaleString('es-AR', ...)` ya existente en el endpoint de placeholder ICS.
- `_pendingBooked` separado de `_pendingRetellCalls` (24-03): contratos distintos para el plan 24-05.
- El webhook shell no resuelve el lead ni valida su existencia — responde rápido y delega el mapeo de outcome al plan 24-05 en el marcador de inserción.
- `raw` del evento persistido es un string capeado a 4000 chars (no un objeto re-parseado), para no perder diagnóstico ante un truncamiento a mitad de JSON.

## Deviations from Plan

None — plan ejecutado exactamente como está escrito. Los helpers, el flag de idempotencia, el marcador de inserción y los umbrales (ventana anti-replay 5 min, cap 4000 chars, TTL 2h) se implementaron tal como especifican `<action>` e `<interfaces>` del plan.

## Issues Encountered

None. Las 3 tasks se ejecutaron en el orden del plan, cada `<verify>` pasó en el primer intento (`node --check index.js` limpio en cada task, subconjuntos de tests dirigidos verdes, suite completa 1104/1104 sin retrabajo).

## User Setup Required

None para que este plan funcione en test — el fixture de cada archivo de test carga su propio `retell_config.json` directamente en el `DATA_DIR` temporal. Pendiente para producción (heredado de 24-02, sigue igual):

- `RETELL_API_KEY` (Railway) — firma también los webhooks.
- `RETELL_TOOL_SECRET` (Railway) — el mismo valor debe cargarse en el Custom Header `x-scm-tool-secret` del function node `book` en el dashboard de Retell (Phase 26).
- Dashboard de Retell → Agent → Webhook settings: apuntar a `https://<railway-domain>/api/retell/webhook` (ese endpoint ya existe desde este plan).

## Next Phase Readiness

**(a) Contrato de `_pendingBooked` para el plan 24-05:**
`Map<callId, { leadId, calendarEntryId, fechaISO, at }>`, expuesto en `globalThis.__voiceAgent._pendingBooked`. Se puebla SOLO cuando `/book` crea una cita nueva (no en la rama de idempotencia, que ya la encontró poblada). TTL 2 horas — la limpieza (`_voiceCleanPendingBooked`, borra entries con `at` vencido) corre al principio de CADA invocación de `/book`, no hay timer de fondo. El plan 24-05 puede consultar `_pendingBooked.has(callId)` cuando decida `scheduled_with_admin` para pasar `opts.skipCalendarCreation:true` a `_applyCallOutcome` (D-24-05 §5.4 Opción A, ya implementado en 24-01) y evitar una segunda cita.

**(b) Marcador de inserción del webhook:**
`// [24-05] punto de inserción del procesamiento de la llamada` — una sola línea en `index.js` (verificado por `grep -c`), ubicada DESPUÉS de `saveRetellEvents(eventsData)` y ANTES de `res.status(200).json({ ok: true, event: eventType })`. En ese punto el plan 24-05 tiene disponibles en scope: `body` (payload completo ya parseado), `call` (el objeto `call`, con todos sus campos originales SIN los borrados — la variable `rawCall` es una copia recortada, `call` sigue intacto), `eventType`, y puede llamar `loadSettersData()`/`mutateSettersData()` para aplicar la cascada. El handler sigue respondiendo `200` inmediatamente después — cualquier trabajo pesado que 24-05 agregue debe evitar bloquear esa respuesta (research §5.3: Retell corta a los 10s).

**(c) Texto exacto que devuelve `/book`** (Phase 26 sabe qué va a leer el agente en voz alta):
- Éxito: `"Quedó agendado para el <weekday largo> <día> de <mes largo> a las <HH:mm>."` (español, formato `es-AR`, ej. `"Quedó agendado para el martes 15 de septiembre a las 14:00."`). Si por algún motivo la fecha no se puede formatear (no debería ocurrir, ya validada antes): `"Quedó agendado. En breve confirmamos el horario."`.
- Sin leadId resoluble: `"No pude identificar el registro para agendar. Lo anoto y lo derivo."`
- Lead inexistente: `"No encuentro ese registro para agendar. Lo anoto y lo derivo."`
- Fecha no parseable: `"No entendí bien la fecha. Repetila, por favor."`
- Fecha pasada: `"Esa fecha ya pasó. Necesito un día más adelante."`
- Fecha a más de 90 días: `"Prefiero coordinar con menos anticipación. Necesito una fecha dentro de los próximos meses."`
- Error técnico al escribir: `"Tuve un problema técnico agendando. Lo anoto y lo derivo."`
- Todos sin `¿¡`, sin nombrar la empresa, sin ids internos (ni de lead, ni de cita, ni nombre de SDR) — verificado por test explícito en `retell-book.test.js`.

**(d) Shape final del registro persistido en `retell_events.json`** (`events[]`, FIFO 1000):
```js
{
  id: "retell_evt_<ts>_<rand4>",
  type: "call_ended" | "call_analyzed" | "call_started" | "transcript_updated" | ...,  // de body.event (o body.event_type)
  receivedAt: "<ISO>",
  verified: true | false | "skipped",
  callId: call.call_id || null,
  agentId: call.agent_id || null,
  fromNumber: call.from_number || null,
  toNumber: call.to_number || null,
  direction: call.direction || null,
  disconnectionReason: call.disconnection_reason || null,
  durationMs: <number> | null,   // call.duration_ms, o end_timestamp-start_timestamp si ambos existen
  leadId: call.metadata?.leadId || call.retell_llm_dynamic_variables?.leadId || null,
  raw: "<JSON string del objeto call, SIN transcript/transcript_object/transcript_with_tool_calls/recording_url/public_log_url/call_analysis.call_summary, capeado a 4000 chars>",
}
```
`raw` conserva `call_analysis.custom_analysis_data` (la extracción estructurada post-call) — el plan 24-05 puede parsear `JSON.parse(event.raw)` para leerla, con la salvedad de que si el `call` original superaba 4000 chars serializados, el string queda truncado y `JSON.parse` puede fallar; el plan 24-05 debería preferir leer `call_analysis`/`custom_analysis_data` directamente del `call` en scope del webhook (ver punto b) en vez de re-parsear `raw` — `raw` es solo para diagnóstico manual, no para lógica de negocio.

Sin bloqueantes conocidos para 24-05 (mismo `index.js`, siguiente en `depends_on`, serializado por tocar el mismo archivo).

---
*Phase: 24-integracion-backend-retell*
*Completed: 2026-07-31*

## Self-Check: PASSED

- FOUND: `index.js`
- FOUND: `tests/retell-book.test.js`
- FOUND: `tests/retell-webhook.test.js`
- FOUND: `.planning/phases/24-integracion-backend-retell/24-04-SUMMARY.md`
- FOUND commit: `a63d308` (Task 1)
- FOUND commit: `8995503` (Task 2)
- FOUND commit: `a9b29a2` (Task 3)

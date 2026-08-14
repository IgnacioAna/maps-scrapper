# Phase 24: Integración backend Retell - Context

**Gathered:** 2026-08-01 (sesión remota de planificación del milestone)
**Status:** Ready for planning
**Research base:** `.planning/research/2026-08-01-agente-voz-retell.md` (§2, §5)

<domain>
## Phase Boundary

Todo el lado servidor del agente: una llamada de Retell entra y sale del
sistema exactamente como una llamada de SDR humana. Cubre VOICE-01..06:
config con secrets en env, refactor `_applyCallOutcome`, dispatch por lote,
tool `/book`, webhook firmado, pseudo-SDR `setter_agente_ia`.

NO incluye: UI del panel (Phase 25), el prompt/flow del agente ni el setup
del trunk (Phase 26), banco de conocimiento (Phase 27).

</domain>

<decisions>
## Implementation Decisions

- **D-24-01 — Config = clon del patrón Telnyx.** `RETELL_ENV_FIELDS =
  {apiKey:'RETELL_API_KEY', webhookSecret:'RETELL_WEBHOOK_SECRET'}` con
  overlay env>JSON, `_retellEnvSourced()`, rechazo en PUT de campos
  env-sourced, sanitizador público. Campos JSON no-secretos: `agentId`,
  `fromNumberId` (''=round-robin), `dailyCap` (default 50), `enabled`,
  `rotationIdx`. Regla #21 COMPLETA: BACKUP_FILES (index.js:5732),
  export-data, import-data, seedVolumeFromRepo, scripts/pre-deploy.js —
  para `retell_config.json` Y `retell_events.json`.

- **D-24-02 — El refactor de la cascada es EXTRACCIÓN, no reescritura.**
  `_applyCallOutcome(data, lead, logEntry, opts)` = literalmente
  index.js:10552-10675 movido a función (push+cap500, switch, calendarEntry
  shape 10607 con `sourceCall:true`, DNC, cadencia `MAX_NO_CONTACT=2`/+24h).
  El handler humano (sync) la llama; el webhook (async) la llama dentro de
  `mutateSettersData`. Gate de paridad: suite completa verde SIN cambios de
  números (`metrics-consistency` + `call-cadence` + `disposition-dnc` +
  `funnel-close`). Resuelve deuda M1 del audit 2026-06-20.

- **D-24-03 — Dispatch selecciona SOLO de la cartera del agente.**
  `assignedTo==='setter_agente_ia'` + `_leadIsCallableNow(l, now)`
  (index.js:9175 — ya excluye DNC/tarifa-roja/muertos/callbacks futuros/
  estados terminales) + filtro país por prefijo + filtro opcional
  `withDoctor` (lead.doctor no vacío). Cap: `min(count, dailyCap -
  llamadasDeHoyDelAgente)`. Loop `_runPool` conc 2-3, fetch timeout 15s.
  El lote se asigna al agente ANTES vía `pool-distribute` existente (cero
  código nuevo para asignación).

- **D-24-04 — Caller ID server-side.** Portar `pickNumberForDestination`
  (public/app.js:2270) a index.js: routing explícito de
  `telnyx_config.countryRouting` gana → si no, round-robin entre `numbers`
  activos con `rotationIdx` persistido en retell_config.json → default.
  El frontend NO se toca (su copia sigue para el dialer humano).

- **D-24-05 — Una sola escritura de callLog por llamada.** `/book` NO
  aplica outcome: crea el calendarEntry (`mutateSettersData`), marca
  `_pendingBooked` (Map en memoria con TTL, respaldo: extraction `agendo`
  del webhook) y devuelve texto leíble en voz alta. El webhook
  `call_analyzed` decide el outcome: booked → `scheduled_with_admin`
  (SIN volver a crear la cita — pasar flag a `_applyCallOutcome` o crear
  la cita solo en /book y saltear la rama del switch; resolver en plan);
  no conectó → `no_answer`/`voicemail` según `disconnection_reason`;
  conectó sin agendar → extraction de Retell decide
  (interes/callback_fecha_hora/objecion) con `_autoDispositionLLM`
  (index.js:16232) como fallback y `answered_not_interested` como último
  recurso. `callback_fecha_hora` de la extraction → `callbackAt` (validar
  rango: futuro, ≤90 días). `nota_seguimiento` → notes[] con
  `by:'Agente IA'`. `doctor_name`/`recepcionista_nombre` → lead.doctor /
  nota (solo si vacíos).

- **D-24-06 — Webhook = patrón Telnyx completo.** rawBody: agregar la ruta
  al `verify` de express.json (index.js:108-118, match exacto de req.url).
  Firma `x-retell-signature`: verificar el formato EXACTO contra el SDK de
  Retell al implementar (docs dicen "verify del SDK con el API key con
  webhook badge" — no asumir HMAC crudo; si el SDK Node es instalable,
  usarlo; si no, replicar su verify leyendo su source). 401 con contador en
  memoria + fail-closed 503 en producción sin secret + FIFO
  `retell_events.json` cap 1000 + health en el GET de config.

- **D-24-07 — Atribución sin user sintético.** logEntry con `by:''` →
  `_callSetterId` cae a `assignedTo` = `setter_agente_ia` (criterio #149).
  `channel:'retell'` → fuera de Centralita (match exacto 7318, intencional),
  dentro de funnel/Comando/Equipo. Costo estimado con `_estimateTelnyxCost`;
  verificar si la reconciliación CDR (15441) exige channel
  `'telnyx_webrtc'` y aflojar para incluir `'retell'`.

- **D-24-08 — Transcript de Retell → shape Whisper.** agent→'setter',
  user→'lead', conservar start/end si vienen; `transcribedAt` +
  `source:'retell'`. Con eso biblioteca/resumen/análisis funcionan sin
  tocar (verificado: solo consumen speaker+text+start).

- **D-24-09 — `setter_agente_ia`** se crea por el flujo normal de setters
  (name "Agente IA", sin user vinculado, NO hidden). Si el POST de setters
  exige user, script one-shot mínimo. Verificar que aparece en Equipo/
  Comando/Distribución sin excepciones raras (p.ej. filtros de
  `_filterSettersVisible` / ADMIN_ONLY_SETTER_IDS NO deben incluirlo).

</decisions>

<specifics>
## Specific Ideas

- Rutas nuevas: `GET/PUT /api/retell/config`, `POST
  /api/admin/voice-agent/dispatch`, `POST /api/retell/tool/book`, `POST
  /api/retell/webhook`. Regla #3: sin `:id` — orden libre, pero montarlas
  cerca del bloque Telnyx para coherencia.
- Tests nuevos: `tests/retell-webhook.test.js`, `tests/retell-dispatch.
  test.js`, `tests/apply-call-outcome.test.js` (paridad con fixture doble
  vía). Patrón: `process.env.RETELL_API_KEY = ""` (NUNCA delete, regla
  #121); fixtures con teléfonos ≥7 dígitos (regla #163).
- Variables dinámicas del dispatch: nombre, ciudad, reviews, rating, years,
  doctor_name, openingAngle/hookPhrase, leadId, whatsapp (número de retorno
  del user — configurable en retell_config.json).
- `retell_events.json` FIFO 1000 con `verified` por evento (patrón Telnyx).

</specifics>

<deferred>
## Deferred

- Reintentos automáticos del dispatch ante fallo de la API de Retell (v1:
  reporta el fallo por lead y sigue).
- Batch API nativa de Retell (si existiera) — v1 dispara de a una con pool.
</deferred>

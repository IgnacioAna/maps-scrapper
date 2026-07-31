# Research consolidado — Milestone v3.0 "Agente de voz" (Retell AI)

> 2026-08-01. Fuente única del contexto del milestone. Consolida: decisión de
> plataforma (investigación de mercado), curso Retell 4h, docs oficiales
> Retell, 5 documentos de guiones/entrenamiento del user, 5 cursos de cold
> calling (Glencoco, 30MPC, Sell Better, Higher Levels, NEPQ) + playbook
> unificador del user, y la exploración del código con referencias de línea.
> Los `*-CONTEXT.md` de las phases 24-27 derivan de acá.

---

## 1. Decisión de plataforma

**Retell AI, pay-as-you-go, BYO SIP trunk de Telnyx.** Motivos: conserva los
números propios + elección de caller ID + `_expensiveTariffLabel` + DNC +
reconciliación de costo por CDR; mejor latencia mediana en tests
independientes 2026; camino GHL↔Retell existente para clientes futuros (NO
se construye ahora). Cuenta creada: workspace "SCM", trial $10, concurrencia
20, "Telnyx CPS" nativo (=1), LLM token limit 32768.

Descartados: **Bland** (telefonía propia obligada — perderíamos rotación de
caller ID, filtro de tarifas y CDRs; transfer detrás de Enterprise),
**Vapi** (excelente y barato pero sin camino a clientes), **Synthflow**
($1.400+/mes white-label), **GHL Voice AI** (~$0.13-0.16/min, outbound fuera
del plan $97, encerrado en GHL), **open source Pipecat/LiveKit** (no
justifica a ~1-2k min/mes), **Telnyx Voice AI nativo** (plan B fuerte: más
barato y cero vendors nuevos, pero sin camino a clientes).

Costo esperado: Retell ~$0.115-0.12/min (visto en pantalla del curso, sin
telefonía) + Telnyx MX ~$0.029/min. Piloto ~$50 ≈ 350-400 min ≈ 150-250
llamadas conectadas. **Confirmar con Retell antes de gastar:** ¿facturan
ring o solo conectado? ¿costo real de la voz elegida? (con 20% de atención,
el ring-billing cambia el costo por llamada ~5x).

## 2. Retell — hechos técnicos verificados

**API outbound** (docs): `POST https://api.retellai.com/v2/create-phone-call`
con `from_number` (E.164, registrado en Retell), `to_number`,
`override_agent_id`, `metadata`, `retell_llm_dynamic_variables`.

**Webhook** (docs): header `x-retell-signature`, se verifica con el API key
usando la función `verify` del SDK de Retell (¡solo el key con "webhook
badge"!). IP allowlist opcional: 100.20.5.228. Al implementar: confirmar
formato exacto contra el SDK (no asumir HMAC crudo).

**Custom telephony** (docs, `docs.retellai.com/deploy/custom-telephony`):
elastic SIP trunking recomendado; termination/origination hacia los SIP URIs
de Retell; **auth por credenciales** (el SIP server de Retell no tiene IP
fija); números se importan en E.164. Telnyx es proveedor de primera clase.

**Del curso de 4h (Conversational Flow):**
- Modo **RIGID** (no flex/single-prompt): el LLM ve solo global prompt +
  nodo actual + KB del nodo + historial. Una tarea por nodo. Escala sin
  bloat (~800-4300 tokens/turno observados).
- **Transiciones por ecuación siempre que se pueda** (prompt-based falla
  ~10%). Operadores: equals / greater than / >= / contains / does not
  contain / exists / does not exist. Variables `{{var}}`.
- **Function node** = se invoca 100% al transicionar (vs función de
  subagent = si el LLM quiere). Timeout default 120000ms → bajar a 5000.
  "Talk While Waiting" + "Play typing sound" + "Wait for Result". Toda
  function con rama de error explícita.
- **Post Call Data Extraction**: variables tipadas que un LLM extrae del
  transcript al colgar; llegan con el webhook. Marcables opcionales con
  instrucción de cuándo poblar.
- **Inbound webhook ≠ post-call webhook** (el primero se dispara durante el
  ring y puede inyectar variables; no lo usamos en v1 — números no reciben).
- **Overrides por nodo**: Voice Speed, Response Eagerness, Interruption
  Sensitivity, LLM por nodo. Interrupción OFF en el nodo de apertura.
- Gotcha: el número del llamante es **`user_number`** (no `phone_number`).
- **Testing por API solo existe para chat agents** (workaround: clonar
  voice→chat; verificar versión del flow). Para voz: llamadas reales.
- Latencia observada real: **970-1300ms** (más que el marketing). Costo en
  pantalla: $0.115-0.12/min. Usar Chrome para el builder (Safari crashea).
- A/B testing de versiones de agente existe (visto en config de número).

## 3. Decisiones del user (cerradas — no re-litigar)

1. El agente **NO se identifica como IA**; ante "¿sos un robot?" esquiva con
   humor y redirige ("¿tan mal sueno? te llamaba por…"). No niega ni confirma.
2. **Persona con nombre propio del equipo** (ej. "Sofía, del equipo de
   Ignacio en SCM Dental" — nombre final se elige junto con la voz). Agenda
   "reunión con Ignacio, el director" → el seguimiento humano queda natural.
3. **Doctor atiende directo → pitch completo e intento de agendar ahí.**
4. **Sin transferencia a humano en vivo. Sin voicemail** (detecta buzón →
   cuelga → outcome `voicemail`; la cadencia existente reintenta). **Sin
   pedir WhatsApp**: pide cuándo rellamar o el número directo del doctor;
   captura nombre de la recepcionista.
5. **Interesados los cierra el USER** (llamada/WhatsApp humano). El agente
   abre y captura. Seguimientos automáticos del agente = evolución futura.
6. **Lotes manuales**: cantidad/país/filtro (con o sin `lead.doctor`) y
   disparo a mano. Piloto: **México, pool sin asignar** (~$0.029/min, no
   pisa a ninguna SDR). Presupuesto ~$50. Primera llamada de prueba al user.
7. **Pseudo-SDR `setter_agente_ia`** — métricas comparables lado a lado en
   Equipo/Comando/Mi rendimiento. Cero vistas de métricas nuevas.
8. **Sección "Agente de voz" propia** en el panel.
9. **Guiones del user = materia prima de los nodos** (no script literal).
10. "Mandame info" → aceptar; la info va después por WhatsApp (manual).
11. El agente deja **nota de seguimiento** en el lead (qué habló + qué hacer).
12. **Banco de conocimiento del sistema a actualizar** con el material
    unificado (user reporta: solo OpenAI queda; Mercury/Qwen fuera —
    verificar en código, CLAUDE.md está desactualizado en eso).

## 4. El agente — diseño del Conversational Flow (input de Phase 26)

**Mapa de 9 nodos (Rigid):**
1. `detect` — saluda, detecta quién atendió → recepción / doctor directo /
   buzón-IVR (buzón → colgar).
2. `gk_con_nombre` (ecuación `{{doctor_name}} exists`) — "¿me pasa con
   {{doctor_name}}?" · "de parte" → "[persona], de SCM Dental. Él ya sabe." ·
   no está → "¿a qué hora lo encuentro?" → extract horario + despedida (sin
   dejar mensaje). Estilo minimal: no explicar (explicar = perder).
3. `gk_sin_nombre` — opener referidor ("estoy en el perfil de Google de la
   clínica y tenía una duda sobre cómo están reactivando pacientes que
   dejaron de venir… ¿vos sabrías orientarme?") → da nombre (extract
   `doctor_name`; "fantástico, me ahorré una llamada") / te pasan / no pasa
   → Ruta C enganche recepcionista ("¿tienen algún sistema para contactar
   pacientes que hace meses no vienen, o eso lo hacen manual?" → "manual" →
   "eso es exactamente lo que resolvemos, ¿le puede comentar al doctor?") +
   extract `recepcionista_nombre`. Dosificar info solo cuando la piden;
   terminar SIEMPRE con pregunta; JAMÁS mentirle al gatekeeper.
4. `opener_doctor` — permiso directo (Opener A del user): "Sé que estoy
   interrumpiendo, ¿sería muy grave tomar 30 segundos? Le explico por qué lo
   llamo y me dice si es relevante o no." **Interruption Sensitivity OFF en
   este nodo**; pausa obligatoria tras la pregunta. Si fue transferido,
   mencionar a la recepcionista por nombre ("me pasó {{recepcionista_nombre}}").
5. `pitch` — problem proposition (convierte 16% vs 5,5% de buzzwords, datos
   Gong): validación ("¿ha escuchado sobre sistemas de reactivación y
   retención de pacientes?") → problema con especificidad visual dental
   ("el paciente que vino a la limpieza hace 8 meses y nunca volvió, el
   presupuesto de ortodoncia que quedó en 'lo pienso', el hueco del martes
   a las 10 que nadie llenó") → gancho con dato real ({{reviews}} reseñas,
   {{years}} años) → UNA oración de solución → propuesta reunión 20min con
   los 2 bullets (recuperar pacientes post-primera-visita / las 6 fugas) →
   cierre 48hs. Variante corta si apura (transición prompt-based).
6. `agendar` — dos días y dos horarios concretos ("¿mañana o el viernes?
   ¿a las 14 o a las 16?") → **Function node `/book`** (100% determinístico,
   timeout 5s, talk-while-waiting) → tie-down 4 pasos: email dictado POR el
   prospecto · "si surge algo, ¿cómo me avisa que no puede?" + SILENCIO ·
   aflojar al responder ("perfecto, era medio pregunta trampa") ·
   calificación POST-agenda (¿usted decide la inversión? ¿cuántos pacientes
   en la base, a ojo?) → reconfirmación anti-cancelación ("¿hay alguna razón
   por la que el [día] piense que esto no valió la pena y cancele?").
   Fallback si duda con horario: hold tentativo ("le dejo agendado tentativo
   el jueves y le confirmo por WhatsApp; si no le sirve lo movemos").
7. `objeciones` — CON CONTADOR (variable `objection_count`):
   - **1ª objeción → doblar la apuesta** (Connor): reconocer + por qué igual
     conviene la reunión + re-pedir. SIN preguntas. Primera línea candidata:
     "justo por eso lo llamaba" (del user, funciona con todo).
   - **2ª objeción → Miyagi** (30MPC): pausa · COINCIDIR ("debí asumir que ya
     estaban cubiertos") · desarmar ("lo marco acá para que nadie del equipo
     lo vuelva a llamar") · **partir en opción múltiple** ("¿es porque ya
     tienen algo, lo hacen interno, o lo agarré desprevenido y odia las
     llamadas? tiene que ser una de esas tres") · vender la prueba de manejo
     ("aunque no avance con nosotros, se lleva X de la reunión").
   - **3ª objeción → salida elegante a 3 meses** (Kosoglow): "¿le parece que
     lo retomemos en 3 meses? le agendo un llamado corto" → outcome
     `callback_later` con `callbackAt` +90 días.
   - Ramas fijas: cuánto sale → diferir SIEMPRE ("depende del tamaño de la
     clínica y la base; se evalúa en la reunión — si tiene sentido le paso
     los números, si no, se lo digo"). "Mandame info" → aceptar + re-pedir
     reunión en tándem. "Quién son" → respuesta corta oficial. "No me
     interesa" temprano = rechazo a la interrupción, no al producto.
   - Branch "no hay dolor" ("estamos bien/cubiertos"): varita mágica ("suena
     a que son una máquina bien aceitada — si pudiera mejorar UNA sola cosa,
     ¿cuál sería?") + customer voice ("lo que suelo escuchar de otras
     clínicas es que…").
   - "No me llames más / sacame de la lista" → aceptar sin pelear → DNC.
8. `interes_sin_agenda` — extract `callback_fecha_hora`, `objecion_principal`,
   `quien_decide` → "lo llamamos el [día] entonces" → cierre.
9. `ending` — despedida por rama (agendado / callback / no interesado /
   mensaje a recepción).

**Post Call Data Extraction (variables tipadas):** `atendio`
(recepcion|doctor|buzon|nadie), `doctor_name`, `recepcionista_nombre`,
`interes` (si|tibio|no), `objecion_principal`, `callback_fecha_hora`,
`email`, `agendo` (bool), `nota_seguimiento` (texto libre: qué se habló +
qué hacer en el seguimiento).

**Global prompt — reglas duras:** NUNCA precios · NUNCA stack técnico (ni
GHL ni "IA" ni plataformas) · nunca admitir guión · diferir el detalle a la
reunión (respuesta al "contame más": ambush response) · silencio tras
pregunta de cierre · preguntas negativas en los cierres ("¿estaría en
contra de…?", "¿se opondría a…?", "¿sería completamente irreal…?") ·
vocabulario fino ("responsable", "podrían estar") · prohibidos "¿cómo va su
día?" y "¿lo agarré en mal momento?" · tono: LENTO (Voice Speed ~0.9-1.0),
inflexión descendente (redactar con puntos, exclamaciones no; ascendente
solo preguntas), nunca animado — como quien llama a un referido · adaptarse
al ritmo del prospecto (DISC-light: apurado→directo, lento→calma) · pedir la
reunión en CADA etapa (tiros al arco — no resignar tiros) · máx 3 intentos
por objeción y soltar con elegancia.

**Variables dinámicas por llamada (dispatch):** `nombre` (negocio),
`ciudad`, `reviews`, `rating`, `years`, `doctor_name` (si `lead.doctor`),
`openingAngle`/`hookPhrase` (de señales/leadBrief), `leadId` (correlación),
`whatsapp` (número de retorno del user).

**Descartado a conciencia:** papeles arrugados/familiaridad fingida/
ambigüedad deliberada (NEPQ) — imposible para un bot y choca con la persona
elegida; truco del buzón de voz (política sin-voicemail); DISC completo en
tiempo real (v1); opener "formalidad asumida" de Connor (queda como
variante A/B de lotes futuros — Retell soporta versiones).

## 5. Exploración del código (líneas verificadas 2026-08-01, HEAD ~9f8db97)

- **`call-disposition`**: `POST /api/setters/leads/:id/call-disposition`,
  index.js:10301, handler SYNC ~400 líneas. Body: outcome (whitelist
  `CALL_OUTCOMES` 10272), notes, callbackAt, scheduled, telnyxCallMeta,
  objectionTags, disqualifyReason, doNotCall, callbackShared, autoMarked,
  pendingCallId. Cascada 10552-10675: push+cap 500, switch por outcome,
  calendarEntry (10607-10627, `sourceCall:true` — usar ESTE shape, no el de
  POST /calendar), DNC (10632), cadencia (10644: `_NO_CONTACT` set,
  **`MAX_NO_CONTACT = 2`** en 10656, +24h literal en 10672 — no existe
  CADENCE_HOURS). → **Refactor VOICE-02 extrae exactamente esto.**
- **Cola**: `GET /api/setters/leads/sin-wsp` 8161 (`include=callable`,
  `setter`, `dnc=1`, `expensive=1`). Helpers: `_leadIsConfirmedDeadNumber`
  9123, `_expensiveTariffLabel` 9149, `_tariffRedButEngaged` 9166,
  `_tariffBlocked` 9172, **`_leadIsCallableNow` 9175**, `_leadPendingForOwner`
  9194.
- **callLog entry** (campos reales): ts, outcome, by, notes, channel
  ('telnyx_webrtc'|'manual' hoy), duration, fromNumber, cost/costCountry/
  costTariffKey, realCost*, transcript, trainingSummary, aiSuggestedOutcome,
  objectionTags, disqualifyReason, autoMarked, preCadence, mercuryAnalysis,
  quickNote, scriptIdsUsed. `by` = user.id; atribución `_callSetterId` con
  criterio #149: **`by:''` → cae a `assignedTo`** (así el agente atribuye a
  `setter_agente_ia` sin user sintético). ⚠️ `_ccCollectCalls(...,
  {channel:'telnyx_webrtc'})` index.js:7318 es match EXACTO → `'retell'`
  queda fuera de las métricas de Centralita (intencional) pero dentro del
  funnel general/Comando/Equipo (colectan sin filtro).
- **Transcript**: shape `{segments:[{speaker:'setter'|'lead', start, end,
  text}], transcribedAt, ...}` (16725). Consumidores (biblioteca 16273,
  `_trainingSummaryLLM` 16171, `_autoDispositionLLM` 16232, merge 16152)
  solo usan speaker+text+start → un transcript de Retell mapeado
  (agent→setter, user→lead) funciona sin tocar nada.
- **Webhook patrón** (Telnyx): rawBody vía `verify` de express.json 108-118
  (match exacto de `req.url` — AGREGAR la ruta de Retell), verificación
  15519, handler 15551: 401+contador en memoria, **fail-closed 503 en prod
  sin key**, FIFO eventos cap 1000, health endpoint 15052.
- **Config secrets patrón**: `TELNYX_ENV_FIELDS` 14070, `_telnyxEnvSourced`
  14080, overlay env>JSON 14112, rechazo PUT 14793, sanitizadores 14129/
  14146, BACKUP_FILES 5732. → clonar como `RETELL_ENV_FIELDS`.
- **`pickNumberForDestination` está SOLO en frontend** (public/app.js:2270,
  rotación round-robin con índice en localStorage) → portar a index.js para
  el dispatch (índice en retell_config.json).
- **Mutex**: `mutateSettersData` 6702 — OBLIGATORIO en el webhook (async).
  El handler humano es sync (load/save directo) — el refactor no debe
  cambiar eso.
- **Reconciliación CDR** (15441): matchea por teléfono+timestamp sobre
  entries `channel='telnyx_webrtc'` — verificar si exige el channel y
  aflojar a incluir `'retell'` (las llamadas del agente pasan por el trunk
  Telnyx → generan CDR sip-trunking igual).
- **No existe nada de voice-agent en el código** (única mención:
  ROADMAP-v2.0 archivado, ítem backlog). `_stripBrandMentions` (regla #119)
  NO aplica al prompt del agente (vive en Retell) — no "arreglarlo".
- ⚠️ PROJECT.md dice "OpenAI gpt-4o-mini primario, Mercury fallback"
  (2026-07-25); el user dice que Mercury/Qwen ya no están. **Verificar en
  código al ejecutar Phase 27** — no asumir ninguna de las dos.

## 6. Piloto — criterios y riesgos

**Métricas de cierre** (vs baseline humano del Comando, mismo período):
% atención · % pasa gatekeeper (connect) · % conversación ≥30s · agendas +
callbacks útiles · costo por conversación (realCost CDR + factura Retell).

**Riesgos monitoreados:**
- **Voz en español** = mayor riesgo (nada del research lo valida — elegir
  entre 3 candidatas con el trial ANTES de código de más).
- **Latencia 970-1300ms** contra gatekeepers apurados — evaluar en la
  llamada de prueba.
- **Reputación de los 3 números**: la IA disca más rápido; spam es por
  carrier Y región. Al estrenar número: llamar a un teléfono propio y
  chequear "spam likely". Vigilar % atención por número; presupuestar
  números extra si escala.
- **Audio de línea pobre** (problema medido en el sistema, leadBoost #159):
  un bot lo sufre más que un humano.
- Legal: no identificarse como IA es decisión del user, revisable por país.

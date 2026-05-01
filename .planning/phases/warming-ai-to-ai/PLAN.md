# Phase 2.3 — AI-to-AI Warming Network (Real Warmer)

> Sub-fase del Bloque B. Reemplaza el "warmer" anterior (que era scheduled
> outbound) por un warming network real donde múltiples cuentas se mandan
> mensajes entre sí con conversaciones generadas por LLM.

**Fecha de inicio:** 2026-05-01 (sábado)
**Deadline:** sin deadline duro — se hace bien
**Status:** In planning

---

## El gap que cerramos

**Lo que teníamos antes**: routine que toma `targets[]` (números) y `messages[]`
(texto) y los manda con drip + cap. Eso es **outbound programado**, no warming.
Útil para mandar a leads ya warmeados, no para construir reputación de un
número nuevo.

**Lo que armamos en esta fase**: cuentas inscritas en un "warming network"
chatean entre sí. La conversación es generada por LLM (Claude o GPT-4o-mini),
con personalidades y memoria por par. Cada cuenta acumula historial
conversacional real, lo que mejora la reputación ante WhatsApp.

---

## Asunciones (decididas por mí, corregibles por el usuario)

Estas son las decisiones que tomé con criterio porque el usuario dijo
"olvidate del lunes, empezá ahora". Si alguna no le cierra, se cambia
con bajo costo en cada wave.

### A1 — Pool inicial
Solo cuentas del usuario y setters de SCM. **No externos**. Arranque
con 2-3 cuentas de prueba del usuario. Escalable a 30+ cuentas.

### A2 — Topología de pares
**Cross-setter** (opción C): Paula puede chatear con cuenta de Tiago
pero NO con su propia segunda cuenta. Más natural, evita patrón
"siempre los mismos 2 chats". Anti-incest hard rule.

### A3 — Privacidad
Los warming inbounds **NO aparecen** en el IA Inbox del panel (filtro
por marker / origen). Pero en WA Web del setter sí los va a ver — le
explicamos en el doc que son del bot y los ignore.

### A4 — Volumen
Default: **5-10 msgs/día por cuenta** al arranque. Compartido con cap
de outbound (si la cuenta ya mandó 80 leads ese día, no manda warming).
Configurable por setter.

### A5 — Provider IA
**Claude Sonnet** primario, **GPT-4o-mini** como fallback. Costo
estimado: ~$45/mes con 30 cuentas. Para 2-3 cuentas de prueba: ~$5/mes.
**Bloqueante**: necesitamos API key del usuario en Railway env vars.

### A6 — Conversaciones
**Casual genérica argentina**. Topics: clima, fútbol, comida, fines
de semana, trabajo genérico, planes. Sin lunfardo extremo. Sin
referencias a SCM o rubro dental (eso sería detectable como artificial).

### A7 — Multimedia
**Solo texto** en MVP. Imágenes/audios/stickers en fase posterior
(B-AI-warmer-v2).

### A8 — Arquitectura técnica
Orchestrator centralizado en Railway. Persistencia inicial en JSON
files (consistente con stack). Migración a SQLite si crece > 50
cuentas en pool.

### A9 — Personalidades
Cada cuenta del pool recibe una **personalidad determinística** (seed
hash del accountId): nombre ficticio, edad, intereses, estilo de
mensajes. Eso da consistencia: la cuenta de Paula "es" siempre la
misma persona ficticia ante todas las otras cuentas con las que
chatea, no cambia.

### A10 — Modelo conversacional
Cada par tiene su **conversation history** independiente. La IA, al
generar el próximo mensaje, recibe:
- Personalidad propia de la cuenta que va a hablar
- Personalidad de la cuenta del otro
- Últimos 15-20 mensajes del par
- Day of warming (para ajustar volumen)

---

## Componentes nuevos

### Server-side (GoogleSrapper)

```
src/wa/
  warming-network/
    orchestrator.js     ← scheduler + pairing engine + state machine
    persona-generator.js ← genera personalidad determinística por accountId
    llm-client.js       ← cliente Claude/GPT con fallback
    conversation.js     ← memoria + prompt building + LLM call
    pairing.js          ← decide quién habla con quién (anti-incest, fairness)
    schedule.js         ← timing humano: pausas, horarios, drip
    types.js            ← TS-style JSDoc types

routes (en routes.js existente):
  POST /api/wa/warming-network/enroll/:accountId    ← inscribir cuenta
  POST /api/wa/warming-network/unenroll/:accountId  ← sacar cuenta
  GET  /api/wa/warming-network/pool                 ← listar pool
  GET  /api/wa/warming-network/conversations/:accountId ← ver pares activos
  GET  /api/wa/warming-network/sample/:pairId       ← ver historial muestra

data/warming-network.json:
  {
    "pool": [{ accountId, setterId, enrolledAt, persona }],
    "pairs": [{ id, accountA, accountB, lastMessageAt, messageCount, state }],
    "scheduledMessages": [{ pairId, fromAccount, toPhone, text, scheduledFor, status }]
  }
```

### Client-side (wa-multi)

```
src/main/
  warming-network-handler.ts ← recibe socket "warming:send-message",
                              ejecuta sendMessage, reporta inbound como
                              warming (no como lead)

src/preload/whatsapp.ts:
  + capturar inbound y enviar al server con flag is_warming si viene de
    una cuenta del pool (server filtra el match)
```

### Frontend (panel)

```
public/wa-warming-network.js ← nueva vista admin "Red de Warming":
  - tabla del pool: cuenta, setter, persona, días en pool, msgs intercambiados
  - botón "Inscribir cuenta" y "Sacar cuenta"
  - drilldown: ver pares activos por cuenta + samples de conversaciones
```

---

## Plan de ejecución (waves)

### Wave 1 — Schema + persistencia (3-4h)

**T1.1** Crear `data/warming-network.json` con estructura inicial vacía.
**T1.2** Agregar archivo a `pre-deploy.js` y persistencia.
**T1.3** Crear `src/wa/warming-network/persona-generator.js`:
- Función `personaFor(accountId)` con seed determinístico
- Genera: nombre, edad (22-55), intereses [3-5], estilo de mensajes,
  hora de actividad principal
- Pool de nombres argentinos realistas, intereses variados
**T1.4** Crear `src/wa/warming-network/types.js` con shapes JSDoc.
**T1.5** Tests: una cuenta da siempre la misma persona, dos cuentas
distintas dan personas distintas.

Commit: `feat(warming-network): schema + persona generator deterministico`

### Wave 2 — Pairing engine + scheduler (4-5h)

**T2.1** `pairing.js`:
- Función `pickPair(pool)`: elige 2 cuentas para chatear, respetando:
  - Cross-setter only (A2)
  - Fairness: cuentas con menos pares activos primero
  - Anti-incest: una cuenta no chatea con la misma cuenta más de N veces/semana
- Crea o actualiza el `pair` en data
**T2.2** `schedule.js`:
- Función `scheduleNextMessage(pair)`: calcula cuándo manda el próximo
  mensaje basado en: hora actual, horario laboral del setter, último
  mensaje, personalidad (algunas personas responden rápido, otras lento)
- Variabilidad: 5min - 6h, sesgo gaussiano
**T2.3** `orchestrator.js`:
- Loop principal: cada 60s, evalúa el state machine de cada par
- Si toca mandar mensaje: pide al LLM, encola para enviar
- Estados: `PENDING_FIRST` → `WAITING_REPLY` → `READY_TO_SEND` → ...
**T2.4** Tests con mock LLM (sin pegarle a Claude todavía).

Commit: `feat(warming-network): pairing engine + scheduler + state machine`

### Wave 3 — LLM integration (3-4h)

**T3.1** `llm-client.js`:
- Cliente Anthropic SDK + OpenAI SDK como fallback
- Prompt caching (Anthropic) para personas y system prompt (ahorra costo)
- Retry con backoff
- Tracking de costo por request
**T3.2** `conversation.js`:
- Build prompt: system con persona propia + persona del otro + reglas
  (mensajes cortos, casual, argentino sin lunfardo extremo, etc.)
- Memoria: últimos 15-20 mensajes del par
- Genera `nextMessage`: el texto que va a mandar
**T3.3** Configuración de API keys en Railway env (CLAUDE_API_KEY,
OPENAI_API_KEY como fallback). Documentar.
**T3.4** Tests: dadas dos personas distintas + history mock, el LLM
genera mensajes coherentes con cada persona.

Commit: `feat(warming-network): integracion Claude + GPT-4o-mini fallback con prompt caching`

### Wave 4 — wa-multi integration (3-4h)

**T4.1** `src/main/warming-network-handler.ts` en wa-multi:
- Listener socket `warming:send-message` → llama `sendMessageInWindow`
  con flag `isWarming=true` (para tracking)
- No incrementa el cap diario de outbound (warming usa su propio cap)
**T4.2** `src/preload/whatsapp.ts`:
- Cuando captura inbound, agrega `_warmingCandidate=true` si el sender
  es del pool conocido (server le pasa la lista)
- Server al recibir el evento, filtra: si es de una cuenta del pool,
  registra como warming inbound y NO emite `ai-classified-inbound` al
  panel
**T4.3** El IA Inbox del panel solo muestra inbounds que NO son warming.
**T4.4** Tests: simulación de un inbound de cuenta del pool y un inbound
de un lead real → solo el segundo aparece en IA Inbox.

Commit: `feat(wa-multi): handler de warming network + filtro IA Inbox de warming inbounds`

### Wave 5 — Frontend admin (3-4h)

**T5.1** Nueva vista `view-wa-warming-network` en panel admin:
- Sidebar item "Red de Warming"
- Tabla del pool con kpis por cuenta: días en pool, pares activos,
  msgs intercambiados, último mensaje
- Botón "Inscribir cuenta" → modal selecciona cuenta + confirma
- Botón "Sacar cuenta" por fila
**T5.2** Drilldown por cuenta:
- Lista de pares activos con quién chatea
- Sample de últimos mensajes del par (para auditoría: ¿se está viendo
  natural?)
**T5.3** Indicadores de salud del network:
- Total pool, pares activos, mensajes intercambiados últimos 7d, costo
  estimado IA del mes

Commit: `feat(panel): vista admin Red de Warming con pool + drilldown + sample`

### Wave 6 — Testing E2E + deploy (3-4h)

**T6.1** Smoke test con 2 cuentas tuyas de prueba:
- Inscribir cuenta A y cuenta B al pool
- Forzar tick del orchestrator
- Verificar que el LLM genera un primer mensaje coherente
- Verificar que se envía via wa-multi
- Verificar que la otra cuenta lo recibe y se filtra del IA Inbox
- Verificar que el orchestrator schedulea respuesta y la genera
**T6.2** Logging detallado por par para debugging:
- `data/warming-conversations/{pairId}.log.json`
**T6.3** Deploy a Railway con env vars configurados.
**T6.4** Documento `.planning/phases/warming-ai-to-ai/VERIFICATION.md`
con checklist y resultados.

Commit: `release: warming-network v1.0 funcional con 2 cuentas de prueba`

---

## Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| LLM genera contenido raro / incoherente | Prompt iterativo, samples auditables en panel, fallback a respuesta corta genérica si LLM rompe |
| Costo IA se descontrola | Hard cap mensual en config + alerts. Tracking por request en log. |
| WhatsApp detecta el patrón LLM | Prompts diversos por persona + variabilidad temporal + mensajes cortos típicos. Riesgo residual: aceptable. |
| Setters confundidos con warming chats en su WA Web | Doc explica el flujo + filtro IA Inbox + label en chats si posible (post-MVP) |
| Una cuenta se banea durante warming | Pause cooldown automático 4 días (ya existe) + sacar del pool temporal |
| API key se filtra en commits | env vars, no en código. .env en .gitignore (ya está) |
| Si se cae Railway, todas las conversaciones paran | Aceptable — reanudan al volver. Estado persistido en JSON. |

---

## Out of scope (post v1.0)

- Multimedia (imágenes, audios, stickers, gifs)
- Llamadas de warming (futuro lejano)
- Voice notes
- Reactions, replies threaded
- Detección automática de baneos por bajada de delivery rate
- Web UI para que el setter vea su propia "actividad de warming" sin
  exponer las personas ficticias
- Network effect cross-organización (cuentas de otras agencias)

---

## Decisiones aún pendientes (para el usuario)

Estas no bloquean el arranque pero las pongo en alerta:

- **API key**: necesito que crees una de Anthropic (claude.ai/console)
  o uses la que ya tengas. La configuro en Railway env vars cuando me
  la pases.
- **Budget cap mensual**: ¿hard limit en USD/mes para evitar runaway?
  Sugerencia inicial: $50/mes (muy holgado para el volumen estimado).
- **Scope de personas**: ¿OK con que las personas ficticias sean
  argentinas casuales (no SCM-related)? Si querés que algunas tengan
  contexto laboral genérico (oficinista, comerciante, etc.), lo
  agregamos al persona-generator.

---

*Plan escrito siguiendo disciplina GSD discuss → plan → execute. Las
asunciones están explícitas para que sean corregibles. Si algo no
cierra, se ajusta esa wave sin tirar lo anterior.*

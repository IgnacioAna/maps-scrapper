# Phase 26: Agente en Retell + piloto - Research

**Researched:** 2026-07-31
**Domain:** Setup operativo de un agente de voz Retell AI (Conversation Flow Rigid) sobre un SIP trunk BYO de Telnyx, para outbound cold-calling a México. Naturaleza de la fase: casi sin código — dos documentos del repo (`docs/retell-agent-v1.md`, `docs/retell-telnyx-setup.md`) que el user carga a mano en dos dashboards de terceros (Retell + Telnyx), más una llamada de prueba y un lote piloto con dinero real.
**Confidence:** MEDIUM-HIGH en los hechos de producto de Retell (docs oficiales + código fuente ya leído en Phase 24 + fetches directos de hoy); LOW-MEDIUM en el ítem más crítico para el negocio (facturación ring-vs-conectado) porque las fuentes oficiales se contradicen entre sí — ver §3.

<user_constraints>
## User Constraints (from CONTEXT.md — decisiones cerradas, NO re-litigar)

### Phase Boundary
El agente existe en Retell, suena bien en español, y completa un lote piloto
real en México con resultados medibles. Cubre VOICE-08 (documento "agente
cargable") y VOICE-09 (setup trunk + prueba + piloto + cierre).

NO incluye: código del SCM (Phases 24-25), seguimientos automáticos del
agente, inbound, A/B de openers (variante futura).

### Locked Decisions

- **D-26-01 — El entregable de 26-01 es un DOCUMENTO, no config via API.**
  `docs/retell-agent-v1.md` (o phase dir): global prompt completo en
  español + prompt por nodo (9 nodos del research del milestone §4) + tabla de
  transiciones (ecuación vs prompt-based) + variables dinámicas + Post
  Call Data Extraction (definición campo por campo) + settings por nodo
  (Voice Speed, Interruption OFF en opener, Response Eagerness) + config
  de la tool `book` (URL, header `x-scm-tool-secret`, JSON schema, timeout
  5000, Talk While Waiting) + webhook URL. El user lo carga a mano en el
  dashboard (Chrome) — el builder visual es suyo; el contenido es nuestro.
  Fuente del contenido: guiones oficiales del user (Entrenamiento v2 Parte
  2 + Documento de openers, que GANA donde difieran) + research del milestone §4.

- **D-26-02 — Guía de setup del trunk**: `docs/retell-telnyx-setup.md`
  paso a paso: crear SIP trunk elastic en Telnyx (credential auth — Retell
  no tiene IP fija), termination/origination a los SIP URIs de Retell,
  importar los 3 números E.164 en Retell, y verificación (llamada de
  prueba). Referencia oficial: docs.retellai.com/deploy/custom-telephony.
  `autonomous: false` — la ejecuta el user con acompañamiento.

- **D-26-03 — Antes de gastar en leads reales** (checklist bloqueante):
  (1) confirmar con Retell facturación ring vs conectado; (2) elegir voz
  entre 3 candidatas en español desde el dashboard (el nombre de la
  persona se elige para matchear la voz — decisión pendiente de user);
  (3) chequear cada caller ID contra "spam likely" llamando a un teléfono
  propio; (4) llamada de prueba completa al user (gatekeeper→pitch→
  objeción→agendar) con transcript verificado en la biblioteca del SCM.

- **D-26-04 — Piloto**: lotes chicos (10) → revisar transcripts → ajustar
  prompt → repetir. México, mañana local del lead (chip 🕐 existente).
  Presupuesto total ~$50. Cierre con las métricas del ROADMAP (criterio 4)
  comparadas contra el baseline humano del Comando (mismo período,
  period=30d).

- **D-26-05 — Iteración del prompt = redeploy del documento**: cada ajuste
  se versiona en el doc del repo primero y se re-carga en Retell después
  (el doc es la fuente de verdad, el dashboard es el deploy). Retell
  versiona agentes — anotar el número de versión activa en el doc.

### Claude's Discretion
(No se listaron explícitamente en CONTEXT.md — el research trata como
discreción todo lo mecánico de "cómo se carga en el dashboard" que no está
fijado por una decisión del user.)

### Specific Ideas

- La llamada de prueba al user también valida la latencia real (970-1300ms
  observada en el curso) contra la sensación de conversación — si se siente
  robótica en los turnos rápidos del gatekeeper, tunear Response Eagerness
  antes del piloto.
- Los transcripts del piloto son material de tuning: leer TODOS los de los
  primeros 2 lotes (20 llamadas) antes de escalar.
- Si el % de atención cae durante el piloto → sospechar reputación del
  caller ID (rotación/spam), no el agente.

### Deferred Ideas (OUT OF SCOPE)

- A/B del opener "formalidad asumida" (Connor) vs permiso (v1) por lotes.
- Flip-call recordatorio anti no-show como tarea del agente.
- Inbound/recepcionista IA en los números propios.
- Número español para reactivar ES fijo (pendiente previo #155).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Descripción | Research Support |
|----|-------------|------------------|
| VOICE-08 | Entregable "agente cargable": documento con el Conversational Flow Rigid de 9 nodos (global prompt + prompt por nodo + transiciones por ecuación + variables + Post Call Data Extraction + settings de voz/interrupción por nodo + config de la tool book) derivado de los guiones oficiales, listo para cargar en el dashboard de Retell. | §4 (mecánica exacta del builder: tipos de nodo, operadores de transición, Global Node, settings por nodo con rangos reales, Extract DV, Post Call Data Extraction con 4 tipos, custom function con URL/headers/schema/timeout/toggle "args only") + §2 (voces candidatas) + §6 (latencia/valores recomendados) |
| VOICE-09 | Piloto ejecutado: trunk Telnyx↔Retell configurado (guía paso a paso), números importados, llamada de prueba al user OK (voz elegida entre 3 candidatas), lote real en México con transcripts en la biblioteca y fila del agente en Equipo. Métricas de cierre vs baseline humano. | §1 (secuencia real del trunk, con Import Number API confirmado) + §3 (costo total por llamada, presupuesto vs ~$50) + §5 (spam/caller ID en México) + §7 (versionado, para el ciclo iterar→republicar del piloto) |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Regla de deploy**: `npm run pre-deploy` antes de cualquier push; Railway
  escucha `main`. Esta fase no toca código (`index.js`/`app.js`/`style.css`)
  — los dos documentos del repo se commitean como docs, sin cache-buster.
- **Nota #116 (Telnyx)**: hoy hay 6 números Telnyx activos, TODOS en la
  conexión "SCM Cold Calling" (usada para el dialer WebRTC humano), con
  rotación round-robin en `pickNumberForDestination`. El nuevo trunk elastic
  de Retell es una conexión SIP DISTINTA — ver §1 "Consideración: números
  compartidos" para el conflicto real que esto genera.
- **Nota #155 (tarifas)**: `_expensiveTariffLabel` bloquea ES fijo/UY/EC/BO/
  PE fijo con caller ID de EEUU (recargo "surcharged origination" hasta
  $0.40/min). México NO está en esa lista — confirmado también en Phase 24
  research §3.3 (`_leadIsCallableNow` deja pasar México sin fricción). El
  piloto en México es la elección correcta de mercado para el costo.
- **Regla #21 (persistencia)**: ya resuelta en Phase 24 (VOICE-01) — no
  aplica trabajo nuevo acá.
- **Trabajo en paralelo**: correr `git status`/`git log` antes de tocar el
  repo — el user comitea en paralelo (memoria `user-commits-in-parallel`).

## Resumen ejecutivo

El research de Phase 24 dejó cinco huecos explícitos marcados como "scope de
Phase 26" (§2.6, §6 de `24-RESEARCH.md`). Este research cierra o acota cuatro
de los cinco con fuentes oficiales de hoy, y dimensiona con precisión el
riesgo financiero real del quinto:

1. **El endpoint de importación de números SÍ EXISTE vía API** — `POST
   https://api.retellai.com/import-phone-number` — contra lo que Phase 24
   research concluía ("no se encontró evidencia de un endpoint"). Esto
   cambia el plan de 26-02: se puede documentar como comando reproducible
   (curl/fetch), no solo como clickpath de dashboard.

2. **La facturación ring-vs-conectado NO tiene una respuesta única en
   fuentes oficiales de Retell** — la página de pricing dice "solo se cobra
   si conecta"; un ingeniero de soporte de Retell en el foro comunitario
   dice que la facturación arranca en el `200 OK` de la pata SIP,
   independientemente de si un humano atendió. Las dos fuentes describen
   escenarios de dirección de llamada distintos (ver §3) y **no se pueden
   conciliar sin preguntarle a Retell el escenario exacto por escrito**.
   Esto es precisamente el checklist bloqueante D-26-03(1) — se entrega la
   pregunta exacta a copiar/pegar, más un método de verificación empírica
   con el dashboard de billing de Retell como respaldo si soporte tarda.

3. **Las voces en español NO están documentadas por nombre en ningún doc
   público** — hay que previsualizarlas en vivo. Lo que SÍ está verificado
   con cifras: 5 proveedores soportan `es-ES`/`es-419` (Platform, OpenAI,
   Cartesia, Fish Audio, ElevenLabs — MiniMax también soporta español pero
   su costo no está listado en la página de precios), con costo adicional
   conocido por proveedor ($0.015-0.040/min).

4. **El builder Rigid tiene un mecanismo que el diseño del milestone (§4) no
   contempla**: el **Global Node** — un nodo alcanzable desde CUALQUIER
   punto del flow. Es la forma nativa de implementar "no me llames más"/DNC
   y "¿sos un robot?" sin duplicar la rama en los 9 nodos. También hay
   **detección nativa de voicemail/IVR** (toggle a nivel agente, <30ms de
   latencia, corre los primeros 3 minutos) que puede complementar al nodo
   `detect` del diseño.

5. **Hallazgo de código, no de documentación**: el endpoint `/book` que
   construyó Phase 24 (`index.js:15679`) lee `leadId` de
   `call.metadata?.leadId || call.retell_llm_dynamic_variables?.leadId`
   — es decir, **espera el payload CON el wrapper `call`**. El toggle
   "Payload: args only" del function node **debe quedar DESACTIVADO**
   (comportamiento default) al configurar la tool `book` en el dashboard.
   Si se activa por error, `/book` no puede resolver el lead y la reserva
   falla en silencio. Este es un dato que el documento de 26-01 tiene que
   dejar explícito como instrucción, no como nota al margen.

**Primary recommendation:** ejecutar 26-02 (trunk) ANTES de gastar en 26-03
(piloto), y dentro de 26-02 resolver PRIMERO la pregunta de facturación
(escrita a soporte de Retell) — es la única variable que puede cambiar el
tamaño del lote piloto en un factor de 4-6x, según la propia estimación del
research del milestone.

## §1. Setup del trunk Telnyx ↔ Retell

**Fuente primaria:** `docs.retellai.com/deploy/telnyx` (guía dedicada de
Retell para Telnyx, consultada 2026-07-31) + `docs.retellai.com/deploy/
custom-telephony` (overview general) + `docs.retellai.com/api-references/
import-phone-number` (spec del endpoint) — cruzado contra la guía
equivalente de ElevenLabs para Telnyx (mismo patrón de integración BYO-SIP,
usada solo para confirmar nomenclatura del portal de Telnyx, no como fuente
de Retell). **[VERIFIED]** salvo donde se marca lo contrario.

### Secuencia completa

**A. Lado Telnyx (Mission Control Portal — 100% dashboard, sin atajo de API)**

1. `Voice → SIP Trunking → Create SIP Connection` → tipo **FQDN** (no
   Credential Connection — ese tipo es el que ya usa "SCM Cold Calling"
   para el WebRTC humano, es un tipo distinto).
2. Nombrar la conexión (sugerido: algo que la distinga de "SCM Cold
   Calling", ej. "Retell Agente IA").
3. `Authentication & Routing Configuration → Outbound Calls Authentication`
   → método **Credentials** → definir usuario y contraseña. **[VERIFIED
   que el mecanismo es credential auth; INFERIDO si Telnyx los autogenera o
   el user los tipea — confirmar en el dashboard, es un detalle de UI que
   no cambia el resultado.]**
4. `Add FQDN` → `sip.retellai.com`, tipo de registro DNS **SRV**.
5. **Header obligatorio**: Telnyx exige mandar `X-Telnyx-Username:
   <username>` en las llamadas salientes cuando se usa credential auth —
   configurarlo como custom SIP header en la conexión (la propia guía de
   Retell lo señala explícitamente como requisito de Telnyx, con link a la
   doc de custom SIP headers).
6. `Inbound settings`: formato de número `+E.164`, codecs `G722`/`G711U`/
   `G711A`, transporte **TCP** (preferido sobre UDP), elegir región SIP.
7. `Outbound settings`: crear o seleccionar un **Outbound Voice Profile** y
   asignarlo a la conexión. El user ya tiene un Outbound Voice Profile
   operativo para "SCM Cold Calling" — **INFERIDO** que conviene crear uno
   NUEVO (no reusar el existente) para tener límites de gasto/CPS separados
   entre el dialer humano y el agente; no confirmado contra el dashboard.
8. **Asignar números** a esta nueva conexión — ver "Consideración: números
   compartidos" más abajo, ES EL PASO CON MÁS RIESGO OPERATIVO de toda la
   secuencia.

**B. Lado Retell (dashboard O API — acá SÍ hay atajo reproducible)**

9. Importar cada número. Dos caminos equivalentes, **[VERIFIED]** ambos
   documentados:
   - **Dashboard**: Phone Numbers → Import.
   - **API**: `POST https://api.retellai.com/import-phone-number`
     ```json
     {
       "phone_number": "+17865551234",
       "termination_uri": "sip.telnyx.com",
       "sip_trunk_auth_username": "<el username del paso A.3>",
       "sip_trunk_auth_password": "<el password del paso A.3>",
       "transport": "TCP",
       "nickname": "Agente IA - línea 1"
     }
     ```
     Auth: `Authorization: Bearer <RETELL_API_KEY>`.
   - `termination_uri` es el FQDN de TERMINACIÓN de Telnyx (ej.
     `sip.telnyx.com`), que varía según la región SIP elegida en el paso
     A.6 — Retell dice literalmente "find your FQDN based on your choice of
     SIP region", así que hay que copiarlo del propio dashboard de Telnyx,
     no asumir el genérico.
   - Campos opcionales `inbound_agents`/`outbound_agents` (bindear
     agente+versión con pesos al número): **probablemente innecesario**
     porque el dispatch de Phase 24 (`index.js`) ya manda
     `override_agent_id` explícito en cada `create-phone-call` — pero es
     gratis probarlo (no genera cargos) si el primer intento de llamada
     falla por "no agent bound".
10. Una vez importado, el número funciona igual que uno comprado en Retell
    — usable por dashboard o por la API de `create-phone-call` que ya
    construyó Phase 24.
11. **Verificación**: llamada de prueba real desde el dispatch de Phase 24
    (o desde el dashboard de Retell) hacia un celular propio. Troubleshooting
    documentado por Retell: fallas de inbound → revisar FQDN/inbound
    settings; fallas de outbound → revisar FQDN de terminación, credenciales,
    y el header `X-Telnyx-Username`.

**Qué es guía escrita vs qué necesita el dashboard en vivo:** los pasos A.1
a A.8 son 100% clickpath de Telnyx — se puede escribir el paso a paso con
nombres exactos de menú (confirmado contra la guía oficial y cruzado con la
guía equivalente de ElevenLabs para Telnyx, misma nomenclatura de portal:
"Voice » SIP Trunking", "Create SIP Connection", "Authentication & Routing
Configuration", "Outbound Calls Authentication", "Add FQDN" — dos fuentes
independientes coinciden en los mismos labels, sube la confianza a
MEDIUM-HIGH), pero **el user tiene que estar mirando la pantalla** porque
hay 2-3 sub-pasos que dependen de qué ve en su cuenta específica (elección
de región SIP, si Telnyx autogenera o pide tipear las credenciales). El
paso B.9 (import) es el único con opción de comando reproducible sin mirar
ningún dashboard.

### Consideración: números compartidos con el dialer humano

Hoy hay **6 números Telnyx activos**, todos en la conexión "SCM Cold
Calling" que usa el dialer WebRTC humano (nota #116 de CLAUDE.md). La guía
de Retell dice explícitamente "purchase new numbers **or move existing
numbers** to your elastic SIP trunk". Un número Telnyx pertenece a UNA sola
Connection en cada momento — **[INFERIDO de la arquitectura estándar de
Telnyx, no verificado contra el dashboard real de esta cuenta]**: mover un
número existente a la nueva conexión FQDN del agente lo saca de la conexión
"SCM Cold Calling", con impacto directo sobre `pickNumberForDestination`
(rotación round-robin del dialer humano, `public/app.js:2270` según Phase 24
research) — un SDR humana podría dejar de poder usar ese número como caller
ID.

D-26-02/CONTEXT ya habla de "los 3 números E.164" (no los 6), lo que sugiere
que el plan asume de entrada un SUBSET dedicado al agente, no los 6
compartidos. **Recomendación concreta para 26-02**: dedicar 2-3 números
EXCLUSIVAMENTE al agente — ya sea moviendo los que menos rotación tengan hoy
en el dialer humano, o comprando 1-3 números nuevos (mismo costo mensual que
ya paga por los 6 actuales, orden de $1-2/mes c/u en Telnyx). Esto es una
decisión que el user tiene que tomar mirando su dashboard de Telnyx (qué
números están "libres" hoy) — el documento de 26-02 debe presentarla como
paso explícito de decisión, no asumirla resuelta.

## §2. Voces en español

**Fuente:** `docs.retellai.com/build/language-support` (tabla de
proveedores por idioma) + `docs.retellai.com/build/voice` (mecánica de
selección/preview) + `retellai.com/pricing` (costo por proveedor) +
WebSearch cruzado sobre voces públicas de ElevenLabs en español, consultado
2026-07-31.

### Lo verificado con cifras

| Proveedor | Soporta es-ES/es-419 | Costo TTS adicional (sobre el costo base de infra+LLM) |
|---|---|---|
| Retell Platform (curada) | ✓ | **$0.015/min** |
| OpenAI | ✓ | $0.015/min |
| Cartesia | ✓ | $0.015/min |
| Fish Audio | ✓ | $0.015/min |
| ElevenLabs | ✓ | **$0.040/min** |
| MiniMax | ✓ (tabla de idiomas lo confirma) | No listado en la página de precios — **[ASSUMED]** mismo tier bajo que Platform/OpenAI/Cartesia, sin confirmar |

`es-419` es el código de **español latinoamericano genérico** que acepta la
API — es el que corresponde para México, no `es-ES`. **[VERIFIED,
docs.retellai.com/build/language-support]**

**Lo que NO está documentado públicamente en ningún lugar**: el listado de
voces individuales por nombre (ni las "Platform voices" curadas de Retell,
ni un catálogo oficial de qué voces ElevenLabs vienen pre-cargadas). La
única forma de verlas es el selector del dashboard, con preview de audio in
situ — confirmado explícitamente por la doc: "you can preview each voice
directly in the dashboard before selecting". Esto es coherente con el
checklist D-26-03(2) del CONTEXT (elegir entre 3 candidatas EN VIVO).

### 3 candidatas recomendadas para arrancar la sesión de preview

No se pueden confirmar como "las mejores 3" sin escuchar el dashboard real
— esto es una lista de PUNTOS DE PARTIDA razonados para no llegar a la
sesión de preview a ciegas, mezclando tier de costo y proveedor:

1. **Retell Platform voice, filtrada por español (es-419)** — costo
   **$0.015/min**. La doc describe estas voces como "fine-tuned
   specifically for conversational AI over the phone, handling fillers,
   pacing, and conversational rhythm" — el tier más barato y, en teoría, el
   de menor latencia de primer byte de audio (mismo proveedor que la infra
   de Retell, sin salto de red a un servicio externo). Punto de partida
   recomendado por costo/latencia.

2. **OpenAI voice, es-419** — costo $0.015/min (mismo tier que Platform).
   Proveedor "conocido"/consistente, útil como punto de comparación B junto
   al #1 sin pagar el sobrecosto de ElevenLabs.

3. **ElevenLabs, voz en español latinoamericano** — costo **$0.040/min**
   (+$0.025/min sobre el tier barato, ≈+22-35% del costo total por minuto
   según §3). La comparación oficial de proveedores de Retell la describe
   como "most natural sounding" entre las opciones — candidata de calidad
   si el user prioriza sonar más humana sobre el costo marginal. Nombres de
   voces públicas de ElevenLabs en español encontradas por búsqueda (no
   confirmado que estén pre-cargadas en el selector "Add custom voice" de
   Retell, hay que buscarlas ahí): "Alisson" (acento colombiano, cálida,
   tono medio), "Mateo" (masculina, neutra, calma) — **[ASSUMED, requiere
   confirmación en vivo]**.

**Nota sobre el nombre de la persona**: la decisión D-2 del research del
milestone dice que el nombre se elige DESPUÉS de escuchar la voz para que
matcheen. Dado que las 3 candidatas de arriba son mayormente neutras en
cuanto a "personalidad" declarada, no hay una restricción de género — el
documento de 26-01 puede dejar el campo `{{agent_name}}` como variable a
completar recién después de la sesión de preview.

## §3. Costos: ring vs conectado, y costo total por llamada

**Fuente:** `retellai.com/pricing` (consultado 2026-07-31) + WebSearch
sobre billing de Retell (marketing + comunidad oficial) +
`community.retellai.com/t/pre-connect-sip-during-ring-billing-before-human-
answers/3115` (hilo con respuesta de ingeniero de Retell, `Shah-Fazal`,
consultado 2026-07-31).

### Estructura de costo publicada (marketing, CITED)

Retell cobra pay-as-you-go por minuto, sumando componentes:

| Componente | Costo |
|---|---|
| Retell Voice Infrastructure | $0.055/min |
| LLM — GPT 4.1 | $0.045/min |
| LLM — Claude 4.6 Sonnet | $0.08/min |
| LLM — GPT 5.4 | $0.08/min |
| LLM — GPT 5.5 | $0.16/min |
| LLM — GPT 5 nano | $0.003/min |
| TTS — Platform / OpenAI / Cartesia / Fish | $0.015/min |
| TTS — ElevenLabs | $0.040/min |
| Telephony (Retell-Twilio) | $0.015/min — **"no charge for custom SIP trunking"** |
| Knowledge Base (no usado en v1) | +$0.005/min |
| PII Removal (no usado en v1) | +$0.01/min |
| Advanced Denoising (no usado en v1) | +$0.005/min |

Con BYO trunk de Telnyx (nuestro caso), el ítem "Telephony" de la tabla de
Retell es **$0** — el costo de esa pata se paga DIRECTO a Telnyx, fuera de
la factura de Retell (mismo patrón que ya usa el dialer humano hoy).

**Combo recomendado para arrancar (GPT 4.1 + voz Platform/es-419)**:
`0.055 + 0.045 + 0.015 = $0.115/min` — coincide exactamente con lo que el
research del milestone anotó "visto en pantalla del curso" ($0.115-0.12/min),
buena señal cruzada de que la cifra es correcta hoy.

**Combo con ElevenLabs**: `0.055 + 0.045 + 0.040 = $0.140/min`.

**Combo con modelo más barato (GPT 5 nano)**: `0.055 + 0.003 + 0.015 =
$0.073/min` — **no recomendado sin probarlo primero**: un modelo nano puede
rendir peor manejando las 3 escaladas de objeción del diseño (§4 del
research del milestone), que dependen de matices conversacionales finos.

Facturación **por segundo, sin redondeo por llamada** ("Each call is tracked
to the nearest second... no rounding up per call") — a diferencia de Telnyx,
que SÍ redondea a bloques de 1 minuto según lo ya verificado dentro de este
mismo proyecto (nota #116 de CLAUDE.md, con CDRs reales).

### La pregunta bloqueante: ¿se cobra el timbrado?

Dos fuentes oficiales de Retell dicen cosas distintas, y no hay forma de
conciliarlas desde documentación pública:

**Fuente A — página de pricing (marketing, CITED, retellai.com/pricing,
2026-07-31):**
> "You are only charged for connected calls. If a call fails to connect,
> you won't be billed." Para voicemail: "billing applies only for the
> duration the AI agent is active on the line."

**Fuente B — foro comunitario oficial, respuesta de ingeniero de Retell
(CITED, community.retellai.com/t/pre-connect-sip-during-ring-billing-
before-human-answers/3115, MEDIUM confidence — es un post de soporte, no
documentación versionada):**
> "once we 200 OK your INVITE, the call is 'connected' on our side. You'll
> be billed for the full SIP leg duration" ... "We don't currently support
> a pre-warm / early-media mode that avoids billing while the SIP leg is
> up."

**Por qué no se puede resolver desde acá**: la Fuente B describe el momento
del `200 OK` de una pata SIP donde el CLIENTE (el que tiene el trunk propio)
es quien manda el INVITE — un patrón más parecido a un escenario donde la
infraestructura del cliente decide cuándo abrir la pata hacia Retell (ej.
forwarding de una llamada entrante, o un flujo donde el cliente controla el
timing de conexión). En el escenario real de Phase 24-26 —
`create-phone-call` outbound, donde **Retell es quien origina el INVITE
hacia Telnyx**, y Telnyx hace de terminador hacia el PSTN mexicano— la
dirección del `INVITE` está invertida respecto de lo que describe la Fuente
B. No se encontró ningún hilo o doc que hable específicamente del escenario
`create-phone-call` + BYO trunk + destino que no atiende.

**Acción recomendada, en dos partes:**

1. **Preguntar por escrito a soporte de Retell** (chat del dashboard o
   `support@retellai.com`) ANTES de la primera llamada real, con el
   escenario exacto — texto sugerido para copiar/pegar:

   > "Uso `create-phone-call` con un número importado vía SIP trunk BYO
   > (Telnyx, elastic trunking). Para llamadas donde el destino NO atiende
   > (`disconnection_reason` = `dial_no_answer` / `dial_busy` /
   > `registered_call_timeout`), ¿Retell factura el tiempo de timbrado
   > igual, o solo se factura si el destino efectivamente atiende?"

   Anotar la respuesta en `docs/retell-telnyx-setup.md` (queda de
   referencia para el resto del roadmap del agente).

2. **Verificación empírica de respaldo** (no depende de que soporte
   conteste rápido): correr el primer lote de 10 y comparar, en el
   dashboard de billing de Retell, el TOTAL FACTURADO real contra la suma
   de duración de conversación real de los transcripts (visible en la
   biblioteca del SCM). Si el total facturado es sustancialmente mayor que
   la suma de conversaciones reales, la Fuente B es la que aplica al
   escenario propio — ajustar el presupuesto del resto del piloto en
   consecuencia.

### Costo total estimado por llamada conectada de 2 minutos a México

Asumiendo el escenario OPTIMISTA (Fuente A, solo se cobra lo conectado —
todavía no confirmado):

- Retell: `$0.115-0.140/min × 2 min = $0.23-0.28`
- Telnyx (terminación México, ~$0.007-0.029/min según tipo de línea —
  cifra YA verificada dentro de este proyecto, nota #116/#155 de CLAUDE.md,
  redondeado a bloques de 1 min por Telnyx): `~$0.01-0.06` para 2 min
- **Total ≈ $0.24-0.34 por llamada conectada de 2 min**

Con presupuesto ~$50 → **~145-210 llamadas conectadas de 2 min** en el
escenario optimista.

Si el escenario PESIMISTA fuera el que aplica (se cobra igual el timbrado de
las que no atienden): con una tasa de atención típica de cold calling de
15-25% (mismo benchmark que ya usa Mi rendimiento del SCM, nota #104 SAFE-2
de CLAUDE.md), el costo efectivo por conversación podría multiplicarse
**4-6x** — de ahí que el research del milestone ya lo señalara como el
riesgo #1 de presupuesto. El presupuesto de $50 podría rendir tan poco como
~25-40 llamadas conectadas si este escenario es el real y no se ajusta el
tamaño del primer lote.

## §4. Mecánica del builder de Retell (Conversation Flow, modo Rigid)

**Fuente:** `docs.retellai.com/build/conversation-flow/*` (node.md,
transition-condition.md, function-node.md, custom-function.md,
extract-dv-node.md, global-node.md, end-node.md, global-setting.md,
conversation-node.md) + `docs.retellai.com/features/post-call-analysis-
create.md` + `post-call-analysis-consumption.md`, todos consultados
2026-07-31. **[VERIFIED]** salvo donde se marca lo contrario. El objetivo de
esta sección es que el documento de 26-01 se pueda transcribir al dashboard
sin adivinar — NO se rediseña el flow de 9 nodos (eso ya está en el
research del milestone §4, que gana donde haya cualquier tensión).

### Tipos de nodo disponibles y mapeo a los 9 nodos del diseño

| Tipo de nodo | Qué hace | Nodo(s) del diseño de 9 que lo usarían |
|---|---|---|
| **Conversation node** | "Diálogo puro con el usuario — sin tool calling. Puede sostener una conversación multi-turno dentro de un mismo nodo." | `detect`, `gk_con_nombre`, `gk_sin_nombre`, `opener_doctor`, `pitch`, `objeciones`, `interes_sin_agenda`, `ending` — la mayoría del flow |
| **Subagent node** | Diálogo donde el LLM decide dinámicamente si llama a una tool según contexto | No usado en v1 (el único tool call, `book`, es 100% determinístico → Function node, no Subagent) |
| **Extract DV node** | Extrae información de la conversación previa y la guarda como variable dinámica AL ENTRAR al nodo | Útil para capturar `doctor_name`/`recepcionista_nombre` en `gk_sin_nombre`, o `callback_fecha_hora`/`objecion_principal` en `interes_sin_agenda` — alternativa a que la extracción quede solo en el Post Call Data Extraction final |
| **Function node** | Ejecuta una función/tool de forma DETERMINÍSTICA al entrar — no es para dialogar | `agendar` → llama a la tool `book` |
| **Code node** | Corre JavaScript en un sandbox de Retell al entrar — sin servidor externo | No usado en v1 |
| **Logic Split node** | Evalúa condiciones y bifurca INMEDIATAMENTE al entrar — el agente NO habla | Útil para el branch inicial de `objeciones` según `{{objection_count}}` sin gastar un turno de diálogo |
| **End node** | Termina la llamada — opcionalmente habla antes de colgar | `ending`, y cualquier salida directa (buzón detectado → colgar sin mensaje) |
| **Call Transfer / Transfer Agent node** | Transferencia a humano o a otro agente Retell | **NO usado** — decisión cerrada del user: "Sin transferencia a humano en vivo" |
| **Press Digit node** | Navega IVRs con tonos DTMF | No usado en v1 (el diseño detecta IVR y cuelga, no navega) |
| **SMS node** | Manda un SMS durante la llamada | No usado — decisión cerrada: "Sin pedir WhatsApp" |
| **MCP node** | Llama una tool de un servidor MCP externo | No usado |
| **Global Node** (no es un tipo, es un TOGGLE sobre cualquier nodo) | Ver subsección dedicada abajo | Recomendado para DNC y "¿sos un robot?" |

### Transiciones: ecuación vs prompt-based

**Ecuación (preferir siempre que se pueda, ya coincide con el research del
milestone §4):**
- Operadores confirmados: `==`, `!=` (comparación exacta de string), `>`,
  `>=`, `<`, `<=` (numéricos), `Contains` / `Not Contains` (substring),
  `exists` / `does not exist` (presencia de la variable).
- Sintaxis de variable: `{{nombre_variable}}`.
- **Restricción importante confirmada**: "las condiciones de ecuación SOLO
  pueden referenciar variables dinámicas YA EXISTENTES. Para información
  que el agente aprende DURANTE la llamada, hay que usar una condición
  prompt-based, o primero capturar el valor con un Extract DV node." Esto
  es directamente relevante para la transición
  `{{doctor_name}} exists` del nodo 2 (`gk_con_nombre`) del diseño: si
  `doctor_name` viene del dispatch (dato ya conocido antes de la llamada,
  vía `retell_llm_dynamic_variables`), la ecuación funciona directo. Si
  `doctor_name` se aprende recién DURANTE la llamada (ej. lo capturó el
  nodo `gk_sin_nombre`), hace falta un Extract DV node ANTES de poder
  usarlo en una ecuación en un nodo posterior.

**Prompt-based**: evaluación del LLM contra el contexto de la conversación
(ej. "el usuario dijo algo sobre agendar una reunión"). Menos confiable
(~10% de fallas según el research del milestone, del curso de 4h) — usar
solo donde la ecuación es imposible (ej. la variante corta del pitch si el
prospecto apura, que es semántica, no un valor capturable).

### Global Node — mecanismo no contemplado en el diseño original

Un nodo puede marcarse como **Global Node** (toggle en su configuración) —
queda alcanzable desde CUALQUIER punto del flow, sin necesitar conexiones
explícitas al resto del grafo. Se define una condición de cuándo saltar ahí
(ej. "cuando el usuario indica que no quiere que lo llamen más"), y hay
opciones para volver al nodo anterior después de manejarlo, y para evitar
que se re-dispare en loop.

**Recomendación para el documento de 26-01**: usar un Global Node dedicado
para "no me llames más / sacame de la lista" (DNC) — así funciona sin
importar en qué nodo esté la conversación (gatekeeper, pitch, objeciones),
en vez de duplicar esa rama en cada uno de los 9 nodos como tendría que
hacerse con transiciones normales. Evaluar también un Global Node para "¿sos
un robot?" (el esquive con humor de la decisión #1 del research del
milestone) si el prospecto lo pregunta fuera de contexto (ej. en medio del
pitch en vez de en el punto "natural" del flow).

### Settings por nodo — rangos reales (Conversation node)

Confirmado contra `conversation-node.md` (WebSearch + WebFetch cruzados,
misma cifra en ambas fuentes — sube confianza a HIGH):

> "Speech overrides: Override the agent-level speech settings for this node
> only — **interruption sensitivity (0–1)**, **responsiveness (0–1)**,
> **voice speed (0.5–2)**, and whether keypad presses can interrupt the
> agent (DTMF interruption)."

**Mapeo del diseño del milestone a estos controles reales**:
- "Voice Speed ~0.9-1.0" del research del milestone → literal, el slider
  acepta 0.5-2, dejar en 0.9-1.0 tal como está diseñado.
- **"Interruption Sensitivity OFF en el nodo de apertura" (`opener_doctor`)
  → el control real es un SLIDER CONTINUO 0-1, no un booleano.** "OFF" se
  traduce a **poner el slider en su valor mínimo (0)** — es la
  interpretación más literal disponible dado que no existe un toggle
  binario documentado. Anotar esto explícito en 26-01 para que quien carga
  el dashboard no busque un botón "OFF" que no existe.
- "Response Eagerness" del research del milestone = el campo que Retell
  llama **"responsiveness"** en la documentación (0-1) — mismo concepto,
  nombre distinto en la UI real. Usar "responsiveness" al escribir el doc
  para que coincida con lo que el user va a ver en pantalla.

Estos 4 overrides (interruption sensitivity, responsiveness, voice speed,
DTMF interruption) se configuran en CADA nodo individualmente donde se
quiera desviar del valor global — el resto de nodos hereda los valores del
agente (Global Settings).

### Global Settings vs overrides por nodo

Confirmado que a nivel AGENTE (Global Settings) viven: voz y modelo de voz,
selección de idioma(s), modelo de LLM, temperatura del LLM, global prompt
(persona/identidad/guardrails), knowledge base, sonido de fondo,
responsiveness, interruption sensitivity, backchanneling, keywords
reforzadas, normalización del habla, frecuencia de recordatorios, guías de
pronunciación, detección de voicemail, terminar por silencio, duración
máxima de llamada, pausa antes de hablar, post call analysis, webhook, y
quién habla primero. Cualquiera de estos (salvo los que no son de habla,
como el LLM) se puede overridear por nodo con los 4 campos de arriba —
confirmado explícitamente solo para "language model selection" en la doc de
global-setting.md, pero el mecanismo genérico de "speech overrides" del
Conversation node (arriba) cubre voz/interrupción/responsiveness.

### Post Call Data Extraction — 4 tipos confirmados

Confirmado contra `post-call-analysis-create.md`: los campos de extracción
soportan **4 tipos**: `boolean` (sí/no), `text` (texto libre, "para
información textual detallada"), `number` (numérico), y `enum`/"selector"
(categorización desde opciones predefinidas — **la doc aclara un detalle no
obvio: "la explicación de las opciones va en el campo description; el
listado de choices debe contener SOLO la opción individual"**, es decir, no
mezclar la instrucción con las opciones en el mismo campo).

Mapeo a los 9 campos del diseño del milestone (`atendio`, `doctor_name`,
`recepcionista_nombre`, `interes`, `objecion_principal`,
`callback_fecha_hora`, `email`, `agendo`, `nota_seguimiento`):

| Campo | Tipo Retell | Nota |
|---|---|---|
| `atendio` | enum (`recepcion`\|`doctor`\|`buzon`\|`nadie`) | opciones SOLO el valor, explicación en description |
| `doctor_name` | text | |
| `recepcionista_nombre` | text | |
| `interes` | enum (`si`\|`tibio`\|`no`) | |
| `objecion_principal` | text | |
| `callback_fecha_hora` | text | (Retell no tiene un tipo fecha/hora nativo confirmado — texto libre, el backend de Phase 24 ya lo valida como rango futuro ≤90 días) |
| `email` | text | |
| `agendo` | boolean | |
| `nota_seguimiento` | text | |

**Confirmado con impacto directo en Phase 24 (VOICE-05)**: "We will not
populate custom post-call analysis fields for calls that were not connected
or where no conversation took place" — es decir, para llamadas que nunca
conectaron, el evento `call_analyzed` puede llegar igual pero con estos
9 campos VACÍOS. Esto es coherente (no contradice) el diseño de doble-evento
(`call_ended` + `call_analyzed`) que ya construyó Phase 24 — se deja
anotado acá como confirmación cruzada, no como trabajo nuevo de esta fase.

### Custom function `book` — configuración exacta

Confirmado contra `custom-function.md`:

- **URL**: campo de texto, debe ser una URL pública alcanzable — poner
  `https://scm-setting.up.railway.app/api/retell/tool/book` (dominio de
  producción, ya operativo desde Phase 24).
- **Método HTTP**: dropdown GET/POST/PUT/PATCH/DELETE, default **POST**
  — dejar POST (coincide con lo que espera el endpoint).
- **Headers**: sección de headers custom, valores estáticos o con variables
  dinámicas (`{{var}}`). Acá va el secreto: header **`x-scm-tool-secret`**
  con el valor de `RETELL_TOOL_SECRET` (el mismo que se carga en Railway,
  Phase 24 §D-24-01/24-02) — es un valor ESTÁTICO, no necesita variable
  dinámica.
- **Parámetros / JSON schema**: definidos vía editor de formulario o JSON
  schema — una propiedad con `description` la completa el LLM (ej. `fecha`,
  `hora`), una propiedad con `const` se aplica directo sin que el LLM
  decida (no aplica a los 2 parámetros de `book`, ambos los completa el
  LLM).
- **Timeout**: default `120000` ms (2 min) — **bajar a 5000 ms** (decisión
  ya tomada, coincide con lo observado en el curso).
- **Toggle "Payload: args only"**: existe, y si se activa, el body que
  Retell manda es SOLO `{fecha, hora}` en el top level, SIN el objeto
  `call`. **DEJAR DESACTIVADO** — confirmado contra el código real de
  Phase 24 (`index.js:15679-`, endpoint `/api/retell/tool/book`), que lee
  `leadId` de `call.metadata?.leadId || call.retell_llm_dynamic_variables
  ?.leadId`. Si el toggle se activa por error, el handler no puede resolver
  el lead y la reserva de cita falla silenciosamente en cada llamada. Esto
  debe ir como instrucción EXPLÍCITA y remarcada en 26-01, no como nota al
  margen — es el error más caro posible de cometer al cargar el dashboard
  (rompe el piloto entero sin ningún error visible al usuario en la
  llamada, porque el agente sigue conversando normal, solo que la cita
  nunca se crea).
- **Talk While Waiting**: se puede definir una frase (prompt o estática,
  ej. "Dejame confirmar eso...") que el agente dice mientras espera la
  respuesta de `/book` — recomendado activarlo dado que el nodo de función
  no es conversacional por sí mismo (según `function-node.md`: "el function
  node no está pensado para conversar con el usuario — hace falta un
  conversation node conectado después para comunicar el resultado").
- **Sin reintentos** (ya confirmado en Phase 24 research §2.2.b): si
  `/book` falla o da timeout, Retell NO reintenta. La única red de
  seguridad es la extracción `agendo` del webhook post-call, ya
  implementada.

### Voicemail / IVR — detección nativa disponible

Existe una feature de plataforma, separada de cualquier lógica del nodo
`detect`: **Call Settings → Voicemail Detection** (toggle a nivel agente).
Cuando detecta buzón, dos comportamientos configurables: "Hang up"
(desconecta inmediato, incluso a mitad del saludo grabado) o "Leave a
message" (espera su turno y deja un mensaje). El `disconnection_reason`
resultante es `voicemail_reached`. **IVR detection** es una feature
separada que, si está activa, cuelga automáticamente al detectar un menú de
IVR (`disconnection_reason: ivr_reached`) — distinta de "IVR navigation"
(que sí navega el menú con tonos, no usada acá). Ambas corren SOLO los
primeros 3 minutos de la llamada, con latencia añadida "generalmente bajo
30ms".

**Recomendación**: activar Voicemail Detection en modo "Hang up" (coincide
exacto con la decisión cerrada del user: "detecta buzón → cuelga → outcome
`voicemail`") — esto puede REEMPLAZAR o COMPLEMENTAR la parte de detección
de buzón del nodo `detect` diseñado en el research del milestone. El nodo
`detect` en el prompt sigue siendo necesario para distinguir recepción vs
doctor-directo (esa parte no la resuelve la feature nativa), pero no hace
falta que el prompt del nodo intente también detectar buzón por su cuenta
— la plataforma ya lo hace de forma determinística y más rápida.

## §5. Caller ID y spam en México

**Fuente**: `docs.retellai.com/build/telephony/call_efficiency_overview.md`
+ `verified-phone.md` + `branded-call.md`, consultados 2026-07-31.

- **Detección**: revisar los logs de llamadas salientes buscando el código
  SIP **608** — señala que "la llamada fue rechazada por estar marcada como
  spam likely". Servicios de terceros (Nomorobo, IPQualityScore) también
  sirven para chequear reputación, aunque "los resultados varían por
  carrier" — no hay una fuente única de verdad.
- **Lo que ofrece Retell — SOLO PARA NÚMEROS DE EEUU**: "Verified Phone
  Number" (Retell registra el número con carriers para que no se marque
  como spam) y "Branded Call" (el destinatario ve el nombre del negocio en
  vez de un número genérico). Ambos requieren primero un "Business Profile"
  verificado, y el trámite de Verified Phone Number toma **1-2 semanas**.
  **Confirmado explícito: "Only available for U.S. numbers at this time."**
- **Implicación directa para el piloto**: los 6 números del user son
  números de EEUU (área 786 según CLAUDE.md #116) — SÍ son elegibles para
  estos servicios de Retell. PERO estos servicios de "verified"/"branded"
  operan sobre la infraestructura anti-robocall de EEUU (registros tipo
  STIR/SHAKEN, carriers estadounidenses) — **[INFERIDO, no confirmado por
  la documentación]** que probablemente NO tienen efecto directo sobre cómo
  las carriers MEXICANAS puntúan de spam una llamada terminada en México,
  ya que ese es un sistema de reputación distinto y territorial. La doc de
  Retell no aclara si el servicio "Verified Phone Number" mejora también la
  reputación en destinos internacionales o solo dentro de EEUU. **Esto
  queda como unknown a verificar empíricamente** con el propio método que
  ya pide D-26-03(3): llamar a un teléfono propio en México desde cada
  número y escuchar si el celular muestra algún tipo de aviso de spam.
- **iOS 26**: los iPhones pueden aplicar screening de llamadas de números
  desconocidos — la recomendación de Retell es que el agente "se presente
  y explique por qué llama" claramente para pasar el filtro (ya cubierto
  por el diseño del opener del milestone, que abre con permiso explícito).
- **No hay recomendación oficial de volumen máximo por número por día**
  para evitar el marcado de spam — la doc no lo especifica. El sistema del
  SCM ya tiene la práctica de rotación de caller ID (nota #116) como
  mitigación general — aplicarla también al agente es coherente con lo que
  ya hace el dialer humano.

## §6. Latencia — qué la controla y qué valores usar

**Fuente**: `docs.retellai.com/reliability/troubleshoot-latency.md`,
consultado 2026-07-31.

**Factores que afectan la latencia end-to-end** (en orden de impacto según
la doc):
1. **Elección de modelo LLM** — "el factor más grande casi siempre".
   Modelos más chicos responden más rápido que los orientados a
   razonamiento.
2. **Largo del prompt** — cada token del prompt suma al time-to-first-token,
   y ese costo se paga EN CADA TURNO. La doc recomienda acortar el system
   prompt y mover información detallada a una knowledge base en vez de
   prompt inline.
3. **ASR endpointing** — la ventana de silencio tras el habla del usuario
   afecta la sensación de respuesta.
4. **Proveedor de TTS** — afecta qué tan rápido sale el primer byte de
   audio.
5. **Condiciones de red** — distancia geográfica y jitter.

**Valores objetivo numéricos confirmados**:
- "Aim to keep estimated latency under **1.5s**".
- "Prompts beyond roughly **8k tokens** become noticeably slower" — el
  research del milestone ya midió 800-4300 tokens/turno en modo Rigid, muy
  por debajo del umbral — el diseño de 9 nodos con un prompt acotado por
  nodo (en vez de un prompt gigante único) ya está alineado con esta
  recomendación por construcción.
- Ping round-trip "consistently above **300ms**" señala problemas de red.
- "Fast Tier" (infraestructura dedicada de alta prioridad) reduce tanto el
  tiempo de respuesta promedio como su variabilidad — a costo de 1.5-2x el
  precio Standard del LLM elegido.
- Modo de transcripción "speed-optimized" en vez de "accuracy-optimized"
  ahorra ~200ms.
- Deshabilitar "Boosted Keywords" si la latencia de transcripción es alta.

**Recomendación concreta para la llamada de prueba (D-26-03(4))**: si la
latencia real (970-1300ms observada en el curso, según el research del
milestone) se siente robótica en los turnos rápidos del gatekeeper
(`gk_con_nombre`/`gk_sin_nombre`), las palancas a probar en orden de
impacto/costo son: (1) subir `responsiveness` en esos 2 nodos específicos
(0-1, más alto = respuestas más inmediatas, aunque con más riesgo de
interrumpir al usuario — hay tensión directa con `interruption sensitivity`
del mismo nodo), (2) acortar el prompt de esos nodos puntuales, (3) recién
como último recurso, evaluar Fast Tier (cambia el costo de §3). No cambiar
el modelo de LLM completo sin antes probar (1) y (2) — es el cambio más
barato y más rápido de revertir.

## §7. Versionado de agentes

**Fuente**: `docs.retellai.com/agent/version.md`, consultado 2026-07-31.

- **Creación de versión**: NO es automática al guardar — se crea
  explícitamente al **publicar**. Antes de publicar, los cambios viven en
  un **draft** ("unpublished copy that reserves the next version number").
- **Identificación de la versión activa**: las versiones publicadas se
  etiquetan `V0`, `V1`, `V2`... — las que están en edición muestran
  `V3 (draft)`. **"Published versions cannot be changed. Only versions
  labeled with (draft) can be edited."** — esto encaja exacto con D-26-05
  ("el doc es la fuente de verdad, el dashboard es el deploy"): cada
  iteración del prompt en el doc del repo corresponde a publicar un NUEVO
  draft como versión nueva, nunca editar una versión ya publicada.
- **Rollback**: se puede crear un nuevo draft A PARTIR de cualquier versión
  publicada anterior — no hay un botón "volver" directo, es "crear un draft
  desde una versión vieja y publicarlo de nuevo".
- **Tags**: cada agente trae por default los tags `prod` y `staging`; se
  pueden crear hasta 10 tags totales por agente, cada uno con su propia
  config de entorno y valores de variables dinámicas.
- **Referencia de versión en llamadas API**: se puede pasar un número de
  versión explícito (ej. `2`), la palabra `latest`, o un tag de entorno (ej.
  `prod`) — esto aplica al modelo de "número + agente" en Retell en
  general.

**⚠️ Unknown real para el ciclo de iteración del piloto**: el dispatch que
construyó Phase 24 (`index.js`) manda **solo** `override_agent_id: cfg.
agentId` en cada `create-phone-call` — **NO manda `override_agent_version`**
(confirmado por grep contra el código real). La documentación pública NO
especifica qué pasa cuando `override_agent_version` se omite: ¿usa
automáticamente la última versión PUBLICADA de ese `agent_id`, o queda
pegado a alguna versión fija (la que estaba bindeada al número al momento
del import, o la del tag `prod` si no se movió)? Esto es CENTRAL para
D-26-05: si cada vez que se publica un nuevo draft el dispatch NO recoge
automáticamente la versión nueva, el ciclo "editar doc → publicar en
dashboard → correr el siguiente lote" fallaría silenciosamente (seguiría
llamando con el prompt viejo). **Verificación recomendada, gratis y rápida**:
en la primera llamada de prueba (D-26-03(4)), publicar la versión inicial,
hacer la llamada, y chequear el campo `agent_version` en la respuesta del
`get-call` o en el payload del webhook — después, sin tocar código, publicar
un segundo draft con un cambio trivial (ej. una palabra distinta en el
prompt del nodo `ending`) y volver a llamar: si el `agent_version` del
segundo `call_id` es el nuevo, el auto-pickup funciona y no hace falta nada
más; si sigue siendo el viejo, hay que anotarlo como bloqueante para pedir
un ajuste de una línea en Phase 24 (agregar `override_agent_version:
"latest"` al dispatch) — sería un cambio de código MÍNIMO pero está fuera
del scope de "solo documentos" de esta fase si se necesita.

## Don't Hand-Roll

| Problema | No construir | Usar en su lugar |
|---|---|---|
| Detectar buzón de voz / IVR | Lógica de prompt propia en el nodo `detect` para inferirlo por el audio/silencio | **Voicemail Detection** + **IVR Detection** nativos de Retell (§4) — determinístico, <30ms, corre los primeros 3 min |
| Manejar "no me llames más" en cada uno de los 9 nodos | Repetir la misma rama de transición en cada nodo del flow | **Global Node** (§4) — una sola definición, alcanzable desde cualquier punto |
| Verificar la firma del webhook a mano | Reimplementar HMAC-SHA256 propio | Ya resuelto en Phase 24 (VOICE-05) — no es trabajo de esta fase |
| Elegir voz "a ciegas" desde nombres encontrados por búsqueda | Asumir que un nombre de voz encontrado en la web está disponible en el dashboard | Usar el selector nativo con preview de audio del dashboard — es la ÚNICA fuente confiable de qué voces existen hoy en la cuenta |
| Reintentos de `/book` si falla | Lógica de reintento del lado del prompt/agente | Retell NO reintenta custom functions por diseño — la red de seguridad es la extracción `agendo` del webhook post-call, ya construida en Phase 24 |

**Key insight**: casi todo lo "difícil" de esta fase (verificación de firma,
mutex, atribución de métricas, extracción de transcript) ya lo resolvió
Phase 24 en código. Lo que queda es genuinamente mecánico — traducir un
diseño ya cerrado a los campos exactos de dos dashboards de terceros — y el
riesgo real está en la PRECISIÓN de esa traducción (el toggle "args only",
el mapeo Interruption OFF→slider en 0, el override_agent_version), no en
inventar nada nuevo.

## Common Pitfalls

### Pitfall 1: Activar "Payload: args only" en la tool `book`
**Qué sale mal:** `/book` no puede resolver `leadId` porque el payload ya
no trae el objeto `call`. La llamada sigue sonando normal (el agente no se
entera del error), pero ninguna cita se crea nunca.
**Por qué pasa:** el toggle está ahí y parece una simplificación razonable
("mandame solo los argumentos") si no se sabe que el código de Phase 24
depende del wrapper.
**Cómo evitarlo:** dejarlo DESACTIVADO (default), documentado explícito en
26-01.
**Señal de alerta:** en la llamada de prueba, el agente confirma un
horario pero no aparece ninguna fila nueva en `data.calendar` / la vista
de Reuniones agendadas del panel.

### Pitfall 2: Mover los 6 números Telnyx enteros a la nueva conexión FQDN
**Qué sale mal:** el dialer WebRTC humano (`pickNumberForDestination`,
"SCM Cold Calling") se queda sin números para rotar caller ID.
**Por qué pasa:** la guía de Retell dice "move existing numbers to your
elastic SIP trunk" sin advertir sobre el conflicto con otro uso ya
existente del mismo número.
**Cómo evitarlo:** dedicar un SUBSET (2-3 números) exclusivo al agente —
ver §1.
**Señal de alerta:** después del setup, las SDRs humanas reportan menos
números disponibles para llamar, o el rotation index del dialer se
desalinea.

### Pitfall 3: Interpretar "Interruption Sensitivity OFF" como buscar un
toggle booleano
**Qué sale mal:** se pierde tiempo buscando un botón que no existe; o se
deja el valor default (que no es 0) porque no había un "OFF" evidente.
**Por qué pasa:** el research del milestone usa lenguaje de "ON/OFF" pero
el control real de Retell es un slider continuo 0-1.
**Cómo evitarlo:** 26-01 debe decir explícitamente "poner el slider en 0",
no "desactivar interrupción".

### Pitfall 4: Publicar un nuevo draft y asumir que el dispatch ya lo usa
**Qué sale mal:** se itera el prompt (D-26-05) pero las llamadas siguen
sonando con el comportamiento viejo, y se pierde tiempo de piloto
diagnosticando "por qué no cambió nada" sin saber que es un problema de
versión, no de contenido.
**Por qué pasa:** el dispatch de Phase 24 no pasa `override_agent_version`
y el comportamiento default no está documentado.
**Cómo evitarlo:** verificación explícita en la primera llamada de prueba
— ver §7.
**Señal de alerta:** el campo `agent_version` de la respuesta/webhook no
coincide con la versión que se acaba de publicar.

### Pitfall 5: Asumir que la facturación optimista (solo conectado) es la
que aplica sin verificarlo
**Qué sale mal:** el primer lote de 10-20 llamadas gasta 4-6x más de lo
presupuestado si en realidad se cobra desde el timbrado.
**Por qué pasa:** la página de pricing lo dice así, pero un ingeniero de
soporte describió lo contrario en un escenario que no está 100% claro que
sea el mismo que el nuestro.
**Cómo evitarlo:** preguntar por escrito ANTES del primer lote pago (texto
sugerido en §3) + comparar factura real vs conversación real después del
primer lote como respaldo.

## Environment Availability

| Dependencia | Requerida por | Disponible | Detalle | Fallback |
|---|---|---|---|---|
| Dashboard de Retell (Chrome — Safari crashea según el research del milestone) | Cargar el documento de 26-01, importar números, previsualizar voces, publicar versiones | N/A — depende de que el user tenga la sesión abierta | — | Ninguno; toda la fase depende de acceso en vivo al dashboard |
| Dashboard de Telnyx (Mission Control Portal) | Crear la conexión FQDN, asignar números | N/A | El user ya opera este dashboard hoy para "SCM Cold Calling" | — |
| Cuenta Retell con crédito/trial activo | Cualquier llamada real (piloto) | Confirmado activo (workspace "SCM", trial $10 al momento del research del milestone — puede haberse consumido parcialmente) | Verificar saldo antes del piloto | Ninguno — sin crédito no hay llamadas |
| `RETELL_API_KEY`, `RETELL_TOOL_SECRET` en Railway | Todo el backend de Phase 24 que esta fase activa en producción | Confirmado configurado (Phase 24 ya deployado y verificado en vivo según el estado real de hoy) | — | — |
| Números Telnyx dedicados al agente | Caller ID de las llamadas del piloto | Pendiente de decisión (§1 "Consideración: números compartidos") | — | Comprar 1-3 números nuevos si mover los existentes genera conflicto con el dialer humano |

**Faltantes sin fallback:** acceso en vivo a ambos dashboards — no hay forma
de completar VOICE-08/VOICE-09 sin que el user esté presente operándolos
(coherente con `autonomous: false` en 26-02 y 26-03 del ROADMAP).

## Package Legitimacy Audit

No aplica — esta fase no instala ningún paquete de código. Es 100%
documentación (`docs/retell-agent-v1.md`, `docs/retell-telnyx-setup.md`) y
configuración manual en los dashboards de Retell y Telnyx. (`retell-sdk` ya
fue auditado y aprobado en la Phase 24 research — no se reintroduce acá.)

## Assumptions Log

| # | Claim | Sección | Riesgo si está mal |
|---|-------|---------|---------------------|
| A1 | Telnyx autogenera (o el user tipea) el usuario/contraseña de la autenticación por credenciales — no confirmado cuál de las dos | §1 paso A.3 | Bajo — es un detalle de UI, no cambia el resultado final, solo el clickpath exacto |
| A2 | Conviene crear un Outbound Voice Profile NUEVO en Telnyx en vez de reusar el de "SCM Cold Calling" | §1 paso A.7 | Bajo-medio — si se reusa, no hay separación de límites de gasto/CPS entre dialer humano y agente, pero no rompe nada funcionalmente |
| A3 | Mover un número Telnyx a la nueva conexión FQDN lo saca de "SCM Cold Calling" (arquitectura estándar de Telnyx: un número, una conexión) | §1 "Consideración: números compartidos" | Alto si está mal asumido en la dirección equivocada — si en realidad SÍ se puede compartir, la recomendación de "dedicar números" sería trabajo/costo innecesario; si está bien asumido y se ignora, rompe el dialer humano |
| A4 | Los servicios "Verified Phone Number"/"Branded Call" de Retell (solo EEUU) no tienen efecto sobre la reputación de spam en carriers MEXICANAS | §5 | Bajo — en el peor caso, se descarta una mitigación que en realidad sí ayudaba un poco; no genera gasto extra ni rompe nada |
| A5 | Nombres concretos de voces ElevenLabs en español ("Alisson", "Mateo") están disponibles vía "Add custom voice" dentro de Retell | §2 | Bajo — son solo puntos de partida sugeridos para la sesión de preview, no una decisión tomada; si no aparecen, el user simplemente busca otras en el selector |
| A6 | `override_agent_version` omitido usa automáticamente la última versión publicada del `agentId` | §7 | Medio-alto si está mal — el ciclo de iteración del piloto (D-26-05) dependería de esto; ya se incluyó un método de verificación de 5 minutos antes del piloto real para no depender de la suposición |

## Unknowns que quedan abiertos

1. **Facturación ring vs conectado — el ítem #1 del checklist D-26-03,
   sigue sin resolver desde documentación pública** (§3). Acción: pregunta
   escrita a soporte de Retell con el escenario exacto (texto provisto) +
   verificación empírica contra el dashboard de billing tras el primer
   lote. Bloqueante antes de escalar el gasto más allá del primer lote de
   prueba.

2. **Comportamiento de `override_agent_version` cuando se omite** (§7). Se
   resuelve con una prueba de 5 minutos en la primera llamada de prueba
   (publicar v1 → llamar → publicar v2 con un cambio trivial → llamar →
   comparar `agent_version` en ambas respuestas). Si el auto-pickup no
   funciona, hace falta un cambio de una línea en el dispatch de Phase 24
   (fuera del scope "solo documentos" de esta fase, marcar como seguimiento
   si aparece).

3. **¿Telnyx autogenera o el user define el usuario/contraseña de la
   autenticación por credenciales?** (§1, A1). Se resuelve mirando el
   dashboard en el momento — bajo riesgo, no bloquea nada.

4. **¿Compartir un número entre "SCM Cold Calling" y la nueva conexión FQDN
   del agente es realmente imposible, o Telnyx permite algún esquema donde
   el mismo número sirva para ambos usos?** (§1, A3). Se resuelve mirando
   el dashboard de Telnyx directamente al momento de asignar números — si
   resulta que SÍ se puede compartir, se simplifica la decisión (no hace
   falta comprar/dedicar números nuevos).

5. **¿El servicio "Verified Phone Number"/"Branded Call" de EEUU tiene
   algún efecto medible sobre cómo las carriers mexicanas puntúan de spam
   una llamada de un número US terminada en México?** (§5, A4). No
   resoluble desde documentación pública consultada — si importa, la única
   forma de saberlo es el propio método D-26-03(3) (llamar a un teléfono
   propio en México y escuchar) antes y después de tramitar el servicio (si
   se tramita).

6. **Nombres exactos de las voces disponibles hoy en la cuenta Retell del
   user, en español** — inherentemente no documentable desde fuera; se
   resuelve en la sesión de preview en vivo del dashboard (D-26-03(2)).

7. **¿Cuánto crédito le queda hoy a la cuenta Retell del trial de $10
   mencionado en el research del milestone?** — no verificable desde este
   entorno. Chequear el dashboard de billing de Retell antes de planificar
   el tamaño exacto del primer lote de prueba.

## Sources

### Primary (HIGH confidence)
- `docs.retellai.com/deploy/telnyx` — guía dedicada Telnyx↔Retell, consultada 2026-07-31.
- `docs.retellai.com/deploy/custom-telephony` — overview de telefonía custom, consultada 2026-07-31.
- `docs.retellai.com/api-references/import-phone-number` — spec completa del endpoint `POST /import-phone-number`, consultada 2026-07-31.
- `docs.retellai.com/api-references/create-phone-call` — confirmación de `retell_llm_dynamic_variables` como pares string→string, consultada 2026-07-31.
- `docs.retellai.com/build/conversation-flow/node.md`, `transition-condition.md`, `function-node.md`, `custom-function.md`, `extract-dv-node.md`, `global-node.md`, `end-node.md`, `global-setting.md`, `conversation-node.md` — mecánica del builder, consultadas 2026-07-31.
- `docs.retellai.com/features/post-call-analysis-create.md`, `post-call-analysis-consumption.md` — extracción post-llamada, consultadas 2026-07-31.
- `docs.retellai.com/build/language-support.md` — tabla de proveedores TTS/ASR por idioma, consultada 2026-07-31.
- `docs.retellai.com/build/telephony/call_efficiency_overview.md`, `verified-phone.md`, `branded-call.md` — spam/reputación, consultadas 2026-07-31.
- `docs.retellai.com/reliability/troubleshoot-latency.md` — factores y valores de latencia, consultada 2026-07-31.
- `docs.retellai.com/agent/version.md` — versionado de agentes, consultada 2026-07-31.
- `docs.retellai.com/build/handle-voicemail.md` — detección nativa de voicemail/IVR, consultada 2026-07-31.
- Código fuente propio (`index.js`, líneas 15679+, y `.planning/phases/24-integracion-backend-retell/24-04-PLAN.md`, `24-05-SUMMARY.md`) — leído directamente para confirmar el shape esperado por `/book` y el webhook URL registrado.
- `.planning/phases/24-integracion-backend-retell/24-RESEARCH.md` — base heredada, todas las correcciones marcadas explícitamente donde este research las actualiza.

### Secondary (MEDIUM confidence)
- `retellai.com/pricing` — costos por componente, consultada 2026-07-31 (página de marketing, no documentación versionada — números tratados como CITED, no como spec técnica).
- `community.retellai.com/t/pre-connect-sip-during-ring-billing-before-human-answers/3115` — respuesta de un ingeniero de Retell sobre billing de la pata SIP; el escenario descrito no calza 100% con el de esta fase (ver §3) — MEDIUM porque es una fuente oficial de la empresa, pero no documentación formal ni necesariamente el mismo escenario.
- `elevenlabs.io/docs/eleven-agents/phone-numbers/telephony/telnyx` — usada solo como cross-check de nomenclatura del portal de Telnyx (labels de menú), no como fuente de hechos de Retell.
- WebSearch sobre voces ElevenLabs en español (nombres "Alisson", "Mateo", etc.) — agregados solo como sugerencias de punto de partida, marcados `[ASSUMED]` en §2.

### Tertiary (LOW confidence)
- Ninguna fuente tertiary usada — donde la evidencia fue insuficiente, se documentó como Unknown abierto (sección dedicada) en vez de forzar una conclusión de baja confianza.

## Metadata

**Confidence breakdown:**
- Setup del trunk (§1): MEDIUM-HIGH — guía oficial de Retell para Telnyx específicamente, cruzada con una segunda fuente independiente (ElevenLabs, mismo patrón de integración) que coincide en nomenclatura; el hueco real es que ningún doc cubre el conflicto de "número compartido con otro uso ya existente" porque es específico de esta cuenta.
- Voces (§2): MEDIUM en proveedores/costos (docs oficiales con cifras), LOW en nombres concretos de voces (no documentable desde fuera, inherente a cualquier research — el dashboard es la única fuente).
- Costos (§3): MEDIUM en la estructura de costo (múltiples fuentes oficiales coinciden), LOW-MEDIUM en el punto más importante (ring vs conectado) por la contradicción entre fuentes — tratado como el unknown #1, con plan de resolución concreto en vez de una respuesta forzada.
- Mecánica del builder (§4): HIGH — todo verificado contra páginas de documentación específicas por feature, con varias confirmadas cruzando WebSearch + WebFetch de forma independiente (ej. rangos de speech overrides).
- Caller ID/spam (§5): MEDIUM — hechos verificados, pero el efecto cruzado EEUU→México es una inferencia razonada, no confirmada.
- Latencia (§6): HIGH — página dedicada con cifras numéricas explícitas.
- Versionado (§7): MEDIUM-HIGH en el mecanismo general, LOW en el comportamiento específico que más importa para el piloto (`override_agent_version` omitido) — con plan de verificación de 5 minutos incluido.

**Research date:** 2026-07-31
**Valid until:** ~14 días para los hechos de producto de Retell (empresa con ~3 releases de SDK por semana según Phase 24 research — la documentación puede moverse rápido; si el plan se ejecuta después de mediados de agosto 2026, re-confirmar contra `docs.retellai.com` antes de seguir el documento al pie de la letra, especialmente §2 precios y §3 billing). El mapa del código propio (referencias a `index.js`) no vence salvo que el árbol se haya movido en paralelo (correr `git log`/`git status` antes de planificar, nota `user-commits-in-parallel`).

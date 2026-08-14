# Phase 24: Integración backend Retell - Research

**Researched:** 2026-07-31
**Domain:** Integración de una API de voice-AI (Retell) contra un backend Express/JSON existente (patrón ya resuelto para Telnyx) — webhooks firmados, dispatch saliente, tool calling, refactor de cascada de disposición.
**Confidence:** MEDIUM-HIGH (API de Retell: HIGH en los puntos con SDK/código fuente leído; MEDIUM en payloads de webhook sin ejemplo JSON completo publicado. Código propio: HIGH, todo verificado línea por línea contra HEAD `8f25324`.)

<user_constraints>
## User Constraints (de 24-CONTEXT.md — decisiones cerradas, NO re-litigar)

### Alcance de la fase
Todo el lado servidor del agente: una llamada de Retell entra y sale del
sistema exactamente como una llamada de SDR humana. Cubre VOICE-01..06:
config con secrets en env, refactor `_applyCallOutcome`, dispatch por lote,
tool `/book`, webhook firmado, pseudo-SDR `setter_agente_ia`.

NO incluye: UI del panel (Phase 25), el prompt/flow del agente ni el setup
del trunk (Phase 26), banco de conocimiento (Phase 27).

### Decisiones (D-24-01..09)

- **D-24-01 — Config = clon del patrón Telnyx.** `RETELL_ENV_FIELDS = {apiKey:'RETELL_API_KEY', webhookSecret:'RETELL_WEBHOOK_SECRET'}` con overlay env>JSON, `_retellEnvSourced()`, rechazo en PUT de campos env-sourced, sanitizador público. Campos JSON no-secretos: `agentId`, `fromNumberId` (''=round-robin), `dailyCap` (default 50), `enabled`, `rotationIdx`. Regla #21 COMPLETA: BACKUP_FILES (index.js:5732), export-data, import-data, seedVolumeFromRepo, scripts/pre-deploy.js — para `retell_config.json` Y `retell_events.json`.
  **⚠️ Corrección de esta research: ver §2.1 — `RETELL_WEBHOOK_SECRET` como campo SEPARADO de `RETELL_API_KEY` probablemente no hace falta.**

- **D-24-02 — El refactor de la cascada es EXTRACCIÓN, no reescritura.** `_applyCallOutcome(data, lead, logEntry, opts)` = literalmente index.js:10552-10675 movido a función (push+cap500, switch, calendarEntry shape 10607 con `sourceCall:true`, DNC, cadencia `MAX_NO_CONTACT=2`/+24h). El handler humano (sync) la llama; el webhook (async) la llama dentro de `mutateSettersData`. Gate de paridad: suite completa verde SIN cambios de números (`metrics-consistency` + `call-cadence` + `disposition-dnc` + `funnel-close`). Resuelve deuda M1 del audit 2026-06-20.
  **✅ Confirmado exacto contra HEAD, con precisión de límites en §3.1.**

- **D-24-03 — Dispatch selecciona SOLO de la cartera del agente.** `assignedTo==='setter_agente_ia'` + `_leadIsCallableNow(l, now)` (index.js:9175 — ya excluye DNC/tarifa-roja/muertos/callbacks futuros/estados terminales) + filtro país por prefijo + filtro opcional `withDoctor` (lead.doctor no vacío). Cap: `min(count, dailyCap - llamadasDeHoyDelAgente)`. Loop `_runPool` conc 2-3, fetch timeout 15s. El lote se asigna al agente ANTES vía `pool-distribute` existente (cero código nuevo para asignación).

- **D-24-04 — Caller ID server-side.** Portar `pickNumberForDestination` (public/app.js:2270) a index.js: routing explícito de `telnyx_config.countryRouting` gana → si no, round-robin entre `numbers` activos con `rotationIdx` persistido en retell_config.json → default. El frontend NO se toca (su copia sigue para el dialer humano).
  **⚠️ Ver §2.6 — el número usado como `from_number` debe estar IMPORTADO en Retell (Phase 26); el código de Phase 24 puede/debe escribirse igual, pero fallará en runtime hasta que el import exista.**

- **D-24-05 — Una sola escritura de callLog por llamada.** `/book` NO aplica outcome: crea el calendarEntry (`mutateSettersData`), marca `_pendingBooked` (Map en memoria con TTL, respaldo: extraction `agendo` del webhook) y devuelve texto leíble en voz alta. El webhook `call_analyzed` decide el outcome: booked → `scheduled_with_admin` (SIN volver a crear la cita — pasar flag a `_applyCallOutcome` o crear la cita solo en /book y saltear la rama del switch; resolver en plan); no conectó → `no_answer`/`voicemail` según `disconnection_reason`; conectó sin agendar → extraction de Retell decide (interes/callback_fecha_hora/objecion) con `_autoDispositionLLM` (index.js:16232) como fallback y `answered_not_interested` como último recurso. `callback_fecha_hora` de la extraction → `callbackAt` (validar rango: futuro, ≤90 días). `nota_seguimiento` → notes[] con `by:'Agente IA'`. `doctor_name`/`recepcionista_nombre` → lead.doctor / nota (solo si vacíos).
  **⚠️ Ver §2.3 — `call_analyzed` puede NO dispararse para llamadas que no conectaron; el webhook necesita también manejar `call_ended`.**

- **D-24-06 — Webhook = patrón Telnyx completo.** rawBody: agregar la ruta al `verify` de express.json (index.js:108-118, match exacto de req.url). Firma `x-retell-signature`: verificar el formato EXACTO contra el SDK de Retell al implementar (docs dicen "verify del SDK con el API key con webhook badge" — no asumir HMAC crudo; si el SDK Node es instalable, usarlo; si no, replicar su verify leyendo su source). 401 con contador en memoria + fail-closed 503 en producción sin secret + FIFO `retell_events.json` cap 1000 + health en el GET de config.
  **✅ Resuelto en §2.1 — algoritmo exacto verificado leyendo el source real del SDK.**

- **D-24-07 — Atribución sin user sintético.** logEntry con `by:''` → `_callSetterId` cae a `assignedTo` = `setter_agente_ia` (criterio #149). `channel:'retell'` → fuera de Centralita (match exacto 7318, intencional), dentro de funnel/Comando/Equipo. Costo estimado con `_estimateTelnyxCost`; verificar si la reconciliación CDR (15441) exige channel `'telnyx_webrtc'` y aflojar para incluir `'retell'`.
  **⚠️ Corrección: `_estimateTelnyxCost` NO es reusable tal cual — está anidada dentro del handler humano (§3.1). El CDR gate real está en 15428, no 15441, y SÍ exige match exacto (§3.4).**

- **D-24-08 — Transcript de Retell → shape Whisper.** agent→'setter', user→'lead', conservar start/end si vienen; `transcribedAt` + `source:'retell'`. Con eso biblioteca/resumen/análisis funcionan sin tocar (verificado: solo consumen speaker+text+start).
  **✅ Confirmado, con matiz de cómo derivar start/end (§2.4).**

- **D-24-09 — `setter_agente_ia`** se crea por el flujo normal de setters (name "Agente IA", sin user vinculado, NO hidden). Si el POST de setters exige user, script one-shot mínimo. Verificar que aparece en Equipo/Comando/Distribución sin excepciones raras (p.ej. filtros de `_filterSettersVisible` / ADMIN_ONLY_SETTER_IDS NO deben incluirlo).
  **✅ Confirmado — NO hace falta script one-shot, hay un helper idempotente reusable (§3.6).**

### Specifics

- Rutas nuevas: `GET/PUT /api/retell/config`, `POST /api/admin/voice-agent/dispatch`, `POST /api/retell/tool/book`, `POST /api/retell/webhook`. Regla #3: sin `:id` — orden libre, pero montarlas cerca del bloque Telnyx para coherencia.
- Tests nuevos: `tests/retell-webhook.test.js`, `tests/retell-dispatch.test.js`, `tests/apply-call-outcome.test.js` (paridad con fixture doble vía). Patrón: `process.env.RETELL_API_KEY = ""` (NUNCA delete, regla #121); fixtures con teléfonos ≥7 dígitos (regla #163).
- Variables dinámicas del dispatch: nombre, ciudad, reviews, rating, years, doctor_name, openingAngle/hookPhrase, leadId, whatsapp (número de retorno del user — configurable en retell_config.json).
- `retell_events.json` FIFO 1000 con `verified` por evento (patrón Telnyx).

### Deferred (fuera de esta fase)

- Reintentos automáticos del dispatch ante fallo de la API de Retell (v1: reporta el fallo por lead y sigue).
- Batch API nativa de Retell (si existiera) — v1 dispara de a una con pool.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Descripción | Research Support |
|----|-------------|------------------|
| VOICE-01 | Config Retell env>JSON, regla #21 completa | §2.1 (nombre real del secret), §3.4 (patrón Telnyx exacto a clonar), §5.2 (gap real en seedVolumeFromRepo) |
| VOICE-02 | `_applyCallOutcome` extraído, paridad exacta | §3.1 (límites exactos de la extracción, qué NO entra), §5.1 (estrategia de test de paridad) |
| VOICE-03 | Dispatch por lote con caller ID server-side | §2.2 (shape de create-phone-call), §2.5 (correlación), §2.6 (from_number debe estar importado), §3.2/§3.5 (helpers reusables) |
| VOICE-04 | Tool `/book` con header secreto | §2.2.b (shape exacto del request de function call, auth por custom header confirmada, sin retries) |
| VOICE-05 | Webhook firmado + mapeo transcript/outcome | §2.1 (firma), §2.3 (eventos y disconnection_reason), §2.4 (transcript_object), §5.3 (riesgo de timeout/idempotencia) |
| VOICE-06 | Pseudo-SDR `setter_agente_ia` | §3.6 (`ensureSetterProfile`, sin script one-shot necesario) |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

Directivas del proyecto con la misma autoridad que las decisiones cerradas de CONTEXT.md:

- **Regla #3**: rutas Express sin `:id` DEBEN ir ANTES de rutas con `:id`. Las 4 rutas nuevas de esta fase no tienen `:id`, así que no hay riesgo de colisión — pero si en el futuro se agrega algo como `/api/retell/config/:field`, va después.
- **Regla #19 (mutex async)**: cualquier handler ASYNC que mute `setters.json` debe usar `mutateSettersData(mutator)`. El webhook y `/book` son ambos async (llaman a la API de Retell / hacen I/O) → OBLIGATORIO. El handler humano de `call-disposition` es SYNC y sigue con `loadSettersData()`/`saveSettersData()` directo — el refactor D-24-02 NO debe cambiar esto.
- **Regla #21 (persistencia completa)**: todo archivo JSON nuevo debe aparecer en `BACKUP_FILES` (index.js:5732), `/api/admin/export-data` + `/api/admin/import-data`, `seedVolumeFromRepo()` (index.js:5671) y `scripts/pre-deploy.js`. Ver §5.2 para un hueco real ya existente en el patrón Telnyx que NO hay que copiar ciegamente.
- **Regla #9**: `data.leads` es un MAP (`Object.keys`, nunca `.length` como si fuera array). Igual para `data.calendar` que SÍ es array.
- **Regla #121 (tests)**: variables de entorno de IA/proveedores en tests se setean a `""`, NUNCA `delete` (dotenv repone las borradas). Aplica también a `RETELL_API_KEY`/`RETELL_WEBHOOK_SECRET` en los tests nuevos.
- **Regla de fixtures de teléfono**: `_leadIsCallableNow` exige ≥7 dígitos en `lead.phone` — cualquier fixture de test para dispatch/webhook necesita teléfonos realistas (ver casos reales de ruptura en notas #163 de CLAUDE.md: `+521` de 3 dígitos rompía tests).
- **Cache-buster**: esta fase es 100% backend (`index.js` + JSON nuevos + tests). NO toca `app.js`/`style.css`/`index.html` → **no corresponde bump de cache-buster** en esta fase (sí en Phase 25).
- **Deploy**: `npm run pre-deploy` antes de cualquier push; Railway escucha `main`. Los secrets de Retell deben limpiarse en `scripts/pre-deploy.js` con el mismo patrón que Telnyx (§3.4) para no commitear el API key.
- **Trabajo en paralelo (nota MEMORY.md `user-commits-in-parallel`)**: el user trabaja el mismo repo en simultáneo. Antes de empezar, correr `git status`/`git log` para no asumir el estado del árbol.
- **Security**: patrón "env vars > JSON, self-healing" (Telnyx) es el estándar del proyecto para credenciales — no inventar un mecanismo nuevo.

## Summary

El research confirma que el plan de CONTEXT.md es en general correcto y ejecutable, con **cuatro correcciones concretas** que cambian detalles de implementación (no el rumbo):

1. **La firma del webhook de Retell usa HMAC-SHA256 con el MISMO `RETELL_API_KEY`** (no HMAC crudo, no una clave separada por defecto) — verificado leyendo el código fuente real de `retell-sdk@5.53.0` (`lib/webhook_auth.mjs`). El campo `RETELL_WEBHOOK_SECRET` de D-24-01 probablemente sobra; ver §2.1.
2. **`call_analyzed` no está garantizado para llamadas que nunca conectaron** (`dial_no_answer`, `dial_failed`, `dial_busy` — reportado en la comunidad de Retell, y el soporte de Retell no lo contradice del todo). El webhook debe escuchar también `call_ended` (que SÍ dispara siempre) para esos casos, no solo `call_analyzed`. Esto afecta directamente el diseño de VOICE-05.
3. **`_estimateTelnyxCost` está definida DENTRO del handler `call-disposition`** (anidada, no en scope de módulo) — el webhook de Retell no puede llamarla tal cual. Hay que hoistearla (junto con `_detectCountryAndType` y la tabla hardcoded) al scope de módulo como parte de esta fase — no es opcional, VOICE-05 la necesita para calcular costo.
4. **El webhook de Retell tiene timeout de 10s con 3 reintentos si no responde 2xx** — más corto que el timeout interno de `_autoDispositionLLM` (15s). El handler debe reconocer rápido (ack) y hacer el trabajo pesado (fallback LLM + escritura) de forma que sobreviva a un reintento sin duplicar el callLog (idempotencia por `call_id`).

El resto de las decisiones (D-24-02 a D-24-04, D-24-08, D-24-09) están confirmadas casi literalmente contra el código real, con ubicaciones de línea corregidas donde se movieron ligeramente desde que CONTEXT.md las citó.

**Primary recommendation:** implementar en el orden que sugiere el ROADMAP (24-01 config+refactor, 24-02 dispatch+book, 24-03 webhook+pseudo-SDR), pero mover el hoisting de `_estimateTelnyxCost` al plan 24-01 (junto al refactor de `_applyCallOutcome`, mismo tipo de cambio) y diseñar el webhook de 24-03 alrededor de DOS eventos (`call_ended` + `call_analyzed`), no uno solo.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Verificación de firma del webhook | API/Backend | — | Debe correr server-side con el API key, nunca expuesto al browser (mismo principio que Telnyx, CLAUDE.md decisión arquitectónica #1) |
| Dispatch de llamadas salientes | API/Backend | — | Único punto con la Retell API key; el admin dispara desde el panel (Phase 25) pero la llamada HTTP a Retell la hace el server |
| Selección de caller ID | API/Backend | — | D-24-04 — portado desde el frontend (que solo lo usa para el dialer humano) porque el dispatch no tiene browser |
| Cascada de disposición (`_applyCallOutcome`) | API/Backend | — | Lógica de negocio pura sobre `setters.json`; ni Retell ni el frontend deben conocerla |
| Tool `/book` (booking mid-call) | API/Backend | — | Invocado por Retell (server-to-server), protegido por secret estático, nunca por el browser |
| Persistencia (`retell_config.json`, `retell_events.json`) | Database/Storage | — | Mismo patrón JSON file-based que el resto del proyecto — Railway Volume |
| Atribución de métricas (`_callSetterId`, CALL METRICS CORE) | API/Backend | — | Cero cambios de código — la atribución cae sola por `by:''`→`assignedTo` |

## §2. API de Retell — hechos verificados

Consultado: 2026-07-31, vía WebSearch/WebFetch de `docs.retellai.com`, `community.retellai.com`, y lectura directa del código fuente de `retell-sdk@5.53.0` descargado con `npm pack` (no solo metadata del registro).

### §2.1 — Firma del webhook (D-24-06, el hueco más importante) — VERIFIED (HIGH)

**Header:** `X-Retell-Signature` (case-insensitive en HTTP, Express normaliza a lowercase — usar `req.headers['x-retell-signature']`).

**Formato del valor:** `v={timestamp_ms},d={hex_digest}` — regex `^v=(\d+),d=([0-9a-f]+)$`. El timestamp va DENTRO de la firma (no hay un header de timestamp separado, a diferencia de Telnyx que usa `telnyx-timestamp` aparte).

**Qué se firma:** `HMAC-SHA256(rawBody + timestamp)` donde `timestamp` es el mismo valor numérico embebido en `v=`. NO es "rawBody solo" ni "rawBody + header timestamp separado" — es el string `rawBody` concatenado directamente con el número del timestamp (sin separador).

**Qué secret se usa:** el **API key de Retell** — literalmente el mismo valor que se usa como Bearer token para llamar a la API REST (`create-phone-call`, etc.), no un secret distinto. Verificado leyendo el código fuente real (`node_modules/retell-sdk/lib/webhook_auth.mjs` tras `npm pack retell-sdk@5.53.0`):

```javascript
// lib/webhook_auth.mjs — retell-sdk@5.53.0, código real (no paráfrasis)
export const symmetric = {
  async sign(input, secret, timestamp = Date.now()) {
    const digest = await hmacSha256Hex(secret, input + timestamp);
    return `v=${timestamp},d=${digest}`;
  },
  async verify(input, secret, signature, opts = {}) {
    const match = /^v=(\d+),d=([0-9a-f]+)$/i.exec(signature);
    if (!match) return false;
    const poststamp = Number(match[1]);
    const postDigest = hexToBytes(match[2]);
    const timestamp = opts.timestamp ?? Date.now();
    const timeout = opts.timeout ?? FIVE_MINUTES; // 5*60*1000
    if (!Number.isSafeInteger(poststamp) || !Number.isFinite(timestamp) ||
        !Number.isFinite(timeout) || timeout < 0 || !postDigest ||
        Math.abs(timestamp - poststamp) > timeout) {
      return false;
    }
    return hmacSha256Verify(secret, input + poststamp, postDigest);
  },
};
export const verify = (body, apiKey, signature) => symmetric.verify(body, apiKey, signature);
```

`hmacSha256Verify`/`hmacSha256Hex` usan `globalThis.crypto.subtle` (Web Crypto API — disponible en Node 20+ sin flags) con `importKey('raw', ..., {name:'HMAC', hash:'SHA-256'}, false, ['verify'])` y `subtle.verify(...)` — comparación en tiempo constante nativa, no hace falta implementar `crypto.timingSafeEqual` a mano.

**Anti-replay:** ventana default de 5 minutos (`FIVE_MINUTES = 5*60*1000`), igual que Telnyx (300s) — coincidencia útil, el mismo umbral que ya usa `_verifyTelnyxSignature`.

**Sample oficial de Node.js/Express** (docs.retellai.com/features/secure-webhook, quote verbatim):

```typescript
import { Retell } from "retell-sdk";
import express from "express";

const app = express();
app.use(express.raw({ type: "application/json" }));

app.post("/webhook", async (req, res) => {
  const rawBody = req.body.toString("utf-8");
  const signature = req.headers["x-retell-signature"];
  if (typeof signature !== "string" ||
      !(await Retell.verify(rawBody, process.env.RETELL_API_KEY, signature))) {
    console.error("Invalid signature");
    return res.status(401).send("Unauthorized");
  }
  const { event, call } = JSON.parse(rawBody);
  res.status(204).send();
});
```

**⚠️ Nota importante — este sample usa `express.raw()` dedicado a la ruta.** El proyecto YA tiene un patrón mejor establecido (el `verify` callback global de `express.json()`, índex.js:108-118) que captura `req.rawBody` SOLO para rutas específicas sin bifurcar el middleware. Es directamente compatible: agregar `req.url === '/api/retell/webhook'` a la condición del `verify` y usar `req.rawBody` tal como ya hace Telnyx. NO hace falta adoptar `express.raw()` — de hecho, mezclar ambos patrones en el mismo archivo sería inconsistente. `req.body` ya vendría parseado por `express.json()`, así que el `JSON.parse(rawBody)` del sample de Retell es redundante en este proyecto (usar `req.body` directamente, igual que hace el handler de Telnyx en la línea 15578).

**Corrección concreta a D-24-01/D-24-06:** el diseño de `RETELL_ENV_FIELDS = {apiKey:'RETELL_API_KEY', webhookSecret:'RETELL_WEBHOOK_SECRET'}` con DOS secrets separados probablemente no corresponde — Retell no tiene el concepto de "signing secret" distinto del API key (a diferencia de Telnyx, que sí separa `apiKey` de `signaturePublicKey` porque usa ed25519 asimétrico). Lo único variable es CUÁL de tus API keys de Retell tiene el "webhook badge" habilitado en su dashboard (un concepto de UI del lado de Retell, no dos valores distintos en nuestro sistema). **Recomendación:** usar un solo `RETELL_API_KEY` para ambos propósitos (Bearer auth saliente Y verify entrante). Si se quiere dejar un campo `webhookSecret` por flexibilidad futura, que haga fallback a `apiKey` cuando esté vacío — nunca debe ser un campo obligatorio aparte.

**NPM package — VERIFIED (HIGH):**
- Nombre: `retell-sdk` (no `retell-client-js-sdk`, que es el SDK de **cliente/browser** para llamadas WebRTC — un paquete completamente distinto, no confundir).
- Versión actual: `5.53.0` (publicada 2026-07-30T20:28:51Z — un día antes de esta research).
- Paquete creado 2023-12-11, **234 versiones publicadas**, releases activos (3 el mismo día 2026-07-30) — desarrollo activo, no abandonado.
- `repository.url`: `github.com/RetellAI/retell-typescript-sdk` (org oficial de la empresa). `author`: `Retell <support@retellai.com>`. Maintainers con emails `@retellai.com`/`@re-tell.ai`.
- `"dependencies": {}` — **cero dependencias runtime** (usa solo Web Crypto API nativa para el verify) — superficie de supply-chain mínima.
- Exports duales CJS/ESM vía `exports` map (`.mjs` para `import`, `.js` para `require`) — instalable sin fricción en este proyecto (`"type": "module"`, Node 20+). `import { Retell } from "retell-sdk"` resuelve al build ESM.
- `verify`/`sign` se exportan TANTO como named exports del módulo (`export { verify, sign } from "./lib/webhook_auth.mjs"`) COMO propiedades estáticas de la clase `Retell` (el sample oficial usa `Retell.verify(...)`) — ambas formas funcionan; usar `Retell.verify(...)` como en el sample oficial es lo más legible.

### §2.2 — API de creación de llamada saliente (D-24-03) — VERIFIED (HIGH)

**Endpoint:** `POST https://api.retellai.com/v2/create-phone-call`
**Auth:** `Authorization: Bearer <RETELL_API_KEY>`

**Body:**
| Campo | Tipo | Requerido | Notas |
|---|---|---|---|
| `from_number` | string E.164 | ✓ | **Debe ser un número que "posees" en Retell** — ver §2.6, condiciona D-24-04 |
| `to_number` | string E.164 | ✓ | |
| `override_agent_id` | string | — | agente a usar para esta llamada |
| `override_agent_version` | string\|integer | — | `"latest_published"` o número |
| `metadata` | object | — | arbitrario, se ECOA en la respuesta y (según el shape confirmado en §2.2.b) también llega en los webhooks/function-calls posteriores |
| `retell_llm_dynamic_variables` | object | — | **pares string→string** — inyectados en el prompt. ⚠️ Verificar que los valores numéricos (`reviews`, `rating`, `yearsActive`) se pasen como STRING, no number — la doc no confirma coerción automática |
| `custom_sip_headers` | object | — | no usado en v1 |
| `ignore_e164_validation` | boolean | — | no usado en v1 |

**Respuesta (201):** `call_id` (string, ej. `"Jabr9TXYYJHfvl6Syypi88rdAHYHmcq6"`), `agent_id`, `agent_version`, `call_status` (`"registered"` inicial), `from_number`, `to_number`, `direction:"outbound"`, `call_type:"phone_call"`, `metadata` (echo).

`call_id` es la clave de correlación primaria: se puede guardar junto al leadId en un Map en memoria (`_pendingRetellCalls`) o simplemente confiar en que `metadata`/`retell_llm_dynamic_variables` vuelven completos en los eventos posteriores (ver §2.5).

### §2.2.b — Custom function / tool `/book` (D-24-05, hueco #2) — VERIFIED (HIGH, docs.retellai.com/build/conversation-flow/custom-function)

**Request que Retell manda a la URL configurada** (POST, application/json):

```json
{
  "name": "book",
  "call": {
    "call_id": "...",
    "agent_id": "...",
    "call_type": "phone_call",
    "call_status": "ongoing",
    "start_timestamp": 1234567890,
    "transcript": "...",
    "transcript_object": [...],
    "metadata": { "...": "..." },
    "retell_llm_dynamic_variables": { "leadId": "...", "...": "..." }
  },
  "args": {
    "fecha": "...",
    "hora": "..."
  }
}
```

Existe un toggle **"Payload: args only"** en la config del function node que, si se activa, manda SOLO el objeto `args` en el top level (sin `name`/`call`). Confirmar en el documento del agente (Phase 26) cuál modo se eligió; si se deja en el modo default (con `call` incluido), el handler de `/book` puede leer `leadId` de `req.body.call.retell_llm_dynamic_variables.leadId` sin depender del header secreto para la correlación (el secreto es solo autenticación).

**Autenticación — CONFIRMADO el mecanismo que CONTEXT.md asumía:** el function node tiene una sección de **"Custom Headers"** configurable en el dashboard de Retell, donde se puede definir un header estático (ej. `x-scm-tool-secret: <valor fijo>`) que Retell manda en TODAS las invocaciones a esa función. Esto es exactamente D-24-05/VOICE-04 tal como está escrito — no hace falta inventar nada nuevo, solo documentar en el "agente cargable" (Phase 26) que hay que setear ese header en el dashboard.

Alternativamente, Retell TAMBIÉN manda `X-Retell-Signature` en las llamadas a custom functions (mismo mecanismo HMAC de §2.1) — se podría verificar con `Retell.verify()` en vez de (o además de) el header estático. El header estático es más simple de operar (no depende de tener el API key disponible en ese código path) y es lo que ya asumía el CONTEXT — mantenerlo como mecanismo primario.

**Timeout:** default 120000ms, configurable — el research del milestone (§curso Retell) ya anotó bajarlo a 5000ms en el dashboard (decisión de Phase 26, no de código).

**⚠️ Sin reintentos:** "Retell no reintenta una custom function" si falla o da timeout (a diferencia del webhook, que SÍ reintenta — ver §2.3). Esto significa que `/book` debe ser rápido y confiable en el primer intento; si `mutateSettersData` está momentáneamente ocupado por otra escritura, el agente puede quedarse sin respuesta y decirle al lead algo genérico. No hay ventana de recuperación del lado de Retell — la única red de seguridad es la extracción `agendo` del webhook post-call (ya prevista en D-24-05 como respaldo).

**Respuesta esperada:** cualquier body con status 2xx; "todo lo que devuelvas se convierte a string y se le pasa al LLM del agente" — un objeto JSON simple (ej. `{ok:true, message:"Quedó agendado para el jueves a las 14"}`) es seguro; el campo relevante para que el agente lo lea en voz alta es texto libre, no hay un schema de respuesta obligatorio documentado. Recomendación: devolver un campo de texto plano corto y dejar que Retell lo estringifique — no hace falta un shape complejo.

### §2.3 — Eventos de webhook y `disconnection_reason` (D-24-05, hueco #3) — VERIFIED (HIGH para el catálogo, MEDIUM para la fiabilidad de `call_analyzed`)

**Eventos de llamada** (docs.retellai.com/features/webhook):

| Evento | Cuándo dispara | Payload |
|---|---|---|
| `call_started` | al iniciar la llamada | info básica |
| `call_ended` | al terminar/transferir/errorear — **SIEMPRE dispara** | call completo MENOS `call_analysis` |
| `call_analyzed` | cuando termina el análisis post-call | call completo INCLUYENDO `call_analysis` |
| `transcript_updated` | en cada turno + update final | call completo + `transcript_with_tool_calls` |
| `transfer_*` | eventos de transferencia (no usado en v1, sin transferencia) | |

**⚠️ HALLAZGO CRÍTICO — `call_analyzed` no está garantizado para llamadas sin conversación real.** Un hilo de la comunidad oficial de Retell (`community.retellai.com/t/no-call-analyzed-webhook-for-some-disconnection-reasons/387`) reporta que el webhook `call_analyzed` no llega para varias llamadas con `disconnection_reason` como `dial_no_answer`, `dial_failed`, `dial_busy`. El soporte de Retell responde que "debería" seguir disparando, pero explica que "los campos de análisis post-call no se poblarán para llamadas que no conectaron o donde no hubo conversación" — lo cual, en la práctica, puede significar que el evento no llega o llega con `call_analysis` vacío/nulo, dependiendo de la implementación exacta (la evidencia community-sourced no zanja cuál de las dos cosas pasa). **[CITED: community.retellai.com — MEDIUM confidence, contradicho parcialmente por el propio soporte de Retell]**

**Consecuencia de diseño (corrige D-24-05):** el webhook `/api/retell/webhook` NO puede depender EXCLUSIVAMENTE de `call_analyzed` para decidir el outcome. Diseño recomendado:
- Escuchar `call_ended` Y `call_analyzed` (ambos llegan al mismo endpoint, distinguibles por `event`/`event_type` en el body).
- Con `call_ended`: si `disconnection_reason` indica que la llamada NUNCA conectó (`dial_no_answer`, `dial_failed`, `dial_busy`, `invalid_destination`, `registered_call_timeout`, `no_valid_payment`, `telephony_provider_*`, `sip_routing_error`), aplicar el outcome (`no_answer`/`voicemail`/etc — mapeo abierto, ver §6) DE INMEDIATO vía `_applyCallOutcome`, sin esperar `call_analyzed`.
- Con `call_analyzed`: si llega (para llamadas que sí conectaron), usar la extracción rica (`custom_analysis_data`) para decidir el outcome final, reemplazando/completando lo que `call_ended` ya haya aplicado.
- **Idempotencia obligatoria:** ambos eventos pueden llegar para la MISMA llamada — el handler necesita reconocer que ya procesó ese `call_id` (guardar `retellCallId` en el `logEntry` y chequear duplicados antes de pushear un segundo entry) para no duplicar el callLog ni aplicar la cascada dos veces.

**`disconnection_reason` — catálogo completo verificado** (docs.retellai.com/api-references/get-call, 32 valores):

`user_hangup` · `agent_hangup` · `call_transfer` · `voicemail_reached` · `ivr_reached` · `inactivity` · `max_duration_reached` · `concurrency_limit_reached` · `no_concurrency_fallback` · `no_valid_payment` · `scam_detected` · `dial_busy` · `dial_failed` · `dial_no_answer` · `invalid_destination` · `telephony_provider_permission_denied` · `telephony_provider_unavailable` · `sip_routing_error` · `marked_as_spam` · `user_declined` · `error_llm_websocket_open` · `error_llm_websocket_lost_connection` · `error_llm_websocket_runtime` · `error_llm_websocket_corrupt_payload` · `error_no_audio_received` · `error_asr` · `error_retell` · `error_unknown` · `error_user_not_joined` · `registered_call_timeout` · `transfer_bridged` · `transfer_cancelled` · `manual_stopped` · `call_take_over`

**El mapeo de estos 32 valores a los 2 buckets automáticos del sistema (`no_answer`/`voicemail`) NO está prescripto por CONTEXT.md ni por esta research — es una decisión de diseño que el plan/discuss debe fijar explícitamente.** Sugerencia razonable basada en semántica (no verificada contra comportamiento real de Retell, marcar como ASSUMED):
- → `voicemail`: `voicemail_reached`, `ivr_reached` (el sistema no distingue buzón de IVR automatizado — ambos son "no habló un humano")
- → `no_answer`: `dial_no_answer`, `dial_busy`, `dial_failed`, `invalid_destination`, `registered_call_timeout`, `telephony_provider_*`, `sip_routing_error`, todos los `error_*` (fallas técnicas — tratarlas como no-contacto retentable tiene sentido salvo que se repitan mucho, en cuyo caso la cadencia `MAX_NO_CONTACT=2` ya las descarta solas)
- → `hung_up`: `user_hangup`/`agent_hangup` CON transcript vacío o muy corto (< unos segundos) — atendió y cortó, igual que el outcome humano `hung_up`
- casos raros (`scam_detected`, `marked_as_spam`, `no_valid_payment`, `concurrency_limit_reached`) → loguear como warning y tratar como `no_answer` por default (no bloquear la cadencia, pero no son casos de negocio reales)

**`call_analysis` (solo en `call_analyzed`):**
- `call_summary: string`
- `in_voicemail: boolean` — señal adicional/redundante a `disconnection_reason==='voicemail_reached'`
- `user_sentiment: "Negative"|"Positive"|"Neutral"|"Unknown"`
- `call_successful: boolean`
- `custom_analysis_data: object` — el shape exacto depende de la **Post Call Data Extraction** configurada en el agente (Phase 26): las claves configuradas ahí (`atendio`, `doctor_name`, `recepcionista_nombre`, `interes`, `objecion_principal`, `callback_fecha_hora`, `email`, `agendo`, `nota_seguimiento` según el diseño del milestone) aparecen tal cual, con los tipos declarados en el dashboard.

### §2.4 — Shape del transcript (D-24-08) — VERIFIED (HIGH)

`transcript_object` es un array de **utterances** (turnos de habla), NO segmentos palabra-por-palabra a nivel item:

```
{
  role: "agent" | "user" | "transfer_target",
  content: string,          // texto completo del turno
  words: [{ word: string, start: number, end: number }]  // timing por palabra
}
```

**Esto es distinto de la forma en que se leyó inicialmente** (no hay un `start`/`end` a nivel del item de `transcript_object` — solo dentro de `words[]`). Para mapear al shape que el sistema ya usa (`{speaker, start, end, text}`, ver §3.3), el mapeo correcto es:

```javascript
// Mapeo Retell transcript_object → shape Whisper del sistema
const segments = (call.transcript_object || []).map(u => ({
  speaker: u.role === 'agent' ? 'setter' : 'lead',  // transfer_target no aplica en v1 (sin transferencia)
  start: u.words?.[0]?.start ?? 0,
  end: u.words?.[u.words.length - 1]?.end ?? 0,
  text: u.content || '',
}));
```

Esto es un ajuste de implementación sobre D-24-08 (que decía "conservar start/end si vienen" sin especificar que hace falta derivarlos de `words[]`), no una corrección de rumbo.

También existe un campo `transcript` (string plano, formato humano-legible tipo "Agent: ... User: ..."), útil solo como fallback de debug, no necesario para el mapeo.

### §2.5 — Correlación llamada↔lead — VERIFIED (HIGH)

Confirmado en el shape de la function-call request (§2.2.b) que TANTO `metadata` COMO `retell_llm_dynamic_variables` viajan completos en el objeto `call` — y por extensión (documentado como "mismo contenido que el get-call API") también en los eventos de webhook `call_ended`/`call_analyzed`. Esto da DOS vías redundantes para correlacionar:

1. `retell_llm_dynamic_variables.leadId` — ya planeado en D-24-03 ("Variables dinámicas del dispatch: ... leadId (correlación)").
2. `metadata.leadId` — si además se pasa `metadata: {leadId}` en el `create-phone-call` inicial.

**Recomendación:** pasar `leadId` en AMBOS (`metadata` y `retell_llm_dynamic_variables`) por redundancia — es gratis (un campo más en el body) y blinda contra el caso de que alguna configuración del agente en Retell no propague dynamic variables a algún evento por alguna razón no documentada. El webhook debe intentar `call.metadata?.leadId` primero (más simple, no pensado para prompts) y caer a `call.retell_llm_dynamic_variables?.leadId` si falta.

### §2.6 — Número saliente / trunk (huecos #6, condiciona D-24-04) — PARTIALLY VERIFIED (MEDIUM)

**Confirmado (HIGH, de la doc del endpoint create-phone-call):** `from_number` debe ser "a phone number in E.164 format **you own**" — es decir, un número que Retell reconoce como perteneciente a la cuenta.

**Confirmado (MEDIUM, de docs.retellai.com/deploy/custom-telephony, sin el detalle paso a paso completo):** Retell soporta **elastic SIP trunking** con proveedores externos (Telnyx es "proveedor de primera clase" según el research del milestone) — el flujo es: configurar el trunk (termination/origination hacia los SIP URIs de Retell, auth por credenciales ya que el SIP server de Retell no tiene IP fija) y luego **"importar" cada número existente a Retell** para poder usarlo. La página no detalla si el import es vía dashboard únicamente o si hay un endpoint de API para importarlo — no se encontró evidencia de un endpoint tipo `POST /v2/import-phone-number` en la documentación consultada. **Esto queda como unknown para Phase 26, no para esta fase** (ver §6).

**Impacto en Phase 24 (no invalida D-24-04, solo la condiciona):** el código de rotación/selección de caller ID (D-24-04) puede y debe escribirse ahora sobre el MISMO array `telnyx_config.numbers` que ya existe — es correcto arquitectónicamente. Pero **hasta que Phase 26 importe esos números a la cuenta de Retell, cualquier llamada de dispatch fallará en la API de Retell** (probablemente con un 400/422 indicando que el `from_number` no es válido). Esto es exactamente el escenario que D-24-03/deferred ya contempla ("v1: reporta el fallo por lead y sigue") — el diseño ya es resiliente a esto, solo hay que asegurarse de que el error de Retell por número no reconocido caiga en esa misma rama de manejo de errores por-lead (no un crash del batch completo).

## §3. Mapa del código — ubicaciones verificadas (HEAD `8f25324`)

Todas las líneas de esta sección fueron leídas directamente del archivo, no inferidas.

### §3.1 — La cascada de disposición: límites exactos de la extracción (D-24-02)

`POST /api/setters/leads/:id/call-disposition` — **index.js:10301** (handler SYNC, confirmado).

El handler tiene MÁS lógica de la que entra en `_applyCallOutcome`. Mapa preciso de qué SÍ y qué NO se extrae:

| Bloque | Líneas | ¿Entra en `_applyCallOutcome`? |
|---|---|---|
| `CALL_OUTCOMES` (whitelist) | 10272-10283 | Constante de módulo, no se mueve — usada por el endpoint para validar `outcome` ANTES de llamar al helper |
| `DISQUALIFY_REASONS` / `DNC_REASONS` | 10287-10299 | Constantes de módulo, no se mueven |
| Auth/ownership check (callback compartido) | 10305-10317 | **NO** — específico del endpoint humano (auth de sesión) |
| Parseo de body + validación de `outcome`/`cleanReason`/`cleanObjectionTags` | 10319-10337 | **NO** — el webhook arma su propio `logEntry` con su propia validación de extracción de Retell |
| `correctsAutoMarked` (Phase 20, corrección de auto-marca) | 10343-10371 | **NO** — feature específica del dialer humano (corregir la última auto-marca), no aplica a llamadas de Retell |
| `_estimateTelnyxCost` + `_detectCountryAndType` + `TELNYX_RATES_USD_PER_MIN` (anidadas) | 10378-10478 | **NO se mueven dentro del helper, pero DEBEN hoistearse a scope de módulo en esta misma fase** — ver corrección abajo |
| Construcción de `logEntry` base (ts/outcome/by/notes) | 10480-10486 | **NO** — cada caller (handler humano, webhook) arma su propio `logEntry` con sus propios campos (`by`, `channel`, `telnyxCallMeta` vs los de Retell) ANTES de llamar al helper |
| `telnyxCallMeta` → duration/fromNumber/channel/cost en `logEntry` | 10492-10515 | **NO** — el webhook llenará estos mismos campos con SU propia fuente de datos (duración de Retell, `channel:'retell'`, costo estimado) |
| `autoMarked`/`preCadence` snapshot | 10519-10537 | **NO** — Phase 20, específico del dialer humano |
| Herencia de ts/metadata en corrección | 10539-10550 | **NO** — ídem |
| **`lead.callLog.push(logEntry)` + cap 500** | **10552-10555** | **SÍ — inicio real de la extracción** |
| `callAttempts++`, `lastContactAt`, `conexion='sin_wsp'` | 10556-10559 | **SÍ** |
| `switch(outcome)` con los 8 casos + creación de `calendarEntry` | 10561-10628 | **SÍ** — incluye el shape completo de `calendarEntry` (10611-10621) |
| DNC (`doNotCall`/`DNC_REASONS`) | 10630-10638 | **SÍ** |
| Cadencia (`_NO_CONTACT`, `MAX_NO_CONTACT=2`, +24h) | 10640-10675 | **SÍ — fin real de la extracción** |
| Resolución de `pendingCallId` (Phase 20, dialer) | 10677-10703 | **NO** — específico del flujo WebRTC humano (Power Dialer), no existe concepto equivalente en llamadas de Retell |
| `saveSettersData(data)` + response | 10705-10707 | **NO** — el handler humano sigue guardando sync; el webhook guarda dentro de `mutateSettersData` |

**Confirma D-24-02 casi exacto** (10552-10675, no 10552-10707 como una lectura superficial podría sugerir) — la única corrección es que el rango real de "push + cap + attempts + switch + DNC + cadencia" es **10552-10675**, y CONTEXT.md ya lo tenía bien citado.

**Firma real propuesta para `_applyCallOutcome`:**
```javascript
// data: objeto completo de setters.json (para poder empujar a data.calendar)
// lead: data.leads[leadId] (mutado in-place, como ya hace el handler)
// logEntry: YA construido y YA pusheado... NO, en realidad el push está DENTRO
//   del rango a extraer (10552-10555) — logEntry se pasa SIN pushear, la función
//   hace el push.
// opts: { outcome, callbackAt, scheduled, doNotCall, cleanReason, callbackShared,
//         actorSetterId }  ← actorSetterId reemplaza el uso de req.auth (ver abajo)
function _applyCallOutcome(data, lead, logEntry, opts) { ... }
```

**Dependencia oculta que hay que resolver al extraer (no estaba en CONTEXT.md):** la rama `scheduled_with_admin` (línea 10619) usa `req.auth?.user?.role === 'setter' ? req.auth.user.setterId : (lead.assignedTo || '')` para `calendarEntry.setterId` — esto es la ÚNICA referencia a `req`/`req.auth` dentro del rango a extraer. Como el webhook no tiene `req.auth` (es un endpoint público verificado por firma, no por sesión), la función extraída necesita este valor como parámetro explícito (`opts.actorSetterId`), y el handler humano debe seguir pasando `req.auth?.user?.role === 'setter' ? req.auth.user.setterId : (lead.assignedTo || '')` calculado ANTES de llamar al helper. Para el webhook, `opts.actorSetterId` será simplemente `'setter_agente_ia'` (o, si D-24-05 resuelve que `/book` ya creó la cita, esta rama del switch se saltea del todo — ver §5.4).

**`req.params.id` (leadId)** también se usa dentro del switch (línea 10613, `calendarEntry.leadId`) — debe pasarse explícito como parámetro (`opts.leadId`), no asumir que está en scope.

### §3.2 — `_estimateTelnyxCost` — hallazgo NO anticipado por CONTEXT.md

**`_estimateTelnyxCost` (línea 10454-10478), `_detectCountryAndType` (10401-10452) y `TELNYX_RATES_USD_PER_MIN` (10378-10397) están TODAS anidadas dentro del handler `call-disposition`** — son funciones locales del closure de ese único endpoint, redefinidas en cada request. **NO son accesibles desde ningún otro lugar del archivo**, incluyendo el futuro webhook de Retell.

D-24-07 asume que el webhook puede simplemente "usar `_estimateTelnyxCost`" para calcular el costo — eso es imposible tal como está el código hoy. **Esto hay que resolverlo en esta fase** (no es opcional, VOICE-05 necesita costo estimado en el `logEntry`), y es del mismo tipo de trabajo que ya está presupuestado en D-24-02 (mover código de scope de función a scope de módulo) — recomiendo hacerlo en el mismo plan que el refactor de `_applyCallOutcome` (24-01), como un segundo hoisting mecánico: mover las 3 declaraciones (tabla + `_detectCountryAndType` + `_estimateTelnyxCost`) de dentro del handler al scope de módulo (junto a `_telnyxRateForNumber`, línea 14030, con quien ya comparte lógica — `_estimateTelnyxCost` prefiere la rate sheet real vía `_telnyxRateForNumber` y cae a la tabla hardcoded solo si no hay match). El handler humano seguiría llamándola exactamente igual (ninguna diferencia de comportamiento, es un cambio de scope puro) — mismo patrón de paridad que D-24-02.

### §3.3 — Cola / helpers de callable (D-24-03)

- `_leadIsCallableNow(l, now)` — **index.js:9175-9186**. Firma `(lead, nowMs)`. Excluye en orden: `doNotCall`, `_tariffBlocked` (tarifa roja sin engagement, línea 9172), `_leadIsConfirmedDeadNumber` (línea 9123 — lookup validado sin tipo ni operadora), teléfono <7 dígitos, `estado` en `['descartado','agendado','interesado']` (⚠️ esto significa que un lead que el agente ya marcó `interesado` en una llamada previa queda automáticamente FUERA de futuros dispatches — correcto según decisión #5 del research del milestone, "interesados los cierra el user"), `callbackAt` futuro, último outcome `callback_later`.
- `_expensiveTariffLabel(phone)` — **9149-9159** y `_tariffBlocked`/`_tariffRedButEngaged` — **9166-9174**. Relevante: si el piloto es México (`+52`), NO está en la lista de tarifas rojas (`ES fijo`, `UY`, `EC`, `BO`, `PE fijo`) — los leads de México pasan sin fricción por este filtro.
- `_leadPendingForOwner(l, sid, userMap, now)` — **9194-9196** — combina `_leadIsCallableNow` + `!_setterCalledLead`. Útil para "leads del agente que YA se llamaron a sí mismo hoy" pero no es lo que pide D-24-03 (que quiere simplemente `_leadIsCallableNow` sobre `assignedTo==='setter_agente_ia'`, sin filtrar por si el agente ya llamó — de hecho el agente SÍ puede volver a llamar el mismo lead en dispatches futuros mientras siga callable, ya que no hay "un solo intento por siempre" salvo la cadencia de 2 no-contactos).
- `_runPool(tasks, concurrency)` — **5906-5918**. Firma real: recibe un array de **funciones que devuelven promesas** (thunks), no promesas directas — `tasks[i]()` se invoca dentro del worker. `Math.min(concurrency, tasks.length)` workers corren en paralelo compartiendo un cursor.
- Conteo de "llamadas de hoy del agente" para el `dailyCap`: no hace falta un helper nuevo — `_ccCollectCalls(data, {setterId:'setter_agente_ia'})` filtrado por `_ccResolveRange('today')` (ambos del CALL METRICS CORE, ver §3.5) da exactamente ese número, respetando la regla transversal del milestone de derivar todo del CORE.

### §3.4 — Patrón Telnyx completo (config, webhook, persistencia) — a clonar

- `TELNYX_ENV_FIELDS` — **14070-14076**. `_telnyxEnvSourced()` — **14080-14086**.
- `loadTelnyxConfig()` — **14088-14119** (lazy-init + overlay env>JSON). `saveTelnyxConfig()` — **14121-14124**.
- `_publicTelnyxConfig()` — **14129-14142** (nunca expone secrets, sí expone `envSourced` para el lock 🔒 del frontend). `_setterTelnyxConfig()` — **14146-14154** (vista reducida para no-admin).
- `GET /api/telnyx/config` — **14722-14730**. `PUT /api/telnyx/config` — **14740-14815**, con el rechazo 409 de campos env-sourced en **14751-14757** y el self-healing (limpia el JSON si el env var está activo) en **14793-14797**.
- `_verifyTelnyxSignature(req, publicKeyBase64)` — **15519-15546** (ed25519, distinto algoritmo — no clonar el algoritmo, sí la ESTRUCTURA: `{ok, reason}` de retorno, ventana anti-replay, manejo de "sin key configurada").
- `POST /api/telnyx/webhook` — **15551-15610**: contador de rechazos en memoria (`_telnyxWebhookRejects`, no visto arriba pero referenciado en el handler), fail-closed 503 en producción sin key (**15571-15574**), FIFO 1000 con campo `verified: true|false|"skipped"` (**15589**).
- `BACKUP_FILES` — **5732** (array plano de nombres de archivo en `DATA_DIR`).
- Bloque export/import — **~3668-3814** (`telnyxConfig`/`telnyxEvents` como claves del payload de `/api/admin/export-data` y `/api/admin/import-data`).
- `pre-deploy.js` — limpieza de secrets antes de guardar a disco (**líneas 164-171**, array `SENSITIVE`) + registro en la lista `extras` de archivos a persistir (**líneas 173-190**, tuplas `[key, filename]`).

### §3.5 — CALL METRICS CORE — puntos de integración de Retell

- `_ccCollectCalls(data, {setterId, visibleSet, channel})` — **7309-7333**. El filtro de canal es **match EXACTO en la línea 7318**: `if (channel && entry.channel !== channel) continue;`. Confirmado: cuando se llama con `channel:'telnyx_webrtc'` (como hace Centralita en las líneas 2213, 15707, y otros lugares), cualquier entry con `channel:'retell'` queda automáticamente afuera — sin código nuevo, D-24-07 es correcto tal cual está escrito.
- Segundo lugar con el MISMO patrón de exclusión, no citado en CONTEXT.md: **`GET /api/telnyx/cold-call-effectiveness`, línea 15707** (`if (c.channel !== 'telnyx_webrtc') continue;`) — el drawer de efectividad de Centralita también excluye `'retell'` automáticamente, reforzando la intención de D-24-07.
- `_callSetterId(entry, lead, userMap)` — **7226-7235**. Confirmado exacto: `if (entry.by) return userMap[entry.by] || ''; return lead.assignedTo || '';` — con `entry.by===''` (falsy), cae directo a `lead.assignedTo`. D-24-07 es literal.
- `_setterCalledLead` — **7242-7246**. `ADMIN_ONLY_SETTER_IDS` — **7257** (`Set(['setter_ignacio','setter_paula_kroff'])` — `setter_agente_ia` NO está ahí, confirma D-24-09).
- **`_telnyxReconcileCosts` — el gate de channel real está en la línea 15428, no 15441 como cita CONTEXT.md** (corrección menor de línea): `if (entry.channel !== "telnyx_webrtc") continue;` dentro del loop de matching contra CDRs. Esto es exact-match igual que `_ccCollectCalls` — las entries `channel:'retell'` NUNCA se reconcilian contra CDRs reales de Telnyx con el código actual. **Esto es coherente con D-24-05/VOICE-05 (que solo pide costo ESTIMADO, no reconciliado)** — no hace falta tocar esta función en esta fase. Queda como mejora futura documentada (§5.5) si se quiere costo real también para llamadas del agente (técnicamente posible: las llamadas salen por el mismo trunk Telnyx, así que SÍ generan CDR `sip-trunking` real — solo que hoy nada las reconciliaría).

### §3.6 — Creación del pseudo-SDR (D-24-09) — confirmado, más simple de lo que CONTEXT.md anticipaba

**`ensureSetterProfile(name)` — index.js:575-584:**
```javascript
function ensureSetterProfile(name) {
  const settersData = loadSettersData();
  const setterName = name.trim();
  const setterId = `setter_${setterName.toLowerCase().replace(/\s+/g, '_')}`;
  if (!settersData.setters.find((s) => s.id === setterId || s.name.toLowerCase() === setterName.toLowerCase())) {
    settersData.setters.push({ id: setterId, name: setterName, activeVariantId: "", createdAt: new Date().toISOString() });
    saveSettersData(settersData);
  }
  return setterId;
}
```
Ya usado en dos lugares (línea 3492 y 7910, ambos en flujos de invitación de usuarios) — **NO requiere ningún user vinculado**, es idempotente (chequea por id o por nombre antes de crear), y el shape del setter creado (`{id, name, activeVariantId:'', createdAt}`) **no incluye `hidden`** (default ausente = visible). `ensureSetterProfile('Agente IA')` produce exactamente `setter_agente_ia` (slug: `"Agente IA".toLowerCase().replace(/\s+/g,'_')` → `"agente_ia"`).

**Conclusión: NO hace falta ningún script one-shot.** Basta con llamar a `ensureSetterProfile('Agente IA')` una vez al boot del server (patrón lazy-init, como hace `loadTelnyxConfig`) o desde el primer PUT de `/api/retell/config`, o incluso desde el propio endpoint de dispatch la primera vez que se usa. Recomendación: hacerlo lazy en el boot (una línea, `ensureSetterProfile('Agente IA')`, junto a donde ya se llama `seedVolumeFromRepo()`) para que el setter exista SIEMPRE sin depender de que el admin dispare ninguna acción primero — así Equipo/Comando/Distribución lo muestran (con 0 leads/0 llamadas) desde el día 1, incluso antes del primer dispatch.

## §4. Patrones del repo a clonar — ejemplos concretos

### Patrón de test (fixture DATA_DIR + auth pre-poblada)

Confirmado contra `tests/metrics-consistency.test.js` y `tests/disposition-dnc.test.js` — el patrón exacto:

```javascript
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path"; import fs from "node:fs"; import os from "node:os";
import crypto from "node:crypto"; import request from "supertest";

const tmpData = path.join(os.tmpdir(), `retell-webhook-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-x@local.test";
process.env.ADMIN_PASSWORD = "xpass1234";
process.env.JWT_SECRET = "test-secret-x";
// Regla #121: SIEMPRE "" nunca delete (dotenv repone las borradas)
process.env.OPENAI_API_KEY = "";
process.env.MERCURY_API_KEY = "";
process.env.QWEN_API_KEY = "";
process.env.RETELL_API_KEY = "";        // <- nuevo para esta fase
process.env.RETELL_WEBHOOK_SECRET = ""; // <- si se conserva el campo

function pwd(plain) { /* scrypt salt+hash, ver archivos existentes */ }
fs.writeFileSync(path.join(tmpData, "auth.json"), JSON.stringify({ users: [...], invites: [], sessions: [] }));
fs.writeFileSync(path.join(tmpData, "setters.json"), JSON.stringify({
  setters: [...], variants: [], leads: {
    l1: { num: 1, name: "L1", phone: "+5215550000001" /* ⚠️ ≥7 dígitos, regla #163 */, assignedTo: "setter_agente_ia", conexion: "sin_wsp", estado: "sin_contactar" },
  }, calendar: [], sessions: [],
}));

const { app } = await import("../index.js"); // SIEMPRE después de escribir los fixtures
```

Para firmar un webhook de test con el algoritmo real de Retell (sin necesitar el SDK en el test, replicando la fórmula verificada en §2.1):
```javascript
function signRetellBody(body, apiKey, timestamp = Date.now()) {
  const digest = crypto.createHmac('sha256', apiKey).update(body + timestamp).digest('hex');
  return `v=${timestamp},d=${digest}`;
}
// en el test:
const rawBody = JSON.stringify({ event: 'call_analyzed', call: {...} });
const sig = signRetellBody(rawBody, 'test-retell-key');
await request(app).post('/api/retell/webhook').set('x-retell-signature', sig).set('Content-Type', 'application/json').send(rawBody);
```

### Patrón de config env>JSON (clonar de Telnyx literal)

```javascript
const RETELL_CONFIG_FILE = path.join(DATA_DIR, "retell_config.json");
const RETELL_EVENTS_FILE = path.join(DATA_DIR, "retell_events.json");

const RETELL_ENV_FIELDS = {
  apiKey: "RETELL_API_KEY",
  // webhookSecret: "RETELL_WEBHOOK_SECRET",  // ver §2.1 — evaluar si hace falta
};

function _retellEnvSourced() {
  const sourced = {};
  for (const [field, envName] of Object.entries(RETELL_ENV_FIELDS)) {
    sourced[field] = !!(process.env[envName] && String(process.env[envName]).trim());
  }
  return sourced;
}
// loadRetellConfig / saveRetellConfig / _publicRetellConfig: mismo esqueleto que
// loadTelnyxConfig (14088) / saveTelnyxConfig (14121) / _publicTelnyxConfig (14129).
```

### Idempotencia del webhook por `call_id` (patrón nuevo, no existe un precedente exacto en el repo — el más cercano es el `pendingCallId`/`correctsAutoMarked` de Phase 20, que resuelve un problema distinto)

```javascript
// Antes de aplicar la cascada: ¿ya procesamos este call_id?
const alreadyProcessed = (lead.callLog || []).some(e => e.retellCallId === callId);
if (alreadyProcessed) return { ok: true, skipped: 'duplicate' };
```

## §5. Riesgos y recomendaciones

### §5.1 — Estrategia de test de paridad (D-24-02, gate del ROADMAP)

El success criterion 2 de la Phase 24 exige que `metrics-consistency` "NO cambió ningún número tras el refactor". Recomendación concreta: escribir `tests/apply-call-outcome.test.js` con un **fixture doble-vía**:

1. Ejecutar `POST /api/setters/leads/:id/call-disposition` (handler humano) sobre un lead A, para cada uno de los 8 outcomes de `CALL_OUTCOMES` (incluyendo `scheduled_with_admin` con `calendarEntry`, `callback_later` con `callbackShared`, y 2 llamadas seguidas de `no_answer` para probar la cadencia hasta `MAX_NO_CONTACT`).
2. Sobre un lead B IDÉNTICO en estado inicial, invocar directamente `_applyCallOutcome(data, leadB, logEntry, opts)` con los mismos parámetros equivalentes (expuesto vía `globalThis.__voiceAgent` o similar, patrón `__callCore`/`__metricsAudit`/`__phase16` ya usado en el repo).
3. Comparar `leadA` vs `leadB` campo por campo (`estado`, `callbackAt`, `doNotCall`, `cadenceStep`, `cadenceExhausted`, `calendarEntry` creado) — deben ser bit-a-bit iguales salvo los campos que son intencionalmente distintos (`logEntry.by`, `logEntry.channel`).
4. Correr la suite completa existente (`metrics-consistency` 19 tests, `call-cadence`, `disposition-dnc`, `funnel-close`) SIN modificarla — si algún assert cambia de valor, el refactor rompió paridad.

Este patrón (exponer el helper puro vía `globalThis`) ya es el estándar del repo (`__callCore`, `__metricsAudit`, `__phase16`, `__mercury`) — usarlo también aquí, ej. `globalThis.__voiceAgent = { _applyCallOutcome, ... }`.

### §5.2 — El "patrón de 5 lugares" de la regla #21 tiene un hueco real en Telnyx — no clonarlo ciegamente

**`seedVolumeFromRepo()` (index.js:5671-5687) NO incluye `telnyx_config.json` ni `telnyx_events.json`** en su lista de archivos a copiar del repo al volumen en el primer boot:

```javascript
for (const file of ['history.json', 'auth.json', 'setters.json', 'faqs.json', 'training.json',
  'wa_accounts.json', 'wa_routines.json', 'wa_events.json', 'wa_campaigns.json',
  'scrape_batches.json', 'reports.json', 'pending_calls.json']) {
  // ... telnyx_config.json / telnyx_events.json NO están acá
```

Esto significa que el "patrón completo de 5 lugares" que D-24-01 asume ya resuelto para Telnyx en realidad son **4 de 5** — un container Railway nuevo NUNCA heredaría los `numbers`/`countryRouting` commiteados en `data/telnyx_config.json` del repo (sí se recuperarían vía `/api/admin/import-data` manual desde un backup, pero no automáticamente al boot). Es deuda preexistente, fuera del scope de esta research pero relevante porque el plan **no debe copiar este gap** para Retell.

**Recomendación:** agregar `retell_config.json` (y opcionalmente `retell_events.json`, aunque los eventos son menos críticos de recuperar que la config) a la lista de `seedVolumeFromRepo()` como parte de esta fase — es lo correcto, y de paso corregir el mismo gap para Telnyx es un fix de una línea si el plan quiere aprovechar (opcional, no bloqueante para VOICE-01).

### §5.3 — Timeout del webhook de Retell vs timeout interno de `_autoDispositionLLM`

**Confirmado (community.retellai.com/webhook-overview, MEDIUM-HIGH confidence):** Retell espera una respuesta 2xx dentro de **10 segundos**, y reintenta hasta 3 veces si no la recibe. La idempotencia recomendada por Retell es `event + call_id`.

`_autoDispositionLLM` (index.js:16232-16264) tiene su PROPIO timeout interno de **15 segundos** (`Promise.race` con `setTimeout(..., 15000)`, línea 16257) — si el webhook de Retell lo invoca de forma síncrona (esperar el resultado antes de responder), en el peor caso el handler tarda MÁS que el presupuesto de Retell, dispara un reintento innecesario, y —si no hay idempotencia por `call_id`— puede terminar aplicando la cascada dos veces.

**Recomendación de diseño concreta:**
1. El handler del webhook responde **200/204 inmediatamente** después de: verificar la firma, extraer `leadId`, y decidir SI hace falta el fallback LLM o no (la mayoría de los casos NO lo necesitan — solo cuando la extracción de Retell no trae `interes`/`agendo` claros).
2. Si hace falta el fallback LLM, se dispara **sin awaitear la respuesta HTTP** (fire-and-forget con su propio `mutateSettersData` async al terminar) — exactamente el patrón que ya usa `/api/telnyx/calls/:leadId/transcribe` para su propio `_autoDispositionLLM` (índex.js:16748-16759, corre DESPUÉS de responder al polling, no bloquea la respuesta HTTP).
3. Idempotencia por `call_id` (ver §4) protege contra el reintento de Retell mientras el fallback async todavía está en vuelo.

### §5.4 — Doble escritura de la cita: evaluación de las dos opciones planteadas por D-24-05

CONTEXT.md deja abierto "pasar flag a `_applyCallOutcome` o crear la cita solo en `/book` y saltear la rama del switch". Evaluación:

**Opción A — flag `opts.skipCalendarCreation` en `_applyCallOutcome`:** el switch llega al case `scheduled_with_admin`, pero si `opts.skipCalendarCreation` está seteado, no crea un NUEVO `calendarEntry` — solo aplica el resto de los side-effects (`lead.respondio=true`, `calificado=true`, `interes='si'`, `estado='agendado'`). Requiere pasar el `calendarEntry` YA creado por `/book` como parte de `opts` (o su id) para que la respuesta del endpoint siga devolviendo `calendarEntry` de forma consistente con el handler humano.

**Opción B — el webhook nunca llega a la rama `scheduled_with_admin` del switch:** si `agendo===true` en la extracción (o `_pendingBooked` tiene un TTL vigente para ese `call_id`), el webhook llama a `_applyCallOutcome` con un outcome DIFERENTE que ya tiene su propio caso en el switch sin creación de calendario, o directamente aplica el resto de la cascada "a mano" (fuera del switch) para ese caso puntual.

**Recomendación: Opción A.** Es menos invasiva sobre el switch existente (un flag opcional, default `false`, cero cambio de comportamiento para el handler humano — que nunca lo pasa) y mantiene el contrato de que `outcome==='scheduled_with_admin'` SIEMPRE dispara los mismos side-effects de estado, independientemente de si el calendarEntry ya existía o no. Además es más fácil de testear en el fixture de paridad de §5.1 (un solo parámetro adicional a variar). La Opción B introduce una rama de control paralela al switch que duplicaría parte de su lógica (los 4 campos de estado que también setea `answered_interested`/`scheduled_with_admin`), lo cual es exactamente el tipo de duplicación que D-24-02 busca eliminar.

### §5.5 — Reconciliación de costo real (mejora opcional, no bloqueante)

Como se documenta en §3.5, `_telnyxReconcileCosts` (index.js:15388-15455) filtra por `channel === "telnyx_webrtc"` exacto (línea 15428) — las llamadas del agente (`channel:'retell'`) nunca se reconciliarán contra CDRs reales de Telnyx aunque técnicamente los generen (mismo trunk). VOICE-05 solo pide costo ESTIMADO (`_estimateTelnyxCost`), así que esto NO bloquea la fase. Si se quiere costo real también para el agente, es un cambio de una línea (`entry.channel !== "telnyx_webrtc" && entry.channel !== "retell"`) — dejarlo documentado como mejora futura, no ejecutarlo en esta fase salvo que el plan decida incluirlo explícitamente.

### §5.6 — Concurrencia (regla #19)

Confirmado: `mutateSettersData` (index.js:6703-6713) es un mutex basado en encadenar promesas (`_settersMutex = _settersMutex.then(...)`). El dispatch (`_runPool` con concurrencia 2-3) hará múltiples llamadas HTTP salientes a Retell EN PARALELO, pero cada una debe escribir su resultado (asignación inicial, o simplemente el registro de que se disparó) a través de `mutateSettersData` — nunca `loadSettersData()`/`saveSettersData()` directo dentro de un handler async, porque dos tareas del pool podrían pisarse el snapshot. El webhook (que llega de forma completamente independiente, posiblemente en paralelo con un dispatch en curso) también debe pasar por el mismo mutex — están todos compartiendo la misma cola de promesas, así que la serialización es automática con solo usar el wrapper correctamente en los 3 lugares (dispatch, `/book`, webhook).

## §6. Unknowns que quedan abiertos

1. **¿`RETELL_WEBHOOK_SECRET` como campo separado hace falta?** (§2.1). Evidencia fuerte (código fuente del SDK + sample oficial) apunta a que NO — usar el mismo `RETELL_API_KEY`. Pero no se pudo confirmar 100% si la cuenta del user tiene un único API key o si el dashboard de Retell genera un valor DISTINTO cuando se activa el "webhook badge" en una key. **Acción recomendada para el plan:** implementar con un solo `RETELL_API_KEY`, y dejar `webhookSecret` como campo opcional que hace fallback a `apiKey` — así funciona en cualquiera de los dos escenarios sin necesitar más investigación, y es fácil de confirmar/ajustar cuando el user mire su dashboard de Retell (paso `autonomous:false` de todos modos, porque crear/confirmar el API key en Railway ya lo es).

2. **Mapeo exacto `disconnection_reason` → outcome del sistema** (§2.3). Se dio una propuesta razonada pero NO verificada contra llamadas reales de Retell (no hay forma de probarlo sin una cuenta activa haciendo llamadas). Recomendación: implementar el mapeo como una tabla explícita y fácil de ajustar (no lógica dispersa), y revisarlo después del piloto de Phase 26 con datos reales de `disconnection_reason` observados en producción.

3. **¿`call_analyzed` llega SIEMPRE vacío/incompleto para llamadas sin conexión, o simplemente no llega el evento?** (§2.3). La evidencia community-sourced no distingue entre las dos causas. No cambia la recomendación de diseño (escuchar `call_ended` también), pero si se confirma que SÍ llega con `call_analysis` vacío, el handler necesita un chequeo defensivo adicional (`call.call_analysis?.custom_analysis_data` puede ser `undefined` incluso en un evento `call_analyzed`).

4. **Shape exacto de respuesta esperado por `/book`** (§2.2.b). Confirmado que "se convierte a string y se le pasa al LLM", pero no hay un schema JSON documentado de forma explícita (a diferencia del request, que sí está documentado con ejemplo completo). Bajo riesgo — cualquier JSON simple con un campo de texto funciona según la doc, pero conviene probarlo en la llamada de prueba de Phase 26 y ajustar el shape si el agente lee mal la respuesta.

5. **Proceso exacto de importación de números Telnyx a Retell** (§2.6) — es explícitamente scope de Phase 26 (setup del trunk), no de esta fase, pero se deja registrado que la documentación pública consultada no detalla si es dashboard-only o si existe un endpoint de API. El código de Phase 24 no depende de esto (solo debe manejar el error de la API de Retell con gracia si el número no está importado).

6. **Rate limits / concurrencia máxima de la API de Retell para `create-phone-call`** — no se encontró un número explícito en la documentación consultada (más allá de la "concurrencia 20" mencionada en el research del milestone como límite de la cuenta trial, que es un límite de LLAMADAS SIMULTÁNEAS activas, no de requests/segundo al endpoint de creación). El dispatch con `_runPool` conc 2-3 está muy por debajo de cualquier límite razonable, así que esto es bajo riesgo, pero si Phase 26 sube el `dailyCap` significativamente convendría confirmarlo.

## Environment Availability

| Dependencia | Requerida por | Disponible localmente | Versión | Fallback |
|---|---|---|---|---|
| `retell-sdk` (npm) | Verificación de firma del webhook (VOICE-05), opcionalmente cliente REST | ✗ (no está en `package.json` todavía) | 5.53.0 verificado en registro | Implementar el HMAC a mano con `crypto.createHmac` (fórmula verificada en §2.1) — no depende del SDK para funcionar, es solo comodidad |
| `RETELL_API_KEY` (env var) | Todo el módulo (auth REST + verify webhook) | ✗ (no seteada localmente; es de Railway) | — | Ninguno — fail-closed 503 en producción sin ella, igual que `TELNYX_SIGNATURE_PUBLIC_KEY` |
| Node.js ≥20 con Web Crypto (`globalThis.crypto.subtle`) | `retell-sdk`'s verify function | ✓ (Node 24.14.1 local; Railway usa `engines: ">=20.0.0"`, Web Crypto disponible desde Node 19+ sin flags) | — | — |
| Cuenta Retell activa (trial $10, workspace "SCM") | Todo el dispatch real | N/A (no verificable desde este entorno) | — | El código se escribe/testea con mocks; la verificación end-to-end real es Phase 26 |

**Faltantes sin fallback:** `RETELL_API_KEY` en Railway — bloquea CUALQUIER llamada real hasta que el user lo configure (paso `autonomous:false` esperado, mismo patrón que los otros secrets del proyecto).

**Faltantes con fallback:** `retell-sdk` — se puede reemplazar por una implementación manual del HMAC (5 líneas con `crypto.createHmac('sha256', apiKey).update(body+timestamp).digest('hex')`) si por algún motivo el paquete no se quiere instalar; dado que tiene 0 dependencias y está oficialmente mantenido, se recomienda instalarlo igual (menos código propio que mantener).

## Package Legitimacy Audit

> `slopcheck` no pudo ejecutarse en este entorno (falla de verificación SSL contra `registry.npmjs.org` desde Python/`requests` — confirmado que es un problema de certificados del entorno, no del paquete: `npm view` desde Node SÍ resuelve el mismo registro sin problema). Por protocolo, el paquete se marca `[ASSUMED]`, pero se realizó una verificación manual sustitutiva más profunda de lo habitual: se descargó el tarball real (`npm pack retell-sdk@5.53.0`) y se leyó el código fuente de la función de verificación citada en §2.1 (no solo metadata del registro).

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `retell-sdk` | npm | 2 años 8 meses (creado 2023-12-11), 234 versiones, última hace 1 día | No obtenido (slopcheck offline) | `github.com/RetellAI/retell-typescript-sdk` (org oficial, autor `support@retellai.com`, maintainers con emails `@retellai.com`) | No disponible (env SSL) — **verificación manual sustitutiva: código fuente leído directamente, coincide exacto con los ejemplos de la documentación oficial de `docs.retellai.com`; 0 dependencias runtime** | `[ASSUMED]` — recomendado un `checkpoint:human-verify` LIVIANO (solo confirmar `npm install retell-sdk` corre limpio en CI/local), dado el nivel de evidencia ya reunido |

**Packages removidos por veredicto `[SLOP]`:** ninguno.
**Packages marcados `[SUS]`:** ninguno.

## Sources

### Primary (HIGH confidence)
- Código fuente propio (`index.js`, `public/app.js`, `tests/*.test.js`) — HEAD `8f25324`, leído directamente, todas las líneas citadas verificadas.
- `retell-sdk@5.53.0` — tarball descargado con `npm pack` y código fuente (`lib/webhook_auth.mjs`, `index.mjs`, `index.js`) leído directamente. Metadata de npm registry (`npm view retell-sdk`).
- [Secure the webhook - Retell AI](https://docs.retellai.com/features/secure-webhook) — algoritmo de firma, sample de código Node.js completo.
- [Create Phone Call API - Retell AI](https://docs.retellai.com/api-references/create-phone-call) — shape de request/response del dispatch.
- [Custom function in conversation flow - Retell AI](https://docs.retellai.com/build/conversation-flow/custom-function) — shape del request de la tool `/book`, custom headers, timeout, ausencia de reintentos.
- [Get Call - Retell AI](https://docs.retellai.com/api-references/get-call) — catálogo completo de `disconnection_reason`, shape de `transcript_object` y `call_analysis`.
- [Webhook - Retell AI](https://docs.retellai.com/features/webhook) — catálogo de eventos (`call_started`/`call_ended`/`call_analyzed`/etc), shape de `call_ended`.

### Secondary (MEDIUM confidence)
- [Webhook Overview - Retell AI](https://docs.retellai.com/features/webhook-overview) — política de reintentos (10s timeout, 3 reintentos, idempotencia por `event+call_id`).
- [npmjs.com — retell-sdk](https://www.npmjs.com/package/retell-sdk) — confirmación de nombre/propósito del paquete (no se pudo hacer WebFetch directo, HTTP 403, se usó `npm view`/`npm pack` en su lugar).

### Tertiary (LOW-MEDIUM confidence)
- [No "call_analyzed" webhook for some disconnection reasons - community.retellai.com](https://community.retellai.com/t/no-call-analyzed-webhook-for-some-disconnection-reasons/387) — hallazgo del hueco #3 (§2.3), fuente community con respuesta parcial del soporte oficial de Retell (no zanja la causa exacta, pero no la contradice).
- [Webhook Signature Verification - community.retellai.com](https://community.retellai.com/t/webhook-signature-verification/252) — confirma el concepto de "webhook badge" sin precisar si es la misma key o una distinta.

## Metadata

**Confidence breakdown:**
- Firma del webhook / SDK (§2.1): **HIGH** — código fuente real leído, no documentación parafraseada.
- API de dispatch y tool calling (§2.2, §2.2.b): **HIGH** — shapes completos con ejemplos verbatim de la documentación oficial.
- Eventos de webhook y fiabilidad de `call_analyzed` (§2.3): **MEDIUM** — catálogo de `disconnection_reason` es HIGH (doc oficial), pero la fiabilidad del evento es evidencia community-sourced sin confirmación 100% oficial.
- Mapa del código propio (§3): **HIGH** — todo releído contra HEAD del repo, líneas exactas.
- Mapeo `disconnection_reason`→outcome (§2.3, §6.2): **LOW/ASSUMED** — propuesta razonada, no verificada contra comportamiento real.
- Import de números a Retell (§2.6, §6.5): **MEDIUM** — confirmado el CONCEPTO (SIP trunking + import), no el mecanismo exacto (Phase 26).

**Research date:** 2026-07-31
**Valid until:** ~14 días para los hechos de la API de Retell (empresa en desarrollo activo — 234 releases de su SDK en 2.5 años, ~3/semana — la documentación puede cambiar; confirmar contra `docs.retellai.com` de nuevo si el plan se ejecuta después de mediados de agosto 2026). Sin vencimiento práctico para el mapa del código propio salvo que otro cambio en paralelo (ver nota `user-commits-in-parallel`) toque las mismas líneas — correr `git log`/`git status` antes de planificar por si el árbol se movió.

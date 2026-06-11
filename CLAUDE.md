# SCM Dental Setting App - Instrucciones para IA

> Última actualización: 2026-04-29 — Documento mantenido para que cualquier IA o dev que entre al proyecto entienda el estado actual sin tener que reconstruirlo leyendo commits.

## REGLA CRITICA DE DEPLOY

**ANTES de hacer `git push` o cualquier deploy, SIEMPRE correr:**

```bash
npm run pre-deploy
```

Este comando descarga la data actual del servidor Railway (historial de scraping, usuarios, setters) y la guarda en `data/`. Si no se hace esto, se pierden todos los leads scrapeados desde el ultimo deploy.

### Flujo correcto de deploy:
1. Hacer los cambios al codigo
2. Correr `npm run pre-deploy` (pide URL de Railway, email y password de admin)
3. Commitear TODO (codigo + archivos de `data/`)
4. **`git push origin main`** ⚠️ Railway escucha **`main`** (verificable en Railway dashboard → Settings → "Branch connected to production")
5. (Opcional, mantener master en sync para backup): `git push origin main:master`
6. Railway redeploya automaticamente cuando detecta push a `main`

### ⚠️ ATENCION — bug operativo común (2026-05-03)
La versión vieja de este doc decía "Railway escucha master". Es **FALSO**.
Si pusheas SOLO a master, Railway NO redeploya. Verificar siempre el branch
correcto en Railway dashboard. Si en el futuro se cambia el branch que
Railway escucha, actualizar este doc inmediatamente.

### Variables de entorno necesarias en Railway:
- `ADMIN_PASSWORD` - Contrasena del admin (NO "ADMIN_INITIAL_PASSWORD")
- `ADMIN_EMAIL` - Email del admin (default `ignacioana91@gmail.com`)
- `ADMIN_NAME` - Nombre del admin
- `API_KEY` - SerpAPI key (Google Maps scraping)
- `MERCURY_API_KEY` - Inception Labs (IA primaria)
- `QWEN_API_KEY` - OpenRouter Qwen (IA fallback)
- `APIFY_TOKEN` - Apify (Instagram Scraper)
- `RESEND_API_KEY` - Resend (envío de invitaciones por email)
- `JWT_SECRET` - secret para JWT del módulo WA (si no está, deriva de ADMIN_PASSWORD)
- `TELNYX_API_KEY` - **Recomendado**. Si está seteada, sobrescribe la del JSON y bloquea edición desde panel admin
- `TELNYX_SIP_USERNAME` - **Recomendado**. Idem (env > JSON)
- `TELNYX_SIP_PASSWORD` - **Recomendado**. Idem
- `TELNYX_SIP_CONNECTION_ID` - **Recomendado**. Idem
- `TELNYX_SIGNATURE_PUBLIC_KEY` - **Recomendado**. Idem (es pública pero por simetría operativa va con el grupo)
- `OPENAI_API_KEY` - **Opcional**. Si está set, se habilita transcripción Whisper post-llamada (~$0.006/min). Sin esto, el endpoint `/api/telnyx/calls/:leadId/transcribe` devuelve 503.

### Seguridad Telnyx: env vars > JSON

A partir de 2026-05-22 los 5 campos sensibles de Telnyx (`apiKey`, `sipUsername`, `sipPassword`, `sipConnectionId`, `signaturePublicKey`) se pueden cargar como env vars en Railway. Si están seteados ahí, **el JSON los ignora completamente** y el panel admin bloquea su edición (PUT devuelve 409 si se intenta).

Motivos:
- Secrets no tocan el Railway Volume (no aparecen en `data/telnyx_config.json`, ni en backups locales, ni en exports del pre-deploy)
- Imposible que un admin futuro los "vea" desde el panel
- Rotación más segura: cambiar en Railway → redeploy → ya está

El JSON `telnyx_config.json` queda solo para datos no-sensibles: `numbers[]` (E.164 + label + country) y `countryRouting`. Los `numbers` y el routing se siguen editando desde el panel.

Self-healing: cuando se hace PUT de config y env var está activa para un campo, ese campo en el JSON se **limpia a `""`** automáticamente. Cubre el caso de migración (admin cargó secrets en panel pre-refactor y ahora setea env vars: en el próximo save los secrets viejos del JSON se borran).

Helper expuesto: `_telnyxEnvSourced()` devuelve `{apiKey: bool, sipUsername: bool, ...}` indicando qué viene de env. El `/api/telnyx/config` GET lo incluye como `envSourced` para que el frontend muestre el lock visual 🔒 en los inputs.

## Estructura de datos

Todo persiste en JSON en `data/` (Railway Volume montado en `/data` en producción):

- `auth.json` - Usuarios, sesiones (cookie + JWT WA), invitaciones
- `setters.json` - **Setters, variantes, leads (map por ID), calendar, sessions de setteo**
  - Importante: `leads` es un **objeto/map** keyed por lead ID, NO un array (normalización 2026-04-25)
- `history.json` - Historial de leads scrapeados (dedup estricta para scraping)
- `faqs.json` - Banco de Respuestas (FAQs con few-shot RAG)
- `training.json` - Materiales subidos por admin al Centro de Entrenamiento
- `wa_accounts.json` - Cuentas de WhatsApp del módulo Multi-Account
- `wa_routines.json` - Rutinas de warmeo para WhatsApp
- `wa_events.json` - Log de eventos del módulo WA
- `mercury_config.json` - System prompt + feedback notes editables del Asistente Mercury (lazy-seed desde `scripts/seed/mercury-system-prompt.md`)
- `mercury_generations.json` - Log de cada generación Mercury (input + output + setterAction + adminAction + promotedToFaqId). FIFO cap 5000.
- `alert_config.json` - Umbrales del panel Equipo (drop %, días inactividad, % apertura mínimo, total mínimo)
- `*.bak*` / `*.bak-*` - Backups locales (gitignored, no se trackean)

## Stack
- Node.js >= 20 + Express 5 (ESM modules, `"type": "module"`)
- Persistencia JSON file-based, sin DB (Railway Volume en `/data`)
- SerpAPI (Google Maps scraping)
- Apify (Instagram, actor `apify/instagram-scraper`, usa `directUrls + searchLimit`)
- OpenRouter (Qwen) + Mercury (Inception Labs) para IA con fallback automático
- Socket.io 4.x (módulo WA, en `src/wa/gateway.js`)
- vitest + supertest (testing)
- Geist + Geist Mono (tipografía oficial del Design System v1.1)

## Arquitectura del sistema

### Persistencia
- Railway Volume montado en `/data` para persistir JSON entre deploys
- `seedVolumeFromRepo()` copia data del repo al volumen en primer boot
- `DATA_DIR` detecta automáticamente: `/data` (Railway), `process.env.DATA_DIR` (tests) o `./data` (local)

### Auth y sesiones
- **Cookie session (`gs_session`)** - flujo normal del navegador, usado por `attachAuth` global en `/api`
- **JWT Bearer** - usado por el módulo WA y la app desktop (endpoint `/api/auth/desktop-login`)
- Presencia in-memory (`onlinePresence` Map en `index.js`) — se actualiza en cada request autenticada, NO toca disco

### Flujo de scraping (Google Maps)
1. Admin configura pais + ciudades en el frontend
2. Backend usa SerpAPI para buscar negocios dentales
3. Dedup ESTRICTA contra `history.json` - si ya se scrapeo, NO se vuelve a scrapear
4. Resultados se muestran con indicador verde (nuevo) o gris (ya scrapeado)
5. "Enviar a Setters" SOLO envia los nuevos (filtra `alreadyScraped`)
6. Nuevos leads se guardan en history automaticamente

### Flujo de import CSV a setter
1. Admin importa CSV directo a un setter especifico
2. Deduplica SOLO contra leads existentes en setters (NO contra history)
3. Esto permite importar leads que ya fueron scrapeados pero no estan en ningun setter
4. Parsea URLs wa.me para extraer telefono + mensaje personalizado
5. Detecta columnas por keywords (espanol e ingles)
6. Normalización de teléfonos por prefijo internacional (mapa de alias en `buildWhatsAppUrl`)

### Pipeline de setteo (cascada bidireccional)
El flujo de un lead es:
```
Sin contactar -> Conexion enviada -> Respondio -> Calificado -> Interesado -> Agendado
```

**Cascada hacia adelante:** poner un campo activa los anteriores automaticamente
- Ej: marcar "Interesado SI" -> pone calificado=true, respondio=true, conexion=enviada

**Cascada reversa:** quitar un campo resetea los posteriores
- Ej: quitar conexion -> resetea respondio, calificado, interes, estado=sin_contactar

**Sin WSP:** marcar "Sin WSP" saca el lead de la vista del setter y lo mueve a "Llamadas"

### Metricas en vivo
- Se actualizan sin recargar la pagina (funcion `_updateStatsLocal()`)
- % Conexion = conexiones / total
- % Apertura = respondieron / conexiones
- % Calificacion = interesados / calificados
- Stats por variante para comparar cual convierte mejor

### Filtros del pipeline
Todos, Sin contactar, En proceso, WSP Enviado, Respondieron, Calificados, Interesados, Agendados, En seguimiento (leads con follow-ups tildados), Sin WSP, Descartados

### Buscador universal
Input de busqueda que filtra por nombre, telefono, pais, ciudad, direccion, doctor, email, website, instagram

### Paginacion
50 leads por pagina en la tabla de setters

## Módulos del frontend

Todos los views viven en `public/index.html` como `<div id="view-X" class="module-view hidden">` y se activan vía sidebar (`data-target="view-X"`).

### Búsqueda
- `view-maps` - Google Maps scraping (admin)
- `view-social` - Redes (PRO/admin)

### Setters
- `view-crm` - Setteo (WhatsApp) - vista principal del setter
- `view-calls` - **Llamadas (Sin WSP)** — admin+supervisor only desde 2026-05-22 (setters siguen con WA). Lista paginada 50/página con sort dropdown (nunca llamados / recientes / país / intentos / última llamada). Botón "+ Lead manual" para crear leads ad-hoc sin pasar por scraping (testing + referidos). Sort preference persiste en localStorage por user.
- `view-myperf` - **Mi rendimiento** (todos los roles): 7 KPI cards con delta vs período anterior + Chart.js evolución (selector día/semana/mes). Setter ve solo lo suyo (`setterScope: 'self'`); admin/supervisor pueden filtrar por setter o ver el equipo.
- `view-assistant` - **Asistente de respuestas** (admin + setter): pegás mensaje del prospecto, Mercury genera respuesta sanitizada en bloques (sin `¿¡`, sin precios, sin stack técnico). Setter marca buena/mala/edita y se persiste en `mercury_generations.json`.
- `view-faqs` - **Banco de Respuestas** con sugerencias IA (few-shot RAG con Mercury → Qwen fallback)
- `view-training` - **Centro de Entrenamiento** con dos secciones:
  - Onboarding oficial (8 cards hardcoded, leen de `/api/onboarding/modules`)
  - Material adicional (uploads, persiste en `training.json`)
- `view-wa-mywhats` - Mis WhatsApps (vista del setter del módulo WA)

### Administración / Supervisión
- `view-command` - Centro de Comando (admin, dashboards y métricas globales)
- `view-team` - **Equipo** (admin + supervisor): tabla comparativa todos los setters, sortable por cualquier KPI, alertas automáticas (drop %, inactividad, apertura baja), highlight ±10% del promedio del equipo, click row → drilldown al view-myperf con setter pre-seleccionado. Modal "Umbrales de alerta" (admin only edita).
- `view-mercury-review` - **Revisión IA** (admin only): cada generación Mercury con setter, prospect, output, ejemplos del banco usados. Acciones: aprobar oro (promueve al banco con tag `aprobado-admin`), rechazar, reescribir (promueve con `reescrita-admin`), sugerir mejora (agrega nota a `mercury_config.feedbackNotes` que se inyecta en futuras generaciones).
- `view-mercury-config` - **Configuración Mercury** (admin only): edita el system prompt y administra notas de feedback sin tocar código.
- `view-wa-dashboard` - Dashboard WA (admin)
- `view-wa-accounts` - Cuentas WA (admin)
- `view-wa-routines` - Rutinas Warming (admin)
- `view-online` - **Quién está conectado** (admin) — presencia in-memory, auto-refresh 15s

## Centro de Entrenamiento — onboarding oficial (8 módulos)

Construído como **read-only oficial** + integración con la IA del Banco de Respuestas.

### Archivos
- `public/onboarding/files/scm-onboarding-modulo{1..8}.html` — los 8 módulos en HTML autocontenido (CSS embebido, fuente Inter). **NO se modifican vía edits programáticos: para actualizar contenido, reemplazar el archivo completo.**
- `public/onboarding/quiz.js` — quiz autocontenido (~340 líneas) que se inyecta al final de cada módulo
- `public/onboarding/quiz-data.json` — 40 preguntas base (8 módulos × 5), formato:
  ```
  { moduloN: {
      titulo,
      preguntas: [{ pregunta, opciones[3], correcta 0..2, explicacion }],  // 5 preguntas base
      bancoExtra: [...]  // OPCIONAL: si existe, el quiz mezcla preguntas+bancoExtra y muestra 5 al azar cada intento
    }
  }
  ```
  - Aprueba con ≥4/5
  - Si hay `bancoExtra`, cada intento randomiza qué 5 preguntas se muestran y también el orden de las opciones dentro de cada pregunta
  - El boot del server **valida el schema** en `validateQuizData()` y loguea: `📝 Quiz cargado: N preguntas base [+ M en bancos extra] (8 módulos)` o warnings si hay problemas (no bloquea el arranque)

### Rutas backend (`index.js`)
- `GET /api/onboarding/modules` - metadata de los 8 (público)
- `GET /onboarding/N` (N=1..8) - **wrapper page** con topbar + iframe del módulo (público)
- `GET /onboarding/files/scm-onboarding-moduloN.html` - middleware que **inyecta `<div id="scm-quiz-root">` y `<script src="/onboarding/quiz.js">`** antes de `</body>` al servir el HTML. El archivo en disco queda intacto.
- `loadOnboardingText()` corre al boot, extrae texto plano de los 8 HTMLs y lo cachea en memoria. Se inyecta en el prompt de `/api/faqs/suggest` como bloque `ONBOARDING OFICIAL DEL EQUIPO SCM` (1500 chars por módulo).

### localStorage del onboarding (cliente)
- `scm_onboarding_progress` - `{"1": true, "3": true, ...}` - solo se setea cuando el quiz aprueba
- `scm_onboarding_quiz_attempts` - `{"modulo1": {"intentos": 2, "aprobado": true, "ultimo_score": 5}}`

### Flujo: setter abre `/onboarding/4` → ve módulo en iframe → al final aparece quiz inyectado → si aprueba (≥4/5) se marca `progress[4]=true` + postMessage al wrapper actualiza el pill del topbar a "Quiz aprobado"

## Banco de Respuestas (`view-faqs`)

CRUD de pares pregunta/respuesta + IA que sugiere respuesta para una nueva pregunta del lead, usando el banco como ejemplos few-shot + material del Centro de Entrenamiento + onboarding como contexto base de verdad.

### Estructura de un entry (`data/faqs.json`)
```js
{
  id, pregunta, respuesta,
  categoria: 'precio'|'objecion'|'seguimiento'|'calificacion'|'general',
  tags: [],            // libres
  variantes: [],       // formas alternas de la misma pregunta (opcional, max 10, max 200 chars c/u)
  variantId,           // opcional: si aplica solo a una variante de mensaje
  createdBy, createdById, createdAt, updatedAt,
  usos, funcionaron    // métricas: setter clickea "Copiar" (uso) o "Funcionó" (efectividad)
}
```

### Endpoints (`/api/faqs`)
- `GET ?q=&categoria=&sort=` — listar/filtrar. `sort=usos` (default), `sort=top` (mejor ratio funcionaron/usos, requiere usos>=2), `sort=recientes`
- `POST` — crear
- `PUT /:id` — editar (admin o creador)
- `DELETE /:id` — borrar (admin o creador)
- `PATCH /:id/uso` — incrementa `usos`. Body `{funcionó:true}` también incrementa `funcionaron`
- `POST /import` — bulk. Body acepta `{entries:[]}` (JSON array), `{csv:""}` (headers `pregunta,respuesta,categoria,tags,variantes`; `;` para listas), o `{text:""}` (bloques separados por línea en blanco con prefijos `P:`, `R:`, `C:`, `T:` coma, `V:` con `|`). Dedup por pregunta normalizada
- `POST /check-duplicate` — devuelve hasta 5 entries con score >= 0.4 contra `{pregunta, respuesta, categoria, excludeId}`. La UI lo llama antes de guardar
- `POST /suggest-tags` — IA propone `{categoria, tags}` para una FAQ a partir de pregunta+respuesta
- `POST /suggest` — IA genera respuesta para `{pregunta, variantId?, contexto?, categoria?}`. Devuelve `{sugerencia, bloques, ejemplosUsados, ejemplos:[{id,pregunta,score}], usedFallback}`. Si la IA devuelve vacío, fallback automático a la respuesta literal del top match del retrieval (logueado a stdout). Output limitado a 1-2 bloques separados por `\n\n` (post-procesamiento del response del modelo)

### Retrieval (helpers `_faqNormalize`, `_faqTokens`, `_faqScore`)
- Tokenización: lowercase + sin acentos (NFD + strip diacríticos) + split por no-alfanum + filtra stopwords ES + tokens de longitud ≥ 3
- Stopwords: lista en `FAQ_STOPWORDS_ES`. **Las palabras interrogativas (quien, donde, cuando, como, cual, porque) NO están en stopwords a propósito** — son señales fuertes de intención
- `_faqScore(entry, qTokens, opts)`: cosine similarity sobre sets de tokens (entry incluye pregunta + respuesta + variantes), + boost por tag coincidente (+0.08 c/u, max 3), + boost por categoría coincidente (+0.10), + boost por efectividad histórica (`funcionaron/usos × 0.15`), + popularidad (+0.05)
- `/suggest` usa threshold 0.10 + max 8 ejemplos. `/check-duplicate` usa threshold 0.40

### Frontend ([public/app.js](public/app.js) — todo bajo `window._faq*`)
- `loadFaqsModule()` lista
- `_faqOpenModal(id?)` / `_faqSave(forceSave?)` con check duplicados antes de save
- `_faqSuggest()` — botón "Generar con IA" en el modal
- `_faqSuggestTags()` — botón "✨ Sugerir tags"
- `_faqOpenImportModal()` / `_faqImportSubmit()` — modal de import bulk con selector de formato (text/csv/json)
- `_faqCopy(id)` — incrementa usos al copiar
- `_faqFeedback(id, true)` — botón "Funcionó"

### Pre-deploy
- `/api/admin/export-data` ahora incluye `faqs` y `training` (antes faltaban — un container nuevo de Railway podía descartar el banco vivo)
- `scripts/pre-deploy.js` los guarda como `data/faqs.json` y `data/training.json`

### Tests ([tests/faqs.test.js](tests/faqs.test.js))
Setup: pre-popula `auth.json` y `faqs.json` vacío en `tmpData` antes de importar `index.js`. CRUD, sort (usos/top/recientes), variantes, import (entries/csv/text), check-duplicate, export-data. NO testea `/suggest` ni `/suggest-tags` (dependen de la API IA real).

### Seed inicial
[scripts/seed-faqs.mjs](scripts/seed-faqs.mjs) — script idempotente con 18 FAQs derivadas del Módulo 7 del onboarding (10 objeciones oficiales + 8 inferidas). Dedup por pregunta. Uso: `RAILWAY_URL=... ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/seed-faqs.mjs`

## Módulo WhatsApp Multi-Account (`src/wa/`)

Módulo separado para gestión de cuentas WA con estados, warmeo, rutinas. Se monta vía `mountWa(app)` desde `index.js`.

### Archivos
- `src/wa/index.js` - entry, `mountWa(app)`
- `src/wa/data.js` - persistencia (`wa_accounts.json`, `wa_routines.json`, `wa_events.json`)
- `src/wa/routes.js` - rutas REST `/api/wa/*` + auth Bearer JWT
- `src/wa/gateway.js` - Socket.io gateway para comandos en tiempo real

### Endpoints clave (todos bajo `/api/wa`)
- `GET/POST/PATCH/DELETE /accounts` - CRUD cuentas
- `POST /accounts/:id/assign` - asignar cuenta a setter
- `POST /accounts/:id/reset-warming` / `mark-banned` - acciones de estado
- `GET/POST/DELETE /routines` + `/routines/attach` - rutinas de warmeo
- `POST /commands/{open,close,send-message,start-routine,stop-routine,bulk}` - comandos al desktop
- `GET /stats/{summary,events-by-hour,presence}` - métricas
- `GET /events`, `POST /events` - log

### Auth
- `/api/auth/desktop-login` - flujo dedicado para la app desktop, devuelve JWT Bearer
- Token va en `Authorization: Bearer ...`
- El módulo WA tiene su propio middleware `requireAuth` que acepta JWT (no cookie)

### Frontend WA
- `public/wa.js` - lógica completa de las views WA, instanciada por `app.js`

## Módulo Telnyx Calls (Phase 6 — añadido 2026-05-21)

Centralita VoIP integrada en el SCM. Permite a setters/admin llamar internacional directo desde el browser (WebRTC), con caller ID local según el país destino. Reemplaza el botón `tel:` que abría el dialer del SO. **No es la Phase 5 (Llamadas IA con voz automatizada)** — esto es la base de infraestructura, voz IA queda diferida.

### Decisiones arquitectónicas críticas
1. **API key NUNCA en browser**: toda llamada a la API de Telnyx pasa por endpoints backend del SCM. Browser solo recibe ephemeral SIP credentials (TTL 10min) vía `/api/telnyx/webrtc-credentials`.
2. **Caller ID por país destino**: tabla `countryRouting: { ES: numId, MX: numId, default: numId }`. Cuando se llama a +34, el sistema usa automáticamente el número español comprado. Mejora tasa de atención dramáticamente.
3. **WebRTC en browser** vía `@telnyx/webrtc@2` cargado por CDN. Sin app desktop, cero distribución.
4. **Reuso total del callLog existente**: al colgar la llamada Telnyx, se dispara el modal de disposition que ya existía. El callLog gana campos `{duration, fromNumber, channel: 'telnyx_webrtc', cost, costCountry, costTariffKey}`.

### Archivos
- **Backend** (todo en `index.js`):
  - Helpers config: `loadTelnyxConfig`, `saveTelnyxConfig`, `_publicTelnyxConfig`, `_setterTelnyxConfig`
  - Helpers scripts: `loadCallScripts`, `saveCallScripts`
  - Helper signature: `_verifyTelnyxSignature` (ed25519 + anti-replay 5min)
  - Helper costos: `_estimateTelnyxCost` (tabla hardcoded USD/min por país)
- **Data**:
  - `data/telnyx_config.json` — apiKey + sip creds + numbers[] + countryRouting (admin only via API)
  - `data/telnyx_events.json` — log FIFO 1000 de webhook events
  - `data/call_scripts.json` — scripts con seed inicial desde `scripts/seed/call-scripts.json`
- **Frontend**:
  - `public/app.js` — módulo `_telnyx` (cliente WebRTC), `_startTelnyxCall`, panel de llamada activa, script panel inline
  - `public/index.html` — `#telnyx-call-panel` flotante, `#telnyx-script-panel` lateral, vista admin `#view-telnyx-config`

### Endpoints clave (todos bajo `/api/telnyx`)
- `GET /config` — auth required. Admin/supervisor reciben `_publicTelnyxConfig` (sin secrets). Setter recibe `_setterTelnyxConfig` (solo numbers activos + routing).
- `PUT /config` — admin only. Campos opcionales: `apiKey, sipUsername, sipPassword, sipConnectionId, signaturePublicKey, countryRouting`. **Campos omitidos NO se tocan** (evita borrar secrets sin querer).
- `POST /numbers` — admin agrega número (E.164 validado).
- `PATCH /numbers/:id` — admin edita label/active/country.
- `DELETE /numbers/:id` — admin elimina + limpia routing referencias.
- `POST /webrtc-credentials` — auth required. Devuelve ephemeral SIP creds (modo dual: ephemeral via Telnyx API si hay sipConnectionId, fallback a SIP fijo si no).
- `POST /webhook` — público, validado por signature ed25519. Persiste eventos en `telnyx_events.json`.
- `GET /events` — admin/supervisor, log de webhook events.
- `GET /metrics?range=today|week|month|all` — agregaciones de minutos/costo del callLog (channel='telnyx_webrtc'). Devuelve totals + bySetter + byCountry + byTariff + byDay.
- `GET /scripts` — auth required (admin y setter). Lista de guiones.
- `POST/PATCH/DELETE /scripts/:id` — admin CRUD de guiones.

### Flujo de una llamada (end-to-end)
1. Setter abre view-calls. Frontend hace `_telnyx.fetchConfig()` en background (no bloquea).
2. Si config tiene numbers activos → botón "📞 Llamar" se renderiza como botón JS (WebRTC). Si no → cae a `<a href="tel:">` tradicional (fallback).
3. Click → `_startTelnyxCall(leadId)`:
   - Pide permiso de mic al browser
   - `_telnyx.ensureClient()` lazy init: fetch credentials → instanciar TelnyxRTC → `connect()` con timeout 15s
   - `_telnyx.pickNumberForDestination(lead.phone)` elige caller ID por país
   - `client.newCall({destinationNumber, callerNumber, audio})` inicia llamada
   - Panel `#telnyx-call-panel` se muestra con timer, mute, colgar, indicador del número saliente
   - Script panel disponible vía botón "Guion" lateral
4. Telnyx eventos (`answered`, `hangup`, `error`) actualizan UI.
5. Al colgar → `_onTelnyxCallEnded`: cierra panel, scroll+flash sobre el lead, focus en dropdown de disposition.
6. Metadata de la llamada (`duration`, `fromNumber`) se guarda en `_pendingTelnyxCallMetadata[leadId]` y se incluye en el próximo `POST /call-disposition`.
7. Backend recibe `telnyxCallMeta` en el body, calcula costo con `_estimateTelnyxCost`, guarda en `lead.callLog[].{cost, channel: 'telnyx_webrtc', ...}`.
8. Webhook de Telnyx llega independientemente (signature validada) y se persiste en `telnyx_events.json` para audit.

### Configuración para producción
1. Admin entra a "Centralita Telnyx" en el sidebar
2. Carga: API Key (Bearer), SIP Connection ID (opcional, recomendado), SIP Username/Password (fallback), Signature Public Key (para webhooks)
3. Agrega números virtuales comprados con `+ Agregar número` (E.164 + país)
4. Configura routing por país: para cada país, dropdown con number que actúa como caller ID
5. **En el dashboard Telnyx**: configurar webhook URL apuntando a `https://<railway-domain>/api/telnyx/webhook`

### Costos esperados
Tabla `TELNYX_RATES_USD_PER_MIN` en `index.js` con tarifas aprox de dic 2025. Hardcoded — si Telnyx cambia, actualizar manualmente. España móvil: $0.034/min. México móvil: $0.094. Argentina: $0.080. EEUU: $0.007.

### Limitaciones conocidas
- No graba llamadas (out of scope Phase 6 — queda para futuras)
- No transcribe (Whisper integration diferida)
- Sin Mercury IA en vivo durante la llamada (diferido)
- Costos son **estimados** con tabla local — el dashboard Telnyx tiene el costo real exacto
- Tabla de tarifas se actualiza manualmente

### Docs adicionales
- `docs/telnyx-quickstart.md` — guía para setters: cómo dar permiso de mic, iniciar llamada, usar el script panel, qué hacer ante objeciones

## Archivos principales

### Backend
- `index.js` (3194 líneas) - Servidor Express, todos los endpoints API genéricos, lógica de negocio
  - IMPORTANTE: rutas sin `:id` (como `/sin-wsp`) DEBEN ir ANTES de rutas con `:id`
  - `ensureLeadDefaults()` - inicializa campos de lead (incluye calificado=false)
  - Cascade logic en PATCH `/api/setters/leads/:id`
  - `attachAuth` se monta en `/api`, NO en rutas onboarding públicas
- `src/wa/*` - módulo WA, montado vía `mountWa(app)`

### Frontend
- `public/index.html` (918 líneas) - HTML completo, todas las vistas, Geist fonts
- `public/app.js` (3478 líneas) - Toda la lógica frontend (vanilla JS, ES modules)
- `public/style.css` (2243 líneas) - **SCM Design System v1.1** (rediseño 2026-04-25)
  - Tokens: `--accent` violeta `#9D85F2`, `--bg-app #0F1115`, `--text-primary #E5E7E2`
  - Disciplina cromática: violeta sólo para acentos, no para textos
  - Variables legacy mantenidas (`--text-main`, `--primary-color`, etc.) por compatibilidad
- `public/wa.js` (581 líneas) - lógica del módulo WA en frontend
- `public/locations.js` - países/ciudades para scraping
- `public/onboarding/` - onboarding oficial (ver sección dedicada)

### Tests (`tests/`)
- `wa.test.js` - tests del módulo WA (auth, RBAC, accounts, routines, commands, stats)
- `onboarding.test.js` - tests del onboarding (metadata, wrapper, inyección quiz, presencia online)
- `faqs.test.js` - tests del Banco de Respuestas
- `mercury-style.test.js` - sanitizer (`¿¡` strip, bloques) + violations detector
- `mercury-config.test.js` - GET/PUT config Mercury + RBAC + reset prompt
- `mercury-generate.test.js` - asistente de respuestas (fallback sin IA, RBAC, PATCH feedback)
- `mercury-review.test.js` - approve/reject/rewrite/suggest-improvement + promoción al banco
- `asistencia.test.js` - show rate (lead.asistio + endpoint marcar + backfill calendar)
- `performance.test.js` - serie temporal por setter, buckets day/week/month, comparativa
- `team-performance.test.js` - tabla equipo, alertas automáticas, alert-config
- `phone-normalization.smoke.test.js` - smoke de normalización de teléfonos
- `hardening.test.js`, `opening-message-sanitize.test.js` - tests transversales
- Setup pattern: `process.env.DATA_DIR = tmpdir`, pre-popular `auth.json` ANTES de `import("../index.js")`
- **Total actual: 272 tests verde en 13 files**

Comandos:
- `npm test` - corre todo
- `npm run test:watch` - watch mode
- `npm run smoke:wa` - smoke real contra el server local

### Scripts (`scripts/`)
- `pre-deploy.js` - descarga data de Railway antes de push
- `smoke-wa.mjs` - smoke test del módulo WA
- `seed-faqs.mjs` - seed inicial 18 FAQs derivadas del onboarding (vs Railway)
- `seed-mercury-bank.mjs` - **seed idempotente** del banco Mercury (32 entradas, dedup por pregunta normalizada). Soporta `--remote` (vs Railway) y default local (mut directo a `data/faqs.json`)
- `seed/mercury-bank-32.json` - banco Mercury versionado en repo
- `seed/mercury-system-prompt.md` - system prompt seed que carga `loadMercuryConfig()` lazy
- `normalize-stored-whatsapp-urls.mjs` - one-shot de normalización
- `replace-hex.mjs` - one-shot de cambio de paleta

### Deploy
- `Procfile` - `web: node index.js`
- `nixpacks.toml` - Config de Railway (Node 20)

### Cache-busting
- `index.html` tiene `<script src="/app.js?v=YYYYMMDD[x]">` y `<link href="/style.css?v=YYYYMMDD[x]">`
- Al cambiar app.js o style.css, **siempre** actualizar el cache-buster
- `express.static` tiene `maxAge: 0, etag: false`
- **CASO REAL — bug invisible**: si cambiás `style.css` y NO bumpeás el cache-buster, los browsers que ya tienen ese `?v=...` cacheado **NO van a re-bajar el archivo nuevo**. El user reporta "el fix ya no está" cuando en realidad sigue en disco — solo que ellos ven la versión vieja. Verificás contra prod con `fetch('/style.css?v=...').text()` y el archivo está bien, pero el browser muestra otra cosa. Bumpear el cache-buster en CADA edit a style.css/app.js, sin excepción, aunque sea un cambio de 1 línea.

## Telnyx Calls — Scripts oficiales SCM Cold Call v2 (2026-05-22)

`scripts/seed/call-scripts.json` contiene **30 guiones** organizados en **12 triggers** que representan el flow completo de una cold call. Basados en `SCM_Cold_Call_v2.docx` del usuario + frameworks de Julio Sagantini (PACE, 3-S, problem-based pitch).

### Triggers (en orden del flow)

| Trigger | Descripción | Cuándo se usa |
|---|---|---|
| `rules` | Meta-scripts: reglas globales + 3-S tono + framework PACE de referencia | Sticky en panel — siempre visible |
| `before_call` | Checklist pre-llamada | Antes de marcar |
| `gatekeeper` | Pasar recepción: con nombre / sin nombre + 3 rutas (A pedir nombre / B mensaje curiosidad / C enganchar recepcionista) | Recepción contesta |
| `opener` | Apertura con decisor (27 seg + salida fácil + contexto fugas) | Decisor atiende |
| `pitch` | Pattern interrupt con dato real (`{years}` + `{reviews}`) + caso de éxito (119 pacientes UY) | Después de opener |
| `ask_meeting` | 3 variaciones (A/B/C) usando el "no" a favor | Para cerrar reunión |
| `confirm` | Calificar + pedir email + reconfirmación anti-cancelación | Si dice sí |
| `objection_brushoff` | Brush-offs (no interesa / email / no tiempo) → directo a Engage | Reacción instantánea |
| `objection_real` | Objeciones reales (agencia / ya sistema / precio / quién son / pensar) → PACE completo | Lo pensó, tiene sustancia |
| `callback` | Si no agendó pero no dijo no | Cierre con fecha concreta |
| `whatsapp_msg` | Mensaje WA post-callback | Mismo día de la llamada |
| `email_template` | Templates email (confirmación + reminder 24h) | Post-agenda |

### Endpoint para recargar el seed en producción

`POST /api/telnyx/scripts/reset-to-seed` (admin only):
- Backupea `data/call_scripts.json` con timestamp
- Sobrescribe con el seed actual de `scripts/seed/call-scripts.json`
- Devuelve count + backup path
- Confirmación por texto "REEMPLAZAR" en la UI antes de disparar

Hay un botón **"♻️ Recargar oficial v2"** en Centralita Telnyx → tab Guiones.

### Variables interpolables en los scripts

`{name}`, `{city}`, `{country}`, `{years}` (años activos), `{reviews}` (cantidad de reseñas Google), `{setterName}`, `{date}`, `{time}`.

→ Cuando editás el .docx oficial, el flujo es: actualizar el JSON del seed con los cambios → commit + push → click "Recargar oficial v2" en producción.

### Panel de scripts durante llamada (UI)

- **Header con TONE chip** "🐢 Slow · 😊 Smile · 💪 Strong" siempre visible (matchear al prospect, sonreír, hablar lento+confiado)
- **PACE card sticky** debajo: P-A-C-E con colores (P ámbar, A verde, C celeste, E rojo) + nota "solo objeciones reales · brush-off directo a Engage · max 3 intentos"
- **Buscador** filtra botones por keyword (label, text, tags) en tiempo real
- Scripts `rules` EXCLUIDOS del flow de botones (están en PACE card sticky)
- Botones ordenados por flow real + colores por categoría
- Texto del script con background propio + line-height 1.65 para lectura cómoda

## Bugs aprendidos del SDK Telnyx WebRTC v2

Si en el futuro hay que tocar el módulo Telnyx, estos son los gotchas verificados contra el bundle source:

1. **CDN bundle correcto**: `https://cdn.jsdelivr.net/npm/@telnyx/webrtc@2/lib/bundle.js` (NO `lib/index.iife.js` que devuelve 404). El bundle expone `window.TelnyxWebRTC.TelnyxRTC`.

2. **`remoteElement` debe ir en `client.newCall(options)`, no solo en el constructor del client.** Sin esto, el `<audio>` para audio entrante no se monta automáticamente y el setter no escucha al lead. El SDK lee `this.options.remoteElement` del Call, no del Client.

3. **Estados terminales reales del SDK**: `hangup`, `destroy`, `purge`. NO `done`/`ended` (esos están en el bundle como strings pero son otros enums internos, no del Call). Verificado en source de `BaseCall.setState()` vía agent Explore.

4. **Ringback fake**: Telnyx WebRTC v2 NO reproduce el ringback del carrier en outbound. Sintetizamos local con Web Audio API (440Hz + 480Hz, patrón US 2s ON / 4s OFF). Arranca cuando state='ringing', se detiene en 'active'/'hangup'/'destroy'.

5. **Manual attach del remoteStream con retry**: el SDK intenta auto-mount pero hay race conditions. Backup defensivo: cuando state='active', poll cada 250ms (hasta 4s) y attachar `call.remoteStream` manualmente al `<audio>` element con force `play() + volume=1 + muted=false`.

6. **Performance**: NUNCA usar `backdrop-filter: blur(Xpx)` fullscreen (GPU expensive). NUNCA `controls` attribute en el `<audio>` (renderiza UI bar drena CPU). NUNCA `console.log` en cada notification del SDK (flood DevTools).

7. **Audio element posicionado off-screen**, no `display:none` — algunos browsers (Brave) bloquean autoplay en elementos no renderizados. Usar `position:absolute; left:-9999px; width:1px; height:1px; opacity:0`.

8. **Notification pattern**: en v2, TODOS los state changes vienen por `client.on('telnyx.notification', notification => {...})` con `notification.type === 'callUpdate'` y `notification.call.state`. NO existe `call.on('answered', ...)` — eso es v1/Twilio-like.

## Notas para otra IA que continue

1. **Siempre pushear a ambas ramas:** `git push origin main && git push origin main:master`
2. **Siempre actualizar cache-buster** en index.html al cambiar app.js o style.css
3. **Nunca poner rutas con `:id` antes de rutas estáticas** en Express
4. **El campo `calificado`** es boolean (true/false), inicializar siempre como false
5. **Los stats** usan `l.calificado === true`, no interaction-based logic
6. **Import CSV** no chequea history.json (intencionalmente)
7. **Scraping** sí chequea history.json (estricto, no duplicar)
8. **express.json limit** está en 50mb para imports grandes
9. **`leads` en setters.json es un MAP**, no un array (normalizado 2026-04-25). Lo mismo `history.entries` en history.json. Para contar usar `Object.keys(x).length`, NO `x.length`.
10. **Los 8 HTMLs del onboarding NO se editan via tooling** — para actualizar contenido reemplazar el archivo completo. La inyección del quiz es server-side.
11. **Auth dual**: cookie session (`gs_session`) para el navegador, JWT Bearer para WA/desktop. NO mezclar.
12. **Tests**: si agregás endpoints, sumá tests en `tests/`. El patrón de setup está en `wa.test.js` y `onboarding.test.js`.
13. **Trabajo en paralelo**: si hay otra IA editando código, evitá tocar `style.css`, `src/wa/*`, `public/wa.js`, archivos del onboarding y `setters.json`. Zonas seguras: docs, gitignore, tests nuevos, frontend en zonas distintas.
14. **`Scapper.txt`** está en `.gitignore` — contiene credenciales/notas personales, NUNCA commitearlo.
15. **Preview server local**: `.claude/launch.json` está configurado con `env.DATA_DIR=tmp/preview-data` para que `preview_start` no toque `data/` del repo. Si querés probar local, copiar `data/*.json` → `tmp/preview-data/` y resetear pass del admin ahí. **NUNCA escribas a `./data/auth.json` desde scripts node ad-hoc** — es trivial dejar el repo con users de test y deployar eso a producción.
16. **Mercury (asistente de respuestas + revisión IA)**: las generaciones se persisten en `mercury_generations.json` (FIFO 5000). El system prompt vive en `mercury_config.json` con versionado. Las últimas 10 `feedbackNotes` (que admin agrega vía "Sugerir mejora" o desde view-mercury-config) se inyectan automáticamente en el prompt de cada generación nueva. Los helpers `sanitizeMercuryStyle` y `detectMercuryViolations` están expuestos en `globalThis.__mercury` para tests puros.
17. **Show rate**: `lead.asistio` (true/false/null). Se marca con `PATCH /api/setters/leads/:id/asistencia` (admin+supervisor) o se backfillea desde `calendar[].calendarioEstado` con `POST /api/setters/asistencia/backfill` (admin only, idempotente — solo toca leads con asistio=null).
18. **Métricas temporales**: `/api/setters/performance` agrega por buckets day/week/month sobre `interactions[].createdAt` y `lastContactAt`. `/api/setters/team-performance` (admin+supervisor) hace lo mismo para todo el equipo + alertas. **Limitación conocida**: el dataset legacy del repo tiene muchos `respondio=true` pero pocas `interactions[].action='open'` formales (porque interactions se introdujo después). Eso hace que `pctApertura` se vea raro en datos viejos. En producción con datos nuevos los % son correctos.
19. **Mutex async para JSON writes** (Audit 2026-05-23): `mutateSettersData`, `mutateFaqs`, `mutateMercuryGenerations`. Patrón: handlers async que tienen `await` (LLM, autoTag, etc) ANTES de load+save deben envolver la mutación en estos wrappers, sino dos requests concurrentes cargan el mismo snapshot y el segundo save pisa al primero. NO uses `loadX() → modify → saveX()` naive en handlers async — usá el mutex.
20. **`seedVolumeFromRepo()` skip en NODE_ENV=test**: la función bail-outs si el ambiente es test. Esto evita copiar 14MB de `data/*.json` del repo a tmpData en cada test run, lo que causaba cascade timeouts. Cada test crea su propio fixture vacío de `setters.json` y `history.json`.
21. **`/api/admin/export-data` exporta 12 bloques** (Audit 2026-05-23): además de history/auth/setters/faqs/training, ahora incluye mercury_config, mercury_generations, alert_config, telnyx_config, telnyx_events, call_scripts, scheduled_messages. `npm run pre-deploy` los baja todos. Sin esto, un container nuevo de Railway perdía esa data al redeploy.
22. **Cookie `gs_session` con flag `Secure` en NODE_ENV=production** (Security audit 2026-05-23). Para que dev/tests sigan funcionando, en non-prod NO se agrega Secure.
23. **JWT_SECRET fail-fast en producción** (Security audit 2026-05-23): si `process.env.JWT_SECRET` falta o tiene <16 chars y `NODE_ENV=production`, el server hace `process.exit(1)`. Antes el fallback derivaba de `ADMIN_PASSWORD` — quien sabía el password admin podía forjar JWTs.
24. **Socket.IO CORS env-driven en producción** (Security audit 2026-05-23): `cors.origin` en prod lee de env var `WA_CORS_ORIGINS` (CSV de orígenes). Si vacía, default a same-origin (`origin: false`). En dev/test sigue siendo `origin: true` para no romper smoke tests.
25. **`assignedTo` removido del mass-assign de PATCH lead** (Security audit 2026-05-23): un setter ya NO puede mandar `{assignedTo:"otro_setter"}` y transferir leads. Solo admin puede setear `assignedTo`. Para bulk usar `/api/setters/reassign-bulk`.
26. **Notas: `by` ignora el body** (Security audit 2026-05-23): el endpoint POST `/api/setters/leads/:id/note` ya NO acepta `by` desde el cliente — siempre usa `req.auth.user.name`. Antes un setter podía firmar nota como "otro user" comprometiendo el audit trail.
27. **WA module — ownership checks** (Audit 2026-05-23): el socket event `account:status`, el endpoint `POST /api/wa/events` y `POST /api/wa/warming-network/inbound` ahora validan que el caller es dueño del `accountId`. Antes cualquier setter autenticado podía pisar status o sembrar inbound de cuentas ajenas.
28. **Performance — caps unbounded** (Audit 2026-05-23): `lead.interactions` capeado a 200, `lead.notes` capeado a 100. callLog ya estaba en 500. Evita crecimiento ilimitado de `setters.json`.
29. **Performance — `compression` middleware** (Audit 2026-05-23): gzip/brotli en respuestas. Skipea en `NODE_ENV=test` (interfería con supertest timeouts).
30. **Tests — global `testTimeout: 20000` + `retry: 2`** (Audit 2026-05-23): Windows + supertest + handlers async pueden ser slow. `vitest.config.js` global aplica a todos. Real bugs requieren 3 fails consecutivos para reportar.
31. **Vista `view-guide`** (Audit 2026-05-23): nueva vista "📖 Guía de uso" en el sidebar (después de Centro de Entrenamiento). Tabs setter/admin con buscador y secciones colapsables. Contenido hardcoded en `_guideContent` (public/app.js).
32. **wa-multi desktop v0.5.4**: drawer "📖 Guía" en el header con 8 secciones (qué es, login, conectar cuenta, estados, programados, warmeo, tips, troubleshooting). Source extraído + repacked en `Desktop\wa-multi\versiones\wa-multi-portable-v0.5.4\`.
33. **Scripts nuevos** (Audit 2026-05-23): `validate-data-integrity.mjs`, `backup-data.mjs`, `cleanup-stale-sessions.mjs`, `dedupe-leads.mjs`. Disponibles via `npm run validate:data` / `backup:data` / `cleanup:sessions` / `dedupe:leads`.
34. **AGENTS.md ya no existe** (Audit 2026-05-23): era un duplicado outdated de CLAUDE.md. Si necesitás que otro agent lea convenciones, apuntalo a CLAUDE.md.

## Sesión 2026-05-24 — Redistribución masiva + fixes UX

35. **`/api/auth/online` con fallback a JSON persistido** (2026-05-24): antes el endpoint solo leía el Map in-memory `onlinePresence`. Tras cada redeploy de Railway ese Map arrancaba vacío y TODOS los users mostraban "Sin actividad registrada" en view-online — aunque `lastSeen`/`lastIp`/`lastUserAgent` estaban persistidos en `auth.json` (vía `flushOnlinePresence`). Ahora hace fallback a esos campos del JSON. `lastSeen` siempre se ve correctamente.

36. **Redistribución masiva de leads** (2026-05-24, one-shot ya ejecutado): script `scripts/one-shot-redistribute-2026-05-24.mjs`. Hizo 3 cosas en una sola call atómica vía `/api/admin/import-data`:
    - **Reset cero de cero** de 325 leads (298 de Yesxander + 4 del orfano `setter_evelio` + 23 de Ivi). Borró `interactions[]`, `notes[]`, `callLog[]`, `followUps{}`, `lastContactAt`, `callbackAt`, `varianteId`, `setterPhoneId`, `phoneStatus`, etc. Los reasignó con weights Paula 30% / Maxi 25% / Genaro 20% / Gabriela 15% / Alex 10%.
    - **Recuperó 627 leads en limbo** (estado='sin_contactar' AND conexion='sin_wsp'): solo limpió `conexion=''` para que vuelvan al tab "Sin contactar" del setter actual.
    - **Eliminó `setter_evelio` del array de setters** (era un orfano sin user vinculado).
    - **Backup local** en `data/setters.json.bak-pre-redistribution-<ts>`. Si necesitás revertir, usá ese.

37. **`hidden:true` en setter records** (2026-05-24): nuevo flag para esconder un setter del dropdown de filtro sin borrarlo del sistema. Útil para supervisores que tienen `setterId` y leads asignados pero no deben aparecer como opción de filtro. Frontend filtra con `settersList.filter(s => !s.hidden)` en `loadSetterModule` (`public/app.js:2197`). **Actualmente nadie tiene el flag activo** (Paula lo tenía pero fue revertido — el user quiere verla en la lista para chequear que no tiene leads).

38. **TODOS los setters acceden a TODAS las variantes** (2026-05-24): antes el frontend filtraba variantes por `setterId` — cada setter solo veía las suyas o las globales (sin setterId). Confundía cuando se querían experimentos cruzados. `getVisibleVariables()` ahora devuelve `[...variantsList]` sin filtrar (`public/app.js:945`). El campo `setterId` en cada variante queda como info de ownership pero NO restringe acceso. `loadVariantsModal` también desfiltra (`public/app.js:3744`).

39. **Hoy widget muestra nombre del setter impersonado** (2026-05-24): cuando admin usa "Ver como setter X", antes el widget Hoy decía "Hola Ignacio 👋" (nombre real del admin). Ahora detecta `realRole==='admin' && role==='setter'` y busca el nombre del setter en `settersList`. Setter logueado normalmente con su cuenta sigue viendo su nombre — el fix solo aplica al modo impersonation.

40. **Follow-up activo visible en Power Dialer** (2026-05-24): bloque dedicado en `public/app.js:_pdRender` entre Histórico y Disposition. Muestra step activo (24hs/48hs/72hs/7d/15d), due date relativo (Hoy/Mañana/Vencido), color por urgencia, nota personal del setter si la tiene, y botón "✓ Marcar hecho" que destildea via PATCH sin salir del dialer (`window._pdMarkFollowupDone`). Solo aparece si el lead tiene step tildado — power dialer queda limpio si no.

41. **MR1 cascade fix retroactivo** (2026-05-24): el cascade reverse cuando se destildea `respondio=false` ahora preserva `conexion='sin_wsp'` en vez de resetear `estado='sin_contactar'`. Antes destildar en un lead Sin WSP lo volvía a "Sin contactar" — bug operativo. Index.js líneas ~5028-5045.

42. **CORS trailing slash tolerance** (2026-05-24): `WA_CORS_ORIGINS` en Railway puede tener `/` al final (típico si pegás URL del address bar) y el match funciona igual. Strip de slash en `src/wa/gateway.js`.

43. **Env vars Railway al 2026-05-24**: 12 variables seteadas en producción: ADMIN_PASSWORD, API_KEY, APIFY_TOKEN, JWT_SECRET (64 chars random), MERCURY_API_KEY, QWEN_API_KEY, TELNYX_API_KEY, TELNYX_SIGNATURE_PUBLIC_KEY, TELNYX_SIP_CONNECTION_ID, TELNYX_SIP_PASSWORD, TELNYX_SIP_USERNAME, WA_CORS_ORIGINS=`https://scm-setting.up.railway.app/`. **Faltantes opcionales**: OPENAI_API_KEY (Whisper — ya cargado por user), RESEND_API_KEY (invitaciones por email — no urgente).

44. **Whisper transcripción habilitada** (2026-05-24): `OPENAI_API_KEY` configurada por el user. Todas las llamadas Telnyx >5s se transcriben automáticamente. El audio se graba en browser via MediaRecorder y se sube al server. Funciona desde Power Dialer, view-Llamadas, modal del lead, atajo Ctrl+K — cualquier path que dispare `_startTelnyxCall`. Costo: $0.006/min Whisper.

45. **DATA SHAPE — campo `estado` vs `conexion` puede divergir**: el TAB "Sin contactar" del frontend filtra por `!l.conexion` (más estricto), pero `/api/setters/stats` cuenta por `l.estado === 'sin_contactar'`. Antes del redistribute del 2026-05-24 había 844 leads en "limbo" (estado='sin_contactar' AND conexion='sin_wsp'). Ya recuperados los 627 no-Yesxander, y los 205 de Yesxander reseteados+redistribuidos. Si volvés a ver discrepancia entre stats backend vs panel frontend, chequeá esta inconsistencia primero.

46. **`setter_evelio` ya NO existe** (2026-05-24): orfano histórico que se llamaba "Ignacio" en `name` pero no tenía user vinculado. Sus 4 leads se redistribuyeron. Si encontrás referencias a `setter_evelio` en código, son seguros de borrar.

47. **Estado actual setters (2026-05-24 post-redistribute)**:
    - **setter_paula** (Paula, role: supervisor): 2334 leads, 390 sin contactar — supervisora que también settea
    - **setter_alexander_salgueiro**: 747 / 235
    - **setter_maximiliano_escalera**: 759 / 201
    - **setter_gabriela_palazzotti**: 754 / 199
    - **setter_genaro_de_mori**: 652 / 112
    - **setter_yesxander**: 0 leads (no se le asigna más, sigue en sistema)
    - **setter_ivi_treise**: 0 leads (idem)
    - Total leads 5246 (5242 antes del redistribute + 4 recuperados de evelio).

48. **Cache-buster actual: `v=20260525c`** (`public/index.html`, `app.js` + `style.css`; `wa.js` en `v=20260523a`). Bumpear ante cualquier cambio a `app.js`, `style.css` o `wa.js`. La regla está documentada arriba pero se olvida fácil.

49. **wa-multi desktop sigue en v0.5.4** (no se tocó en sesión 2026-05-24). Ubicación: `Desktop\wa-multi\versiones\wa-multi-portable-v0.5.4\`.

## Sesión 2026-05-25→29 — Cold Call Funnel + Power Dialer sobre Setteo + setter Ignacio

50. **Setter "Ignacio" para el admin** (`cc48a5a`, 2026-05-25): el admin (Ignacio) ahora tiene su propio setter record `setter_ignacio` con pipeline propio, para poder settear/cold-callear como cualquier otro. Se le asignaron leads de México (97 vírgenes reseteados, ver `538ddbe`/`9ce2557`/`ac347ab` — la asignación de Quito se revirtió, solo quedó México). **No confundir con `setter_evelio`** (ese era el orfano viejo, ya borrado en la sesión anterior).

51. **Borrado de 68 leads sin teléfono** (`01bf378`, 2026-05-25): one-shot que eliminó leads sin `phone`. Total bajó de 5246 → 5178. Los conteos de leads en la nota #47 (estado 2026-05-24) quedaron desactualizados por esto + la reasignación de México.

52. **Cold Call Funnel** (`5c0d0f8`/`a2df7e1`, 2026-05-27): dashboard SDR en `view-myperf`.
    - Backend: `GET /api/setters/cold-call-metrics?setter=<id>&period=today|week|month|all` ([index.js:3687](index.js:3687)). RBAC: setter solo ve lo suyo (vía `getEffectiveAuth`), admin/supervisor cualquier setter o todos (setter vacío). Métricas derivadas **del `callLog`** de cada lead (no de interactions): `dials` (todo entry con ts en período), `connects` (outcome ∈ {answered_interested, answered_not_interested, scheduled_with_admin, callback_later, hung_up}), `conversations` (connect con `duration >= 30s`), `appointments` (outcome=scheduled_with_admin). `deals` queda en 0 — **no hay estado closed_won todavía**; el endpoint tiene el placeholder listo para cuando se agregue `lead.dealWon`/estado='ganado'.
    - Frontend: bloque "📞 Cold Call Funnel" en view-myperf, 5 cards con barras proporcionales + selector de período + 5 ratios (connect/conversation/booking/dial→appt/avg duration) + benchmark SDR. Loader `_mypLoadColdCall` corre desde la chain `_mypLoad` (no solo onclick — fix `a2df7e1`).

53. **Power Dialer ahora disca leads de Setteo, no solo "Sin WSP"** (`60af36c`, 2026-05-29): `GET /api/setters/leads/sin-wsp?include=callable` ahora también devuelve leads con teléfono accionables (no descartado/agendado) aunque estén en flujo Setteo (`sin_contactar`). Resolvía que admin/setter no podía cold-callear sus leads mexicanos porque estaban en Setteo, no en Llamadas. Frontend: checkbox "Incluir leads de Setteo" en filtros de view-calls ([public/app.js:4144](public/app.js:4144), `params.set('include','callable')`).

54. **Disposition "🚪 Me cortó" (outcome `hung_up`)** (`60af36c`): para cuando atienden y cuelgan de una. **Cuenta como CONNECT en el funnel** (atendió) pero NO como conversación. **NO descarta el lead** — queda re-llamable. Si se quisiera descartar, es 1 línea en backend. Está en el grid del Power Dialer (atajo `3`) + keyMap 1-8 + `callOutcomeLabel` ([public/app.js:4645](public/app.js:4645)).

55. **Botón "📞 Discar número" ad-hoc** (`0ae41ca`, 2026-05-25): permite discar un número arbitrario sin lead asociado (testing, devolver llamada perdida) desde view-calls ([public/app.js:4770](public/app.js:4770)).

56. **Nota pre-call (`lead.precallNote`)** (Sprint 24): textarea en cada card de Llamadas donde el setter prepara contexto/ángulo de apertura ANTES de discar. Distinto de `notes[]` (post-interacción). Se persiste vía `_callsSavePrecallNote` → backend ([index.js:5402](index.js:5402)).

57. **Bulk-action endpoint de leads en Llamadas** ([index.js:5270](index.js:5270)): acciones válidas `mark_wrong`, `mark_invalid`, `discard`, `assign`, `move_to_setteo` para operar sobre múltiples leads del Power Dialer.

## Sesión 2026-05-29 (parte 2) — Telnyx: saldo real, costo real (CDRs), nota en dispositions, filtro "Para seguir"

58. **Saldo real de Telnyx** (`74e2837`): `GET /api/telnyx/balance` (admin/supervisor) consulta `https://api.telnyx.com/v2/balance` server-side (API key NUNCA al browser), caché 60s (`?fresh=1` para forzar). Devuelve `{balance, availableCredit, creditLimit, currency, lowBalanceThreshold, low}`. `low = availableCredit <= umbral`. Card "💳 Saldo de la cuenta" en Centralita con banner de alerta + input de umbral. **`lowBalanceThreshold`** (default $10) es campo NO-secreto en `telnyx_config.json`, editable por PUT `/api/telnyx/config`.

59. **Costo REAL por CDRs — el dato facturado, no el estimado** (`ee6d9e9`). Aprendizajes verificados contra la API real:
    - Cada llamada WebRTC→PSTN genera **2 CDRs** que comparten `telnyx_session_id` (y `id`): uno `record_type=webrtc` (~$0.002/min, componente WebRTC) y uno `record_type=sip-trunking` (la **terminación al país destino**, el costo grande). `call-control` viene vacío (usamos credential-auth WebRTC, no Call Control API).
    - **Costo real total de una llamada = suma del `cost` (string!) de ambas patas** agrupadas por `telnyx_session_id`.
    - El `sip-trunking` trae `country_iso` ("MX") y `cld` (destino) → agregación por país sin estimar.
    - Acceso a la API de Telnyx vía helper `_telnyxFetchDetailRecords(apiKey, {recordType, dateRange})` que pega a `https://api.telnyx.com/v2/detail_records?filter[record_type]=<type>&filter[date_range]=<range>`. `dateRange` usa presets de Telnyx: `today|yesterday|last_7_days|last_30_days` (NO acepta "all"). Paginado con `_telnyxFetchAllDetailRecords`.
    - `GET /api/telnyx/real-costs?range=` (admin/supervisor): agrega total + byCountry + byDay + conectadas + prom/llamada. Caché 5min. Card "💵 Costo real" en Centralita.
    - `GET /api/telnyx/cdr-probe?type=&range=` (admin): diagnóstico, vuelca CDRs crudos. Útil si Telnyx cambia el shape.

60. **Reconciliación costo real → callLog** (`fd5fe63`): `POST /api/telnyx/reconcile-costs?range=` (admin) y función core `_telnyxReconcileCosts(apiKey, range)`. Matchea cada session con el callLog entry (`channel='telnyx_webrtc'`) por `dest_number == lead.phone` (helper `_telnyxPhoneMatch`: dígitos exactos o últimos 10) + `started_at ≈ entry.ts - duration` (ventana 4min). Escribe `entry.realCost`, `entry.realCostCurrency`, `entry.realCostSid`, `entry.realCostReconciledAt`. **Auto-reconcile**: timer `_scheduleTelnyxAutoReconcile()` corre last_7_days ~2min post-boot + cada 6h (skip en test/sin apiKey) — porque los CDRs se tarifan minutos/horas después de la llamada. Las **métricas por setter** (`/api/telnyx/metrics`) ahora prefieren `realCost` sobre el estimado. El estimado (`_estimateTelnyxCost`, tabla hardcoded) queda como fallback hasta que el CDR se reconcilia. Historial del Power Dialer muestra "$X real" vs "~$X estimado".

61. **Nota rápida en dispositions del Power Dialer** (`fd5fe63`): input `#pd-call-note` arriba del grid de resultados. Al marcar cualquier outcome directo, `_handleCallDisposition` lo lee y lo manda como `body.notes` (el backend ya lo guardaba en `logEntry.notes`). Cubre Me cortó/No atendió/Buzón/Interesado que antes no tenían dónde anotar. Distinto del `telnyx-call-quick-note` (panel flotante durante la llamada → `logEntry.quickNote`) y del `precallNote` (pre-discado).

62. **Filtro "Para seguir" en Llamadas** (`fd5fe63`): opción `follow_up` en `#calls-sort-select` (opt-in; default sigue `never_called`). En `renderCallsList` filtra a callbacks vencidos (`callbackAt <= now`) + leads cuyo último outcome ∈ {`hung_up`,`no_answer`,`voicemail`} y no descartados. Ordena callbacks-vencidos primero (más vencido arriba), luego cortados por última llamada. Es la cola de seguimiento del día separada de los vírgenes.

63. **"Interesado" NO auto-agenda — es intencional** ([index.js:5779](index.js:5779)): `answered_interested` deja el lead en Llamadas con chip verde (`estado='interesado'`) esperando agendamiento manual. NO abre modal de agenda. El agendamiento real es la disposition aparte `scheduled_with_admin` (crea entry en `data.calendar`). No "arreglar" esto pensando que falta el modal.

64. **Cache-buster actual: `v=20260529c`** (reemplaza la nota #48). app.js + style.css. wa.js en `v=20260610a` (Phase 8).

## Phase 8 — Anti-detección wa-multi: Proxy + Fingerprint (2026-06-10)

Proxy opt-in por cuenta + coherencia geo, montado sobre el fingerprint que YA existía (canvas/webgl/audio/cores/RAM/Chrome por seed, en el preload desde warming-lunes). Plan completo en `.planning/phases/08-anti-deteccion-proxy-fingerprint/`.

65. **Proxy por cuenta (opt-in)**: campos `proxy:{type,host,port,user,pass}|null` + `geo:{country,timezone,locale}|null` + `proxyLastTest` en cada cuenta de `wa_accounts.json`. `null` = sin proxy (comportamiento histórico). Solo HTTP/SOCKS5 — V2Ray/vmess excluido a propósito. Helpers en `src/wa/data.js`: `GEO_DEFAULTS` (país→tz/locale), `geoForCountry()`, `setAccountProxy()`.

66. **Endpoints proxy** (`src/wa/routes.js`): `PATCH /api/wa/accounts/:id/proxy` (admin o setter dueño; valida type/port; deriva geo del país; preserva pass si se omite). `GET /api/wa/accounts/:id/proxy-credentials` (devuelve pass COMPLETO on-demand, solo al dueño — lo usa el desktop al abrir). `GET/PUT /api/wa/policy` (`requireProxyForCampaigns`, lo consumirá Phase 7).

67. **No-leak del pass**: `GET /api/wa/accounts` pasa por `publicAccount()` que tapa `proxy.pass` → solo `hasPass:true`. El panel NUNCA ve el pass. El desktop sí, vía el endpoint dedicado. EXCEPCIÓN: `/api/wa/admin/export` (backup admin que baja pre-deploy) sí lo incluye en claro — necesario para restaurar. ⚠️ Cuando se carguen proxies reales con pass, sumar `proxy.pass` al stripper de `scripts/pre-deploy.js` (mismo patrón que Telnyx) o se commitearía en claro.

68. **Desktop (wa-multi, `out/main/index.js` + `out/preload/whatsapp.js`)**: al abrir una cuenta, `openAccountWindow` pide las creds completas, aplica `ses.setProxy({proxyRules})` (NATIVO Electron), auth user:pass vía `app.on('login')` (mapeado por `webContents.id`), y un **fail-safe anti-leak**: carga un echo-IP a través del proxy ANTES de WhatsApp — si el proxy está caído, la cuenta NO abre con la IP real. El preload spoofea timezone/locale/UA (`applyGeoPatches`) SOLO si hay geo. UA ahora varía por cuenta (`uaForAccount`, antes era fijo). El UA del proceso y el de `navigator` se pasan iguales vía `--wa-ua`. **NO hay fuente `.ts`: `out/` ES el source — NO correr `npm run build`/`dist:win` (clobberea). Repack = packager/asar sobre `out/` directo.**

69. **Cache-buster wa.js**: `v=20260610a` (Phase 8 tocó wa.js). Reemplaza el `v=20260523a` de notas viejas.

## Phase 7 — Motor de Campañas Drip WhatsApp (2026-06-10)

Campañas de outbound tipo Go High Level dentro del SCM. Drip configurable, split
de variantes, bloques con delays, bumps automáticos con cancelación al responder.
El handoff a Mercury IA (conversar + agendar) es Phase 4, NO esta fase. Plan en
`.planning/phases/07-campanas-drip-wa/`. Doc: `docs/campanas-drip.md`.

70. **Data layer** (`src/wa/campaigns.js`): `wa_campaigns.json` = `{campaigns[], leadStates{}}`. leadStates separado de la campaña (keyed por campaignId→leadId) para no inflar el listado. `mutateCampaigns` (mutex async). Helpers puros testeables: `sanitizeCampaign`, `buildVariantAssignments` (split ponderado), `selectLeadsFromMap` (filtra el MAP de leads por país/setter/estado, excluye sin-tel/descartado/agendado), `randomBlockDelay`.

71. **Endpoints** (`src/wa/routes.js`): CRUD `/api/wa/campaigns` (admin + setter dueño vía `canActOnCampaign`). `POST /:id/launch` snapshotea leads del filtro fresco + asigna variante (split) + cuenta (round-robin) + crea leadStates queued + valida `requireProxyForCampaigns` de Phase 8 (409 si cuenta sin proxy). `pause/resume/cancel`. PATCH solo en draft/paused.

72. **El motor** (`src/wa/campaign-engine.js`): `campaignEngineTick(deps)` corre cada 60s (setInterval, skip en test — los tests lo llaman con `now` inyectado), SEPARADO del `scheduledMessagesTick` de followups. Drip libera batchSize/intervalMinutes; opener en bloques con delay random; bumps a las afterHours; respeta ventana horaria (`isWithinWindow` por timezone+día) + cap por cuenta (`warmingCapByDay`: 12/30/80/200/400) + cuenta no CONNECTED = requeue. **Emite `followup:send-message`** (handler que YA existe en wa-multi v0.5.8 → NO requiere repack; `campaign:send-message` quedó como mejora futura no implementada). Arranca en `mountWa` (src/wa/index.js).

73. **Detección de respuesta** (`handleCampaignInbound` en campaign-engine.js, llamado desde gateway.js en el hook `ai-classified-inbound` tras el filtro warming): matchea phone→lead→campaña running (`phoneMatches` últimos 8 díg), avanza estado (awaiting_reply→qualifying o replied_for_setter; intent descalificado→disqualified), cancela bumps. `deps.markLeadReplied` (index.js) marca `respondio=true` + cascade para que aparezca en el pipeline del setter.

74. **Estados del lead**: queued → opener_sending → awaiting_reply → (qualifying →) replied_for_setter | no_reply | disqualified. Campaña pasa a `done` sola cuando no quedan leads activos.

75. **Persistencia**: `wa_campaigns.json` en `/api/wa/admin/export` + `pre-deploy` + `seedVolumeFromRepo` + `BACKUP_FILES`. Sin esto un redeploy las borra (regla #21).

76. **PENDIENTE Phase 7**: Wave 6 (UI builder en el panel) — sin construir aún. Las campañas se crean/lanzan por API; falta la vista `view-wa-campaigns` con el builder. Backend 100% funcional y testeado (99 tests WA+campañas verdes).

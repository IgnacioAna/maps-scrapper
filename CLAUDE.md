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
- `index.js` (~12450 líneas) - Servidor Express, todos los endpoints API genéricos, lógica de negocio
  - IMPORTANTE: rutas sin `:id` (como `/sin-wsp`) DEBEN ir ANTES de rutas con `:id`
  - `ensureLeadDefaults()` - inicializa campos de lead (incluye calificado=false)
  - Cascade logic en PATCH `/api/setters/leads/:id`
  - `attachAuth` se monta en `/api`, NO en rutas onboarding públicas
- `src/wa/*` - módulo WA, montado vía `mountWa(app)`

### Frontend
- `public/index.html` (~3166 líneas) - HTML completo, todas las vistas, Geist fonts
- `public/app.js` (~14780 líneas) - Toda la lógica frontend (vanilla JS, ES modules)
- `public/style.css` (~3920 líneas) - **SCM Design System v1.1** (rediseño 2026-04-25)
  - Tokens: `--accent` violeta `#9D85F2`, `--bg-app #0F1115`, `--text-primary #E5E7E2`
  - Disciplina cromática: violeta sólo para acentos, no para textos
  - Variables legacy mantenidas (`--text-main`, `--primary-color`, etc.) por compatibilidad
- `public/wa.js` (~1850 líneas) - lógica del módulo WA en frontend
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
- **Total actual: ~585 tests en ~39 files** (1 flaky ambiental conocido: `wa-campaign-engine`, depende de hora/día)

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
| `pitch` | Pattern interrupt con dato real (`{years}` + `{reviews}`) + casos de éxito UY (147 citas clínica grande / 50 agendas consultorio chico) | Después de opener |
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

## Sesión 2026-06-13 — Phase 9 Call Center efectividad (4 features)

77. **Cierre del funnel SDR (deals/ganado)** (`index.js` + `app.js`): el estado terminal `lead.estado='cerrado'` existía pero NUNCA se seteaba — quedó sin camino. Ahora se cierra desde la **cita del calendario**: nuevo `calendarioEstado='ganada'` (agregado a `validEstados` + `CALENDAR_STATES`). En PATCH `/api/setters/calendar/:id`, marcar 'ganada' → setea `entry.closedAt` + propaga al lead `estado='cerrado'`, `closedAt`, `dealValue` (= `valorProyecto`). Revertir el estado deshace el cierre (lead vuelve a 'agendado'). `GET /api/setters/cold-call-metrics` ahora cuenta `deals` + `revenue` desde las citas 'ganada' cuyo `closedAt` cae en el período, atribuidas al setter que agendó (`entry.setterId`). Frontend: opción "🏆 GANADA" en el select de Reuniones agendadas (pide valor del proyecto), chip 💵 en la card, y el card "Deals Closed" del Cold Call Funnel muestra closeRate + revenue. Tests: `tests/funnel-close.test.js` (4). Defaults `closedAt`/`dealValue` en `ensureLeadDefaults`.

78. **Power Dialer — autopiloto + atajos** (`app.js` + `index.html`, todo bajo `_pd*`): **BUG REAL arreglado** — los atajos numéricos 1-8 estaban anunciados en la UI pero NO cableados (el keydown handler solo tenía Esc/c/s). Ahora `_pdKeyOutcomes` mapea 1-8 → outcomes (mismo orden que el grid). **Autopiloto** (toggle en header `pd-autopilot-toggle`, persistido en `localStorage` `pd_autopilot_<userId>`): tras cada disposition/advance, arranca un countdown de 3s (`_pdStartAutopilotCountdown`, banner en `pd-current-wrap`) y auto-disca el siguiente lead. Se cancela con cualquier interacción (C/S/1-8/Esc/P) o si ya hay llamada activa. Flag interno `_pd.autopilotArmed` (se setea en `_pdAdvance`, se consume al final de `_pdRender`); NO auto-disca el primer lead al abrir. Atajos nuevos: **B** (lead anterior, `_pdBack`), **N** (foco nota), **A** (toggle autopiloto), **P** (pausar countdown).

79. **Mercury en vivo en la llamada** (`app.js` + `index.html`): bloque colapsable "🤖 Mercury en vivo" dentro del `#telnyx-script-panel` (panel de guiones de la llamada). Chips de objeción comunes (precio/ya tiene sistema/sin tiempo/mandá info/lo piensa/quién sos) + textarea libre → `_mercLiveGenerate()` pega a `/api/mercury/generate` (mismo endpoint del Asistente, `requireAuth`) con contexto del lead activo (`_telnyxCallState.leadId`). Devuelve bloques sanitizados con botón copiar c/u. **Whisper sigue siendo post-llamada** (no streaming): "en vivo" = helper de objeciones instantáneo, no transcripción en tiempo real.

80. **Lead scoring** (`app.js` + `index.html`): helper `window._callScore(lead)` (0-100 aprox) combina calidad del negocio (reseñas log-scaled +20, rating +10), esfuerzo (nunca llamado +18, cada intento -6, interesado +25, callback vencido +15) y señales negativas (voicemail -6, wrong/invalid -40). Nueva opción de sort "🎯 Prioridad (mejor a llamar)" en `#calls-sort-select`, usada tanto en `renderCallsList` como en `_pdBuildQueue` (Power Dialer). Chip 🎯 con el score en la card del Power Dialer. Cálculo 100% client-side (no toca backend).

81. **Call recording → decisión: visibilidad del transcript (NO audio)**. El audio se graba en browser (MediaRecorder, setter+lead) y se sube a `/api/telnyx/calls/:leadId/transcribe` (Whisper) pero **NO se persiste** — solo queda `entry.transcript = {segments:[{speaker,text}], transcribedAt, whisperModel, language}` en el callLog. El user eligió NO persistir audio (tradeoff de storage/volumen/backups) sino mejorar la visibilidad del transcript que ya existe. Hecho: el bloque "Últimas llamadas" de la card del Power Dialer ahora muestra 🎤 en las llamadas con transcript y son **expandibles inline** (`<details>` nativo, sin JS) para leer los segments setter/lead. Antes el transcript solo se veía en el drilldown de Historial de llamadas (`view-call-history`). Si en el futuro se quiere audio: `DATA_DIR/recordings/`, `entry.recordingFile`, endpoint de stream + player, opt-in por flag.

82. **Cache-buster actual: `v=20260617a`** (reemplaza #64). app.js + index.html. style.css NO se tocó (sigue en `v=20260604b`). wa.js en `v=20260610g`.

## Sesión 2026-06-17 — Planificación masiva (Phases 10-15) + Ola 1 build (rama)

83. **Planificación completa en `.planning/phases/10..15/` + `.planning/BUILD-AGENTS.md`** (20 agentes de research). 6 fases: 10 Enrichment/arsenal, 11 Battlecards, 12 SDR Operating System, 13 UI restructure (leadStore+Hoy+dialpad), 14 Lead-Ops pool único + 3 carriles (bot parkeado), 15 Purga deuda técnica + consolidación panel. Plan de build multi-agente: 7 roles por zona de archivo, 6 olas. **Decisiones clave del user**: pool único de distribución a setters; bots PARKEADOS (sin acceso aún, solo el owner); sin-WhatsApp = carril llamada (NO borrar); legal = guardrails no bloqueante; brief = munición no libreto; scripts → battlecards situacionales.

84. **Ola 1 build en rama `build/ola1-purga-componentes`** (NO deployado aún — pendiente review del user + pre-deploy). 3 fixes/features verificados (tests + preview):
    - **fix `include=callable`** (`index.js` GET /leads/sin-wsp): el checkbox "Incluir leads de Setteo" no hacía nada (el front mandaba el flag, el back lo ignoraba). Ahora suma leads de Setteo llamables. Preview: 1245→5163 leads. `tests/callable-leads.test.js`.
    - **backfill país** (`countryFromPhonePrefix()` + `POST /api/admin/backfill-country`, dryRun+backup, idempotente, no pisa país existente). Preview dryRun: 1359 leads completables. **NO afecta caller ID** (rutea por prefijo del tel, re-verificado contra el agente que decía lo contrario). `tests/country-backfill.test.js`.
    - **hora local del lead** (`_leadLocalTime()` país→IANA tz, chip 🕐 en card del Power Dialer con flag horario hábil 9-19h). Verificado contra UTC.
    - ⚠️ **El research de agentes tuvo 2 errores reales que el re-check atrapó**: (1) "campos muertos" `lastStage` SÍ se usa (export CSV); (2) backfill país NO mejora caller ID. Lección: verificar siempre, no confiar 100% en los agentes.
    - Test pre-existente que falla (no relacionado): `wa-campaign-engine.test.js` 1 test dependiente de hora/día (falla igual en main limpio). Bot parkeado.

## Sesión 2026-06-17 (parte 2) — Ola 1 deployada + Lead-Ops pool + reciclaje + limpieza de panel

85. **Todo lo de Ola 1 + Phase 14 (pool) YA está en producción** (mergeado a `main`, deployado). Endpoints nuevos en `index.js`: `GET /api/setters/pool-summary` (total, unassigned, byTier, **allSetters** para el dropdown destino, bySetter, byCountry, byEstado), `POST /api/setters/pool-distribute` (reparte en orden de prioridad tier 1→4, resetea cada lead al moverlo, `fromSetterId` acepta `__unassigned__`/`__all__`/setterId), `POST /api/admin/recycle-pool` (estampa `recontactPriority`, desasigna todo, resetea, `conexion='sin_wsp'`, conserva callLog siempre + notas solo de tier-1). Helpers: `_leadPoolTier()` (prefiere `lead.recontactPriority` estampado 1-4, sino lo deriva), `_resetLeadForRedistribution()`, `_TIER_META`. `PATCH /api/setters/team/:id` ahora acepta `{hidden}`. Tests: `pool-distribution`, `pool-distribute-tiers`, `recycle-pool`, `callable-leads`, `country-backfill`, `funnel-close` (todos verdes).

86. **Reciclaje EJECUTADO en prod (one-time, 2026-06-17)**: 5178 leads → todos al pool sin asignar, `recontactPriority` estampado (interesado 98, sin_contactar 1458, medio 3227, no_interesado 395), notas conservadas solo en 84 (interesados). **El botón "Reciclar todo el pool" se REMOVIÓ del HTML/JS** tras usarse (era one-time, no debe re-dispararse). Backup pre-reciclaje en commit `3da231c`. Vista nueva **`view-pool` "Distribución"** (grupo Equipo): KPIs del pool + chips por tier + panel "¿A qué país llamar ahora?" (ordena por horario hábil) + tabla por-setter + form de distribución (origen/tier/destino/país/cantidad). `loadPoolView()` en app.js. **Genaro está `hidden:true`** (sacado del dropdown de filtro; los 3 setters reales son Ignacio, Paula, Maxi).

87. **Limpieza de panel (Phase 15)**: parkeados (data-roles="parked", reversibles) el grupo WhatsApp/bots completo + Objeciones, Historial de scrapes, Revisión IA, Config Mercury. **Setteo WhatsApp (view-crm) PARKEADO** — "todo el trabajo es por llamada". La **vista por defecto de TODOS los roles pasó a Llamadas** (init en app.js ~8671 clickea view-calls; antes setters→Setteo, admin→Maps). Setters (role setter, ej. Maxi) ahora acceden a **Llamadas** (data-roles incluye setter; ven solo sus leads). **Centro de Comando consolidado**: se quitaron 4 secciones muertas de Setteo (Variables del Setter, Editor de variables, tabla "Rendimiento por Setter" que duplicaba Equipo, tabla "Rendimiento por Variante"). Conservado: stats globales, funnel de Llamadas, calls-por-setter, Equipo/usuarios, Base de Datos de Scrapeados. **Centralita Telnyx**: estaba bien organizada (no era quilombo); el ruido eran 2 cards de analytics pesado (💵 Costo real CDRs + 🎯 Efectividad cold call) metidas en pantalla de config → se colapsaron en un `<details>` "📊 Costos y efectividad" (drawer cerrado por default, `#tlx-analytics-drawer`). La config (creds/números/routing/guiones/saldo) lidera. Solo layout, sin tocar loaders. **Posible mejora futura (no hecha)**: mover 🎯 Efectividad a view-myperf (overlapea con el Cold Call Funnel de la nota #52).

88. **Cache-buster (histórico)**: `v=20260617k`. Reemplazado por #94 (ver Phase 16).

## Sesión 2026-06-18 — Phase 16: Lead Signals/Brief + Scraping global + Enrichment por API

Plan en `.planning/phases/16-enrichment-y-scraping-global/PLAN.md`. Research base en `.planning/research/2026-06-17-*.md` (3 agentes: scraping-expansion, lead-sources-by-region, sdr-enrichment-playbook). **SUMA al roadmap (Phases 10-15), no reemplaza.** 3 olas, todo deployado + testeado.

89. **Ola A — Lead Signals / Brief** (`index.js` + `app.js`): `computeLeadSignals(lead)` deriva `signals[]` (muchas_reviews_sin_web, sin_web, rating_bajo, pocas_reviews, ig_sin_web, sin_contacto_digital), `reputationTier` (critico/debil/medio/fuerte/desconocido), `ratingNum`, `hasWebsite` (filtra wa.me/redes vía `_leadHasRealWebsite`), `openingAngle` (cue de apertura por señal dominante). Pura derivación de rating/reviews/web/instagram (datos ya scrapeados), patrón = `computeWspProbability`. `ensureLeadDefaults` los computa lazy (campos: category, signals, reputationTier, ratingNum, hasWebsite, openingAngle, signalsAt). **`loadSettersData` aplica ensureLeadDefaults a cada lead → las señales aparecen solas en cada load.** UI: chips de señales (`_signalChips`, `window._signalChips`) + bloque "💡 Ángulo sugerido" en la card del Power Dialer y en la ficha en-llamada (`_renderLeadFile`). Tests: `tests/lead-signals.test.js` (4).

90. **BARRIDA ejecutada en prod (2026-06-18)**: `POST /api/admin/backfill-signals` (dryRun+backup, idempotente por determinismo) recomputó+persistió señales para los **5178 leads** (3677 con ángulo accionable = 71%). bySignal: sin_contacto_digital 2235, pocas_reviews 1451, sin_web 547, rating_bajo 330, ig_sin_web 230, muchas_reviews_sin_web 53.

91. **Ola B — Scraper multi-país** (`index.js` + `locations.js` + `app.js`): `COUNTRY_LOCALE` (Estados Unidos/Canadá/Reino Unido/Alemania/Francia/Italia/Brasil → {hl,gl,google_domain}) + `localeForCountry()` (LatAm/España → null = comportamiento histórico EXACTO, cero regresión). `searchLocation` + `enrich-from-maps`: query localizada (coma, no "en") + hl/gl/google_domain para no-hispanos. `SECTOR_ROOTS` multiidioma + `_isSectorRelevant()` en los filtros de relevancia (OR con query → más permisivo, no descarta EN/DE/PT/FR/IT). `locations.js`: +Canadá/Reino Unido/Alemania/Francia/Italia, Brasil ampliado a 30 ciudades. UI: keywords sugeridas por país (idioma local) en el form de Maps (`_MAPS_KEYWORDS`, clic = agregar al textarea). **gl NO rige la búsqueda en SerpApi (solo Place API); el país lo da la query+location. Caller ID Telnyx NO afectado (rutea por prefijo del tel).** Tests: `tests/scrape-i18n.test.js` (8). Helpers en `globalThis.__phase16`.

92. **Ola C — Enrichment por API gratis** (`src/enrichment.js` nuevo, self-contained, 0 deps): `enrichFromWebsite(website)` (fetch del sitio → email, filtra wa.me/redes, scoring mailto>mismo-dominio>genérico), `enrichFromNPI({name,city,state})` (NPI Registry USA → ownerName decisor + specialty). Nunca lanzan, degradan a null/{error}, timeout vía AbortController. Endpoint `POST /api/admin/enrich-leads` (admin, opt-in, batch cap 25/100, fetches FUERA del mutex + aplica DENTRO vía `mutateSettersData`, backup). source=website|npi|both. Persiste email/doctor/specialty/npi/enrichedAt (solo si el campo estaba vacío). UI: botones "✨ Enriquecer email (web)" + "🇺🇸 Enriquecer dueño (NPI)" en Centro de Comando (1 lote de 25 por clic). Tests: `tests/enrichment.test.js` (29, fetch mockeado). **Verificado en vivo: NPI real (Aspen Dental→owner+specialty), fetch web real (deltadental parsea). El hit-rate de email depende del sitio (chicos tienen mailto, corporativos usan formularios) — best-effort. CNPJ Brasil NO se hizo: BrasilAPI es CNPJ→data, no name→CNPJ, y no scrapeamos el CNPJ.**

93. **Tests flaky/ambientales (NO regresiones)**: `wa-campaign-engine` (time/day), `followups:153` (assertion de tiempo relativo cerca de medianoche), `mercury-generate` (red/timing, pasa en retry/exit 0). Fallan en aislado + pasaron en corridas previas la misma sesión. La suite "real" (mis features) = `lead-signals` 4 + `scrape-i18n` 8 + `enrichment` 29, todas verdes. Si CI los marca, re-correr.

94. **Cache-buster (histórico)**: `v=20260618c`. Reemplazado por #97.

## Sesión 2026-06-18 (parte 2) — Phase 17 Ola 1: razón de descalificación + DNC (ideas Adversus)

Origen: demo en vivo de Adversus (cold-call CRM). Backlog en `.planning/backlog/ideas-adversus-2026-06-18.md`, plan en `.planning/phases/17-disposition-dnc-cadencias/PLAN.md`. Olas 2-4 (shared callback, cadencias/auto-redial, UX) pendientes.

95. **Razón de descalificación**: `call-disposition` acepta `disqualifyReason` (whitelist `DISQUALIFY_REASONS`: no_es_icp, no_es_decisor, ya_no_trabaja, sin_presupuesto, ya_tiene_proveedor, cliente_actual, mala_experiencia, no_contactar, ya_agendado, otro) en outcome `answered_not_interested`. Persiste en `lead.disqualifyReason` + `logEntry.disqualifyReason`. Reporte en `cold-call-metrics.byReason` (razones de pérdida por período). UI: el modal "¿por qué dijo que no?" (Sprint 25, era solo objectionTags) ahora tiene también un dropdown de razón + checkbox DNC.

96. **DNC (No-llamar)**: `lead.doNotCall` (+ `doNotCallReason/At/By`) en `ensureLeadDefaults`. Se setea desde el modal (checkbox), o auto si la razón es `no_contactar` (`DNC_REASONS`), o vía bulk `mark_dnc`. **Saca el lead de TODA cola de llamada**: `sin-wsp` (guard al tope; `?dnc=1` para que el admin los liste), `getReassignCandidates` (no se distribuyen), `pool-summary` (los cuenta en `dnc` aparte, fuera de byTier). Deshacer: bulk `clear_dnc` (vuelve a sin_contactar+sin_wsp). UI: toggle "🚫 No-llamar" en Llamadas (vista `dnc=1`, bypassa el filtro de descartados en renderCallsList) + badge rojo + botón "↩️ Quitar" por card. **Compliance** para cold calling EU/USA/CA (DNC/TPS/CASL). Tests: `tests/disposition-dnc.test.js` (6).

97. **Cache-buster (histórico)**: `v=20260618d`. Reemplazado por #101.

## Sesión 2026-06-18 (parte 3) — Phase 17 Olas 2-4 (shared callback, cadencia, UX)

Plan completo en `.planning/phases/17-disposition-dnc-cadencias/PLAN.md`. Las 4 olas de Phase 17 ya están deployadas.

98. **Ola 2 — Shared vs Private callback**: `lead.callbackShared` (bool, default false=privado) en `ensureLeadDefaults`. `call-disposition` `callback_later` acepta `callbackShared`. Los callbacks **compartidos vencidos** aparecen en la cola `sin-wsp` de TODOS los setters (no solo el dueño): el filtro de setter ahora es `assignedTo===yo || (callbackShared && callbackAt vencido)`. Cuando un setter toca un lead ajeno que es shared-due, el guard de auth lo permite + **lo reasigna + apaga callbackShared** (lo "tomó"). UI: checkbox "🔁 Callback compartido" en el modal de callback + chip 🔁 en la card. Tests: `tests/shared-callback.test.js` (3).

99. **Ola 3 — Cadencia / auto-redial (solo-llamada, sin dialer automático)**: en `call-disposition`, `no_answer`/`voicemail` SIN callback manual y no-DNC auto-programan `callbackAt` según la racha de no-contacto (`CADENCE_HOURS=[3,24,72]` → +3h, +1d, +3d; tras agotar → `lead.cadenceExhausted=true`). `lead.cadenceStep` = nº de reintento. Un connect (cualquier outcome ≠ no_answer/voicemail) rompe la racha. **Reusa `callbackAt` + la cola "Para seguir" — NO hay dialer automático, la llamada siempre la dispara una persona** (compliance). Defaults `cadenceStep`/`cadenceExhausted` en `ensureLeadDefaults`. UI: chip "🔁 auto #N" en la card. Tests: `tests/call-cadence.test.js` (6).

100. **Ola 4 — UX**: `_renderCallHistory` (panel durante la llamada) ahora es una **timeline unificada** (callLog + notes ordenados por fecha desc, últimos 6 + contador) en vez de "solo el último intento" (idea Adversus: Activity timeline). Quick-links (Web/Maps/IG/FB) del lead-file más prominentes (font/padding bump, 4 ocurrencias). Frontend-only, sin tests nuevos.

101. **Cache-buster (histórico)**: `v=20260618f`. **Phase 17 COMPLETA (olas 1-4).**

102. **Señal "ya pauta" (Phase 10 C6 parcial, 2026-06-18)**: `detectAdPixels(html)` en `src/enrichment.js` (Meta/Google Ads/TikTok/GTM; no confunde GA4 con Ads). `enrichFromWebsite` devuelve `{email, ads}`. `computeLeadSignals`: si `lead.runsAds` → señal `ads_activos` DOMINANTE + ángulo. El endpoint `enrich-leads` detecta ads en el mismo fetch del sitio (`adsCheckedAt`, recomputa señales, reporta `adsFound`). Chip "📣 Corre anuncios". Tests: `tests/ad-detection.test.js` (5). Cache-buster `v=20260618g`.

104. **Safe wave (2026-06-18, deployada)** — 4 features safe/gratis de Phases 10/12/13:
    - **SAFE-1 persistencia** (P12): cadencia auto-redial extendida 3→6 intentos (`CADENCE_HOURS=[3,24,72,96,168,168]`); `_callScore` ya no abandona leads 1-6 (research: 95% de los que convierten se alcanzan al 6to). tests/call-cadence (7).
    - **SAFE-2 benchmarks** (P12): indicadores ▲◆▼ vs benchmark SDR 2026 por ratio en el Cold Call Funnel de view-myperf (connect 15-25%, conv 50-60%, booking 15-25%, dial→appt 1-3%).
    - **SAFE-3 campos del scrape** (P10 A3): `searchLocation` ahora captura `coordinates/placeId/openingHours/businessStatus/category` (SerpAPI ya los devolvía). `businessStatus` en defaults; chip "⚠ Cerrado" + `_callScore -50` si CLOSED. Solo afecta scrapes NUEVOS (leads viejos no tienen estos campos).
    - **SAFE-4 dialpad** (P13): keypad 3×4 real en `#manual-dial-keypad` (modal de discar) + pad DTMF `#telnyx-dtmf-pad` en el panel de llamada (`_telnyx.activeCall.dtmf(k)` para IVRs). CSS `.dialpad-key` en style.css.
    - Cache-buster: app.js `v=20260618h`, **style.css `v=20260618a`** (reemplaza el `v=20260604b` viejo), index.html. wa.js sin cambios.
    - **PENDIENTE (greenlit por el user pero requiere su presencia)**: COST-1 enrichment IA (review mining/tratamientos/brief — 💲SerpAPI+LLM, build opt-in para que el user dispare el gasto viéndolo), COST-2 validación de número (💲Telnyx/Apify), REFACTOR `_leadStore`+home "Hoy" (riesgoso a ciegas — hacer con el user para test en vivo).

105. **COST waves construidas como BOTONES OPT-IN (2026-06-18, deployadas — gasto gateado al user)**:
    - **COST-2 número** (`v=20260618i`): `_parseTelnyxLookup`/`_telnyxNumberLookup` + `POST /api/admin/validate-numbers` (cap 25, batch, mutex). Persiste `lead.phoneType` (mobile/landline/voip) + `lookupCarrier`. Botón "📞 Validar números ($)" en Comando + chip 📱/☎ en card. Tests: number-lookup (7). WhatsApp-capable (Apify) = sub-pendiente.
    - **COST-1 brief IA** (`v=20260618j`): `_buildBriefMessages`/`_parseBriefOutput` (puras) + `POST /api/admin/enrich-brief` (admin, SELECTIVO premium reviews>=50, cap 8, secuencial): re-fetch place_id+reseñas SerpApi (`google_maps_reviews`) → LLM (`ai`/`AI_MODEL`) → `lead.leadBrief{brief,hookPhrase,painPoints[{dolor,cita}],fitScore,reviewsMined}` + `treatments[]` + `fitScore`. Botón "🧠 Brief IA reseñas ($)" + bloque "🧠 Brief IA" en card del Power Dialer. Tests: lead-brief (6). **⚠️ La calidad del output LLM NO se verificó local (egress bloqueado) — correr 1er lote chico con el user mirando + tunear el prompt `_buildBriefMessages` si hace falta.**
    - Defaults nuevos en ensureLeadDefaults: `phoneType`. `leadBrief`/`treatments`/`fitScore` quedan dinámicos.
    - **Home "Hoy" HECHO (2026-06-18, deployado `v=20260618k`)**: vista nueva ADITIVA `view-hoy` (nav arriba de Llamadas) — `loadHoyView()`/`_hoyRenderSection()` en app.js. 4 secciones client-side (callbacks de hoy / interesados sin agendar / para reintentar [no_answer·voicemail·hung_up] / nuevos por _callScore, cada lead en UNA sección por prioridad) + KPIs de cold-call-metrics + botón Llamar (popula `_callsLeadsById` para que `_startTelnyxCall` resuelva). NO toca Llamadas/Power Dialer → cero regresión. Verificado en preview (148 leads, 4 secciones).
    - **`_leadStore` HECHO (2026-06-18, deployado `v=20260618l`) — versión SEGURA**: `_leadStoreApply(id, patch)` en app.js centraliza la ESCRITURA de estado del lead, manteniendo sincronizados los 2 cachés (`_callsLeadsById` del dialer + `callsLeadsCache` de la lista) en cada mutación. Ruteadas las 4 escrituras optimistas (disposition directa, modal callback, modal objeción, modal agendar). `window._leadStoreApply` expuesto. NO se hizo el rewrite total de los READS (single-store reactivo multi-vista) — es el invasivo/riesgoso y queda como mejora futura; con la escritura unificada los cachés ya no divergen (cada vista re-renderiza fresco al abrir). Verificado en preview (disposition end-to-end OK). 
    - **🎉 ROADMAP COMPLETO**: Phases 6-17 + todas las olas (safe/cost) + home "Hoy" + dialpad + _leadStore-sync → DONE y deployado.

106. **Brief IA — debug + fix (2026-06-18)**: el botón "🧠 Brief IA reseñas" fallaba (briefed 0). Diagnóstico vía endpoint debug (`POST /api/admin/enrich-brief {debug:true}` — admin, devuelve place_id/reseñas/rawLLM/parsed sin persistir, dejado para futuro). Causas + fixes:
    - **Mercury devuelve vacío/`[]`/incompleto** para JSON estructurado en español (problema documentado). Fix: `_buildBriefMessages` ahora manda UN solo mensaje `user` (no system+user); llamada con `temperature:0.1` + `response_format:{type:'json_object'}` (patrón que SÍ funciona en prod, ver autoTag ~8368); schema simplificado (painPoints = strings, no objetos anidados); ejemplo concreto LLENO en el prompt; `_briefLLM()` con **retry 3x** (sube temp). `_parseBriefOutput` tolera painPoints string u objeto.
    - **Mercury devuelve parcial** (a veces solo treatments): se ACEPTA el parcial; hook/brief faltantes caen al `openingAngle` rule-based.
    - **~50% de premium viejos no resuelven place_id** (nombres genéricos, no guardan place_id — los scrapes nuevos sí). Fix: juntar `limit*5` candidatos, priorizar los que ya tienen place_id, y **parar al lograr `limit` éxitos** (saltando los que fallan). errores `no_place_id` esperables.
    - **Verificado en prod**: briefed 3/3, treatments sólidos (extracción/ortodoncia/emergencias), hooks a veces muy buenos ("1300 reseñas, 4.9, atención 24/7"). Best-effort: funciona en leads con ficha resoluble + todos los nuevos. Cache-buster `v=20260618m`.

107. **"Terminá todo" — cierre (2026-06-18)**: de lo planeado desde ayer, **todo hecho**. (1) Brief IA: ✅ verificado+arreglado (#106). (2) `_leadStore`: ✅ versión segura (escritura unificada #105-leadStore); el reactivo multi-vista total queda opcional (no necesario — los cachés ya no divergen). (3) **WhatsApp-capable (Apify): NO se hizo — decisión de criterio**: el módulo WA está parkeado (todo es llamada), los actores Apify de chequeo WA son poco confiables/grey-area, y no se puede verificar el actor sin gastar a ciegas. Bajo ROI ahora. Si en el futuro se reactiva WA, ahí sí. Battlecards = contenido del user; compliance legal = abogado.

108. **Sesión 2026-06-19 — auditoría de visibilidad del arsenal (deployada `18e87ac`)**: el user reportó "no veo lo de las señales en los leads" → mandé 2 agentes de auditoría. Bug raíz + hallazgos (los verificados, descartando ruido de los agentes):
    - **Señales/ángulo NO se veían en la LISTA de Llamadas** (`renderCallsList`): los chips `_signalChips` y el `openingAngle` solo estaban en la card del Power Dialer, Hoy y la ficha en-llamada. Fix en 2 pasos: chips de señales (commit `40bbaed`/`0f11ac5`) + `💡 ángulo sugerido` en el subline de la card de la lista (commit `18e87ac`, ~app.js:6111).
    - **Brief IA no se veía en la ficha en-llamada** (`_renderLeadFile`): agregado bloque "🧠 Brief IA" (fit/hook/dolores/tratamientos) ~app.js:6441.
    - **4 navegaciones a `view-crm` (parkeada → link muerto)** redirigidas a `view-hoy` (banner de follow-ups + notificaciones atrasados/hacer_hoy).
    - **Backend M1**: `Promise.race` timeout 15s en los `getJson` del modo debug de `enrich-brief` (la rama productiva ya lo tenía; la debug podía colgar el request).
    - **Backend m1**: `enrich-leads` (rama ads) ahora persiste `ratingNum`/`hasWebsite` además de `signals/reputationTier/openingAngle` (consistencia con el backfill).
    - **Lección reforzada**: los agentes tiraron varios falsos positivos; verificar siempre contra el código antes de "arreglar".
    - **Cache-buster: `v=20260618o`** (app.js + index.html). style.css en `v=20260618a`, wa.js en `v=20260610g`. Reemplaza #82/#101/#104/#106.

103. **MAPA DE ESTADO DEL ROADMAP**: ver `.planning/ROADMAP-STATUS-2026-06-18.md` — qué está done/parcial/pendiente de las Phases 6-17, clasificado por riesgo/costo. Resumen: completas 6,7(bot parked),8(parked),14,15,16,17. Parciales: **10 ~45%** (quick wins + arsenal-lite + ad-detection; faltan review-mining/treatment-taxonomy/full-brief/number-validation/IG-persist/coords = mayormente 💲LLM/Apify), **13 ~35%** (limpieza+timeline+chips; falta el refactor grande `_leadStore`+home "Hoy"+dialpad), **12 ~10%** (falta persistence-rule/team-dashboard-benchmarks/coaching/leaderboard), **11 ~5%** (battlecards = contenido del user). Lo 💲(cuesta plata) y los refactors grandes esperan OK del user; lo safe se sigue solo.

## Sesión 2026-06-20 — Auditoría del call center (4 fixes backend)

109. **Auditoría del módulo de llamadas → 4 fixes (todo en `index.js`, sin tocar frontend → NO se bumpea cache-buster)**. El estado del call center estaba sólido (WebRTC blindado, firma webhook con `rawBody`, config Telnyx sin leak de secrets, callLog capeado). Hallazgos arreglados:
    - **#1 RBAC transcripción** (`POST /api/telnyx/calls/:leadId/transcribe`): era admin/supervisor only, pero el front graba+sube audio para CUALQUIERA que llama (`_startCallRecording` en `state==='active'` sin gate de rol) → el setter recibía 403 tras gastar banda subiendo el audio. Ahora el setter transcribe SOLO sus leads (`lead.assignedTo === setterId`), chequeado ANTES de gastar Whisper. Admin/supervisor cualquiera. Test nuevo `tests/transcribe-rbac.test.js` (3, no requiere OPENAI_API_KEY — el owner autorizado corta en 503 por falta de key, lo que prueba que pasó el RBAC).
    - **#2 umbral unificado**: constante de módulo `COLD_CALL_CONV_MIN_S = 30` compartida por `/api/setters/cold-call-metrics` y `/api/telnyx/cold-call-effectiveness` (este último usaba `>30`, ahora `>=30`). Los 2 dashboards de funnel reportaban "conversación/opener pasado" con umbrales distintos → números no cuadraban. **La consolidación de UI total (un solo dashboard) sigue pendiente** — necesita al user en vivo (ver #87/#103).
    - **#3 bookingRate >100%**: en cold-call-metrics una llamada cuenta como conversación si `duration>=30` **O** terminó en agendamiento (agendar implica conversación, aunque el canal manual no registre `duration`). Garantiza `appointments <= conversations`.
    - **#4 webhook fail-closed**: en `NODE_ENV=production`, si falta `signaturePublicKey` el webhook responde 503 (mismo criterio que JWT_SECRET #23) en vez de aceptar POST sin firmar. Dev/test sigue aceptando. Cada evento persistido lleva `verified: true|false|"skipped"`.
    - **#5 (no-código)**: autopiloto = progressive dialer con humano presente (defendible); grabación transitoria en two-party-consent states (USA) = criterio legal del user, no bug.
    - Verificación: `node --check index.js` OK + 41/41 tests del call center verde. NO se observó en preview a propósito (lógica backend de métricas/RBAC/webhook, no visible sin Telnyx+mic+OpenAI+data real → los tests son la prueba correcta).

## Sesión 2026-07-07 — Auditoría del scraper (5 fixes, commit `7824345`)

110. **Auditoría del scraper Google Maps → 5 fixes (todo backend `index.js` + tests, sin tocar frontend → sin bump de cache-buster)**:
    - **SAFE-3 ya NO se pierden al importar**: `_importLeadsCore` armaba `baseLead` como literal explícito que tiraba `placeId/coordinates/openingHours/businessStatus/category` (el scrape los capturaba pero llegaban vacíos al lead → el chip "⚠ Cerrado" y el `_callScore -50` nunca se activaban, y el enrich re-pagaba SerpAPI para recuperar placeId/coordinates ya scrapeados). Ahora se copian.
    - **Dedup vs history normalizada**: `alreadyScraped` usaba solo `makeKey` (match EXACTO nombre+dirección) → falsos negativos con direcciones reformateadas. Ahora `_buildHistoryDedupIndex` + `_isAlreadyScraped` (makeKey + nombre/dirección normalizados + teléfono últimos 8 díg). Las entries NUEVAS del history guardan `phone` (las viejas no lo tienen → el índice por teléfono solo cubre de acá en adelante).
    - **Timeout + retry SerpAPI**: `_serpWithTimeout` (15s, mismo patrón que el enrich) + 1 retry con backoff 2s en `searchLocation`. Si falla el retry, corta conservando lo acumulado.
    - **Mutex history/batches**: `mutateHistory` y `mutateScrapeBatches` (patrón regla #19). `/api/scrape` lee un snapshot para dedup y aplica escrituras al final dentro del mutex (los awaits largos de SerpAPI entre load y save hacían que dos scrapes concurrentes se pisaran el archivo). Los demás handlers de history/batches son síncronos → atómicos, no necesitan mutex.
    - **Paralelización**: combos query×ubicación con pool de concurrencia 3 (`_runPool`) — mismo gasto de créditos (el clamp de 50 corre antes), ~3x menos espera. El dedup intra-request corre post-concat en orden determinístico (no dentro del pool).
    - Helpers expuestos en `globalThis.__phase16`: `_buildHistoryDedupIndex`, `_isAlreadyScraped`, `_runPool`. Tests: `tests/scrape-import-fields.test.js` (6). Suite completa verde salvo `mercury-review` (timeout de IA real, flaky ambiental #93, no relacionado).
    - **Brief IA verificado (pedido del user)**: los 3 botones de generación YA eran admin-only (Comando `data-roles="admin"` en `index.html:1918`; per-lead `app.js:6626` y Power Dialer `app.js:5470` con `realRole==='admin'`; backend `requireRole('admin')`). La card de visualización del brief sigue visible a todos. No se cambió nada.

111. **Auditoría enrichment + brief → 4 fixes (commit `0b187c3`, todo backend `index.js` + tests, sin cache-buster)**:
    - **enrich-leads — skip 24h por FUENTE**: el skip global por `enrichedAt` era agnóstico de la fuente → correr NPI bloqueaba el enrich web 24h (y viceversa) sin haberlo hecho. Se eliminó; la elegibilidad depende solo de los markers por-fuente (`adsCheckedAt`/`ageCheckedAt`/`metaAdsCheckedAt`/`ownerAiCheckedAt`/`npiCheckedAt`). **`force:true` ahora bypassa los markers** (antes solo bypasseaba el skip 24h → no podía re-chequear nada ya marcado; es también la vía de retry para fetches que fallaron transitorio, porque los markers se setean incluso en error — anti-loop intencional).
    - **enrich-leads — `specialty`/`npi` solo si vacíos** (NPI ya no pisa lo cargado a mano, consistente con la política del resto del bloque).
    - **validate-numbers — fallos no se re-cobran**: los lookups Telnyx fallidos no marcaban `lookupAt` → quedaban elegibles y se re-cobraban en CADA tanda de la barrida. Ahora persisten `lookupAt` + `lookupError` (retry: `onlyMissing:false` o borrar `lookupAt`).
    - **enrich-brief barrida — 2 variantes antes del skip permanente**: el bulk probaba UNA sola query (`nombre, dirección`) y si no resolvía marcaba `briefSkipped='no_place_id'` PERMANENTE → leads reales quedaban quemados aunque `nombre, ciudad` sí hubiera matcheado. Ahora prueba 2 variantes (+1 search solo en los que fallan la primera). El modo explícito (force por-lead) sigue probando las 3.
    - **Eficiencia**: `enrich-leads` y `validate-numbers` usan `_runPool` (conc 8 y 5) en vez de chunks con `Promise.all` — un lead lento ya no frena a los demás de su tanda. `enrich-brief` sigue secuencial A PROPÓSITO (rate limit SerpApi 200/h).
    - **Verificado y NO tocado (intencional)**: `metaAdsCheckedAt` se marca aunque el lead no tenga facebook (comentario explícito en el código); el loop `_autoEnrichAfterScrape` del front termina bien (markers agotan candidatos); mutex correcto en los 3 endpoints (fetch fuera, apply dentro de `mutateSettersData`); `enrich-brief` reutiliza `lead.placeId` (aprovecha el fix #110 de SAFE-3); RBAC admin en todo lo que gasta; `enrich-from-maps` (5704) es prefill read-only del modal Lead manual, sin re-pago.
    - Tests: `tests/enrich-audit.test.js` (4). Suites enrichment/number-lookup/lead-brief/security-rbac/scrape verdes (225 tests).

112. **Enrichment sin SerpApi + brief re-frameado a reactivación (commits `a0d69b0` [código, junto al sidebar del user] + `7199d91` [fix fixture], cache-buster `v=20260707f`)**. Pedido del user: sumar enriquecimiento que NO gaste SerpApi + que el brief venda la oferta real (reactivación/retención de pacientes), NO un "sistema de reservas" genérico, y **sin nombrar ninguna empresa/marca**.
    - **Prompt del brief re-frameado (`_briefSystemPrompt`, compartido reseñas+web)**: describe la SOLUCIÓN (reactivar dormidos, seguimiento de presupuestos no cerrados, no-shows, fidelización sobre la base existente) sin marca. `_BRIEF_OFFER` es el texto base. El fitScore pesa las **4 señales que eligió el user**: base grande/consolidada (muchas reseñas + años = la más fuerte), corre ads, sin agenda/seguimiento online, quejas de seguimiento. `_briefCtx` ahora incluye `runsAds`/`yearsActive`/`adPlatforms` (agregados al candidato en enrich-brief). El ejemplo del prompt ya NO dice "sistema de reservas".
    - **Brief IA desde web (`POST /api/admin/enrich-web-brief`, admin, opt-in, SIN SerpApi)**: reutiliza el fetch gratis del sitio (`enrichFromWebsite` ya devuelve `text`) + LLM (`_buildWebsiteBriefMessages`). Para leads con web propia que NO califican para el brief premium de reseñas. Persiste `lead.leadBrief` con `source:'website'` solo si no hay brief; NO pisa un brief de reseñas (más rico), y el de reseñas SÍ puede mejorar uno de web (skip tweak en enrich-brief + delete `webBriefSkipped`). Marca fallos con `webBriefSkipped`. Captura email gratis del mismo fetch. Pool conc 4. Botón "Brief IA desde web" en Comando (`cmd-web-brief-btn`).
    - **Antigüedad de dominio vía RDAP (`enrichDomainAge` en `src/enrichment.js`, gratis, sin API key)**: RDAP = WHOIS moderno (JSON/HTTPS), `rdap.org` bootstrapea al registro. Helpers puros `registrableDomain` (maneja TLDs 2-niveles com.mx/co.uk) + `parseRdapRegistration`. Enganchado al sweep de `enrich-leads` (candidato `needsAge` solo si falta antigüedad + no `domainCheckedAt`); persiste `domainCreatedAt` + rellena `yearsActive`/`foundedYear`. Reporta `domainAgesFound`.
    - **Sobre el número directo del decisor (pregunta del user)**: NO hay fuente confiable. IG/FB exponen a lo sumo el teléfono público de contacto (= recepción que ya tenemos). Lo accionable es identificar al decisor por NOMBRE (para el gatekeeper) + capturar `aiWhatsApp` de la web. Proveedores B2B (Apollo/Lusha) no cubren clínicas LATAM. No se construyó.
    - Nuevos helpers en `globalThis.__phase16`: `_buildWebsiteBriefMessages`, `_briefSystemPrompt`. En enrichment.js: `registrableDomain`, `parseRdapRegistration`, `enrichDomainAge`. Tests: `tests/web-brief-domain.test.js` (10) + `tests/enrich-audit.test.js` (fixture actualizado con `domainCheckedAt`). 95 tests verdes en las suites de enrichment/brief/scrape.
    - ⚠️ **Race con sesión paralela del user**: el commit `a0d69b0` (rediseño del sidebar del user) barrió el working tree e incluyó mi código de feature (index.js/app.js/index.html/enrichment.js/web-brief test). Mi commit quedó dangling y se re-hizo el fix del fixture en `7199d91`. Todo el código está en HEAD. Reforzada la regla [[user-commits-in-parallel]].
    - **Calidad del LLM NO verificada en vivo** (egress bloqueado en preview: usa OpenRouter free sin key real). El re-framing y el brief de web hay que probarlos con 1 lote chico en prod mirando el output (mismo caveat que #106).

## Sesión 2026-07-08 — Auditoría de métricas: TZ de negocio + atribución por caller

113. **Barrido de TODAS las métricas (solo backend `index.js` + tests — sin cache-buster)**. Dos bugs sistémicos arreglados en todos los endpoints de métricas:
    - **TZ de negocio (`BUSINESS_TZ`, env, default `America/Argentina/Buenos_Aires`)**: Railway corre en UTC → todos los cortes de "hoy" (`setHours(0,0,0,0)`, `toISOString().slice(0,10)`) marcaban la medianoche UTC = 21:00 del día anterior en AR/UY. Síntoma del user: "aparecen llamadas de ayer en hoy". Helpers a nivel módulo: `_bizOffsetMs`, `_bizStartOfDay`, `_bizDayStr`, `_bizHour`, `_bizDayOfWeek` (Intl.DateTimeFormat; expuestos en `globalThis.__metricsAudit`). Aplicado en: `cold-call-metrics`, `calls-today`, `objection-analytics` (además su 'today' era ventana MÓVIL de 24hs), `_computeFollowupsDue` (dueToday/dueYesterday), `_perfBucketsForPeriod` (límites + labels de los charts), `_perfTableRange` ('day' era ventana móvil de 24hs → ahora "hoy desde medianoche"), `cold-call-effectiveness` (today + **byHour/byDayOfWeek que salían corridos 3hs**), `script-effectiveness`, `telnyx/metrics` (today + **byDay agrupaba por fecha UTC**), reporte semanal (límites de semana + cron lunes 8am hora de negocio), campos `fecha`/`fechaContacto` de leads nuevos.
    - **Atribución por quién LLAMÓ**: `callLog[].by` guarda el user que hizo la llamada, pero TODAS las métricas por setter atribuían por `lead.assignedTo` (dueño ACTUAL) → cada redistribución/reciclaje del pool movía las llamadas históricas al nuevo dueño. Helpers `_buildUserSetterMap()` (userId→setterId desde auth.json) + `_callSetterId(entry, lead, map)` (fallback a assignedTo si no hay `by` o el user no tiene setter). Aplicado en: `cold-call-metrics`, `calls-today`, `objection-analytics.bySetter`, `team-performance` (índice `callsBySetter` en una pasada; `_perfCallFunnel` acepta `callEntries` pre-atribuidas — shows/noShows siguen siendo del dueño del lead, correcto), `telnyx/metrics.bySetter`, `cold-call-effectiveness` (setterId por call), reporte semanal perSetter, Centro de Comando `callsPerSetter`.
    - **Centro de Comando además**: las métricas de llamadas contaban SOLO leads con `conexion='sin_wsp'` — desde `include=callable` el dialer también disca leads en flujo Setteo y esas llamadas no aparecían. Ahora cuenta el callLog de TODOS los leads (`leadsEnLlamadas`/números muertos siguen siendo la cola sin_wsp).
    - **team-performance period=day**: el período anterior para el delta/alerta drop ahora es "ayer hasta esta misma hora" (antes, con day=desde-medianoche, hubiera comparado contra la franja nocturna previa a medianoche). Con `from`/`to` explícitos se mantiene la semántica de siempre. `tests/team-performance.test.js` adaptado con rangos explícitos (determinístico ante la hora del día).
    - Tests nuevos: `tests/metrics-timezone-attribution.test.js` (9). Suite completa: 712/713 verdes (falla solo `mercury-review`, flaky ambiental #93/#110).
    - **NO tocado (intencional)**: `real-costs`/CDRs usan los presets de rango de Telnyx (su "today" lo define Telnyx, no nosotros); el frontend calcula "Hoy" (view-hoy, callbacks) en la TZ del browser del user — ya correcto. Si el equipo se muda de huso, setear `BUSINESS_TZ` en Railway.

114. **Rediseño premium de Mi rendimiento (2026-07-08, frontend)**: view-myperf reestructurada llamadas-primero (Mi cartera → **Cold Call Funnel** → Embudo del período → Evolución). Funnel rediseñado con el lenguaje de los `.myp-tile` (sin emojis, acento por etapa en la rampa gris→azul→violeta→verde→ámbar, chip de conversión entre etapas `.ccm-jump`, medidor proporcional); ratios como fila `.ccm-ratios` con chips de benchmark (`.ccm-bench ok/mid/low`) en vez del cuadro de texto. Chart.js alineado a `MYP_KPI_ACCENTS` (área con degradé solo con 1 serie, puntos solo en hover, tooltip themed, grilla sutil). Controles de período unificados como segmented control (`.seg-control`/`.seg-btn` en style.css — reutilizables; los botones ya no mutan estilos inline desde JS). Toolbar con clases (`.myp-toolbar`). **Cache-buster: `v=20260708d`** (app.js + style.css + index.html). ⚠️ Gotcha del preview descubierto: si el tab del preview deja de pintar frames (screenshot cuelga, 0 rAF/s), las CSS transitions quedan congeladas en su valor inicial y `getComputedStyle` devuelve valores "imposibles" (pisan hasta inline `!important`) — no es un bug del CSS, verificar con un tab fresco.

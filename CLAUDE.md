# SCM Setting App - Instrucciones para IA

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

### Variables de entorno

> **La lista completa vive en [`.env.example`](.env.example)** — nombres y qué
> hace cada una, sin valores. `npm run lint:env` (en el CI, antes de los tests)
> **falla si el código lee una variable que no está declarada ahí**, así que esa
> lista no se puede desactualizar en silencio. Lo de abajo es solo lo que hay
> que saber de memoria.

**Sin estas, producción está rota o insegura:**
- `NODE_ENV=production` - **De ella cuelgan SIETE guards**: cookie `Secure`, webhooks de Telnyx y Retell fail-closed, el tool `/book`, el no-leak de `err.message`, el fail-fast de `JWT_SECRET` y el CORS de Socket.IO. `nixpacks.toml` NO la fuerza al arrancar a propósito (commit `756c548`). **Verificado el 2026-09-03: SÍ está seteada.** `/api/admin/health` reporta `prodGuardsActive` y el boot loguea una línea con el estado.
- `JWT_SECRET` - mínimo 16 chars. En production, **si falta o es corta el server hace `exit(1)`** (nota #23). El fallback derivado de `ADMIN_PASSWORD` existe solo en dev/test.
- `ADMIN_PASSWORD` - contraseña del admin (NO "ADMIN_INITIAL_PASSWORD")
- `ADMIN_EMAIL` - email del admin. **El default del código es `ignacio.scmdental@gmail.com`** ([index.js:343](index.js:343)) — solo aplica al sembrar el admin en un volumen vacío; en Railway está seteada.
- `ADMIN_NAME` - nombre del admin
- `API_KEY` - SerpAPI (Google Maps scraping)
- `APIFY_TOKEN` - Apify (Instagram Scraper)

**Correo — leer esto antes de tocar nada del envío:**
- `RESEND_API_KEY` - **el canal por default de TODO el correo, incluido el del prospecto**. También las invitaciones al equipo y el reporte semanal (esos van SIEMPRE por Resend).
- `PLACEHOLDER_FROM_EMAIL` - **obligatoria**: el From de los correos al prospecto (hold de calendario y correo del puente). Tiene que ser del dominio verificado en Resend (`Ignacio Ana <ignacio@vincca.co>`). Sin ella no se intenta el envío y `send-material` cae al 409-mailto — Resend rechaza su dominio compartido (`onboarding@resend.dev`) para escribirle a un tercero. (Antes de la auditoría del 03/09 se intentaba igual y el SDR recibía un 502 sin motivo.)
- `REPLY_TO_EMAIL` - casilla de Workspace donde caen las respuestas del prospecto. Si no está, la clave se **omite** del payload (Resend rechaza un `reply_to` vacío).
- `MAIL_TRANSPORT` - `resend` (default) o `gmail`. **Es la que manda.**
- `GMAIL_USER` / `GMAIL_APP_PASSWORD` / `GMAIL_FROM_NAME` - **solo se usan con `MAIL_TRANSPORT=gmail`**. El milestone v5.0 se construyó sobre Gmail Workspace y **se revirtió el 2026-08-31 (`0f4d5ce`): Railway bloquea los puertos SMTP (25/465/587) fuera del plan Pro**, así que el envío se colgaba sin conectar nunca. Gmail no se borró: queda detrás de la variable para correr local o el día que se pase a Pro.
- `REPORT_EMAILS` - destinatarios del reporte semanal (CSV). Sin ella el reporte no tiene a quién ir.

**IA — la cadena real (ojo con la factura):**
- `OPENAI_API_KEY` - **PRIMARIA de toda la IA del sistema** desde 2026-06-26 ([index.js:36-45](index.js:36)), no "solo Whisper". Si la seteás para tener transcripción, **todo** (brief IA, autoTag, FAQs, asistente, coach) pasa a `gpt-4o-mini` y a su factura. Sin ella, `/api/telnyx/calls/:leadId/transcribe` devuelve 503.
- `MERCURY_API_KEY` - Inception Labs. **Fallback legacy**, ya no es primaria (devolvía completions vacías en JSON estructurado y español).
- `QWEN_API_KEY` - OpenRouter free. Último recurso.

**Telefonía y agente de voz — env gana sobre el JSON:**
- `TELNYX_API_KEY`, `TELNYX_SIP_USERNAME`, `TELNYX_SIP_PASSWORD`, `TELNYX_SIP_CONNECTION_ID`, `TELNYX_SIGNATURE_PUBLIC_KEY` - **Recomendadas**. Si están seteadas sobrescriben el JSON y el panel admin bloquea su edición (409). Así los secrets no tocan el volumen ni los backups.
- `RETELL_API_KEY`, `RETELL_WEBHOOK_SECRET`, `RETELL_TOOL_SECRET` - mismo criterio.
- `WA_CORS_ORIGINS` - orígenes del Socket.IO del módulo WA (CSV). Solo aplica con `NODE_ENV=production`; vacía = same-origin. **Al 2026-09-03 está seteada pero NO matchea el propio origen de la app** (`https://scm-setting.up.railway.app` no recibe `Access-Control-Allow-Origin`) — inofensivo hoy porque el módulo WA está parkeado, pero si se reactiva hay que arreglarla.

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

115. **Rediseño premium de Entrenamiento IA (2026-07-08, frontend)**: view-training-ai al mismo nivel que Mi rendimiento. Tabs Biblioteca/Coach como `.seg-control` (reutilizado de #114, sin mutación de estilos inline). Cards de la biblioteca: badge de resultado por familia (`.tr-outcome win/mid/lost/flat` — verde ganada, ámbar re-llamar, rojo rechazo, gris sin contacto), chip de duración formateada (1m 35s), meta compacta. **Transcripción como conversación tipo chat** (`.tr-dialog`/`.tr-msg`/`.tr-bubble`): SDR a la derecha con tinte violeta, Cliente a la izquierda neutro, resumen IA en card destacada, chip "IA leyó el resultado como", header "Transcripción · N turnos" con botón **Copiar** (texto plano `SDR:/CLIENTE:` para pegar en notas/IA — se guarda en `body._trPlain`). Coach: card con input+botón propios (`.tr-coach-*`) y respuesta en card themed. Todo con clases CSS (bloque `.tr-*` en style.css). **Cache-buster: `v=20260708e`** (reemplaza #114). Preview: hay un lead demo "Clinica Demo Preview" con transcript inyectado en `tmp/preview-data` para ver el diseño (scratch, no toca `data/`).

## Sesión 2026-07-10 — Telnyx multi-número + privacidad SDR + anti-marca IA

116. **Telnyx: rotación de caller ID + tarifas reales** (deploy `0673295`): `pickNumberForDestination` rota round-robin entre TODOS los números activos (índice en localStorage `telnyx_rotation_idx`, por navegador). Si el admin fija routing explícito por país, ese gana y NO rota; con 1 solo número tampoco. El user compró números US 786 extra (total 6 al 2026-07-10) — todos en la conexión "SCM Cold Calling"; se cargan en Centralita → los toma la rotación solos. **Tarifas**: `_estimateTelnyxCost` ahora factura en bloques de 60s (mín 1 min, verificado contra CDRs: 1s→1min, 79s→2min) y la tabla fallback quedó alineada a la rate sheet real (UY móvil 0.27, MX 0.029/0.007, AR móvil 0.13 — la rate sheet `data/telnyx_rates.json` sigue siendo la fuente preferida y está commiteada, prod la tiene). **Contexto operativo**: Uruguay móvil ($0.17-0.27/min) fundió el saldo el 2026-07-10 → UY DESCARTADO como mercado de llamadas; los baratos son MX/CO/PE/CL (~$0.01/min). El límite diario del outbound profile se subió $5→$100. Códigos Telnyx aprendidos: **D17 = cuenta bloqueada** (p.ej. saldo negativo — NO es límite internacional, ese es D39).

117. **Reset de contraseña por admin** (deploy `0673295`): `POST /api/auth/users/:id/reset-password` (admin only, 6-200 chars, revoca sesiones del user) + botón "Clave" en la tabla de usuarios del Centro de Comando. `tests/reset-password.test.js` (5). La clave la tipea el admin en la UI — nunca pasa por archivos ni scripts.

118. **Privacidad biblioteca Entrenamiento IA** (deploy `a474501`): cada setter ve SOLO sus llamadas — `/api/training/calls` filtra y el detalle devuelve 403 en llamada ajena (atribución `c.by`→setterId, fallback `lead.assignedTo`). Admin/supervisor ven todo. La "biblioteca general del equipo" quedó explícitamente para más adelante si el user la pide. `tests/training-privacy.test.js` (8).

119. **Anti-marca en la IA** (deploy `a474501`): la IA NUNCA nombra la empresa ("SCM"/"SCM Dental") — ni al prospecto ni al setter; habla de "la oferta". Helper `_stripBrandMentions` (regex `\bSCM\b(?!-)` — no rompe URLs `scm-dental.vercel.app`) aplicado a: prompts que vienen de data (mercury_config de prod vía `_briefKnowledge`/basePrompt/system content — la data de prod TODAVÍA dice SCM pero se filtra al inyectar), outputs (`sanitizeMercuryStyle` paso 0, coach, training summary) y contextos (onboarding/training chunks). Todos los prompts hardcodeados limpiados + seed `mercury-system-prompt.md`. SCM sigue en lo interno no-IA (título de app, mails de invitación, onboarding HTML, reporte semanal) a propósito. Queda 1 FAQ en el banco de prod con la URL `scm-dental.vercel.app` (decisión del user conservarla).

120. **Números enmascarados para SDRs** (deploy `a474501`): helper `_phoneShown(p)` en app.js — si `currentUser.role==='setter'` devuelve `•••• <últimos 4>`; admin/supervisor ven completo. Aplicado en: tooltip del botón Llamar (ya no incluye número para nadie), ficha expandida de la lista, Power Dialer (número grande de la card + cola) y panel flotante de llamada. `view-call-history` no se tocó (es admin/supervisor only). El `data-phone` del rate badge conserva el número real (interno, lo usa `_pdFetchRate`).

121. **Fix causa raíz de los tests flaky históricos** (#93/#110/#113, deploy `a474501`): los tests hacían `delete process.env.{OPENAI,MERCURY,QWEN}_API_KEY` pero `index.js` corre `dotenv.config()` que RE-CARGA el `.env` local (dotenv no pisa vars definidas, pero sí repone las borradas) → los tests llamaban a la IA real y morían por timeout. Fix: setearlas a `""` (definida-vacía → dotenv no la toca → `AI_AVAILABLE=false`). Aplicado en mercury-generate, mercury-review, mutex-concurrency, transcribe-rbac y el nuevo training-privacy. mercury-review pasó de colgarse minutos a 3s. **Suite completa 726/726 en ~12s.** Patrón para tests nuevos: `process.env.X_API_KEY = ""`, NUNCA `delete`.

122. **pre-deploy.js tolera URL sin protocolo** (deploy `a474501`): si el user tipea `scm-setting.up.railway.app` a secas, se antepone `https://` (antes: ERR_INVALID_URL y el backup no corría).

123. **Cache-buster actual: `app.js v=20260710g` + `style.css v=20260710a`** (reemplaza #115). wa.js sin cambios.

124. **Guía de uso SDR reescrita al flujo actual** (deploy `6e2e899`, 2026-07-10): `_guideContent.setter` reestructurada por flujo real (Hoy → Llamadas → Power Dialer → en-llamada → disposición → Banco → Entrenamiento IA → Mi rendimiento → tips). Datos corregidos vs la versión vieja: atajos reales (C/S/B/Esc, **1-9**, N/A/P), política de reintentos vigente (1 reintento a 24h, 2do no-contacto descarta — cambió 2026-06-25, `MAX_NO_CONTACT=2` en index.js ~7751; la nota #104 sobre 6 reintentos quedó obsoleta), teléfono `•••• 1234`, No-llamar, callback compartido, rotación de caller ID, biblioteca privada. Eliminada una sección con id duplicado ('llamadas' x2). Los 3 números US están cargados en Centralita y rotando. Verificada en preview logueado como setter (login por fetch + inspección del DOM — workaround del glitch de pane 0x0, ver #114).

125. **Sesión 2026-07-10 (parte 2) — separación Llamadas vs Hoy + ficha en Hoy** (deploys `6e2e899`→`13e5b4e`, app.js `v=20260710g` + style.css `v=20260710a`). Reglas de negocio que pidió el user, todas frontend (`renderCallsList` + `_pdBuildQueue` + `_hoyRenderSection`/`loadHoyView`):
    - **Interesados y callbacks manuales NO viven en Llamadas** (ni lista ni Power Dialer). `renderCallsList` filtra `estado==='interesado'` y último outcome `callback_later`; `_pdBuildQueue` idem. Se trabajan solo desde **Hoy**. `_callsForceShow` (click desde agenda) sigue bypasseando. Llamadas = nuevos + reintentos automáticos de no-contacto (no_answer/voicemail reaparecen solos a 24h, backend `MAX_NO_CONTACT=2`).
    - **Reglas de Hoy** (aclaración para no romperlas): interesado aparece TODOS los días hasta agendar/descartar (tarea de cierre, sin fecha); callback manual aparece SOLO el día que toca (`callbackAt <= endToday` + lastOutcome `callback_later`); no_answer/voicemail NUNCA van a Hoy.
    - **Botón "Ficha" en cada card de Hoy** (`_hoyOpenFicha`): modal que reusa `_callsRenderExpandedPanel` (mismo componente que el panel expandido de la lista) → toda la info del lead. Cierra X/Esc/click-afuera. `.hoy-ficha-btn` en style.css.
    - **Callback compartido REMOVIDO de la UI** (checkbox del modal + chip de la card): los leads no se comparten entre SDRs. El backend (`callbackShared`, cola shared-due de #98) queda dormido por si vuelve; el read `#call-cb-shared?.checked` da siempre false.
    - **Fixes visuales**: chip "hace Xh" del botón Llamar pasó de ámbar traslúcido (ilegible sobre verde) a pill oscura con texto blanco; "INTERESADO — agendar con Ignacio" → "agendar reunión" (sin nombre); layout de cards de Hoy arreglado (un `</div>` faltante en el subtítulo aplastaba la card y anidaba las siguientes — bug viejo del hook Brief IA, no de esta sesión).
    - **Máscaras de teléfono** (#120) confirmadas en Hoy vía el modal de ficha (setter ve `•••• 1234`).
    - Todo verificado en preview logueado como setter real (workaround del pane 0x0: login por fetch + inspección de DOM con javascript_tool; screenshot cuelga, ver #114).

## Sesión 2026-07-11 — Scraper: auto-continuar, validación auto de números, audit completo

126. **Auto-continuar del scraper** (deploy `832612c`): checkbox "Auto-continuar" (default ON) en el form de Maps. Cada combo keyword×ciudad arranca desde su propia última página barrida (`history.lastPages` — se guardaba desde siempre pero NUNCA se usaba como input). El campo "Desde Pág" se deshabilita en modo auto (se ignora). Respuesta del scrape incluye `continuedFrom[]` (query/location/fromPage/toPage) y el front lo muestra (⏩ chips). **Fix crítico acoplado**: `searchLocation` ahora devuelve `pagesFetched` (páginas cuya respuesta LLEGÓ sin error) y `lastPages` solo avanza por esas — antes un fallo de SerpAPI a mitad de combo marcaba como barridas páginas nunca pedidas → esos leads se perdían para siempre. json.error NO cuenta como página (API key inválida no corrompe contadores). Límite del clamp 50→300 llamadas/request (`MAX_SCRAPE_CALLS`). FIFO cap 500 a `history.searches`.

127. **Validación automática de números en cada import** (deploy `832612c`): `_autoValidateImportedNumbers(leadIds)` corre en background (setTimeout 1.5s, fire-and-forget) tras CADA `_importLeadsToSetters` (scrape→SDR, CSV, batches, distribution). Anti-doble-cobro: skip por `lookupAt` + **copia gratis si otro lead ya validó los mismos dígitos** (índice digits→resultado de toda la base). Cap `AUTO_VALIDATE_MAX_PER_IMPORT=3000` (~$7.50). Skip en NODE_ENV=test y sin Telnyx apiKey. La barrida manual `validate-numbers` también deduplica por número ahora (antes 2 leads mismo teléfono = 2 cobros) — devuelve `copiedFree`. Los muertos validados salen solos de la cola (filtro `lookupAt && !phoneType` en sin-wsp, ya existía).

128. **`scrape_batches.json` ahora sobrevive redeploys** (deploy `832612c`): estaba FUERA de export-data/import-data/pre-deploy/seedVolumeFromRepo — leads ya PAGADOS con créditos SerpAPI que un container nuevo de Railway perdía (mismo bug histórico que faqs/mercury/telnyx, regla #21). Agregado a los 4 lugares. Bloques del export ahora: 13.

129. **Pool "POR SDR" muestra llamables** (deploy `832612c`): `pool-summary` devuelve `callable` por setter (`_leadIsCallableNow` — réplica del filtro sin-wsp+front: sin DNC, sin muertos validados, sin terminales/interesados/callbacks). La tabla muestra SDR · **Llamables** (verde) · Sin tocar; el total asignado quedó como tooltip. Motivo: el user veía "341 asignados" pero menos en la vista de la SDR y parecía bug — la brecha son los no-llamables (el grueso: números muertos).

130. **CI de GitHub arreglado** (deploy `832612c`): el workflow corría en main Y master (espejo del mismo commit → todo doble, mails duplicados de "Run failed") y en TZ UTC (tests con aserciones de hoy/ayer fallaban en push nocturnos AR — cerca de medianoche UTC los buckets de día difieren). Ahora: solo `main` + `TZ=America/Argentina/Buenos_Aires`. Test de hardening del clamp actualizado a 300.

131. **"Enviar a SDRs" multi-setter YA EXISTÍA** (aclarado al user): el botón post-scrape abre `pickSettersDistribution` — modal para tildar varios SDRs con cantidad por cada uno + "repartir parejo". Backend `distribution:[{setterId,count}]` reparte en orden. No se construyó nada nuevo.

132. **Audit del enrichment (verificado sano, sin cambios)**: Auto IA post-scrape usa solo fetch web + LLM (cero SerpAPI); brief de reseñas reusa placeId del scrape y respeta markers; markers por fuente OK (#111); enrich NPI/dominio/emails gratis y no pisan datos manuales. Notas menores conocidas: dos scrapes simultáneos compartirían snapshot de lastPages (admin-only, riesgo teórico); META_AD_LIBRARY_TOKEN sigue faltando en Railway para España.

133. **Cache-buster actual: `app.js v=20260710h` + `style.css v=20260710a`** (reemplaza #123). wa.js sin cambios.

## Sesión 2026-07-13 — Fix atribución "Leads trabajados" en Mi rendimiento

134. **"Leads trabajados" (embudo de `/api/setters/performance`) atribuía por dueño ACTUAL, no por quién trabajó** (solo backend `index.js` + `tests/performance.test.js` → sin cache-buster). El user reportó SDRs recién arrancadas (Roxana/Judith/Nadine) con "87 leads trabajados" pero 3 dials — imposible. Causa: `_perfAggregate` contaba "total"/embudo por `lead.lastContactAt` sobre los leads con `assignedTo === setterFilter`. Como `reassign-bulk` (index.js:7256) cambia `assignedTo` pero NO toca `lastContactAt`/callLog/interactions, una SDR nueva heredaba TODO el trabajo del setter previo. El Cold Call Funnel (dials) ya estaba bien porque el callLog se atribuye por `by` (`_callSetterId`, nota #113) — de ahí la discrepancia 3 vs 87. **Fix**: `_perfAggregate(leads, from, to, attr)` acepta `attr={setterId,userMap}`; con SDR individual, "trabajado" = existe `interactions[].setterId===target` O `callLog[].by→target` dentro del bucket (mismo criterio de atribución que el resto de métricas). El endpoint pasa `attr` + `allLeads` (no pre-filtrado por assignedTo) cuando hay `setterFilter`; el agregado de equipo mantiene el legacy por `lastContactAt`. `assignedTotal`/`assignedSinContactar` siguen por `assignedTo` (cartera actual, correcto). Verificado contra data de prod (pre-deploy 2026-07-13): las 3 SDRs nuevas dan 0 leads realmente trabajados (todo era herencia), Paula 30 / Ignacio 172 reales. Conteo de HOY: Roxana 8 llamadas/8 leads, Judith 4/4. Test de regresión en `tests/performance.test.js` ("atribución por quién trabajó"). 41/41 verde en las suites de performance/team/timezone.

135. **Cold Call Funnel en modo "Ver como" mostraba el EQUIPO como si fuera del SDR** (frontend `app.js`, 2026-07-13, cache-buster `v=20260713a`): tras el fix #134 el user seguía viendo a Judith con "46 dials / 7 días" — verificado contra data: 46 = dials del EQUIPO entero, 12 "hoy" = equipo (Roxana 8 + Judith 4). Causa: `_ccmLoad` (Cold Call Funnel de view-myperf) y el fetch de `cold-call-metrics` de `loadHoyView` NO contemplaban el modo impersonación — el backend ve cookie de admin y sin `?setter=` devuelve el agregado del equipo. `_mypLoad` ya tenía el fix (`isViewAsSetter` → setter explícito) pero los otros dos loaders no. Fix: mismo patrón en ambos. Además la barra verde del header ("N trabajados" sobre leads asignados) se re-etiquetó a "**N con historial**" (+tooltip): cuenta leads de la cartera con `lastContactAt`/interactions de CUALQUIERA (herencia incluida) — no es trabajo del SDR, es composición de cartera. Verificado en preview: con impersonación simulada, el funnel pide `&setter=setter_judith_mendez` y renderiza Dials 4 (real). **Patrón a recordar: TODO loader nuevo de métricas en views por-SDR debe pasar el setter efectivo explícito cuando `realRole==='admin' && role==='setter'`** — el backend no puede inferir la impersonación (es estado client-side).

136. **Auditoría integral de métricas + supervisor (2026-07-13, parte 2 — solo backend `index.js`, sin cache-buster)**. Barrido completo de TODOS los endpoints de métricas por atribución/scoping/TZ + verificación E2E de los 3 roles contra data de prod en preview. 4 fixes:
    - **`cold-call-metrics` y `performance` ahora honran `getEffectiveAuth`** (viewAs): brancheaban por rol REAL → aunque `apiUrl` manda `?viewAs=setter&asSetterId=` en TODAS las requests del modo "Ver como", estos 2 endpoints lo ignoraban. Ahora usan `eff.role`/`eff.setterId` (consistente con sin-wsp/stats). El fix frontend #135 (setter explícito) queda como cinturón y tiradores.
    - **`pool-setter-breakdown`: `calledLeads`/`totalDials` atribuidos por quién llamó** — contaban TODO el callLog de los leads asignados (la redistribución conserva callLog) → SDR nueva heredaba discados. Los buckets `activity`/`sinTocar` siguen por estado del LEAD a propósito (composición del pool para distribuir).
    - **`team-performance`: `lastActivity` atribuida** (callLog por `by` + interactions por setterId, all-time) — era `max(lastContactAt)` de los asignados → SDR nueva con leads heredados figuraba "activa" sin haber llamado y la alerta `never_touched` jamás disparaba. Ahora Nadine (0 llamadas) dispara `never_touched` correctamente.
    - **`_perfAggregate` generalizado a `attr.setterIds: Set`**: el agregado de equipo (admin sin setter y supervisor scoped) también se atribuye por quién trabajó (union de setters visibles) — antes el agregado seguía por `lastContactAt` (supervisor de 2 SDRs nuevas veía 148 "trabajados" cuando el real era 13).
    - **Verificado E2E en preview con data de prod**: admin por-SDR (explícito Y viaViewAs idénticos), supervisor scoped real (invite→accept→login: dropdown filtrado, agregados=13, 403 en setters ocultos/pool), alertas correctas. Endpoints auditados y SANOS (sin cambios): calls-today, objection-analytics, telnyx/metrics, cold-call-effectiveness, script-effectiveness, training/calls, weekly-report, Centro de Comando, stats (semántica cartera), followups (semántica dueño actual, correcta). TZ: cero `setHours(0,0,0,0)` fuera de `_biz*`.
    - **Estado supervisor en prod**: NO hay user supervisor real todavía (solo invite de prueba `__deploy_check__@x` sin usar, residuo de Fase 18 — inofensivo). La infra está completa: invite con checkboxes de SDRs visibles, botón editar por user, guards. Para activarlo: Centro de Comando → Invitar → rol supervisor → tildar SDRs visibles.
    - **Nadine nunca aceptó su invite** (`nadinerosatortonese@gmail.com` pendiente) — no puede loguear ni llamar; reenviarle el link si va a trabajar.

137. **Transcripciones rotas — eco del prompt + canal del cliente en silencio (2026-07-13, parte 3, cache-buster `v=20260713b`)**. El user mostró una llamada de la biblioteca de Entrenamiento IA con la conversación sin sentido: turnos del CLIENTE que decían "Llamada telefónica en español de un vendedor a una [nombre] [nombre]." y "Términos frecuentes." (el prompt de Whisper filtrado como habla, con el anonimizador reemplazando "clínica dental" por [nombre]), y TODA la conversación real amontonada en turnos del SDR. Dos defectos:
    - **Backend (`_cleanWhisperSegments`)**: el gate anti-eco-del-prompt solo actuaba si el canal colapsaba a UNA frase repetida (`uniq.size <= 1`) — cuando Whisper alucina el prompt PARTIDO en 2+ segmentos distintos, pasaba. Fix: filtro POR SEGMENTO — se descarta cualquier segmento cuyo texto normalizado (≥10 chars) sea substring de la porción INSTRUCCIONAL del prompt (todo hasta "Términos frecuentes:" inclusive). Los términos del rubro listados después (reactivación de pacientes, agenda...) NO se filtran — el cliente sí los dice. Tests: 3 casos nuevos en `tests/whisper-hallucination.test.js` (13 total).
    - **Frontend (grabación)**: el MediaRecorder del canal del lead quedaba atado al `remoteStream` de early-media; cuando el carrier lo REEMPLAZA al atender ('active'), seguía grabando el stream muerto → canal del cliente en silencio → Whisper alucinaba el prompt sobre ese silencio. Fix: el canal del lead ahora se graba vía mixer Web Audio (`MediaStreamAudioDestinationNode` estable + `_rebindLeadRecording(stream)` que re-conecta el source cuando el stream cambia). El rebind se dispara desde `_attachRemote` y desde la rama early-media. Patrón del mixer validado en preview con streams sintéticos (la grabación continúa a través del swap). **La validación definitiva es la próxima llamada real con conversación** — revisar la biblioteca después de que las SDRs llamen.
    - Las transcripciones VIEJAS rotas quedan como están (el audio no se persiste — no hay manera de re-transcribir).

138. **"Sin tocar" unificado = nunca discado (2026-07-13, parte 4, cache-buster `v=20260713c`)**: el badge del panel Equipo (`untouchedAssigned`) y el header de Mi rendimiento (`assignedSinContactar`) contaban por `!lastContactAt`, que quedó INCOHERENTE tras resets/redistribuciones — Roxana tenía 171 leads con `lastContactAt` de la era WhatsApp y CERO llamadas que figuraban como "tocados" (el badge decía 481 sin tocar cuando los nunca-discados eran 652), y la vista Distribución (callLog-based) mostraba otro número para lo mismo. Ahora los 3 lugares usan el MISMO criterio: **"sin llamar" = callLog vacío (nunca discado por NADIE)**. Labels del frontend re-escritos: "sin llamar" / "con llamadas" (+tooltips). La alerta `high_untouched` también dice "sin llamar". Verificado en preview: Equipo, header Mi rendimiento y pool-breakdown devuelven números idénticos por SDR. **Criterio a futuro: para cualquier métrica nueva de "trabajo hecho" usar callLog/interactions ATRIBUIDOS, jamás `lastContactAt`** (ese campo queda como legacy del setteo WhatsApp).

139. **"Arranca de cero al reasignar" — toda métrica de cartera por dueño actual (2026-07-13, parte 5, cache-buster `v=20260713d`)**. Pedido del user: las llamadas de un SDR ANTERIOR sobre un lead reasignado NO deben contar como trabajo del nuevo dueño — el lead entra "de cero" para él, el historial viejo queda solo como nota/contexto al abrir el lead. La parte #138 unificó "sin llamar" a "nunca discado por NADIE"; esto lo refina a **"no discado por el DUEÑO ACTUAL"**. Antes Judith figuraba con 38 "con llamadas" cuando ella solo discó 8 (los otros 30 eran de SDRs previos). Helper nuevo `_setterCalledLead(lead, sid, userMap)` = ¿hay callLog entry con `_callSetterId===sid`? Aplicado en las 4 vistas: `team-performance.untouchedAssigned`, `performance.assignedSinContactar` (por `attr.setterIds`, sirve individual y agregado), `pool-summary.bySetter[].untouched`, `pool-setter-breakdown` (sinTocar/intentados/interesados/calledLeads/totalDials todos por dueño; `setterLastOutcome` mira el último outcome PROPIO). `unassigned.untouched` del pool sigue siendo "nadie lo discó" (no hay dueño). Verificado en preview con data prod: las 4 vistas dan idéntico por SDR (Judith 702·8 con llamadas·694 sin llamar; Nadine 632·0·632). Tests: 2 asserts nuevos en performance.test.js. 764 tests.

141. **Transcripciones incompletas — grabación robusta a swaps de track + variantes del eco (2026-07-21, cache-buster `v=20260721a`)**. El user mostró transcripts de la biblioteca con turnos enteros faltantes. Verificado contra 8 transcripts CRUDOS de prod (timestamps): llamadas con el canal SDR completamente vacío, canal cliente vacío (solo la alucinación del prompt), audio que arranca a mitad de frase, y huecos de ~70s en ambos canales. Tres defectos, todos arreglados:
    - **Frontend (app.js ~7115)**: la grabación de AMBOS canales pasa ahora por UN grafo Web Audio (`_recCtx` + `_recChannels.{setter,lead}` con `MediaStreamAudioDestinationNode` estable por canal). `_syncCallRecording(call)` es el único punto de entrada (idempotente, reemplaza los 2 call sites viejos): arranca los 2 recorders JUNTOS aunque `call.localStream` todavía no exista (antes el canal SDR no se creaba nunca, y el re-run de `_startCallRecording` en 'active' reseteaba los chunks del lead → huecos) y re-bindea cada canal cuando cambia el STREAM **o el TRACK dentro del mismo stream** (`_recBindChannel` compara `track.id` — el fix #137 solo miraba el objeto stream; el `<audio>` sigue el track nuevo solo pero `MediaStreamAudioSourceNode`/`MediaRecorder` quedan clavados al muerto → canal grabado en silencio). Health timer 1s re-sincroniza entre notifications. Patrón validado en preview con streams sintéticos (swap de track dentro del mismo stream → rebind + recorder sigue).
    - **Backend (`_cleanWhisperSegments`)**: el filtro de eco del prompt ahora también atrapa VARIANTES — Whisper alucinó "Llamada telefónica ... a una clínica dental **en Colombia**" (no-substring → se filtraba como habla del cliente). Nuevo chequeo bidireccional: segmento ⊂ prompt O núcleo instruccional ⊂ segmento. Tests: 2 casos nuevos en whisper-hallucination (15).
    - **Observabilidad**: el front manda `recMeta` (binds por canal, bytes por blob, errores de MediaRecorder) con el transcribe; se persiste en `transcript.recMeta` + logs `[transcribe] setterSegs=N leadSegs=M` y warning si un canal vino con audio pero 0 segmentos. Próximo reporte de transcript roto → mirar `recMeta` en el callLog y logs de Railway en vez de adivinar.
    - **Límite conocido (no-fix)**: Whisper pierde habla corta rodeada de silencio largo (ring + hold) — el hueco 22s-90s de una llamada con hold es en parte eso; sin persistir audio no hay re-transcripción. Los transcripts viejos rotos quedan como están.

159. **Transcripciones ronda 8 — boost del canal del cliente (2026-07-25, cache-buster `v=20260725a`)**. La ronda 7 quedó VERIFICADA en prod (tanda del 24/7 a la noche: conversaciones completas de ambos lados, cero eco del prompt). Límite residual: clientes con nivel muy bajo en la grabación (lvlMax 0.03-0.13 — el SDR los escucha bien porque su parlante compensa, pero Whisper pierde turnos con señal débil). Fix: el canal lead del mixer ahora pasa por `GainNode(2.5)` → `DynamicsCompressorNode` → destination (los sources se conectan a `ch.inlet`; el setter sigue directo). El compresor evita clipping cuando el canal ya viene fuerte (validado en preview: RMS 0.035→0.125, pico fuerte 0.89 sin saturar). El medidor y el recorder quedan DESPUÉS del boost → `recMeta.{leadLvlMax,leadActivePct}` reflejan lo grabado; `recMeta.leadBoost` registra la ganancia aplicada (whitelist backend). Los SDRs se actualizan solos vía el banner de versión (#152).

158. **Transcripciones ronda 7 — SIN prompt de Whisper + lax v2 (2026-07-24 parte 2, solo backend — sin cache-buster)**. El asrDebug de #157 entregó el veredicto en la primera tanda: lo que el filtro estricto descartaba era BASURA REAL — remixes del prompt de dominio ("Términos frecuentes en español de un vendedor a una clínica dental de un vendedor a..." cr=7.91, "un vendedor a un vendedor" cr=21, canales enteros de "la clínica dental de la Ciudad de México es el centro de salud" ×17 cr=7.31) que evaden el detector de eco por substring, y el rescate lax v1 los RESUCITÓ (por eso "se rompieron todas" el 24/7). Dos fixes:
    - **`WHISPER_PROMPT = ''` — eliminado DEFINITIVAMENTE** (⚠️ no reintroducir: ya falló 2026-06-26 y 2026-07-24). En canales con poca señal Whisper regurgita el prompt en vez de transcribir el habla real. Sin prompt las alucinaciones son genéricas/raras y el habla real se transcribe. Costo (ortografía de términos del rubro) irrelevante. El pipeline anti-eco queda en el código (inerte con prompt vacío; los tests le pasan prompts explícitos).
    - **Lax v2**: el filtro de `compression_ratio` (loops de decoder) se aplica SIEMPRE, también en lax — un loop nunca es habla real, sin importar el activePct medido. El lax solo saltea nsp/alp (habla de línea pobre) y el vaciado por "parece silencio".
    - Tests: +1 caso real en whisper-hallucination (19). Suite 836/836. Los transcripts/resúmenes basura del 24/7 quedan congelados (sin audio persistido).

157. **Transcripciones ronda 6 — rescate lax por medición + asrDebug (2026-07-24, solo backend `index.js` — sin cache-buster)**. La telemetría de #154 FUNCIONÓ y localizó el quiebre: con la grabación ya sana (Teresa en v=20260723b+, niveles medidos con voz real en ambos canales, blobs completos), varios canales igual salían con 0 segmentos — p.ej. canal SDR con 46% de actividad medida y S0, canales lead con 12-21% y L0. Ya NO es captura: **o Whisper devuelve poco/nada, o `_cleanWhisperSegments` (filtro por métricas nsp/alp/cr) se come habla real de línea telefónica pobre**. Fixes:
    - **Rescate lax**: `_cleanWhisperSegments(raw, label, prompt, {lax:true})` — solo filtra eco del prompt (siempre) y colapsa loops; SIN filtros de métricas ni vaciado por "parece silencio". En `transcribe()`: si la limpieza estricta vació el canal, hay raw de Whisper, y el medidor del browser dice `activePct >= 8` (voz real confirmada client-side) → re-limpia lax. La medición es la autoridad: si hubo voz, la limpieza no tiene derecho a vaciar el canal.
    - **`transcript.asrDebug`** por canal: `{raw, kept, lax?, audioS?, rawSample?}` — rawSample (hasta 4 segmentos con texto+nsp/alp/cr) solo cuando el canal quedó vacío o hubo rescate. El próximo transcript raro se diagnostica leyendo esto (¿Whisper devolvió nada? ¿el filtro descartó qué y con qué métricas?).
    - Tests: 3 casos lax en whisper-hallucination (18). Suite 817/817.
    - **Si tras esto sigue habiendo canales vacíos con `asrDebug.raw=0` y activePct alto** → Whisper genuinamente no reconoce ese audio; siguiente palanca: silence-trimming client-side antes de subir, o subir bitrate del canal lead.

154. **Transcripciones ronda 5 — telemetría de niveles + versión por user (2026-07-23, cache-buster `v=20260723b`)**. El user mostró transcripts del 23/7 aún rotos. La data reveló que **ninguna llamada corrió el v3 de #152 todavía**: Brenda seguía SIN recMeta (tab pre-21/7, ni el pedido de recarga la alcanzó) y Judith corría la versión intermedia (v2, `leadBinds=1` = el bug conocido). También apareció el caso INVERSO (canal SDR vacío, lead ok) en llamadas con mucha espera de IVR — consistente con el límite de Whisper (habla corta entre silencio largo). Para cortar las adivinanzas:
    - **`recMeta.v`** = cache-buster del app.js que grabó la llamada → nunca más dudar qué código corrió.
    - **Medidor de nivel por canal** (AnalyserNode sobre cada dest del mixer, muestreo 1s en el health timer): `recMeta.{setter,lead}LvlMax` (RMS máx) + `{setter,lead}ActivePct` (% de muestras con señal >0.01). Distingue "se grabó silencio" (bug de captura) de "había audio y Whisper lo tiró" (ASR). Harvest ANTES de `_teardownRecordingGraph` en `_stopCallRecordingAndBuffer`.
    - **Sink mudo por track** (`new Audio()` sin DOM, muted, sobre el wrapper): workaround del quirk de Chromium donde un track remoto WebRTC entrega silencio a Web Audio si ningún media element lo consume. Cleanup en teardown (bound values ahora son `{src, sink}`).
    - **Versión visible por user**: `_checkAppVersion` manda `X-App-Version`; `attachAuth` la guarda en `onlinePresence` (preservando el último valor conocido); `/api/auth/online` devuelve `appVersion` + `appCurrent`; "Equipo online" muestra chip verde "Sistema al día" / rojo "Tab DESACTUALIZADO — pedirle que recargue" (rojo solo si está online/recent; offline no es problema). Los frontends viejos no reportan → rojo "no reporta".
    - **Operativo**: hasta que cada SDR recargue UNA vez, sigue grabando con código viejo — verificable ahora en Equipo online. El resumen IA/outcome de llamadas rotas viejas queda congelado (sin audio no hay re-transcripción).

156. **Sesión 2026-07-23 (parte 2) — teléfonos visibles + sync Llamadas/PD + email de contacto (deploys `5437d97` + `4047c11`, cache-buster `v=20260723d`)**:
    - **Los SDRs ven el teléfono COMPLETO** (revierte el enmascarado `•••• 1234` de #120): `_phoneShown` devuelve el número entero para todos los roles — pedido del user para que puedan copiarlo y mandar mensajes desde el celular. Guía de uso actualizada.
    - **Dropdown de resultado de la lista de Llamadas sincronizado con el grid del Power Dialer**: gana la opción "Me cortó" (`hung_up`) y el shortcut numérico post-cuelgue pasó de 1-8 a **1-9 con el MISMO orden que `_pdKeyOutcomes`** (1 interesado · 2 agendar · 3 no interesado · 4 me cortó · 5 no atendió · 6 buzón · 7 callback · 8 equivocado · 9 no existe).
    - **Modal "Contacto secundario" ahora también carga el EMAIL del lead** (campo nuevo en el mismo modal, accesible desde lista, Power Dialer y ficha en-llamada): PUT `/api/setters/leads/:id/alt-contact` acepta `email` → se guarda en `lead.email` (valida formato; campo omitido no toca, vacío borra; "Borrar" del alt-phone NO borra el email). Tests: `tests/alt-contact-email.test.js` (5). Suite 814/814.
    - **Botón muerto "Este sí tenía WSP → Setteo" REMOVIDO** de la ficha expandida de Llamadas (+ handler `_callsMarkHasWsp`): mandaba el lead a la vista de Setteo parkeada.
    - **El número también en la card CERRADA de Llamadas y en las filas de Hoy** (deploy `bb3151f`, cache-buster `v=20260723e`): reporte de Brenda 2026-07-24 — "no me aparece el número, ¿necesito permiso?". No era permiso ni tab viejo (corría la versión actual): la card colapsada de la lista y las filas de Hoy NUNCA mostraron el teléfono (solo PD/ficha expandida/panel en-llamada). Ahora va en el subline monospace vía `_phoneShown`.

## Sesión 2026-07-24 — CALL METRICS CORE: rediseño integral de métricas y gráficas

157. **CALL METRICS CORE — arreglo de fondo de las métricas (commits `5a0c66d`→`b5a0074`, cache-buster `v=20260724a` app.js + style.css)**. El user pedía "resolver el problema completo de una vez": el funnel de llamadas estaba implementado 4 VECES en index.js con 3 definiciones distintas de "atendida", "semana" significaba dos cosas según el endpoint, y no existía serie temporal del funnel (la gráfica de Mi rendimiento mostraba el embudo WhatsApp muerto). Decisiones del user: (a) `hung_up` CUENTA como atendida en toda la app, (b) embudo WhatsApp FUERA de Mi rendimiento, (c) tablas WSP fuera del Comando.
    - **Core canónico** (index.js ~5613, expuesto en `globalThis.__callCore`): `_ccCollectCalls` (aplana callLog pre-atribuido por `_callSetterId`), `_ccFunnelAggregate` (ÚNICA definición: connect=`COLD_CALL_CONNECT_OUTCOMES`, conversation=connect&&(dur≥30||appt), appt=`scheduled_with_admin`, deal=calendar 'ganada' por closedAt), `_ccResolveRange` (today/7d/30d/thismonth/all/custom YYYY-MM-DD inclusivo TZ negocio; aliases week→7d month→30d; 7d = 7 días completos + hoy parcial, la semántica histórica de cold-call-metrics), `_ccFunnelSeries` (buckets day/week/month). **REGLA: toda métrica de llamadas nueva DEBE derivar de estos helpers — jamás re-implementar el funnel inline.**
    - **`cold-call-metrics` extendido** (delega al core, respuesta retro-compat): `?series=1&granularity=day|week|month` → `buckets[]`; `?from/?to` custom; `?compare=1` → `previous{}`+`deltas{}`+`previousBuckets[]` (serie fantasma; para 'today' la ventana espejo es ayer-misma-hora); siempre `assigned{total,sinContactar}` (criterio #139) + `showRate{shows,noShows,pctShow}` (asistencia por dueño). `_perfCallFunnel` y `_perfTableRange` también delegan (Equipo == Mi rendimiento garantizado).
    - **Fixes de números visibles**: Comando y mail semanal contaban "atendida" con 3 outcomes a mano → canon (SUBEN al incluir hung_up/callback_later); effectiveness tenía DOS listas propias (attended≠reached) → connects canónico + `voicemailPct` aparte (breakdown conserva aliases attendedCount/reachedCount/interestedCount para compat); telnyx/metrics, effectiveness, script-effectiveness y objection-analytics pasaron de ventana móvil a rango canónico; `real-costs.byDay` agrupaba por fecha UTC del CDR → `_bizDayStr`. Mail semanal: card renombrada "Llamadas a núm. muertos" (evento por outcome, distinto del KPI del Comando por phoneStatus — intencional, documentado en código).
    - **`SCM_CHART`** (app.js ~L81, `window.SCM_CHART`): helper único de Chart.js — difiere el render hasta canvas visible + ResizeObserver por canvas (**fix definitivo del chart borroso HiDPI**: se creaban en setTimeout con el canvas mid-transición), `update()` en vez de destroy+new si la estructura no cambió, theming centralizado (fuente de la app, tooltips, colores). Los listeners de menú ya NO usan setTimeout. **Todo chart nuevo va por `SCM_CHART.render(canvasId, buildConfig)`.**
    - **Mi rendimiento rediseñada**: UN solo período para toda la vista (seg `Hoy/7d/30d/Este mes/Personalizado` + inputs date `#myp-from/#myp-to`; estado en `_mypState`); UNA fetch alimenta cartera+funnel+chart (`_ccmLoad` ya no existe, `_ccmRender(d)` recibe la data); funnel con deltas por etapa + Show rate; evolución = BARRAS del funnel (toggle 5 métricas, `MYP_METRIC_DEFS`) + línea punteada fantasma del período anterior + tooltip con el funnel del día; con "Hoy" el chart se oculta con mensaje. El selector de SDR se puebla de `window.__settersList`. `#myp-kpis` (7 tiles WSP) ya no existe.
    - **Equipo**: `callsByDay` respeta el período (day→7d, week→14d, month→30d) y suma `conversations[]`/`appointments[]` por SDR; chart = barras APILADAS por SDR + línea % atención del equipo con banda benchmark 15-25% en eje `y1` + toggle 4 métricas. Tabla/funnels/alertas sin cambios.
    - **Comando**: `#cmd-stats` sin métricas WSP (Total Leads + Interesados/Agendados por estado); bloque Llamadas con seg `#cmd-calls-period` (Hoy/7d/30d/Todo) → backend `?period=` en `/api/setters/command` (default all; los contadores "hoy" siempre son de hoy). Quedan renders muertos guardados con `if(el)` para `cmd-table-body`/`cmd-var-body` (DOM ya no existe — inofensivo).
    - **Centralita**: panel efectividad con labels canónicos ("Atendidas" = misma definición que el resto); el analytics del drawer `#tlx-analytics-drawer` carga recién al ABRIRLO (evento toggle) y el auto-refresh 30s solo corre con drawer abierto (antes fetcheaba a Telnyx con el drawer cerrado).
    - **`tests/metrics-consistency.test.js` (19 tests) — la garantía anti-regresión**: grupo A (cold-call-metrics == team-performance == command == weekly == effectiveness con el mismo fixture; totals == suma de buckets), grupo B (serie: TZ borde de día 23:30 AR, custom inclusivo, previous espejo, atribución user-borrado/reasignado, RBAC setter/supervisor scoped), grupo C (`_ccResolveRange` puro). Si una métrica se toca y diverge, esta suite FALLA. Suite completa 835/835.
    - **Verificado en preview con data de prod**: dials/connects idénticos entre Mi rendimiento == fila de Equipo == suma de buckets para los 4 SDRs activos; "Ver como SDR" == fila real; Comando 377 llamadas (Todo) → 126 (7d) == cold-call-metrics.
    - `/api/setters/performance` (embudo WSP legacy) queda vivo SIN consumidor UI (tests + posible reactivación WhatsApp).

158. **Cache-buster actual: `app.js v=20260724a` + `style.css v=20260724a`** (reemplaza #133). wa.js sin cambios.

155. **Auditoría de tarifas Telnyx + filtro de destinos rojos (2026-07-23, solo backend `index.js` — sin cache-buster)**. El user reportó "cobra 3 veces por los 3 números" — FALSO: los CDRs muestran 1 cobro por llamada y la rotación de caller ID sana. La causa real: **"surcharged origination"** — llamando con caller ID de EE.UU., Telnyx recarga los destinos europeos/andinos ([artículo](https://support.telnyx.com/en/articles/6974437-updates-to-global-conversational-rate-deck)). Con la rate sheet REAL de la cuenta (`data/telnyx_rates.json`) + CDRs facturados: **ES fijo +349 = $0.4001/min** (vs $0.023-0.043 el móvil ES), UY $0.07-0.27, EC $0.20-0.36, BO $0.21-0.36, PE fijo mayoría $0.40 (PE móvil +519 = $0.008), AR móvil $0.26. En 30 días, ES+UY = 92% del gasto ($25.57 de $27.56). Países verdes: CO/MX/CL/CR fijo/BR/US/CA/UK (~$0.01-0.03/min). Cambios:
    - **`_expensiveTariffLabel(phone)`** (index.js, junto a `_leadIsCallableNow`, expuesto en `globalThis.__phase16`): clasifica por prefijo los destinos rojos. **AR móvil (+549) NO se filtra a propósito** — no es mercado (2 leads) y medio test suite usa +549 como fixture.
    - **Cola de discado**: `GET /leads/sin-wsp` excluye tarifa roja (patrón DNC); `?expensive=1` los lista para revisión admin. `_leadIsCallableNow` también los excluye → "Llamables" del pool ya los descuenta. ~2.100 leads activos salieron de circulación (1.150 ES fijo, 507 UY, 311 EC, 141 PE fijo) — siguen en el pool intactos, reactivables borrando su prefijo de `_expensiveTariffLabel` (p.ej. si se compra caller ID español → local origination → ES fijo baja a ~$0.01). **Excepción (pedido del user, mismo día)**: los rojos que un SDR YA trabajó con interés (`_tariffRedButEngaged`: estado interesado, o último outcome `callback_later`/`answered_interested`) NO se filtran — pueden cerrar y sería tirar el trabajo hecho. Los callbacks AUTOMÁTICOS de cadencia (no_answer/voicemail) NO cuentan como engagement. El gate real es `_tariffBlocked(lead)`.
    - **Scraper**: bloquea UY/EC/BO por ubicación (400 con mensaje, TODO el país es rojo). **España se sigue scrapeando** (pedido del user): los fijos +349 se filtran resultado por resultado — NO se ofrecen para importar pero SÍ quedan en el historial (dedup, no se re-paga SerpAPI). Respuesta/batch ganan `tariffFiltered`.
    - Tests: `tests/expensive-tariff.test.js` (5). Suite 802/802.
    - **Pendiente si se quiere reactivar ES fijo**: comprar número español en Telnyx (~$1-2/mes, pide verificación de dirección UE), cargarlo en Centralita con routing `ES → ese número`, y sacar el caso ES de `_expensiveTariffLabel`.
    - **Rescate de móviles ES desde la web (mismo día)**: `extractSpanishMobileFromHtml` en `src/enrichment.js` (pura; solo señales fuertes wa.me/tel:/+34 explícito, nunca 9-dígitos sueltos; `enrichFromWebsite` la devuelve como `esMobile`) + `POST /api/admin/rescue-es-mobile` (admin, gratis, cero SerpAPI): barre los ES fijo con web real, si encuentra móvil INTERCAMBIA `lead.phone` (fijo queda en `phoneFixed`, resetea lookup, dedup contra teléfonos existentes) → el lead vuelve solo a la cola verde. Marker `esMobileCheckedAt`. Tests: `tests/rescue-es-mobile.test.js` (6).
    - **`MAX_SCRAPE_CALLS` 300→500** (pedido del user, mismo día). Test de hardening actualizado.

152. **Transcripciones ronda 4 — unión de tracks + chequeo de versión (2026-07-22 parte 9, cache-buster `v=20260722j`)**. El user mostró transcripts del 21-22/7 aún rotos post-#141. Diagnóstico con el `recMeta` de #141 contra prod (¡funcionó!): DOS causas distintas.
    - **Tabs viejos post-deploy**: TODAS las llamadas de Brenda venían SIN `recMeta` → su browser corría app.js de ANTES del fix #141 (tab abierto hace días; el cache-buster solo actúa al recargar). Fix sistémico: `GET /api/version` (público, devuelve el buster de app.js leído de index.html al boot) + chequeo en el front (cada 5 min + focus + 20s post-load) → banner fijo "Hay una versión nueva / Actualizar ahora" que recarga (nunca con llamada activa). **Los tabs YA viejos no tienen el checker → tras este deploy pedir a los SDRs UNA recarga manual; de ahí en más se autoavisa.** Test: `tests/app-version.test.js`.
    - **Canal del lead mudo AUN con código nuevo** (Judith/Teresa: `leadBinds=1` y lead=0-1 segs): el SDK cuelga el audio real en el `<audio>` element (por eso la SDR escucha bien) SIN actualizar `call.remoteStream` → el rebind de #141 no veía ningún "cambio". Fix v3: `_recBindChannel` ahora SUMA tracks al mixer (unión, dedupe por `track.id`, `createMediaStreamSource(new MediaStream([track]))`, nunca desconecta hasta colgar) y `_syncCallRecording` bindea el canal lead desde `call.remoteStream` **Y desde `audioEl.srcObject`** (lo que se está reproduciendo = ground truth). Track muerto aporta silencio, el vivo aporta el audio — no hay que adivinar. Validado en preview con streams sintéticos (track muerto RMS 0 → sumar el stream del element recupera señal).
    - El resumen IA y la sugerencia de outcome se generan del transcript guardado (no hay audio persistido) → los de llamadas rotas viejas quedan congelados con data mala; no vale regenerarlos.
    - ~~**Pendiente del user (pedido explícito, NO hacer sin avisar)**: barrida de wording "setter"→"SDR" en TODA la UI~~ → **HECHA en la sesión 2026-07-23 a pedido del user, ver #153.**

153. **Barrida "setter" → "SDR" en textos visibles (2026-07-23, commit `e28efe7`, cache-buster `v=20260723a`)**. Reemplazo SOLO en strings visibles al usuario; CERO identificadores tocados (setterId, roles RBAC `'setter'`, endpoints `/api/setters/*`, ids DOM `setter-*`, clases CSS, claves JSON, `speaker: 'setter'` en transcripts — todo intacto).
    - **app.js + index.html**: toasts/alerts/confirms (eliminar SDR, revocar invite, borrar leads/guiones), modales "Elegir SDR"/"distribuir entre SDRs", "SDRs visibles" (botón + overlay del supervisor), etiquetas de speaker en transcripts inline ('SDR'/'Lead'), pills de Revisión IA ("SDR: ✓ buena"), fallback de nombre en widget Hoy, sublabel del quick-switcher, label del form de invitación. Además el ROL crudo mostrado en tablas ahora se mapea solo en display: tabla de usuarios del Comando ([app.js:9554](public/app.js:9554)) y cards de Equipo online ([app.js:11894](public/app.js:11894)) muestran "SDR" pero el value sigue siendo `'setter'`.
    - **index.js — SOLO prompts de IA** (generan texto visible): resumen de sesión, sanitize del openMessage (x2), asistente Mercury (+ modo llamada en vivo), análisis de llamada (framework v2), `_trainingSummaryLLM`, coach, auto-disposición. Los diálogos que se le pasan al LLM ahora etiquetan `SDR:`/`CLIENTE:`. Fallback visible `'Setter'`→`'SDR'` en `/api/training/calls`.
    - ⚠️ **El marcador `SUGERENCIAS PARA EL SETTER:` NO se tocó a propósito**: es contrato de parsing (regex `sugRe` en [index.js:11364](index.js:11364) + fixtures de `tests/mercury-style.test.js` + generaciones viejas persistidas). Se strippea antes de mostrarse — invisible al user. Si algún día se renombra, cambiar prompt + regex + tests JUNTOS.
    - **Fuera de scope (decisión, no olvido)**: mensajes de error del backend ("Setter no encontrado.", "Ya existe un setter…"), email del reporte semanal ("Por setter"), título del módulo 2 del onboarding ("Tu rol como setter", consistente con su HTML que no se edita por tooling), `wa.js` ("SETTER OFFLINE", módulo parkeado) y comentarios de código. Si el user quiere, es una pasada aparte de bajo riesgo.
    - Verificado en preview logueado como admin: Llamadas, Hoy, Mi rendimiento, Equipo, Entrenamiento IA, Comando, Distribución y Equipo online sin ningún "setter" visible en el DOM. Tests 797/797.

151. **Power Dialer: guardar resultado ya NO expulsa la tarjeta (2026-07-22 parte 8, cache-buster `v=20260722i`)**: queja de las SDRs — al marcar la disposition (momento en que se guarda la nota de `#pd-call-note`) el dialer auto-avanzaba a los 600ms, y además `_pdRender` echaba al lead si quedaba descartado/con callback de cadencia. Ahora, **sin autopiloto**, tras guardar el resultado la tarjeta se queda con banner verde "✓ Resultado guardado · <outcome>" + botón "Siguiente lead →" (o tecla S) — el SDR sigue agregando notas y elige cuándo avanzar. Flags nuevos en `_pd`: `holdCurrent` (bypassa los checks de expulsión de `_pdRender` mientras está activo; se limpia en `_pdAdvance`/`_pdBack`/`_pdStart`) y `holdOutcome` (label del banner). Aplica a outcomes directos Y a los de modal (callback/no interesado/agendar) vía `_afterSaved()` en `_pdHandleDisposition`. **Con autopiloto ON se mantiene el avance automático de siempre** (ese es su propósito). Verificado E2E en preview (disposition → banner → nota extra → Siguiente). Frontend-only, sin tests nuevos.

150. **"En seguimiento" = SOLO callbacks manuales propios (2026-07-22 parte 7, cache-buster `v=20260722h`)**: criterio final del user tras #148/#149 — "En seguimiento" del pipeline NO debe contar los reintentos automáticos de no_answer/voicemail (la cadencia setea callbackAt pero es plomería interna, el lead reaparece solo en Llamadas): cuenta ÚNICAMENTE los leads donde el vendedor marcó "vuelvo a llamar" (`callback_later`). Backend: sin-wsp manda `manualCallbackByOwner` = callbackAt pendiente + último callLog entry `callback_later` + atribuida al dueño actual (`_callSetterId`). Frontend `_mypLoadPipeline`: enSeguimiento = `manualCallbackByOwner`; sinContactar = `!calledByOwner` (los llamados-sin-callback no aparecen en ninguna tile — intencional, "no es una métrica"). Números reales post-fix: Judith 4, Brenda 1, Teresa 1, Melissa 0. Tests: +1 caso en pipeline-attribution (manual vs cadencia vs heredado). 796 tests.

149. **Llamadas de users ELIMINADOS ya no se atribuyen al dueño actual (2026-07-22 parte 6, solo backend — sin cache-buster)**: tras #148 el user mostró a Melissa (0 llamadas, invitación ni aceptada) con 9 "en seguimiento" y "9 con llamadas". Causa: sus leads heredados tenían callLog del 13/7 hecho por un user luego BORRADO (`user_setter_1783871882790`, SDR eliminada) → `_callSetterId` no encontraba el `by` en el userMap y caía al fallback `lead.assignedTo` = Melissa. Fix: si la entry TIENE `by` pero el user no existe/no tiene setter, la llamada queda SIN atribuir (`''`) — el fallback a assignedTo queda solo para entries legacy SIN `by` (hoy 0 en la base). Afecta coherentemente a todo lo que usa `_callSetterId`/`_setterCalledLead` (pipeline, "con llamadas/sin llamar", team, pool, funnels). Verificado con data de prod: Melissa 9→0, resto coherente (Judith seg 21 / 79 con llamadas / 118 dials propios). Test: caso `lead_user_borrado` en pipeline-attribution (2 tests, asserts +1). 795 tests.

148. **"En seguimiento" del pipeline atribuido por dueño actual (2026-07-22 parte 5, cache-buster `v=20260722g`)**: el user reportó Judith con 55 "en seguimiento" pero ~30 conexiones — imposible. Causa: `_mypLoadPipeline` contaba como seguimiento cualquier lead de la cartera con `callLog.length > 0`, y las redistribuciones conservan el callLog de SDRs anteriores como contexto → 34 de los 55 eran herencia. Fix (criterio #139): `GET /api/setters/leads/sin-wsp` ahora incluye `calledByOwner` por lead (`_setterCalledLead` — callLog atribuido por `by`→setterId, fallback assignedTo para entries legacy) y el pipeline cuenta "En seguimiento" = `callbackAt || calledByOwner`; "Sin contactar" = el resto. Verificado con data de prod: Judith 55→21 (los 21 que ELLA llamó), coherente con sus 118 dials/43 connects propios. Resto de métricas de Mi rendimiento/Equipo ya estaban atribuidas (#113/#134/#136/#138/#139) — auditadas, sin cambios. Tests: `tests/pipeline-attribution.test.js` (2). 795 tests.

147. **Filtro por SDR en la vista Hoy (2026-07-22 parte 4, cache-buster `v=20260722f`)**: `#hoy-setter-select` en el header de Hoy (`data-roles="admin,supervisor"` — el SDR real no lo ve). Filtra las 3 fuentes: leads (`sin-wsp?setter=`), KPIs (`cold-call-metrics?setter=`) y por ende las secciones Callbacks/Interesados. Se puebla desde `window.__settersList` (fetch vía `apiUrl` → supervisor y "Ver como Supervisor" nunca ven los admin-only; admin ve todos). Selección persistida en localStorage `scm_hoy_setter_<userId>`. `loadHoyView` ahora carga settersList ANTES de armar las URLs (antes era un fetch paralelo solo para el chip de dueño). Frontend-only, backend ya soportaba `?setter=` scoped en ambos endpoints.

146. **Fix "Ver como" en Equipo + Guiones parkeado para supervisor (2026-07-22 parte 3, cache-buster `v=20260722e`)**: el user seguía viendo a Ignacio/Paula en Equipo bajo "Ver como Supervisor" — causa: `_teamLoad` (app.js ~14592) y el loader de `/api/setters/performance` (~13654) usaban `fetch` CRUDO sin `apiUrl()` → no mandaban `viewAs` y el backend respondía como admin sin filtrar (un supervisor REAL sí veía filtrado; el bug era solo de la impersonación). Fix: ambos pasan por `apiUrl()`. **Regla reforzada (ver #135): TODO fetch de una vista visible para supervisor/setter DEBE usar `apiUrl()`, nunca fetch crudo** — es la 2da vez que este patrón muerde. Además: "Guiones de llamada" parkeado para supervisor (menú `data-roles="admin"`, view `admin,setter` — el setter no tiene menú pero usa el script panel en llamada). Aclaración verificada: Melissa Medina no aparece en Equipo online porque su invitación está PENDIENTE (sin usuario creado) — no es fuga.

145. **Vista final del supervisor (2026-07-22 parte 2, cache-buster `v=20260722d`)**: refinamiento de #144 tras demo del user. Menú del supervisor: Hoy, Llamadas, Entrenamiento IA, Mi rendimiento, Banco, Entrenamiento, Guía, Guiones, **Equipo**, **Equipo online**, **Reuniones agendadas**. Ocultos: Distribución, Centro de Comando (403 backend) y **Historial de llamadas** (`data-roles="admin"` en menú+view; el endpoint `/api/telnyx/calls/recent` sigue accesible pero filtrado por visibleSet). Equipo online volvió para supervisores (salió de `SCOPED_HIDDEN_VIEWS`): `/api/auth/online` filtra por visibleSet → nunca ven al user admin (linkeado a setter_ignacio) ni a Paula. Reuniones (`/api/setters/calendar`) y biblioteca Entrenamiento IA (`/api/training/calls` + detalle) ya filtraban por visibleSet — con el set de exclusión de #144 excluyen a los admin-only para TODO supervisor. Label del dropdown quedó "Supervisor" a secas (sin "(sin restricción)"). Tests: +2 en admin-only-setters (11).

144. **Setters admin-only: `setter_ignacio` + `setter_paula_kroff` (2026-07-22, cache-buster `v=20260722c`)**: pedido explícito del user — esos dos setters los ve SOLO el admin. Const `ADMIN_ONLY_SETTER_IDS` en index.js (junto a `_visibleSetterIds`) + espejo `_ADMIN_ONLY_SETTER_IDS` en app.js (pickers de visibleSetterIds). `_visibleSetterIds()` ahora: supervisor CON lista → Set(lista menos admin-only); supervisor SIN lista → `_SUPERVISOR_EXCLUSION_SET` (pseudo-Set `{has: id => !adminOnly}` — los call sites solo usan truthiness + `.has()`, verificado). **Consecuencia intencional: TODO supervisor es scoped ahora** → los endpoints globales que hacían `if (visibleSet) return 403` (pool, Comando, balance, etc.) aplican a CUALQUIER supervisor, y el frontend oculta pool/comando/online y aterriza en Equipo para todo rol supervisor (`_isScopedSupervisor = role==='supervisor'`). El "Ver como Supervisor" genérico también excluye (attachAuth setea `_viewAsScoped` aun sin asUserId). Defensa en profundidad: invite y PATCH user filtran ids admin-only de `visibleSetterIds` al guardar. Tests: `tests/admin-only-setters.test.js` (9); `hardening`/`security-rbac` actualizados (supervisor ya NO lee `/api/setters/command`). Si se quiere sumar/sacar un setter reservado: editar las 2 consts (index.js + app.js).

143. **Asignar SDR nuevo a supervisor al invitarlo (2026-07-22, cache-buster `v=20260722b`)**: `POST /api/auth/invites` con role=setter acepta `supervisorUserIds[]` — el setterId recién creado por `ensureSetterProfile` se agrega a los `visibleSetterIds` de cada supervisor elegido. **Solo supervisores SCOPED** (lista no vacía): a un supervisor sin lista (= ve todos) se lo saltea a propósito, porque agregarle un id lo RESTRINGIRÍA a ver solo ese SDR. `DELETE /api/auth/invites/:id` (revocar) limpia el setterId huérfano de los `visibleSetterIds` si el setter se elimina. UI: bloque "Asignar este SDR a supervisor" (`#invite-assign-supervisor`) en el form de invitación del Centro de Comando — checkboxes de supervisores scoped, visible cuando el rol elegido es SDR (que es el default del form; `_syncInviteRoleBoxes` en app.js). El invite guarda `assignedSupervisorIds`. Para reasignar SDRs existentes sigue estando el botón por-supervisor en la tabla de usuarios (`_editVisibleSetters`). Tests: `tests/invite-assign-supervisor.test.js` (4).

142. **"Ver como Supervisor · X" fiel al supervisor real (2026-07-22, cache-buster `v=20260722a`)**: antes "Ver como Supervisor" era genérico — el backend leía los `visibleSetterIds` del ADMIN (vacío = ve todo), así que el admin veía Distribución/Comando/Online y todos los SDRs aunque el supervisor real estuviera scoped. Ahora el dropdown "Ver como" agrega una opción por cada user supervisor activo ("Supervisor · Nombre"); al elegirla, el frontend manda `viewAs=supervisor&asUserId=<userId>` y `attachAuth` (index.js ~406) adopta los `visibleSetterIds` de ESE user en una copia de `req.auth.user` con flag `_viewAsScoped` (que `_visibleSetterIds()` respeta) → los ~40 endpoints Phase 18 filtran EXACTO como para el supervisor real. El frontend además setea `currentUser.visibleSetterIds` en boot (sidebar oculta pool/comando/online, home aterriza en Equipo). Solo restringe, nunca eleva: aplica únicamente a admins reales; un supervisor/setter que mande `asUserId` se ignora. La opción genérica quedó como "Supervisor (sin restricción)". Los fetches que pueblan el dropdown y el boot usan URLs SIN `apiUrl()` a propósito (con viewAs activo el backend filtraría esas listas). Verificado en preview: sidebar/landing/lista de setters idénticos ítem por ítem entre impersonación y login real del supervisor. Tests: `tests/viewas-supervisor.test.js` (7). "Ver como SDR · X" ya era fiel (#135/#136), sin cambios.

140. **Revocar invitaciones pendientes (2026-07-13, cache-buster `v=20260713e`)**: no existía forma de borrar un invite NO aceptado — bloqueaba el email (no se podía re-invitar con otro rol) y ni aparecía en el panel (la tabla solo lista users que ya aceptaron). Caso real: el user invitó `fsli100@gmail.com` (Fernando Slimovich) como SDR cuando quería supervisor. Al invitar como SDR, `ensureSetterProfile` crea un setter huérfano (`setter_fernando_slimovich`). Nuevo `DELETE /api/auth/invites/:id` (admin): borra el invite pendiente + limpia el setter huérfano SOLO si no tiene user vinculado ni leads (rechaza invites ya `accepted` → 400). Frontend: sección "Invitaciones pendientes" en Centro de Comando (`#pending-invites-section`, se renderiza al final de `loadUsersPanel`) con botón Revocar por fila + `window._revokeInvite`. Verificado E2E en preview: crear SDR → bloquea re-invite → revocar → limpia setter → re-invitar como supervisor OK. Tests: `tests/revoke-invite.test.js` (4). **Ejecutado en prod tras deploy**: invite `inv_1784032774832` revocado.

## Sesión 2026-07-26 — Centro de Comando: stock real por SDR + rediseño del bloque

160. **"Para llamar / Llamó / Le quedan" por SDR — el conteo del Comando estaba mal (cache-buster `app.js v=20260726c` + `style.css v=20260726a`)**. El user reportó "la cantidad de leads no están bien de total, tienen menos" y precisó qué quería ver: *"cuántos leads tienen para llamar, cuántos llamaron y cuántos les queda, así voy stockeándolas"*. Causa raíz: el bloque de llamadas contaba la cola como `allLeads.filter(l => l.conexion === 'sin_wsp')` y armaba `_callLeadsBySetter` sobre ese subconjunto — criterio viejo por los DOS lados: incluía lo que el discado descarta (números muertos validados, DNC, tarifa roja, callbacks a futuro) y se perdía los leads que el pool dejó en flujo Setteo (el dialer los disca igual desde `include=callable`, #53). Judith figuraba con 676 cuando su cola real era 366; Paula con 637 y 290 reales.
    - **Backend** (`GET /api/setters/command`, único endpoint tocado): el loop que ya recorría `allLeads` ahora acumula stock por dueño con los helpers existentes — `_leadIsCallableNow` (la réplica documentada del filtro de `/leads/sin-wsp` + exclusiones del front, la MISMA que usa `pool-summary`) y `_setterCalledLead` (atribución por quién discó, criterio #139). Claves nuevas por SDR: `asignados`, `callable`, `leadsLlamados`, `pendientes`, `atendidas`. En `callTotals`: `callableTotal`, `unassignedTotal`, `unassignedCallable`. `leadsAsignados`/`leadsEnLlamadas` se **conservan** (los assertan onboarding y metrics-consistency).
    - **`pctConversion` de la fila ahora divide por atendidas**, igual que la card de arriba (antes dividía por `totalLlamadas` → dos definiciones de "% conversión" en la misma pantalla, contra el canon del CALL METRICS CORE #157).
    - **UI**: los KPIs se separaron en dos grupos rotulados — *Actividad · \<período\>* (respeta el seg-control) y *Estado de la base (ahora)* — porque convivían mezclados y no se sabía cuál dependía del período. Tiles con `.myp-tile` (lenguaje de Mi rendimiento) + sublínea que aclara cada denominador (la card "Atendidas" ahora muestra el % sobre llamadas, que faltaba). Tabla por SDR: **Para llamar · Llamó · Le quedan** + Atendidas, con semáforo en "le quedan" (`0` sin stock, `<50` reponer, `<150` ámbar) y fila **Sin asignar (pool)** para que la suma cierre contra el KPI. Toggle "Ocultar SDRs sin llamadas" (default ON, `localStorage` por user) con línea resumen de los ocultos.
    - **Herramientas de base de datos en un drawer cerrado** (`<details class="cmd-tools">`, patrón de `#tlx-analytics-drawer`): los 13 botones sueltos quedaron agrupados en 5 filas rotuladas (Datos / Enriquecer — gratis / Cuesta plata ($) / Barrida por país ($) / Importar y exportar). **Todos los `id` y `data-roles` intactos** — los handlers se registran por `getElementById` y el filtro de roles corre una vez sobre `[data-roles]`; verificado en preview que los 24 elementos siguen en el DOM.
    - **Verificado en preview con data de prod**: `callable` por SDR == `pool-summary.callable` (Distribución) en las 6 filas; `callableTotal == suma(SDR) + pool`; y la cola que ve Judith en Llamadas (366) == su "Para llamar" del Comando. Tests: `tests/command-metrics.test.js` (7) con fixture que ejercita cada exclusión. Suite 978/979.
    - ⚠️ **`tests/weekly-report.test.js` WR-12 se rompió a las 23:00 del 26/07 (NO fue regresión de esto) — ya arreglado en `c043a3c`**: el fixture crea las llamadas con el reloj REAL (`now - 60s`) pero el test evaluaba con relojes ABSOLUTOS (`SUN23` = dom 26/07 23:00), y `buildWeeklyReportData` hace `toTs = Math.min(nowTs, thisMonday + 7d)` → cruzado ese borde las llamadas quedan en el futuro respecto del reloj inyectado y **falla para siempre, no es flaky**. Lección de método: entre las 23:04 (falla) y las 23:21 (pasa) el user commiteó el fix en otra sesión — la conclusión apresurada de "entonces era ruido de reloj" fue un error de lectura; **con el repo compartido hay que mirar `git log` antes de atribuir un cambio de comportamiento al ambiente**.

161. **"Por llamar" unificado en las 4 vistas + Comando abre en 30 días (2026-07-26 parte 2, mismo cache-buster `v=20260726c`)**. Tras #160 el user preguntó por qué en Equipo las SDRs tenían más llamadas que en el Comando. Verificado: **no había bug entre las dos vistas** — comparadas en la misma data y el mismo período dan idéntico (llamadas Y atendidas, las 6 filas). Lo que confundía era (a) el Comando abría en "Todo" y Equipo en "mes" (Ignacio: 30 llamadas en 30 días vs 181 en total) y (b) los números que se le reportaron salían del preview local, no de su producción. Dos cambios:
    - **Default del bloque de llamadas del Comando → 30 días** (`window._cmdCallsPeriod = '30d'` + botón activo en el HTML), para hablar el mismo idioma que Equipo (`period=month` = 30 días).
    - **Un solo criterio de "por llamar"** (helper nuevo `_leadPendingForOwner(l, sid, userMap, now)` = `_leadIsCallableNow` + `!_setterCalledLead`, junto a `_leadIsCallableNow` en index.js): antes Equipo/Mi rendimiento/Distribución contaban la cartera cruda sin discar (Teresa 602) y el Comando los llamables sin abrir (276) — los 326 de brecha eran números muertos, DNC y tarifa roja que nunca se van a llamar. Aplicado en `team-performance.untouchedAssigned`, `cold-call-metrics.assigned.sinContactar`, `performance.assignedSinContactar` y `pool-summary` (`bySetter[].untouched` + `unassigned.untouched`). Labels a **"por llamar"** en los 4 lugares (badge de Equipo, header de Mi rendimiento, KPI y tabla de Distribución) con tooltip que explica qué descuenta.
    - **`assigned.llamados` nuevo en cold-call-metrics**: el header de Mi rendimiento derivaba "con llamadas propias" como `total - sinContactar`, que con el criterio nuevo incluiría los no llamables. Ahora viene explícito del backend (el front conserva el fallback por resta).
    - **Fila del pool en el Comando**: "para llamar" = `unassignedCallable` (1386) y "le quedan" = `unassignedUntouched` (1345, los que nadie discó nunca) — mismo criterio que la vista Distribución para leads sin dueño.
    - **Verificado en preview con data de prod**: las 4 vistas devuelven el MISMO número por SDR (Ignacio 1014, Judith 354, Brenda 386, Melissa 382, Paula 283, Teresa 276) y `llamados` coincide entre Comando y Mi rendimiento. ⚠️ **El preview server NO recarga index.js solo** — hay que `preview_stop` + `preview_start` o se verifica contra el código viejo (pasó en esta sesión: las 3 vistas parecían no haber cambiado).
    - Tests actualizados por cambio de contrato: `metrics-consistency` B4 (ahora `{total, sinContactar, llamados}`) y `pool-distribution` (los teléfonos del fixture eran de 5 dígitos → `_leadIsCallableNow` exige ≥7, así que ningún lead era llamable y `untouched` daba 0). **Suite completa 979/979.**

162. **Tabla del Comando: "Marcó" + "Conversaciones" (2026-07-26 parte 3, mismo cache-buster `v=20260726c`)**. Pedido del user: *"en vez de marcar llamó, marcar marcó... para saber con cuántas personas habló pero también cuántas marcó"*. La columna "Llamó" contaba leads DISTINTOS discados, no marcadas, y conversaciones no existía en esta vista.
    - **Columnas nuevas**: SDR · Para llamar · Le quedan · **Marcó** · Hoy · **Atendieron** · **Conversaciones** · Interesados · Agendados · % agend. "Marcó" = dials (con reintentos) y entre paréntesis los leads distintos marcados **dentro del período** (`leadsMarcados`, acumulado con un Set por lead para no contar dos veces los reintentos). Así se lee la intensidad de reintento: Judith 118 marcadas sobre 79 leads insiste; Ignacio 181 sobre 172 no. `leadsLlamados` (histórico) sigue en la respuesta porque es el que alimenta `pendientes`.
    - **Conversaciones con el canon**: `agg.conversaciones` usa `COLD_CALL_CONV_MIN_S` + `COLD_CALL_APPOINTMENT_OUTCOMES` — la MISMA fórmula de `_ccFunnelAggregate` (atendió Y >=30s, o agendó), no una regla nueva. Total `conversacionesHistorico` en `callTotals` y tile nuevo en el grupo Actividad (Marcadas → Atendieron → Conversaciones → Interesados → Agendados → Marcadas hoy).
    - **Test de coherencia**: `command-metrics` verifica que dials/connects/**conversations** del Comando == `/cold-call-metrics` para el mismo setter y período. Verificado además en preview con data de prod: coincide en las 6 filas.
    - ⚠️ **Los dos fallos vistos durante esta sesión fueron de OTRA sesión editando en paralelo, no de este cambio**: `weekly-report` WR-12 estaba genuinamente roto y lo arregló el user en `c043a3c` a mitad de la sesión (ver #160); `daily-report:514` (`_Sin arrancar: Dalia_`) falló una vez mientras ese archivo tenía ~89 líneas sin commitear de otra sesión en curso. Después: **987/987 en dos corridas completas seguidas.** Regla práctica reforzada [[user-commits-in-parallel]]: antes de declarar "flaky ambiental", correr `git log`/`git status` — un test que cambia de comportamiento puede ser código ajeno moviéndose bajo los pies.

163. **Reporte diario/semanal: tiempo ACTIVA + stock "por llamar" + tests sin dependencia del reloj (2026-07-26/27)**. Pedido del user sobre el reporte de WhatsApp de la Phase 21, ya con el molde D-19 en producción.
    - **Tiempo activa** (`_reportActiveMinutes`, `REPORT_ACTIVE_BUCKET_MS = 30 min`): bloques con al menos una llamada. NO es la ventana primera→última llamada (da 11h por discar a las 8 y a las 19) ni presencia del panel — **esa data no existe**: `auth.json` solo guarda `lastSeen`, un timestamp que se pisa, sin historial de sesiones. Una llamada suelta cuenta el bloque entero a propósito (alrededor hay preparación y carga del resultado); el sesgo va hacia arriba y es parejo. El user subió el bloque de 15 a 30 min el mismo día. **Cambiar la constante mueve todo el histórico: es una definición, no un dato guardado.** El equipo SUMA las vendedoras (horas-persona), no une bloques. Va en el diario, en la línea del consolidado y en el semanal corto, con `_reportDuration` (`2h15`/`45min`).
    - **Por qué importa** (visible con data real): viernes 24/07, Teresa 104 llam · 5 min hablados · **1h30 activa**; Brenda 27 llam · 14 min · **3h activa**. Sin la columna, Teresa parecía el mejor día del equipo.
    - **Stock "por llamar"** (`data.pending`, línea `_Por llamar: ...`): usa `_leadPendingForOwner` — el MISMO criterio unificado en #161 (llamable ahora + no discado por el dueño actual), no la cartera cruda. Ordenado de MENOS a más (la primera es la que hay que reponer). **Excluye a las que nunca arrancaron y a las de licencia**: ya tienen línea propia y repetirlas es ruido.
    - **Verificación**: los números del reporte se cruzaron uno por uno contra `_ccFunnelAggregate` recalculado desde cero por SDR (equipo y las 3 vendedoras: llam/at/min/activa, todos OK). Ojo con la lectura: `141 llam` son **marcadas**, no personas — ese día fueron 141 marcadas sobre 136 leads distintos (misma semántica que la columna "Marcó" de #162).
    - **Tres tests dejaron de depender de cuándo corre la suite** (la misma clase de bug, tres veces): `weekly-report` WR-12 pedía "la semana anterior" con `now - 7d`, pero `buildWeeklyReportData` **capa la ventana en el reloj que recibe** → un lunes a la madrugada devuelve una "semana" de minutos; ahora usa `FIXTURE_PREV_WEEK_END` (domingo 23:59). El fixture del mismo archivo ponía las llamadas en `now - 60s`, que cae en la semana anterior durante el primer minuto del lunes → `FIXTURE_THIS_WEEK` con piso en el lunes. Y `followups:153` anclaba "vencido AYER" con `ago(49*HOUR)`, pero ese es un bucket de CALENDARIO: antes de la 1am el vencimiento cae en anteayer y el test se ponía rojo ~1 hora por día — **el flaky de medianoche de la nota #93, que no era ambiental sino un fixture mal anclado**. Ahora se ancla al mediodía de ayer. Los tests de "activa" derivan el tamaño del bloque del propio helper, así el próximo cambio de criterio no los rompe. **Suite 990/990 corriendo a las 00:20 de un lunes**, la hora que antes la ponía roja.

163. **Leads sin teléfono fuera de la cola + por qué "para llamar − marcó ≠ le quedan" (2026-07-26 parte 4, `v=20260726c`)**. El user vio que Judith marcó 94 leads pero su "le quedan" solo bajó 15 (432→417) y sospechó de los números. No había error de conteo: **trabajar un lead lo SACA de la cola** (queda interesado → va a Hoy, con callback, descartado o agotado), así que la mayoría de los marcados ya no está en "para llamar". La identidad que sí cierra es **`para llamar = le quedan + los que ya tocó y siguen en cola`** — verificado en las 6 SDRs con data de prod (Judith 366 = 354 + 12; Teresa 288 = 276 + 12). Tooltip de "Le quedan" reescrito para decirlo explícito. Comando y Equipo, comparados en el mismo período, ya daban idéntico (Judith 143 dials en los dos, Teresa 165, conversaciones 37 y 25).
    - **Bug real encontrado al verificar**: `GET /leads/sin-wsp` chequeaba teléfono ≥7 dígitos SOLO en la rama `include=callable`; los `conexion==='sin_wsp'` pasaban sin número. Resultado: leads sin teléfono ocupando lugar en la cola de la SDR (4 en Brenda, todos de España) que ella veía y no podía discar, mientras el Comando ya los descontaba (su cola decía 404, el panel 400). Ahora el chequeo es común a las dos ramas. **No se borran**: si el enriquecimiento les completa el número, vuelven solos. Post-fix las 6 colas coinciden exacto con "Para llamar" del Comando.
    - ⚠️ **Fixtures con teléfonos placeholder**: `recycle-pool` (`+521`, 3 díg) y `pool-distribution` (`+5491`, 5 díg) rompieron por esto. Cualquier test que espere ver leads en la cola necesita teléfonos de **≥7 dígitos**.
    - Tests: 2 casos nuevos en `command-metrics` (9). **Suite completa 991/991.**

## Sesión 2026-07-31 — Audio ENTRANTE: boost del cliente + medición de la línea

164. **El cliente se escuchaba muy bajo: no había NINGÚN tratamiento del audio entrante** (`v=20260731a`, app.js + index.html + whitelist en index.js). Todo el trabajo previo de audio (#104 panel de mic, #159 boost 2.5× del canal lead) era del lado SALIENTE o de la GRABACIÓN para Whisper. Lo que el SDR ESCUCHA iba crudo al `<audio>`, cuyo `volume` tope es `1.0` — **no amplifica**. Con la línea llegando a RMS 0.03-0.13 (medido en prod vía `recMeta`), el SDR escuchaba bajo y subía el parlante del sistema, lo que sube el ruido junto con la voz.
    - **Pipeline nuevo (`_remoteAudio` en app.js, junto a `_audioCfg`)**: track → highpass 170Hz (zumbido/rumble de línea) → peaking 2.6kHz +4dB (banda de inteligibilidad) → gain 1-6× (slider) → compresor → limitador → `<audio id="telnyx-remote-audio-out">`. El elemento original **nunca cambia de stream**: conserva el crudo (es el ground truth de `_syncCallRecording` y el consumidor que Chromium necesita para entregar un track remoto a Web Audio) y queda MUTEADO. **Cualquier error → `_fallbackToRaw()` desmutea el original**: nunca puede quedar el SDR sin escuchar.
    - **Los parámetros del compresor se MIDIERON, no se eligieron a ojo** (browser, señal de pico 0.05 = el nivel real de la línea): con `-24/ratio 6` la curva se aplastaba (3×→0.357, 6×→0.422 — mover el slider no se oía); con **`-12/ratio 3` la respuesta es proporcional** (1×→0.093, 2.5×→0.232, 4×→0.371). El **limitador `-2/ratio 20` es imprescindible**: sin él, un cliente que habla fuerte (pico 0.35) con el slider al máximo daba **1.073 = clipping**, o sea distorsión — exactamente el "sucio" que se venía a arreglar. Con limitador ese peor caso queda en 0.937.
    - **UI**: slider "Volumen del cliente" (1-6×, default 2.5×) + checkbox "Limpiar audio" en el panel de llamada, aplicables **EN VIVO** (`setTargetAtTime` para no hacer "click"), persistidos por navegador (`scm_audio_leadGain` / `scm_audio_leadClean`). `attach()` es idempotente y por TRACK (mismo patrón que el mixer de grabación) para sobrevivir al swap de track del carrier; tiene guard para no sonar durante el ringing (pisaría el tono sintético — bug histórico #141).
    - ⚠️ **El boost NO arregla el sonido "robótico"**: eso es red o codec, no nivel. Amplificar audio roto lo hace más fuerte, no mejor.

165. **Calidad de línea medida (`getStats`) — antes se diagnosticaba a ojo**: no había **un solo `RTCPeerConnection.getStats()`** en el proyecto, así que "se escucha robótico" nunca se pudo atribuir a nada. `_startLineStats(call)` lee el `inbound-rtp` de audio cada 2s y calcula sobre el delta: pérdida de paquetes, jitter, **concealment** (muestras que el decoder tuvo que inventar = la causa DIRECTA del sonido robótico) y el codec real. Chip "Línea buena/regular/mala" en el header del panel, con el detalle en el tooltip. `_findPeerConnection` prueba varias rutas del SDK (`call.peer.instance`, `call.peer.peer`, …) y si no encuentra ninguna, simplemente no hay métricas (fail-safe).
    - Las peores ventanas viajan en `recMeta` (`netCodec`, `netLossPct`, `netJitterMs`, `netConcealPct`, `netSamples`, `leadPlaybackGain`) y quedan persistidas con el transcript → **ante un transcript malo se puede separar "Whisper falló" de "la línea vino rota" sin depender del recuerdo de quien llamó**. Whitelist ampliada en `index.js` (~18081).
    - **Cómo leerlo cuando haya llamadas reales**: pérdida >5% o concealment >10% = problema de RED (wifi del SDR, o el carrier). Codec `PCMU/PCMA 8kHz` = banda angosta, techo de calidad del lado del carrier (ahí la palanca es Telnyx/el destino, no el browser). Jitter alto con pérdida baja = probar `jitterBufferTarget` en el receiver.
    - **PENDIENTE de verificación en vivo** (no se puede simular una llamada PSTN): que el chip aparezca de verdad (depende de que el SDK exponga el peer connection) y que el boost se oiga bien en una llamada real. Lo verificado acá es la cadena DSP con señales sintéticas + el cableado en el DOM.

166. **Diagnóstico con datos de 3 llamadas reales: el problema era el audio SALIENTE, no el entrante** (`v=20260731b`). Tras deployar #164/#165 el user reportó 1 llamada bien, 1 mala en ambas direcciones y 1 donde no se entendía al cliente. Se bajaron las métricas de prod (`recMeta` del callLog) + los transcripts, y el instrumento funcionó a la primera:
    - **La red quedó DESCARTADA con datos**: las 3 llamadas con `netCodec=opus 48kHz`, **0% de pérdida**, jitter 1-6ms, reconstruido 1.1-5.6%. No es Telnyx, no es el codec, no es la conexión. (Confirma además que `_findPeerConnection` encuentra el peer connection del SDK: el chip aparece.)
    - **Los CLIENTES dicen textualmente que no lo escuchan a ÉL**: "Ay, casi no se me escucha, así como que está muy lejos del micrófono" y "No te puedo escuchar de nada, ¿me puedes volver a llamar?". El problema es el canal saliente.
    - **`setterLvlMax` correlaciona**: 0.368 (pico máximo de TODA la llamada) justo en la que el cliente se quejó, contra 0.855 en la que salió bien. Y una SDR con **1.146 = saturando**. El nivel del mic es el sospechoso, no la línea.
    - ⚠️ **Hipótesis descartada por el user**: leí en el transcript del canal SDR frases que parecían respuestas de la recepcionista y concluí "está con parlantes, hay leak acústico". El user confirmó que usa auriculares. Releído, se explica igual de bien por el SDR repitiendo para confirmar ("¿a las 2 de la tarde?") + Whisper completando huecos. **Lección: el canal del mic NO es prueba de leak — un SDR repite lo que le dicen.** Sospecha vigente: que el browser capture el mic de la laptop en vez del de los auriculares (el bug histórico que originó el panel de Audio).
    - **Medidor "Tu voz" EN VIVO en el panel de llamada** (`_startMicMonitor`): lee el analyser del canal `setter` del mixer de grabación = exactamente la señal que se envía al cliente (`call.localStream`), no una captura aparte. Barra + veredicto (Sin voz/Baja/Bien/Saturando) + 3 avisos por prioridad, re-evaluados en CADA tick: retorno del cliente por el mic > saturación > voz baja sostenida (~5s) > neutral. **Bug atrapado en la verificación**: en la primera versión el aviso quedaba pegado ("sale BAJA" con la voz ya corregida) y sobrevivía al colgar — por eso la decisión es un solo `if/else` por tick y `_stopMicMonitor` resetea el hint.
    - **Nombre del micrófono en uso** (`telnyx-mic-device`): label del track activo de `localStream`. Responde de una "tengo auriculares pero ¿qué está capturando el browser?".
    - `window.__audioDebug` (`startMic`/`stopMic`/`injectChannels`/`micState`/`channels`) para diagnosticar en vivo sin llamada real.
    - ⚠️ **Gotcha de verificación en preview**: con el pane oculto Chrome throttlea `setInterval` de 200ms a ~600ms, así que los avisos por acumulación (25 ticks = 5s reales) tardan ~15s en el test. Parecía "el aviso no dispara" y era el throttling — verificar con esperas largas y lecturas en llamadas separadas (el tool corta a los 30s), no bajar los umbrales.

167. **Nivelador del MICRÓFONO activo por defecto — el boost saliente existía pero estaba apagado** (`v=20260731c`). Cuarta llamada del user: cliente atendió, no le entendía nada. Los datos volvieron a señalar lo mismo (`recMeta`): red perfecta (opus, 0% pérdida, 1% reconstruido) y **`setterLvlMax=0.188`** — su voz saliendo bajísima por tercera vez (0.368, 0.188). El transcript del cliente además decía "¿Alguien me puede abrir?" ×3: esa persona ni estaba atendiendo la llamada, hablaba con otro.
    - **Causa del nivel bajo**: el boost saliente (`gainLive`) existía desde 2026-06-26 pero era **opt-in, default OFF y escondido en un modal** — nadie lo activó nunca. Un gain pelado tampoco servía para todos: una SDR mide **1.146 = saturando**, y subirle ganancia la empeoraría.
    - **Fix**: la captura del mic ahora pasa SIEMPRE (salvo opt-out) por highpass 100Hz → gain (1-4×, default 2) → compresor -12/ratio 3 → limitador -2/ratio 20, y ese stream se pasa como `localStream` del call. **Un compresor es justamente lo que sirve para los dos extremos**: levanta lo bajo y contiene lo alto. Verificado con los 3 niveles REALES de producción: 0.188→**0.614**, 0.855→0.925, 1.146→**0.931** (ninguno satura). El echo cancellation NO se pierde: se aplica en `getUserMedia`, aguas arriba del grafo.
    - **Ganancia ajustable EN VIVO** desde el panel de llamada (`telnyx-mic-gain`, el GainNode es nuestro) + toggle "Nivelador de voz" en el panel Audio (`scm_audio_micChain`, ON salvo que guarden '0'). El viejo boost `gainLive` quedó como legacy — si ambos están activos, la cadena nueva gana (se arma primero y `gainLive` ya no se evalúa).
    - **`micGain` + `micLabel` (mic REALMENTE capturado) ahora viajan en `recMeta`** (whitelist en index.js). Sin esto había que pedirle al SDR que mirara la pantalla para saber con qué config salió cada llamada. `_micChain.micLabel` se captura del track ANTES de procesar, porque el track procesado tiene label vacío.
    - ⚠️ **Sospecha aún NO confirmada**: que el browser esté capturando el mic de la laptop y no el de los auriculares. `micLabel` en la próxima llamada lo responde.

168. **CAUSA RAÍZ del "no se te escucha": el browser capturaba el mic INTERNO de la laptop** (`v=20260731d`). El user mandó captura del panel nuevo: `Mic: Varios micrófonos (Intel® Smart Sound Technology for Digital Microphones)` = el array integrado de la laptop, mientras él hablaba a auriculares externos. Confirmada la sospecha de #166/#167 y explicados los 3 datos de nivel bajo (0.368, 0.188): le hablaba a los auriculares y lo captaba el micrófono de la pantalla, a medio metro.
    - **Por qué**: `_audioCfg.constraints()` solo manda `deviceId` si el SDR eligió mic en el panel Audio. Sin elección → `getUserMedia` toma el **default de Windows** = el array interno. El panel existe desde 2026-06-26 pero nadie lo abrió nunca. **El fix de fondo NO es más ganancia: es capturar el micrófono correcto.**
    - **`_isBuiltInMic(label)`**: heurística (smart sound, varios micrófonos, array, realtek, internal, integrado, built-in, macbook, laptop…). Verificada contra 9 labels reales, incluido el textual del user; no marca headsets USB/Bluetooth/Jabra/Yeti.
    - **`_swapMicLive(deviceId)`**: cambia el mic **SIN cortar la llamada** — captura el nuevo, lo pasa por `_buildMicChain` y hace `sender.replaceTrack()` sobre el peer connection (reusa `_findPeerConnection` de #165). Suma el stream nuevo al mixer de grabación (`_recBindChannel('setter')`) y libera la cadena vieja. **La preferencia se guarda SIEMPRE primero**, así que aunque el swap en caliente falle, la próxima llamada ya sale con el mic correcto. Si falla, el track anterior queda intacto: la llamada nunca se queda muda.
    - **Aviso en el panel** (`telnyx-mic-swap`): aparece solo si el mic en uso es integrado Y hay alternativas, con `<select>` de los mics no-integrados. Cero ruido para quien ya tiene el mic bien.
    - `_buildMicChain(rawStream, gain)` factorizado (lo usan el inicio de llamada y el swap).
    - ⚠️ **Sin verificar en vivo** (el preview no tiene micrófono ni llamada WebRTC real): el camino feliz de `_swapMicLive` (captura + `replaceTrack`) y el poblado del `<select>`. Verificado: la heurística contra los 9 labels, la cadena DSP con los niveles reales, y que la preferencia se persiste antes de intentar el swap.

169. **El mic elegido en el panel Audio no se respetaba: los `deviceId` CADUCAN** (`v=20260731e`). Feedback del user sobre #168: "¿para qué me hacés elegir de nuevo si ya lo elegí en el otro lado?". Tenía razón y detrás había un bug real: eligió su HyperX en el panel Audio y la llamada igual salió con el mic interno.
    - **Causa**: `enumerateDevices()` devuelve `deviceId` que **cambian entre sesiones/permisos**, y `constraints()` los pedía como `{ideal}` — si el id guardado ya no existe, el browser cae al default de Windows **en silencio, sin error**. O sea la elección se perdía sola y nadie se enteraba. (El `{ideal}` es correcto y se mantiene: con `exact` la llamada fallaría si el mic se desconecta.)
    - **`_resolveMicId()`**: corre ANTES de capturar en cada llamada. Si el id guardado sigue en la lista, se usa; si caducó, **recupera el dispositivo por NOMBRE** y re-guarda el id nuevo. Compara también sin el prefijo de puerto USB (`(7- HyperX…)` vs `(4- HyperX…)`, que cambia al reconectar). Si el mic no está conectado, NO cae al interno a propósito: loguea y deja que el sistema decida. Verificado con `enumerateDevices` mockeado en los 5 casos (id vigente / id caducado mismo nombre / otro puerto USB / desconectado / sin elección).
    - **El aviso de mic interno ahora NO aparece si el SDR ya eligió** (`micId || micLabel`), y se compactó a una línea + select. Con `_resolveMicId` su elección se respeta sola; el aviso queda solo para quien nunca configuró nada.
    - ✅ **`_swapMicLive` VERIFICADO EN VIVO** (lo que quedaba pendiente en #168): captura de `getUserMedia` + `sender.replaceTrack()` funcionaron en una llamada real del user — "Listo: ahora usás Micrófono (7- HyperX SoloCast)".

170. **El audio malo NO era del admin: era de TODO el equipo — panel "Calidad de audio del equipo"** (`v=20260731f`). El user preguntó si el trabajo de audio servía a sus vendedoras o estaba sesgado a su caso. Se midió `transcript.recMeta` de 14 días por SDR y el dato fue contundente: **Melissa 0.198 · Judith 0.219 · Teresa 0.225 · Brenda 0.380 (con picos de 1.146) · Ignacio 0.470**, cuando lo sano pica 0.5-0.9. **Las 3 con más volumen venían hablando bajo hacía 2 semanas** (100%, 92% y 80% de sus llamadas) y nadie podía saberlo: el único síntoma es que el cliente escucha mal y corta. Es pérdida de reuniones, no un detalle técnico.
    - Todo lo de #164-#169 ya aplicaba al equipo (defaults por navegador, nivelador ON por defecto diseñado para los DOS extremos, `_resolveMicId`), pero faltaba lo que el dueño necesita: **visibilidad sin depender de que cada vendedora reporte**.
    - **`GET /api/telnyx/audio-health?days=`** (admin/supervisor, `days` 1-90 clamp, respeta `visibleSet` de Phase 18) + helper puro `_audioHealthBySetter` en `globalThis.__audioHealth`. Atribuye por **quién llamó** (`_callSetterId`, criterio #113), no por dueño del lead. Devuelve por SDR: promedio/min/max del pico de voz, % de llamadas bajas, % saturadas, nivel del cliente, pérdida de red, **micrófono más usado** y versión de app.
    - **Veredicto por PATRÓN, no por promedio suelto**: `clipping` si >20% de llamadas saturan; `low` si el promedio < 0.35 **o si más de la mitad de las llamadas salen bajas**. Esa segunda condición salió de la verificación con data real: Brenda tenía 59% de llamadas bajas y promedio 0.38 (zafaba por poco) → decía "Bien" y era mentira.
    - **UI**: tabla en el Centro de Comando con semáforo, selector 7/14/30 días, el micrófono marcado en ámbar si es el interno de la computadora (`_isBuiltInMic`) y una nota que nombra a quién revisar. Verificada en preview con data de producción.
    - Tests: `tests/audio-health.test.js` (6) — umbrales, ventana de días, clamp, RBAC (setter 403), atribución por quién llamó, y el caso "promedio zafa pero la mayoría salen bajas".
    - **Operativo pendiente**: las vendedoras tienen que **recargar una vez** para tomar el nivelador (ninguna corría la versión nueva al momento de medir; el banner de versión de #152 se los avisa). Con `micLabel` ahora persistido, en unos días se verá en la tabla qué micrófono usa cada una.

## Sesión 2026-07-31 (parte 2) — Auditoría del post-llamada: tope de cortes, muertos revividos, transcripts del dueño

171. **Auditoría de la interacción post-llamada** (pedido del user: "aparecen leads que ya marqué 4 veces"). Tres hallazgos SEPARADOS, verificados con data de prod antes de tocar nada:
    - **(a) `hung_up` no tenía tope — el bug que vio**. "Me cortó" no entra en `_NO_CONTACT` (correcto: atendieron) pero además **rompía la racha** de no-contacto, así que el lead volvía a la cola para siempre. Caso real de su pantalla: `DR CARLOS HIDALGO` con `no_answer > hung_up ×4`, estado `sin_contactar`. Medición: 6 leads con 3+ intentos, 5 con 2+ cortes, 1 con el patrón alternado que nunca autodescarta. **Fix**: `MAX_HUNG_UP = 2` (criterio del user) en `_applyCallOutcome`, contando el **TOTAL** de cortes del callLog, no la racha — con racha, alternar corte/no-atiende lo dejaba eterno igual (que es el bug de fondo). Setea `autoDiscardReason='cortes_2x'`. Tests: `tests/hangup-cap.test.js` (5).
    - **(b) 33 números muertos revividos por el reciclaje — NO era el flujo**. Marcar equivocado/no existe descarta bien. Lo que pasó: el reciclaje masivo de junio (#86) reseteó a `sin_contactar` conservando el callLog, y 33 leads cuyo ÚLTIMO outcome era `wrong_number`/`invalid_number` volvieron a la cola (todos con `recontactPriority`, ninguno re-llamado después). **Ejecutado en prod** con `scripts/one-shot-dead-numbers-2026-07-31.mjs` (simula por defecto, `--apply` para ejecutar; backup del setters.json + listado antes de tocar). Reusa el endpoint `/api/setters/leads/bulk` (`mark_wrong`/`mark_invalid`) → cero código nuevo en el server. Verificado: 33 → 0.
    - **(c) Las transcripciones del dueño estaban ocultas A PROPÓSITO**. `TRAINING_EXCLUDED_SETTERS = Set(['setter_ignacio'])` con el comentario "las llamadas de Ignacio (dueño, pruebas) se ocultan". Ahora cold-callea en serio y quiere revisarse. **Fix**: la exclusión se volvió DIRECCIONAL vía `_trainingExcludedFor(role)` — vacía para admin/supervisor, activa para las SDRs. Usa el rol EFECTIVO, así que con "Ver como SDR" el admin ve lo que ve ella. Tests: `tests/training-owner-visibility.test.js` (3).
    - **Aprendizaje de arquitectura (verificado escribiendo los tests)**: `GET /leads/sin-wsp` devuelve TODO lo que tiene `conexion='sin_wsp'` **sin mirar el estado** — quien esconde los descartados es el FRONTEND (`renderCallsList` app.js:6903 y `_pdBuildQueue` app.js:5430). Por eso un test de "salió de la cola" debe assertar el ESTADO, no la respuesta del endpoint. Y `callbackAt` solo se aplica en el outcome `callback_later` (index.js:10501): no se puede colgar un callback de un corte.
    - `wa-campaign-engine` falló 4 tests durante esta sesión: **verificado con `git stash` que falla igual en main limpio** (flaky por hora del día, notas #93/#110/#113 — eran las 20:20, fuera de la ventana horaria de campañas). No es regresión.

172. **El tope de cortes no era retroactivo + el Power Dialer no refrescaba** (`v=20260731g`). Apenas se deployó #171, el user reportó: "aprieto el power dialer y me lleva de vuelta al Carlos Hidalgo, que ya lo pasé 500 veces… no está sincronizado una cosa con la otra". Dos causas distintas, las dos reales:
    - **(a) Gap de #171**: `MAX_HUNG_UP` en `_applyCallOutcome` solo actúa al marcar un corte NUEVO. Los leads que ya venían pasados seguían activos (`DR CARLOS HIDALGO`: 4 cortes, `sin_contactar`, con un callback vencido de junio arrastrado). Eran 5. Mismo error de razonamiento que con los 33 muertos: arreglar la regla hacia adelante y olvidar los datos existentes. **Fix**: `POST /api/admin/backfill-hangup-cap` (admin, `dryRun`, `maxHungUp` configurable, idempotente, dentro de `mutateSettersData`). NO toca el callLog ni `interes` — cortar no es "no interesado" — y limpia el `callbackAt` vencido.
    - **(b) `_pdStart` armaba la cola con `callsLeadsCache`**, el snapshot cargado al abrir Llamadas, sin volver a preguntarle al servidor. Cualquier cambio de estado hecho después (descarte automático, callback, otro SDR) no se veía hasta recargar la vista. Ahora `_pdStart` es async y hace `await loadCallsView()` antes de `_pdBuildQueue()`; si el refresh falla se sigue con el cache (mejor discar con datos viejos que no discar). El único call site es un listener fire-and-forget, así que no hubo que tocar nada más.
    - Tests: caso de backfill en `tests/hangup-cap.test.js` (6) — dryRun no escribe, respeta el lead de 1 solo corte, no toca historial ni `interes`, e idempotencia.

173. **Filtro de SDR persistido + banner de pendientes con nombre** (`v=20260731h`). El user reportó dos cosas tras el deploy anterior, sospechando que se habían tocado cosas de más. Verificado: **ninguna de las dos venía de los cambios de esa sesión** — las dos eran preexistentes.
    - **(a) "Puedo ver todo lo de los otros SDR, no puedo ver lo mío"** — REAL. El filtro `calls-setter-select` NO se persistía (país y orden sí, desde siempre). Cada recarga volvía a "Todos" y el admin —que además tiene cartera propia de 1384 leads— veía todo el equipo mezclado. Se hizo evidente ahora porque los deploys de la sesión lo obligaron a recargar muchas veces. **Fix**: se guarda en `calls_setter_filter_<userId>`. ⚠️ **Sutileza que casi se escapa**: `loadCallsView` arma la URL del fetch ANTES de poblar el select, así que aplicar la preferencia solo al select dejaba el filtro bien en pantalla pero **pidiendo TODOS los leads**. La preferencia se lee directo del localStorage para armar la URL (flag `dataset.prefApplied` para que solo mande en la primera carga). Verificado en preview: tras recargar, la URL pedida es `?setter=setter_ignacio&include=callable`. Si el setter guardado ya no existe, cae a "Todos" en vez de filtrar por un id fantasma.
    - **(b) El cartel "Tenés 1 llamada sin marcar" estaba BIEN — me equivoqué al diagnosticar**. Primero se leyó un `pending_calls.json` truncado (los 3 primeros eran de Teresa y Judith) y se concluyó que el banner contaba pendientes ajenos; se llegó a agregar un `?mine=1` al endpoint. Al mirar la lista COMPLETA: 4 pendientes, y **1 es del admin** ("Ortodoncia Santiago Herrera", 37s, ese mismo día). `_dispoLoadPendingStrip` ya filtraba por `p.setterId !== mySetter`. El `?mine=1` se revirtió. **Lección: leer la lista completa antes de concluir, no los primeros N caracteres de un JSON.**
    - Lo que sí se mejoró del banner: con UNA sola pendiente ahora dice a quién y cuándo ("Te quedó sin marcar la llamada a X (20:11 · 0:37)") en vez de un conteo anónimo que obligaba a expandir para saber de qué hablaba.

174. **Franja de pendientes REMOVIDA + causa raíz: pendientes huérfanos por un race** (`v=20260731i`). El user pidió sacar el cartel marrón ("sacalo, no quiero que esté eso que te diga que tenés que marcar, porque está mal"). Al verificar por qué le molestaba apareció un **bug real**: la llamada que el cartel le reclamaba (Ortodoncia Santiago Herrera, 37s) **ya estaba marcada** — el lead tenía la entry `no_answer` en el callLog y hasta estaba descartado. El cartel le pedía resolver algo ya resuelto.
    - **Causa (race)**: al colgar, `_onTelnyxCallEnded` hace el POST de `/api/setters/pending-calls` **sin await** y en la línea siguiente llama a `_autoMarkNoAnswer`. Si la disposición llega primero, su limpieza (`call-disposition` busca pendientes del lead y borra el más reciente) no encuentra nada, y el POST posterior CREA el pendiente → huérfano permanente. Le pega a quien marca rápido y al flujo de auto-marca, que es instantáneo. Los 4 pendientes de prod (1 del admin, 1 de Judith, 2 de Teresa, del 27 al 31/7) eran todos de este tipo.
    - **Fix en el backend** (más robusto que encadenar en el front: defiende ante cualquier orden de llegada): antes de crear un pendiente nuevo, si el `callLog` del lead ya tiene una entry con `ts >= startedAt` de ESA llamada, se responde `{skipped:'already_dispositioned'}` y no se crea. Tests: `tests/pending-orphan.test.js` (3) — orden normal, race invertido, y que una llamada NUEVA posterior a la última marca sí registre pendiente (que el guard no se coma pendientes legítimos).
    - **Franja desactivada** con `DISPO_STRIP_ENABLED = false` (app.js, junto a `_dispoStripCache`) — el código queda para revivirla en una línea. El gate bloqueante de Phase 20 (D-01, el que impide discar con una llamada recién colgada sin marcar) NO se tocó: es otro mecanismo y el user no se quejó de él.
    - Los 4 huérfanos de producción se borraron con el endpoint de resolución existente.

## Sesión 2026-08-03 — Ficha de Hoy: los follow-ups y las notas no se veían

175. **La ficha de Hoy guardaba pero no refrescaba — un toggle sin feedback se apaga solo** (`v=20260803a`, frontend). El user reportó: desde Hoy abre la ficha de un lead interesado, aprieta "Follow-up programado 24h" y "no pasa nada". Reproducido en preview con la fetch interceptada: **el PATCH salía y el server guardaba bien** (`followUps.24hs=true`), pero el chip del modal seguía apagado.
    - **Causa**: `_hoyOpenFicha` reusa `_callsRenderExpandedPanel` dentro de un modal, que es un **DOM aparte** de la lista de Llamadas. Todos los handlers del panel (`_callsAddNote`, `_callsDeleteNote`, `_callsToggleFollowup`, `_callsReactivate`, alt-contact, disposition) terminan llamando `renderCallsList()`, que re-renderiza la lista — **invisible desde Hoy** — y nunca toca el modal. El estado de datos era correcto (la invariante de `_leadStoreApply`, #105, hace que mutar el Map mute el array); lo que faltaba era pintar.
    - **Por qué era peor que un detalle visual**: el follow-up es un **toggle**. Sin feedback el SDR vuelve a clickear el mismo botón y **destilda el que acababa de poner**. O sea, insistir hacía exactamente lo contrario de lo que se quería.
    - **Fix**: `_hoyRefreshFicha(leadId)` re-renderiza el `.modal-body` si el modal está abierto sobre ESE lead (`ov.dataset.leadId`), preservando `scrollTop` y el texto no guardado de los textareas (`call-precall-note-*` se guarda en blur y su PUT puede no haber vuelto). `_refreshLeadPanels(leadId)` = `renderCallsList()` + ese refresh; ruteados los 7 handlers. Toast explícito al tocar follow-up ("programado"/"quitado").
    - **Confirmado leyendo el endpoint** (`PATCH /leads/:id/followup`, index.js ~9856): los 5 steps son **excluyentes** — tildar uno destilda los otros y setea `followUpStartedAt`. Es un "¿cuándo vuelvo?" tipo radio, no checkboxes acumulativos. No es un bug; explicarlo si alguien lo reporta.
    - Verificado E2E en preview (Hoy y Llamadas): chip cambia a ON, toast sale, la nota aparece en la ficha sin cerrar/reabrir, y el estado del modal coincide con el del server. Sin errores de consola. Frontend-only, sin tests nuevos.

176. **El agente IA queda fuera de los reportes al grupo** (2026-08-03, solo backend → sin cache-buster). El diario decía `_Sin arrancar: Dalia, Agente_`: `setter_agente_ia` (Phase 24) es un setter más en `setters.json`, y el reporte solo excluía los admin-only (Ignacio/Paula) vía `_SUPERVISOR_EXCLUSION_SET`. Con 0 llamadas figuraba como vendedora que no arrancó; apenas empiece a llamar, sus dials/atendidas iban a caer en las filas y en el total del equipo.
    - **Fix**: `REPORT_EXCLUDED_SETTER_IDS = ADMIN_ONLY_SETTER_IDS + VOICE_AGENT_SETTER_ID` + su pseudo-set `_REPORT_EXCLUSION_SET` (mismo patrón `{has}` de #144), usados por `buildDailyReportData` y `buildWeeklyReportData` (el consolidado hereda del diario, y el `calendar` se filtra con el mismo set).
    - **Deliberadamente SEPARADO de `_SUPERVISOR_EXCLUSION_SET`**: eso es visibilidad/RBAC de Phase 18, donde el agente SÍ se ve (tiene su panel propio). Agregar el agente a `ADMIN_ONLY_SETTER_IDS` habría cambiado las dos cosas a la vez. **Regla: si aparece otro pseudo-SDR automático, va en `REPORT_EXCLUDED_SETTER_IDS`, no en el de Phase 18.**
    - **Verificado con data de prod** (copia en scratchpad): antes `Sin arrancar: Dalia, Agente` → después `Sin arrancar: Dalia`; y con 6 llamadas del agente inyectadas de HOY el total del equipo no se mueve ("Equipo 8 llam" idéntico) ni aparece fila. En prod post-deploy: `/api/admin/weekly-report/preview` → `neverStarted: ["Dalia"]`.
    - Test: caso nuevo en `tests/daily-report.test.js` (43) — **verificado que falla sin el fix** (revirtiendo la línea, `team.dials` da 6 en vez de 4).
    - ⚠️ **Bug de calendario preexistente en `tests/weekly-report.test.js:428`, arreglado de paso**: el regex `/_Semana \d{2}[–-]\d{2}\/\d{2}/` solo aceptaba semanas dentro del MISMO mes ("27–02/08"), pero `mkRange` escribe el mes entero cuando la semana cruza ("27/07–02/08") → rojo ~1 semana de cada 4. **Confirmado con `git stash` que ya fallaba en main limpio** antes de tocar nada (misma clase de bug que #163: fixture/aserción atada al calendario). Suite completa **1172/1172**.

## Sesión 2026-08-05 — CAUSA RAÍZ FINAL del mic equivocado: el dispositivo virtual "Predeterminado" de Chromium

177. **El mic elegido en el panel Audio seguía sin usarse — Chromium guardaba un dispositivo VIRTUAL** (`v=20260805a`, frontend `public/app.js` + cache-buster en index.html). El user (que usa **Brave**) reportó que los clientes no lo escuchaban NADA y que en la llamada aparecía otro mic que el elegido; la captura mostraba `Mic: Varios micrófonos (Intel® Smart Sound...)` + "Sin voz". Todos los fixes previos (#168 `_isBuiltInMic`, #169 `_resolveMicId` por nombre) no cubrían esto:
    - **Causa**: `enumerateDevices()` en Chromium incluye dos dispositivos VIRTUALES — `deviceId='default'` ("Predeterminado - X") y `'communications'` ("Comunicaciones - X") — que aparecen PRIMEROS en la lista del panel Audio y no son un micrófono: son un puntero a "lo que Windows tenga como default AHORA". Elegir "Predeterminado - Micrófono (HyperX...)" guardaba `micId='default'`; como ese id existe SIEMPRE, `_resolveMicId` lo daba por vigente eternamente y jamás migraba; la llamada capturaba el default de Windows = el array interno de la laptop. Y `_micSwapRefresh` ocultaba el selector de rescate justamente "porque ya había una elección guardada". En **Brave** es peor: su anti-fingerprinting randomiza los deviceId por sesión, así que hasta los ids físicos caducan siempre → la resolución por NOMBRE es la única identidad estable.
    - **Fixes**: (a) helpers `_isPseudoMicId(id)` + `_stripPseudoPrefix(label)` (regex Predeterminado/Comunicaciones/Default/Communications); (b) el panel Audio lista SOLO micrófonos físicos (`_audioListDevices` filtra pseudo) y al abrirse ejecuta `_resolveMicId()` para migrar la elección vieja ANTES de marcar el select; (c) `_resolveMicId` nunca acepta un id virtual como vigente, compara labels sin el prefijo virtual, y si no puede resolver devuelve `''` (default del sistema, sin mentir); (d) `constraints()` omite `deviceId` si el id es virtual; (e) `_micSwapRefresh` muestra el selector de rescate siempre que la llamada salió por un mic integrado que NO es el elegido (antes se ocultaba con cualquier elección guardada) + status que nombra qué se eligió; (f) `__audioDebug` gana `isPseudo`/`stripPseudo`.
    - **Verificado en preview** (login por fetch + `enumerateDevices` mockeado): migración `default`→HyperX físico re-guardando storage, recuperación por puerto USB distinto (regresión #169 OK), elección legítima del interno vía "Comunicaciones" migra al Intel físico, mic desconectado → `''`, `constraints()` sin deviceId con id virtual, panel sin entradas virtuales y select pre-marcado en el mic migrado. **Pendiente de verificación en vivo: una llamada real mirando la línea "Mic:"** (el preview no tiene mic).
    - **Regla para el futuro: JAMÁS guardar/aceptar `deviceId` `'default'`/`'communications'` como elección de dispositivo; la identidad estable de un mic es su LABEL sin prefijo virtual, no su id** (en Brave los ids rotan por diseño).
    - ⚠️ **Bug pre-existente detectado al verificar**: en cada carga con sesión activa, `_startSpeedToLeadPolling()` y `_startCallbackDuePolling()` tiraban `ReferenceError ... before initialization` (TDZ). Confirmado con `git stash` que pasaba igual en main limpio. → **ARREGLADO en #178** (sesión paralela desde el chip de task).

## Sesión 2026-08-05 (parte 2) — TDZ en el boot: speed-to-lead y callbacks nunca arrancaban

178. **Los pollings de speed-to-lead y callbacks vencidos morían por TDZ en TODA recarga con sesión activa** (`v=20260805b`, solo frontend `public/app.js` + `index.html`). El boot llama `_startSpeedToLeadPolling()` / `_startCallbackDuePolling()` apenas restaura la sesión, pero las declaraciones `let _speedPollTimer` / `_cbPollTimer` vivían DESPUÉS en el mismo scope → TDZ ReferenceError. Como ambas funciones son `async`, el error salía como promise rejection silenciosa y el boot seguía normal — por eso nunca se notó: el único síntoma era que el alert 🔥 de speed-to-lead y el aviso 📅 de callbacks vencidos no corrían jamás en el flujo diario (recarga con sesión ya válida; en login manual el submit hace `window.location.reload()` → se entra siempre por ese mismo flujo). Fix: las variables de estado de ambos pollings (`_speedLastCheck/_speedPollTimer/_speedAudioCtx/_cbLastCheck/_cbPollTimer/_cbPollFn`) se declaran ARRIBA, junto al bloque del boot que las invoca (nota anti-TDZ en el código).
    - **Segundo bug desenmascarado por el fix**: `_cbPollTimer._fn = poll` — en browser `setInterval` devuelve un NUMBER y colgarle una propiedad tira `TypeError: Cannot create property '_fn' on number` en strict mode (app.js es ES module). O sea el re-poll de callbacks al volver a la pestaña (visibilitychange, Sprint 37) NUNCA funcionó en browser; mientras el TDZ mataba la función antes, el TypeError quedaba oculto. Fix: `_cbPollFn` como variable del scope.
    - Verificado en preview logueado (login por fetch + `Object.defineProperty(document,'hidden',...)` porque el poll se saltea con pestaña oculta — workaround #124/#125): `recent-responses` cada 15s exactos, `callbacks/due` dispara, el re-poll por visibilitychange funciona, consola sin errores nuevos.
    - **Cache-buster actual: `app.js v=20260805b`** (el `v=20260805a` fue usado por los DOS fixes de esta fecha — mic #177 y TDZ — en ramas paralelas; al mergear se bumpeó a `b` para que el archivo combinado tenga buster propio). style.css sin cambios (`v=20260728a`).

## Sesión 2026-08-11 — Captura de mic VERIFICADA + auto-rescate (el fix #177 no alcanzó en Brave)

180. **La llamada seguía saliendo por el mic interno AUNQUE la elección estaba bien guardada** (`v=20260811a`, `public/app.js` + whitelist `micFix` en `index.js`). Llamada real a Perú del user: elección correcta ("Micrófono (7- HyperX SoloCast) (03f0:0b8b)", label físico con vid:pid — o sea la migración #177 FUNCIONÓ), el cartel de rescate nuevo apareció nombrándola (la detección #177 FUNCIONÓ)… pero la llamada salió igual por el Intel y el cliente no lo escuchaba. Conclusión: en Brave, `getUserMedia` con un deviceId que su anti-fingerprinting no mapea **cae al default del sistema SIN error** (con `{ideal}` no hay throw) — resolver el id antes de capturar no garantiza nada. **La única verdad es el label del track CAPTURADO.**
    - **`_captureMicVerified(micId)`** (junto a `_resolveMicId`): captura → compara el label del track contra el elegido (normalizado sin prefijo virtual/puerto USB) → si vino OTRO dispositivo y el elegido está conectado, re-captura con `{deviceId:{exact}}`, libera el stream equivocado y re-guarda id+label. Post-captura `enumerateDevices()` SIEMPRE tiene labels (hay stream activo) — este chequeo no puede fallar por labels vacíos como sí puede la resolución pre-llamada. Usada en `_startTelnyxCall` (cadena de mic) y `_swapMicLive`.
    - **Fallback del SDK ya no snapshotea el id viejo**: `_callOpts.audio` se armaba con `constraints()` ANTES de resolver el mic → si la cadena fallaba, el SDK capturaba con el id caducado. Ahora `_resolveMicId()` corre antes de armar `_callOpts` y `audio` usa el id resuelto.
    - **Auto-rescate en `_micSwapRefresh`**: si la llamada salió por el mic integrado y el ELEGIDO está conectado, `_swapMicLive` se dispara SOLO (guard `_micAutoSwapTried`, 1 intento por llamada, reset en `_stopMicMonitor`) + toast "Micrófono corregido automáticamente". El cartel queda únicamente para cuando el elegido no está conectado.
    - **`recMeta.micFix`** (`'retried-exact'` | `'mismatch-kept'`): queda persistido qué hizo la captura verificada en cada llamada — el próximo reporte se diagnostica con datos.
    - **Verificado en preview** con `getUserMedia`/`enumerateDevices` mockeados simulando el bug exacto de Brave (ideal ignorado → Intel): re-captura con exact del correcto, stream malo liberado, storage migrado, nota 'retried-exact'; elegido desconectado → 'mismatch-kept' sin romper; captura correcta al primer intento (otro puerto USB) → 1 sola captura. **Pendiente: llamada real del user mirando la línea "Mic:" y `recMeta.micFix`.**

## Sesión 2026-08-10 — Power Dialer en la vista Hoy

179. **Power Dialer también desde Hoy** (`v=20260810a`, frontend `public/app.js` + `public/index.html`). Pedido del user: "es poco práctico trabajar ahí" — los seguimientos de Hoy (callbacks manuales + interesados, que desde #125 NO viven en Llamadas) se trabajaban clickeando "Llamar" fila por fila. Ahora el header de Hoy tiene su botón "Power dialer" que abre el MISMO overlay `#power-dialer` con una cola propia:
    - **`_pd.mode`** (`'calls'` | `'hoy'`): `_pdStart(mode)` branchea el refresh (`loadHoyView()` vs `loadCallsView()`) y el armado de cola; `_pdExit` refresca la vista de origen. El resto de la maquinaria (`_pdRender`, dispositions, autopiloto, atajos, holdCurrent) se reusa intacta.
    - **`_hoyState`** (`{callbackIds, interesadoIds, at}`): `loadHoyView` guarda los ids de sus secciones en el orden renderizado — la cola del dialer es EXACTAMENTE lo que la vista muestra, no una re-derivación.
    - **`_pdBuildQueueHoy()`**: callbacks manuales **YA VENCIDOS** primero (orden por hora), después interesados sin agendar. **Los callbacks programados para más tarde HOY no entran**: el SDR prometió esa hora, el dialer no se adelanta (además `_pdRender` los expulsaría por callbackAt futuro). Re-abrir el dialer más tarde los incorpora solos; el toast de cola vacía lo explica ("N callbacks de hoy entran a su hora").
    - `pd-progress` muestra "· cola de Hoy" para saber en qué cola se está.
    - **Verificado E2E en preview con data de prod**: cola 63 (12 callbacks vencidos → interesados, orden correcto con chip ✓ INTERESADO en el 13°), exit refresca Hoy, y el dialer clásico de Llamadas sin regresión (3990 leads, sin chip). Consola limpia.
    - **Power dialer POR SECCIÓN** (`v=20260810b`, mismo día — feedback del user: quería poder trabajar callbacks e interesados por separado): botón chico "Power dialer" en el head de cada sección de Hoy (`_hoyRenderSection` gana param `dialerMode`) → `_pdStart('hoy-callbacks')` / `_pdStart('hoy-interesados')`. `_pd.hoyFilter` (`null`|'callbacks'|'interesados') filtra `_pdBuildQueueHoy(filter)`; toasts y `pd-progress` nombran la sub-cola ("callbacks de Hoy"/"interesados de Hoy"). El botón general del header sigue encadenando las dos (es la vía "cuando termino callbacks sigo con interesados"). Verificado: 12 solo-callbacks / 51 solo-interesados / 63 general con la misma data. El SDR solo ve seguimientos — los vírgenes siguen viviendo en el dialer de Llamadas (decisión explícita del user).

## Sesión 2026-08-11 (parte 2) — 3 bugs reportados en vivo durante llamadas (Power Dialer de Hoy + modal callback + cola)

181. **Ignacio reportó 3 bugs EN VIVO mientras llamaba; los 3 arreglados juntos (`v=20260811b`, solo frontend `public/app.js` + cache-buster)**. Los tres estaban conectados entre sí:
    - **(a) El Power Dialer de Hoy EXPULSABA al SDR al colgar**: `_onTelnyxCallEnded` tenía un salto viejo (audit 2026-07-06, pre-#179) — "si la vista visible es Hoy, navegar a Llamadas para marcar el resultado". Con el dialer de Hoy abierto (overlay sobre view-hoy), ese click programático al sidebar disparaba el delegate de `_pdStart` que CIERRA el dialer ante cualquier navegación → el SDR quedaba tirado en Llamadas con el cartel "Ir a marcar", a mitad de cola. Fix: el salto y el `_focusDispositionRow` solo corren con `!_pd.active` — el dialer tiene su propia grilla de resultado y atajos 1-9; el gate se libera al marcar desde ahí.
    - **(b) Modal "Volver a llamar después" muerto en "Guardando…" PARA SIEMPRE**: el flujo de éxito escondía el modal sin restaurar el botón (`disabled` + texto "Guardando…"). Como el modal se reusa, TODOS los opens siguientes de la sesión mostraban el botón muerto → no se podía programar ningún callback más (el 1er callback de la sesión sí se guardaba — por eso el lead "desaparecía" y el user no lo encontraba). Fix: reset al abrir (`Programar` + enabled) + `finally` que restaura en cada intento. Mismo fix preventivo en el modal del hold de calendario (`call-ph-confirm`, "Mandando…") y label del modal Agendar (quedaba "✓ Agendado").
    - **(c) Los recién llamados quedaban clavados ARRIBA de la cola de Llamadas**: los pins de `_callsForceShow` (agenda de callbacks, gate "Ir a marcar", y el salto de (a) — cada llamada desde el dialer de Hoy pinneaba su lead) NUNCA se limpiaban: bypasseaban el filtro de callbacks futuros Y el sort los pone primeros → los "ya trabajados hoy" se apilaban mezclados con los pendientes. Fix: `_dispoAfterSaved` hace `_callsForceShow.delete(leadId)` — marcado el resultado, el pin ya cumplió su propósito.
    - **Toast "a dónde se fue" (`_dispoWhereToast`)**: con (c) arreglado, el lead recién marcado SALE de la lista al toque — sin aviso parecía que "se esfumaba" (queja literal del user con un lead que no podía re-encontrar). Ahora cada disposition que deja callback futuro avisa: «Lead» sale de la cola — vuelve mañana 10:00 **en Hoy → Callbacks** (manual) / **a la cola de Llamadas** (cadencia automática). En el Power Dialer se omite (el banner "Resultado guardado" ya da el feedback). También suena al guardar desde el modal de callback (antes se cerraba sin confirmar nada).
    - **Verificado E2E en preview** (login por cookie + javascript_tool): modal abre reseteado incluso partiendo del estado colgado simulado, guarda y REABRE bien (el escenario exacto roto en prod), toasts con destino correcto en ambos caminos (manual/cadencia), lead sale de la lista, PD abre/cierra sin regresión (cola 3986), consola sin errores. Los 3 guards confirmados en el archivo servido.
    - **Pendiente de verificación en vivo**: colgar una llamada real dentro del Power Dialer de Hoy y confirmar que la grilla de resultado queda ahí (no se puede simular una llamada Telnyx en preview).

## Sesión 2026-08-12 — Callback zombie: toda disposición consume el callback pendiente

182. **Lead clavado 1° en la cola de Prioridad por un callback vencido arrastrado (deploy `56da7b1`, solo backend `index.js` — sin cache-buster)**. Ignacio reportó "ya lo llamé dos veces y me sigue apareciendo primero". Diagnóstico con data de prod: el lead tenía un callback de cadencia del 25/7 VENCIDO (puesto por un no_answer de Judith, heredado en el traspaso) y él lo llamó el 11/8 marcando "Me cortó" (1er corte). Ninguna rama limpiaba el callback viejo → `_callScore` da **+60 +20 por atraso** a "callback vencido" (diseñado para superar a cualquier fresco) → el lead quedaba PRIMERO para siempre, tapando a los vírgenes. Solo la rama `hung_up` con <2 cortes tenía la fuga (las demás pisan o limpian).
    - **Fix (`_applyCallOutcome`)**: `lead.callbackAt = ''` al entrar — **toda disposición consume el callback pendiente**; `callback_later` y la cadencia de no-contacto programan el suyo después, como siempre. La corrección de auto-marca (Phase 20) también lo consume tras restaurar el snapshot (test `disposition-enforcement:264` actualizado a propósito — dejarlo vivo reabría el bug por la vía de la corrección).
    - **`POST /api/admin/backfill-consumed-callbacks`** (admin, dryRun, mutex, idempotente): limpia `callbackAt` vencido que tiene una llamada POSTERIOR en el callLog (= consumido). Un vencido SIN llamada posterior NO se toca (sigue legítimamente pendiente en "Para seguir"). Mismo patrón/gap que #172: el fix solo actúa hacia adelante.
    - **Ejecutado en prod**: **54 leads limpiados** (no 6 — el conteo diagnóstico filtraba descartados/interesados; el endpoint barre todo, y limpiar esos también es correcto). Verificación post: matched 0. Los 6 visibles en cola eran todos `hung_up` como última llamada.
    - Tests: +2 en `hangup-cap` (8) + aserción actualizada en disposition-enforcement. Suite **1180/1180**.
    - **Además en esta sesión**: traspaso de cartera completo Dalia (582) + Adela (475) → Ignacio vía `transfer-portfolio` (1057 leads, 4 interesados y 22 callbacks intactos, backup server-side `2026-08-12T14-06-36_pre-transfer-portfolio`); y limpieza del gitlink huérfano `.claude/worktrees/frosty-mendel-de2268` que rompía `git status` (commit `bfca6fa` — era el worktree de la sesión TDZ #178 con el repo aún en OneDrive, contenido verificado 100% igual a `f13b4fa` antes de borrar).

183. **Interesados protegidos del auto-descarte + búsqueda global en Llamadas (cache-buster `v=20260812a`, app.js + index.html + `index.js`)**. Origen: Ignacio pitcheó a la asistente de "Ambar dental" (interesado + callback manual), al día siguiente llamó a la hora pactada, no atendieron, marcó "No atendió" → el lead "desapareció" (estaba en Hoy → Interesados, pero él lo buscaba en Llamadas donde los interesados se filtran a propósito #125) y quedó a UN "No atendió" de que la cadencia lo descartara sola.
    - **(a) La cadencia de no-contacto NO descarta interesados** (`_applyCallOutcome`, index.js ~10775): con `estado='interesado'`, al 2° no-contacto seguido NO hay auto-descarte — sigue el reintento +24h para siempre; agendar/descartar es decisión humana desde Hoy → Interesados. **El tope de cortes (hung_up ×2) SÍ les aplica** (criterio del user #171: atender y cortar dos veces es señal). Test: caso nuevo en `call-cadence` (6).
    - **(b) El buscador de Llamadas es GLOBAL**: con texto en `#calls-search`, `renderCallsList` saltea los filtros de visibilidad (país + interesados/descartados/agendados + callbacks futuros + último outcome `callback_later`) y muestra banner "Búsqueda en todos tus leads". Los chips que la card YA tenía (INTERESADO / DESCARTADO / fecha de callback / auto #N) dicen dónde vive cada resultado. **El Power Dialer NO cambia** (`_pdBuildQueue` mantiene sus filtros — no se disca un descartado por accidente). Límite conocido: DNC y tarifa roja se filtran server-side → no aparecen ni buscando (para DNC está su vista `dnc=1`).
    - **El modelo de seguimiento, para explicar a SDRs**: (1) Interesado → vive en Hoy → Interesados todos los días hasta agendar/descartar; (2) Volver a llamar → Hoy → Callbacks el día pactado; (3) No atendió/Buzón → reintento automático +24h, al 2° seguido descarta (salvo interesados); (4) Me cortó → vuelve a la cola, al 2° corte descarta.
    - Verificado en preview con data de prod (login fetch + DOM): buscar "ambar" encuentra el interesado con chip + banner; limpiar la búsqueda lo vuelve a esconder (50 rows normales); consola limpia. Suite **1181/1181**.

## Phase 29 — Reloj único de "próximo paso" (`lead.nextAction`), plan 29-04 (2026-08-14)

184. **`lead.nextAction` reemplaza a los DOS relojes que existían antes** (`callbackAt` suelto + los 5 checkboxes de `followUps`). Forma: `{ tipo, dueAt, canal, motivo, origen, createdAt, createdBy }` — `tipo` ∈ `callback|cadencia|otro`, `origen` ∈ `manual|cadencia` (whitelists `NEXT_ACTION_TIPOS`/`NEXT_ACTION_CANALES`/`NEXT_ACTION_ORIGENES`, index.js ~10739). Único lector/escritor autorizado: `_leadNextAction(lead)` (lee `nextAction` si ya está migrado, si no lo DERIVA de los campos viejos vía `_deriveNextActionFromLegacy` — mismo resultado para un lead migrado y uno sin migrar) y `_setNextAction(lead, spec, nowIso)` / `_clearNextAction(lead)` para escribir. Toda vista del backend que antes leía `callbackAt`/`followUps` directo (colas de callback, `manualCallbackByOwner`, `/followups/today`, badge del sidebar, Power Dialer, Hoy) ya pasa por `_leadNextAction` desde 29-01/29-03.
    - **`callbackAt` sigue vivo, ESPEJADO desde `nextAction.dueAt`** (`_setNextAction` lo asigna literal en cada escritura): decenas de lectores viejos en backend (`_callScore`, `_leadIsCallableNow`, filtros de sin-wsp) y frontend (chips, sorts, el Power Dialer entero) siguen leyendo `lead.callbackAt` directo. Se retira recién cuando no quede ningún lector — trabajo de las fases 30-34, NO de esta.
    - **`lead.followUps` / `followUpStartedAt` ya NO son fuente de verdad de ninguna vista** (eso lo hizo 29-03) — sobreviven solo como registro muerto (el frontend todavía pinta su chip) y como PLANTILLA de duración (`NEXT_ACTION_TEMPLATES`: 24hs/48hs/72hs/7d/15d, mismas 5 de siempre) que tildar un checkbox usa para calcular `dueAt`. NO se borran (D-04): la historia queda.
    - **Toda disposición CONSUME el `nextAction`/`callbackAt` pendiente al entrar** (generalización de la nota #182: el bug del callback zombie no era un caso aislado, es la regla de fondo desde 29-02) — `callback_later` y la cadencia de no-contacto programan el suyo propio después, como siempre.
    - **Migración**: `POST /api/admin/backfill-next-action` (admin, `dryRun`+backup+mutex+idempotente, index.js ~4103) persiste explícito lo que `_deriveNextActionFromLegacy` ya deriva — no cambia ninguna fecha visible. Comando en producción (después del deploy, idempotente, no rompe nada si no se corre): `node scripts/one-shot-migrate-next-action-2026-08-14.mjs` (simula) y con `--apply` ejecuta. Medido contra una copia real de `data/setters.json` (6.413 leads, 2026-08-14): 166 leads migrables (165 con `callbackAt`, 1 solo con `followUps` activo).
    - **Esta fase (29-01 a 29-04) NO tocó `public/`** — backend-only, cero bump de cache-buster. El único cambio visible para el usuario es el badge de follow-ups (nota del plan 29-03, sube al incluir los callbacks manuales de disposición) — no algo de este plan puntual.
    - Rule 1 destapado al testear: `_callSetterId` (index.js ~7426) crasheaba `GET /leads/sin-wsp` (500) cuando un lead con `nextAction.origen==='manual'` tenía `callLog` vacío (posible desde 29-03: tildar un follow-up programa `nextAction` sin exigir ninguna llamada previa) — guard agregado, cae al mismo fallback que ya existía para "sin `entry.by`" (`lead.assignedTo`).

## Sesión 2026-08-16 — La biblioteca de Entrenamiento IA se escondía al dueño a sí mismo

185. **Con "Ver como SDR · Ignacio" la biblioteca quedaba VACÍA** (solo backend `index.js` + `tests/training-owner-visibility.test.js` → sin cache-buster). El user reportó "como Ignacio no puedo ver las transcripciones mías". Reproducido en preview con data de prod (2026-08-16): `GET /api/training/calls` devuelve **281** como admin plano y **0** con `?viewAs=setter&asSetterId=setter_ignacio`.
    - **Causa**: la exclusión direccional de #171(c) branchea por el ROL EFECTIVO — `_trainingExcludedFor('setter')` devuelve `{setter_ignacio}`. Pero el dueño trabaja su propia cartera EN modo "Ver como SDR · Ignacio" (así ve solo sus leads en Llamadas/Hoy), o sea mira con rol efectivo `setter` → el filtro pensado para que las SDRs no vean sus pruebas se lo aplicaba **a él mismo**. Y como hoy el 100% de la biblioteca es suya (281 de 281 con transcript; el resto del equipo tiene 0), le quedaba completamente vacía.
    - **Fix**: `_trainingExcludedFor(role, mySetterId)` — el set nunca incluye el setterId de quien mira. **Regla: nadie puede quedar sin ver su propio material.** El resto del comportamiento intacto: la SDR sigue sin ver las del dueño, y en modo SDR él sigue viendo SOLO las suyas (`onlyOwn` de #118).
    - **"Ver como Supervisor" sigue dando 0 y está BIEN** — es fiel a lo que ve un supervisor real (`_SUPERVISOR_EXCLUSION_SET` de #144 excluye `setter_ignacio`/`setter_paula_kroff`). No se tocó: la impersonación debe ser fiel.
    - Verificado post-fix con la misma data: admin plano 281 (sin cambio), Ver como SDR · Ignacio **281**, detalle de una llamada propia en modo SDR 200 OK, Ver como Paula 0 (correcto, tiene 0 con transcript), UI de Entrenamiento IA con el viewAs activo mostrando "281 con transcripción" y consola limpia. Tests: 2 casos nuevos en `training-owner-visibility` (5). **Suite completa 1889/1889.**
    - **Observación aparte (NO investigada)**: de las 40 llamadas del 15/08, 8 tienen transcript; 13 son de duración 0 o <15s (sin conversación que transcribir), pero quedan ~19 de ≥15s sin transcript. Puede ser el límite conocido de Whisper/captura (#141/#157/#159) o algo nuevo — con `transcript.recMeta` persistido hay con qué diagnosticar si el user lo pide.

## Sesión 2026-08-16 (parte 2) — Por qué faltaban transcripciones: 3 bugs distintos

186. **Diagnóstico completo sobre 998 llamadas de prod (45 días) — la mayoría de las "faltantes" son POR DISEÑO, pero había 3 bugs reales**. Los números primero, porque cambian dónde hay que mirar:
    - **Por diseño (correcto, no tocar)**: `_TRANSCRIBE_OUTCOMES` (app.js) solo sube el audio si alguien atendió y habló. no_answer (338), voicemail (289), wrong/invalid_number (101) se descartan sin gastar Whisper. Eso es el grueso de "no tiene transcript".
    - **Falla real de subida**: 11 de 185 llamadas con outcome de conversación y ≥15s (6%).
    - **El problema grande estaba en otro lado**: de los 217 transcripts que SÍ salieron, **35 (16%) tienen el canal del CLIENTE vacío** — sale la mitad de la conversación y nadie lo reporta como "falta transcripción".
    - Método: el `asrDebug`/`recMeta` de #154/#157 respondieron todo sin adivinar. **Distinguir "sin objeto `transcript`" (nunca se subió) de "`transcript` con `segments: []`" (Whisper corrió y no sacó nada) es lo que parte el diagnóstico en dos** — un conteo por `segments.length` los mezcla.

187. **BUG 1 — `compression_ratio` es una métrica de VENTANA, no de segmento** (`_cleanWhisperSegments`). Whisper reporta `compression_ratio`/`no_speech_prob`/`avg_logprob` por ventana de decodificación (~30s): si entra en loop en una parte, TODOS los segmentos de esa ventana heredan el cr alto, **incluidos los de habla real**. El filtro `_cr < 2.4` los tiraba a todos.
    - Prueba en los datos (2026-07-30, 86s, cliente con 33% de señal medida): los 3 segmentos de la recepcionista — "Buenas tardes." / "Sí, ¿en qué te podemos ayudar?" / "La persona está un poco ocupada" — venían con el MISMO `cr 4.21`, `nsp 0.21`, `alp -0.33`. raw 18 → kept 0. Conversación entera perdida. Que las tres métricas sean idénticas entre segmentos distintos ES la firma de que son de ventana.
    - **Fix**: `_collapseRepeatedText(txt)` (pura, expuesta en `globalThis.__whisper`) colapsa la repetición DENTRO del texto — frases repetidas por puntuación ("Buenas tardes, buenos días, buenos días…" → "Buenas tardes, buenos días") y n-gramas periódicos ("gracias gracias gracias" → "gracias"). Se colapsa ANTES de filtrar, el eco del prompt se evalúa sobre el texto colapsado, y el descarte por loop pasa a ser: `cr >= 6` (loop extremo) **o** (`cr >= 2.4` y lo que queda tras colapsar es trivial, < 12 chars). El habla real más repetitiva medida en prod llegó a cr 5.2; los loops puros ("Sí." ×56 = 8.38, "hola, hola…" = 14.76, los remixes del prompt de #158 = 7.91 y 21) quedan arriba de 6 → **el umbral 6 sale de los datos, no de la intuición**.
    - **Medido con el código real sobre el `asrDebug` de prod: 8 de 13 canales rescatados**, 5 siguen vacíos (loops reales). Los tests de #141/#157/#158 siguen verdes — no se resucita la basura vieja.
    - Caveat de la medición: `rawSample` guarda solo 4 segmentos truncados a 80 chars, así que el colapso sobre la muestra deja restos ("días, buenos días"); con el texto completo en vivo limpia mejor.

188. **BUG 2 — el transcript se guardaba en la llamada EQUIVOCADA** (`_pickCallLogIdxForTranscript`, nueva función pura). `entry.ts` es el momento en que se MARCÓ la disposición (`call-disposition` usa `new Date()`), NO el inicio de la llamada. El matching comparaba `callStartedAt` contra `ts` con ventana de **10 segundos** → solo acertaba en llamadas de menos de 10s marcadas al instante; en una conversación de 3 minutos nunca matcheaba y caía al fallback `length - 1`.
    - Caso real (2026-08-05, Franci Zuñiga): el audio de 208s quedó guardado en una llamada de 11s marcada 18 segundos después; la conversación de 212s quedó sin transcript. **30 de 140 transcripts con asrDebug (21%) tenían el audio pegado al entry equivocado.**
    - **Fix**: se estima el inicio de cada entry como `ts - duration` y se elige el más cercano a `callStartedAt` (comparando también contra `ts` crudo, porque `duration` puede venir en 0). Ventana 10 min = el timer del buffer de audio; como se elige el MÍNIMO, el entry correcto gana igual — la ventana chica era justamente lo que rompía el matching.

189. **BUG 3 — "Volver a llamar" perdía la duración y el número de la llamada** (app.js, modal de callback). Era el **único** de los cuatro call sites de disposición que no llamaba `_consumeTelnyxMeta` (dropdown directo, interesado y objeción sí lo hacían). Todo `callback_later` guardaba `duration: 0` aunque la conversación hubiera durado minutos — visible en prod: entries de callback con audio de 32 a 245 segundos y duración 0.
    - **No es solo un dato perdido: hunde métricas.** El funnel cuenta conversación con `duration >= 30` (`COLD_CALL_CONV_MIN_S`), así que esas llamadas no contaban como conversación en ninguna vista. Con el fix empiezan a contar (los entries VIEJOS quedan en 0 — no hay de dónde recuperar la duración).
    - Verificado en preview con el flujo real (dropdown → modal → confirmar, POST interceptado): el body ahora lleva `telnyxCallMeta {durationSecs: 176, fromNumber}`.
    - **Regla**: cualquier call site nuevo de `call-disposition` DEBE mergear `_dispoEnforcementBody(leadId)` **y** `_consumeTelnyxMeta(leadId)`. Son dos cosas distintas y es fácil poner una sola.

190. Tests: `whisper-hallucination` pasó de 15 a **33** (casos reales de prod: recepcionista con cr heredado, saludo + loop, "Sí." ×56, "hola" ×N, los 6 del matching de entry, los 4 de `_collapseRepeatedText`). Suite completa **1903/1903**.

## Sesión 2026-08-16 (parte 3) — Teléfonos rotos: el reparador existía y nunca se corrió

191. **Los `+619…` de Tijuana no eran un bug nuevo: el reparador de teléfonos ya los cubría y nadie lo ejecutó** (solo backend `index.js` + `tests/phone-repair.test.js` → sin cache-buster). Ignacio reportó "un montón de números de México mal, empiezan +6, sobre todo los que tengo para llamar primero". Diagnóstico sobre la base (6.413 leads):
    - **Qué son**: 67 clínicas de Tijuana con número de **San Diego** (`619` = área NANP) al que se le perdió el `+1` — tal cual salen hacia **Australia** (+61), y el lookup de Telnyx lo confirmaba con carriers australianos (Telstra, Optus, TPG). Otros 2 con LADA 664 (Tijuana) sin el `+52`, 1 de Cali y 3 móviles de España sin código de país. En total **155 teléfonos rotos** en la base, no 73 (99 de México, 19 de Colombia, 9 de Costa Rica, 8 de España, 7 de Uruguay, 7 de Chile, 4 de Perú, 2 de Ecuador).
    - **La causa de que siguieran ahí**: `POST /api/admin/repair-phones` (con `_repairMexicanPhone` y su `_US_BORDER_AREA`, que ya contempla 619) existe desde el 2026-08-14 y **nunca se corrió**. Lo único ejecutado fue `repair-co-phones` el 2026-07-28 (128 leads de Colombia). Antes de escribir código: revisar si el arreglo ya existe sin usar.
    - **Daño medido**: 85 marcadas gastadas contra números inexistentes y **38 leads descartados por la cadencia** (2 no-contacto seguidos = auto-descarte). Ninguno de los 38 tuvo una sola llamada atendida — todos son artefacto del número roto, no decisión de nadie. Costo en dólares irrelevante ($0.84 estimado, $0 real: las llamadas ni conectaban); el costo fue el tiempo de las SDRs y los leads quemados.
    - **BUG REAL encontrado al verificar el fix (no estaba reportado)**: `_repairColombianPhone` no conocía la numeración NUEVA de Colombia (`60X` + 7 sin código de país), así que caía a `_repairGenericPhone`, que lee `602` como área NANP (**Phoenix**) → el fijo de Cali `+6023800805` se habría "reparado" a `+16023800805`, un número de Arizona. Correr el reparador sin este fix creaba un error nuevo. Regla agregada al principio de la función (601 Bogotá, 602 Cali, 604 Medellín, 605 Barranquilla, 606 Eje Cafetero, 607 Bucaramanga; 600/609 no son indicativos y se rechazan). **Verificado que el test falla sin el fix** (devuelve `+16023800805`).
    - **`reactivateDiscarded` (nuevo, default false)** en `repair-phones`: rescata los leads que la cadencia descartó sola contra el número roto — reparar el teléfono sin devolverlos deja el arreglo a medias (número bueno en un lead que nadie va a discar). Solo entra el que tiene llamadas y **ninguna** con outcome de `COLD_CALL_CONNECT_OUTCOMES` (el canon de "atendida", nota #157): si alguien atendió, el número llegaba a algún lado y el descarte se respeta. El descartado a mano (sin una sola llamada) tampoco se toca. Resetea estado/interes/cadenceStep/cadenceExhausted/autoDiscardReason + `_clearNextAction`, conserva callLog/notes/interactions y loguea `{action:'reactivated', reason:'phone_repaired'}`. Con el flag, los descartados entran al scan aunque `onlyAlive` esté puesto (si no, el flag no haría nada).
    - **Medido en preview con data de prod**: 155 escaneados → **116 reparados, 31 reactivados**, 0 colisiones, 39 sin arreglo honesto. Los 31 (y no 38) son los rescatables cuyo número SÍ se pudo reparar — devolver a la cola un lead con el teléfono todavía roto sería repetir el ciclo. Aplicado en preview: los 71 rotos desaparecen de la cola de Ignacio y los 67 de Tijuana vuelven como `+1 619` (verificado también en la UI de Llamadas).
    - **Los 39 `unresolved` quedan pendientes, a propósito** (ya documentados en el código como "revisar a mano"): 8 números de servicio 600 de Chile (inalcanzables desde el exterior, están bien escritos), 6 de Uruguay con un número brasileño pegado, y ~12 colombianos con el patrón `57` + 7 dígitos (les falta UN dígito: se podría suponer el área por la ciudad —como hace México con `_MX_CITY_LADA`— pero eso es inventar un dígito, no repararlo). Si se quiere atacar, es una ronda aparte con criterio explícito.
    - Tests: `phone-repair` pasó de 11 a 19 (+ los 4 casos del endpoint con rescate, idempotencia y RBAC). Suite **1919/1923** — los 4 fallos son `wa-campaign-engine`, el flaky por hora/día ya conocido (#93/#110/#171), **verificado con `git stash` que falla igual en main limpio**.

192. **BUG 4 (mismo día, tras la pregunta "¿no hay nada más?") — el buffer de audio era UN SOLO SLOT** (`_pendingTranscribes`, app.js). `_stopCallRecordingAndBuffer` hacía `_discardPendingTranscription()` antes de guardar el audio nuevo: si el SDR volvía a discar ANTES de marcar el resultado de la llamada anterior (te cortan y redisás en el acto, o marcás las dos juntas), **el audio de la primera se tiraba**.
    - Medido en prod: de **40 pares** de llamadas al mismo lead a menos de 5 minutos, **10 tenían la primera con conversación (≥20s) y sin transcript** — incluidas de 212s, 219s y 224s. Explica varias de las que en #186 quedaron como "nunca se subió el audio".
    - **Fix**: cola FIFO con cap 3 (~2MB de audio en el peor caso). `_dropPendingTranscription(p)` saca UNA entrada (la consumida o la vencida); `_discardPendingTranscription()` vacía todo. El flush toma el más viejo de ESE lead (el SDR marca en el orden en que llamó). Cada entrada lleva su propio `callStartedAtIso` → el backend la pega a la llamada correcta con el fix #188: **los dos se complementan, sin el matching arreglado la cola pegaría los audios al entry equivocado**.
    - Verificado extrayendo las funciones REALES de app.js y ejercitando el escenario de Franci Zuñiga (10 asserts: FIFO, leads distintos que no se pisan, cap, limpieza del timer de 10 min).

193. **Lo que quedó SIN diagnosticar (honestidad sobre el alcance)**: (a) **22 de los 35 canales de cliente vacíos no tienen `asrDebug`** (los grabó una versión del front anterior a #157) — no son diagnosticables ni recuperables, solo cuentan como historia; (b) **canal del SDR vacío: 10 de 217** — de los 4 con asrDebug, 2 son loops que el fix #187 ahora colapsa y 1 es habla real perdida por el mismo filtro ("de las campañas de reactivación de la base de datos…", act 53%, nivel 0.48), y 1 es mic mudo (lvl 0.027, act 6% → cubierto por los fixes de micrófono #168/#177/#180); (c) 3 transcripts de 1-3 frases en llamadas de 60s+ sin causa clara.
    - **Dato que confirma que no era solo historia vieja**: los canales de cliente vacíos aparecen en TODAS las versiones del front, incluida la última (`20260815b`: 3 de 8 transcripts). El bug #187 estaba activo hasta el día del fix.
    - **Los 4 fixes se validan con llamadas NUEVAS**: el audio no se persiste, así que nada viejo se re-transcribe. La prueba real es la próxima tanda de llamadas — revisar en Entrenamiento IA que aparezca el lado del cliente y que el transcript esté en la llamada correcta.

## Sesión 2026-08-30 — Milestone v5.0 "El correo que abre la puerta" (Fases 39-41)

194. ⚠️ **DESACTUALIZADA — revertida el 2026-08-31 por `0f4d5ce`. Leer la #199 antes que esta.** Describe el estado en que el correo al prospecto salía por Gmail; hoy sale por **Resend** y Gmail quedó detrás de `MAIL_TRANSPORT=gmail`. Se conserva porque el helper `_sendGmailEmail` sigue en el código y todo lo que dice de él es correcto. **El correo al PROSPECTO sale por Gmail Workspace de vincca.co (SMTP), no por Resend** (Fase 39 / MAIL-SMTP, `index.js`). Se sumó `nodemailer` (primera librería de correo del proyecto; Resend seguía con `fetch` pelado). Helper nuevo `_sendGmailEmail({toEmail,subject,htmlBody,textBody})` al lado de `_sendPlaceholderEmail`, misma forma de retorno `{sent,reason}`: `smtp.gmail.com:465` TLS, `GMAIL_USER`/`GMAIL_APP_PASSWORD`, From = `GMAIL_FROM_NAME <GMAIL_USER>` (Google reescribe cualquier otro). Solo `send-material` (index.js ~13617) conmutó a Gmail; **Resend NO se tocó** — sigue en las invitaciones (index.js:1751), el reporte semanal (index.js:1977) y `send-placeholder`. El contrato del 409-con-`mailtoUrl` se preservó: si faltan las credenciales Gmail, mismo 409 con `resendUnavailable:true` que antes disparaba la falta de RESEND_API_KEY (el nombre de vía `'resend'` y el flag se conservan a propósito — es lo que el frontend ya conoce). MAIL-03: se manda text + html (parte text/plain = el cuerpo crudo antes de `_actEmailHtml`).

195. **Campo `lead.gatekeeperName` ("quién atendió")** (Fase 40 / MAIL-DATO). Default `''` en `ensureLeadDefaults` (al lado de `lead.doctor`). Poblado por tres vías: (a) webhook del agente de voz (index.js ~19910: además de la nota "Recepcionista: X", promueve a campo con política no-pisar); (b) modal de disposición "al colgar" → bloque puente en el modal de **callback** (index.html `#call-callback-modal` + `#call-cb-email`/`#call-cb-gatekeeper`, guardado best-effort vía `_saveBridgeFields` que pega a `alt-contact`, NO bloquea el callback); (c) edición a mano en el modal "Contacto secundario" (`_callsAltContact`) + `PUT /alt-contact` ahora acepta `gatekeeperName`. Se muestra en la ficha del lead ("Atendió: X"). NO se migran notas viejas (backfill no vale la pena). `alt-contact` es el único endpoint de persistencia — `call-disposition` NO se tocó (es compartido con el agente de voz).

196. **La plantilla del puente `presentacion_puente`** (Fase 41 / MAIL-COPY). Un solo template id de email: `ACT_EMAIL_TEMPLATE_IDS = new Set(['presentacion_puente'])` (index.js, aparte del de WhatsApp); `_actRegisterSendEvent` elige el Set según el canal antes de validar (antes un templateId de email se guardaba `''`). Frontend espeja `ACT_EMAIL_TEMPLATE_ID` con test de paridad. Es un correo de ÚNICA VEZ, no una secuencia. Copy cerrado con Nacho el 30/08 (`OneDrive/.../OUTPUTS/scm/2026-08-30-email-vincca-conexion-y-plantillas.md`, secciones 2 y 3): se pega tal cual.
    - **Armado por bloques condicionales** (`_buildBridgeEmail(lead, {horario1,horario2,firmante})` en app.js, bloque puro extraíble `BRIDGE-EMAIL-PURE`): con doctor → "Doctor X, buenos días", sin → "Buenos días"; con recepción → puente + nombre en el asunto, sin → "esta mañana" + asunto "Los pacientes que no volvieron"; con ciudad → "clínicas de {ciudad}", sin → "de la zona"; antigüedad (foundedYear explícito o derivado de yearsActive por resta exacta) solo si hay dato — nunca se estima. Los dos horarios los escribe el operador (campos obligatorios, se inyectan reemplazando `{{HORARIO_1}}`/`{{HORARIO_2}}`). Link calculadora = `vincca.co?p=<country>` (la calc ES la home; nada de b/a/t ni utm_).
    - **Membretado de marca Vincca** (`_brandedEmailHtml` en index.js, MAIL-08): tabla 600px, filete bronce `#A67C1B`, wordmark, cuerpo en `<p style="margin:0 0 16px 0;">`, firma "Ignacio Ana / Vincca / vincca.co", estilos inline, cero imágenes/botones/tracking (D-18). Reemplazó el div suelto de send-material. (El membretado de sección 2 NO incluye LinkedIn — se pegó tal cual; el doc lo menciona pero el HTML no lo trae.)
    - **Guarda dura** (`_hasUnresolvedPlaceholder`, MAIL-09): send-material devuelve 400 si el asunto o el cuerpo tienen `[ ] { }` sin resolver (último check antes de mandar, aplica a las dos vías). Red de seguridad gemela en el frontend antes del POST.
    - **Lint de marca** (`tests/bridge-email.test.js`): falla si aparecen `¿`/`¡` (signos de APERTURA — las preguntas con `?` de cierre SÍ se usan), guion largo `—`, IA/inteligencia artificial/automatizado/chatbot/WhatsApp/CRM, precio ($/€/USD/tarifa/fee — "desde" temporal es legítimo), utm_, "Vincca" en el párrafo de antigüedad (ahí va la clínica), o negritas.

197. **Envío por Gmail forzado a IPv4** (`_sendGmailEmail`, index.js): en redes sin ruta IPv6 saliente Node resuelve el SMTP de Gmail a una IPv6 y falla con ECONNREFUSED/ENOENT antes de intentar la IPv4 (que sí conecta). Se agregó `family: 4` al transport — IPv4 es la ruta estándar y estable para SMTP, seguro en cualquier host. Diagnosticado en la máquina de Nacho: `465 IPv4 → CONNECT ok`, `465 IPv6 → ENOENT`.

198. **Prueba de humo del correo del puente: OK** (2026-08-30). Gmail aceptó el envío (`250 2.0.0 OK`, `accepted:[ignacioana91@gmail.com]`, `messageId ...@vincca.co`) — el flujo real (armado por bloques + membretado Vincca + SMTP + parte text/plain) llega a la casilla.
    - ⚠️ **La máquina local de Nacho tiene un interceptor TLS** (antivirus/proxy) que reescribe el cert de Gmail con una CA que Node no reconoce, ni con `--use-system-ca`. La prueba local salió con un script one-shot y `NODE_TLS_REJECT_UNAUTHORIZED=0` (SOLO en ese comando, NUNCA en el código). **En Railway NO pasa** (CAs estándar, cert de Gmail válido) — el helper manda con TLS verificado normal. Si en local se necesita reprobar el envío real, es con ese workaround; el server de preview (`npm start`) NO puede mandar por el interceptor.
    - ⚠️ **`GMAIL_FROM_NAME` NO está en el `.env`** → el From salió `ignacio@vincca.co` a secas (sin el display name "Ignacio Ana"). El membretado igual firma "Ignacio Ana". Para que el remitente muestre el nombre, agregar `GMAIL_FROM_NAME=Ignacio Ana` al `.env`.
    - Como la prueba fue a la casilla PROPIA de Nacho, confirma formato/membretado/Enviados/hilo, pero **no del todo la entregabilidad Principal-vs-Promociones** (Gmail no filtra lo propio) — para eso, una casilla ajena.
    - **Suite 2356/2356 verde** (126 archivos). De paso se arregló un flaky de reloj preexistente en `tests/coverage-script.test.js` (excluía `hasta` de la comparación pero no `desde`, mismo timestamp − 7 días).
    - **NO se commiteó ni pusheó** (esperando OK). Cache-buster: `app.js v=20260830a` (+ index.html). `style.css` sin cambios. Antes de push: `npm run pre-deploy` y push a `main`.

## Sesión 2026-09-03 — Auditoría del dialer: las 4 fases ejecutadas

Informe base (49 agentes, solo lectura, verificación adversarial, 30 hallazgos):
`OneDrive/.../OUTPUTS/scm/2026-09-03-auditoria-total-dialer.md`. El plan de 4
fases del final quedó ejecutado completo salvo una decisión que necesita al
user (LIMP-06). Método en todos los fixes: **verificación por mutación** —
revertir el fix, confirmar que el test exacto se pone en rojo, restaurar.

199. **Fase A (DATA) — dejar de perder datos y secretos** (commit `4736bfe`):
    - **`PUT /alt-contact` borraba `lead.altPhone`** (el hallazgo que perdía datos HOY): `phone` y `label` se reasignaban SIEMPRE mientras `email` y `gatekeeperName` respetaban el merge, así que un body parcial —el que manda `_saveBridgeFields` al mandar el correo del puente o al guardar un callback— borraba en disco el número del encargado que pasó la recepción. Invisible hasta la próxima carga (el front solo aplica `{email, gatekeeperName}` al cache). Ahora `phone` omitido = no modificar; `phone: ''` = borrar explícito (el botón "Borrar" sigue andando).
    - **El dispatch de voz escribía los secrets de Retell a disco**: persistía el objeto de `loadRetellConfig()`, que overlaya `apiKey`/`webhookSecret`/`toolSecret` desde las env vars. Con las env puestas (el modo de producción que el propio código asume), **cada dispatch real escribía la API key en texto plano en `retell_config.json`** y de ahí se filtraba por `/api/admin/export-data`. Helper nuevo `_loadRetellConfigRaw()` (extraído del PUT, que ya lo hacía inline); el dispatch relee y escribe solo `rotationIdx` + `updatedAt`. El mismo fix cierra el borde del PUT concurrente revertido por el snapshot pre-pool.
    - **`GATE_TERMINAL_ESTADOS` en las dos vías que se lo salteaban**: tildar un follow-up (era la única de las siete vías que escriben `nextAction` sin el gate, T-30-02) y el poll de callbacks vencidos (usaba la lista literal de dos estados, vieja desde que se agregó `'cerrado'` → el toast sonaba para una venta cerrada).
    - 16 tests. **`tests/alt-contact-email.test.js` ya hacía ese mismo PUT parcial y no miraba `altPhone`: la suite pasaba verde con el bug adentro.**

200. **Fase B (CONF) — que la configuración diga la verdad** (commit `e09acd2`):
    - **`NODE_ENV=production` SÍ está seteada en Railway** (dato que faltaba: de ella cuelgan 7 guards). El CLI de Railway no está instalado, así que se determinó por **sonda de solo lectura sobre el CORS de Socket.IO** (`src/wa/gateway.js`): sus tres ramas dan firmas de header distintas, verificadas levantando el server local en los tres modos. Producción devuelve `Vary: Origin` + `Allow-Credentials` **sin ACAO** para cualquier origen — firma que solo existe dentro de la rama de production. **Efecto lateral encontrado: `WA_CORS_ORIGINS` está seteada pero NO matchea el propio origen de la app** (contra la nota #43). Inofensivo hoy (módulo WA parkeado); si se reactiva, arreglarla.
    - **El health mentía**: reportaba `NODE_ENV || 'production'`, o sea decía "production" justo cuando la variable estaba vacía. Ahora reporta el valor crudo (`'(sin setear)'` es un estado real) + `prodGuardsActive`, y **el boot loguea una línea con el estado en cada deploy**.
    - **`PLACEHOLDER_FROM_EMAIL` es obligatoria**: sin ella el correo al prospecto se intentaba desde el sandbox de Resend, que el proveedor rechaza para escribirle a un tercero → 502 sin motivo, y la variable no estaba documentada en ningún lado. Ahora `_sendPlaceholderEmail` se niega a mandar sin From y `send-material` cae al 409-mailto que ya existía.
    - **`.env.example` + `npm run lint:env` en el CI** (antes de los tests). El lint falla si el código lee una variable no declarada; entiende las lecturas indirectas de los mapas `*_ENV_FIELDS` (Telnyx/Retell) que un grep de `process.env.X` no ve. **Es el que mata la clase entera de hallazgos de config**: 47 variables declaradas, 13 estaban sin documentar.
    - Reescrito el bloque de env de este archivo al estado post-`0f4d5ce`. La entrada #194 quedó **marcada como revertida**, no borrada.

201. **Fase C (OBS) — errores visibles y transcripts cerrados** (commit `e09acd2`):
    - **Había DOS error handlers globales y el que loguea no corría nunca.** El primero respondía 500 sin llamar `next(err)`, así que para las ~237 rutas previas ganaba siempre; y estaba **antes de `mountWa`**, así que los ~56 endpoints de `/api/wa/*` no caían en ninguno y respondían HTML de finalhandler (13 de sus 18 rutas async no tienen try/catch). Consecuencia: `logError` es el único que escribe `ERROR_LOG`, así que **`/api/admin/errors/recent` y `checks.errors` del health decían 0 por construcción, no por estar sanos**. Ahora hay uno solo, registrado DESPUÉS de `mountWa` (que llama a `registerWaRoutes` de forma síncrona antes de su primer await, por eso alcanza con la línea siguiente).
    - ⚠️ **REGLA NUEVA: nada de `app.use` / `app.get` / `mountX(app)` después de `registerGlobalErrorHandler()` al final de `index.js`.** `tests/error-handler-order.test.js` rompe el CI si alguien apendea una ruta ahí — es el modo de fallo que vuelve solo.
    - El **transcript** (`/api/telnyx/calls/:leadId/:callIdx/transcript`) aplica `_visibleSetterIds` como sus dos hermanos. Era la única vía que devolvía el transcript **sin anonimizar** y sin scoping de supervisor.
    - **7 tests que ejecutan la vía REAL de `send-material`** con `fetch` stubeado (patrón de `weekly-report`), reemplazando 4 greps de fuente. Quedaban sin ejecutar: selección de transporte, `_brandedEmailHtml`, el `textBody`, el `fromOverride`, `_sendPlaceholderEmail` entero y la rama 502 — el camino que se revirtió dos veces en cuatro días.
    - El toast del timeout de 20s ya no dice que el envío "se canceló": **el abort corta la lectura, no el request**, y reintentar a ciegas le manda el correo dos veces al mismo doctor.
    - El destino del registro se trunca por canal (254 email / 40 WhatsApp): una dirección de 47 chars se guardaba mutilada.

202. **Fase D (LIMP) — números coherentes y borrar lo muerto** (cache-buster `app.js v=20260903a`):
    - **`renderCallsStats` divergía en TRES cosas a la vez** y ahora consume el CALL METRICS CORE como el Power Dialer y Hoy: cortaba el día con la **medianoche UTC del navegador** (verificado en vivo a las 22:17 de AR: la UI mostraba 2 llamadas y 50% atendidas contra el canon, y el cálculo viejo habría mostrado **0 y 0%** porque el día UTC ya era mañana), contaba sobre la población filtrada por país, y "atendida" eran 3 outcomes cuando el canon son 5. Los otros tres KPIs (agendados / por llamar / muertos) SÍ son del listado y siguen respetando el país.
    - **`_localDayKey(date)`** (`window._localDayKey`): clave `YYYY-MM-DD` del día LOCAL. La agenda de callbacks comparaba un `todayKey` **UTC** contra claves de grupo **locales** — después de las 21:00 en AR, un callback de mañana se etiquetaba "Hoy". **Usar siempre este helper para comparar días en el frontend; nunca `toISOString()`.**
    - **`ACT_EMAIL_FIRMANTE`**: el cuerpo del correo decía "Soy {SDR logueado}" y el membretado firma "Ignacio Ana" sin condición — el mismo mail se contradecía. El From (`PLACEHOLDER_FROM_EMAIL`), el WhatsApp y el LinkedIn de la firma ya son de Ignacio: el correo era suyo por los tres lados que el prospecto ve, el único que decía otra cosa era el saludo. Test de paridad en `bridge-email`.
    - Cableados `_stopCallbackDuePolling` (existía y nadie lo llamaba) y `_stopSpeedToLeadPolling` (no existía) en el logout: los dos `setInterval` seguían pegándole a la API con la sesión muerta.
    - Borrados: la constante `SCRAPE_BATCHES_FILE` (huérfana y **engañosa** — decía `./data` cuando en producción el archivo está en el volumen), `_discardPendingTranscription` (sin llamadores desde que el buffer pasó a cola FIFO) y el `<select id="apify-actor-type">` (ningún js lo leía; el backend decide el modo por el prefijo del texto, así que elegir "Hashtag" no hacía nada).
    - ⚠️ **Corrección al informe**: `build_xlsx.js` NO había que borrarlo del repo — ya estaba destrackeado en `cc6d3c5` y está en `.gitignore`. Queda como archivo local suelto.
    - **PENDIENTE — LIMP-06, necesita decisión del user**: (a) si el módulo de variantes/variables vuelve o se va (`public/app.js` pide, ordena y filtra `filteredVariants` para tirar el HTML resultante: los 11 ids no existen en `index.html`), y (b) cuáles de los 8 endpoints admin sin caller en el frontend se usan a mano por curl. Sin esas dos respuestas no se borra nada de ahí.

204. **LIMP-06 resuelto — la premisa del informe era falsa** (cache-buster `app.js v=20260903b`). El hallazgo decía "los 11 ids del módulo de variantes no existen en `index.html`" y lo marcaba como decisión de producto. Verificados uno por uno: **la mayoría SÍ existen**. Eran dos cosas distintas mezcladas:
    - **El módulo de variantes de Setteo (`view-crm`) está PARKEADO, no muerto**: `setter-select`, `variable-select`, `variants-modal`, `setter-leads-body`, `lead-modal` y compañía están en el HTML. Borrar ese JS rompería el módulo el día que se desparkee. **No se tocó.**
    - **El editor de variables y la tabla "Rendimiento por Variante" del Centro de Comando SÍ estaban muertos, y la decisión de producto ya estaba tomada**: esas dos secciones se sacaron del HTML en la consolidación del panel (nota #87). Lo que quedó fue el JS huérfano: 8 `getElementById` que devuelven null, 4 `?.addEventListener` que nunca enganchan (incluido el que POSTea a `/api/setters/variants` — el botón no existe) y **~148 líneas que en CADA carga del panel del admin poblaban un filtro, filtraban, ordenaban y armaban el HTML de las variantes para tirarlo entero**. Borradas ~190 líneas. Verificado en el preview: Comando renderiza completo (stats 6413/62/3, tabla por SDR, usuarios, reporte diario, calidad de audio, base de scrapeados) y las otras 6 vistas también, consola limpia.
    - **Los 8 endpoints admin sin caller en el frontend NO se tocan** — decisión, no pendiente. "Sin caller en el frontend" no prueba "sin uso" en un sistema de un operador: este repo ya expone `/api/admin/errors/recent` sin UI y se consulta a mano. Un endpoint admin que sobra no cuesta nada; borrar uno que el dueño usa por curl le rompe el flujo en silencio. Por eso el backend sigue devolviendo `data.perVariant` aunque ya nadie lo pinte.
    - **Lección de método, la tercera de esta auditoría**: los hallazgos de severidad baja no pasaron por refutador y este llegaba con la evidencia invertida. Verificar id por id antes de borrar; "no existe en el HTML" y "está parkeado" se parecen mucho en un grep y son opuestos.

203. **Cache-buster actual: `app.js v=20260903b`** (reemplaza #123/#133/#158). `style.css` en `v=20260822a` (no se tocó), `wa.js` en `v=20260815c`. **Suite completa 2393/2393 (127 archivos).**

## Sesión 2026-09-04 — Fase A-bis (EXPORT): abrir las llamadas al proyecto de ventas

Pedido: `C:\Proyectos\vincca-ventas` analiza las llamadas de este sistema y hoy
las lee de `data/setters.json` **del disco**, por eso trabaja siempre con datos
congelados al último `pre-deploy` (lo dice su propio informe de las 199
llamadas: *"el archivo local está congelado al 17/08 16:34"*). Se le abren dos
puertas por API. Las fases A, B, C y D de la auditoría ya estaban hechas
(#199-204); esto es agregado.

205. **EXPORT-01 — paginación de `GET /api/telnyx/calls/recent`**. El endpoint
     devolvía `calls.slice(0, limit)` con el limit capado en 500 y `total`
     completo: el cliente podía **detectar** que había más (`total >
     calls.length`) pero no **llegar** a ellas. Ahora acepta `offset` y devuelve
     `{offset, limit, hasMore, nextOffset}` — `nextOffset` es null cuando se
     acabó, así el cliente hace `while (nextOffset !== null)` sin calcular nada.
     - **El tope de 500 por página SE QUEDA**, a propósito y contra la opción
       `all=1` que ofrecía el informe: devolver la base entera en un solo JSON es
       cómo se tumba el container cuando el callLog crezca. La paginación está
       acotada por construcción; `all=1` no.
     - `total` sigue siendo el total FILTRADO (no el de la página) — es el
       contrato que ya existía y no se tocó.
     - **Medido en el preview con datos de producción: `total` 1005, el código
       viejo alcanzaba 500 → 505 llamadas eran inalcanzables.** Con offset se
       recorren las 1005 en 3 páginas, sin repetidas.
     - `tests/calls-export.test.js` (10) — el endpoint **no tenía ningún test**.

206. **EXPORT-02 — `?raw=1` en el detalle de la biblioteca**. ⚠️ **La premisa del
     informe estaba invertida y hay que saberlo antes de tocar esto**: decía que
     `GET /api/telnyx/calls/:leadId/:callIdx/transcript` anonimiza siempre
     (citando `index.js:21167`). **No anonimiza** — devuelve `call.transcript`
     crudo, y siempre lo hizo. La línea 21167 pertenece a OTRO endpoint,
     `GET /api/training/calls/:leadId/:callIdx`, que es el de la biblioteca de
     Entrenamiento IA y sí llama a `_anonymizeForTraining`.
     - Por eso el flag se agregó **donde vive la anonimización** (el de
       training), que además es el único que devuelve los turnos fusionados
       (`_mergeTranscriptTurns`) y el resumen IA — la forma útil para analizar.
       El de Telnyx ya daba nombres: no necesitaba flag.
     - Tres candados: **(1)** solo admin y por el rol **REAL**
       (`req.auth.user.role`), no el efectivo — con "Ver como SDR" el rol
       efectivo es `setter` y el dueño perdería su propio export; **(2)** opt-in
       puro, sin el flag no cambia NADA (la biblioteca sigue anonimizada para
       todos, admin incluido — esa capa existe para que los vendedores nuevos no
       vean datos de clientes); **(3) NO ESCRIBE NADA**.
     - **El candado (3) es el que importa y casi se me escapa**: el resumen
       cacheado (`trainingSummary`) se generó del texto ANONIMIZADO. Si la rama
       `raw` lo regenerara desde el crudo, escribiría nombres de clientes en el
       `callLog` y **todos los vendedores los verían en la biblioteca, para
       siempre**. Con `raw=1` se devuelve el resumen tal como está cacheado y se
       sale antes del `mutateSettersData`.
     - Devuelve además `lead {id, name, phone, doctor, gatekeeperName, city,
       country}` para cruzar la llamada con el prospecto.
     - Verificado con datos reales en el preview: anonimizado *"si es con
       [nombre]"* / crudo *"si es con jennifer"*, mismos 13 turnos, mismo
       resumen. Setter real: 200 sin el flag, **403 con el flag**.
     - 7 tests nuevos en `tests/training-privacy.test.js`.

207. **Lección de método — un test que pasa no prueba nada hasta que lo rompés a
     propósito.** El test de "raw=1 no escribe nada" comparaba el `trainingSummary`
     **antes y después de su propia llamada**. Al simular la contaminación (que la
     rama raw escriba), **el test pasó igual**: los tests de arriba del mismo
     archivo ya habían pegado con `raw=1`, así que "antes" ya venía contaminado y
     el before/after daba idéntico. Se reescribió anclando al **valor literal de
     la semilla del fixture**, y ahí sí la mutación cae. Las otras tres mutaciones
     (offset ignorado, chequeo de admin removido, raw anonimizando igual)
     cayeron a la primera.
     - ⚠️ Cuidado adicional para tests del anonimizador: reemplaza las palabras
       del **nombre del lead ANTES** de correr el regex de email, así que
       `contacto@sonrisa.test` en un lead llamado "Sonrisa Perfecta" queda
       `contacto@[nombre].test` y **nunca llega a marcarse `[email]`**. El dato
       igual queda tapado; pero un fixture que quiera ver `[email]` necesita un
       dominio que no colisione con el nombre.

208. **Suite completa 2410/2410 (128 archivos), `lint:env` verde.** Sin cambios
     en `public/` → el cache-buster sigue en `app.js v=20260903b`.

## Milestone v6.0 "Operador solo" — Fase B (2026-09-05)

El dialer se diseñó para un equipo supervisado y hoy lo usa una sola persona que
es admin y vendedor a la vez. Varias defensas del modo equipo son fricción sin
beneficio. **Regla dura del milestone: no se borra código** — lo que sobra se apaga
por config. Estado y evidencia completos en `.planning/STATE.md`.

209. **Lo que la verificación contra producción cambió antes de tocar nada**
     (6413 leads del volumen de Railway, nunca `data/setters.json` del repo):
     - **Los topes de reintento NO se tocan.** Con el criterio pedido (activos,
       3+ llamadas, resultados solo `no_answer`/`voicemail`/`hung_up`) hay **1
       lead en 6413**. El mecanismo de alternancia existe, pero un tope único
       hoy afectaría a un lead. Ojo además: el tope de cortes cuenta el total
       **por vendedora** desde 2026-08-16, no el total absoluto (nota #171).
       **El repetido real es la acumulación de `callback_later`**, que no tiene
       tope ni debería tenerlo automático (son compromisos del operador): 12
       leads activos con 2, 3 con 3 y 1 con 4. Se resuelve mostrándolo en la
       tarjeta, no descartando.
     - **El historial antes de discar YA existe** (`_leadHistoryHTML` /
       `_leadHistoryBrief`, plan 33-04, con bloque puro y test): pinta "Ya
       trabajado · N intentos previos" con último resultado, cuándo, quién y la
       última nota, debajo del header y arriba del botón Llamar. Falta solo el
       desglose por resultado.
     - **El Power Dialer NO avanza solo al colgar sin resultado**:
       `_onTelnyxCallEnded` nunca llama `_pdAdvance` y el autopiloto tiene guard
       `if (_dispoGate) return`.
     - **"Ir a marcar" del cartel se porta distinto según de dónde se abrió el
       dialer**: desde **Hoy** salta a Llamadas, el delegate del sidebar dispara
       `_pdExit()` y la cola se pierde ("sesión cerrada"); desde **Llamadas** no
       navega (la vista ya es la visible) y **no pasa nada visible** — el foco va
       a un `<select>` que está detrás del overlay. El salto AUTOMÁTICO al colgar
       ya estaba bloqueado con el dialer abierto (nota #181): esto es otro camino.
     - **Ninguna actualización del servidor repinta la tarjeta**: los dos polls
       (speed-to-lead 15s, callbacks 90s) solo muestran toasts y
       `_refreshLeadPanels` repinta la lista, no el dialer.
     - **Contexto que importa**: hay 3 setters porque `setter_agente_ia` es uno.
       "Operador solo" no es literal — **la atribución por setter se queda**, es
       lo que separa las llamadas humanas de las del agente.

210. **Fase B — el re-render del Power Dialer ya no pisa lo que se está
     escribiendo** (`v=20260905a`, solo `public/app.js` + cache-buster).
     `_pdRender` reescribe el `innerHTML` ENTERO de `#pd-current-content`, y ahí
     adentro vive `#pd-call-note`. Cualquiera de sus ~11 llamadores (guardar
     "quién atendió" o el teléfono del encargado, el Instagram del doctor, marcar
     un follow-up hecho, generar el brief IA) borraba la nota a medio tipear y
     mandaba el foco a `<body>` **sin ningún aviso**: el SDR marcaba el resultado
     después y la nota se iba vacía.
     - Helpers nuevos `_pdSnapshotInputs` / `_pdRestoreInputs` con dos reglas que
       hacen que preservar no pueda romper nada: **(1)** solo restaura sobre la
       MISMA tarjeta (`main.dataset.pdLeadId === lead.id`) — el borrador no viaja
       al lead siguiente; **(2)** solo restaura si el template dejó el campo
       VACÍO — si el render escribió algo, gana el render.
     - **Corolario de (2) que hay que preservar**: las dos vías de disposición
       hacen `pdNoteEl.value = ''` ANTES de re-renderizar, así que una nota ya
       consumida no se resucita ni se reenvía pegada a la disposición siguiente.
       Hay un test que fija esos dos `value = ''`: **si alguien los saca, el fix
       de preservación pasa de inocuo a peligroso.**
     - ⚠️ **Lección de método, otra vez la #207**: la primera verificación en el
       navegador dio "nota preservada" y **no probaba nada** — el re-render no
       había corrido todavía (la escritura al `setters.json` de 27MB tarda, y con
       el pane oculto Chrome throttlea los timers). Se rehizo con un **centinela**
       dentro del contenedor: si el nodo sobrevive, el `innerHTML` no se
       reescribió y la prueba es falsa. Con el control puesto: sin el fix → texto
       `""`, foco `BODY`, cursor `0`; con el fix → texto intacto, foco en
       `pd-call-note`, cursor en 11. **Para cualquier verificación futura de un
       re-render: poner el centinela primero.**
     - `tests/pd-preserve-draft.test.js` (15), molde de bloque puro de
       `dial-history` (las funciones se extraen por el literal de su declaración
       y se evalúan con un `document`/`CSS` inyectados). Las 3 mutaciones (sacar
       el fix, romper la regla 1, romper la regla 2) tumban exactamente el test
       que corresponde. **Suite completa 2425/2425 (129 archivos).**

211. **Cache-buster actual: `app.js v=20260905a`** (reemplaza #203). `style.css`
     en `v=20260822a`, `wa.js` en `v=20260815c`.

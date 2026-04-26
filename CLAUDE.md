# SCM Dental Setting App - Instrucciones para IA

> Última actualización: 2026-04-25 — Documento mantenido para que cualquier IA o dev que entre al proyecto entienda el estado actual sin tener que reconstruirlo leyendo commits.

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
4. `git push origin main && git push origin main:master` (Railway escucha `master`, mantenemos las dos en sync)
5. Railway redeploya automaticamente

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
- `view-calls` - Llamadas (Sin WSP)
- `view-faqs` - **Banco de Respuestas** con sugerencias IA (few-shot RAG con Mercury → Qwen fallback)
- `view-training` - **Centro de Entrenamiento** con dos secciones:
  - Onboarding oficial (8 cards hardcoded, leen de `/api/onboarding/modules`)
  - Material adicional (uploads, persiste en `training.json`)
- `view-wa-mywhats` - Mis WhatsApps (vista del setter del módulo WA)

### Administración
- `view-command` - Centro de Comando (admin, dashboards y métricas globales)
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
- `wa.test.js` - 50 tests del módulo WA (auth, RBAC, accounts, routines, commands, stats)
- `onboarding.test.js` - 16 tests del onboarding (metadata, wrapper, inyección quiz, presencia online)
- `phone-normalization.smoke.test.js` - smoke de normalización de teléfonos
- Setup pattern: `process.env.DATA_DIR = tmpdir`, pre-popular `auth.json` ANTES de `import("../index.js")`

Comandos:
- `npm test` - corre todo (66 tests)
- `npm run test:watch` - watch mode
- `npm run smoke:wa` - smoke real contra el server local

### Scripts (`scripts/`)
- `pre-deploy.js` - descarga data de Railway antes de push
- `smoke-wa.mjs` - smoke test del módulo WA
- `normalize-stored-whatsapp-urls.mjs` - one-shot de normalización
- `replace-hex.mjs` - one-shot de cambio de paleta

### Deploy
- `Procfile` - `web: node index.js`
- `nixpacks.toml` - Config de Railway (Node 20)

### Cache-busting
- `index.html` tiene `<script src="/app.js?v=YYYYMMDD[x]">` y `<link href="/style.css?v=YYYYMMDD[x]">`
- Al cambiar app.js o style.css, **siempre** actualizar el cache-buster
- `express.static` tiene `maxAge: 0, etag: false`

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

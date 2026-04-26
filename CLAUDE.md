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
- `public/onboarding/quiz.js` — quiz autocontenido (~290 líneas) que se inyecta al final de cada módulo
- `public/onboarding/quiz-data.json` — 40 preguntas (8 módulos × 5), formato `{ moduloN: { titulo, preguntas: [{ pregunta, opciones[3], correcta, explicacion }] } }`. Aprueba con ≥4/5.

### Rutas backend (`index.js`)
- `GET /api/onboarding/modules` - metadata de los 8 (público)
- `GET /onboarding/N` (N=1..8) - **wrapper page** con topbar + iframe del módulo (público)
- `GET /onboarding/files/scm-onboarding-moduloN.html` - middleware que **inyecta `<div id="scm-quiz-root">` y `<script src="/onboarding/quiz.js">`** antes de `</body>` al servir el HTML. El archivo en disco queda intacto.
- `loadOnboardingText()` corre al boot, extrae texto plano de los 8 HTMLs y lo cachea en memoria. Se inyecta en el prompt de `/api/faqs/suggest` como bloque `ONBOARDING OFICIAL DEL EQUIPO SCM` (1500 chars por módulo).

### localStorage del onboarding (cliente)
- `scm_onboarding_progress` - `{"1": true, "3": true, ...}` - solo se setea cuando el quiz aprueba
- `scm_onboarding_quiz_attempts` - `{"modulo1": {"intentos": 2, "aprobado": true, "ultimo_score": 5}}`

### Flujo: setter abre `/onboarding/4` → ve módulo en iframe → al final aparece quiz inyectado → si aprueba (≥4/5) se marca `progress[4]=true` + postMessage al wrapper actualiza el pill del topbar a "Quiz aprobado"

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
9. **`leads` en setters.json es un MAP**, no un array (normalizado 2026-04-25)
10. **Los 8 HTMLs del onboarding NO se editan via tooling** — para actualizar contenido reemplazar el archivo completo. La inyección del quiz es server-side.
11. **Auth dual**: cookie session (`gs_session`) para el navegador, JWT Bearer para WA/desktop. NO mezclar.
12. **Tests**: si agregás endpoints, sumá tests en `tests/`. El patrón de setup está en `wa.test.js` y `onboarding.test.js`.
13. **Trabajo en paralelo**: si hay otra IA editando código, evitá tocar `style.css`, `src/wa/*`, `public/wa.js`, archivos del onboarding y `setters.json`. Zonas seguras: docs, gitignore, tests nuevos, frontend en zonas distintas.
14. **`Scapper.txt`** está en `.gitignore` — contiene credenciales/notas personales, NUNCA commitearlo.

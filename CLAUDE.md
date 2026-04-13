# SCM Dental Setting App - Instrucciones para IA

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
4. `git push origin main` (Railway watches master, push to both: `git push origin main && git push origin main:master`)
5. Railway redeploya automaticamente

### Variables de entorno necesarias en Railway:
- `ADMIN_PASSWORD` - Contrasena del admin (NO "ADMIN_INITIAL_PASSWORD")
- `API_KEY` - SerpAPI key
- `QWEN_API_KEY` - OpenRouter API key para IA
- `APIFY_TOKEN` - Token de Apify para Instagram Scraper

## Estructura de datos
- `data/history.json` - Historial de todos los leads scrapeados (se usa para evitar duplicados en scraping)
- `data/auth.json` - Usuarios, sesiones e invitaciones
- `data/setters.json` - Leads asignados a setters, variantes, sesiones de setteo

## Stack
- Node.js + Express 5 (ESM modules)
- JSON file persistence (no database) - Railway Volume montado en /data
- SerpAPI para Google Maps scraping
- Apify para Instagram (actor: apify/instagram-scraper, usa directUrls + searchLimit)
- OpenRouter (Qwen) para enriquecimiento con IA

## Arquitectura del sistema

### Persistencia
- Railway Volume montado en `/data` para persistir JSON entre deploys
- `seedVolumeFromRepo()` copia data del repo al volumen en primer boot
- `DATA_DIR` detecta automaticamente: `/data` (Railway) o `./data` (local)

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
Todos, Sin contactar, WSP Enviado, Respondieron, Calificados, Interesados, Agendados, En seguimiento (leads con follow-ups tildados), Sin WSP, Descartados

### Buscador universal
Input de busqueda que filtra por nombre, telefono, pais, ciudad, direccion, doctor, email, website, instagram

### Paginacion
50 leads por pagina en la tabla de setters

## Archivos principales

### Backend
- `index.js` - Servidor Express, todos los endpoints API, logica de negocio
  - IMPORTANTE: rutas sin `:id` (como `/sin-wsp`) DEBEN ir ANTES de rutas con `:id`
  - `ensureLeadDefaults()` - inicializa campos de lead (incluye calificado=false)
  - Cascade logic en PATCH `/api/setters/leads/:id`

### Frontend
- `public/index.html` - HTML completo, todas las vistas
- `public/app.js` - Toda la logica frontend (vanilla JS, ES modules)
- `public/style.css` - Estilos (tema oscuro)
- `public/locations.js` - Datos de paises/ciudades para scraping

### Deploy
- `Procfile` - `web: node index.js`
- `nixpacks.toml` - Config de Railway (Node 20)
- `scripts/pre-deploy.js` - Descarga data de Railway antes de push

### Cache-busting
- El script tag en index.html tiene query param `?v=YYYYMMDD[x]`
- Al cambiar app.js, SIEMPRE actualizar el cache-buster
- express.static tiene `maxAge: 0, etag: false`

## Notas para otra IA que continue

1. **Siempre pushear a ambas ramas:** `git push origin main && git push origin main:master`
2. **Siempre actualizar cache-buster** en index.html al cambiar app.js
3. **Nunca poner rutas con :id antes de rutas estaticas** en Express
4. **El campo `calificado`** es boolean (true/false), inicializar siempre como false
5. **Los stats** usan `l.calificado === true`, no interaction-based logic
6. **Import CSV** no chequea history.json (intencionalmente)
7. **Scraping** si chequea history.json (estricto, no duplicar)
8. **express.json limit** esta en 50mb para imports grandes

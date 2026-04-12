# SCM Dental Setting App - Instrucciones para IA

## REGLA CRÍTICA DE DEPLOY

**ANTES de hacer `git push` o cualquier deploy, SIEMPRE correr:**

```bash
npm run pre-deploy
```

Este comando descarga la data actual del servidor Railway (historial de scraping, usuarios, setters) y la guarda en `data/`. Si no se hace esto, se pierden todos los leads scrapeados desde el último deploy.

### Flujo correcto de deploy:
1. Hacer los cambios al código
2. Correr `npm run pre-deploy` (pide URL de Railway, email y password de admin)
3. Commitear TODO (código + archivos de `data/`)
4. `git push origin main`
5. Railway redeploya automáticamente

### Variables de entorno necesarias en Railway:
- `ADMIN_PASSWORD` - Contraseña del admin (NO "ADMIN_INITIAL_PASSWORD")
- `API_KEY` - SerpAPI key
- `QWEN_API_KEY` - OpenRouter API key para IA
- `APIFY_TOKEN` - Token de Apify para Instagram Scraper

## Estructura de datos
- `data/history.json` - Historial de todos los leads scrapeados (se usa para evitar duplicados)
- `data/auth.json` - Usuarios, sesiones e invitaciones
- `data/setters.json` - Leads asignados a setters, variantes, sesiones de setteo

## Stack
- Node.js + Express 5 (ESM modules)
- JSON file persistence (no database)
- SerpAPI para Google Maps
- Apify para Instagram (actor: apify/instagram-scraper, usa directUrls + searchLimit)
- OpenRouter (Qwen) para enriquecimiento con IA

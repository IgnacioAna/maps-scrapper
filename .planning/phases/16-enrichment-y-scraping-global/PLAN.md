# Phase 16 — Enrichment de leads + Scraping global (multi-país)

> Creada 2026-06-17. **SUMA al roadmap existente (Phases 10-15), no lo reemplaza.** Unifica la research de los 3 agentes (ver `.planning/research/2026-06-17-*.md`) en trabajo ejecutable. Objetivo del dueño: terminado hoy para testear mañana. Prioridad: (1) scraper multi-país funcionando, (2) que TODOS los leads actuales pasen por la barrida de enriquecimiento/señales.

## Relación con el roadmap previo (NO opacar)
- **Phase 10 (Lead-quality enrichment)**: esta fase ejecuta su núcleo (signals/brief derivados + enrichment por API gratis: NPI/CNPJ/web).
- **Phase 11 (Battlecards)**: el `openingAngle` + `signals[]` alimentan los battlecards situacionales que ya existen (call_scripts.json).
- **Phase 12 (SDR Operating System)**: el brief es input del flujo del SDR.
- **Phases 13-15 (UI / pool / purga)**: ya deployadas. Esta fase agrega chips de señales en la card de Llamadas/Power Dialer (UI ya consolidada).

## Olas de build (cada una: implementar → test vitest → preview → deploy)

### Ola A — Lead Signals / Brief + barrida sobre leads existentes  ⭐ prioridad
- `computeLeadSignals(lead)` en index.js (pura derivación, sin APIs): ratingNum, hasWebsite, reputationTier, signals[], openingAngle. Patrón = computeWspProbability.
- Campos nuevos en `ensureLeadDefaults`: ratingNum, hasWebsite, category, signals, reputationTier, openingAngle, signalsAt (lazy).
- `POST /api/admin/backfill-signals` (dryRun + backup + idempotente) → la BARRIDA sobre TODOS los leads. **Ejecutar en prod.**
- Recompute en enrich-from-maps + manual-add.
- Frontend: chips de señales + ángulo en la card del Power Dialer / Llamadas.
- Tests: tests/lead-signals.test.js.

### Ola B — Scraper multi-país (USA/Canadá/Europa/Brasil)
- `COUNTRY_LOCALE` + `localeForCountry()` (país→{hl,gl,google_domain}); default LatAm es.
- Localizar `searchLocation`: usar `location` (texto) + hl/gl/google_domain; `q` sin "en"+país. Plan B: `q = "${query}, ${location}"` (coma neutra) si location da problemas.
- `SECTOR_ROOTS` multiidioma en los 2 filtros de relevancia + corte temprano (no descartar resultados EN/DE/PT/IT/FR legítimos).
- Localizar enrich-from-maps igual.
- locations.js: agregar Canadá, Reino Unido, Alemania, Francia, Italia + ampliar Brasil.
- Frontend: sugerencia de keywords por país (mapa simple).
- Tests: tests/scrape-i18n.test.js (funciones puras: localeForCountry + relevancia multiidioma; NO pegar a SerpAPI).

### Ola C — Enrichment por API gratis (stretch, si da el tiempo)
- USA: NPI Registry (NPPES) → ownerName + specialty. Match por dirección/tel.
- Brasil: CNPJ (BrasilAPI) → razón social + socios.
- Web scrape del sitio del lead → email + nombre del dueño.
- Integrado al backfill/enrich. Opt-in, con timeouts y fallback.
- Tests donde aplique (helpers puros; las llamadas externas mockeadas o skip).

## Reglas operativas (del CLAUDE.md)
- pre-deploy ANTES de cada push; push a main + main:master.
- Bump cache-buster si se toca app.js/style.css.
- Mutex (mutateSettersData) en handlers async que cargan+guardan.
- Backfill: siempre dryRun + backup + idempotente.
- Caller ID rutea por prefijo del tel, NO por country → ampliar países no lo afecta.

## Incertidumbres heredadas (de la research — verificar al construir)
- `location` texto en SerpApi type=search: piloto antes de migrar todo.
- NPI/CNPJ matching clínica↔registro puede ser frágil → reportar tasa de match.
- GDPR Europa: priorizar contacto del negocio, no del doctor.

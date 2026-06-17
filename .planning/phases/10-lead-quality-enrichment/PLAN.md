# Phase 10 — Motor de Calidad y Enriquecimiento de Leads

> Objetivo: que CADA lead del sistema quede de calidad extrema, con el "arsenal
> completo" para que un vendedor nuevo haga la llamada lo más personalizada
> posible. Construido para que esté 100% operativo ANTES de sumar vendedores.
>
> Basado en una auditoría de 5 agentes (2026-06-17): mapeo del pipeline de código,
> investigación web de best-practices, análisis cuantitativo de los 5178 leads,
> research de LinkedIn como fuente, y research del arsenal de personalización para
> cold call de clínicas dentales/estéticas.

---

## Hallazgos que fundamentan el plan (medidos, no supuestos)

**Base sólida:** 5178 leads, 100% con teléfono, 99.8% E.164 válido, **0 duplicados**, emails 100% válidos. El problema NO es limpieza.

**Gaps reales (con números):**
- 26% (1355) sin país → **100% recuperable del prefijo del teléfono**. Afecta el caller ID de Telnyx (rutea por país) → connect rate.
- 578 "websites" no son webs (533 redes mal clasificadas + 45 links wa.me).
- SerpAPI ya devuelve coords/place_id/horarios/business_status/reviews y **se descartan** en el scrape.
- El scrape de Instagram (Apify) corre pero **no persiste nada** (bio/tel/dueño se tiran).
- IA de enrich es **manual**, **solo-website** (47% sin web no se enriquece), y **no persiste confidence**. `enrichmentStatus` siempre "none".
- 67% sin decisor identificable localmente (el "Dr./Dra. del nombre" aporta solo +56 netos: la IA ya corre ese regex).
- De las pocas llamadas hechas, **38% dieron invalid_number** pese a formato válido → falta validar línea viva.
- Campos muertos: `decisor` (guarda "SI/NO"), `ownerInstagram/Linkedin/Facebook`, `enrichmentStatus`, `apertura`, `lastStage`.

**Veredictos de research:**
- **LinkedIn:** NO para LatAm/España (dueños locales no están / perfil vacío / sin teléfono / riesgo legal — Proxycurl cerró por demanda 2025). SÍ selectivo para US/Canadá vía Apify/Bright Data no-cookie (~$0.005-0.01/lead), geo-gated, nunca cuenta propia.
- **Arsenal:** 80% sale gratis de fuentes que ya tenemos. Mayor palanca: **minería de Google reviews → dolores + hook + fit_score** (SerpAPI ya las trae). Llamadas con research previo = +202% conversión; 76% de top performers siempre investigan antes.

---

## Estructura: 4 olas (A→D)

### Ola A — Higiene de datos + captura en el scrape (gratis/trivial)

| # | Tarea | Cobertura | Archivo(s) |
|---|---|---|---|
| A1 | Backfill país desde prefijo del teléfono + fix en ingest (ningún lead entra sin país) | 1355 leads | `index.js` (helper countryFromPhone + ingest), script backfill en `scripts/` |
| A2 | Re-clasificar 578 "websites" falsos → mover a instagram/facebook/whatsapp | 578 | script backfill + fix en parse del scrape |
| A3 | Capturar en el scrape lo que SerpAPI ya da: `coordinates{lat,lng}`, `placeId`, `openingHours`, `businessStatus`, `photo` | leads nuevos | `index.js:2670` (parse SerpAPI) + `ensureLeadDefaults` |
| A4 | Limpiar/repurponer campos muertos (decisor, ownerIG/LI/FB, enrichmentStatus, apertura, lastStage) | — | `index.js`, `public/app.js` |
| A5 | Persistir resultados del scrape de Instagram como leads (recuperar bio/tel/dueño) | recupera leads sin web | `index.js` (endpoint import-instagram), `public/app.js` |

**Criterio de éxito A:** 0 leads sin país; websites re-clasificados; scrapes nuevos capturan coords/horarios/place_id; el scrape de IG se puede guardar como leads. Tests verdes.

### Ola B — Motor de connect-rate (medio esfuerzo, gran lift)

| # | Tarea | Impacto |
|---|---|---|
| B1 | **Best-time-to-call**: timezone por país (reusar `GEO_DEFAULTS` de Phase 8) + `openingHours` → chip "🕐 hora local · buena hora" en Power Dialer + boost en `_callScore` + opción de sort/filtro | **+30-70% connect rate** (el mayor lift por menor esfuerzo) |
| B2 | **Validación de número**: `libphonenumber-js` (E.164 + mobile/landline) + Telnyx Number Lookup server-side antes de discar (reachable/carrier). Campos `phoneType`, `lookupReachable` | mata el 38% invalid + protege caller ID |
| B3 | **WhatsApp-capable check** (Apify, ya pago) → `whatsappCapable` gatea ruta WA vs llamada | protege warmeo WA, no pierde tiempo |

**Criterio de éxito B:** cada lead muestra hora local y si está en ventana buena; el scoring prioriza horario hábil; los números muertos se marcan antes de discar; se sabe qué número tiene WhatsApp.

### Ola C — Motor de Enriquecimiento v2 (el "arsenal" — máximo valor para los vendedores)

| # | Tarea | Detalle |
|---|---|---|
| C1 | **IA automática + confianza**: el enrich corre solo en background post-scrape, persiste `confidence` y `enrichmentStatus`. Fallback a bio de IG para el 47% sin website | arregla los 3 agujeros de la IA de una |
| C2 | **Taxonomía de tratamientos**: IA clasifica servicios/especialidad desde {web + categorías Maps + captions/highlights IG + reviews} en un enum CERRADO + flag `ticketAlto` + `evidencia` | responde el pedido del dueño ("qué tratamientos hace") |
| C3 | **Minería de reviews** (mayor ROI): IA extrae de las Google reviews → `painPoints[]` (con cita textual), `elogios[]`, `tratamientosMencionados[]`, `fitScore` (0-100) y una `hookPhrase` lista | el ángulo más personalizado y verificable |
| C4 | **Brief pre-call** (`leadBrief`): una pantalla autogenerada por IA con decisor, tratamientos, dolor #1 + cita, opener sugerido, 2 preguntas de descubrimiento, objeción probable. Se muestra en la card del Power Dialer | el "arsenal" en 10 seg de lectura para el rep nuevo |
| C5 | **Decisor v2**: IA sobre {nombre + página "Nosotros" + bio IG + reviews} con confidence (absorbe el regex Dr./Dra.). LatAm vía website. US/CA opcional vía LinkedIn (Apify no-cookie, geo-gated) | pasar el gatekeeper |

**Criterio de éxito C:** cada lead enriquecido tiene tratamientos clasificados, fit_score, dolor con cita, y un brief de una pantalla; la IA corre sola; el rep abre la card y tiene todo.

### Ola D — Operación "enriquecer TODOS los leads" (backfill masivo)

Correr los 5178 leads existentes por el motor v2. **Scope crítico a decidir** (ver abajo).

**Criterio de éxito D:** todos los leads activos (o el subconjunto definido) con arsenal completo, idempotente, sin reventar cuotas.

---

## ⚠️ Scope crítico del "enriquecer TODOS" (decisión del user)

Los 5178 leads VIEJOS **no tienen** place_id/coords/reviews guardados (recién se capturan desde la Ola A3). Para darles el arsenal completo de reviews (C3) hay que **RE-FETCHEAR de Google Maps vía SerpAPI** (costo en créditos). Las opciones:

- **(a) Re-fetch total:** ~5178 búsquedas SerpAPI (search → place → reviews). Costo en créditos + tiempo. Da el arsenal completo a todos.
- **(b) Re-fetch selectivo (recomendado):** solo re-fetchear reviews de los leads que valen — ej. los 711 premium (50+ reviews) + los que se van a llamar activamente. Los 2440 con 0 reviews no tienen reviews que minar igual → no se gasta en ellos.

Costos aproximados del backfill total (estimados, a confirmar con tarifas reales):
- Telnyx Number Lookup: 5178 × ~$0.0015 ≈ **$8**
- Apify WhatsApp check: 5178 × ~$0.002 ≈ **$10**
- IA enrich (Mercury/Qwen): barato, ~$ por lead bajo
- SerpAPI re-fetch reviews: **el driver de costo** — depende de tarifa y de si es (a) o (b)

**Recomendación:** Ola A/B/C se construyen primero (afectan leads nuevos automáticamente). El backfill masivo (D) se corre con la estrategia **(b) selectiva** para no gastar SerpAPI en leads basura.

---

## Lo que NO se hace (decidido)

- Dedup (ya perfecto, 0 duplicados).
- Extractor Dr./Dra. como proyecto aparte (+56 netos, se pliega en C5).
- Backfill de ciudad (no recuperable local; los sin-ciudad tampoco tienen dirección/coords).
- Doctoralia (8% confiable, no rinde).
- LinkedIn en LatAm (cobertura baja, riesgo legal). Solo US/CA opcional.
- Bases pagas (ZoomInfo/Apollo) — descartadas.

---

## Orden de ejecución recomendado

1. **Ola A** (higiene + captura) — base para todo, gratis.
2. **B1 best-time-to-call** — mayor lift de connect rate, bajo esfuerzo.
3. **Ola C** (enriquecimiento v2 — el arsenal) — máximo valor para los reps.
4. **B2/B3** (validación número + WhatsApp) — antes de la campaña grande.
5. **Ola D** (backfill masivo selectivo) — cuando A/B/C están listos.

Cada ola = commits atómicos + tests + pre-deploy antes de pushear.

---

## Estado

- 2026-06-17 — Phase 10 planificada tras auditoría de 5 agentes. Pendiente: confirmar
  orden de ejecución con el user y arrancar Ola A.

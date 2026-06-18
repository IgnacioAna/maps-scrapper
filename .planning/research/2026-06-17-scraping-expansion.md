# Research: Expansión de scraping a USA / Canadá / Europa / Brasil
> Agente general-purpose, 2026-06-17. Verificado contra el código real (index.js:2706, :4555, filtro de relevancia, sin hl/gl).

## 3 hallazgos clave del código
1. **El query builder hardcodea español.** `searchLocation` (index.js ~2706) y `enrich-from-maps` (~4555) arman `` `${query} en ${location}` ``. El "en" es preposición española → mezcla idiomas en mercados no hispanos y degrada relevancia.
2. **Nunca se setea `hl`/`gl`/`google_domain`/`location`.** La única señal de país es el string de ciudad metido en `q`. CRÍTICO: en el engine `google_maps` de SerpApi, `gl` solo afecta el Place Results API, NO la búsqueda. El targeting real de país se hace con `ll` (coords) o el parámetro de texto `location` (ej. "New York, United States").
3. **El filtro de relevancia es español-only** (index.js ~2896-2920 y ~2685-2689). Las raíces `dent/odon/clin/impl` no matchean `dentist`, `cosmetic`, `med spa`, `Zahnarzt`, `harmonização`, etc. → sin ampliarlo, el scraping internacional descarta la mitad de los resultados buenos. **Este es el cambio de mayor impacto.**

## Tabla país → params SerpApi → keywords
| País | hl | gl | google_domain | location ejemplo | Keywords dentales | Keywords estéticos |
|---|---|---|---|---|---|---|
| Estados Unidos | en | us | google.com | "Miami, Florida, United States" | dentist, dental clinic, cosmetic dentist, dental implants, orthodontist | med spa, medical spa, aesthetic clinic, botox clinic, skin clinic |
| Canadá (EN) | en | ca | google.ca | "Toronto, Ontario, Canada" | dentist, dental clinic, cosmetic dentistry, dental implants | med spa, medical aesthetics clinic, botox clinic |
| Canadá (FR) | fr | ca | google.ca | "Montréal, Québec, Canada" | dentiste, clinique dentaire, implants dentaires | clinique d'esthétique, médecine esthétique, spa médical |
| Reino Unido | en | uk† | google.co.uk | "London, United Kingdom" | dentist, dental practice, cosmetic dentist, dental implants | aesthetic clinic, medical aesthetics, botox clinic, skin clinic |
| Alemania | de | de | google.de | "Berlin, Deutschland" | Zahnarzt, Zahnarztpraxis, Kieferorthopäde, Implantologie | Kosmetikstudio, Ästhetische Medizin, Botox Behandlung |
| Francia | fr | fr | google.fr | "Paris, France" | dentiste, cabinet dentaire, chirurgien-dentiste, implant dentaire | médecine esthétique, clinique esthétique, injection botox |
| Italia | it | it | google.it | "Milano, Italia" | dentista, studio dentistico, odontoiatra, implantologia | medicina estetica, centro estetico, trattamenti botox |
| España (ya está) | es | es | google.es | "Madrid, España" | dentista, clínica dental, implantes dentales, ortodoncista | medicina estética, clínica estética, botox |
| Brasil | pt | br | google.com.br | "São Paulo, Brasil" | dentista, clínica odontológica, implante dentário, ortodontista | harmonização facial, harmonização orofacial, botox |

† SerpApi usa `uk` (no ISO `gb`) — VERIFICAR.

Notas: USA "med spa" es categoría oficial de Google Business Profile. Brasil "harmonização facial/orofacial" es el término dominante (muchas clínicas son dental+estética). Alemania: blanqueamiento reservado a dentistas legalmente.

## Ciudades para locations.js (claves NUEVAS: Canadá, Reino Unido, Alemania, Francia, Italia; ampliar Brasil)
Ver arrays completos en el report original (25-30 ciudades c/u). EEUU y Brasil ya existen pero conviene ampliar Brasil (tenía 20).

## Cambios de código (sin romper LatAm)
- **A — builder localizado**: crear `COUNTRY_LOCALE` (país→{hl,gl,google_domain}) + `localeForCountry()` con default LatAm `{hl:'es'}`. En `searchLocation` pasar `location` (texto) + `hl`/`gl`/`google_domain` en vez de concatenar el país en `q`. LatAm cae al default → no se rompe. Plan B conservador si `location` da resultados raros: `q = `${query}, ${location}`` (coma neutra) + hl/gl/domain.
- **B**: mismo fix en `enrich-from-maps` (~4555).
- **C (CRÍTICO)**: `SECTOR_ROOTS` multiidioma en el filtro de relevancia + corte temprano (dent/odon/clin/impl/orto/zahn/kiefer/dentist + estet/aest/spa/beaut/kosmet/botox/harmon/derm/laser/skin/facial).
- **D**: `parseLocationParts` (split por coma) ya sirve. Dedup por últimos 8 dígitos del tel es cross-país. Caller ID rutea por prefijo del número, NO por `country` → ampliar países no afecta routing.
- **E (frontend, opcional)**: sugerir keywords por idioma según país elegido.

## Alternativas a SerpApi
- SerpApi (actual): seguir usándolo — cobertura buena en todos estos países, costo marginal de integración ~0.
- Apify Google Maps Scraper (~$1.5-4/1000 places, ya tenés APIFY_TOKEN): plan B para alto volumen.
- Outscraper (~$3-14/1000 con email): enrichment integrado.
- Google Places API oficial (~$32/1000): solo si se necesita compliance estricto de ToS (5-10x más caro).

## Legal/ToS
- ToS Google: scrapear Maps los viola (igual que hoy en LatAm); riesgo operativo (bloqueo IP) absorbido por SerpApi/Apify. No cambia al expandir.
- **GDPR (Europa) — sí cambia**: tel/email del NEGOCIO = dato de empresa (riesgo bajo); nombre+contacto directo del doctor = dato personal → base legal "interés legítimo" (Art. 6.1.f) con opt-out. Precedente 2025: CNIL multó a Kaspr €240k por scrapear LinkedIn.
- Cold calling UE/UK: además GDPR hay reglas telemarketing (PECR/TPS/CTPS) — VERIFICAR por país.
- USA/Canadá: B2B a líneas comerciales publicadas = zona segura. USA cuidar TCPA (celulares + autodialer) y DNC; Canadá CASL (estricto para email).
- Guardrail mínimo no bloqueante: priorizar tel/email del negocio sobre el del doctor, opt-out listo, registrar origen del dato.

## Incertidumbres
- `location` texto en type=search: confirmado en docs, no testeado con formato "Ciudad, País" exacto → hacer 2-3 llamadas piloto antes de migrar todo.
- `gl` no rige la búsqueda (solo Place API) — el país lo da `location`/`ll`.
- Código UK `uk` vs `gb`: confirmar en tabla SerpApi.
- Precios SerpApi/Apify/Outscraper/Places: redondeados, confirmar en pricing oficial.
- Cobertura SerpApi en EU no-España: asumida buena, confirmar con piloto.

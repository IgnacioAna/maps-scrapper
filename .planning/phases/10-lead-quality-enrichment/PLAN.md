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

## Adiciones tras auditoría de gaps (2026-06-17, 2 agentes: publicidad + cold-call)

### 🔴 Ola B0 — COMPLIANCE LEGAL (bloqueante, va ANTES de escalar) [G1]

⚠️ No es asesoría legal — señales de riesgo a validar con abogado local ES + US antes del go-live masivo.

- **España (crítico):** Ley 11/2022, desde jun-2025 **prohíbe móviles para llamadas comerciales** (multa "muy grave" hasta €20M). → el caller ID de Telnyx ruteado a ES **debe ser fijo, no móvil**. Guard en `telnyx_config.json` + validación.
- **US/Canadá:** TCPA trata todo celular como residencial (DNC aplica, $500-1500/llamada). Chip rojo "⚠️ móvil — riesgo" cuando `country∈{US,CA,ES}` && `phoneType==='mobile'` (reusa B2) + degradar en score.
- **Lista DNC interna:** campo `lead.doNotCall` + outcome de disposition "no llamar nunca" (hoy NO existe → exposición). Un rep no debe poder re-discar a quien pidió baja.
- **Ventana horaria legal por país** (gate DURO, distinto del best-time de B1 que es efectividad): ES 9-21 sin findes, US/CA 8-21 local.

### Adiciones a las olas existentes

- **A3 → usar `business_status` como GATE** [G2]: no discar `CLOSED_PERMANENTLY/TEMPORARILY`. Chip "⚠️ verificar cerrado". No desperdiciar el dial del rep nuevo.
- **B → `answerScore` separado de `fitScore`** [G3]: hoy `_callScore` mezcla calidad-de-negocio con probabilidad-de-atención. Separar: `answerScore` (phoneType móvil del dueño, tamaño chico = atiende directo, hora hábil, historial CDR) × `fitScore` (reviews/ads/tratamiento). Power Dialer ordena por combinación configurable.
- **C3/C5 → Gatekeeper intel** [G5]: en el mismo call de IA, extraer nombre exacto a pedir ("pedí por la Dra. X") + `clinicSize`/`staffSignals` (¿atiende el dueño o hay recepción? → decide ruta A/B/C del gatekeeper script v2).
- **C4 → brief en el panel de llamada EN VIVO** [G4]: inyectar las 4 líneas de oro (decisor + dolor#1 con cita + opener + objeción) en el `#telnyx-call-panel` flotante mientras suena (reusa Mercury-en-vivo #79). El arsenal donde el rep lo necesita.
- **C6 (NUEVO) → Detección de publicidad** [pedido del user]: 
  - **Pixel del HTML** (gratis, ya se baja): `hasMetaPixel` (fbq/fbevents), `hasGoogleAdsTag` (AW-), `hasRetargeting`, `hasTikTokPixel`, `hasGTM/GA4`. Prueba directa de inversión.
  - **Meta Ad Library** (Apify, ~$0.01-0.05/lead): `runsMetaAds`, `activeMetaAdsCount`, `metaAdsOldestDays`. Match por handle de IG (ya scrapeado).
  - **Google Ads Transparency** (SerpApi, ya se usa): `runsGoogleAds`. Secundario (clínicas LatAm usan poco Google Ads).
  - Derivar `adIntensity` (none/low/med/high) → boost FUERTE en `fitScore` (anuncia = tiene leads = los pierde = fit perfecto). El monto exacto NO es público; la intensidad alcanza.
  - Ángulo de llamada: *"Vi que tenés X anuncios corriendo en IG, ¿esos leads los sigue alguien o se enfrían?"*

### 🆕 Ola E — Loop de aprendizaje & conversation intel (post-volumen)

- **E1 [G7] (must):** las disposiciones + CDRs re-entrenan el scoring. Agregador por cohorte (país × franja × tratamiento): `no_answer` por franja baja `answerScore`; `answered_interested` por vertical sube `fitScore`. El scoring deja de ser estático.
- **E2 [G9] (nice, techo alto):** minar los transcripts Whisper (#81, ya se capturan) → objeciones reales por vertical al banco Mercury + qué openers conectan + auto-sugerir disposition. Requiere volumen acumulado.
- **E3 [G8] (nice):** regla de cadencia multi-canal (call→WA→email) que consume `whatsappCapable`/`phoneType` del enrich, sobre el motor de Phase 7.
- **G6 (nice):** capturar `gatekeeperIntel` estructurado post-call. **G10 (nice, trivial):** copy localizado por dialecto (usted/tú/vos por `country`) en C4/#79.

---

## Adiciones tras discusión con el user (2026-06-17, parte 2)

- **C4 → el brief da MUNICIÓN, no libreto** [decisión del user]: sacar "apertura sugerida"
  (frase para recitar → el vendedor se vuelve loro). Reemplazar por **"el ángulo"** (con qué
  abrir, en formato dato). Las PALABRAS salen de la skill del vendedor + las cards + Mercury.
  Opcional: un "ver ejemplo" colapsado como red de seguridad para reps nuevos, nunca lo principal.
- **B → panel "¿a qué país llamar ahora?"** [pedido del user]: dado el momento, rankear países
  por conveniencia de llamar AHORA (horario hábil local + ventana óptima). El navegador da la hora
  del vendedor (sin IP); el país/coords del lead da la suya. Chip de hora local por lead + boost answerScore.
- **Legal → de bloqueante a guardrails baratos** [recalibrado con el user]: llamar a un negocio
  a su número público, discando manual un humano, es la forma B2B más defendible y generalmente legal
  (DNC US es residencial; TCPA pega a robo-dialers, no a humano manual). Guardrails de higiene:
  lista DNC interna (respetar "no me llames") + horario 8-21 local + caller ID real + ES sin móvil.
  No frena nada. (No es asesoría legal; validar US/ES con abogado local antes del go-live masivo.)

## NUEVA PIEZA — Sistema de Scripts = Battlecards situacionales (separado, grande)

El "PACE framework + 30 scripts rígidos" actual el user NUNCA lo usó y no le gusta (robótico).
La investigación (agente, 2026-06-17) valida su instinto: los mejores equipos usan **battlecards /
cue cards cortas y glanceables por escenario**, NO monólogos lineales. La INFRA ya existe (CRUD de
scripts admin + panel en la llamada + buscador). Lo que cambia es el MODELO y el contenido:

- **Cards tipadas por escenario** (lo que el user describió): `opener` (varias), `gatekeeper_con_nombre`,
  `gatekeeper_sin_nombre`, `identificar_decisor`, `value_prop` (variantes), `objecion` (sub-tag), `cierre`.
- Cada card = **título + 2-4 bullets glanceables** (no párrafos). El rep mira y lo dice con sus palabras.
- **El admin (user) carga/edita/titula/versiona** — ya puede; sumar `variantId` + versionado para A/B.
- **Surface glanceable, NO pop-ups** (la investigación: los pop-ups automáticos distraen, los reps los odian).
  El rep elige; buscador por keyword ya existe. Rotular "Munición"/"Cards", no "Script".
- **A/B atado a outcomes**: variante de opener/pitch → reuniones por 100 conexiones (el Cold Call Funnel
  ya calcula booking rate; falta atar variante→outcome). El user promueve el ganador (patrón Mercury Review).
- **Mercury = asistente bajo pedido** (#79 ya existe) — el modelo ganador, no el pop-up intrusivo.
- **Ramp de nuevos**: role-play pre-llamada contra Mercury (patrón Hyperbound) + grabaciones de mejores
  llamadas (transcripts ya guardados) + densidad de cards decreciente (semana 1 expandido → mes 3 colapsado).

→ Esto es lo suficientemente grande como para ser su propia fase (Phase 11 candidata) o una ola dedicada.
Decisión pendiente del user: hacerlo junto con Phase 10 o aparte.

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
2. **B1 best-time-to-call** + B0 ventana legal — mayor lift de connect rate + gate legal.
3. **Ola C** (enriquecimiento v2 — el arsenal, incluye C6 publicidad) — máximo valor para los reps.
4. **B2/B3 + resto de B0** (validación número + WhatsApp + DNC + caller-ID ES fijo) — ANTES de la campaña grande / go-live.
5. **Ola D** (backfill masivo selectivo) — cuando A/B/C están listos.
6. **Ola E** (loop de aprendizaje) — cuando haya volumen de llamadas.

Nota: B0 (compliance) se construye en paralelo y DEBE estar completo antes del go-live con vendedores. Validación legal local (ES + US) pendiente del user.

Cada ola = commits atómicos + tests + pre-deploy antes de pushear.

---

## Estado

- 2026-06-17 — Phase 10 planificada tras auditoría de 5 agentes.
- 2026-06-17 — Decisiones del user: backfill de reviews = **selectivo** (premium + a-llamar,
  no gastar en los 2440 con 0 reviews). Arranque = **Ola A completa**.
- 2026-06-17 — Auditoría de gaps (2 agentes): sumado Ola B0 (compliance legal — BLOQUEANTE),
  C6 (detección de publicidad), Ola E (loop de aprendizaje), y mejoras a A3/B/C3/C4/C5.
  ⚠️ Compliance ES (móvil prohibido jun-2025) + TCPA US requieren validación legal local.
  Pendiente: revisión final del user del plan antes de construir (con varios agentes).

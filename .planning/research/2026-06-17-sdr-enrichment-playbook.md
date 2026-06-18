# Playbook: Brief de Lead (Arsenal) para Cold Calls
> Agente general-purpose, 2026-06-17. Verificado contra ensureLeadDefaults, callLog, precallNote.

## Insight central
La cold call no la gana "personalizar" sino la RELEVANCIA: llegar con un problema que el dueño no sabe que tiene + un motivo proactivo de llamada. Gong (300M llamadas): abrir con motivo proactivo sube el éxito 2.1x. La buena noticia: para clínicas dentales/estéticas, **los mejores triggers ya están en lo que scrapeás (rating, reviews, web, instagram)** — solo hay que DERIVAR las señales.

## Lo que YA tenés (ensureLeadDefaults + callLog)
Identidad/negocio: name, phone, country, city, address, website, instagram, facebook, email, doctor, rating (string|number), reviews (number), whatsappUrl, etc.
Operativo/SDR: precallNote (texto pre-discado), callLog[] (ts, outcome, by, notes, duration, channel, cost, quickNote, objectionTags, scriptIdsUsed, transcript), callAttempts, callbackAt, phoneStatus, wspProbability, recontactPriority (tier 1-4), estado, conexion, asistio, closedAt, dealValue, notes[], interactions[], followUps.

## Huecos clave
yearsActive/antigüedad (SerpAPI local no lo da, queda null), ratingNum calculado, reviewVelocity/lastReviewDate, respondsToReviews, hasWebsite limpio, adsActive (Meta/Google), igFollowers/igLastPost, competitorDensity, openingHours. **Ningún `openingAngle` pre-computado** (hoy el setter lo escribe a mano en precallNote).

## Brief de Lead — TIER 1 (imprescindible + fácil, construir PRIMERO)
Todo deriva de lo que YA scrapeás — cero APIs nuevas.
| Campo | Para qué | Fuente | ¿Lo tenés? |
|---|---|---|---|
| ratingNum + reviews | Núcleo pitch reputación. Umbral confianza 4.7★ dental | parsear rating a number | parcial |
| hasWebsite (bool real) | Gap clásico: muchas reviews sin web = dinero en la mesa | derivar de website (excluir wa.me/IG) | parcial |
| reputationTier (fuerte/medio/débil/crítico) | Pre-clasifica el ángulo | cálculo derivado | no |
| signals[] (triggers detectados) | Corazón del arsenal. Cada señal → un ángulo | cálculo derivado | no |
| openingAngle (1 línea) | Lo que el SDR lee al discar | Mercury genera de signals[] → precallNote | no (manual) |
| localTime | No llamar fuera de horario hábil | ya en build Ola1 (_leadLocalTime) | sí (front) |
| category (dental/estética) | Cambia todo el guion | viene en scraping, persistir en defaults | parcial |
| doctor/owner | Pedir por la persona = pasar gatekeeper | ya scrapeás | sí |

## Brief — TIER 2 (segunda ola, más esfuerzo)
respondsToReviews, lastReviewDate+reviewVelocity, worstRecentReview (snippet), yearsActive, **adsActive (Meta Ad Library API gratis — trigger más caliente para estética)**, igFollowers+igLastPost (Apify ya integrado), competitorDensity (conteo Maps de la zona), priceLevel/openingHours, websiteQuality.

## Catálogo de trigger signals → ángulo de apertura
- Rating bajo (<4.5★) → "estás en 4.3 — abajo de 4.7 la gente llama al de al lado".
- Muchas reviews sin web → "600 reseñas, 4.8, pero no hay dónde agendar — ¿cómo reservan?".
- Pocas reviews (rating ok) → "el servicio lo tenés, pero con 25 reseñas no aparecés en el top del mapa".
- Reseña negativa reciente → "vi una reseña de hace 10 días sobre la espera — ¿cómo lo manejan?".
- No responde reseñas → "las reseñas quedan sin respuesta — le dice al que mira que no hay nadie atento".
- Clínica nueva (<2 años) → "abriste hace poco — ¿cómo llenás la agenda estos meses?".
- Pauta activa (Meta/Google) → "vi que corrés ads — la mayoría pierde el lead porque nadie contesta en minutos".
- IG con seguidores sin reservas → "14k en IG pero ¿cuántos terminan en consulta?".
- Competencia densa → "hay 8 clínicas a la vuelta — ¿qué te hace elegible?".
- Horario limitado → "cerrás 18hs y sábados no — justo cuando la gente que trabaja puede ir".

## Ejemplos de apertura (opener ganador + trigger): permiso → motivo proactivo → pregunta de problema
- DENTAL gap web: "¿Dr. {doctor}? Llamada en frío, 30 seg y vos decidís. Vi tu clínica: 4.8 con 500+ reseñas, impecable. Pero no encontré dónde un paciente nuevo pueda agendar. Toda esa gente que te busca, ¿cómo reserva hoy?"
- DENTAL rating bajo: "Es llamada en frío, ¿un minuto? Estás en 4.3. Abajo de 4.7 la mayoría ni llama, se va al de al lado. ¿Eso lo tenés medido?"
- ESTÉTICA IG: "Llamada en frío, breve. 12 mil seguidores, contenido buenísimo. De toda esa gente, ¿cuántas agendan? Porque entre el like y el turno se cae el 90%."
- ESTÉTICA pauta+speed: "Vi que corrés anuncios en Meta. El problema nº1 no es el anuncio, es que cuando entra el lead nadie lo llama en minutos y se enfría. ¿Cómo lo atienden?"

## Cómo alimenta battlecards + Mercury
1. El brief computa signals[] y elige el trigger dominante → mapea al `trigger` del battlecard (call_scripts.json, 30 guiones/12 triggers). El SDR abre con el battlecard pre-seleccionado.
2. Mercury redacta openingAngle de signals[]+category → escribe en precallNote ("munición, no libreto").
3. "Mercury en vivo" (nota #79) recibe signals[] → mejores respuestas a objeciones.
4. Variables nuevas ({rating} {reputationTier} {worstReview}) al set interpolable de scripts.

## Build order (mayor impacto / menor esfuerzo)
1. Parsear rating→number + hasWebsite bool + category persistido en ensureLeadDefaults (trivial, desbloquea todo).
2. **computeLeadSignals(lead) → signals[] + reputationTier** (pura derivación, testeable, mismo patrón que computeWspProbability). **80% del valor.**
3. Chip de señales + ángulo sugerido en la card del Power Dialer.
4. Mercury auto-genera openingAngle → precallNote al cargar la cola.
Después Tier 2: Meta Ad Library (gratis, alto impacto) → reviews recientes/respuesta → IG enrichment.

## Incertidumbres
- Benchmarks dentales (4.7★, ~78 reseñas top-3) de blogs de agencias US/UK, no peer-reviewed; volúmenes menores en LatAm/ES.
- Stats Gong de B2B tech en inglés → patrón conceptual aplica, %s exactos no validados en este vertical.
- yearsActive: SerpAPI local no lo da; proxy "fecha primera reseña" requiere endpoint reviews (costo extra).
- Meta Ad Library: matching clínica→página FB es frágil (nombres no exactos).
- Usar reseña negativa concreta en apertura puede sonar invasivo → A/B testear.
- Confirmar si el scraping persiste category/placeId/googleMapsUrl en el lead guardado (aparecen en enrich/candidates, no en ensureLeadDefaults).

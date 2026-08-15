# Extraer el nombre del titular desde el TEXTO de las reseñas de Google

> Anotado 2026-08-15, a la par del parser de `lead.name` + backfill-doctor +
> botón "Buscar Instagram del Dr." (saltear la recepción y llegar al doctor).

## Por qué es la mejor fuente sin explotar

`lead.reviews` hoy solo guarda el **conteo** de reseñas (un número), no el texto.
Los pacientes escriben cosas como "me atendió el Dr. Fernández" o "la Dra. Pérez
es excelente" constantemente en las reseñas de Google — es señal humana,
verificada por el paciente mismo, mucho más confiable que inferir el nombre del
`lead.name` del negocio (que es lo único que hace hoy el parser en
`_extractDoctorFromName`, index.js).

## Medición actual del parser (2026-08-15, base real de 6413 leads)

- Ya usables (doctor válido de antes): 1704
- Nuevos + recuperados extraídos del `name`: 238 (85 nuevos, 153 recuperados)
- Usables después: 1942 de 6413 → **~30% de la base sigue sin doctor**
- `sin nombre extraíble` (el `name` no trae ninguna pista): 4471 leads

Ese remanente de 4471 es justo donde reseñas con texto ganarían más — un
`name` genérico tipo "Clínica Central" no tiene nada que extraer, pero sus
reseñas casi seguro sí mencionan al profesional.

## Cómo se haría (cuando se priorice)

1. Reusar el mismo mecanismo que el Brief IA premium (`enrich-brief`,
   index.js ~4900): re-fetch de `google_maps_reviews` por `place_id` vía
   SerpApi (💲 — mismo costo que el brief de reseñas, no es gratis).
2. Sobre el texto de cada reseña, extraer menciones tipo "Dr./Dra. X",
   "el/la doctor/a X", "profesional X me atendió" — con LLM (más flexible que
   regex, el lenguaje de reseñas es más variado que el de nombres de negocio)
   o con una extensión de los mismos patrones `dr`/`by` del parser actual.
3. Si dos o más reseñas distintas coinciden en el mismo nombre → score de
   confianza alto → candidato fuerte para `lead.doctor` (más confiable incluso
   que el patrón `dr` actual, que solo tiene ~5% de basura pero es de una sola
   fuente).
4. Nuevo valor de `doctorSource`: `'reviews'` (sumar a la whitelist
   `DOCTOR_SOURCES` en index.js, junto a `parser`/`parser-debil`/`web-ai`/
   `npi`/`manual`).
5. Igual que el brief de reseñas: dryRun + backup + cap por corrida (rate
   limit SerpApi 200/h) — mismo patrón que `enrich-brief`/`backfill-doctor`.

## Por qué NO ahora

- Cuesta plata (SerpApi + LLM) — greenlit-por-uso, no algo que corra solo
  (mismo criterio que el resto de las features 💲 del roadmap, ver notas
  #104/#105 de CLAUDE.md).
- El parser gratis sobre `lead.name` (recién construido) todavía no se corrió
  contra producción — hay que ver el resultado real del backfill actual antes
  de justificar una vía más cara para el remanente.
- El botón de Instagram (este mismo sprint) ya resuelve la necesidad
  inmediata para los 1942 leads con doctor usable; el remanente de 4471 puede
  esperar.

## Relacionado

- `_extractDoctorFromName` / `DOCTOR_SOURCES` / `POST /api/admin/backfill-doctor`
  (index.js) — el parser actual sobre `lead.name`.
- `_buildBriefMessages` / `POST /api/admin/enrich-brief` (index.js ~4900) — el
  minado de reseñas que YA existe para el Brief IA, mismo mecanismo a reusar.
- `.planning/backlog/brief-knowledge-volumen-2026-06-20.md` — precedente de
  "minado de texto con volumen", mismo criterio de espera.

# Research: Fuentes de datos y herramientas de enrichment por región
> Agente general-purpose, 2026-06-17. Foco: encontrar/enriquecer el DECISOR (dueño/director de clínica). Prioridad a lo integrable vía API. Confianza: [A] alta, [M] media, [B] baja.

## TL;DR
- LatAm: confirmado, ninguna plataforma B2B paga cubre bien PYMEs LatAm [A] → la jugada es fuentes públicas + scraping propio (ya tenés Apify + Maps).
- **USA**: el ganador NO es Apollo/ZoomInfo sino **NPI Registry (NPPES)** — gratis, con API, lista pública de TODOS los dentistas con especialidad + nombre + dirección + teléfono. Directorio de decisores de salud. Apollo como complemento barato para email/móvil.
- **Europa**: mejor móvil compliant = Cognism (caro). Camino barato potente: registros mercantiles gratis (Companies House UK, INPI/Sirene FR) para el director + directorios médicos (Doctolib/Doctoralia/Jameda) + Hunter.io.
- **Brasil**: equivalente al NPI = **CNPJ (Receita Federal, gratis vía API: empresa + socios)** + **CRO** (validar dentista) + Doctoralia BR.
- **Quick win transversal**: ya scrapeás Maps → siguiente paso barato = scrapear el sitio web del lead (email, nombre del dueño, redes). Enriquece TODAS las regiones sin pagar.

## Plataformas B2B (matriz resumida)
| Herramienta | Cubre bien | API | Precio aprox | PYME dental/estética |
|---|---|---|---|---|
| Apollo.io | US fuerte; BR/MX flojo; EU débil | Sí (planes altos) | ~$49-119/u/mes | Media-baja (sesgo tech) |
| ZoomInfo | US/CA excelente; EU pago extra; LatAm pobre | Sí (enterprise) | ~$15k/año mín | Baja (caro, enterprise) |
| Cognism | EU el mejor (móvil verificado, DNC 15 países) | Sí | ~$15-25k + seats | Media-alta SOLO EU |
| Lusha | US+EU decente; LinkedIn-centric | Sí | desde ~$19.90/mes | Media |
| Kaspr | EU fuerte (120M contactos) | Sí | Free / ~$49-79 | Media (alternativa barata a Cognism EU) |
| RocketReach | US fuerte; global amplio | Sí | ~$39-249/mes | Media |
| Hunter.io | Global (email por dominio) | Sí, simple/barata | Free + planes | **Alta utilidad/costo** (infiere email del dominio, sirve en ES/PT) |
| Clearbit→HubSpot Breeze | US fuerte; atado a HubSpot | Sí (vía HubSpot) | desde ~$45-50/mes | Baja para este caso |
| Seamless.ai | US foco | Sí | Free / contact-sales | Baja (data inconsistente) |

Lectura: estas plataformas venden a empresas con empleados en LinkedIn. Un dueño de clínica PYME suele estar mejor representado en registros sanitarios oficiales (abajo) que en Apollo/ZoomInfo.

## Fuentes salud/dental por país (el oro)
- **USA — NPI Registry/NPPES** ⭐: API gratis `https://npiregistry.cms.hhs.gov/api/` (+ NLM `clinicaltables.nlm.nih.gov/api/npi_idv/v3/search`). Taxonomy dental familia `1223...`. Filtrable por especialidad+ciudad+estado. Match por dirección/teléfono → estampar ownerName + specialty. Boards estatales para validar licencia.
- **Canadá — colegios provinciales** (RCDSO Ontario, BCCOHP, etc.; índice CDA-ADC). Sin API pública → scraping (Apify factible). No hay NPI nacional unificado.
- **Europa**: registros mercantiles gratis → **UK Companies House API REST gratis** (officers + PSC = dueños reales); **FR INPI+Sirene API gratis**; DE Handelsregister / ES Registro Mercantil (menos API directa). Directorios médicos: Doctolib (FR), Doctoralia (ES/BR), Jameda (DE) — sin API oficial, scrapeables (actores Apify).
- **Brasil — CNPJ + CRO** ⭐: CNPJ Receita Federal gratis vía BrasilAPI / ReceitaWS / CNPJá / OpenCNPJ (razón social, situación, CNAE, endereço, **sócios**). CRO (Conselho Regional de Odontologia) por estado + CFO federal para validar dentista (Infosimples API paga). Doctoralia BR para reviews.
- **LatAm hispana**: sin equivalente NPI/CNPJ con API gratis universal. Lo que funciona: scraping Maps + web + IG + Hunter.io. Confirma la decisión del dueño.

## Enrichment barato sin plataformas (todas las regiones)
1. **Scrapear el sitio web del lead** (ya tenés la URL): /contacto, /quienes-somos, /equipo → email, nombre del dueño, redes. Apify tiene actores "Google Maps + contact details".
2. Google Business / reviews: cantidad, rating, antigüedad, si responde reviews, horarios.
3. Instagram (Apify ya integrado): bio, link, followers, casos.
4. Hunter.io por dominio → patrón de email del dueño.
5. WHOIS (cada vez más oculto).

## Verificación tel/email
- **Twilio Lookup** (API): line-type móvil/fijo/VoIP, carrier — clasificar antes de discar, no quemar Telnyx. Pay-as-you-go.
- NumVerify: barato a volumen (~$9.99/mes 2k).
- NeverBounce (~$0.003-0.004/email) / ZeroBounce (~$0.009-0.0195) para verificar email.

## Recomendación TOP por región
- **USA**: NPI Registry (base, gratis) + Apollo (email/móvil) + Twilio Lookup.
- **Canadá**: colegios provinciales (scraping) + Apollo/RocketReach + Twilio.
- **Europa**: registros mercantiles gratis (Companies House/INPI) + directorio médico (scraping) + Cognism/Kaspr si hay volumen.
- **Brasil**: CNPJ (BrasilAPI, gratis) + CRO + Doctoralia + Hunter.io.
- **LatAm**: scraping propio (web+GBP+IG) + Hunter.io + NumVerify/Twilio.

## Quick wins integrables YA (esfuerzo creciente)
1. Scrapear sitio web del lead → email + ownerName + redes (Apify, cero fuentes nuevas).
2. NPI Registry API (USA) → ownerName + specialty (un fetch).
3. CNPJ API (Brasil) → razón social + socios (un fetch).
4. Twilio Lookup → line-type antes de discar.
5. Hunter.io API → email por dominio (EU/LatAm).
6. Companies House API (UK) si se entra a UK.
Todos encajan con el patrón actual: enriquecer `lead.*` con campo nuevo vía job de enrichment.

## Incertidumbres
- Precios no confirmados [B]: Hunter pagos, LinkedIn Sales Nav (~$99 estimado), Surfe/Seamless tiers altos.
- "Apollo el mejor en BR/MX" viene de vendor (parte interesada) → probar sobre leads MX reales antes de pagar.
- Cobertura LatAm de Cognism/Lusha/Kaspr no documentada → asumida floja.
- Scraping Doctolib/Doctoralia/Jameda: sin API oficial, zona gris ToS + GDPR.
- Canadá: confirmar si algún colegio expone API.
- CNPJ wrappers no autoritativas para compliance (ok para screening).

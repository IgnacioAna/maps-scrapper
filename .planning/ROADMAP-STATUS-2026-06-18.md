# Estado real del roadmap (Phases 6-17) — 2026-06-18

> Mapa honesto: qué está DONE en prod, qué PARCIAL, qué PENDIENTE. Verificado contra
> los PLAN.md de cada fase + lo deployado. (Los ROADMAP.md/STATE.md viejos de GSD están
> desactualizados; este es el estado vivo, junto con CLAUDE.md.)

## ✅ Fases COMPLETAS (en producción)
- **6 Telnyx Calls** — VoIP/WebRTC, caller ID por país, disposition. DONE.
- **7 Campañas Drip WA** — motor backend + tests. UI builder (Wave 6) pendiente. **PARKEADA** (bots).
- **8 Proxy/Fingerprint wa-multi** — backend+panel+repack. **PARKEADA** (bots).
- **14 Lead-Ops pool** — pool único + distribución + reciclaje. DONE.
- **15 Purga deuda técnica + consolidación panel** — DONE.
- **16 Enrichment + scraping global** — señales/brief-lite, scraper USA/CA/EU/BR, enrichment email+NPI. DONE.
- **17 Disposition/DNC/cadencias** — razón descalif., DNC, shared callback, cadencia auto-redial, timeline/quick-links. DONE (olas 1-4).

## 🟡 Phase 10 — Lead quality/enrichment (~45% — los quick wins + arsenal-lite)
DONE: backfill país, señales+ángulo (brief-lite), hora local, enrichment email web + NPI (USA), **señal "ya pauta" (ad-detection por pixel, C6 parcial)**, DNC (B0 parcial).
PENDIENTE (las piezas grandes del "arsenal"):
- **A3** capturar del scrape lo que SerpAPI ya da: coords, placeId, openingHours, businessStatus, foto. *(safe, additive)*
- **A2** mover los ~578 "websites" basura (wa.me/redes) a su campo real. *(safe backfill; signals ya los ignora)*
- **A5** persistir el scrape de Instagram como leads (bio/tel/dueño). *(medio)*
- **B2** validación de número vivo (libphonenumber + Telnyx Lookup) — mata el 38% invalid. *(💲 cuesta: Telnyx Lookup ~$0.0015/lead)*
- **B3** WhatsApp-capable check (Apify). *(💲 Apify)*
- **B0** compliance: guard ES caller-ID-fijo + ventana horaria legal por país. *(decisión legal del user)*
- **C1** IA enrich automática + confidence + fallback a bio IG. *(💲 LLM)*
- **C2** taxonomía de tratamientos (IA). *(💲 LLM)*
- **C3** ⭐ minería de Google reviews → dolores+cita+fitScore+hook (el de mayor ROI). *(💲 LLM + re-fetch SerpAPI reviews)*
- **C4** brief pre-call completo (decisor+tratamientos+dolor+preguntas). *(💲 LLM; hoy hay brief-lite)*
- **C5** decisor v2 LatAm vía web. *(💲 LLM)*
- **C6** Meta Ad Library (cantidad de ads activos). *(💲 Apify; el pixel ya está gratis)*
- **Ola D** backfill masivo selectivo de reviews. *(💲 SerpAPI)*
- **Ola E** loop de aprendizaje (disposiciones+CDRs re-entrenan scoring; minar transcripts). *(post-volumen)*

## 🔴 Phase 11 — Battlecards situacionales (~5%)
La infra existe (CRUD scripts + panel en llamada + buscador). Falta el MODELO: cards tipadas por escenario (opener/gatekeeper/objeción/cierre), glanceables, A/B atado a outcomes. **Necesita que el user (vos) escriba/edite el contenido** + un cambio de UX. No es código pesado, es contenido + diseño.

## 🟡 Phase 12 — SDR Operating System (~10% — capa de proceso/gestión)
DONE: speed-to-lead alert, cold-call funnel.
PENDIENTE:
- **P0-1** regla de persistencia (hoy `_callScore` PENALIZA intentos; hay que invertir: empujar 1-2 intentos, advertir antes de descartar <5-6, filtro "abandonados temprano"). *(safe, alto valor)*
- **P0-2** auto-disposition desde transcript (Whisper→LLM). *(💲 LLM)*
- **P0-3** cadencia multicanal call+WA (la de solo-llamada ya está en P17). *(WA parkeado)*
- **P0-4** dashboard de equipo con barras de benchmark 2026. *(safe, additive)*
- **P1** role-play IA como gate de certificación + quota graduada · scorecard/coaching de transcripts · BANT-lite + recordatorios no-show · leaderboard doble eje. *(varios 💲 LLM + decisiones de producto)*
- **P2** voicemail drop · local presence por ciudad · number rotation · cola speed-to-lead · call-block mode.
- **P3** parallel dialer (pilotear, no apostar — peor ROI inmediato + migración a Call Control API).

## 🟡 Phase 13 — Reestructuración UI/IA (~35%)
DONE: limpieza de panel (P15), default a Llamadas, chips de señales, timeline unificada (P17 Ola 4), quick-links.
PENDIENTE:
- **`_leadStore` single-source-of-truth + optimistic sync** — el más sentido (hoy Power Dialer y lista tienen copias separadas). *(REFACTOR GRANDE, riesgoso a ciegas — toca todas las vistas del call center)*
- **Home "Hoy"** con 4 secciones accionables (callbacks/interesados/reintentar/vírgenes). *(grande)*
- **Anatomía única de lead-card + chips semánticos** (hoy divergen lista vs dialer). *(refactor medio-grande)*
- **Vistas-chip** reemplazando el sort dropdown. *(medio)*
- **Dialpad 3×4 real + DTMF** en llamada. *(self-contained, medio)*

---

## Recomendación de ejecución (clasificada por riesgo/costo)

**🟢 Safe + sin costo extra — se pueden seguir solos:**
- P12-P0-1 regla de persistencia (no abandonar leads temprano).
- P12-P0-4 dashboard de equipo con benchmarks.
- P10-A3 capturar campos del scrape (coords/placeId/businessStatus/openingHours) + gate "no discar cerrado".
- P10-A2 mover websites basura.
- P13 dialpad 3×4 + DTMF.

**💲 Cuestan plata (LLM/Apify/SerpAPI/Telnyx) — necesitan OK del user (¿corro sobre 5178 o selectivo?):**
- C3 minería de reviews (⭐ mayor ROI), C1/C2/C4/C5 enrich IA, P12 auto-disposition, B2 number lookup, B3/C6 Apify.

**⚠️ Refactor grande riesgoso a ciegas — mejor con el user mirando:**
- P13 `_leadStore` + optimistic sync, home "Hoy", anatomía única de card.

**📝 Necesitan decisión/contenido del user (no es código):**
- P11 battlecards (vos escribís las cards), B0 compliance legal (abogado), P12 leaderboard/comp/role-play (decisiones de producto).

# SCM — Milestones

> Histórico de milestones completados. El detalle técnico vive en
> `CLAUDE.md` (raíz del repo); acá va el resumen ejecutivo.

---

## v1.x — Del prospector WhatsApp al call center SDR (2026-04 → 2026-07)

**Shipped** (Phases 1–18 + olas safe/cost, todo en producción en Railway):

- **Era WhatsApp (abril–mayo)**: wa-multi desktop multi-cuenta con envío
  OS-level anti-detección, extensión Chrome "Pegar como humano", warming
  engine (rutinas + AI-to-AI), IA Inbox con classifier, Banco de
  Respuestas con RAG, Centro de Entrenamiento (8 módulos + quizzes).
- **Phase 6 — Telnyx Calls Foundation (mayo)**: dialer WebRTC en browser,
  caller ID por país, disposiciones, métricas de costo.
- **Phases 7–8 (junio)**: motor de campañas drip WA + anti-detección
  proxy/fingerprint — backend completo, **parkeado** cuando la operación
  pivoteó a llamadas.
- **Pivot a cold calling (junio)**: Power Dialer con autopiloto y atajos,
  cadencias auto-redial, DNC, lead signals/brief IA, scraping multi-país,
  enrichment gratis (web/NPI/RDAP), pool único de distribución con tiers,
  filtro de tarifas rojas Telnyx.
- **Whisper + coaching (junio–julio)**: transcripción 2 canales (8 rondas
  de hardening hasta conversaciones completas verificadas), análisis IA
  manual con framework Cold Call v2, auto-disposición IA, biblioteca de
  Entrenamiento IA con privacidad por SDR.
- **CALL METRICS CORE (2026-07-24)**: refactor integral de métricas —
  fuente única del funnel, atribución por quién llamó, TZ de negocio,
  `tests/metrics-consistency.test.js` como garantía.
- **Phase 18 — Supervisor scoped (julio)**: `visibleSetterIds[]`,
  `ADMIN_ONLY_SETTER_IDS`, ~40 endpoints filtrados, "Ver como" fiel.

**Estado al cierre**: ~836 tests verdes, equipo de 3-5 SDRs nuevas
operando 100% por llamadas, 6.413 leads, 603 llamadas desde 28/05.

**Deuda que motiva v2.0**: el reporte semanal quedó construido pero roto
(bug `now`), el análisis de coaching es manual y sin agregación, las
alertas solo pintan pantalla, y la disposición es opcional (fuga de
datos estructural).

---

*Milestone v2.0 "Gestión por excepción" iniciado el 2026-07-25 — ver
`PROJECT.md`, `REQUIREMENTS.md` y `ROADMAP.md`.*

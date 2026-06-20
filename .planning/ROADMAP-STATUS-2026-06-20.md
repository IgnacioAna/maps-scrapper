# Estado real del roadmap — 2026-06-20

> Foto honesta del estado vivo (reemplaza a ROADMAP-STATUS-2026-06-18.md, que quedó
> desactualizado tras las sesiones del 18→20/06). Verificado contra lo deployado en prod.

## TL;DR
**Todo el sistema operativo del call center está LISTO y en producción.** Lo pendiente es:
(a) contenido/decisiones tuyas, (b) los bots/WhatsApp (parkeados a propósito), (c) features
"nivel 2" que recién valen la pena con volumen de llamadas.

---

## ✅ COMPLETO y en producción

- **6 Telnyx Calls** — WebRTC, caller ID por país, dispositions, dialpad/DTMF, transcripción Whisper.
- **14 Lead-Ops pool** — pool único + distribución + reciclaje.
- **15 Purga deuda técnica + consolidación panel.**
- **16 Enrichment + scraping global** — scraper USA/CA/EU/BR; señales+ángulo (barrida ejecutada).
- **17 Disposition/DNC/cadencias** — razón descalif., DNC, callbacks, timeline, quick-links.
- **Cadencia no-contacto (20/06):** no_answer/buzón NO aparece en Hoy; reaparece en Llamadas/Power
  Dialer cada 24h hasta 3 intentos; al 3er no-contacto → descarte automático.
- **Enrichment por API (gratis + opt-in pago):** email web · Instagram/Facebook · "corre anuncios
  (Meta/Google/TikTok)" · dueño NPI (USA) · validación de número (Telnyx Lookup, pago) ·
  **Brief IA** (mina reseñas → dolores/cita/gancho/fit, pago) con barrida por país + recon gratis.
- **Contacto secundario por lead** — el número que pasa la recepción; se guarda en la card y se
  puede llamar desde ahí (con teclado en el modal).
- **Vista "Hoy"** (rediseño profesional 20/06) · **Equipo** · **Mi rendimiento + funnel cold-call con benchmarks**.
- **Centralita** — números/routing/saldo/costos reales por CDR. 1 número activo (+17866870849, US compartido).
- **Cierre del funnel** — estado 'ganada' en calendario → lead 'cerrado' + revenue.

### Parkeado A PROPÓSITO (decisión: "todo por llamada")
- **7 Campañas Drip WA** — motor backend + tests OK. Falta UI builder (Wave 6). Apagado.
- **8 Proxy/Fingerprint wa-multi** — backend+panel+repack. Apagado.
- **Follow-ups (mensajes WA programados)** — vista admin-only; se activa con los bots.

---

## 🟡 PENDIENTE

### 1. Necesita input TUYO (no es código)
- **Fase 11 — Battlecards/guiones por escenario:** la infra está (CRUD + panel en llamada +
  buscador). Falta el CONTENIDO (vos escribís/editás las cards) + decidir su mejor ubicación
  (hoy se editan en Centralita, no es lo más intuitivo).
- **Compliance legal (B0):** ventanas horarias / DNC por país = criterio de abogado.

### 2. Gasto que disparás vos (en curso / cuando quieras)
- **Barrida masiva de Brief IA + enrichment** sobre leads viejos (Ola D). En proceso.

### 3. Nivel 2 — Fase 12 (con volumen de llamadas)
- Auto-disposición desde transcript (IA) · role-play IA de certificación · scorecard/coaching de
  transcripts · leaderboard · BANT-lite + recordatorios no-show · voicemail-drop · rotación de
  números · local-presence por ciudad · parallel dialer (bajo ROI).

### 4. Refactors / backfills menores (no críticos)
- Mover ~578 "websites" basura (wa.me/redes) a su campo real (las señales ya los ignoran).
- Persistir el scrape de Instagram como leads (bio/tel/dueño).
- `_leadStore` reactivo single-source-of-truth completo (hoy hay versión segura: escritura
  sincronizada de los 2 cachés).

---

## En una línea
Lo que necesitás para operar el call center HOY: **100% listo y deployado.** El resto es tu
contenido, los bots (parkeados), y mejoras de nivel 2 para cuando escales.

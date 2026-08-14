# Phase 26: Agente en Retell + piloto - Context

**Gathered:** 2026-08-01
**Status:** Ready for planning (depende de Phase 24; 25 deseable)
**Research base:** `.planning/research/2026-08-01-agente-voz-retell.md`
(§2 hechos Retell, §4 diseño COMPLETO del flow — el mapa de 9 nodos, la
extraction, las reglas del global prompt y la secuencia de objeciones están
AHÍ; este CONTEXT no los duplica)

<domain>
## Phase Boundary

El agente existe en Retell, suena bien en español, y completa un lote
piloto real en México con resultados medibles. Cubre VOICE-08 (documento
"agente cargable") y VOICE-09 (setup trunk + prueba + piloto + cierre).

NO incluye: código del SCM (Phases 24-25), seguimientos automáticos del
agente, inbound, A/B de openers (variante futura).

</domain>

<decisions>
## Implementation Decisions

- **D-26-01 — El entregable de 26-01 es un DOCUMENTO, no config via API.**
  `docs/retell-agent-v1.md` (o phase dir): global prompt completo en
  español + prompt por nodo (9 nodos del research §4) + tabla de
  transiciones (ecuación vs prompt-based) + variables dinámicas + Post
  Call Data Extraction (definición campo por campo) + settings por nodo
  (Voice Speed, Interruption OFF en opener, Response Eagerness) + config
  de la tool `book` (URL, header `x-scm-tool-secret`, JSON schema, timeout
  5000, Talk While Waiting) + webhook URL. El user lo carga a mano en el
  dashboard (Chrome) — el builder visual es suyo; el contenido es nuestro.
  Fuente del contenido: guiones oficiales del user (Entrenamiento v2 Parte
  2 + Documento de openers, que GANA donde difieran) + research §4.

- **D-26-02 — Guía de setup del trunk**: `docs/retell-telnyx-setup.md`
  paso a paso: crear SIP trunk elastic en Telnyx (credential auth — Retell
  no tiene IP fija), termination/origination a los SIP URIs de Retell,
  importar los 3 números E.164 en Retell, y verificación (llamada de
  prueba). Referencia oficial: docs.retellai.com/deploy/custom-telephony.
  `autonomous: false` — la ejecuta el user con acompañamiento.

- **D-26-03 — Antes de gastar en leads reales** (checklist bloqueante):
  (1) confirmar con Retell facturación ring vs conectado; (2) elegir voz
  entre 3 candidatas en español desde el dashboard (el nombre de la
  persona se elige para matchear la voz — decisión pendiente de user);
  (3) chequear cada caller ID contra "spam likely" llamando a un teléfono
  propio; (4) llamada de prueba completa al user (gatekeeper→pitch→
  objeción→agendar) con transcript verificado en la biblioteca del SCM.

- **D-26-04 — Piloto**: lotes chicos (10) → revisar transcripts → ajustar
  prompt → repetir. México, mañana local del lead (chip 🕐 existente).
  Presupuesto total ~$50. Cierre con las métricas del ROADMAP (criterio 4)
  comparadas contra el baseline humano del Comando (mismo período,
  period=30d).

- **D-26-05 — Iteración del prompt = redeploy del documento**: cada ajuste
  se versiona en el doc del repo primero y se re-carga en Retell después
  (el doc es la fuente de verdad, el dashboard es el deploy). Retell
  versiona agentes — anotar el número de versión activa en el doc.

</decisions>

<specifics>
## Specific Ideas

- La llamada de prueba al user también valida la latencia real (970-1300ms
  observada en el curso) contra la sensación de conversación — si se siente
  robótica en los turnos rápidos del gatekeeper, tunear Response Eagerness
  antes del piloto.
- Los transcripts del piloto son material de tuning: leer TODOS los de los
  primeros 2 lotes (20 llamadas) antes de escalar.
- Si el % de atención cae durante el piloto → sospechar reputación del
  caller ID (rotación/spam), no el agente.
</specifics>

<deferred>
## Deferred

- A/B del opener "formalidad asumida" (Connor) vs permiso (v1) por lotes.
- Flip-call recordatorio anti no-show como tarea del agente.
- Inbound/recepcionista IA en los números propios.
- Número español para reactivar ES fijo (pendiente previo #155).
</deferred>

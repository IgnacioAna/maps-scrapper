# Phase 27: Banco de conocimiento unificado - Context

**Gathered:** 2026-08-01
**Status:** Ready for planning (independiente; paralelizable con 25/26 —
si corre antes que 26-01, el prompt del agente consume su fuente)
**Research base:** `.planning/research/2026-08-01-agente-voz-retell.md` (§3.12)

<domain>
## Phase Boundary

Una sola fuente de verdad de la oferta que alimenta al agente de voz, al
asistente de respuestas, al Banco de Respuestas y al Centro de
Entrenamiento. Cubre VOICE-10.

NO incluye: el prompt del agente en sí (26-01 la consume), coaching
automático (Phase 22 diferida).

</domain>

<decisions>
## Implementation Decisions

- **D-27-01 — Fuente versionada en el repo**: `scripts/seed/oferta-scm.md`
  (o similar junto a los seeds existentes): la oferta (reactivación y
  retención SIN publicidad paga; las 6 fugas; seguimiento de presupuestos
  no cerrados; no-shows; fidelización sobre base existente), casos reales
  (119 pacientes en 6 semanas / 9 turnos en un día / día pico), calificación
  (base 800+ — 500-800 viable con expectativas calibradas), reglas duras
  (precios JAMÁS en outreach — se evalúan en la reunión; stack técnico
  JAMÁS — ni GHL ni plataformas), y las objeciones oficiales v2 con sus
  respuestas (del Entrenamiento v2 Parte 2 + Script v3 Fase 8).

- **D-27-02 — PRIMERA TAREA: verificar el estado real de proveedores IA en
  el código.** El user reporta "solo OpenAI; Mercury/Qwen no van más";
  PROJECT.md (2026-07-25) decía "OpenAI gpt-4o-mini primario, Mercury
  fallback". NO asumir ninguna: leer el código de la instancia local (que
  puede tener commits que esta sesión no vio), y recién después tocar
  prompts/config. Actualizar CLAUDE.md donde siga diciendo Mercury/Qwen
  como activos.

- **D-27-03 — System prompt del asistente** actualizado desde la fuente
  (respetando el mecanismo existente de mercury_config/versionado y
  `_stripBrandMentions` — que SÍ aplica al asistente, a diferencia del
  agente de voz).

- **D-27-04 — Seed de objeciones al Banco de Respuestas**: patrón
  `seed-faqs.mjs` (idempotente, dedup por pregunta normalizada), SIN pisar
  entries existentes con métricas de uso (usos/funcionaron). Las objeciones
  nuevas de los cursos (opción múltiple, varita mágica, salida a 3 meses)
  entran como variantes/entries nuevas con tag.

- **D-27-05 — Centro de Entrenamiento**: el playbook consolidado de los 5
  cursos (el artifact del user es material fuente) como material adicional
  para SDRs humanas — incluida la sección mindset/miedo (que al agente no
  le sirve pero a las SDRs sí). Formato: material subido/entry de
  training.json o doc — decidir en plan-phase según cómo carga hoy el
  Centro.

</decisions>

<specifics>
## Specific Ideas

- La fuente debe poder citarse por sección desde el prompt del agente
  (26-01) para no duplicar texto: el doc del agente copia; la fuente manda.
- Chequear el FAQ del banco de prod que menciona `scm-dental.vercel.app`
  (decisión previa del user: se conserva).
</specifics>

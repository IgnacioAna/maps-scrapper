# SCM — STATE

> Estado vivo del proyecto. Actualización: 2026-05-01.

---

## Current Phase

**Phase 2 (Bloque B)** — UX para setters / WhatsApp warmer

**Status:** Pendiente de discusión y planificación. Foco operativo del
usuario porque escaló a 15 setters y todos están comprando números —
el calentamiento de cuentas es lo crítico.

**Next step:** `/gsd-discuss-phase 2` — alinear qué subset del Bloque
B se ataca primero (warmer es el que más le importa).

---

## Phase Status

| # | Phase | Status |
|---|-------|--------|
| 1 | Bloque A — Cierre v1 | Mayormente done (15 setters operativos) |
| 2 | Bloque B — UX setters / warmer | **Active — foco actual** |
| 3 | Bloque C — GHL-ready | Pending |
| 3.5 | Bloque C.5 — Extensión "pegar humano" | ✅ **Completado y deployado v0.2.0** (2026-04-27) |
| 4 | Bloque D — IA mejorada | Pending (futuro) |
| 5 | Bloque E — Llamadas IA | Pending (futuro lejano) |

---

## Recent Sessions

### 2026-04-27 — Phase 3.5 (Bloque C.5) completada

- Extensión Chrome MV3 "Pegar como humano" implementada y deployada.
- Soporta WhatsApp Web e Instagram DMs.
- Intercepta paste con marker `__SCM_TYPE__:`, hace typing humano.
- Detección de instalación: panel SCM falla a copy normal si la
  extensión no está, evita filtrar el marker raw.
- Distribuible: `extensions/scm-paste-as-human/release/scm-paste-as-human-v0.2.0.zip`
- Botones "👤 Copiar humano" en panel: Setteo, Banco de Respuestas,
  Centro de Comando.
- Pendiente del lado del usuario: distribuir el .zip a los 15 setters.
- Test pasado contra WA Web (Instagram pendiente de validar en uso real).

### 2026-05-01 — pivote a warmer (Bloque B)

- Usuario escaló a 15 setters operativos comprando números.
- Prioridad nueva: dejar el sistema de warmer en buen estado para que
  los setters puedan calentar números desde el panel/app desktop.
- Sesión actual: re-onboarding al estado del warmer (`src/wa/`,
  `wa-multi`) y discusión para definir qué resolver primero.

---

## Open Questions / Blockers

- **Phase 2 (warmer):** falta context refresh — qué del warmer ya
  funciona, qué rompe en operación real con 15 setters, qué problema
  concreto bloquea hoy.
- **GSD tooling:** los skills `/gsd-*` invocan `gsd-sdk` (resuelve
  como `gsd-tools.cjs`). El workflow ingest-docs no está soportado en
  esta versión. Workaround: ejecución manual de los skills (validado
  para discuss-phase y plan-phase en C.5).

---

## Notes

- Source of truth narrativo del roadmap sigue siendo el `ROADMAP.md`
  de raíz. Mantener `.planning/ROADMAP.md` alineado manualmente.
- 86 commits posteriores a C.5 (2026-04-27 → 2026-05-01) sumaron
  features: followups (Milestone 3), reassign de leads en bulk,
  filtro 'untouchedOnly', fixes de phones. El warmer (`src/wa/`) se
  mantuvo estable (~894 LOC, sin crecimiento mayor).

---

*Last updated: 2026-05-01.*

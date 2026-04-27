# SCM — STATE

> Estado vivo del proyecto. Cada `/gsd-*` que avanza work actualiza este
> archivo automáticamente. Bootstrap manual: 2026-04-27.

---

## Current Phase

**Phase 3.5** — Bloque C.5: Extensión Chrome "Pegar como humano"

**Status:** Plan completado — `03.5-PLAN.md` listo. Research previo en
`03.5-RESEARCH.md` confirma método primario (`execCommand('insertText')`
per char) con fallback `InputEvent`.
**Next step:** ejecutar **Task 5.2** (smoke test del método en DevTools
de WA Web — gate hard antes de codear nada). Si pasa, arrancar Wave 1.

---

## Active Workspaces

(ninguno)

---

## Recent Sessions

### 2026-04-27 — bootstrap GSD manual

- Instalado GSD v1.38.5 globalmente
- Detectado mismatch: `gsd-sdk` esperado por workflows no existe en PATH;
  binario real es `~/.claude/get-shit-done/bin/gsd-tools.cjs` con set de
  comandos distinto. `init.ingest-docs` no soportado en esta versión del
  SDK.
- Decisión: bootstrap manual de `.planning/` desde `ROADMAP.md`,
  `MANUAL-ADMIN.md`, `MANUAL-SETTER.md`, `CLAUDE.md`. Sin tocar código ni
  docs originales.

### 2026-04-27 — discuss Phase 3.5 (Bloque C.5)

- Decisiones capturadas (ver `phases/03.5-pegar-como-humano/03.5-CONTEXT.md`):
  - Hotkey: `Ctrl+Espacio`
  - Marker: `__SCM_TYPE__:` obligatorio
  - Sin marker → toast "Falta marker SCM" y abortar
  - Marker inyectado por botón "Copiar" del panel SCM
  - Naturalismo: máximo (delay random + puntuación + typos + pausas)
  - UI: mini badge flotante con progreso
  - Cancel: Esc + auto-pausa al teclear manualmente
  - Distribución: ZIP unpacked drag-drop
- Riesgo técnico identificado para el research del planner: confirmar
  qué API de inyección de input acepta WA Web hoy
  (`keydown+keypress+input` vs `execCommand('insertText')` vs
  `InputEvent` con `inputType: 'insertText'`)

---

## Phase Status

| # | Phase | Status |
|---|-------|--------|
| 1 | Bloque A — Cierre v1 | Active (depende del usuario) |
| 2 | Bloque B — UX setters | Pending |
| 3 | Bloque C — GHL-ready | Pending |
| 3.5 | Bloque C.5 — Extensión "pegar humano" | Active (CONTEXT.md ✓, plan pending) |
| 4 | Bloque D — IA mejorada | Pending (futuro) |
| 5 | Bloque E — Llamadas IA | Pending (futuro lejano) |

---

## Open Questions / Blockers

- **Phase 3.5:** botón "Copiar con marker" en panel SCM es dependencia
  bloqueante para uso real. Decidir si se planea como sub-tarea de Phase
  3.5 o como mini-phase coordinada.
- **GSD tooling:** los skills `/gsd-*` invocan `gsd-sdk query ...` que no
  resuelve. Si se quiere usar la maquinaria full (subagentes,
  auto-commits, gates), hay que resolver el mismatch — o seguir usando
  los skills "manualmente" (yo improviso el flow sin el SDK, como hice
  en discuss-phase para C.5).

---

## Notes

- Source of truth narrativo del roadmap sigue siendo el `ROADMAP.md` de
  raíz. `.planning/ROADMAP.md` es la versión GSD-formatted, mantenerlos
  alineados manualmente hasta que el ingest funcione.
- El `C5-CONTEXT.md` original está en raíz de `GoogleSrapper/` por
  histórico; copia "oficial" GSD en
  `.planning/phases/03.5-pegar-como-humano/03.5-CONTEXT.md`.

---

*Last updated: 2026-04-27.*

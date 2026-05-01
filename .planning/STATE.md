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

### 2026-05-01 (PM) — Phase 2.1 Warming-Lunes ejecutada (sprint Vie→Lun)

6 waves del PLAN.md ejecutadas con disciplina GSD:

- **Wave 1**: commiteados los cambios pendientes de wa-multi
  (window-manager, preload whatsapp, ai-replier, response-bank-template).
- **Wave 2**: módulo `fingerprint-patcher.ts` agregado al preload.
  Randomiza Canvas/WebGL/Audio/Navigator/Screen por cuenta con seed
  determinístico hash(accountId). Anti-ban capa nueva.
- **Wave 3**: endpoint `POST /api/wa/accounts/:id/start-warming-default` +
  botón "🔥 Calentar" en panel admin (one-click: crea routine + attach +
  start) con toast de feedback.
- **Wave 4**: bump a v0.3.0 + build con electron-builder + zip
  distribuible `wa-multi-portable-v3.0.0.zip` (145 MB) en escritorio.
- **Wave 5**: doc `docs/setter-quickstart.md` (154 líneas, 10 secciones)
  para distribuir junto al zip.
- **Wave 6**: smoke test automatizado 10/10 OK. VERIFICATION.md con
  checklist manual pendiente del usuario.

**Phase 2 status**: parcialmente completa — subset crítico para el lunes
resuelto. Resto del Bloque B (sidebar único + webviews, banco editable,
métricas pulidas, inbox unificado) → Phase 2.2 post-lunes.

**Próximo paso del usuario**: ejecutar checklist manual VERIFICATION.md +
distribuir zip + doc el lunes a los 15 setters.

### 2026-05-01 (PM++) — Phase 2.3 AI-to-AI Warming Network ejecutada

Después del cierre de 2.1, el usuario identificó un gap fundamental: el
"warmer" anterior era scheduled outbound (manda lo que vos cargás como
targets+messages), NO warming real. Real warming = cuentas chatean entre
sí con IA conversacional para construir reputación natural.

Phase 2.3 cierra ese gap. 6 waves ejecutadas con disciplina GSD (discuss
→ plan → execute → verify):

- **PLAN.md** con 9 asunciones explícitas y 6 waves
- **Wave 1**: schema + persona-generator (determinístico por accountId,
  pools de nombres argentinos, estilos, ventanas de actividad) + store JSON
- **Wave 2**: pairing engine cross-setter + fairness + anti-incest semanal,
  scheduler con cadencia humana gaussiana, orchestrator state machine
- **Wave 3**: LLM integration reusando Mercury (Inception Labs) + Qwen
  fallback EXISTENTES — cero API keys nuevas. Cost estimado ~$0.45/mes
  para 30 cuentas × 10 msgs/día.
- **Wave 4**: 9 endpoints REST en `/api/wa/warming-network/*`, boot
  integrado en mountWa, filtro de gateway que rutea inbounds del pool
  al orchestrator y los oculta del IA Inbox de leads, handler socket
  `warming:send-message` en wa-multi reusando send flow OS-level
- **Wave 5**: vista admin "Red de Warming" en panel con stats cards,
  tabla del pool con personas ficticias, tabla de pares activos con
  state machine, lista de mensajes recientes, modal de inscripción
- **Wave 6**: 10/10 verificaciones automáticas OK, 299/299 tests passing

Commits: 7 atomicos por wave en GoogleSrapper + 1 en wa-multi.

**Phase 2.3 status**: ✅ código completo. Pendiente deploy + smoke test
manual del usuario. VERIFICATION.md tiene checklist 6-tests.

**Próximo paso**: deploy a Railway + inscribir 2 cuentas de prueba del
usuario + observar primer ciclo de mensajes generados por LLM.

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

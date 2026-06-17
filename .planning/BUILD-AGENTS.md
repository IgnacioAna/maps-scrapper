# Plan de Build Multi-Agente — SCM Call Center (Phases 10-15)

> Cómo se ejecutan las 6 fases con agentes. Regla maestra: **paralelizar por zona de
> archivo, no por feature.** `index.js` y `app.js` son hot-files (los toca todo) → un
> solo agente los posee por ola. El orquestador (hilo principal) integra + testea +
> commitea + pre-deploy. Cada ola = rama + commits atómicos + tests verdes + pre-deploy.

---

## Los 7 roles de agente (función fija, recurren por ola)

| # | Rol | Dueño de archivo | Función |
|---|---|---|---|
| **A1** | **Backend Engineer** | `index.js`, `src/wa/*` | Endpoints, schema de lead, consolidación de stats, lógica de enrichment, fix `include=callable`, lane router. Único que edita index.js por ola. |
| **A2** | **Frontend Engineer** | `public/app.js` | Vistas, `_leadStore` + sync, render, cableado de features, Power Dialer. Único que edita app.js por ola. |
| **A3** | **Design-System Engineer** | `public/components.js` (NUEVO), `public/style.css` | Component library (leadCard/kpiCard/dataTable/modal/chip/filterBar), tokens semánticos, utilidades CSS, cohesión visual. |
| **A4** | **HTML/IA Engineer** | `public/index.html` | Markup de vistas, sidebar/nav, drawer parkeado, modales, dialpad. Coordina ids con A2. |
| **A5** | **Data-Ops Engineer** | `scripts/*`, `data/*` (con backups) | Backfills (país, lineType/waCapable), migración de `lane`, reasignar huérfanos, archivar one-shots, higiene. Corre con `makeBackup` + patrón atómico. |
| **A6** | **QA / Test Engineer** | `tests/*` | Tests vitest por feature, regresión. Corre después de cada agente de código. |
| **A7** | **Docs / State Keeper** | `CLAUDE.md`, `.planning/*` | Mantiene docs + STATE + cache-buster sincronizados. |

**Orquestador (hilo principal):** spawnea los agentes de cada ola, resuelve conflictos de integración, corre `npm test` completo, hace los commits atómicos, bumpea cache-buster, corre `pre-deploy`, reporta al user. NO deja a dos agentes editar el mismo hot-file en paralelo.

**Zonas prohibidas en paralelo** (CLAUDE.md #13): `style.css`, `src/wa/*`, `public/wa.js`, onboarding, `setters.json`. Si dos olas las tocan, van seriadas.

---

## Las 6 olas de build (secuenciales; agentes en paralelo dentro de cada una)

### 🌊 Ola 1 — Limpieza + Component Library (Phase 15 base)
*Limpia el lienzo y crea los bloques reutilizables que usan todas las olas siguientes.*

| Agente | Hace |
|---|---|
| **A1** Backend | Borra endpoints/campos muertos (lastStage, ownerIG/LI/FB, enrichmentStatus), consolida endpoints `backfill-*`. |
| **A3** Design-System | Crea `components.js` (leadCard/kpiCard/dataTable/modal/chip/filterBar) + tokens + utilidades CSS. Limpia CSS legacy. |
| **A5** Data-Ops | Archiva 15 one-shot scripts → `scripts/archive/`. Borra `.bak` viejos (21.5 MB). |
| **A6** QA | Tests de que nada se rompió tras las remociones. |

Dependencia: A3 antes que A2 en olas siguientes (los componentes se usan después). A1↔A3 coordinan style.css (A1 quita legacy, A3 agrega utilidades).

### 🌊 Ola 2 — Pool de datos + consolidación backend (Phase 14 backend + Phase 15 admin dedup)
*La base de datos ops: un pool, lanes, single-source-of-truth de stats.*

| Agente | Hace |
|---|---|
| **A1** Backend | Extrae `_computeSetterStats()` (mata la fórmula ×3), mergea `/team-performance`→`/command`, **fix `include=callable`**, agrega campos `lane/lineType/waCapable/score/suppressedReason` al schema. |
| **A5** Data-Ops | Migración one-shot: deriva `lane` de `conexion`, backfill país (1355), enriquece lineType/waCapable (batch), reasigna 299 huérfanos. Backups + atómico. |
| **A6** QA | Tests de endpoints consolidados + migración idempotente. |

Dependencia: A5 corre **después** de que A1 define los campos del schema.

### 🌊 Ola 3 — Consolidación del panel admin + nav (Phase 15 vistas)
*22→16 vistas, Comando/Centralita simplificadas, drawer parkeado.*

| Agente | Hace |
|---|---|
| **A4** HTML/IA | Sidebar 22→11 core + drawer "avanzadas" (parkea bots/training/etc.), markup Comando→"Dashboard Operaciones", Centralita→"VoIP Setup", merge online→columna en Equipo, scrape-history→tab, mercury config+review→tabs. |
| **A2** Frontend | Refactor de los handlers admin (loadCommandCenter, _tlx*, mercury) usando `kpiCard`/`dataTable`/`chip` de A3. Mueve efectividad cold-call a myperf. |
| **A6** QA | Smoke de vistas admin. |

Dependencia: usa componentes de Ola 1. A2↔A4 coordinan ids (mismo trabajo de vistas).

### 🌊 Ola 4 — UI restructure: store + Hoy + dialpad (Phase 13)
*El contenedor: estado sincronizado + home "Hoy" + dialpad. La pieza fundacional de UX.*

| Agente | Hace |
|---|---|
| **A2** Frontend | `_leadStore` (single source of truth) + optimistic sync entre Power Dialer/Calls/Setteo, home "Hoy" con las 4 colas, migra lead-card a `leadCard()` de A3. |
| **A4** HTML/IA | Markup home "Hoy", dialpad 3×4 + DTMF, vistas-chip que reemplazan el sort dropdown. |
| **A3** Design-System | Ajustes finos de componentes para el dialer en vivo. |
| **A6** QA | Tests de sync + render. |

### 🌊 Ola 5 — Enrichment + Operating System P0 (Phase 10 + 12)
*Leads buenos + gestión: arsenal + persistencia + dashboard con benchmarks.*

| Agente | Hace |
|---|---|
| **A1** Backend | Best-time-to-call (timezone), detección de publicidad (pixel HTML + Meta Ad Library), brief IA, taxonomía de tratamientos, validación de número (Telnyx Lookup). |
| **A2** Frontend | Brief en la card + panel en vivo, chip de hora local + panel "a qué país llamar ahora", **regla de persistencia (invertir el score)**, dashboard de equipo con benchmarks 2026. |
| **A5** Data-Ops | Backfill selectivo de reviews/treatments para leads premium + a-llamar. |
| **A6** QA | Tests de funnel/score/enrichment. |

### 🌊 Ola 6 — Battlecards + coaching (Phase 11 + resto de 12)
*El qué decir + el motor de mejora.*

| Agente | Hace |
|---|---|
| **A2/A4** | Módulo Battlecards (reubica el CRUD de guiones de Centralita) — cards situacionales glanceables, A/B atado a outcomes. |
| **A1** Backend | Role-play Mercury (cert gate), scorecard sobre transcripts, loop disposición→scoring. |
| **A6** QA | Tests. |

---

## Reglas de ejecución (las hace el orquestador)

1. **Una rama por ola**, NO pushear a `main` sin `npm run pre-deploy` (necesita pass admin Railway).
2. **Commits atómicos** por unidad de trabajo + tests verdes antes de cada commit.
3. **Cache-buster** bumpeado ante cualquier cambio a app.js/style.css/index.html (A7 lo vigila).
4. **Nunca dos agentes en el mismo hot-file** en paralelo (index.js→A1, app.js→A2, html→A4, css/components→A3).
5. **A6 (QA) corre después de cada agente de código**; A7 (docs) cierra cada ola.
6. Bots quedan **parkeados** en toda la ejecución (código intacto, sin nav).

---

## Resumen

6 olas secuenciales · dentro de cada una, 2-4 agentes en paralelo por zona de archivo disjunta ·
orquestador integra/testea/commitea. Empieza por **Ola 1 (limpieza + componentes)**: bajo riesgo,
habilita todo lo visual de las olas siguientes.

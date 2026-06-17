# Phase 15 — Purga de deuda técnica + simplificación

> Síntesis de 2 agentes (2026-06-17): inventario de deuda técnica/código muerto +
> auditoría de Centro de Comando, Centralita y navegación.
>
> Objetivo: limpiar el ruido acumulado, sacar lo que no se usa, **parkear** (no borrar)
> los bots, y dejar el sistema legible y enfocado ANTES de construir lo nuevo.
> Limpiar el lienzo primero.

---

## Estado del codebase

~32k LoC (index.js 11.3k + app.js 14.1k + style.css 3.9k + WA 1.2k + tests 6.1k).
~58 endpoints muertos/internos, 5 vistas muertas, **22-27 items en el sidebar** (demasiados).
Purga realista: ~1160 LoC + vistas muertas + scripts, sin tocar lo parkeado.

---

## A) Purga de código (del inventario de deuda)

### Tier 1 — SAFE (hacer ya, ~2h, riesgo cero)
- **Campos muertos**: `lastStage`, `ownerInstagram/Linkedin/Facebook`, `enrichmentStatus` (init en `ensureLeadDefaults`, nunca leídos). (index.js:518, 540-546; app.js:1691-1695)
- **Vistas muertas**: `view-wa-aiinbox` (concepto, nunca implementada), y la UI vacía `view-wa-campaigns` (backend OK, UI Wave6 nunca hecha → parkear con los bots). (index.html:2836, 2840)
- **Archivar 15 one-shot scripts** ya ejecutados → `scripts/archive/` (one-shot-*, redistribute, replace-hex, normalize-*).
- **Borrar `.bak` viejos** (21.5 MB) → dejar 1 reciente.
- **CSS legacy vars** (`--primary-color`, `--text-main`) → reemplazar ~14 refs por los tokens v1.1.

### Tier 2 — CHECK (verificar antes, refactor)
- **Consolidar endpoints `backfill-*`** (5 endpoints copy-paste) → uno parametrizado `/api/admin/maintenance?task=`. (-150 LoC)
- **Helper único de teléfono** (`sanitizePhoneE164` duplicado backend+frontend) → un solo canonical. 
- **Consolidar agregación de stats** (4 funciones similares loopeando callLog/interactions). (-200 LoC)
- **`view-social` / apify-scrape**: confirmar que nadie lo usa → parkear.

### Tier 3 — RISKY (con tests primero, no ahora)
- Anatomía única de lead-card (3 implementaciones) → se hace en Phase 13.
- Extraer `applyLeadCascade()` del PATCH leads (load-bearing — escribir tests antes).
- Power Dialer state machine, follow-up logic consolidation.

### NO tocar (parkear, no borrar)
WA campaign engine (bots parkeados), Mercury, Telnyx. `decisor`/`apertura` están en uso (KEEP).

---

## B) Simplificación de vistas (Comando + Centralita + nav)

### Centro de Comando (`view-command`) — "quilombo ilegible"
Hoy mezcla equipo + rendimiento por setter + por variante + editor de variables + historial de
scraping. **Mucho es REDUNDANTE** con `view-team` y `view-myperf`, y scrollea 1200px.
- **CUT**: tabla de usuarios (ya en view-team), rendimiento por setter (ya en view-team),
  rendimiento por variante + editor (parkear), historial de scraping (parkear).
- **KEEP**: stats generales + sección "Llamadas" (eficacia por setter) + acciones admin (dedup/import).
- **Renombrar** "Dashboard de Operaciones". → -50% HTML, -75% JS.

### Centralita Telnyx (`view-telnyx-config`) — "hay scripts, hay mierda, ruido"
Mezcla config + números + routing + saldo + costo real + métricas + efectividad cold-call + guiones CRUD.
- **KEEP esencial**: credenciales, números, routing por país, saldo (mini-card sticky).
- **MOVER**: 🎯 Efectividad Cold Calling → `view-myperf` (es KPI del owner, no de Telnyx).
  Costos/CDRs → drawer "Facturación". **Guiones CRUD → se convierten en el módulo Battlecards (Phase 11).**
- **Renombrar** "VoIP Setup". → contenido enfocado, -40% scroll.

### Navegación: 22-27 items → 11 core + drawer "avanzadas"
**KEEP (core)**: Hoy(nuevo) · Power Dialer · Setteo WhatsApp · Mi rendimiento · Follow-ups ·
Historial llamadas · Equipo · Reuniones agendadas · VoIP Setup · Banco de Respuestas · Sistema.
**PARK (drawer, código intacto)**: bots (Dashboard WA, Cuentas, Campañas, Warming×2, IA Inbox),
Mis WhatsApps, Entrenamiento, Google Maps + Historial scrapes, Objeciones, Revisión IA, Config Mercury.
→ sidebar -50% items, +300% legibilidad. **Bots parkeados, no borrados** (alineado con la decisión del user).

---

## C) Consolidación de TODO el panel (admin + setter) — 2 agentes (2026-06-17)

### Duplicación admin (el quilombo principal)
La misma data se computa/renderiza en varias vistas:
- **Performance por setter computada 3×** en backend (`/api/setters/command` + `/performance` + `/team-performance`) — misma fórmula `pctConexion/pctApertura/pctCalificacion`. → extraer **`_computeSetterStats(leads)`** único; deprecar `/stats`; mergear `/team-performance` en `/command` con `?scope`. (-600 LoC backend)
- **Métricas cold-call en 2 lados** con agregaciones distintas (command callStats ≠ cold-call-metrics) → una sola fuente.
- **Presencia (view-online)** → debe ser una **columna en Equipo**, no vista propia.
- **Historial de scrapes** → **tab dentro de Prospección/Maps**, no vista propia.
- **Mercury config + review** → **una vista "Mercury IA" con tabs** (config/review/stats).
- **Historial de llamadas** → modal contextual desde la fila de Equipo.
→ Admin: **22→16 vistas, 6→4 endpoints de stats, single-source-of-truth por métrica.** ~1800 LoC de duplicación eliminable.

### Panel setter
Consolidar 10 vistas → 5 core + drawer Help (Entrenamiento/Guía al cajón). Lead modal **unificado** que muestre AMBOS carriles (WhatsApp + llamadas) del mismo lead. Toolbar comprimida (search + Filtros▼ + Acciones▼).

### 🧩 Shared Component Library (el cambio que mata la inconsistencia visual)
8 bloques repetidos en toda la app, cada uno con 4-7 implementaciones distintas:
| Componente | Impls hoy | Reemplaza |
|---|---|---|
| `leadCard(lead, mode)` | 4 (row/dialer/modal/history) | `_renderRowSimple`, `_pdRender` card, modal, call-history row |
| `kpiCard(label,val,delta)` | 5 (crm/myperf/command/team/telnyx) | todas las stat-cards |
| `dataTable(cols,rows)` | 5 tablas | leads/calls/history/team/scheduled |
| `modal(title,body,footer)` | 7 modales | callback/schedule/objection/manual-dial/faq/variants/lead |
| `chip(text,variant)` | clase CSS existe pero se arma **inline 6+ veces** | todos los chips de estado |
| `filterBar(filters)` | 4 | pipeline/toolbar/calls-sort/faq |
| `quickLinks(lead)` | — | Maps/web/IG/email/WA |
| utilidades CSS | 230+ inline styles | `.uppercase-label`, `.box`, `.flex-col`, tints |

→ ~700 LoC menos + **consistencia 3×** + mantenibilidad 10× (cambiás 1 componente = cambia en todos lados). **Es el vehículo de implementación de la cohesión visual de Phase 13** (anatomía única de lead-card + chips semánticos = exactamente `leadCard` + `chip`).

### Conteo total de la purga + consolidación
~22→16 vistas admin (+ setter a 5 core), 6→4 endpoints stats, ~1800 LoC duplicación admin + ~700 LoC componentes + ~140 LoC Tier 1 muerto. **Sistema dramáticamente más legible y chico.**

---

## Cómo se conecta

- La simplificación es el **primer build**: limpia el lienzo antes de meter el restructure (Phase 13/14).
- Los guiones de Centralita → migran al módulo Battlecards (Phase 11).
- La efectividad cold-call de Centralita → migra al "Mi rendimiento" / dashboard (Phase 12).
- Parkear bots = exactamente la decisión del user (se construye la base, sin acceso ahora).

---

## Estado

- 2026-06-17 — Phase 15 sintetizada de 2 agentes. Tier 1 es ~2h riesgo cero.
  Recomendación: ejecutar como PRIMER build (limpiar antes de construir lo nuevo).

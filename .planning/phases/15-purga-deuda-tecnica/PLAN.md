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

## Cómo se conecta

- La simplificación es el **primer build**: limpia el lienzo antes de meter el restructure (Phase 13/14).
- Los guiones de Centralita → migran al módulo Battlecards (Phase 11).
- La efectividad cold-call de Centralita → migra al "Mi rendimiento" / dashboard (Phase 12).
- Parkear bots = exactamente la decisión del user (se construye la base, sin acceso ahora).

---

## Estado

- 2026-06-17 — Phase 15 sintetizada de 2 agentes. Tier 1 es ~2h riesgo cero.
  Recomendación: ejecutar como PRIMER build (limpiar antes de construir lo nuevo).

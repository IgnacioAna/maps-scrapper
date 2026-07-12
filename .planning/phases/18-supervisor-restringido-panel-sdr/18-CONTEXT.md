# Phase 18: Supervisor restringido + panel de rendimiento SDR - Context

**Gathered:** 2026-07-12
**Status:** Ready for planning
**Source:** Decisiones directas del user (Ignacio) en chat

<domain>
## Phase Boundary

Un usuario supervisor con visibilidad LIMITADA a un subconjunto configurable
de setters. Caso concreto: el supervisor ve el rendimiento de Judith Mendez
(setter_judith_mendez), Roxana Cabaleiro (setter_roxana_cabaleiro) y Nadine
Tortonese (setter_nadine_tortonese), y NO puede ver NADA de setter_ignacio
ni setter_paula_kroff: ni métricas, ni leads, ni llamadas, ni
transcripciones, ni aparecer en dropdowns/tablas/comparativas.

Entregables: (a) mecanismo de scoping server-side, (b) gestión desde el
panel admin, (c) panel de rendimiento pro como home del supervisor scoped,
(d) tests, (e) instrucciones para crear el usuario real vía el flujo de
invitación existente.

</domain>

<decisions>
## Implementation Decisions

### Modelo de datos (LOCKED)
- Campo `visibleSetterIds[]` en el user record de `auth.json`.
- Vacío o ausente = supervisor ve TODO (comportamiento actual intacto —
  cero regresión para supervisores existentes como Paula si la hubiera).
- Con valores = el backend filtra TODA respuesta por esa lista.

### Scoping server-side (LOCKED)
- RBAC real en backend, no solo filtro de UI. Un supervisor scoped que
  pegue a la API a mano tampoco puede ver data de setters fuera de su lista.
- Auditar TODOS los endpoints que el rol supervisor puede tocar hoy
  (team-performance, cold-call-metrics, performance, calls-today,
  telnyx/metrics, cold-call-effectiveness, objection-analytics,
  pool-summary, training/calls, auth/online, call-history, leads, etc.)
  y aplicar el filtro en cada uno.
- Los setters fuera de la lista NO deben aparecer ni siquiera como
  nombres/ids en dropdowns o agregados de equipo.

### Gestión (LOCKED)
- Admin gestiona `visibleSetterIds` desde el Centro de Comando al
  crear/editar usuarios (UI de tildar setters visibles).
- El usuario supervisor real se crea vía el flujo de invitación existente.

### Frontend (LOCKED)
- Home del supervisor scoped = panel de rendimiento pro. Reutilizar/extender
  view-team + Cold Call Funnel (patrón visual de view-myperf rediseñada,
  nota #114 de CLAUDE.md: .myp-tile, .seg-control, .ccm-*).
- Métricas: llamadas por día, connects, conversaciones, agendas, deals,
  tendencias (evolución temporal), alertas, comparativa entre sus SDRs.
- Dropdowns de setter en cualquier vista accesible muestran SOLO los
  setters visibles.

### Resolución de preguntas abiertas del research (LOCKED)
- El supervisor scoped SÍ ve leads, llamadas y transcripciones de sus SDRs
  visibles (el user pidió "todos los rendimientos, todo lo que sea" de las 3).
- Endpoints financieros/globales no filtrables (telnyx/balance,
  telnyx/real-costs, telnyx/events, pool-summary, command/centro de comando)
  → 403 para supervisor scoped (no son "rendimiento de mi equipo" y el saldo
  incluye llamadas de setters ocultos).

### Claude's Discretion
- Nombre exacto del campo y helpers (`visibleSetterIds` sugerido).
- Si conviene un helper central tipo `getVisibleSetterIds(req)` /
  `filterByVisibleSetters()` reutilizado por todos los endpoints (preferible
  a parches ad-hoc por endpoint).
- Qué vistas del sidebar ve el supervisor scoped (mínimo: panel de
  rendimiento; criterio: nada que exponga leads/llamadas de setters ocultos).
- Detalles visuales del panel dentro del Design System v1.1.

</decisions>

<canonical_refs>
## Canonical References

### RBAC y auth
- `index.js` — `requireRole`, `getEffectiveAuth`, `attachAuth` (~línea de auth), flujo de invitaciones y usuarios
- `data/auth.json` — shape del user record
- CLAUDE.md notas #113 (atribución por caller `_callSetterId`), #118 (privacidad training), #25/#26 (RBAC hardening)

### Endpoints de métricas existentes
- `index.js` — `/api/setters/team-performance`, `/api/setters/cold-call-metrics` (~3687), `/api/setters/performance`, `/api/setters/calls-today`, `/api/setters/objection-analytics`, `/api/setters/pool-summary`, `/api/telnyx/metrics`, `/api/telnyx/cold-call-effectiveness`, `/api/training/calls`, `/api/auth/online`

### Frontend
- `public/app.js` — `view-team` loader, `_mypLoad`/`_mypLoadColdCall` (Cold Call Funnel), `loadPoolView`, patrón `.myp-tile`/`.seg-control`/`.ccm-*`
- `public/index.html` — vistas `view-team`, `view-myperf`, sidebar `data-roles`
- `public/style.css` — Design System v1.1, bloques `.myp-*`, `.ccm-*`, `.seg-*`

### Tests patrón
- `tests/team-performance.test.js` — setup con rangos explícitos
- `tests/training-privacy.test.js` — patrón de test de privacidad por rol
- Regla #121: en tests setear API keys a `""`, nunca `delete`

</canonical_refs>

<specifics>
## Specific Ideas

- Setters actuales en data: setter_ignacio (Ignacio), setter_paula_kroff
  (Paula Kroff), setter_judith_mendez (Judith Mendez),
  setter_roxana_cabaleiro (Roxana Cabaleiro), setter_nadine_tortonese
  (Nadine Tortonese). Nadine aún no tiene user en auth.json (solo setter
  record).
- El rol `supervisor` YA existe en el sistema y hoy ve todo el equipo
  (view-team, view-calls, métricas). Esta fase NO crea un rol nuevo:
  agrega scoping opcional al rol existente.
- Regla crítica: bumpear cache-buster si se toca app.js/style.css/index.html.
- Deploy: `npm run pre-deploy` antes de push; Railway escucha `main`.

</specifics>

<deferred>
## Deferred Ideas

- Biblioteca general de llamadas del equipo para supervisor (nota #118 la
  deja explícitamente para después).
- Permisos granulares por vista (más allá de setter-scoping).

</deferred>

---

*Phase: 18-supervisor-restringido-panel-sdr*
*Context gathered: 2026-07-12*

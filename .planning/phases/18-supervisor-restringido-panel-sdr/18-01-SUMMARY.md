---
phase: 18-supervisor-restringido-panel-sdr
plan: 01
subsystem: backend-rbac
tags: [rbac, supervisor-scoping, index.js, security]
requires: []
provides: [_visibleSetterIds, _filterSettersVisible, _setterIsVisible, visibleSetterIds-plumbing]
affects: [index.js]
completed: 2026-07-12
---

# Phase 18 Plan 01: Scoping server-side del rol supervisor por setters visibles — Summary

Scoping RBAC real (server-side) del rol `supervisor` por un subconjunto configurable de setters (`visibleSetterIds`). Un supervisor scoped ve solo la data de sus setters visibles en todos los endpoints; uno sin la lista (o admin/setter) mantiene comportamiento 100% idéntico al actual vía short-circuit `visibleSet === null`.

## Helpers centrales (index.js ~5314)

- `_visibleSetterIds(authUser)` → `null` si no hay restricción (admin, setter, o supervisor sin `visibleSetterIds`); `Set<string>` si es supervisor scoped.
- `_filterSettersVisible(setters, visibleSet)` → filtra array de setters; passthrough si `visibleSet===null`.
- `_setterIsVisible(setterId, visibleSet)` → bool.
- Expuestos en `globalThis.__phase18` (línea 5363).

## Auth plumbing del campo `visibleSetterIds`

- `publicUser` (218): expone `visibleSetterIds` (default `[]`) — llega al frontend vía `/api/auth/me`, login, users, accept-invite.
- `getEffectiveAuth` (519): agrega `visibleSetterIds` al objeto devuelto (campo nuevo, no rompe consumidores).
- `POST /api/auth/invites` (~1841): acepta `visibleSetterIds` opcional; solo si `role==='supervisor'`, validado contra `loadSettersData().setters`.
- `POST /api/auth/accept-invite` (~1904): copia `invite.visibleSetterIds || []` al user creado.
- `PATCH /api/auth/users/:id` (~5734, admin-only): setea/actualiza `visibleSetterIds` si viene en el body (omitido = no tocar), validado contra setters existentes; 400 si no es array.

## Endpoints con scoping (Task 2 — métricas/listas agregadas)

Fuente correcta: **leads → `lead.assignedTo`**; **llamadas → `_callSetterId(entry, lead, userMap)`**.

- `GET /api/setters` (5147): `_filterSettersVisible`.
- `GET /api/setters/team-performance` (~8975): filtra `scopedSetters` ANTES del `.map()` de perSetter → `teamAverages`/alertas solo sobre el subconjunto.
- `GET /api/setters/cold-call-metrics` (~5354): `?setter=<oculto>`→403; loop callLog + deals del calendar filtrados por visibleSet.
- `GET /api/setters/performance` (~8848): `?setter=<oculto>`→403; `allLeads` y array `setters` filtrados.
- `GET /api/setters/team/:id/quota` (~5234) y `/calls-today` (~5457): 403 si setter fuera de visibleSet.
- `GET /api/setters/objection-analytics` (~6044): `continue` por `_callSetterId` en el loop.
- `GET /api/setters/stats` (~8429): `?setter=<oculto>`→403; leads y `setters` filtrados.
- `GET /api/telnyx/metrics` (~13668) y `/cold-call-effectiveness` (~12688): pool de calls filtrado por `_callSetterId` → bySetter derivado ya scoped.
- `GET /api/telnyx/calls/recent` (~13059): filtro per-call por `_callSetterId`.
- `GET /api/telnyx/script-effectiveness` (~12843): `continue` por `_callSetterId`.
- `GET /api/training/calls` (~13257): inclusión por `visibleSet.has(lead.assignedTo)` + `userSetterId[c.by]`.
- `GET /api/auth/online` (1570): propio user + users con `setterId` visible.
- `GET /api/auth/users` (1654): filtra `data.users` (propio + setterId visible); `invites` vacío para scoped.
- `GET /api/setters/recent-responses` (~6157): `_setterIsVisible(r.setterId, visibleSet)`.

## Endpoints con guards/bloqueo (Task 3)

Guards de ownership por lead (403 para supervisor scoped, como `else`/línea adicional — NO reemplaza la rama `role==='setter'`):
- `GET /leads/:id/contact-status` (~7242), `PATCH /leads/:id` (~7257), `PATCH /leads/:id/followup` (~7455), `PATCH /leads/:id/asistencia` (~7759).
- `POST /api/telnyx/calls/:leadId/transcribe` (~13533): rama `else` para admin/supervisor scoped.
- `GET /api/training/calls/:leadId/:callIdx` (~13364).

Listas de leads/calendario filtradas:
- `GET /api/setters/leads` (~5981) y `/leads/sin-wsp` (~5998): `?setter=<oculto>`→403; sin setter, `visibleSet.has(l.assignedTo)`.
- `GET /api/setters/calendar` (~9662) y `/calendar/enriched` (~9706): filtro por `entry.setterId`.
- `POST /api/setters/calendar` (~9669): 403 si `effectiveSetterId`/lead destino fuera de visibleSet.

Bloqueo 403 entero para supervisor scoped (endpoints financieros/pool/gestión):
- `pool-summary` (~6930), `pool-setter-breakdown` (~6981), `command` (~9190), `telnyx/balance` (~12149), `telnyx/real-costs` (~12308), `telnyx/events` (~13791).

## Zero-regression

Todas las ramas nuevas se activan solo con `visibleSet` truthy (supervisor con `visibleSetterIds` no vacío). Admin, setter y supervisor sin lista pasan por `visibleSet===null` → comportamiento idéntico al actual. Las ramas `role==='setter'` existentes se conservaron (grep: 42 ocurrencias intactas).

## Deviations from Plan

Ninguna funcional. Ajustes menores dentro del espíritu del plan:
- `GET /api/setters/stats`: se agregó 403 explícito para `?setter=<oculto>` (además del filtro de leads que el plan pedía) porque el `else if (setter)` existente hubiera devuelto los leads del setter oculto sin el guard — necesario para cerrar la fuga.
- `GET /api/auth/users`: `invites` se vacía para supervisor scoped (no listaba nada de valor y podía filtrar emails/roles de invitados fuera de scope).

## Tests

`npx vitest run team-performance training-privacy security-rbac reset-password performance` → **128/128 passed** (5 suites). `node --check index.js` limpio tras cada task.

## Self-Check: PASSED
- `globalThis.__phase18` presente (línea 5363).
- `function _visibleSetterIds` == 1.
- `visibleSetterIds` en publicUser (línea 227).
- Guards `Lead fuera de tu visibilidad` / `No disponible para supervisor con setters restringidos` == 13 ocurrencias.
- `visibleSet` usado en 104 puntos; ramas `role==='setter'` conservadas (42).

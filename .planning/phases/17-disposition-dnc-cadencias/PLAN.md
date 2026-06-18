# Phase 17 — Disposición rica + DNC + cadencias (ideas Adversus)

> Creada 2026-06-18. SUMA al roadmap (Phases 10-16), no reemplaza. Origen: demo de
> Adversus (backlog en `.planning/backlog/ideas-adversus-2026-06-18.md`). Prioridad
> por valor/riesgo. Cada ola: implementar → test → preview → deploy.

## Ola 1 — Razón de descalificación + DNC (ALTA, build primero) ⭐
- **Razón de descalificación**: al marcar outcome `answered_not_interested`, capturar `lead.disqualifyReason` de una lista whitelisteada (no_es_icp, no_es_decisor, ya_no_trabaja, sin_presupuesto, ya_tiene_proveedor, cliente_actual, mala_experiencia, no_contactar, ya_agendado, otro). Persistir en lead + logEntry. Reporte en cold-call-metrics (byReason).
- **DNC / No llamar**: `lead.doNotCall` (+ reason/at/by). Excluye el lead de TODA cola de llamada (sin-wsp callable, pool-distribute, pool-summary, renderCallsList). Distinto de `descartado` (por-campaña) y `phoneStatus`. Razón `no_contactar` auto-setea DNC. Compliance para EU/USA/CA.
- UI: dropdown de razón condicional en disposition (Power Dialer + view-calls) + acción "🚫 No llamar" + indicador visual + filtro admin para ver/deshacer DNC.
- Tests: disposition con razón, DNC excluye de colas, auto-DNC por no_contactar.

## Ola 2 — Shared vs Private callback (MEDIA)
- `lead.callbackShared` (bool). Cola de callbacks compartidos que cualquier setter puede tomar (no se pierde si el dueño no está). Hoy callback atado al dueño.
- Timeline/UI muestra "próxima llamada @ hora".

## Ola 3 — Cadencias de llamada ("Journeys" SDR, sin bots) (MEDIA/ALTA)
- Reglas de auto-redial por outcome: no_answer → +Xh hasta N intentos; voicemail → +1d. Reusa scheduledMessages/followups existentes. SOLO-llamada primero (multicanal SMS/WA = Phase 7 parkeada).

## Ola 4 — Pulido UX (BAJA)
- Quick-links grandes (Web/Maps/IG/NPI) en panel de llamada. Timeline unificada por-lead (callLog+notes+interactions ordenado).

## Reglas (CLAUDE.md): pre-deploy antes de push; push main+master; cache-buster si app.js/style.css; mutex en handlers async; backfill con dryRun+backup.

---
phase: 19-encender-reporte-semanal
plan: 01
subsystem: reportes
tags: [weekly-report, resend, call-metrics-core, persistencia, cron]
requires:
  - CALL METRICS CORE (_ccCollectCalls/_ccFunnelAggregate, nota #157 CLAUDE.md)
  - ADMIN_ONLY_SETTER_IDS / _SUPERVISOR_EXCLUSION_SET (nota #144)
  - Helpers TZ de negocio (_bizStartOfDay/_bizDayOfWeek/_bizHour/_bizDayStr)
provides:
  - maybeRunWeeklyReportCron(nowTs, sendFn) testeable sin ReferenceError (REP-01)
  - _reportRecipients() con cadena REPORT_EMAILS > ADMIN_EMAIL > auth.json (REP-02)
  - buildWeeklyReportData derivado del core, sin sección WSP (REP-03)
  - globalThis.__weeklyReport (superficie de test para plan 19-02)
  - reports.json en el patrón de persistencia de 4 lugares + BACKUP_FILES
affects:
  - 19-02 (tests de regresión usan globalThis.__weeklyReport)
  - Phase 21 (reporte diario se monta sobre esta base)
tech-stack:
  added: []
  patterns:
    - "Cron inyectable (nowTs, sendFn) — patrón campaignEngineTick regla #72"
    - "Toda métrica de llamadas deriva de __callCore, jamás funnel inline"
key-files:
  created: []
  modified:
    - index.js
    - scripts/pre-deploy.js
    - tests/onboarding.test.js
decisions:
  - "Destinatarios en env var REPORT_EMAILS (CSV) — consistente con el patrón de config del proyecto (WA_CORS_ORIGINS), editable sin deploy desde Railway Variables"
  - "Si el envío falla NO se persiste lastWeeklyReportAt → el próximo tick horario del lunes reintenta (intencional)"
  - "data/reports.json NO se crea en el repo — nace en prod con el primer envío y el pre-deploy lo baja"
metrics:
  duration: ~6 min
  completed: 2026-07-25
  tasks: 3
  tests: 90/90 verdes (onboarding + metrics-consistency + faqs)
---

# Phase 19 Plan 01: Encender el reporte semanal (fix backend) Summary

Cron semanal reparado de raíz (ReferenceError `now` que duplicaba o mataba el envío), destinatarios múltiples vía REPORT_EMAILS, data derivada del CALL METRICS CORE sin la sección WhatsApp engañosa, y reports.json en el patrón de persistencia anti-redeploy.

## Tasks ejecutadas

| Task | Commit | Qué hizo |
|------|--------|----------|
| 1 — Fix cron + destinatarios + testabilidad | `2a41048` | `maybeRunWeeklyReportCron(nowTs, sendFn)` async inyectable sin `now` fantasma; `_reportRecipients()` (REPORT_EMAILS CSV → ADMIN_EMAIL → admin activo de auth.json); `sendWeeklyReport` acepta string/array y manda `to` como array a Resend; endpoint manual multi-destinatario con regex de email; `globalThis.__weeklyReport` expuesto |
| 2 — Data al CALL METRICS CORE + sin WSP | `be1445d` | `buildWeeklyReportData` usa `_ccCollectCalls`/`_ccFunnelAggregate` con `visibleSet = _SUPERVISOR_EXCLUSION_SET` (Ignacio/Paula fuera de agregados, calendario y tabla); clave `wsp` eliminada de data y HTML; tabla "Por SDR" con columna Atendidas; assertion de onboarding.test.js actualizada a `toBeUndefined()` |
| 3 — Persistencia reports.json | `b13d051` | export-data (bloque `reports`), import-data (validación objeto + restore), seedVolumeFromRepo, BACKUP_FILES y `extras` de pre-deploy.js — regla #21/#128 |

## Verificación

- `node --check index.js` y `node --check scripts/pre-deploy.js` → OK.
- Smoke cron (Task 1): martes no corre; lunes 09:00 AR manda exactamente 1 vez; segundo tick del mismo lunes bloqueado por anti-duplicado persistido → "OK cron".
- Smoke data (Task 2): sin clave `wsp`, HTML sin "WhatsApp" ni "Conexiones" → "OK data+html".
- `npx vitest run tests/onboarding.test.js tests/metrics-consistency.test.js tests/faqs.test.js` → 90/90 verdes (incluye A4 del semanal, el 500 sin RESEND_API_KEY y el export-data).
- Grep gates: `now.getTime()/now.toISOString()` en el bloque del reporte → 0; `conexionesNew`/`respondieronTotal` → 0; `'reports.json'` en index.js → 3; `💬 WhatsApp` → 0.
- Backend-only: sin cache-buster, sin tocar public/ (regla de la phase).

## Deviations from Plan

### Nota menor (no requirió cambio de código)

**1. Gate grep "Por SDR" esperaba 2 y da 3**
- **Found during:** Task 2 (acceptance criteria)
- **Issue:** el conteo calibrado del plan (título del mail + comentario preexistente de pool-setter-breakdown) no contaba el comentario `// Por SDR: llamadas de la semana...` que el PROPIO código prescripto por el plan introduce en `buildWeeklyReportData`.
- **Resolución:** las 3 ocurrencias son legítimas y esperadas por el action del plan — no se tocó código para forzar el conteo.

Fuera de eso: plan ejecutado exactamente como estaba escrito.

## Known Stubs

Ninguno. (`deals` en 0 dentro de `_ccFunnelAggregate` cuando no hay citas 'ganada' es comportamiento del core preexistente, no un stub de este plan.)

## Acción pendiente del user

Para que el reporte SALGA en producción:
1. **`RESEND_API_KEY`** en Railway → Variables (Resend Dashboard → API Keys → Create API Key). Sin ella el cron loguea "RESEND_API_KEY no configurada" y no manda nada.
2. **`REPORT_EMAILS`** (opcional) en Railway → Variables: CSV de destinatarios, ej. `socio1@x.com,socio2@x.com,socio3@x.com`. Sin ella, fallback a `ADMIN_EMAIL`.

## Self-Check: PASSED

- index.js contiene `globalThis.__weeklyReport` ✓
- scripts/pre-deploy.js contiene `'reports', 'reports.json'` ✓
- tests/onboarding.test.js con assertion `wsp` actualizada ✓
- Commits `2a41048`, `be1445d`, `b13d051` en git log ✓

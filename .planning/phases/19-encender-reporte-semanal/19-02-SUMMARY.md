---
phase: 19-encender-reporte-semanal
plan: 02
subsystem: reportes
tags: [weekly-report, tests, regresion, cron, tz-negocio]
requires:
  - globalThis.__weeklyReport (superficie de test creada por 19-01)
  - globalThis.__metricsAudit (_bizStartOfDay/_bizDayOfWeek — cálculo del fixture)
  - Bloques reports en export-data/import-data (19-01 Task 3)
provides:
  - tests/weekly-report.test.js — regresión completa del reporte semanal (REP-01/02/03)
  - Gate de cierre de phase — suite completa del repo verde (848/848)
affects:
  - Phase 21 (el reporte diario hereda esta base testeada)
tech-stack:
  added: []
  patterns:
    - "Setup DATA_DIR=tmpdir + auth.json pre-populado ANTES de import (patrón metrics-timezone-attribution)"
    - "API keys a '' definida-vacía, jamás delete (regla #121)"
    - "sendFn fake inyectado — cero red desde tests (patrón campaignEngineTick)"
key-files:
  created:
    - tests/weekly-report.test.js
  modified: []
decisions:
  - "Fechas fijas determinísticas (2026-07-27 y 2026-08-03, lunes reales) en vez de mocks de reloj — el cron acepta nowTs inyectable, no hace falta fake timers"
  - "El fixture de exclusión usa setter_ignacio real (ADMIN_ONLY_SETTER_IDS) con user u_ign en auth.json para que la atribución by→setterId sea la de producción"
metrics:
  duration: ~4 min
  completed: 2026-07-25
  tasks: 2
  tests: 12 nuevos / 848 totales verdes
---

# Phase 19 Plan 02: Test de regresión del reporte semanal Summary

Regresión automatizada del cron semanal (ventana lunes-8am en TZ de negocio, anti-duplicado del bug de los 16 mails, fallo-no-persiste, destinatarios CSV, shape sin WSP con Ignacio excluido, round-trip export/import de reports.json) + suite completa del repo verde como gate de cierre de la phase.

## Tasks ejecutadas

| Task | Commit | Qué hizo |
|------|--------|----------|
| 1 — tests/weekly-report.test.js | `79b5d26` | 12 tests: 6 del cron (fuera de ventana martes y lunes 07:30 AR; anti-dup con 1 solo envío por lunes; caso TZ lunes 23:00 AR = martes UTC; re-envío al lunes +7d; fallo no persiste + reintento), 2 de destinatarios (CSV con espacios → array, fallback ADMIN_EMAIL, array entregado al sender), 2 de shape (sin clave `wsp`, funnel canónico connects=answered_interested+hung_up, perSetter sin Ignacio; HTML sin WhatsApp/Conexiones/Ignacio), 2 de persistencia (export-data con bloque `reports`, import-data restaura reports.json borrado) |
| 2 — Suite completa (gate de phase) | — (sin cambios de código) | `npm test` → **848/848 tests verdes en 62 files, 14s** — sin ningún flaky esta corrida (ni wa-campaign-engine). 836 previos + 12 nuevos |

## Verificación

- `npx vitest run tests/weekly-report.test.js` → 12/12 verdes al primer run (el código de wave 1 ya estaba en HEAD — tests de regresión sobre implementación existente, no TDD RED/GREEN clásico).
- Grep gates del plan: `process.env.RESEND_API_KEY = ""` → 1; `delete process.env` → 0; `ya_enviado` → 2 matches; `Date.UTC(2026, 6, 28, 2` → 1; `setter_ignacio` → 4 matches; 245 líneas (min 120 ✓).
- `npm test` → exit 0, 848 passed (62 files). Los suites tocados por la phase (weekly-report, onboarding, metrics-consistency) todos verdes.
- Threat model cumplido: DATA_DIR = os.tmpdir() aislado (T-19-06, cleanup en afterAll) + RESEND_API_KEY="" y sendFn fake (T-19-07, cero llamadas de red).

## Deviations from Plan

None — plan ejecutado exactamente como estaba escrito. Nota: el task tenía `tdd="true"` pero la implementación (wave 1) ya existía en HEAD por diseño del plan — los tests pasaron en verde directo, que es exactamente lo esperado para una regresión (si hubieran fallado, sería un bug de 19-01).

## Known Stubs

Ninguno.

## Requisitos cubiertos

- **REP-01**: día/hora/TZ de negocio/anti-duplicado/fallo-no-persiste con regresión (el bug de los 16 mails ahora rompe la suite si vuelve).
- **REP-02**: parsing CSV de REPORT_EMAILS + fallback ADMIN_EMAIL + array entregado al sender.
- **REP-03**: data sin `wsp`, HTML sin sección WhatsApp, Ignacio (admin-only) excluido de totales, perSetter y HTML.

## Self-Check: PASSED

- tests/weekly-report.test.js existe ✓
- Commit `79b5d26` en git log ✓
- Suite completa 848/848 verde ✓

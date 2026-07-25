---
phase: 19-encender-reporte-semanal
verified: 2026-07-25T22:45:00Z
status: passed
score: 8/8 must-haves verified
overrides_applied: 0
re_verification: false
---

# Phase 19: Encender el reporte semanal — Verification Report

**Phase Goal:** el reporte semanal que ya existe deja de estar roto: el cron corre sin crash, sin duplicados, llega a varios destinatarios y no muestra datos engañosos.
**Verified:** 2026-07-25
**Status:** passed
**Re-verification:** No — verificación inicial

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Cron lunes ≥8am (TZ negocio) manda exactamente UN mail/semana, sin ReferenceError, con test de regresión (SC1) | ✓ VERIFIED | `maybeRunWeeklyReportCron(nowTs, sendFn)` en index.js:1857 usa `nowTs` consistentemente (`new Date(nowTs).toISOString()` en :1867); grep del `now` fantasma en el bloque del reporte → 0 matches; tests/weekly-report.test.js cubre martes/lunes-07:30/anti-dup ("el bug de los 16 mails": 2do tick → `ya_enviado`, sendFn llamado exactamente 1 vez)/TZ lunes 23:00 AR/lunes+7d/fallo-no-persiste — 12/12 verdes |
| 2 | `data/reports.json` persiste el último envío y sobrevive redeploys (SC2) | ✓ VERIFIED | 5 puntos de persistencia verificados en código: export-data (index.js:2122, incluido en `res.json` :2138), import-data (destructuring + validación :2217 + `restored.push('reports')` :2248 + hasAny), seedVolumeFromRepo (:4034), BACKUP_FILES (:4087), pre-deploy.js (:186 `['reports', 'reports.json']`); round-trip export→import testeado (2 tests supertest verdes) |
| 3 | El reporte sale a lista configurable de destinatarios (SC3) | ✓ VERIFIED | `_reportRecipients()` (index.js:1818): REPORT_EMAILS CSV con regex de email → ADMIN_EMAIL → admin activo de auth.json; `sendWeeklyReport` acepta string/array y manda `to` como array a Resend (:1837, :1846); tests confirman parsing CSV con espacios, fallback y array entregado al sender |
| 4 | Ninguna sección del mail presenta acumulados históricos como datos de la semana (SC4) | ✓ VERIFIED | Clave `wsp` eliminada de `buildWeeklyReportData` (grep `conexionesNew`/`respondieronTotal` → 0); HTML sin sección WhatsApp (grep `💬 WhatsApp` → 0); secciones restantes: Llamadas (semana), Calendario (realizadas/no-shows semanales + pendientes/atrasadas etiquetadas "(ahora)"), tabla Por SDR de la semana; test asserta `"wsp" in d === false` y HTML sin /WhatsApp|Conexiones/ |
| 5 | Acción del user documentada: RESEND_API_KEY en Railway (SC5) | ✓ VERIFIED | 19-01-PLAN.md frontmatter `user_setup` (RESEND_API_KEY + REPORT_EMAILS opcional con source), 19-01-SUMMARY.md sección "Acción pendiente del user", ROADMAP.md "pendiente del user: RESEND_API_KEY (y opcional REPORT_EMAILS) en Railway" |
| 6 | Ignacio/Paula (ADMIN_ONLY_SETTER_IDS) fuera de toda métrica del reporte | ✓ VERIFIED | `visibleSet = _SUPERVISOR_EXCLUSION_SET` en buildWeeklyReportData (:1760) pasado a `_ccCollectCalls` (que filtra por `visibleSet.has(sid)` — verificado en :5667) y `_ccFunnelAggregate`; calendar filtrado explícito por `ADMIN_ONLY_SETTER_IDS` (:1761); perSetter vía `_filterSettersVisible` (:1783); const incluye setter_ignacio + setter_paula_kroff (:5603); test con fixture de llamada de u_ign→setter_ignacio confirma totalWeek=3 (no 4) y perSetter sin "Ignacio" |
| 7 | Existe test de regresión del cron (día/hora/TZ/anti-duplicado) que rompe la suite si vuelve el bug | ✓ VERIFIED | tests/weekly-report.test.js (245 líneas, 12 tests): usa `globalThis.__weeklyReport` (key link verificado :1903), fake sendFn (cero red, RESEND_API_KEY="" regla #121, cero `delete process.env`), fechas fijas determinísticas con lunes reales 2026-07-27/2026-08-03 |
| 8 | Suite completa del repo verde | ✓ VERIFIED | 848/848 reportado por el orquestador (62 files); re-corrida de las 3 suites clave en esta verificación: weekly-report + onboarding + metrics-consistency → **87/87 verdes en 3.9s** (incluye A4 del semanal y el 500 sin RESEND_API_KEY) |

**Score:** 8/8 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `index.js` | Cron sin ReferenceError + `_reportRecipients()` + buildWeeklyReportData del CALL METRICS CORE + `globalThis.__weeklyReport` | ✓ VERIFIED | Bloque completo leído (líneas 1742-1903); todas las funciones sustantivas, cableadas y con data real (loadSettersData → _ccCollectCalls → agregación) |
| `scripts/pre-deploy.js` | Descarga de reports.json | ✓ VERIFIED | Entrada `['reports', 'reports.json']` en línea 186 del array extras |
| `tests/onboarding.test.js` | Assertion `wsp` actualizada | ✓ VERIFIED | Línea 670: `expect(r.body.data.wsp).toBeUndefined(); // REP-03` |
| `tests/weekly-report.test.js` | Regresión completa (min 120 líneas) | ✓ VERIFIED | 245 líneas, 12 tests, setup patrón metrics-timezone-attribution (DATA_DIR tmpdir aislado, auth pre-populado antes del import) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| maybeRunWeeklyReportCron | saveReportsState | `new Date(nowTs).toISOString()` tras envío exitoso | ✓ WIRED | index.js:1867-1869 — pattern match exacto; fallo de envío NO persiste (intencional) |
| buildWeeklyReportData | _ccCollectCalls/_ccFunnelAggregate | CALL METRICS CORE con visibleSet | ✓ WIRED | index.js:1770-1771 — `_ccCollectCalls(settersData, { visibleSet })`; cero funnel inline (regla milestone) |
| /api/admin/export-data | loadReportsState | bloque reports | ✓ WIRED | index.js:2122 + incluido en res.json |
| tests/weekly-report.test.js | globalThis.__weeklyReport | helpers de 19-01 | ✓ WIRED | Línea 50 del test + expuesto en index.js:1903 |
| tests/weekly-report.test.js | reports.json | rm/lectura en DATA_DIR entre tests | ✓ WIRED | `resetReportsState()` + asserts sobre `loadReportsState()` |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|--------------------|--------|
| buildWeeklyReportData | calls/agg/perSetter | loadSettersData() → _ccCollectCalls (aplana callLog atribuido por `by`) → _ccFunnelAggregate | Sí — verificado con fixture real en test (3 dials, 2 connects) | ✓ FLOWING |
| maybeRunWeeklyReportCron | recipients | REPORT_EMAILS env → ADMIN_EMAIL → auth.json en disco | Sí — test confirma array entregado al sender | ✓ FLOWING |
| export-data | reports | loadReportsState() lee reports.json de DATA_DIR | Sí — round-trip testeado | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Regresión del cron + shape + persistencia | `npx vitest run tests/weekly-report.test.js tests/onboarding.test.js tests/metrics-consistency.test.js` | 3 files, 87/87 passed, 3.9s | ✓ PASS |
| Commits de la phase existen | `git log` | 2a41048, be1445d, b13d051, 79b5d26 todos en HEAD | ✓ PASS |
| Sintaxis | `node --check` (verificado por gates de los planes + tests que importan index.js) | Import de index.js exitoso en los 3 suites | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| REP-01 | 19-01, 19-02 | Cron sin crash y sin duplicados + test de regresión | ✓ SATISFIED | Truths 1 y 7; REQUIREMENTS.md marcado [x] |
| REP-02 | 19-01, 19-02 | Múltiples destinatarios configurables | ✓ SATISFIED | Truth 3; REQUIREMENTS.md marcado [x] |
| REP-03 | 19-01, 19-02 | Sin acumulados históricos bajo encabezado "semana" | ✓ SATISFIED | Truths 4 y 6; REQUIREMENTS.md marcado [x] |

Sin requirements huérfanos: REQUIREMENTS.md mapea exactamente REP-01/02/03 a Phase 19 y los 3 aparecen en ambos planes.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | Ninguno en el código de la phase | — | Sin TODO/FIXME/placeholder/stub en el bloque del reporte ni en los tests; `RESEND_API_KEY` nunca logueada |

### Code Review Warnings (evaluados contra el goal)

Los 3 warnings del 19-REVIEW.md son mejoras de robustez operativa, NO gaps contra el goal de la phase:

- **WR-01** (envío manual mié-dom suprime el mail del lunes): edge case que requiere acción manual del admin; no produce crash ni duplicados. Si ocurre, la semana igual fue reportada (por el envío manual). Comportamiento heredado del código viejo. Advisory.
- **WR-02** (REPORT_EMAILS mal configurada → fallback silencioso a ADMIN_EMAIL): la lista ES configurable (SC3 cumplido); es un caso de mala configuración sin log de aviso. Advisory.
- **WR-03** (anti-dup depende de write a disco): el bug primario (ReferenceError → 16 mails) está arreglado y con regresión; el escenario residual requiere fallo de disco del Railway Volume un lunes. Defensa en profundidad opcional. Advisory.

Ninguno bloquea el cierre de la phase. Quedan disponibles como candidatos de hardening para Phase 21 (reporte diario se monta sobre esta base).

### Human Verification Required

Ninguna. Los 5 success criteria del ROADMAP son verificables programáticamente y SC1 define explícitamente el método de verificación como test de regresión (cumplido). La verificación en vivo del mail en producción depende de la acción pendiente del user (cargar `RESEND_API_KEY` en Railway), que SC5 exige solo como **documentada** — y lo está. Nota operativa (no gap): tras cargar la key, el primer lunes confirmar la llegada de UN solo mail a la lista.

### Gaps Summary

Sin gaps. Las 8 truths verificadas contra el código real (no contra los SUMMARYs): el ReferenceError del `now` fantasma no existe más en el bloque del reporte, el anti-duplicado persiste con `nowTs`, los destinatarios son configurables con doble fallback, la sección WhatsApp con acumulados all-time desapareció de data y HTML, Ignacio/Paula quedan fuera de agregados/calendario/tabla, reports.json está en los 5 puntos de persistencia, y la regresión de 12 tests + suite completa verde blindan todo lo anterior.

---

_Verified: 2026-07-25_
_Verifier: Claude (gsd-verifier)_

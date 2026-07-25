---
phase: 19-encender-reporte-semanal
reviewed: 2026-07-25T22:40:00Z
depth: standard
diff_base: b656b08
files_reviewed: 4
files_reviewed_list:
  - index.js
  - scripts/pre-deploy.js
  - tests/onboarding.test.js
  - tests/weekly-report.test.js
findings:
  critical: 0
  warning: 3
  info: 4
  total: 7
status: issues
---

# Phase 19: Code Review Report — Encender el reporte semanal

**Reviewed:** 2026-07-25
**Depth:** standard (acotado al diff `b656b08..HEAD`)
**Files Reviewed:** 4
**Status:** issues (0 críticos, 3 warnings, 4 info)

## Summary

Revisé los 4 commits de la phase (2a41048, be1445d, b13d051, 79b5d26) contra el diff completo. El núcleo del trabajo está bien hecho:

- **Fix del cron (REP-01) correcto**: el `ReferenceError` del `now` fantasma está eliminado; `maybeRunWeeklyReportCron(nowTs, sendFn)` es inyectable (patrón regla #72), el anti-duplicado usa `nowTs` consistentemente, los timers tienen `.catch()`, y el fallo de envío NO persiste `lastWeeklyReportAt` (reintenta al tick siguiente). Ventana lunes ≥8am verificada contra `_bizDayOfWeek`/`_bizHour` (lunes=1, TZ de negocio — regla #113 cumplida).
- **Migración al CALL METRICS CORE (REP-03) correcta**: `_ccCollectCalls` + `_ccFunnelAggregate` con firma verificada; `agg.rates.connectRate` es Number (el `.toFixed(1)` es válido); exclusión de `ADMIN_ONLY_SETTER_IDS` aplicada coherentemente en calls (vía `_SUPERVISOR_EXCLUSION_SET`, que solo necesita `.has()` — verificado que `_ccCollectCalls` no usa otra cosa), calendar (filtro explícito) y `perSetter` (`_filterSettersVisible`).
- **Persistencia (b13d051) completa**: export-data (nunca emite `null` — `loadReportsState` degrada a `{}` internamente), import-data (validación de shape consistente con `scrapeBatches`), pre-deploy (`saveFile` skipea `undefined` si el server viejo no manda el bloque), `seedVolumeFromRepo` y `BACKUP_FILES`.
- **Tests**: 69/69 verdes (corridos en esta review). Regla #121 cumplida (`RESEND_API_KEY=""`, jamás `delete`). RBAC admin-only en preview/send confirmado. Ningún secret en logs.

Los hallazgos son de robustez operativa, no de corrección del código nuevo. El más relevante es WR-01: probar el envío manual entre miércoles y domingo suprime silenciosamente el mail automático del lunes siguiente — exactamente el mail que esta phase vino a "encender".

## Warnings

### WR-01: El envío manual suprime el reporte automático del lunes siguiente

**File:** `index.js:1895-1898` (endpoint `/api/admin/weekly-report/send`) + `index.js:1862` (anti-dup del cron)
**Issue:** El endpoint manual persiste `lastWeeklyReportAt = ahora`, y el cron skipea con `(nowTs - last) < 6 días`. Si el admin dispara un envío de prueba cualquier día entre miércoles y domingo (el caso típico post-deploy: "probemos que el mail sale"), el lunes siguiente el cron devuelve `ya_enviado` y el reporte automático NO sale — silenciosamente. Contradice el objetivo de REP-01 (mail todos los lunes). El comportamiento es heredado del código viejo, pero el endpoint se reescribió en esta phase y la phase existe precisamente para garantizar el envío del lunes.
**Fix:** No actualizar `lastWeeklyReportAt` en el envío manual (guardar en un campo aparte `lastManualSendAt` si se quiere trazabilidad), o cambiar el anti-dup del cron de "ventana de 6 días" a "¿`last` cae en o después del lunes de ESTA semana?" (comparar contra `thisMonday` calculado con los mismos helpers `_biz*` que ya usa `buildWeeklyReportData`):
```js
// en maybeRunWeeklyReportCron:
const todayStart = _bizStartOfDay(nowTs);
const thisMonday = todayStart - ((_bizDayOfWeek(todayStart) || 7) - 1) * 86400000;
if (last && last >= thisMonday) return { ran: false, reason: 'ya_enviado' };
```

### WR-02: `REPORT_EMAILS` mal configurada cae en fallback silencioso a ADMIN_EMAIL

**File:** `index.js:1818-1831` (`_reportRecipients`)
**Issue:** Si `REPORT_EMAILS` está seteada pero TODAS sus entradas fallan la regex (error típico: separar con `;` en vez de `,` → `"a@x.com;b@x.com"` es un solo token inválido), la lista queda vacía y se cae a `ADMIN_EMAIL` **sin ningún log** — el equipo cree que el reporte llega a la lista configurada y solo lo recibe el admin. Además: (a) los fallbacks `ADMIN_EMAIL` y auth.json NO pasan por la misma validación de formato que las entradas del CSV (inconsistente), y (b) no se deduplican entradas repetidas antes de mandarlas a Resend.
**Fix:**
```js
if (csv && !list.length) console.warn(`REPORT_EMAILS seteada pero sin emails válidos ("${csv}") — fallback a ADMIN_EMAIL`);
// y dedup:
list = [...new Set(list)];
```

### WR-03: El anti-duplicado depende de un write a disco cuyo fallo se traga

**File:** `index.js:1752-1754` (`saveReportsState`) + `index.js:1866-1869` (cron)
**Issue:** `saveReportsState` hace catch + `console.warn` y sigue. Si el write a `reports.json` falla un lunes (volumen lleno/read-only — raro pero es Railway Volume), `lastWeeklyReportAt` nunca persiste y **cada tick horario del lunes re-manda el mail**: el bug de los 16 mails que esta phase arregló reaparece bajo fallo de disco, porque la única defensa es ese archivo. El helper es pre-existente, pero la dependencia exclusiva en él es el diseño nuevo.
**Fix:** Guard in-memory de cinturón y tiradores (sobrevive dentro del proceso aunque el disco falle):
```js
let _weeklyReportSentAtMem = 0;
// en maybeRunWeeklyReportCron, junto al check de state:
const last = Math.max(_weeklyReportSentAtMem, state.lastWeeklyReportAt ? new Date(state.lastWeeklyReportAt).getTime() : 0);
// tras result.sent:
_weeklyReportSentAtMem = nowTs;
```

## Info

### IN-01: Test de destinatarios muta `process.env.REPORT_EMAILS` sin try/finally

**File:** `tests/weekly-report.test.js:181-184`
**Issue:** El primer test del describe "destinatarios" setea `REPORT_EMAILS` y lo restaura inline; si el primer `expect` falla, el valor queda leakeado para los tests siguientes (el segundo test del mismo describe sí usa try/finally).
**Fix:** Envolver en try/finally como el test de al lado, o usar `afterEach` que resetee a `""`.

### IN-02: Fixture de fechas calculado en `beforeAll` vs ventana calculada en runtime

**File:** `tests/weekly-report.test.js:81-84` + `203-215`
**Issue:** `thisMonday` del fixture se calcula una vez en `beforeAll`, pero `buildWeeklyReportData` recalcula su ventana al ser llamada. Una corrida que cruce el lunes 00:00 TZ de negocio entre ambos momentos desplaza la ventana 7 días y los tests de shape fallarían (misma clase de flakiness de medianoche que motivó el fix del CI #130). Probabilidad ínfima (solo domingo→lunes exacto), y el CI ya corre en TZ AR.
**Fix:** Ninguno urgente; si algún día flakea un domingo a medianoche, esta es la causa.

### IN-03: `s.name` interpolado en el HTML del mail sin escape

**File:** `index.js:1811` (`buildWeeklyReportHtml`)
**Issue:** Los nombres de setter se inyectan crudos en el HTML del email. Son datos creados por el admin (riesgo real bajo) y el patrón es pre-existente (no introducido por esta phase), pero un nombre con `<` rompería el layout del mail.
**Fix:** Helper de escape mínimo (`&<>"`) al interpolar `s.name`.

### IN-04: Llamadas sin atribuir cuentan en el total pero no aparecen en ninguna fila de la tabla

**File:** `index.js:1770-1790` (`buildWeeklyReportData`)
**Issue:** Entries de users borrados (`_callSetterId` → `''`, regla #149) pasan el pseudo-set (`has('') === true`) → suman en `calls.totalWeek`/`answeredWeek`/`deadWeek`, pero no matchean ninguna fila de `perSetter` → la columna "Llamadas" de la tabla puede no sumar el total del header. Es consistente con la semántica del CALL METRICS CORE (intencional), solo puede confundir al lector del mail.
**Fix:** Opcional — fila "Sin atribuir" cuando `weekCalls.some(c => !c.setterId)`, o dejarlo documentado.

---

**Verificado y descartado (sin hallazgo):**
- TDZ de `_SUPERVISOR_EXCLUSION_SET`/`ADMIN_ONLY_SETTER_IDS` (definidos en línea ~5603, usados en ~1760): no aplica — solo se evalúan en runtime (cron diferido 60s / handlers), el module load completa antes.
- `_ccFunnelAggregate` recibe el calendar ya filtrado + `visibleSet` de nuevo: redundante pero inocuo (el visibleSet solo afecta deals, que el reporte no usa).
- Export con `reports: null` rompiendo un import posterior: imposible — `loadReportsState` nunca lanza (devuelve `{}`).
- `pre-deploy.js` contra un server viejo sin bloque `reports`: `saveFile` skipea `payload == null` correctamente.
- `lastWeeklyReportTo` cambió de string a array: sin consumidores de lectura en el codebase (solo escrituras).
- Doble envío por ticks solapados: los ticks distan ≥59min y undici aborta fetches colgados a los ~5min — no alcanzan a solaparse.
- Retro-compat de `sendWeeklyReport(string|array)`: correcta, con guard de lista vacía.
- Reglas CLAUDE.md: TZ vía `_biz*` ✓, funnel vía CALL METRICS CORE ✓ (cero re-implementación inline), sin `RESEND_API_KEY` en logs ✓, endpoints admin-only ✓, regla #121 en tests ✓.

_Reviewed: 2026-07-25_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

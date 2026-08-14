---
phase: 28-quick-alivio-inmediato
plan: 01
subsystem: frontend-calendar-picker
tags: [ui-component, vanilla-js, popover, calendar]
dependency-graph:
  requires: []
  provides: [window._dtPicker, dtpicker-pure-helpers]
  affects: [public/app.js, public/style.css, public/index.html]
tech-stack:
  added: []
  patterns:
    - "extracción de bloque literal por marcadores de texto para tests puros (sin jsdom)"
    - "popover anclado (getBoundingClientRect + clamp viewport) — sin precedente previo en el repo"
    - "attach idempotente con fallback try/catch (input nativo visible si el componente falla)"
key-files:
  created:
    - tests/dtpicker-core.test.js
  modified:
    - public/app.js
    - public/style.css
    - public/index.html
decisions:
  - "Draft inicial (día de hoy 10:00) se pre-selecciona visualmente al abrir con el input vacío, pero NO se escribe en el input hasta la primera interacción (evita escrituras fantasma)"
  - "El calendario NO se enchufa a ningún modal en este plan — el componente queda expuesto en window._dtPicker para que 28-02 lo consuma"
metrics:
  duration: "~10 minutos"
  completed: 2026-08-14
---

# Phase 28 Plan 01: Componente calendario propio (popover) Summary

Componente de calendario propio (popover anclado, mes navegable, franjas horarias 09:00–19:00 + minutos exactos, etiqueta relativa "Martes 18/08 · en 4 días · 10:00") expuesto en `window._dtPicker`, con 8 helpers puros de fecha testeados aisladamente y sin ninguna dependencia del `<input type="datetime-local">` nativo que reemplaza visualmente.

## What Was Built

- **Bloque `DTPICKER-PURE`** en `public/app.js` (entre marcadores literales `// ─── [28-01] DTPICKER-PURE: INICIO ───` / `FIN`): 8 funciones puras (`_dtpPad2`, `_dtpFormatValue`, `_dtpParseValue`, `_dtpDayKey`, `_dtpBuildMonthGrid`, `_dtpRelativeLabel`, `_dtpFullLabel`, `_dtpCountByDay`). Cero dependencias de DOM/red/almacenamiento — el test las extrae por los marcadores y las evalúa con `new Function(...)`.
- **Componente popover** (mismo archivo, inmediatamente después del bloque puro): estado de módulo (`_dtpPop`, `_dtpState`, `_dtpCleanup`) + funciones públicas `_dtPickerAttach`/`_dtPickerSync`/`_dtPickerSet`/`_dtPickerClose`, espejadas en `window._dtPicker = { attach, sync, set, close }`.
  - `attach(input, opts)`: crea un `button.dtp-trigger` justo después del input, oculta el input nativo (`display:none`), y queda idempotente (reabrir el modal no duplica nada, solo repinta el trigger).
  - El popover se crea una sola vez (`_dtpEnsurePop`, cacheado en `_dtpPop`) y se reusa en cada apertura.
  - Cada interacción (click en día, click en franja horaria, cambio del input de minutos) **commitea al instante** vía `_dtPickerSet` — no hay estado "sin guardar" que se pueda perder al cerrar.
  - Cierre: Escape en fase de captura con `stopPropagation()` (no cierra el modal de abajo), `pointerdown` fuera del popover/trigger, y `resize` de la ventana.
  - Anclaje con `getBoundingClientRect()` + clamp al viewport (abre arriba si no entra abajo).
- **CSS** (`public/style.css`, bloque `/* ── Phase 28: date picker (.dtp-*) ── */`): `.dtp-field`, `.dtp-trigger`, `.dtp-pop`, `.dtp-head`, `.dtp-nav`, `.dtp-today`, `.dtp-month`, `.dtp-week`, `.dtp-grid` (grid 7 columnas), `.dtp-day` (+ `.is-out`/`.is-today`/`.is-sel`/`.is-past`), `.dtp-slots`, `.dtp-slot` (+ `.is-sel`), `.dtp-time`, `.dtp-foot`, `.dtp-preview`, `.dtp-leadtime` (vacío en este plan, lo llena 28-02), `.dtp-done`, `.dtp-load` (badge de carga por día, lo usa 28-02). Tokens del Design System v1.1 exclusivamente.
- **Cache-buster** bumpeado en `public/index.html`: `app.js?v=20260814a` y `style.css?v=20260814a`.
- **`tests/dtpicker-core.test.js`**: 10 tests que fijan el contrato — formato exacto, round-trip, day-key local (nunca `toISOString`), grilla de 42 celdas empezando en lunes, etiqueta relativa Hoy/Mañana/en N días/hace N días, etiqueta completa D-04, y `_dtpCountByDay` (D-07: callbacks manuales del dueño + entries de calendario, excluye cadencia automática y estados `cancelada`/`reagendada`).

## Deviations from Plan

None — plan ejecutado exactamente como estaba escrito.

## Verification

- `npx vitest run tests/dtpicker-core.test.js` → 10/10 PASS.
- `npx vitest run tests/dtpicker-core.test.js tests/app-version.test.js` → 11/11 PASS.
- `node --check public/app.js` → sin errores de sintaxis.
- `npm test` completo → **1191/1191 PASS** (baseline previo ~1181 + 10 nuevos de este plan).
- `grep -c "DTPICKER-PURE: INICIO"` / `FIN` → 1 y 1.
- Bloque entre marcadores sin `document`/`window.`/`fetch(`/`localStorage` → 0 ocurrencias.
- `grep -c "function _toDatetimeLocal"` → 1 (función original intacta).
- `window._dtPicker` asignado una vez con exactamente las 4 claves `attach`/`sync`/`set`/`close`.
- `.dtp-pop` sin la clase `modal-overlay` (0 ocurrencias dentro de `_dtpEnsurePop`).
- CSS: `.dtp-pop`, `.dtp-grid`, `.dtp-day`, `.dtp-slot`, `.dtp-trigger`, `.dtp-load` todos presentes.
- Cache-buster: `app.js?v=20260814a` y `style.css?v=20260814a` confirmados en `index.html`.
- Los 5 `<input type="datetime-local">` (`schedule-datetime`, `call-sched-fecha`, `call-ph-fecha`, `call-cb-fecha`, `agendar-fecha`) siguen existiendo, sin tocar, mismos `id`.
- `git diff --stat package.json package-lock.json` → vacío (T-28-SC, sin instalar nada).

### Human-check NO ejecutado (limitación del entorno de este ejecutor)

El `<human-check>` de la Task 2 describe abrir el modal "Volver a llamar" en el preview y ver el trigger + popover en vivo. Ese flujo **requiere el wiring a los 5 modales, que es explícitamente el alcance del plan 28-02** (el `<objective>` de este plan lo dice literal: "NO lo enchufa a ningún modal todavía — eso es el plan 28-02"). Además, este ejecutor no tuvo disponible ninguna herramienta de browser/preview (`preview_start`, `javascript_tool`, screenshot) en su set de tools — solo Read/Write/Edit/Bash/Grep/Glob. La verificación se hizo por la vía disponible más fuerte: extracción del bloque real de `app.js` + evaluación aislada de los helpers puros (10 tests), revisión de código línea por línea contra la especificación exacta del plan, y validación estática (`node --check`, greps de los acceptance criteria). **Queda pendiente de verificación visual en 28-02**, cuando el popover ya esté enchufado a un input real y se pueda abrir Llamadas → un lead → "Volver a llamar" en el preview.

## Threat Model Coverage

| Threat ID | Mitigation | Status |
|-----------|-----------|--------|
| T-28-01 (XSS) | Todo texto derivado de datos usa `textContent` (`trigger.textContent`, `previewEl.textContent`); el único `innerHTML` es markup estático + números que el propio componente genera (días del mes, horas) — nada del lead se interpola todavía (eso es 28-02) | Cumplido |
| T-28-02 (contrato de formato) | `_dtpFormatValue` emite exclusivamente `YYYY-MM-DDTHH:mm`; `tests/dtpicker-core.test.js` fija el contrato con round-trip | Cumplido |
| T-28-03 (DoS auto-infligido) | `_dtPickerAttach` idempotente + `try/catch`; si falla, el input nativo queda visible porque `input.style.display='none'` solo se ejecuta si toda la creación del wrapper tuvo éxito | Cumplido |
| T-28-SC (paquetes) | Cero instalaciones — `git diff --stat package.json package-lock.json` vacío | Cumplido |

## Self-Check

- `tests/dtpicker-core.test.js` existe: FOUND
- Bloque `DTPICKER-PURE` en `public/app.js`: FOUND (1 INICIO, 1 FIN)
- `window._dtPicker` en `public/app.js`: FOUND (línea única de asignación)
- CSS `.dtp-*` en `public/style.css`: FOUND
- Commit `b3332a9` (Task 1): FOUND en `git log`
- Commit `17575e4` (Task 2): FOUND en `git log`

## Self-Check: PASSED

## Next Steps

Plan 28-02 enchufa `window._dtPicker.attach(...)` a los 5 inputs `datetime-local` reales (`#call-cb-fecha`, `#call-sched-fecha`, `#agendar-fecha`, `#call-ph-fecha`, `#schedule-datetime`), agrega la hora local del lead (D-06) al `.dtp-leadtime` vía `opts.getLead`, y la carga por día (D-07, badges `.dtp-load`) vía `opts.load` + `_dtpCountByDay`. Ahí corresponde el human-check real en preview.

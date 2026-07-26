---
phase: 20-disposicion-obligatoria
plan: 03
subsystem: frontend
tags: [vanilla-js, telnyx, call-disposition, power-dialer, enforcement, ux]

# Dependency graph
requires:
  - phase: 20-disposicion-obligatoria plan 01
    provides: "POST/GET /api/setters/pending-calls, call-disposition con autoMarked/correctsAutoMarked/pendingCallId, GET /api/setters/disposition-audit"
  - phase: CALL-METRICS-CORE (2026-07-24)
    provides: "vista Equipo (_teamLoad) donde engancha la auditoría"
provides:
  - "Gate en vivo D-01: _dispoGate bloquea TODO discado en _startTelnyxCall (un solo guard cubre lista/Hoy/PD/autopiloto/tecla C/alt-contact/Ctrl+K/ad-hoc) + banner persistente con Ir a marcar"
  - "Auto-marca D-03: no-contacto (ni 'active' ni voz sostenida) → no_answer automático corregible 15 min sin duplicar el dial"
  - "Franja D-02: recordatorio NO bloqueante 'Tenés N llamadas sin marcar' con resolución vía el dropdown normal"
  - "Auditoría D-06 en Equipo: distribución por SDR + % marcada + sospechosas con samples"
affects: [21 reporte diario, 22 coaching IA, 23 alertas]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "un solo guard en _startTelnyxCall cubre todos los puntos de discado (no N guards dispersos)"
    - "enforcement body mergeado PRIMERO en los 5 POST — la meta fresca de _consumeTelnyxMeta pisa la del record de la franja"
    - "restore del gate tras refresh valida contra el server antes de re-armar (no bloquea a ciegas)"

key-files:
  created: []
  modified:
    - public/app.js
    - public/index.html
    - public/style.css

key-decisions:
  - "fromNumber se manda en la CREACIÓN del pendiente (el backend 20-01 lo acepta solo ahí) — la franja y la auditoría D-06 conservan el caller ID real"
  - "El fallback de _autoMarkNoAnswer ante red caída arma el gate manual — la llamada nunca queda en limbo"
  - "Restore del gate: si el server es inaccesible NO se re-arma (bloquearía el discado sin datos); el pendiente igual existe server-side"

patterns-established:
  - "_dispoFocusLeadRow: helper único de navegación+scroll+focus al select (banner y franja comparten el retry-pattern de _focusDispositionRow)"

requirements-completed: [DISP-01, DISP-02, DISP-03]

# Metrics
duration: 25min
completed: 2026-07-26
---

# Phase 20 Plan 03: Enforcement frontend de la disposición obligatoria Summary

**Gate en vivo con banner (sin marcar no hay próxima llamada), auto-marca determinística de no-contactos corregible 15 min, franja recordatorio no bloqueante para lo que escapa al vivo, y auditoría pasiva por SDR en Equipo**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-26T14:27:37Z
- **Completed:** 2026-07-26T14:52:00Z
- **Tasks:** 3
- **Files modified:** 3 (public/app.js, public/index.html, public/style.css)

## Accomplishments

- **D-01 (gate en vivo):** `_dispoGate` + guard único en `_startTelnyxCall` (entre el check de activeCall y el fetch de config) bloquea TODO punto de discado — incluidos autopiloto (`_pdStartAutopilotCountdown` retorna temprano), tecla C, Ctrl+K y ad-hoc, porque todos pasan por `_startTelnyxCall`. Banner persistente fixed-bottom dice QUÉ llamada falta marcar, con botón "Ir a marcar" que navega+scrollea+foca el select (retry 12×400ms). Sin modal que tape la pantalla.
- **D-03 (auto-marca conservadora):** la bifurcación al colgar usa `enteredActive || committedRemote` — NO solo 'active', porque este carrier entrega llamadas atendidas por early-media sin señalizar 'active' (auto-marcarlas como no_answer corrompería el dato de D-06). Sin señal de contacto → `_autoMarkNoAnswer` postea `no_answer` con `autoMarked:true` + meta Telnyx; toast avisa "Corregilo si hubo contacto"; el foco al dropdown queda para corregir con las teclas 1-9. `_lastAutoMark` habilita `correctsAutoMarked` 15 min client-side (defensa doble con el 409 del backend). En Power Dialer replica el post-save de #151 (autopilot avanza, manual holdea con banner "No atendió (auto)").
- **D-02 (registro + franja):** el pendiente se registra server-side al INICIAR la llamada (sobrevive crash del tab); llamadas fallidas (<1s o catch de startCall) se cancelan. La franja `#dispo-pending-strip` en Llamadas muestra los pendientes propios (excluye el cubierto por el gate), expandible, con botón "Marcar" que delega el 100% al dropdown normal — CERO bloqueo, cero POST propio, comentario en el código citando la decisión del user. `_dispoEnforcementBody` adjunta `pendingCallId` + la meta del record (duration/fromNumber reales) solo si el call site no trae meta fresca.
- **D-06 (auditoría en Equipo):** sección "Auditoría de disposiciones" al final de view-team — tabla por SDR (Llamadas · % marcada · distribución top 3 con `callOutcomeLabel` · sospechosas con `<details>` de samples y regla en humano "no-contacto >30s" / "contacto <10s"), fetch con `apiUrl()` (regla #146), período mapeado day/week/month → today/7d/30d, sin render con `bySetter` vacío, nota de transparencia del canal manual.
- **Intactos (verificado por diff):** buffer de transcripción de 10 min (D-04 — cero líneas tocadas en ese rango), `_pdKeyOutcomes` (1 sola definición, mismos 9), shortcutMap 1-9, `_syncCallRecording`/`_recBindChannel`, `_autoDispositionLLM`.
- Cache-busters bumpeados: `app.js?v=20260725b` y `style.css?v=20260725a` (1 ocurrencia exacta de cada uno).

## Task Commits

Each task was committed atomically:

1. **Task 1: Gate en vivo + auto-marca de no-contactos (D-01 + D-03)** - `c9c3f0c` (feat)
2. **Task 2: Franja de pendientes NO bloqueante + estilos (D-02)** - `f0e8385` (feat)
3. **Task 3: Auditoría en Equipo + cache-busters (D-06)** - `77c7f1e` (feat)

## Files Created/Modified

- `public/app.js` - bloque Phase 20 junto a `_telnyxCallState` (estado, banner, `_dispoFocusLeadRow`, `_autoMarkNoAnswer`, restore, franja); guard en `_startTelnyxCall` + registro/cancelación del pendiente; bifurcación en `_onTelnyxCallEnded`; enforcement en los 5 POST de call-disposition; `_teamLoadDispoAudit` en la vista Equipo
- `public/index.html` - `#dispo-pending-strip` en view-calls, `#team-dispo-audit` en view-team, cache-busters
- `public/style.css` - bloque `/* Phase 20: disposición obligatoria */` (.dispo-gate-banner, .dispo-strip, sin emojis, sin backdrop-filter)

## Decisions Made

- **`fromNumber` en la creación del pendiente:** el snippet del plan no lo incluía, pero el backend 20-01 lo acepta solo en la creación y la franja/auditoría lo aprovechan (caller ID real en el record). Sumado al POST inicial.
- **`typeof _dispoLoadPendingStrip === 'function'` en vez de optional call:** `_dispoLoadPendingStrip?.()` lanzaría ReferenceError si el identificador no existiera (optional chaining no cubre identificadores no declarados); el typeof-guard hace que Task 1 funcione solo, como pedía el plan.
- **`_telnyxCallState.pendingRegistered` se resetea ANTES del try de startCall:** sin eso, un fallo de `ensureClient` podía cancelar el pendiente de una llamada ANTERIOR.
- **Posicionamiento del banner inline en JS + visual en CSS:** el fixed/bottom/z-index crítico va inline al crear el div (funciona aún si el CSS viejo está cacheado); el resto en `.dispo-gate-banner`.

## Deviations from Plan

### Auto-fixed Issues

Ninguna desviación de fondo — las 4 decisiones de arriba son micro-ajustes de implementación dentro del espíritu del plan (documentadas en Decisions Made). El resto se ejecutó exactamente como estaba escrito.

## Issues Encountered

None.

## Known Stubs

None — gate, auto-marca, franja y auditoría están cableados a los endpoints reales de 20-01.

## Preview checklist (a-f)

**Status: PENDIENTE — delegado al orquestador** (este executor no tiene herramientas de browser). Checklist a ejecutar en preview (`DATA_DIR=tmp/preview-data`, nota #15 de CLAUDE.md):

- [ ] a. Login admin → view-calls carga sin errores de consola.
- [ ] b. Consola: `window._leadStoreApply` existe; simular gate (vía flujo o exponiendo temporalmente los helpers) → banner visible con el texto correcto → `_startTelnyxCall('<leadId real>')` retorna con toast de bloqueo (0 llamadas iniciadas).
- [ ] c. Sembrar `tmp/preview-data/pending_calls.json` con 2 registros del setter del admin → recargar → franja "Tenés 2 llamadas sin marcar" visible, expandible, botón Marcar navega y foca el dropdown → marcar una → POST sale con `pendingCallId` → franja pasa a 1.
- [ ] d. Equipo: sembrar callLog con no_answer duration 45 y answered_interested duration 5 → auditoría muestra 2 sospechosas con reglas correctas y % marcada coherente.
- [ ] e. Power Dialer abre, atajos 1-9 y S/C/B responden, autopiloto togglea (A) — success criterion 3.
- [ ] f. `fetch('/app.js?v=20260725b')` devuelve el archivo nuevo (cache-buster efectivo).

## User Setup Required

Nota para el deploy:
- Las SDRs deben recargar el tab UNA vez tras el deploy (el banner de versión #152 avisa a los tabs viejos).
- La regla arranca de cero (D-05): llamadas viejas sin marcar no aparecen en la franja ni en la auditoría.

## Next Phase Readiness

- El enforcement completo (backend 20-01 + tests 20-02 + frontend 20-03) queda deployable tras la verificación en preview.
- Phase 21 (reporte diario) puede leer `pctMarked`/`pendingCount` de disposition-audit; Phase 22 (coaching) cruza outcome vs transcript sobre callLog ya íntegro.

## Threat Flags

Ninguna superficie nueva fuera del threat model del plan: el gate es client-side (T-20-12, accept — el server registra el pendiente igual), la franja filtra a los propios con doble capa backend (T-20-13) y la auditoría usa apiUrl() + 403 backend para setters (T-20-14).

## Self-Check: PASSED

- Commits `c9c3f0c` / `f0e8385` / `77c7f1e` existen en `git log`; cero deleciones de archivos trackeados en el rango.
- Gates automatizados de los 3 tasks: `node --check public/app.js` OK; `_dispoGate` ×36 (≥8); `_dispoAfterSaved` ×7 (definición + 6 calls); `committedRemote` en la bifurcación; `_pdKeyOutcomes` 1 definición; `dispo-pending-strip` ×1 en HTML; `_dispoLoadPendingStrip` ×3; estilos presentes en style.css; cache-busters ×1 exacto cada uno; fetch de disposition-audit con `apiUrl(`.
- `_autoMarkNoAnswer` no llama `_flushPendingTranscription` (solo el comentario D-04); rango del buffer de 10 min sin un solo diff.
- `npm test`: **864/864 verdes** (63 archivos, suite completa).
- `data/*.json` intactos; sin push a remoto.

---
*Phase: 20-disposicion-obligatoria*
*Completed: 2026-07-26*

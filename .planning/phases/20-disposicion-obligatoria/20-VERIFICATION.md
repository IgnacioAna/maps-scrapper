---
phase: 20-disposicion-obligatoria
verified: 2026-07-26T15:35:00Z
status: human_needed
score: 14/15 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Semana posterior al deploy: abrir Equipo → Auditoría de disposiciones (period 7d) y mirar '% marcada' por SDR"
    expected: "pctMarked ~100% para cada SDR activa (success criterion 2 del ROADMAP)"
    why_human: "Es un resultado observable SOLO con tráfico real de producción post-deploy; la infraestructura de medición (disposition-audit.pctMarked) está verificada, el número no puede existir antes del deploy"
  - test: "Primera tanda de llamadas reales post-deploy: una llamada CON contacto → colgar sin marcar → intentar discar otra; una llamada SIN contacto (nadie atiende) → colgar"
    expected: "Con contacto: gate + banner 'Marcá el resultado de la llamada a X' y ningún discado arranca hasta marcar. Sin contacto: toast 'No atendió — marcado automático' y el entry aparece con autoMarked; corregible desde el dropdown en <15 min"
    why_human: "El preview simuló el gate vía el path de restore (checklist b, PASS) pero la bifurcación enteredActive/committedRemote solo se ejercita con una llamada Telnyx real con audio de carrier"
  - test: "Feedback de las SDRs durante la primera semana"
    expected: "Nadie reporta que el Power Dialer se volvió inusable (success criterion 3 — la parte técnica, atajos 1-9 + autopiloto intactos, ya está verificada por código y preview)"
    why_human: "Percepción de usabilidad de personas reales, no verificable programáticamente"
---

# Phase 20: Disposición obligatoria — Verification Report

**Phase Goal:** Ninguna llamada colgada queda sin resultado marcado — gate en vivo (D-01), cola no bloqueante para lo que escapa (D-02), auto-marca corregible de no-contactos (D-03), cadena de grabación intacta (D-04), regla arranca de cero (D-05), auditoría pasiva con % de disposición (D-06).
**Verified:** 2026-07-26
**Status:** human_needed (todo lo verificable programáticamente está VERIFIED; quedan 3 ítems que requieren producción/humano)
**Re-verification:** No — verificación inicial

## Goal Achievement

### Observable Truths

| # | Truth (fuente) | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC1 ROADMAP: una llamada colgada no puede quedar sin disposición según la forma acordada (D-01/D-02/D-03) | ✓ VERIFIED | Gate `if (_dispoGate)` en `_startTelnyxCall` (app.js:8202, único punto de discado) + auto-marca `_autoMarkNoAnswer` (bifurcación app.js:8480-8487) + franja de pendientes; registro server-side creado al INICIAR la llamada (app.js:8334-8340 → index.js:8547) |
| 2 | SC2 ROADMAP: % de disposición sube a ~100% en la semana post-deploy | ? UNCERTAIN | La herramienta de medición (`pctMarked` en disposition-audit, index.js:9078+) existe y está testeada (test 15: pctMarked 67); el número real requiere tráfico de producción → ítem humano |
| 3 | SC3 ROADMAP: autopiloto y atajos 1-9 del PD siguen funcionando | ✓ VERIFIED | `_pdKeyOutcomes` 1 sola definición (mismo array de 9); shortcutMap sin diff; `_pdStartAutopilotCountdown` solo gana un early-return con gate (app.js:5452); preview checklist e: PASS (S/B/A/Esc verificados). Feedback de SDRs → ítem humano |
| 4 | SC4 ROADMAP: tests del enforcement (backend + preview frontend) | ✓ VERIFIED | tests/disposition-enforcement.test.js 16/16 (ejecutado en esta verificación); preview checklist a-f 6/6 PASS documentado en 20-03-SUMMARY |
| 5 | P01: el server sabe qué llamadas existen sin disposición (registro al iniciar, resuelto solo por disposición) | ✓ VERIFIED | POST/GET `/api/setters/pending-calls` (index.js:8547/8614); resolución exclusiva en call-disposition (index.js:9038-9064, prioridad pendingCallId→startedAt→más reciente, valida leadId T-20-06); cancelación acotada <2 min |
| 6 | P01: auto-marca no_answer corregible 15 min sin duplicar dial ni cadencia fantasma | ✓ VERIFIED | `autoMarked` gateado a no_answer (index.js:8886); snapshot `preCadence` (8888); corrección restaura + hereda ts/duración (8710-8730); 409 'No hay auto-marca reciente para corregir.' (8714); tests 8-12 verdes |
| 7 | P01: admin/supervisor ven distribución + sospechosas + % marcadas | ✓ VERIFIED | disposition-audit con RBAC 403 (index.js:9080-9082), scoping espejo team-performance (`_visibleSetterIds`/`_filterSettersVisible`), umbrales 31s/10s (index.js:9142-9143); tests 13-15 verdes |
| 8 | P01: pending_calls.json sobrevive redeploys | ✓ VERIFIED | Presente en export-data (index.js:2162-2180), import-data (2261-2294), seedVolumeFromRepo (4080), BACKUP_FILES (4133), pre-deploy.js:189; test 16 round-trip verde |
| 9 | P01: el registro arranca vacío — cero reconstrucción histórica (D-05) | ✓ VERIFIED | `data/pending_calls.json` NO existe en el repo (ls falla); `loadPendingCalls()` tolera ausencia (index.js:1771-1779) |
| 10 | P02: endpoints con regresión + suite completa verde | ✓ VERIFIED | 16 tests nuevos (361 líneas, setup DATA_DIR + API keys "" sin delete); suite completa re-ejecutada: **864/864, 63 files, 0 failed**; metrics-consistency completo verde sin modificar |
| 11 | P03: con llamada con contacto sin marcar, NINGÚN punto de discado inicia otra + banner dice cuál falta (D-01) | ✓ VERIFIED | Guard único en `_startTelnyxCall` cubre lista/Hoy/PD/autopiloto/tecla C/alt-contact/Ctrl+K/ad-hoc; banner `.dispo-gate-banner` con "Ir a marcar"; restore tras refresh valida contra el server (`_dispoGateRestore`, app.js:7467); preview b: PASS |
| 12 | P03: sin señal de atención (ni active ni voz sostenida) → No atendió automático, corregible en 1 gesto (D-03) | ✓ VERIFIED | `reachedContact = enteredActive \|\| committedRemote` (app.js:8407 — conservador, no corrompe D-06); `_autoMarkNoAnswer` con fallback al gate si la red falla; `_lastAutoMark` habilita `correctsAutoMarked` 15 min con doble defensa client/server |
| 13 | P03: franja NO bloqueante "Tenés N llamadas sin marcar" con acceso directo (D-02) | ✓ VERIFIED | `#dispo-pending-strip` en view-calls; `_dispoStripGoResolve` NO contiene POST propio ni `_startTelnyxCall` ni disabled (delegación total al dropdown normal — grep vacío); preview c: PASS incl. pendingCallId + meta heredada |
| 14 | P03: ventana de 10 min del audio y cadena de grabación INTACTAS (D-04) | ✓ VERIFIED | `git diff 6bad444 HEAD -- public/app.js` → 0 hits de `_pendingTranscribe`/`_syncCallRecording`/`_recBindChannel`/ventana 10 min; `_autoMarkNoAnswer` no llama `_flushPendingTranscription` (cuerpo leído completo) |
| 15 | P03: Equipo muestra distribución + sospechosas + % marcada por SDR (D-06) | ✓ VERIFIED | Fetch con `apiUrl()` (app.js:15252 — regla #146); guard `if (!rows.length) return` (sin tablas vacías); labels humanos vía `callOutcomeLabel`; `<details>` de samples; preview d: PASS |

**Score:** 14/15 truths verificadas (1 UNCERTAIN → ítem humano post-deploy, no es un gap de implementación)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `index.js` | 3 endpoints + call-disposition extendido | ✓ VERIFIED | `app.post('/api/setters/pending-calls'` (8547), GET (8614), disposition-audit (9078); destructure con autoMarked/correctsAutoMarked/pendingCallId (8680); handlers SYNC — 0 awaits en 8540-9200 |
| `scripts/pre-deploy.js` | descarga de pending_calls.json | ✓ VERIFIED | `['pending_calls', 'pending_calls.json']` línea 189; `node --check` OK |
| `tests/disposition-enforcement.test.js` | regresión backend, min 200 líneas | ✓ VERIFIED | 361 líneas, 16 tests, todos verdes; DATA_DIR antes del import; API keys `""` (jamás delete) |
| `public/app.js` | gate/_dispoGate, auto-marca, banner, franja, auditoría | ✓ VERIFIED | `_dispoGate` ×38, `_dispoAfterSaved` ×7 (def + 6 calls), `_dispoLoadPendingStrip` ×3, `_autoMarkNoAnswer` cableado |
| `public/index.html` | contenedores + cache-busters | ✓ VERIFIED* | `dispo-pending-strip` ×1, `team-dispo-audit` ×1; app.js `v=20260725c` (el plan pedía `v=20260725b` — superado por el bump post-fix CR-01 en 84ebf4a, cumple la intención de la regla #48); style.css `v=20260725a` ×1 |
| `public/style.css` | .dispo-gate-banner / .dispo-strip | ✓ VERIFIED | Bloque Phase 20 (líneas 4746-4752+), sin emojis, sin backdrop-filter |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| call-disposition | pending_calls.json | pendingCallId → startedAt → más reciente | ✓ WIRED | index.js:9038-9064; valida `p.leadId === req.params.id`; skip en corrección |
| disposition-audit | globalThis.__callCore | _ccCollectCalls + _ccResolveRange | ✓ WIRED | index.js:9095-9100; cero re-implementación del funnel (metrics-consistency verde sin cambios) |
| logEntry.autoMarked | correctsAutoMarked | snapshot preCadence | ✓ WIRED | index.js:8888 (snapshot) → 8717 (restore); test 10 (reversión del auto-descarte) verde |
| _startTelnyxCall | _dispoGate | guard único | ✓ WIRED | app.js:8202 (entre check activeCall y fetch config, como pedía el plan) |
| _onTelnyxCallEnded | /api/setters/pending-calls | upsert al colgar + bifurcación reachedContact | ✓ WIRED | app.js:8471-8487 (upsert con endedAt/durationSecs/reachedActive; <1s → canceled) |
| 5 POST de call-disposition | _dispoAfterSaved + _dispoEnforcementBody | clear del gate + corrección | ✓ WIRED | `_dispoEnforcementBody` en los 5 call sites (8954, 9098, 9238, 9319, 9345); `_dispoAfterSaved` ×7 |
| _teamLoad | /api/setters/disposition-audit | apiUrl() | ✓ WIRED | app.js:15252 — nunca fetch crudo (regla #146) |

### Fix CR-01 post-review (commit 84ebf4a)

✓ VERIFIED — el fix existe en `public/app.js:8330`, dentro de `_startTelnyxCall`, exactamente donde lo prescribió el review (junto al reset de `pendingRegistered`):
```js
if (_lastAutoMark && _lastAutoMark.leadId === leadId) _lastAutoMark = null;
```
Una llamada nueva al mismo lead invalida la ventana de corrección — el escenario "2 llamadas reales → 1 entry" queda cerrado. Cache-buster bumpeado a `v=20260725c` en el mismo commit.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Tests del enforcement + regresión cercana | `npx vitest run disposition-enforcement metrics-consistency disposition-dnc call-cadence` | 45/45 passed | ✓ PASS |
| Suite completa | `npm test` | **864 passed / 0 failed** (63 files, 15s) | ✓ PASS |
| Sintaxis | `node --check` index.js / app.js / pre-deploy.js | OK | ✓ PASS |
| D-05 (arranque de cero) | `ls data/pending_calls.json` | No existe | ✓ PASS |
| Gate/franja/auditoría en UI | Preview checklist a-f (ejecutado por el orquestador, documentado en 20-03-SUMMARY) | 6/6 PASS | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|--------------|-------------|--------|----------|
| DISP-01 | 20-01, 20-02, 20-03 | Marcar la disposición de cada llamada es obligatorio (forma resuelta en discuss: gate en vivo + cola no bloqueante) | ✓ SATISFIED | Gate D-01 (truth 11) + registro server-side (truth 5) + franja D-02 (truth 13) + tests |
| DISP-02 | 20-01, 20-02, 20-03 | Llamadas colgadas sin marcar al activar la regla tienen tratamiento definido | ✓ SATISFIED | D-05: arranca de cero (truth 9 — registro vacío, cero reconstrucción, documentado en SUMMARY como nota de deploy); lo que escapa post-activación cae en la cola D-02 con prune 14 días |
| DISP-03 | 20-01, 20-02, 20-03 | El enforcement no empuja a marcar cualquier cosa; respeta la ventana de 10 min del audio | ✓ SATISFIED | Auto-marca CONSERVADORA (solo sin active ni voz sostenida — truth 12), corregible 15 min (truth 6), auditoría pasiva de sospechosas D-06 (truths 7 y 15), buffer de 10 min con cero diff (truth 14) |

Sin requirements huérfanos: REQUIREMENTS.md mapea exactamente DISP-01/02/03 a Phase 20 y los 3 planes los declaran.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| index.js | 9073 | "TODO del CALL METRICS CORE" | ℹ️ Info | Falso positivo — es "todo" en español ("deriva TODO del CORE"), no un marcador TODO |

Cero stubs, cero placeholders, cero handlers vacíos en el diff de la phase (`git diff 6bad444 HEAD`).

### Advisory del code review (no gaps)

Los 4 warnings (WR-01 stash de la franja sin expiración, WR-02 meta perdida si la auto-marca falla, WR-03 ghost lead vs rebuild del mapa, WR-04 orden creación/cancelación) y 4 info del REVIEW quedan documentados como hardening futuro. Ninguno contradice un must-have: son edge cases de robustez dentro del threat model aceptado (T-20-12: el gate client-side es UX, el server es la fuente de verdad). El único critical (CR-01) fue corregido y verificado.

### Human Verification Required

#### 1. % de disposición ~100% (SC2 del ROADMAP)

**Test:** una semana después del deploy, abrir Equipo → "Auditoría de disposiciones" (7d) y revisar la columna "% marcada" por SDR.
**Expected:** ~100% para cada SDR activa (los pendientes no resueltos lo bajan).
**Why human:** el número solo puede existir con tráfico real post-deploy. La herramienta de medición está construida y testeada.

#### 2. Gate y auto-marca con llamada Telnyx real

**Test:** llamada real CON contacto → colgar sin marcar → intentar discar otra (debe bloquear con banner). Llamada real SIN contacto → colgar (debe auto-marcar "No atendió" con toast, corregible).
**Expected:** gate en el primer caso, auto-marca corregible en el segundo; la corrección dentro de 15 min reemplaza el entry sin duplicar el dial.
**Why human:** el preview verificó el gate por el path de restore (PASS), pero `enteredActive`/`committedRemote` solo se ejercitan con audio de carrier real.

#### 3. Usabilidad del Power Dialer (SC3)

**Test:** feedback de las SDRs en la primera semana.
**Expected:** nadie reporta el flujo como inusable; la única traba percibida es "marcá la que acabás de cortar" (1 clic).
**Why human:** percepción de usuarias reales. La parte técnica (atajos 1-9, autopiloto) ya está verificada por código y preview.

### Gaps Summary

Sin gaps de implementación. Las 6 decisiones del CONTEXT (D-01..D-06) están honradas en el código verificado, los 3 requirements están cubiertos, la suite completa da 864/864, el fix CR-01 está aplicado, y el checklist de preview dio 6/6. Los 3 ítems humanos son inherentemente post-deploy (métrica de producción, llamada real, feedback de usuarias) — no bloquean el cierre técnico de la phase, pero sí el "goal achieved" pleno del success criterion 2.

---

_Verified: 2026-07-26T15:35:00Z_
_Verifier: Claude (gsd-verifier)_

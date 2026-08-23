---
phase: 37-ses-sesion-discado
verified: 2026-08-23T18:05:59Z
status: human_needed
score: 18/18 must-haves verified (código + tests + suite completa)
overrides_applied: 0
human_verification:
  - test: "Abrir el Power Dialer desde Llamadas, marcar 1-2 resultados reales, salir con Esc"
    expected: "Aparece la pantalla de cierre con 'marcadas' arriba, atendieron/conversaciones/agendadas abajo, desglose por outcome, chips de estado clickeables, botón Salir funcional desde el primer frame. Un segundo Esc/click cierra el panel y refresca Llamadas."
    why_human: "Requiere renderizado real en browser (CSS inline, interacción de click) y una llamada Telnyx real o simulada con disposición — no disponible en este entorno de verificación (sin herramienta de browser/preview)."
  - test: "Repetir la apertura/cierre desde una sección de Hoy (callbacks o interesados)"
    expected: "Misma pantalla de cierre, con mode:'hoy' y hoyFilter reflejado en la sesión persistida (setters.json → data.dialSessions)."
    why_human: "Mismo motivo — verificación visual/interactiva en browser real."
  - test: "Entrar a Mi rendimiento y ver la tabla 'Sesiones de discado' con al menos 2 sesiones cerradas (hoy y ayer)"
    expected: "Encabezados 'Hoy'/'Ayer', marcadas en negrita, columna 'Cómo la remó' mostrando el mood elegido o un guion discreto si se salteó, sesión cerrada sola marcada con 'cerrada sola'."
    why_human: "Renderizado visual de tabla — el executor de 37-04 documentó una verificación equivalente vía scripts Bash/Node contra un preview server real (no un browser), que este verificador no pudo reproducir por no tener herramienta de browser disponible."
  - test: "En modo 'Ver como SDR · <nombre>', confirmar en el Network tab del browser que la request a /api/setters/dial-sessions lleva ?setter=<setterId de ese SDR>, y que la tabla muestra SUS sesiones, no las del equipo"
    expected: "URL con ?setter= explícito, tabla con datos de ese SDR únicamente."
    why_human: "Este es el bug de fuga que ya se repitió 2 veces en el proyecto (notas #135/#146 de CLAUDE.md). El código fue leído línea por línea y es correcto (ver evidencia abajo), y hay 5 tests de fuente que lo protegen, pero la confirmación visual con Network tab requiere browser real."
---

# Fase 37: SES — La sesión de discado como partida — Reporte de Verificación

**Meta de la fase:** Una sesión de discado empieza, termina y devuelve un marcador propio. Hoy no existe como objeto: se sale con Esc y no queda rastro de que ocurrió.
**Verificado:** 2026-08-23T18:05:59Z
**Estado:** human_needed (todo lo verificable por código/tests pasó; quedan checks visuales en browser real)
**Re-verificación:** No — verificación inicial

## Resumen ejecutivo

Los 4 planes de la fase (37-01 a 37-04) están commiteados, con `SUMMARY.md` para cada uno. Se verificó el código real (no las narrativas de los SUMMARY) leyendo `index.js` y `public/app.js` línea por línea en los puntos críticos, se corrió la suite completa de tests (`npx vitest run`) de forma independiente, y se cruzaron los `git diff` de la fase contra las funciones que las fases 35/36 dejaron protegidas. **No se encontró ningún gap, stub ni desviación del contrato declarado.** Los 5 requisitos (SES-01..05) están implementados de punta a punta, con contadores derivados exclusivamente del CALL METRICS CORE y atribución por quien llamó.

El único motivo por el que el estado no es `passed` es que este verificador no tuvo herramienta de browser/preview disponible en esta sesión — los checks puramente visuales (render del HTML, click real de los chips, confirmación de Network tab en modo "Ver como SDR") quedan listados como verificación humana, no como fallas.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidencia |
|---|---|---|---|
| 1 | SES-01: `dialSession` existe como objeto persistido con `startedAt/endedAt/by/mode/hoyFilter/filtro/queueSize/counters` | ✓ VERIFIED | `index.js:8684-8698` (objeto `session` construido en `POST /api/setters/dial-sessions`), campos exactos al contrato |
| 2 | SES-05: los contadores de la sesión derivan 100% del CALL METRICS CORE, atribución por quien llamó (`_callSetterId`), nunca por `lead.assignedTo` | ✓ VERIFIED | `index.js:8586-8614` (`_dialSessionCounters` usa `_ccCollectCalls`+`_ccFunnelAggregate`); grep confirmado: 0 ocurrencias de `COLD_CALL_CONNECT_OUTCOMES`/`COLD_CALL_CONV_MIN_S`/`COLD_CALL_APPOINTMENT_OUTCOMES` dentro del bloque; `_ccCollectCalls` atribuye por `_callSetterId(entry, lead, userMap)` (`index.js:8166`), nunca `lead.assignedTo` |
| 3 | Sesión huérfana se cierra sola en la próxima apertura, anclada a su última llamada real (no a horas muertas de pestaña abierta) | ✓ VERIFIED | `index.js:8666-8681`; test `tests/dial-session-model.test.js:345-390` (2 casos: con llamadas y sin ninguna) |
| 4 | Usuario sin SDR vinculado no puede abrir sesión (guard 400, defensa en profundidad en `_dialSessionCounters`) | ✓ VERIFIED | `index.js:8548-8558` (`_dialSessionActor`) + `index.js:8589-8591` (fallback a 0 si `!setterId`); tests dedicados en `dial-session-model.test.js:204-220` |
| 5 | Nadie puede cerrar ni leer/mutar la sesión de otro SDR (IDOR cerrado, `id`+`setterId` en el mismo `.find()`) | ✓ VERIFIED | `index.js:8716` (close), `index.js:8809` (PATCH mood); tests IDOR en `dial-session-model.test.js:318-333` y `dial-session-history.test.js:281-288` |
| 6 | SES-02: SIEMPRE hay pantalla de cierre — Esc, botón Salir, navegación por sidebar, fin de cola — nunca solo al agotar la cola | ✓ VERIFIED | `window._pdExit` en 2 fases (`public/app.js:7352-7364`), los 3 caminos existentes convergen sin tocarlos; `_pdAdvance` reemplaza el HTML viejo por `_pdShowClosing('cola_completa')` (`app.js:7845-7852`); `grep -c "Procesaste "` → 0 |
| 7 | D-01: el número grande es SIEMPRE `counters.dials` (marcadas), nunca `connects` ni `processed` — sube aunque el resultado comercial sea cero | ✓ VERIFIED | `_sesClosingModel` (`app.js:7511`): `big = { value: dials, ... }`; test explícito `dial-session-close-ui.test.js:161-165` ("este test es D-01 escrito en código") |
| 8 | Los números que se muestran vienen del servidor — el frontend nunca cuenta llamadas por su cuenta | ✓ VERIFIED | `_pdSessionClose` solo hace `fetch` + `r.json()` (`app.js:7683-7713`); `_sesClosingModel` es puro (sin acceso a `callsLeadsCache`/`_pdTodayStats`, verificado programáticamente) |
| 9 | SES-04: al cerrar se ofrece una sola vez la pregunta de estado, opcional, nunca bloquea la salida | ✓ VERIFIED | Chips renderizados solo en la pantalla de cierre (`app.js:7750-7763`), `window._pdSessionMood` nunca impide el botón Salir (catch silencioso, `app.js:7828-7831`); backend acepta `''` como borrado válido (`index.js:8801-8803`) |
| 10 | Si el backend no responde, el SDR igual ve una pantalla de cierre y puede salir (nunca queda encerrado) | ✓ VERIFIED | Botón Salir pintado ANTES del `await _pdSessionClose` (`app.js:7802` vs `7805`); `_pdSessionClose` nunca tira, siempre devuelve `{error:true}` en fallas (`app.js:7688,7707-7712`); `_sesClosingModel` con `error` cae al modelo degradado (`app.js:7478-7494`) |
| 11 | En la pantalla de cierre, las teclas 1-9 no marcan nada (ya no hay tarjeta abajo) | ✓ VERIFIED | Guard `if (_pd.closing && e.key !== 'Escape') return;` inmediatamente después de `if (!_pd.active) return;` y antes del bloque `e.key >= '1'` (`app.js:8592`) |
| 12 | SES-03: existe historial de sesiones con scope correcto por rol (setter propio, supervisor scoped, admin sin restricción) | ✓ VERIFIED | `GET /api/setters/dial-sessions` (`index.js:8745-8785`) usa `getEffectiveAuth`+`_visibleSetterIds`, MISMO patrón que `cold-call-metrics`, no el legacy de `/api/setters/sessions` |
| 13 | Sesiones de ruido (0 marcadas, <120s) no ensucian el historial por defecto, pero nunca se borran (`all=1` las trae) | ✓ VERIFIED | `index.js:8775-8781`; tests de borde en `dial-session-history.test.js:179-193` (incluye el caso "0 marcadas pero ≥120s NO es ruido") |
| 14 | SES-03 UI: tabla "Sesiones de discado" en Mi rendimiento, agrupada Hoy/Ayer/fecha, sin total diario paralelo | ✓ VERIFIED | `public/index.html:2454-2455` (`#myp-sessions`); `_mypLoadSessions`+`_sesHistoryRows` (`app.js:19934-20018`, `app.js:7572-7615`); test explícito de que ningún row `tipo:'dia'` trae contadores |
| 15 | **CRÍTICO**: el loader pasa el setter efectivo explícito bajo "Ver como SDR" y usa `apiUrl()`, no fetch crudo | ✓ VERIFIED | `_mypLoad` calcula `effectiveSetter` con el criterio `isViewAsSetter` (`app.js:19814-19817`, idéntico al de `_mypLoadPipeline`) y lo pasa a `_mypLoadSessions(effectiveSetter)` (`app.js:19837`); `_mypLoadSessions` usa `apiUrl('/api/setters/dial-sessions?'+params)` (`app.js:19947`), nunca `fetch('/api/...')` crudo |
| 16 | Una sesión cerrada sola (`closedBy:'auto'`) se distingue visualmente de una cerrada por el SDR | ✓ VERIFIED | Tag "cerrada sola" con `title` explicativo (`app.js:19976-19978`); en la pantalla de cierre no aplica (solo aplica al historial, correcto) |
| 17 | Sin sesiones todavía, la sección dice qué hacer — nunca tabla vacía ni 0 desnudo | ✓ VERIFIED | `app.js:19957-19961` (texto guía explícito antes de armar cualquier tabla) |
| 18 | RBAC/IDOR: un SDR no puede leer ni mutar la sesión de otro SDR (GET historial + PATCH mood) | ✓ VERIFIED | Scope del GET (`index.js:8748-8763`) + búsqueda por `id`+`setterId` en el PATCH (`index.js:8809`); tests dedicados |

**Score:** 18/18 truths verificados contra el código real (no contra las narrativas de los SUMMARY).

### Required Artifacts

| Artifact | Expected | Status | Detalle |
|---|---|---|---|
| `index.js` (bloque `SESIÓN DE DISCADO`, ~8502-8818) | Modelo `dialSessions` + 4 endpoints (abrir/cerrar/GET/PATCH) + helpers puros en `globalThis.__dialSessions` | ✓ VERIFIED | Leído completo; matchea el contrato de `<interfaces>` de los 4 planes exactamente |
| `tests/dial-session-model.test.js` | Suite HTTP+pura de SES-01/SES-05 | ✓ VERIFIED | 455 líneas, cobertura de apertura/cierre/RBAC/auto-cierre/poda/puros; corrida de forma aislada y como parte de la suite completa |
| `tests/dial-session-history.test.js` | Suite HTTP de SES-03/SES-04 (historial + mood) | ✓ VERIFIED | 316 líneas, cobertura de scope/ruido/RBAC/mood |
| `public/app.js` (bloque `[37-03] SESSION-PURE` + ciclo de vida `_pdSession`) | Modelo puro de pantalla de cierre + wiring de apertura/cierre/mood en el Power Dialer | ✓ VERIFIED | Pureza del bloque confirmada programáticamente (0 ocurrencias de `document/localStorage/fetch(/Date.now(/window./_pdTodayStats/callsLeadsCache` dentro de los marcadores) |
| `public/index.html` (`#myp-sessions` + cache-buster) | Sección de historial en Mi rendimiento + `app.js?v=` bumpeado | ✓ VERIFIED | `app.js?v=20260823c` (1 sola ocurrencia), `style.css?v=20260822a` sin tocar (correcto: la fase no toca CSS) |
| `tests/dial-session-close-ui.test.js` | Suite de SES-02/SES-04 (modelo puro + cableado + cache-buster) | ✓ VERIFIED | 510 líneas |
| `tests/dial-session-myperf-ui.test.js` | Suite de SES-03 frontend (agrupación por día, cableado, cache-buster) | ✓ VERIFIED | 452 líneas |

### Key Link Verification

| From | To | Via | Status | Detalle |
|---|---|---|---|---|
| `POST /dial-sessions/:id/close` | `_ccCollectCalls` + `_ccFunnelAggregate` | los 4 números canónicos salen del CORE sobre `[startedAt, endTs)` filtrado por setter | ✓ WIRED | `index.js:8594-8599`; test que recalcula independientemente y compara campo por campo (`dial-session-model.test.js:271-278`) |
| `data.dialSessions` | `setters.json` | key adicional del objeto que `loadSettersData`/`saveSettersData` redondean completo (regla #21) | ✓ WIRED | Verificado leyendo `loadSettersData`/`saveSettersData` (`index.js:7368-7472`): devuelven/reciben el objeto `raw`/`data` completo, sin selección de campos; `export-data` exporta `loadSettersData()` completo |
| `session.setterId` | `req.auth.user.setterId` (real, no impersonado) | evita que una sesión abierta en "Ver como SDR" quede vacía | ✓ WIRED | `_dialSessionActor` (`index.js:8551`) lee `req.auth?.user?.setterId`, nunca `getEffectiveAuth(req).setterId` |
| `window._pdStart` | `POST /api/setters/dial-sessions` | se abre después de todos los early-return, fire-and-forget | ✓ WIRED | `app.js:7231` (`_pdSessionOpen()`), posicionado después de los 2 `return;` de cola vacía (línea 7186 y 7216) |
| `window._pdExit` | `_pdShowClosing → POST /dial-sessions/:id/close` | primera salida muestra el cierre, segunda cierra de verdad | ✓ WIRED | `app.js:7359-7364` |
| `_pdAdvance` (fin de cola) | `_pdShowClosing` | la pantalla de "Cola completa" es una variante de la misma pantalla | ✓ WIRED | `app.js:7845-7852` |
| chips de estado | `PATCH /dial-sessions/:id` | `window._pdSessionMood`, opcional, no bloquea el cierre | ✓ WIRED | `app.js:7815-7832` |
| `_mypLoad` | `_mypLoadSessions(effectiveSetter)` | mismo setter efectivo que `_mypLoadPipeline` | ✓ WIRED | `app.js:19837` |
| `_mypLoadSessions` | `GET /api/setters/dial-sessions` | `apiUrl()` + `?setter=` explícito cuando corresponde | ✓ WIRED | `app.js:19944-19947` |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|---|---|---|---|---|
| Pantalla de cierre (`_pdRenderClosingScreen`) | `_pdClosingModel` | `_sesClosingModel(payload)` ← `payload` = respuesta real de `POST .../close` ← `_dialSessionCounters` ← `_ccCollectCalls`/`_ccFunnelAggregate` sobre `data.leads[*].callLog` real | Sí | ✓ FLOWING |
| Tabla "Sesiones de discado" | `sessions` | `GET /api/setters/dial-sessions` ← `data.dialSessions` real, filtrado por scope y ruido | Sí | ✓ FLOWING |
| Pipeline verificado con test end-to-end: sesión abierta → llamadas inyectadas en `callLog` → cierre → `counters` recalculados independientemente por el test y comparados campo a campo contra el resultado real del endpoint | — | `tests/dial-session-model.test.js:230-281` | Sí, con datos sintéticos pero por el camino real (HTTP) | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| `node --check index.js` | `node --check index.js` | exit 0 | ✓ PASS |
| `node --check public/app.js` | `node --check public/app.js` | exit 0 | ✓ PASS |
| Bloque `SESSION-PURE` no referencia `document/localStorage/fetch(/Date.now(/window./_pdTodayStats/callsLeadsCache` | script `node -e` que extrae el bloque y busca los 8 tokens | 8/8 `false` | ✓ PASS |
| `grep -c "app.post('/api/setters/dial-sessions'"` / `app.get`/`app.patch` | greps directos | 1/1/1 según corresponde | ✓ PASS |
| Suite completa | `npx vitest run` | **124 archivos, 2274 tests, 0 fallos** | ✓ PASS |

### Probe Execution

No hay probes formales (`scripts/*/tests/probe-*.sh`) declarados por esta fase ni por convención del repo para este tipo de cambio (backend Express + frontend vanilla JS, no migración/CLI). N/A.

### Requirements Coverage

| Requirement | Source Plan(s) | Descripción | Status | Evidencia |
|---|---|---|---|---|
| SES-01 | 37-01, 37-03 | Entidad `dialSession` persistida con inicio/fin/quién/modo/filtro/cola/contadores | ✓ SATISFIED | `index.js:8684-8698`, `app.js:7220-7231` |
| SES-02 | 37-03 | Siempre hay pantalla de cierre, no solo al vaciar la cola | ✓ SATISFIED | `app.js:7352-7364,7845-7852` |
| SES-03 | 37-02, 37-04 | Historial de sesiones (hoy vs ayer) | ✓ SATISFIED | `index.js:8745-8785` (backend), `app.js:19934-20018` (UI) |
| SES-04 | 37-02, 37-03, 37-04 | Una pregunta de estado, opcional, nunca por llamada | ✓ SATISFIED | `index.js:8795-8816` (backend), `app.js:7750-7763,7815-7832` (chips), `app.js:19990` (lectura en historial) |
| SES-05 | 37-01 | Contadores derivan del CALL METRICS CORE, no se re-implementan | ✓ SATISFIED | `index.js:8586-8614`; `tests/metrics-consistency.test.js` sin editar en NINGÚN commit de la fase (verificado con `git log`), 18/18 dentro de la corrida completa |

**Sin requisitos huérfanos**: la unión de los `requirements:` declarados en los 4 planes (`SES-01, SES-02, SES-03, SES-04, SES-05`) coincide EXACTO con los 5 que `ROADMAP.md` declara para la Fase 37 y con la fila de `REQUIREMENTS.md` (`| SES-01, SES-02, SES-03, SES-04, SES-05 | 37 |`).

### Anti-Patterns Found

Ninguno. Grep de `TODO|FIXME|XXX|TBD` y de placeholders/"not yet implemented" sobre el diff completo de la fase (`git diff debde4e~1 30eabf7 -- index.js public/app.js public/index.html`) no encontró marcadores de deuda reales — los únicos matches fueron la palabra española "TODO" (= "all/every") dentro de comentarios explicativos, no marcadores de trabajo pendiente.

### Regresión contra fases inmediatamente anteriores

**Fase 36** (`_dispoBusyOn`/`_dispoBusyOff`, `telnyxCallMeta` síncrono, preferencia del pad DTMF, `_pd.holdCurrent` de D-01, orden de `_pdKeyOutcomes` de D-02):
- `git diff debde4e~1 30eabf7 -- public/app.js` no borra ninguna línea que contenga esas funciones (verificado con grep sobre el diff).
- `_pdKeyOutcomes` mantiene los 9 outcomes en el mismo orden — sin ninguna mención en el diff completo de la fase.
- `_pd.holdCurrent`/`holdOutcome`/`holdMeta` intactos; el único campo agregado al objeto `_pd` es `closing: false`.
- Suites de regresión corridas explícitamente: `tests/dispo-feedback.test.js`, `tests/dispo-async-meta.test.js`, `tests/dtmf-pad-pref.test.js`, `tests/hoy-dialer-hygiene.test.js` → **todas verdes**.

**Fase 35** (`_scriptSelectHTML` antes del selector de outcome, `_dispoEnforcementBody`):
- Ambas funciones siguen presentes y usadas en los mismos call sites (`app.js:11136`, `app.js:11187`, con 5+ usos cada una).
- Suites corridas: `tests/script-attribution-core.test.js`, `tests/script-attribution-surfaces.test.js`, `tests/call-stage-surfaces.test.js`, `tests/hoy-sections.test.js` → **todas verdes**.

**Único ajuste fuera de `files_modified` declarado en los SUMMARY**: 1 assertion en `tests/dial-sync.test.js` (37-03) y 1 assertion en `tests/dial-session-close-ui.test.js` (37-04), ambas por refactors que los propios planes pidieron explícitamente (extracción de `_pdExitFinal()` y consumo de `SES_MOOD_LABELS` en vez de un array a mano). Verificado leyendo los diffs de los commits `6d23171` y `2a5fd9e`: el invariante funcional protegido no cambió, solo la ubicación exacta del literal. No es una desviación de scope.

### Baseline de tests — medido de forma independiente

```
npx vitest run
 Test Files  124 passed (124)
      Tests  2274 passed (2274)
   Duration  107.35s
```

Coincide EXACTO con el baseline declarado en `37-04-SUMMARY.md` ("124/124 archivos, 2274/2274 tests, 0 fallos"). No hubo ningún fallo, ni siquiera el flaky ambiental conocido (`wa-campaign-engine`) en esta corrida.

### Human Verification Required

Ver la sección `human_verification` del frontmatter — 4 checks, todos de naturaleza visual/interactiva en browser real (renderizado de la pantalla de cierre, de la tabla de historial, y confirmación de Network tab en modo "Ver como SDR"). Este verificador no tuvo herramienta de browser/preview disponible en la sesión; el código que sustenta cada uno de estos checks fue leído y confirmado línea por línea, y está protegido por tests de fuente, pero la confirmación visual queda pendiente.

### Gaps Summary

No se encontraron gaps. Los 5 requisitos (SES-01 a SES-05) están implementados de punta a punta, con evidencia de código, de tests (ejecutados por este verificador, no solo citados) y de trazabilidad cruzada contra `ROADMAP.md`/`REQUIREMENTS.md`. El estado `human_needed` refleja únicamente la ausencia de herramienta de browser en esta sesión de verificación, no un defecto encontrado.

---

_Verified: 2026-08-23T18:05:59Z_
_Verifier: Claude (gsd-verifier)_


## Verificación en vivo del orquestador (2026-08-23, posterior al informe)

El verificador no tuvo browser; el orquestador sí. Contra el preview real
(`DATA_DIR=tmp/preview-data`, sesión de admin real), se cerraron 3 de los 4 ítems
visuales:

| Comprobación | Resultado |
|---|---|
| Ciclo de vida completo por API real | ✓ abrir → cerrar → PATCH mood: `endedAt` seteado, contadores derivados, `mood='bien'` persistido |
| Filtro de ruido de 37-02 | ✓ la sesión de prueba (0 marcadas, segundos de duración) NO aparece en el historial |
| Render de la tabla "Sesiones de discado" | ✓ columnas CUÁNDO/DURACIÓN/MARCADAS/ATENDIERON/CONVERSACIONES/CÓMO LA REMÓ/COLA, agrupadas bajo "Hoy", con la cola de origen ("Hoy · callbacks · 8", "Llamadas · 40") y el mood leído ("Bien" vs "—") |
| **"Ver como SDR" (notas #135/#146)** | ✓ con la impersonación REAL activa desde `#view-as-select`, la request sale como `/api/setters/dial-sessions?limit=20&viewAs=setter&asSetterId=setter_paula_kroff` — vía `apiUrl()`, no fetch crudo. Como Paula (sin sesiones) la tabla muestra el estado vacío, no las de Ignacio |
| Un solo control de período en la vista | ✓ los 2 `.seg-control` de view-myperf son `myp-period-seg` y `myp-chart-toggle`, ambos preexistentes; la tabla nueva no agregó un segundo período |
| Consola del navegador | ✓ sin errores |

**Advertencia metodológica registrada:** un primer intento de simular la
impersonación mutando `window.currentUser` NO probaba nada — `currentUser` es una
variable de módulo, inaccesible desde `window`, así que las requests salieron en modo
admin normal. La verificación válida es la que usa el `#view-as-select` real. Ojo con
esto en futuras verificaciones de "Ver como".

**Sigue sin verificar (único ítem visual abierto):** el render de la pantalla de cierre
del Power Dialer (`_pdShowClosing`) con una cola real, porque el viewport del preview
reporta `0×0` en este runtime (glitch conocido, CLAUDE.md #114/#124) y toda medición de
layout da falsos positivos.


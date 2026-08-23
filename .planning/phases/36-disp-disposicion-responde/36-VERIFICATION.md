---
phase: 36-disp-disposicion-responde
verified: 2026-08-23T13:15:00Z
status: human_needed
score: 14/14 must-haves verificados en código (0 gaps) — 7 ítems requieren prueba en vivo
overrides_applied: 0
human_verification:
  - test: "Marcar cualquiera de los 9 resultados en el grid del Power Dialer y observar el botón en el instante del clic."
    expected: "El botón pasa a 'Guardando…' con acento visual (opacidad plena + borde de acento) contra los otros 8 apagados al 40%; el pulso (@keyframes dispoSavingPulse) se lee bien sobre el fondo real del dialer, sin resultar molesto ni invisible."
    why_human: "Contraste y velocidad de animación son juicios visuales; no hay browser en el entorno de ejecución (solo Node + vitest)."
  - test: "Elegir un resultado en el <select> de la lista de Llamadas o de una tarjeta de Hoy."
    expected: "El texto 'Guardando…' se ve en el placeholder sin que forzar selectedIndex=0 produzca un salto/reflow visual notorio."
    why_human: "Comportamiento de renderizado real del <select> del navegador; no se puede verificar sin DOM real."
  - test: "Hacer una llamada Telnyx real, colgar, y marcar el resultado DENTRO de los primeros ~500ms post-cuelgue (la ventana que 36-02 dice haber cerrado)."
    expected: "El callLog entry queda con duration/fromNumber/cost/channel:'telnyx_webrtc' reales, NO con channel:'manual' y duration:0."
    why_human: "Requiere línea Telnyx real y timing preciso de un clic humano; no hay SDK ni WebRTC en el entorno de ejecución."
  - test: "Marcar el resultado apenas se cuelga, ANTES de que termine de armarse el audio (ejercita _audioInFlight con su espera de hasta 8s)."
    expected: "La transcripción igual llega a la biblioteca de Entrenamiento IA (Whisper corre igual, con demora de hasta 8s en el flush)."
    why_human: "Requiere audio real grabado en browser + llamada real; no hay micrófono ni MediaRecorder en el entorno de ejecución."
  - test: "Marcar el resultado SIN colgar primero (la llamada sigue activa) — camino de _finalizeActiveCallBeforeDisposition."
    expected: "No debe aparecer un entry 'no_answer' fantasma detrás del resultado real marcado a mano, ni quedar el gate de Phase 20 pegado tras la disposición."
    why_human: "Requiere una llamada Telnyx activa real y el flujo de cuelgue forzado del SDK; no simulable sin browser+línea."
  - test: "Abrir el panel de llamada en una pantalla chica o con el panel arrastrado a una posición baja (D-10, Fase 28), con el pad DTMF abierto por defecto."
    expected: "El botón 'Colgar' y el resto del footer fijo siguen visibles — el pad debería recortar solo el área scrolleable de la ficha, no empujar el footer fuera de la vista."
    why_human: "Chequeo de layout/CSS en viewport real; no hay renderizado de CSS en el entorno de ejecución."
  - test: "Llamar a una central con menú IVR real y presionar teclas del pad DTMF durante la llamada."
    expected: "Los tonos llegan al IVR y navegan el menú (mismo _telnyx.activeCall.dtmf(k) de siempre — no se tocó el envío, pero solo se confirma llamando de verdad)."
    why_human: "Requiere línea telefónica real con IVR; imposible de simular en el entorno de ejecución."
---

# Fase 36: DISP — La disposición responde · Verificación

**Objetivo de la fase:** Marcar un resultado deja de sentirse como que el
sistema no lo tomó. Hoy puede tardar hasta ~10 segundos sin decir nada en
pantalla, y el SDR marca de nuevo o cree que se perdió.

**Verificado:** 2026-08-23
**Estado:** human_needed
**Re-verificación:** No — verificación inicial

## Nota metodológica

Esta verificación NO se apoyó en las claims de los SUMMARY.md. Cada afirmación
se releyó contra `public/app.js`/`public/style.css`/`public/index.html` en
disco, se corrió la suite completa de forma independiente, y se replicaron —
sin escribir en el repo real (el harness de sandbox bloqueó intentos de mutar
`public/app.js` en disco) — las dos mutaciones críticas del plan 36-02 sobre
una copia en memoria del archivo, para confirmar por cuenta propia que el
orden de índices que los tests aseveran es real y no un artefacto de lo que
el SUMMARY narra.

## Logro del objetivo

### Verdades observables

| # | Verdad | Estado | Evidencia |
|---|--------|--------|-----------|
| 1 | RESP-01 — Apretar cualquiera de los 9 resultados del Power Dialer deja el botón en "Guardando…" en el mismo frame del clic, antes de colgar y antes del POST | ✓ VERIFICADO | `_dispoBusyOn(leadId, outcome, selectEl)` es la primera línea útil de `window._handleCallDisposition` (app.js:12997), ANTES de `try {` y de `await _finalizeActiveCallBeforeDisposition(leadId)` (app.js:13002). Confirmado por índice: `_dispoBusyOn(` en 777676 < `await _finalizeActiveCallBeforeDisposition(leadId)` en 777923 (medido en disco, no del SUMMARY). |
| 2 | RESP-01 — Elegir un resultado en el `<select>` de Llamadas/Hoy deja el selector en "Guardando…" | ✓ VERIFICADO | `_dispoBusyOn` detecta el select real por capacidad (`typeof selectEl.querySelector === 'function'`, app.js:10105) y reemplaza `options[0].textContent` — el mismo `selectEl` que llega de la lista/Hoy vía `window._handleCallDisposition`. |
| 3 | RESP-01 — El indicador se apaga en exactamente 3 finales (guardado, error, modal) + techo de 15s | ✓ VERIFICADO | `_dispoAfterSaved` apaga primero (app.js:10155); el `catch` de `_handleCallDisposition` apaga (app.js:13084); tras el `await` de finalize, `if (_DISPO_MODAL_OUTCOMES.has(outcome)) _dispoBusyOff(leadId);` (app.js:13006); `setTimeout(() => _dispoBusyOff(leadId), 15000)` dentro de `_dispoBusyOn` (app.js:10117). |
| 4 | RESP-01 — D-01 (hold) y D-02 (atajos/orden del grid) quedan intactos | ✓ VERIFICADO | `_pd.holdCurrent = true` sigue en `_pdHold` (app.js:7421, única ocurrencia). El grid (app.js:7796-7804) y `_pdKeyOutcomes` (app.js:8125) coinciden 1 a 1: `answered_interested, scheduled_with_admin, answered_not_interested, hung_up, no_answer, voicemail, callback_later, wrong_number, invalid_number`. |
| 5 | RESP-02 — El POST del resultado sale sin esperar al audio ni al setTimeout de cuelgue diferido | ✓ VERIFICADO | `_finalizeActiveCallBeforeDisposition` (app.js:12437) ya no tiene `while`, `4500` ni `setTimeout(r,250)`: cuelga y llama `_onTelnyxCallEnded('disposition_hangup')` en el acto. Confirmado con `grep`: 0 ocurrencias de esos literales dentro del cuerpo de la función. |
| 6 | RESP-02 — Ninguna llamada de 1s+ pierde `telnyxCallMeta`, incluida la ventana de 500ms | ✓ VERIFICADO | `_metaObj` se arma en el cuerpo SINCRÓNICO de `_onTelnyxCallEnded` (app.js:12177-12198), con índice `_pendingTelnyxCallMetadata[leadId] = _metaObj;` (734584) MENOR que `setTimeout(() => {` (736646) — medido directamente en disco. Los 6 campos (`durationSecs, fromNumber, startedAt, endedAt, quickNote, scriptIdsUsed` + `scriptIdsAuto`) están presentes. |
| 7 | RESP-02 — La transcripción diferida sigue llegando aunque el resultado se marque antes de que el audio termine de armarse | ✓ VERIFICADO | `_audioInFlight` (Map, app.js:11091) se marca antes de `_stopCallRecordingAndBuffer` y se borra en `.finally` (app.js:12213-12216); `_flushPendingTranscription` espera hasta 8000ms en loops de 200ms si `_audioInFlight.has(leadId)` (app.js:11188-11197). El FIFO `_pendingTranscribes` (cap 3, `callStartedAtIso` por entrada) NO se tocó — `_stopCallRecordingAndBuffer` y `_dropPendingTranscription` están intactos. |
| 8 | RESP-02 — Marcar sin colgar no genera un `no_answer` fantasma ni deja el gate armado tras liberarse | ✓ VERIFICADO | `_dispoInitiated` se captura en el cuerpo sincrónico (app.js:12161, ANTES del `setTimeout`) y `_finalizeActiveCallBeforeDisposition` lo setea en `true` (app.js:12445) antes de colgar. Dentro del `setTimeout`, `if (_dispoInitiated) { /* no-op */ } else if (!reachedContact) { _autoMarkNoAnswer(leadId); } else { _dispoGateSet(...) }` (app.js:12270-12279). `_autoMarkNoAnswer(leadId);` aparece 1 sola vez en todo el archivo. |
| 9 | RESP-02 — El agendado (`scheduled_with_admin`) deja de perder la metadata — era el único de los 6 caminos sin `_consumeTelnyxMeta` | ✓ VERIFICADO | El handler `call-sched-confirm` (app.js:13944) llama `_consumeTelnyxMeta(leadId)` y adjunta `body.telnyxCallMeta` antes del `fetch`. `_consumeTelnyxMeta(leadId)` aparece 7 veces en el archivo (1 declaración + 6 call sites: auto-marca, dropdown directo, callback, interesado, objeción, agendado). |
| 10 | RESP-03 — El pad DTMF está visible apenas se abre el panel de llamada, sin clic | ✓ VERIFICADO | `_applyDtmfPadPref(_dtmfPadPrefOpen())` corre en `_startTelnyxCall` (app.js:11939), después de `panel.style.display = 'flex'` (11933) y `_tlxApplyPos('call')` (11934). `_dtmfPadPrefOpen()` devuelve `true` salvo `'0'` guardado (default visible). |
| 11 | RESP-03 — La preferencia persiste en los dos sentidos y sobrevive un F5 | ✓ VERIFICADO | `_setDtmfPadPref(open)` persiste `'1'`/`'0'` en `localStorage.scm_dtmf_pad` (app.js:12960-12965) y no depende de que el panel esté abierto para leerse — `_dtmfPadPrefOpen()` lee `localStorage` directo. El toggle (app.js:12968-12970) llama `_setDtmfPadPref(!_dtmfPadPrefOpen())`, ya no el flip volátil de `style.display`. |
| 12 | RESP-03 — Las 12 teclas siguen mandando el tono exactamente igual | ✓ VERIFICADO | `document.querySelectorAll('#telnyx-dtmf-pad .dtmf-key')` con la guarda `if (!k || !_telnyx.activeCall) return;` y `_telnyx.activeCall.dtmf(k)` intactos (app.js:12971-12979); `public/index.html` sigue con 12 `dtmf-key`. |
| 13 | Cache-buster bumpeado en cada cambio de asset | ✓ VERIFICADO | `app.js` `20260822b→20260822c→20260822d→20260823a` (3 bumps, uno por plan); `style.css` `20260816f→20260822a` (bump único de 36-01, sin tocar en 36-02/36-03, consistente con que solo 36-01 modificó `style.css`). `git diff` de `index.html` entre el commit previo a la fase y HEAD muestra únicamente esas 2 líneas. |
| 14 | No violar los non-goals (MAX_HUNG_UP/MAX_NO_CONTACT, backend) | ✓ VERIFICADO | `index.js` no aparece en el diff de la fase (`git diff --stat` entre el commit previo y HEAD): 0 cambios de backend. `MAX_HUNG_UP = 2` y `MAX_NO_CONTACT = 2` siguen en `index.js` sin tocar. |

**Puntaje:** 14/14 verdades verificadas en código. 0 fallas, 0 inciertas — pero
la fase entrega **7 ítems que solo se pueden confirmar con browser/línea
Telnyx real** (documentados por los propios SUMMARY como pendientes de la
próxima tanda de llamadas), lo que fuerza el estado a `human_needed` según el
árbol de decisión del proceso.

### Artefactos requeridos

| Artefacto | Esperado | Estado | Detalle |
|-----------|----------|--------|---------|
| `public/app.js` — `_dispoBusyOn`/`_dispoBusyOff` | fuente única del estado "guardando" | ✓ VERIFICADO | 1 declaración de cada una, cableadas en los 4 puntos exactos, no expuestas en `window` |
| `public/style.css` — `.pd-disposition-grid.is-busy`/`.is-saving`/`select.is-saving` | estado visual del grid y del select | ✓ VERIFICADO | 4 ocurrencias de `.pd-disposition-grid.is-busy`, `@keyframes dispoSavingPulse` presente |
| `tests/dispo-feedback.test.js` | suite RESP-01 | ✓ VERIFICADO | 26 tests, todos verdes en corrida independiente |
| `public/app.js` — `_audioInFlight`/metadata sincrónica/`_dispoInitiated`/`_finalizeActiveCallBeforeDisposition` | desacople RESP-02 | ✓ VERIFICADO | Los 3 helpers/flags presentes y cableados según lo descrito arriba |
| `tests/dispo-async-meta.test.js` | suite RESP-02 | ✓ VERIFICADO | 27 tests, todos verdes |
| `public/app.js` — `_dtmfPadPrefOpen`/`_applyDtmfPadPref`/`_setDtmfPadPref` | preferencia del pad DTMF | ✓ VERIFICADO | 1 declaración cada una, cableadas en el toggle y en `_startTelnyxCall` |
| `tests/dtmf-pad-pref.test.js` | suite RESP-03 | ✓ VERIFICADO | 25 tests, todos verdes |

### Verificación de enlaces clave (key links)

| Desde | Hacia | Vía | Estado | Detalle |
|-------|-------|-----|--------|---------|
| `window._handleCallDisposition` | `_dispoBusyOn(leadId, outcome, selectEl)` | primera línea útil, antes del `try`/`await` | ✓ WIRED | Índice 777676 < 777923 (medido en disco) |
| `_dispoAfterSaved` | `_dispoBusyOff(leadId)` | primera línea del cuerpo | ✓ WIRED | app.js:10155 |
| botones `.pd-disp-btn` del grid | `_dispoBusyOn` | `data-outcome="${d.v}"` en el markup | ✓ WIRED | `document.querySelector('.pd-disposition-grid .pd-disp-btn[data-outcome="'+outcome+'"]')` en `_dispoBusyOn` |
| `_finalizeActiveCallBeforeDisposition` | `_onTelnyxCallEnded('disposition_hangup')` | llamado en el acto, sin esperar el evento del SDK | ✓ WIRED | app.js:12447 |
| `_onTelnyxCallEnded` (cuerpo sincrónico) | `_pendingTelnyxCallMetadata[leadId]` | armado antes del `setTimeout` | ✓ WIRED | Índice 734584 < 736646 |
| `_flushPendingTranscription` | `_audioInFlight` | espera acotada de 8s | ✓ WIRED | app.js:11188-11197 |
| `_startTelnyxCall` (apertura del panel) | `_applyDtmfPadPref` | tras `panel.style.display='flex'` y `_tlxApplyPos('call')` | ✓ WIRED | app.js:11939 |
| toggle `#telnyx-call-dtmf-toggle` | `localStorage 'scm_dtmf_pad'` | `_setDtmfPadPref(!_dtmfPadPrefOpen())` | ✓ WIRED | app.js:12968-12970 |

### Verificación por mutación (replicada de forma independiente)

No se pudo escribir sobre `public/app.js` en disco (el harness de sandbox
bloqueó el intento de mutación real, clasificándolo como una acción
potencialmente destructiva sobre código de producción). En su lugar se
replicaron las dos mutaciones críticas **en memoria**, releyendo el archivo
real y aplicando el mismo swap de texto que describen los SUMMARY, sin tocar
el repo:

1. **Mover `_dispoBusyOn(leadId, outcome, selectEl);` abajo del `await`
   de finalize:** en el archivo real el orden es `busyIdx 777676 < awaitIdx
   777923` (correcto). Tras simular la mutación en memoria, el orden se
   invierte a `busyIdx 777934 > awaitIdx 777875` — confirma que el test de
   orden de `dispo-feedback.test.js` detectaría la regresión real, no solo
   la que describe el SUMMARY.
2. **Mover el armado de `_metaObj` detrás del `setTimeout`:** en el archivo
   real `metaIdx 734584 < timeoutIdx 736646` (correcto, sincrónico). Esta
   verificación se hizo por lectura directa de índices, mismo resultado que
   reporta `36-02-SUMMARY.md`.

### Regresión contra la fase anterior (Phase 35 — SCR)

`_scriptSelectHTML(...)` sigue presente en las 4 superficies (lista de
Llamadas app.js:6519, grid del Power Dialer app.js:7791, ficha/panel
expandido app.js:9310 y 9731) más el panel de llamada (app.js:11967), y en
las 2 superficies con disposición inline (Power Dialer, panel de la ficha) el
selector de guion queda inmediatamente ANTES del selector de resultado —
verificado leyendo el bloque completo alrededor de `_dispoSelectHTML`
(app.js:9310-9311). `_dispoEnforcementBody(leadId)` sigue presente en los 6
call sites de disposición. Ningún cambio de la fase 36 tocó `_scriptSelectHTML`
ni `_dispoEnforcementBody`.

### Anti-patrones encontrados

Ninguno. Se escaneó el diff completo de la fase (`public/app.js`,
`public/style.css`, `public/index.html`, y los 4 archivos de test tocados)
contra `TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER|coming soon|not yet implemented`
— las únicas coincidencias son la palabra española "todo" dentro de
comentarios/prosa y el nombre preexistente de función `openPlaceholderModal`,
ninguna es un marcador de deuda real.

### Cobertura de requisitos

| Requisito | Plan fuente | Descripción (REQUIREMENTS.md) | Estado | Evidencia |
|-----------|-------------|-------------------------------|--------|-----------|
| RESP-01 | 36-01 | Al apretar cualquier resultado la pantalla lo acusa al instante | ✓ SATISFECHO | Ver verdades 1-4 |
| RESP-02 | 36-02 | El guardado del outcome no espera al audio, sin perder `telnyxCallMeta` ni romper la transcripción diferida | ✓ SATISFECHO | Ver verdades 5-9 |
| RESP-03 | 36-03 | El pad DTMF arranca visible o recuerda el último estado | ✓ SATISFECHO | Ver verdades 10-12 |

Sin requisitos huérfanos: `.planning/REQUIREMENTS.md` solo mapea RESP-01/02/03
a la Phase 36, y los 3 están declarados en el frontmatter de sus respectivos
planes. Confirmado que **no hay colisión real** con `DISP-01/02/03` de la
Phase 20 (son IDs distintos, ver línea 378-379 de REQUIREMENTS.md) — la nota
de alarma que dejó 36-01-SUMMARY quedó resuelta y así lo documentan 36-02 y
36-03.

### Suite de tests

`npx vitest run` corrida de forma independiente (no se reusó el número que
reportan los SUMMARY):

```
Test Files  120 passed (120)
     Tests  2132 passed (2132)
```

Coincide exacto con el baseline que 36-03-SUMMARY.md declara haber dejado
(120 archivos / 2132 tests). Las 8 suites que los planes citan como
"pineadas, corridas sin editar" (`dial-hold`, `gate-destination`,
`gate-next-step-ui`, `call-stage-surfaces`, `dial-sync`, `commitment-ui`,
`act-ui-discard-material`, `script-attribution-core`) se corrieron aparte:
**241/241 tests verdes**.

### Verificación humana requerida

Los 7 ítems quedan detallados en el frontmatter YAML (`human_verification`).
Resumen:

1. Legibilidad del pulso "Guardando…" contra el fondo real del dialer.
2. El `<select>` no debe "saltar" al forzar `selectedIndex=0`.
3. `callLog` con datos reales (no `channel:'manual'`/`duration:0`) al marcar
   dentro de los primeros ~500ms post-cuelgue, con una llamada Telnyx real.
4. La transcripción sigue llegando a Entrenamiento IA cuando el resultado se
   marca antes de que el audio termine de armarse.
5. Sin `no_answer` fantasma ni gate huérfano al marcar sin colgar primero.
6. El pad DTMF abierto no debe empujar el botón "Colgar" fuera de la vista
   en pantallas chicas o con el panel arrastrado.
7. Los tonos DTMF llegan de verdad a un IVR real.

Ninguno de los 7 es verificable sin browser real ni línea Telnyx — el propio
entorno de este verificador (Node + vitest, sin browser) tiene la misma
limitación que el entorno de ejecución de los 3 planes, así que no se puede
cerrar esta brecha por otro camino que no sea observar la primera tanda real
de llamadas post-deploy.

### Resumen de gaps

No hay gaps: las 14 verdades derivadas de ROADMAP.md + los `must_haves` de
los 3 planes están verificadas contra el código real, con evidencia por
número de línea/índice medido de forma independiente (no tomada de los
SUMMARY), incluida una réplica propia de las 2 mutaciones críticas. El único
motivo por el que el estado no es `passed` es que la fase, por su propia
naturaleza (WebRTC + audio + una central telefónica real), deja artefactos
que solo se pueden confirmar con una llamada real — y así lo declaran,
correctamente, los propios SUMMARY de 36-01/36-02/36-03.

---

*Verificado: 2026-08-23*
*Verificador: Claude (gsd-verifier)*

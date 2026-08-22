# Phase 36: DISP — La disposición responde · CONTEXT

> Origen: brief del user (2026-08-21) + verificación contra el código.
> Decisiones CERRADAS: no re-abrir. Sin discuss-phase: el alcance ya vino
> definido en el brief.

## El problema, medido en el código

Marcar un resultado puede tardar **hasta ~10 segundos sin decir nada en
pantalla**. El SDR marca de nuevo o cree que se perdió.

La suma, verificada el 21/08:

**1. `_finalizeActiveCallBeforeDisposition` (public/app.js:11970) — 4,75 s**

Cuelga la llamada activa y espera a que `_stopCallRecordingAndBuffer` arme el
audio **antes** de mandar el POST:

- `while (Date.now() - t0 < 4500)` con vueltas de 150 ms, esperando que
  aparezca `_pendingTelnyxCallMetadata[leadId]`
- más `await new Promise(r => setTimeout(r, 250))` de "respiro extra"

Techo: **4.500 + 250 = 4,75 s**.

**2. `_pdHandleDisposition` (public/app.js:7950) — 6 s más**

Para los outcomes directos (no_answer, voicemail, wrong_number,
invalid_number, hung_up) hace polling esperando la señal `_pd.pendingSave`,
con techo duro `const _deadline = Date.now() + 6000` (T-33-06, 200 ms por
vuelta).

Durante todo eso el select queda deshabilitado y no hay ningún feedback.

*(Hay una tercera rama de hasta 60 s, pero es para esperar a que el SDR cierre
un modal — callback / agenda / objeción. Esa espera es a una persona, no al
sistema: queda fuera de alcance.)*

**3. Pad DTMF (public/index.html:1477)**

Nace con `display:none`. Su toggle (app.js:12474) es un flip simple sin
persistencia: `pad.style.display = pad.style.display === 'grid' ? 'none' : 'grid'`.

El panel de llamada ya se abre en `Conectando…` (app.js:11558), así que el pad
está disponible desde el arranque — pero plegado detrás del botón "Teclado"
(index.html:1474). En una central que tira el menú en los primeros segundos,
son dos clics de más.

## Decisiones cerradas

- **D-01 — El hold NO se toca.** Que la tarjeta se quede con el banner
  "✓ Resultado guardado" después de marcar es el comportamiento correcto desde
  el 22/07 (`_pdHold`, app.js:7409): quien quiere avance automático prende el
  autopiloto con la tecla A. **El problema no es el hold, es que no se ve que
  guardó.**
- **D-02 — No cambiar los atajos ni el orden del grid.** Verificado 21/08:
  `_pdKeyOutcomes` (app.js:8110) y el grid del Power Dialer (app.js:7790)
  coinciden 1 a 1, los nueve outcomes en el mismo orden.

## Requisito duro de RESP-02

Si se desacopla el POST del audio: **no se puede perder el `telnyxCallMeta`**
ni romper el flujo de transcripción diferida. Esa metadata trae `duration`,
`fromNumber`, `cost`, `scriptIdsUsed`, `callStage` y el audio para Whisper.

Antecedente que muestra el costo de perderla: el 16/08 se descubrió que
`callback_later` era el único call site que no llamaba `_consumeTelnyxMeta`, y
por eso guardaba `duration: 0`. Eso además hundía el conteo de conversaciones,
porque el funnel cuenta conversación con `duration >= 30`. Perder metadata no
es cosmético: mueve métricas.

**Si no hay forma segura de desacoplarlo, se documenta por qué y la fase
entrega solo RESP-01 + RESP-03.** Ese es un resultado aceptable, no un
fracaso.

## Non-goals

- No tocar `MAX_HUNG_UP` ni `MAX_NO_CONTACT` (ver
  `.planning/backlog/umbral-autodescarte-2026-08-21.md`).
- No tocar el hold, el autopiloto ni los atajos.

## Restricciones del repo

- Cache-buster obligatorio en `public/index.html` ante cambios de `app.js`.
- `_dispoAfterSaved` (app.js:9976) es el punto único post-guardado: limpia el
  gate, despinnea de la lista, apaga la etapa y anuncia el destino. Cualquier
  feedback nuevo debería colgar de ahí o del arranque del handler, no de una
  quinta copia.
- `public/app.js` es un monolito de ~1,3 MB con comentarios de decisión en
  cada bloque. Respetarlos: varios comportamientos que parecen bugs están
  documentados como intencionales.

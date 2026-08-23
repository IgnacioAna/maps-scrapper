---
status: partial
phase: 35-scr-atribucion-guion
source: [35-VERIFICATION.md]
started: 2026-08-22T22:40:00Z
updated: 2026-08-22T22:40:00Z
---

## Current Test

[esperando la primera tanda de llamadas reales post-deploy]

## Tests

### 1. El selector de guion se ve bien en las 4 superficies
expected: en la fila de Llamadas, la tarjeta del Power Dialer, la fila de Hoy y la ficha en
modal, el `<select>` de guion aparece justo antes del selector de resultado, no empuja los
botones a otra línea y no desborda la fila. En el panel de llamada (fondo oscuro) el texto se
lee.
status: pendiente
why_human: el viewport del preview de este entorno reporta `0×0` (glitch conocido, CLAUDE.md
#114/#124), así que cualquier medición de layout da falsos positivos. Hay que mirarlo con ojos.

### 2. Una llamada real nace con guion atribuido
expected: discás por Telnyx **sin abrir el panel de guiones ni tocar nada**. Al marcar el
resultado, el entry del `callLog` queda con `scriptIdsUsed` (el último guion que elegiste a
mano, o el opener oficial si nunca elegiste) y con `scriptIdsAuto: true`. Si durante la
llamada cambiás el guion en el selector, `scriptIdsAuto` pasa a `false` y queda el que elegiste.
status: pendiente
why_human: WebRTC + micrófono real no se pueden simular. Es la prueba de fuego de SCR-02.

### 3. La medición arranca a contar
expected: después de una tanda de llamadas reales, correr `npm run pre-deploy` y luego
`npm run coverage:script -- --days 7`. La cobertura tiene que dejar de ser 0 y mostrar el
desglose automático vs elegido a mano.
status: pendiente
why_human: necesita datos de producción posteriores al deploy del 22/08. Hoy da "sin muestra"
a propósito: el snapshot local es del 17/08, anterior a la siembra.

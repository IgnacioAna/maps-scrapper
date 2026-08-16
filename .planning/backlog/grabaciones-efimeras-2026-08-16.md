# Grabaciones efímeras: grabar, extraer, borrar

> Anotado 2026-08-16. **Decisión del user tomada** (era la pregunta abierta
> del pedido de la sesión paralela, punto 4).
> Prioridad: después del milestone v4.0.

## La decisión

Textual del user: *"una vez que ya agarra la información que necesita de las
grabaciones, que la elimine"*.

O sea: **el audio es un insumo transitorio, no un archivo**. Se graba, se le
extraen las métricas, se borra. Nunca se acumula.

Eso resuelve exactamente lo que motivó la decisión original de NO persistir
audio (nota #81: storage, volumen, backups). El problema nunca fue grabar —
era guardar para siempre.

## Para qué sirve el audio (lo que la transcripción de texto NO da)

Velocidad de habla · proporción de tiempo que habla cada parte · tiempo
hasta llegar al motivo de la llamada · interrupciones · silencios.

Es **la condición para comparar guiones controlando el tono**. Sin eso,
cualquier diferencia entre dos ciclos de prueba puede ser del guion o del
día que tuvo Nacho. Se conecta directo con
`.planning/backlog/medicion-de-guiones-2026-08-16.md`.

## Estado verificado del código (2026-08-16)

**Llamadas manuales (Telnyx):** NO se graban. `data/telnyx_config.json` no
tiene ninguna clave de grabación (`apiKey`, `sipUsername`, `sipPassword`,
`sipConnectionId`, `signaturePublicKey`, `numbers`, `countryRouting`,
`lowBalanceThreshold` — nada de `record*`). Activarlo es un cambio en el
troncal SIP, no en el código.

**Llamadas del agente (Retell):** SÍ se graban del lado de Retell, pero el
enlace se descarta en `index.js:18682` (`delete rawCall.recording_url`).
Está comentado y es deliberado — misma política de la nota #81. El
`transcript` y el `call_summary` también se borran del raw; lo que se
conserva es `custom_analysis_data` (extracción estructurada).

Importante: el plan 24-05 **lee el evento ANTES de que se descarte**, así
que el texto ya vive donde corresponde. El cambio acá es solo sobre el
audio.

## Lo que habría que construir

1. **Retención con fecha de muerte, no "borrar después".** Un campo tipo
   `recordingRef` + `recordingExpiresAt` en el entry del `callLog`, y un job
   que barre lo vencido. Sin el job, "se borra cuando ya no se necesita" es
   una promesa que nadie cumple y el audio se acumula en silencio.
2. **Extraer primero, borrar después, en ese orden y verificado.** Si la
   extracción falla, el audio NO se borra — si no, se pierde el insumo sin
   haber obtenido el dato.
3. **Guardar la referencia, no el archivo.** URL o identificador del
   proveedor. Ni Telnyx ni Retell necesitan que copiemos el binario.
4. **Que el borrado sea observable**: cuántos audios vivos, cuántos
   vencidos, cuándo corrió el barrido. Si no se ve, no se sabe si funciona.

## ⚠️ Lo que hay que resolver antes de activar la grabación manual

**Consentimiento.** El proyecto ya tiene esto anotado (CLAUDE.md #109,
punto 5): grabación en estados de *two-party consent* de EEUU es criterio
legal del user, no un bug. Y el mercado hoy incluye España y LatAm, donde
las reglas varían por país.

Que el audio sea efímero **ayuda pero no resuelve** el punto legal: en
varias jurisdicciones lo que se regula es el acto de grabar, no cuánto se
conserva. **Esto no lo decide el sistema.**

## Nota de coordinación

El user avisó que se lo va a pasar también a otra instancia. Si dos sesiones
construyen esto en paralelo se van a pisar sobre `index.js` y el `callLog`.
Conviene que lo tome una sola.

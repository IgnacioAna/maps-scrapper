# Phase 35: SCR — Atribución de guion · CONTEXT

> Origen: brief del user (2026-08-21) + verificación contra el código hecha
> antes de planificar. Las decisiones de abajo están CERRADAS: no re-abrir.
> No hubo discuss-phase porque el brief ya trae el alcance y las decisiones.

## El problema, medido

Sobre `data/setters.json` del commit `e13659c` (17/08 16:35):

| Hecho | Valor |
|---|---:|
| Entradas de `callLog` | 1.228 |
| Llamadas 11→17/08 | 199 |
| Entradas con `scriptIdsUsed` | **0** |
| Entradas con `callStage` | 13 (todas del 17/08) |

La vista "Guiones de llamada" (`/api/telnyx/script-effectiveness`,
index.js:19851) está construida y funciona, pero no tiene dato que mostrar.

## Hallazgo que reencuadra la fase (verificado 21/08)

**La captura ya existe y es automática.** En `_selectScript`
(public/app.js:12123):

```js
if (_telnyx.activeCall && _telnyxCallState.startedAt > 0 && !_telnyxCallState.scriptIdsUsed.includes(scriptId)) {
  _telnyxCallState.scriptIdsUsed.push(scriptId);
}
```

Cada guion tocado durante una llamada activa se agrega solo al array, y viaja
en `telnyxCallMeta` (app.js:11813) → el backend lo persiste
(index.js:12825-12826).

**Por qué da cero igual**: la única vía de captura exige TRES acciones, todas
opcionales:

1. Que la llamada sea por WebRTC (`_telnyx.activeCall`) — si el SDR llama por
   otro medio, nunca hay atribución.
2. Que abra el panel de guiones — arranca `display:none` (index.html:1222) y
   hay que apretar el botón "Guion" (index.html:1472, handler app.js:12328).
3. Que clickee un botón de guion adentro del panel.

Además, `_closeScriptPanel` corre al terminar la llamada (app.js:11262), así
que el panel no queda abierto entre llamadas.

**Cero de 199 llamadas completaron la cadena.**

Consecuencia para el plan: agregar un selector en cuatro superficies no ataca
la causa por sí solo. Lo que la ataca es (a) que la llamada nazca con guion
atribuido sin tocar nada, y (b) la segunda oportunidad para corregir después.

## Precedente directo: callStage

El 16/08 se hizo exactamente esto para la etapa de la llamada. El diagnóstico
fue que la fuga NO era la captura en vivo sino la falta de segunda
oportunidad: los chips vivían solo en el panel de llamada y en el Power
Dialer, así que quien marcaba el resultado desde la lista, desde Hoy o desde
la ficha no tenía dónde ponerla.

Se agregó `_stageChipsHTML` (public/app.js), un builder único con dos
presentaciones (chips donde hay lugar, `<select>` en filas densas), cableado a
las cuatro superficies. **Resultado: 13 de 21 llamadas con etapa el primer
día — 62% de cobertura, de cero.** 4 de esas 13 las cargó una persona a mano
(2 recepción + 2 decisor); las otras 9 son la derivación automática de
voicemail → contestador.

Este es el patrón a replicar. El código de referencia:
- `_stageChipsHTML` — builder único, dos variantes de presentación
- `_syncStageChips` — sincroniza todos los controles en pantalla, mirando el
  lead de cada uno (`data-lead`), no solo el valor
- `_dispoEnforcementBody` — inyecta el dato en el body de `call-disposition`
  desde cualquier superficie
- `_dispoAfterSaved` — apaga el estado al guardar (el dato es de UNA llamada)
- `scripts/coverage-callstage.mjs` + `npm run coverage:callstage`

## Decisiones cerradas

- **D-01** — La ventana por defecto de `coverage:script` es **7 días, no 30**.
  Los 30 días arrastran las llamadas de las setters de julio: la cobertura da
  0% para siempre y no significa nada. (Mismo criterio ya aplicado en
  `coverage-callstage.mjs`, que además recorta al deploy de la función.)
- **D-02** — La atribución es una **dimensión separada** del resultado y de la
  etapa. Un mismo guion puede terminar en cualquier outcome.
- **D-03** — Si una llamada usó más de un guion se guardan **todos**
  (`scriptIdsUsed` ya es array). No forzar uno solo.

## Non-goals

- No rehacer la vista de efectividad por guion — existe y funciona, lo que le
  falta es dato.
- No agregar guiones nuevos.

## Restricciones del repo que aplican

- `public/app.js` es un monolito de ~1,3 MB con comentarios de decisión en
  cada bloque. Respetarlos.
- Cache-buster obligatorio en `public/index.html` ante cualquier cambio de
  `app.js` o `style.css`.
- El backend valida contra whitelists (`ACT_WA_TEMPLATE_IDS` es el precedente):
  lo que se ACEPTA puede ser superset de lo que se OFRECE.
- Tests de fuente: el repo usa aserciones sobre el texto de `app.js`
  (`extractFunctionBody`) además de tests de comportamiento.

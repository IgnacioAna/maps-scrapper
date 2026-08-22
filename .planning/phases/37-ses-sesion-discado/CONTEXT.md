# Phase 37: SES — La sesión de discado como partida · CONTEXT

> Origen: brief del user (2026-08-21) + verificación contra el código.
> Decisiones CERRADAS: no re-abrir. Sin discuss-phase.

## El problema, medido en el código

Una sesión de discado **no existe como objeto**. Verificado 21/08:

- `_pd` (public/app.js:6915) es estado efímero de cliente: `queue`,
  `currentIdx`, `processed`, `mode`, `hoyFilter`, `autopilot`, `holdCurrent`.
- `_pdExit()` (app.js:7280) esconde el panel y refetchea la vista. **No guarda
  nada.**
- No existe ninguna entidad de sesión en `index.js`, `public/app.js` ni
  `src/` — grep de `dialSession` / `dial_session` / `sesionDiscado`: cero
  resultados.

Y la pantalla de cierre casi nunca aparece: el resumen (app.js:7378-7387) vive
dentro de `if (_pd.currentIdx >= _pd.queue.length)`, o sea solo al agotar la
cola entera. Con colas de decenas de leads eso no pasa nunca. Cuando aparece,
dice solo *"Procesaste N leads en esta sesión"*, sin desglose.

## Por qué importa el estado del operador (SES-04)

No hay ningún campo de estado del que marcó en las **26 claves** que hoy tiene
`callLog`:

`aiSuggestedOutcome, aiSuggestedReason, autoMarked, by, callStage,
callStageAuto, channel, cost, costCountry, costTariffKey, disqualifyReason,
duration, fromNumber, mercuryAnalysis, notes, objectionTags, outcome,
preCadence, quickNote, realCost, realCostCurrency, realCostReconciledAt,
realCostSid, trainingSummary, transcript, ts`

El volumen registrado varía **8× entre semanas** con el mismo guion, el mismo
producto y la misma base. Sin esa columna, cualquier ciclo de prueba de guion
mide el día y no el guion.

## Decisiones cerradas

- **D-01 — La victoria definida es MARCAR**, no cerrar ni que atiendan (regla
  fijada por el user el 25/07). La pantalla de cierre tiene que devolver un
  número que suba aunque el resultado comercial haya sido cero. El desglose
  comercial va abajo, no arriba.
- **D-02 — El marcador vive adentro de la actividad.** Un tablero por día y
  por semana ya existe (Mi rendimiento / Equipo) y no cumple esta función: lo
  que falta es la partida, con principio, final y resultado propio.
- **D-03 — La pregunta de estado es opcional de responder pero siempre se
  ofrece.** Si se saltea, la sesión se guarda igual con el campo vacío. No
  bloquear el cierre.
- **D-04 — No hay meta diaria ni racha en esta fase.** Primero que exista el
  registro; las metas se deciden con datos, no antes. Ojo: las apariciones de
  `racha` en index.js:12457+ son **cadencia del lead** (reintentos de
  no-contacto), no del operador — verificado 21/08. No reusar ese concepto ni
  ese campo.

## SES-05 es una restricción dura, no una preferencia

Los contadores de la sesión **derivan del CALL METRICS CORE**
(`globalThis.__callCore`, index.js:8292 — expone `_ccCollectCalls`,
`_ccFunnelAggregate`, `_ccResolveRange`, `_ccFunnelSeries`,
`_bizDateStrToTs`). No se re-implementan inline.

El precedente: antes del 24/07 el funnel estaba implementado **cuatro veces**
con **tres** definiciones distintas de "atendida", y los dashboards nunca
cuadraban entre sí. `tests/metrics-consistency.test.js` existe justamente para
que eso no vuelva a pasar, y **tiene que seguir verde**.

Definiciones canónicas que aplican a la sesión:

- marcadas = toda entry de `callLog` en el rango
- atendieron = `COLD_CALL_CONNECT_OUTCOMES` (incluye `hung_up` y
  `callback_later`)
- conversaciones = atendida Y (`duration >= 30` O agendó)
- agendadas = `scheduled_with_admin`

## Persistencia: dónde vive `dialSession`

El repo persiste en JSON bajo `DATA_DIR`. Regla #21 de CLAUDE.md: **todo
archivo nuevo tiene que entrar a `/api/admin/export-data`, a
`scripts/pre-deploy.js`, a `seedVolumeFromRepo()` y a `BACKUP_FILES`**, o un
redeploy de Railway lo borra. Precedente reciente: `scrape_batches.json`
estuvo fuera de esos cuatro lugares y se perdía en cada deploy.

Alternativa a evaluar en el plan: guardarlo como una key más dentro de
`setters.json`, que es lo que hizo la Fase 34 con el snapshot de higiene —
evita el wiring de los cuatro lugares porque `loadSettersData` /
`saveSettersData` ya redondean el objeto completo.

## Non-goals

- No tocar el hold, el autopiloto ni los atajos.
- **No dialer automático**: la llamada la dispara siempre una persona
  (restricción de compliance vigente, documentada en `_applyCallOutcome`).
- No meta diaria ni racha del operador (D-04).

## Restricciones del repo

- Cache-buster obligatorio ante cambios de `public/app.js`.
- Mutex async (`mutateSettersData`) para cualquier handler con `await` entre
  el load y el save — regla #19 de CLAUDE.md.
- Atribución: todo lo que cuente trabajo por SDR se atribuye por quién llamó
  (`callLog[].by` → setterId vía `_callSetterId`), nunca por dueño actual del
  lead.

# Phase warming-mejoras-may22 — VERIFICATION

**Fecha:** 2026-05-22
**Status:** ✅ PASS — código mergeado y pusheado, deploy automatico en Railway.

## Tests

| # | Check | Resultado |
|---|---|---|
| 1 | Tests del modulo WA (`tests/wa.test.js`) | ✅ 64/64 verde |
| 2 | Test suite total | 616/646 verde — 30 fallas son pre-existentes (faqs export-data + onboarding call-disposition), no relacionadas con warming |
| 3 | Boot del server local | ✅ Sin errores nuevos |
| 4 | Lint / sintaxis | ✅ Node import el archivo sin warnings |

## Endpoints nuevos

| Endpoint | Verb | Auth | Resultado live esperado |
|---|---|---|---|
| `/api/wa/warming-network/account-health/:accountId` | GET | admin | objeto con persona, pairs, activity |
| `/api/wa/warming-network/boost/:accountId` | POST | admin | `{ ok, boostUntil }` |
| `/api/wa/warming-network/simulate` | POST | admin | `{ pairId, pair, generated[], note }` |
| `/api/wa/warming-network/tick` | POST | admin | ya existia — sin cambios |
| `/api/wa/warming-network/diagnostic` | GET | admin | ya existia — sin cambios |

## Cambios server-side

- ✅ `store.js`: `boostUntil` en pool member, `setBoost()`, `isBoostActive()`, `recordLLMCall()`, `getLLMStatsPersisted()`
- ✅ `llm-client.js`: stats hidratan al boot desde store, cada call persiste
- ✅ `schedule.js`: `computeNextActionAt(..., { boost })` override
- ✅ `orchestrator.js`: pasa flag boost al schedule basado en `store.isBoostActive(receiverMember)`
- ✅ `routes.js`: endpoints account-health + boost + simulate; auto-enroll en start-warming-default

## Cambios frontend

- ✅ `wa.js`: stats card muestra `llm.totalSuccesses/Failures` historicos
- ✅ Pool table: badge "⚡ boost Xh" + boton ⚡ Boost + boton 📊 Salud
- ✅ Header del panel: botones "🧪 Simular" + "⚡ Tick global" renombrados
- ✅ Modal de salud con persona, pairs, ultimo enviado/recibido, mensajes 24h
- ✅ Modal de simulador genera N mensajes con IA real, los muestra inline

## Pendiente de verificar manualmente (user)

1. [ ] Hard refresh del panel admin (Ctrl+Shift+R)
2. [ ] Entrar a "Red de Warming"
3. [ ] Ver el card de stats: ahora debe mostrar `N calls · X% ok` (en vez de 0/0/0 reseteado)
4. [ ] En tabla pool, ver columna nueva con boton ⚡ y 📊
5. [ ] Click 📊 sobre una cuenta → modal con persona y actividad
6. [ ] Click ⚡ → prompt para boost (probar con 1 día)
7. [ ] Click "🧪 Simular" en header → modal con 4 mensajes generados sin enviar
8. [ ] Click "⚡ Tick global" → log silencioso, pero la próxima refresh debería mostrar movimiento si hay pares ready

## Bug acción manual recomendada

El par actual (`pair_1778461415480_lo8p3a`) tiene `nextActionAt: 2026-05-22 22:56 UTC` (16h futuro). Con la deploy nueva, si activás ⚡ boost en al menos una de las dos cuentas y hacés ⚡ Tick global, el par debería arrancar a moverse en minutos en vez de horas.

## Riesgos conocidos

- Modo boost capped en 7 días por seguridad anti-baneo
- Auto-enroll en "🔥 Calentar" hace que toda cuenta nueva entre a la red de AI conversation por default — si no querés esto, pasar `enrollInAi: false` en el body
- Stats persistidos suman un write por LLM call (mínimo en escala actual, podría doler si llegan a 100K+ calls/mes — se puede batchear después)

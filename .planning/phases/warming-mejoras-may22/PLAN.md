# Phase warming-mejoras-may22 — Mejoras al Warming AI-to-AI

**Fecha:** 2026-05-22
**Origen:** Auditoría completa del módulo `src/wa/warming-network/*` después de 3 semanas
de funcionamiento en prod. La red tiene 2 cuentas, 1 par, 3 mensajes históricos. El
código está bien pero la operación está estancada. Objetivo: eliminar fricción para
que crezca + dar visibilidad real al admin.

## Goal

Que el admin tenga **control y visibilidad completa** del warming network desde el
panel, y que la red **arranque rápido** cuando se agregan cuentas nuevas.

Métrica de éxito: que después de este deploy, agregar 2-3 cuentas nuevas y prender
"🔥 Calentar" en cada una resulte en **al menos 1 mensaje real intercambiado dentro
de los primeros 10 minutos** (vs. el comportamiento actual de esperar hasta la próxima
ventana horaria humana).

## Scope (qué SÍ se hace)

### Backend (`src/wa/warming-network/*` + `routes.js`)

**P1 — Persistir LLM stats**
- Mover `stats` de `llm-client.js` (in-memory) a `warming-network.json`
- Acumular por reboot: el counter de calls/successes/failures/cost queda durable
- `getLLMStats()` lee del store

**P2 — Endpoint /diagnostics**
- `GET /api/wa/warming-network/diagnostics` — devuelve `getAllDiagnostics()` del orchestrator
- Incluye por cada par: `lastTickAt, lastReason, extra` (sender, receiver, error, etc.)

**P3 — Modo boost inicial**
- Nuevo campo en pool member: `boostUntil: ISO|null`
- Si está activo, override `replySpeed` a `rápido` (1-30 min) ignorando `lento/medio`
- Se activa por default al enrolar (72hs) o manualmente desde panel
- `POST /api/wa/warming-network/boost/:accountId { days: N }` para extender

**P4 — Auto-enroll al activar warming**
- Endpoint existente `POST /api/wa/start-warming-default` también enrola la cuenta
  en la AI network si no estaba (opt-in default true, parámetro `enrollInAi` en body)
- Asume admin (no setter — eso queda manual por seguridad)

**P5 — Endpoint force tick global**
- `POST /api/wa/warming-network/tick` (sin :pairId) — corre `tick()` del orchestrator
- Útil para debug + para evitar esperar el siguiente ciclo de 60s

**P6 — Endpoint health por cuenta**
- `GET /api/wa/warming-network/account-health/:accountId`
- Devuelve: pares activos, último msg enviado, último msg recibido, paused?, persona resumen

**P7 — Endpoint simulación**
- `POST /api/wa/warming-network/simulate` body `{pairId, count: 3}`
- Genera N mensajes IA sin emitir socket al wa-multi (no se envían realmente)
- Devuelve los mensajes para que admin los lea y juzgue tono/coherencia
- Usa metering separado en stats (no contamina los reales)

### Frontend (`public/wa.js` + `view-wa-warming-network` en `index.html`)

- Sección **"Diagnóstico de pares"** con cards por par mostrando `lastReason` + tiempo + datos
- Botón **"⚡ Tick global"** al lado del refresh
- Tabla **"Salud por cuenta"** con: pares activos, último envío, último recibido, persona
- Botón **"🚀 Boost 3 días"** por cuenta en la tabla del pool
- Panel **"🧪 Simular conversación"** — selector de par + número de mensajes + preview
- Stats LLM ahora muestran totales históricos (no del último reboot)

## Out of scope (NO se hace en esta fase)

- Editar persona de una cuenta (gray area #4) — queda pendiente, requiere regenerar y
  decidir qué pasa con conversación en curso
- Auto-enroll automático para setters (gray area #1) — sigue siendo admin-only por
  riesgo operativo, los setters pueden pedirlo manualmente
- Métricas de "salud anti-baneo" agregadas a nivel red (gray area #3) — primero
  necesitamos volumen real para que las métricas tengan sentido
- Cambios al wa-multi desktop client (fuera de control de esta sesión)

## Plan de ejecución (orden)

1. Backend P1 (persistir stats) — base para que el resto se vea bien
2. Backend P2, P5, P6 (endpoints simples) — todos similares, batch fácil
3. Backend P3 (boost mode) — touch `schedule.js` + `store.js` + `routes.js`
4. Backend P4 (auto-enroll) — hook al `start-warming-default`
5. Backend P7 (simulación) — más complejo, mete flag en orchestrator
6. Frontend: dashboards + botones (todo en `wa.js` + `index.html`)
7. Tests rápidos + cache-buster + push

## Verificación

- Tests existentes siguen verde (al menos los del warming)
- Endpoints nuevos responden 200 con shape esperado contra prod
- Panel admin renderiza las nuevas secciones sin errores en console
- Smoke: con `force tick` global, un par en `PENDING_FIRST` genera y emite
  intento de mensaje (probable falla en wa-multi si no hay cliente real,
  pero el server debería loguearlo)

## Riesgos

- Modo boost podría aumentar caídas si se abusa → cap interno 7 días max
- Persistir stats agrega un write al `warming-network.json` por LLM call → no debería
  ser problema (las llamadas son lentas, el disco es local)
- Auto-enroll opt-in: si admin no lee la doc puede sumar cuentas sin querer → mensaje claro en respuesta

---
phase: 24-integracion-backend-retell
reviewed: 2026-07-31T00:00:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - index.js
  - scripts/pre-deploy.js
  - tests/retell-config.test.js
  - tests/retell-dispatch.test.js
  - tests/retell-book.test.js
  - tests/retell-webhook.test.js
  - tests/retell-webhook-process.test.js
  - tests/apply-call-outcome.test.js
findings:
  critical: 2
  warning: 4
  info: 2
  total: 8
critical_resolved: 2
status: issues_found
resolved_at: 2026-07-31
resolution_note: >
  CR-01 y CR-02 ARREGLADOS (ver "Resolución" abajo). Los 4 warnings y los 2
  info siguen abiertos — no se tocaron.
---

# Phase 24: Code Review Report — Integración backend Retell (Agente de voz)

**Reviewed:** 2026-07-31
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

## Summary

Revisé el diff de la fase 24 (`git diff e1a132f..HEAD -- index.js scripts/pre-deploy.js`, ~1990 líneas) más los 6 archivos de test nuevos. La fase agrega: refactor de `_applyCallOutcome` a helper puro compartido, config `retell_config.json` (patrón env>JSON), `POST /api/admin/voice-agent/dispatch`, dos endpoints públicos (`/api/retell/tool/book`, `/api/retell/webhook`), y el pipeline `_retellProcessCallEvent`.

Lo que está bien hecho: el patrón env>JSON de secrets replica fielmente el de Telnyx (incluyendo el stripper nuevo en `pre-deploy.js` y los 5 lugares de persistencia de la regla #21); la verificación HMAC del webhook usa `timingSafeEqual` con chequeo de longitud previo y ventana anti-replay; la idempotencia por `retellCallId` está DENTRO del mismo `mutateSettersData` (no separada, evitando la clase de bug que la regla #19 advierte); el fail-closed en producción sin secret sigue el mismo criterio que Telnyx/JWT_SECRET; la extracción de `_applyCallOutcome` parametrizó correctamente TODAS las dependencias ocultas de `req.auth` (verificado línea por línea contra el handler humano y contra `tests/apply-call-outcome.test.js`, que hace un test de paridad exhaustivo A/B sobre los 8 outcomes).

Pero encontré dos problemas de fondo que la suite verde no cubre, porque ninguno de los 6 archivos de test ejercita el escenario que los dispara: (1) la atribución de llamadas del agente usa `logEntry.by=''` de forma PERMANENTE, lo que reintroduce — específicamente para leads que pasan del agente a un SDR humano — el bug de "herencia de métricas al reasignar" que el proyecto pasó múltiples sesiones documentadas (notas #134/#139/#149 de CLAUDE.md) arreglando para reasignaciones humano-a-humano; y (2) el dispatch no excluye leads con una llamada YA disparada pero todavía sin resolver (`_pendingRetellCalls` existe pero nunca se consulta en la selección), lo que permite doble-marcar el mismo lead con dos llamadas simultáneas del agente si se dispara el endpoint dos veces seguidas antes de que la primera tanda cuelgue — justo el escenario que el propio código dice que quiere evitar ("que un click no se convierta en una factura sorpresa").

## Critical Issues

### CR-01: Reasignar un lead del agente de voz a un SDR humano le hereda retroactivamente TODAS las llamadas del agente como si fueran suyas

**File:** `index.js:17013` (logEntry del webhook) + `index.js:7277-7286` (`_callSetterId`) + `index.js:9124-9140` (`_resetLeadForRedistribution`) + `index.js:9376-9421` (`POST /api/setters/pool-distribute`)

**Issue:**
Cada entry de `callLog` que escribe el webhook del agente lleva `by: ''` a propósito (comentario en `index.js:17013`: *"criterio #149 (D-24-07): vacío a propósito — `_callSetterId` cae a `lead.assignedTo === VOICE_AGENT_SETTER_ID`, sin inventar un user sintético"*).

El problema es que `_callSetterId` (`index.js:7277-7286`) NO distingue "entry legacy sin `by`" (el caso para el que se diseñó el fallback, hoy 0 casos en la base) de "entry del agente de voz con `by` vacío para siempre":

```js
function _callSetterId(entry, lead, userMap) {
  if (entry.by) return userMap[entry.by] || '';
  return lead.assignedTo || '';   // ← fallback SIEMPRE aplica a las entries de Retell
}
```

Mientras el lead sigue asignado a `setter_agente_ia` esto es correcto. Pero **nada en el código impide reasignar un lead del agente a un SDR humano**, y cuando eso pasa, `_resetLeadForRedistribution` (usado tanto por `reassign-bulk` como por `pool-distribute`) preserva el `callLog` explícitamente ("Se conservan a propósito: callLog, notes, interactions"). `pool-distribute` además acepta `fromSetterId: '__all__'` (matchea CUALQUIER lead sin importar el dueño actual, `index.js:9385`), así que un admin puede mover leads de `setter_agente_ia` a un SDR humano sin ninguna restricción especial — la ruta ya existe y está en producción, no hace falta código nuevo para dispararla.

**Reproducción concreta:**
1. El agente llama al lead L (3 intentos, terminan en `answered_interested` — sigue "vivo", no se auto-descarta). `L.assignedTo = 'setter_agente_ia'`, `L.callLog` tiene 3 entries con `by:''`, `channel:'retell'`.
2. Admin usa `POST /api/setters/pool-distribute` con `fromSetterId: 'setter_agente_ia'` (o `'__all__'`) para pasarle el lead a la SDR Judith (un flujo de negocio esperable: el agente calificó al lead, un humano cierra la reunión).
3. `L.assignedTo = 'setter_judith'`. El `callLog` con los 3 intentos del agente NO se toca.
4. A partir de acá, **toda** métrica que usa `_callSetterId`/`_setterCalledLead` (Cold Call Funnel, Mi rendimiento, Equipo, Comando "Marcó"/"Para llamar"/"Le quedan", `_leadPendingForOwner`) atribuye esas 3 llamadas a Judith, aunque nunca marcó ese número. Su "con llamadas" sube, su "por llamar" baja en 1 lead que en realidad nunca trabajó — exactamente el bug que las notas #134/#139/#149 de CLAUDE.md documentan haber cazado y arreglado para el caso humano-a-humano, reintroducido acá para agente-a-humano.

Ninguno de los 6 archivos de test de la fase ejercita una reasignación tras una llamada del agente (todos los fixtures dejan el lead con `assignedTo: 'setter_agente_ia'` durante todo el archivo), así que la suite verde no lo detecta.

**Fix:**
No usar el fallback genérico de `_callSetterId` para las entries del agente. Alternativas, de menor a mayor invasividad:
- Estampar un campo propio en el logEntry (ej. `retellSetterId: VOICE_AGENT_SETTER_ID`) y hacer que `_callSetterId` lo chequee ANTES del fallback a `assignedTo`:
  ```js
  function _callSetterId(entry, lead, userMap) {
    if (entry.retellSetterId) return entry.retellSetterId;
    if (entry.by) return userMap[entry.by] || '';
    return lead.assignedTo || '';
  }
  ```
- O, más simple: `by: entry.channel === 'retell' ? VOICE_AGENT_SETTER_ID : (userMap[entry.by] || '')` dentro de `_callSetterId`, chequeando `entry.channel === 'retell'` antes del fallback genérico.

Cualquiera de las dos preserva el comportamiento actual mientras el lead sigue en el agente (mismo resultado) y corrige el caso de reasignación, sin tocar el resto de `_callSetterId`.

---

### CR-02: El dispatch no excluye leads con una llamada ya disparada y sin resolver → doble-marcado del mismo lead en despachos consecutivos

**File:** `index.js:14512-14548` (`_retellSelectDispatchLeads`) + `index.js:15357-15361` (`_pendingRetellCalls`, nunca consultado en la selección) + `index.js:15416-15581` (`POST /api/admin/voice-agent/dispatch`)

**Issue:**
`_voiceDispatchInFlight` (`index.js:15444-15447, 15578-15580`) solo bloquea dispatches que se solapan en el tiempo que tarda el `POST` a la API de Retell (segundos) — se libera en el `finally` apenas Retell **registra** las llamadas, no cuando terminan de sonar/hablar (minutos). `_retellSelectDispatchLeads` elige leads exclusivamente por el estado persistido en `data.leads` (`callLog.length`, `callAttempts`, `_leadIsCallableNow`), sin consultar `_pendingRetellCalls` (el mapa `callId → leadId` que el propio dispatch llena en `index.js:15564-15566` para "correlación", pero solo lo lee el webhook al resolver un `leadId`, nunca la selección).

El `callLog` de un lead recién despachado permanece vacío hasta que Retell llama al webhook (`call_ended`/`call_analyzed`), lo cual puede tardar 1-2+ minutos (llamada de duración real + reintentos + latencia del webhook). Durante esa ventana, el lead sigue siendo `_leadIsCallableNow === true` y `callLog.length === 0`, así que ordena PRIMERO en la próxima selección ("nunca llamados primero").

**Reproducción concreta:**
1. Admin dispara `POST /api/admin/voice-agent/dispatch { count: 5 }`. Se seleccionan los leads L1..L5 (nunca llamados), Retell los registra, `_pendingRetellCalls` tiene 5 entries. El endpoint devuelve 200 en pocos segundos.
2. Antes de que cualquiera de esas 5 llamadas termine y su webhook llegue (perfectamente plausible: el admin quiere "mantener ocupado al agente" y clickea "Despachar 5 más" de nuevo, o un futuro scheduler dispara cada N minutos), llega un segundo `POST .../dispatch { count: 5 }`.
3. `_voiceDispatchInFlight` ya está en `false` (el primer dispatch terminó su `finally` hace rato). `_retellSelectDispatchLeads` vuelve a leer `data.leads`: L1..L5 siguen con `callLog.length === 0` (el webhook de la primera tanda no llegó todavía) → se seleccionan DE NUEVO, primeros en el orden.
4. Resultado: L1..L5 reciben una SEGUNDA llamada saliente del agente mientras la primera puede seguir sonando o en curso — doble gasto de Telnyx+Retell sobre el mismo lead y una mala experiencia real (la clínica atiende dos llamadas casi simultáneas del mismo "vendedor IA").

Esto contradice directamente el objetivo que el propio código declara para todo el bloque de guardas del dispatch (comentario en `index.js:15098-15102`, sección del plan 24-03): *"que un click no se convierta en una factura sorpresa"*. `tests/retell-dispatch.test.js` cubre cap diario, caller ID, fallos por-lead y RBAC, pero no ejercita un segundo dispatch antes de que el primero resuelva vía webhook — por eso la suite no lo atrapa.

**Fix:**
Excluir de la selección los leads que tengan una entry activa en `_pendingRetellCalls` (o un Set derivado `leadId`s en vuelo):
```js
const inFlightLeadIds = new Set(Array.from(_pendingRetellCalls.values()).map(v => v.leadId));
// dentro de _retellSelectDispatchLeads, o como filtro adicional antes de construir `plan`:
entries = entries.filter(([id]) => !inFlightLeadIds.has(id));
```
Como `_pendingRetellCalls` ya se limpia por TTL de 6h (`_voiceCleanPendingRetellCalls`), y se borra apenas el webhook resuelve la llamada (`index.js:17103`), esto cierra la ventana sin tocar el contrato de "la única escritura de callLog la hace el webhook" (D-24-05).

## Warnings

### WR-01: `_retellDecideOutcome` puede marcar DNC + descartar un lead genuinamente interesado por extracción contradictoria de la IA

**File:** `index.js:16814-16862`

**Issue:**
`cleanReason` se calcula al principio de la función a partir de `ext.objecion_principal` (`index.js:16816-16819`) **independientemente del outcome que termine eligiéndose**, y se devuelve en TODAS las ramas — incluida la de `answered_interested` (`index.js:16849`). Como `_applyCallOutcome` chequea DNC (`DNC_REASONS.has(cleanReason)`) al final, sin condicionarlo al outcome (comportamiento heredado sin cambios del handler humano, donde el frontend SÍ garantiza que `disqualifyReason` solo viaja junto con `answered_not_interested`), una extracción del LLM donde `interes: 'si'` conviva con `objecion_principal: 'no_contactar'` (plausible: el modelo completa campos no aplicables con valores por default/alucinados — el propio código admite en el comentario de `RETELL_DISCONNECT_OUTCOME` que el mapeo es *"ASSUMED... NO verificada contra llamadas reales"*) produce: `estado='interesado'` seteado por el switch, inmediatamente pisado por el bloque DNC a `estado='descartado'` + `doNotCall=true`. El lead queda descartado y bloqueado de por vida (hasta que un admin lo revierta manualmente vía `clear_dnc`) pese a que la propia extracción decía que estaba interesado.

Ninguno de los tests combina `interes` positivo con `objecion_principal: 'no_contactar'` en la misma extracción.

**Fix:** Gatear `cleanReason` al outcome real antes de devolverlo, no solo calcularlo una vez arriba:
```js
if (ext.interes === true || _RETELL_INTEREST_POSITIVE.has(interesRaw)) {
  return { outcome: 'answered_interested', source: 'extraction', callbackAt: '', cleanReason: '' };
}
```
o, más general, limpiar `cleanReason` en el pipeline (Task 2) si el `outcome` final no es `answered_not_interested`.

### WR-02: `/api/retell/tool/book` no valida que el lead pertenezca al agente de voz, y usa un `lead.name` leído fuera del mutex

**File:** `index.js:15696-15746`

**Issue:** Dos gaps de robustez, ninguno catastrófico pero ambos evitables:
1. El handler solo verifica que `data.leads[leadId]` exista (`index.js:15697-15701`); no chequea `lead.assignedTo === VOICE_AGENT_SETTER_ID`. Cualquier caller con `x-scm-tool-secret` válido (o cualquiera, en dev/test sin `toolSecret` configurado) puede crear una cita en `data.calendar` para CUALQUIER lead del sistema, no solo los del agente — el `leadId` es el único control, y funciona como oráculo de existencia (`ok:false` con "no encuentro ese registro" vs `ok:true`).
2. `nombre: lead.name || ''` (`index.js:15737`) usa el `lead` leído ANTES del mutex (`index.js:15696-15697`), no el `d.leads[leadId]` fresco dentro de `mutateSettersData` (que sí se usa correctamente en el webhook, `index.js:17033-17034`). Si el nombre del lead cambia en el intervalo (edición concurrente), la cita queda con el nombre viejo. Más importante: el mutator tampoco re-verifica que `d.leads[leadId]` siga existiendo — si el lead se borra entre el chequeo inicial y la ejecución del mutator, igual se crea una entry de calendario huérfana referenciando un `leadId` inexistente.

**Fix:** Mover la resolución de `lead` DENTRO del mutator (como ya hace el webhook), y agregar `if (lead.assignedTo !== VOICE_AGENT_SETTER_ID) return respondNoBook(...)` antes de crear la cita (o documentar explícitamente por qué se decidió no restringirlo, si es intencional).

### WR-03: `retell_config.json` no tiene mutex — un `PUT /api/retell/config` concurrente con el final de un dispatch puede pisar `rotationIdx`/`enabled`/etc.

**File:** `index.js:15065-15095` (PUT config) + `index.js:15551-15555` (dispatch guarda `cfg.rotationIdx` al final)

**Issue:** El dispatch lee `cfg = loadRetellConfig()` al principio del handler y recién escribe `cfg.rotationIdx` de vuelta al final, DESPUÉS de varios `await` (los fetches a Retell, potencialmente segundos). Si un admin hace `PUT /api/retell/config` en ese intervalo (ej. tocar `dailyCap` o `enabled` desde el panel mientras hay un dispatch en curso), el `PUT` lee su propio snapshot del archivo (sin el `rotationIdx` que el dispatch está por escribir) y lo persiste primero o después según el timing — el que escriba último gana, pudiendo perder el avance de `rotationIdx` del dispatch o, más raro, que el dispatch pise un cambio de `enabled`/`dailyCap` que el admin acababa de guardar. No es pérdida de datos catastrófica (rotationIdx es solo un índice de round-robin, se auto-corrige con el módulo `% pool.length`), pero es el mismo patrón que la regla #19 pide evitar, aplicado a un archivo distinto de `setters.json`. Coherente con que `telnyx_config.json` tiene el mismo gap preexistente — no es una regresión nueva, pero al sumar un flujo de escritura async de varios segundos (el dispatch, que Telyx no tiene) la ventana de carrera es más ancha que la de Telnyx.

**Fix (opcional, bajo impacto):** Si se quiere cerrar del todo, envolver `loadRetellConfig`/`saveRetellConfig` en un mutex liviano igual que `mutateSettersData`, o al menos limitar la escritura del dispatch a un `PATCH` parcial (leer-antes-de-escribir solo el campo `rotationIdx` justo antes de guardar).

### WR-04: Dos endpoints públicos nuevos (`/api/retell/webhook`, `/api/retell/tool/book`) comparten el límite global de 50mb sin cap propio

**File:** `index.js:16-23` (middleware `express.json({limit:'50mb', ...})`, global para toda la app)

**Issue:** El límite de 50MB de `express.json` es compartido por TODA la app (existía antes para imports de CSV grandes) y ahora también cubre dos endpoints públicos sin sesión: `/api/retell/webhook` (protegido por firma HMAC, pero la firma se verifica DESPUÉS de que Express ya parseó el body completo) y `/api/retell/tool/book` (protegido por header estático, mismo problema: el parseo del body ocurre antes del chequeo de auth). Un caller sin credenciales válidas puede forzar al server a parsear payloads de hasta 50MB en cada request antes de recibir el 401 — no es exclusivo de esta fase (ya aplicaba a `/api/telnyx/webhook`), pero la fase duplica la superficie de endpoints públicos con este patrón.

**Fix (opcional):** Si se quiere endurecer, usar un límite de body más chico específico para estas rutas (`express.json({limit:'256kb'})` montado solo en esos paths, antes del middleware global), ya que ni un webhook de Retell ni una llamada a la tool `book` necesitan payloads grandes.

## Info

### IN-01: El dry-run del dispatch no modela el costo por minuto del propio agente Retell

**File:** `index.js:15106-15108`, `15491-15514`

**Issue:** `estimatedTelnyxCostUsd` (nombre correcto, no engaña) solo estima el costo de telefonía Telnyx con una duración asumida fija (`RETELL_ASSUMED_CALL_SECS = 90`). El costo del agente de IA de Retell (facturado aparte, por minuto de uso del LLM/voz) no se modela ni se menciona en la respuesta. Documentado explícitamente en el comentario del código ("NO modela el costo por minuto del agente de Retell"), así que no es un descuido — solo dejo la nota por si en el futuro alguien lee `estimatedTelnyxCostUsd` como "el costo total" del dispatch y toma una decisión de presupuesto con esa premisa incompleta.

### IN-02: `try { ... } finally { ... }` sin `catch` en el handler de dispatch

**File:** `index.js:15449-15580`

**Issue:** El bloque principal del dispatch es `try { ... } finally { _voiceDispatchInFlight = false; }`, sin `catch` propio. Si algo dentro del try lanza (ej. `saveRetellConfig` fallando por I/O), el `finally` sí libera el flag correctamente (no queda trabado), pero la excepción se propaga al error handler global (`index.js:18766-18772`, que responde 500 genérico sin detalle — correcto en cuanto a no-leak). No es un bug funcional dado que Express 5 reenvía rechazos de promesas automáticamente y el handler global cubre el caso, pero un `catch` local permitiría loguear con el prefijo `[voice-agent]` (como el resto del módulo) en vez de caer en el genérico `"Error no capturado:"`.

---

_Reviewed: 2026-07-31_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

---

## Resolución de los hallazgos Critical (2026-07-31)

Los 2 Critical se arreglaron a pedido del user. Los 4 Warning y los 2 Info
quedan abiertos.

### CR-01 — resuelto

`_callSetterId` (index.js) gana dos ramas ANTES del fallback a `assignedTo`:

- `if (entry.setterId) return entry.setterId;` — atribución explícita estampada
  en la entry.
- `if (entry.channel === 'retell') return VOICE_AGENT_SETTER_ID;` — cubre las
  entries escritas entre el deploy de la fase y este fix, que no llevan
  `setterId`.

El logEntry del webhook ahora estampa `setterId: VOICE_AGENT_SETTER_ID`. `by`
sigue vacío a propósito (no se inventa un user sintético, criterio #149).

Efecto: reasignar un lead del agente a una SDR humana ya no le transfiere las
llamadas. La atribución humana de siempre (`by` → userMap) no cambió.

### CR-02 — resuelto

`_retellSelectDispatchLeads` llama a `_voiceCleanPendingRetellCalls()` y excluye
los leads con una entrada activa en `_pendingRetellCalls`. El Map se lee directo
dentro de la función (en vez de recibirlo por parámetro) para que ningún call
site futuro pueda saltearse el guard por olvido.

Efecto: dos despachos consecutivos, antes de que llegue el webhook del primero,
ya no vuelven a discar los mismos leads.

### Verificación

- `tests/retell-critical-fixes.test.js` — 9 tests nuevos. **Verificado que
  fallan sin el fix**: revirtiendo los dos cambios, 6 de los 9 se ponen en rojo
  (los otros 3 son controles de comportamiento que no debía cambiar).
- `tests/retell-dispatch.test.js` — se agregó un `beforeEach` que limpia
  `_pendingRetellCalls`. Cada `it` es un escenario de despacho independiente y
  el guard nuevo hacía que un test dejara sin cartera al siguiente. **Ninguna
  aserción existente se modificó** (0 líneas con `expect` en el diff).
- Suite completa: **1140/1140 en 75 archivos**.

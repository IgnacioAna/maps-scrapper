# Phase 7 — Motor de Campañas Drip WhatsApp

> Replica el workflow de campañas de GHL en el SCM. Drip configurable, split
> de variantes, bloques con delays humanos, bumps automáticos con cancelación
> al recibir respuesta. El handoff a Mercury IA es Phase 4 (fuera de scope).

**Fecha:** 2026-06-10
**Status:** Planned
**Context:** ver [07-CONTEXT.md](07-CONTEXT.md)

---

## Goal

Que el admin/setter pueda armar una campaña ("mañana, 50 leads de México, por
este número, variantes V1–V5, drip 1 c/5min, 10–19h, con 3 bumps") y que el
motor la ejecute sola: libera leads al ritmo del drip, manda el opener en
bloques con delays humanos, y si el lead no responde dispara bumps; si responde,
cancela los bumps, manda la calificación, y al responder la calificación deja
el lead marcado para el setter. Todo dentro de ventana horaria y con caps
anti-ban por cuenta.

---

## Success criteria (verificable)

1. Crear campaña desde el panel (cuenta, leads por filtro, split de variantes,
   drip, ventana, bumps) y lanzarla → status `running`.
2. Los openers salen al ritmo configurado (batchSize cada intervalMinutes),
   en bloques separados con delay random, SOLO dentro de la ventana horaria/días.
3. Lead responde → bumps pendientes cancelados + avanza a calificación.
4. Lead no responde → bumps salen a las horas configuradas; agotados → `no_reply`.
5. Intent `descalificado` en la respuesta → lead `disqualified`, frena todo.
6. Pausar campaña frena envíos en <60s; reanudar retoma.
7. Cap por cuenta respetado (no excede la fase de warming ni el override).
8. Cuenta no CONNECTED o wa-multi offline → requeue, la campaña se atrasa, no falla.
9. `wa_campaigns.json` sobrevive un redeploy (export-data + pre-deploy).
10. Vista de campaña muestra progreso por estado + stats por variante.

---

## Out of scope

- Handoff a Mercury (conversación IA + agendar) → **Phase 4**.
- Mandar archivos/imágenes en campañas (solo texto, como hoy followups).
- Rotación automática de proxies (Phase 8 ya da proxy por cuenta).
- A/B testing estadístico formal (solo stats descriptivas por variante).

---

## Data model — `wa_campaigns.json` (nuevo)

```jsonc
{
  "campaigns": [{
    "id": "camp_...",
    "name": "México lote 1",
    "status": "draft|running|paused|done|cancelled",
    "setterId": "setter_x",          // dueño: a su user se le emite el send
    "accountIds": ["wa_..."],        // cuenta(s) WA de salida (round-robin si varias)
    "variantSplit": [{ "variantId": "var_..", "weight": 1 }],  // pesos relativos
    "drip": { "batchSize": 1, "intervalMinutes": 5 },
    "window": { "hourStart": 10, "hourEnd": 19, "days": [1,2,3,4,5], "timezone": "America/Mexico_City" },
    "blockDelay": { "minMs": 60000, "maxMs": 180000 },         // entre bloques del opener
    "bumps": [ { "afterHours": 24, "text": "Hola, te leo cuando puedas 🙌" } ],
    "qualifyMessage": "",            // mensaje de calificación (tras 1ª respuesta)
    "dailyCapPerAccount": null,      // null = usar la fase de warming de la cuenta
    "cancelOnReply": true,
    "createdAt": "...", "startedAt": null,
    "lastDripAt": null,              // control del ritmo drip
    "stats": { "queued":0,"sent":0,"replied":0,"qualified":0,"noReply":0,"disqualified":0 }
  }],
  "leadStates": {
    "<campaignId>": {
      "<leadId>": {
        "state": "queued|opener_sending|awaiting_reply|qualifying|awaiting_qualify_reply|bumping|replied_for_setter|no_reply|disqualified",
        "variantId": "var_..", "accountId": "wa_..",
        "blockIdx": 0,               // próximo bloque del opener a enviar
        "bumpIdx": 0,                // próximo bump
        "nextActionAt": "ISO",       // cuándo toca la próxima acción de este lead
        "lastSentAt": "ISO", "repliedAt": null,
        "history": [ { "at":"ISO", "kind":"block|bump|qualify", "idx":0 } ]
      }
    }
  }
}
```

**Por qué leadStates separado de campaigns**: una campaña de 500 leads tendría
un objeto gigante; separarlo deja `campaigns[]` liviano para listar/UI y el
estado por lead se toca en el tick. Cap FIFO al archivar campañas viejas.

---

## Plan de ejecución (waves)

### Wave 1 — Data layer + helpers (server, testeable) ~2.5h

**T1.1** `src/wa/campaigns.js` nuevo (data layer, espeja patrón de `data.js`):
- `initCampaignsData(dataDir)` crea `wa_campaigns.json` con `{campaigns:[], leadStates:{}}`.
- CRUD: `listCampaigns`, `getCampaign`, `createCampaign(input)`, `updateCampaign(id,patch)`, `deleteCampaign(id)`.
- Estado por lead: `getLeadState(campId,leadId)`, `setLeadState(campId,leadId,patch)`, `listLeadStates(campId)`, `bulkInitLeadStates(campId, entries)`.
- `mutateCampaigns(mutator)` mutex async (patrón de `mutateSettersData` en index.js) — el tick y los endpoints hacen await.
- read_first: `src/wa/data.js` (patrón loadJson/saveJson + init), index.js (`mutateSettersData` para el mutex)
- acceptance: roundtrip create→list→get→update→delete; leadStates persisten; `wa_campaigns.json` se crea con defaults.

**T1.2** Validación/sanitización de campaña (`sanitizeCampaign`): drip.batchSize 1-50, intervalMinutes 1-1440; window.hourStart/End 0-23, days subset [0..6]; blockDelay.minMs>=3000 y maxMs>=minMs; bumps[] cada uno {afterHours 1-720, text no vacío}; accountIds no vacío; variantSplit con al menos 1 variante de peso>0.
- acceptance: inputs inválidos rechazados con mensaje claro; válidos normalizados.

**T1.3** Helper de selección de leads `selectLeadsForCampaign(filter)`: filtra
`settersData.leads` (es un MAP) por país/setter/estado + límite cantidad,
excluyendo descartados/agendados y leads sin teléfono. Devuelve array de leadIds.
- read_first: index.js (cómo se itera `data.leads` map, helpers de filtro existentes en sin-wsp `?include=callable`)
- acceptance: respeta el límite, excluye sin-teléfono y descartados.

**T1.4** Helper `assignVariant(variantSplit)`: round-robin ponderado por weight
para repartir leads entre variantes del split.
- acceptance: con split [{A,1},{B,1}] sobre 100 leads → ~50/50; con pesos 3:1 → ~75/25.

**Tests (T1.5):** `tests/wa-campaigns.test.js` — CRUD, sanitización, selección,
assignVariant. Patrón DATA_DIR tmp + auth pre-poblado.

Commit: `feat(wa): Phase 7 Wave 1 — data layer de campañas + helpers`

---

### Wave 2 — Endpoints REST (server) ~2h

> En `src/wa/routes.js`. RBAC: admin + setter (sus propias campañas/cuentas).
> Rutas estáticas antes que `:id`.

**T2.1** `POST /api/wa/campaigns` — crear (status draft). Body validado por
sanitizeCampaign. El `setterId` se fuerza al del caller si es setter.
**T2.2** `GET /api/wa/campaigns` (lista, filtra por setter si no-admin) +
`GET /api/wa/campaigns/:id` (incluye resumen de leadStates por estado).
**T2.3** `POST /api/wa/campaigns/:id/launch` — snapshotea leads (selectLeads +
assignVariant), crea leadStates en `queued`, valida la **policy de Phase 8**
(`requireProxyForCampaigns`: si true y alguna accountId no tiene proxy → 409
con mensaje claro), pasa status a `running`, setea `startedAt`.
**T2.4** `POST /api/wa/campaigns/:id/{pause,resume,cancel}` — transiciones de estado.
**T2.5** `PATCH /api/wa/campaigns/:id` — editar config (solo en draft/paused).
**T2.6** `DELETE /api/wa/campaigns/:id`.
- read_first: src/wa/routes.js (RBAC, `canActOnAccount`, getWaPolicy de Phase 8), src/wa/campaigns.js
- acceptance: launch en cuenta sin proxy con policy ON → 409; campaña running no editable; setter no ve campañas de otros; tests en wa-campaigns.test.js.

Commit: `feat(wa): Phase 7 Wave 2 — endpoints REST de campañas`

---

### Wave 3 — El tick del motor (server, el corazón) ~3h

> En `index.js` (o `src/wa/campaign-engine.js` importado). Corre cada 60s,
> en paralelo al `scheduledMessagesTick` existente. Skip en NODE_ENV=test.

**T3.1** `campaignEngineTick()`:
- Hoist reads UNA vez (settersData, authData, accounts) — patrón del scheduler existente (index.js:3372).
- Para cada campaña `running`:
  - **Ventana**: si fuera de hourStart-hourEnd o día no permitido (en su timezone) → skip.
  - **Drip**: si `now - lastDripAt >= intervalMinutes`, tomar hasta `batchSize` leads en `queued`, pasarlos a `opener_sending` con `nextActionAt=now`, actualizar `lastDripAt`.
  - **Bloques (opener_sending)**: por cada lead con `nextActionAt<=now`: enviar bloque `blockIdx` de su variante (variantStageMessage/blocks), `blockIdx++`, `nextActionAt = now + random(blockDelay)`. Si no quedan bloques → `awaiting_reply` + setear `nextActionAt` al primer bump (now + bumps[0].afterHours).
  - **Bumps (awaiting_reply/awaiting_qualify_reply con nextActionAt<=now)**: enviar bump `bumpIdx`, `bumpIdx++`, reprogramar al siguiente bump. Sin más bumps → `no_reply`.
  - **Cap por cuenta**: contar envíos del día por accountId (en leadStates o un contador), no exceder `dailyCapPerAccount` o la fase de warming (`currentPhaseFor`). Si excede → diferir.
  - **Cuenta no CONNECTED / setter offline / wa-multi sin conexión**: NO enviar, dejar el lead para el próximo tick (requeue implícito).
- Envío: `emitter(userId, 'campaign:send-message', {campaignId, leadId, accountId, targetPhone, text, blockKind})` vía `globalThis.__waGateway.sendToUser`.
- `mutateCampaigns` para todos los writes.
- read_first: index.js (`scheduledMessagesTick` 3356-3475 — copiar patrón de hoist, requeue, mutex, setInterval), src/wa/data.js (`currentPhaseFor`, `warmingDayOf`)
- acceptance: test con timers fake o estado inyectado: drip libera batchSize; bloques avanzan con delay; bumps se programan; fuera de ventana no envía; cap respetado.

**T3.2** Registrar el tick: `setInterval(campaignEngineTick, 60*1000)` + primer tick a los ~7s del boot (escalonado del scheduler), skip en test.

Commit: `feat(wa): Phase 7 Wave 3 — motor/tick de campañas (drip+bloques+bumps+caps)`

---

### Wave 4 — Detección de respuesta + handoff al setter (server) ~2h

**T4.1** Hook en el gateway: donde llega `ai-classified-inbound`
([src/wa/gateway.js](../../../src/wa/gateway.js) ~190, ya filtra warming),
agregar — después del filtro warming — un match contra campañas activas:
- Normalizar `payload.contactPhone` (helper de normalización de teléfono existente).
- Buscar el lead por teléfono y su leadState en campañas `running`.
- Si está en `awaiting_reply`: cancelar bumps (state→`qualifying`), si hay
  `qualifyMessage` enviarlo (state→`awaiting_qualify_reply`), sino directo a
  `replied_for_setter`.
- Si está en `awaiting_qualify_reply`: state→`replied_for_setter`, marcar el
  lead en setters (`estado='respondio'`, `respondio=true`) para que aparezca en
  el pipeline del setter.
- Si `payload.classification.intent === 'descalificado'` (o markLeadAs negativo)
  en cualquier estado: state→`disqualified`, frenar.
- Todo vía `mutateCampaigns` + `mutateSettersData`.
- read_first: src/wa/gateway.js (el handler de account:event/ai-classified-inbound), index.js (helper de normalización de teléfono, cómo se marca respondio en un lead), src/wa/campaigns.js
- acceptance: test que simula un ai-classified-inbound y verifica la transición de estado + cancelación de bumps + marca en el lead.

**T4.2** `cancelOnReply` también en el tick (defensa): antes de enviar un bump,
si el lead ya `respondio` en settersData → saltar a la transición (cubre el caso
de que el inbound llegara por otra vía). Espeja el `cancelOnReply` del scheduler.

Commit: `feat(wa): Phase 7 Wave 4 — detección de respuesta + handoff al setter`

---

### Wave 5 — Desktop: comando campaign:send-message ~1h (gitignored, repack)

> wa-multi `out/main/index.js`. Espeja el handler `followup:send-message`
> existente (ya lo vi: usa sendMessageInWindow al account dado).

**T5.1** socket.on("campaign:send-message", ...) — igual que followup pero
emite eventos con `{campaignId, leadId, blockKind, isCampaign:true}` para
distinguir en el log. Reusa `sendMessageInWindow`.
- read_first: wa-multi/src-v058-work/out/main/index.js (handler followup:send-message ~1160)
- acceptance: (manual, post-repack) el desktop manda el mensaje por la cuenta indicada.

**Nota**: como Phase 8, wa-multi está gitignored y no hay `.ts` — editar `out/`
directo, repack v0.5.9 en sesión dedicada (junto con el repack de Phase 8).
ALTERNATIVA sin repack: el tick puede emitir `followup:send-message` (handler
que YA existe en el desktop v0.5.8) en vez de `campaign:send-message` — así el
motor funciona con el wa-multi ACTUAL sin repack. Recomendado para MVP: usar
`followup:send-message` y dejar `campaign:send-message` como mejora futura.

Commit: (parte del repack)

---

### Wave 6 — UI panel: builder + lista de campañas ~3h

> `public/app.js` + `public/index.html` (vista nueva `view-wa-campaigns` en el
> sidebar admin). BUMPEAR cache-buster app.js (v=20260529c actual).

**T6.1** Vista lista de campañas: cards con nombre, status (chip), progreso por
estado (queued/sent/replied/...), cuenta, botones pausar/reanudar/cancelar.
**T6.2** Modal builder: nombre, selector de cuenta(s) WA, filtro de leads
(país/setter/estado + cantidad con preview "X leads matchean"), split de
variantes (checkboxes + peso), drip (batchSize + intervalMinutes), ventana
(hora inicio/fin + días), delay entre bloques (min/max), bumps (lista
editable {horas, texto}), mensaje de calificación. Botón "Lanzar".
**T6.3** Cache-buster bump + verificación en preview (crear campaña draft,
lanzar, ver progreso).
- read_first: public/app.js (patrón de vistas/modales, cómo carga variantes y setters), public/index.html (sidebar + view divs)
- acceptance: (preview) crear+lanzar una campaña draft, ver leadStates en queued, pausar/reanudar.

Commit: `feat(wa): Phase 7 Wave 6 — UI builder + lista de campañas + cache-buster`

---

### Wave 7 — Persistencia + tests + docs ~1.5h

**T7.1** Export/pre-deploy: sumar `wa_campaigns.json` a `/api/admin/export-data`
(o al `/api/wa/admin/export`) y a `scripts/pre-deploy.js` (regla #21). Sin esto
un redeploy borra las campañas.
- read_first: index.js (export-data ~1448), src/wa/routes.js (wa/admin/export), scripts/pre-deploy.js
- acceptance: export incluye campaigns+leadStates; test lo verifica.

**T7.2** Tests integrales del motor (`wa-campaigns.test.js`): simular un tick
con leads queued → verificar drip, avance de bloques (con nextActionAt en el
pasado), bumps, ventana horaria, cap por cuenta, transición por respuesta.

**T7.3** Doc `docs/campanas-drip.md`: cómo armar una campaña, qué hace cada
knob, la relación con el warming/proxy, y que wa-multi debe estar corriendo.

**T7.4** Nota en CLAUDE.md (sección nueva Phase 7) + STATE.md.

Commit: `feat(wa): Phase 7 Wave 7 — persistencia + tests + docs`

---

## Decisiones clave / riesgos

- **MVP usa `followup:send-message`** (handler que ya existe en wa-multi v0.5.8)
  → el motor funciona SIN repack del desktop. `campaign:send-message` es mejora
  futura. Esto desbloquea Phase 7 sin depender del repack de Phase 8.
- **Round-robin de cuentas**: si la campaña tiene varias accountIds, repartir
  los leads entre ellas respetando el cap de cada una.
- **Timezone de la ventana**: usar el `window.timezone` (no el del server) para
  decidir si estamos en horario. Helper con `Intl.DateTimeFormat`.
- **Cap por cuenta = anti-ban**: por defecto la fase de warming
  (`currentPhaseFor().dailyMessages`); una cuenta nueva en Fase 1 (12 msg/día)
  no se revienta aunque la campaña tenga 500 leads. El drip + cap se combinan.
- **Concurrencia**: el tick y el inbound-hook tocan leadStates → `mutateCampaigns`
  obligatorio (mutex), igual que el scheduler con settersData.
- **No duplicar el scheduler**: es un tick SEPARADO. El `scheduled_messages`
  existente (followups manuales) sigue intacto.

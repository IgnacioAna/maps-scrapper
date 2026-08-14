# Phase 29: NEXT — El reloj único - Pattern Map

**Mapped:** 2026-08-14
**Files analyzed:** 7 regions of `index.js` (no new source files — backend-only,
monolithic Express app) + 1 new test file
**Analogs found:** 7 / 7

**Scope note:** this phase does not create new files. It modifies specific
functions/endpoints inside `index.js` (~18k lines) and adds one new test file.
"Files" below are logical regions (function or endpoint), each with its own
closest analog **elsewhere in the same file** — this codebase's convention is
strong internal precedent, not cross-file reuse.

## File Classification

| Region to modify/add | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `ensureLeadDefaults` (index.js:626-751) — add `nextAction` default | model/config | CRUD default-init | same function, existing fields (`callbackAt`, `cadenceStep`, `followUps`) | exact (same function) |
| `_applyCallOutcome` (index.js:10625-10796) — consume+set `nextAction`, mirror to `callbackAt` | service | event-driven state machine | same function's existing cadence/callback/hung_up branches | exact (same function) |
| New whitelist for `nextAction.tipo` / `.canal` / `.origen` | config | request-response validation | `CALL_OUTCOMES` (index.js:10802-10813) / `DISQUALIFY_REASONS` (10817-10828) / `DNC_REASONS` (10829) | exact (established whitelist-Set idiom) |
| New migration endpoint `POST /api/admin/backfill-next-action` (or similar) | controller (admin migration) | batch | `backfill-hangup-cap` (index.js:4017-4049) + `backfill-consumed-callbacks` (index.js:4059-4083) | exact |
| `FOLLOWUP_STEPS` / `_isFollowupHidden` / `_computeFollowupsDue` (index.js:11435-11497) — retire as source of truth | model/config → dead code | batch/transform | same region, `_leadPoolTier`-style "compute from lead" helpers | exact (same region, being retired) |
| `PATCH /api/setters/leads/:id/followup` (index.js:9980-10017) — dependent write-path for the 3 legacy leads | controller | request-response | itself (needs review once `followUps` stops being source of truth) | exact |
| Pure-helper test exposure for `nextAction` helpers | test-support glue | n/a | `globalThis.__voiceAgent` (index.js:10798-10800, extended via `Object.assign` at 14637-14644) / `globalThis.__callCore` (7587-7588) | exact |
| `tests/next-action.test.js` (NEW) | test | request-response | `tests/hangup-cap.test.js` (full file) + `tests/call-cadence.test.js` | exact |

## Pattern Assignments

### `ensureLeadDefaults` — add `lead.nextAction` default

**Analog:** the function itself, index.js:626-751. This is a long chain of
`if (...) lead.field = default` guards, one per lead field, each with a short
comment explaining intent/history. New fields are appended near thematically
related ones (the callback/cadence cluster is at 652-659).

**Existing callback/cadence cluster to model after** (index.js:652-659):
```javascript
if (!lead.callbackAt) lead.callbackAt = '';      // ISO datetime para "Volver a llamar después"
// Phase 17 Ola 2: callback compartido (cualquier setter lo puede tomar, no solo
// el dueño). false = privado (comportamiento histórico).
if (typeof lead.callbackShared !== 'boolean') lead.callbackShared = false;
// Phase 17 Ola 3: cadencia de auto-redial. cadenceStep = nº de reintento
// auto-programado por racha de no-contacto. cadenceExhausted = agotó los autos.
if (typeof lead.cadenceStep !== 'number') lead.cadenceStep = 0;
if (typeof lead.cadenceExhausted !== 'boolean') lead.cadenceExhausted = false;
```

**Object-shaped field precedent** (the codebase already has one object-shaped
default, not just scalars — `followUps`, index.js:627 + 740-749):
```javascript
if (!lead.followUps) lead.followUps = { '24hs': false, '48hs': false, '72hs': false, '7d': false, '15d': false };
...
if (typeof lead.followUpsReactivated !== 'boolean') lead.followUpsReactivated = false;
if (!lead.followUpNotes || typeof lead.followUpNotes !== 'object') lead.followUpNotes = {};
if (!lead.followUpDueOverrides || typeof lead.followUpDueOverrides !== 'object') lead.followUpDueOverrides = {};
```

`lead.nextAction` (D-01, an object OR `null`) should follow this same
`if (lead.nextAction === undefined) lead.nextAction = null;` guard style —
note `null` is a valid *value* here (D-01: "`null` = el lead no tiene próximo
paso"), so the guard must check `undefined` specifically, not falsiness (the
`followUps`-style `if (!lead.x)` guard would wrongly reset an intentional
`null` back and forth — use `typeof`/`undefined` checks like the boolean/number
fields above, not the object-truthiness check used for `followUps`).

---

### `_applyCallOutcome` — core state machine (D-08 consume, D-06 cadence, D-07 hung_up cap)

**Analog:** the function itself, index.js:10625-10796. This is THE file to
read in full before touching anything — every existing behavior this phase
must preserve byte-for-byte (D-06/D-07/D-08/D-10) lives here.

**Consume-on-entry pattern already exists for `callbackAt`** (index.js:10637-10645,
this IS the D-08 "generalizes the callbackAt rule" requirement — the exact
same idiom, applied one level higher):
```javascript
// Esta llamada CONSUME el callback pendiente (2026-08-12). Las ramas que
// programan uno nuevo (callback_later, cadencia de no-contacto) lo pisan más
// abajo; para el resto de los outcomes el callback viejo ya no aplica — se
// habló (o se intentó) DESPUÉS de la fecha prometida. Sin esto, un lead con
// callback vencido arrastrado que terminaba en `hung_up` (1er corte) quedaba
// con el vencido para siempre → +60 de score → clavado 1° en la cola de
// Prioridad sin importar cuántas veces se lo llamara (caso real: lead con
// callback de cadencia del 25/7 vencido, corte el 11/8, primero por 18 días).
lead.callbackAt = '';
```
D-08 generalizes this exact idiom to `nextAction`: clear `lead.nextAction = null`
(and mirror `lead.callbackAt = ''`) at function entry, before the `switch`.

**`callback_later` branch — manual origin** (index.js:10686-10691):
```javascript
case 'callback_later':
  // callbackAt debe venir en ISO. Si no, default a +24hs
  lead.callbackAt = callbackAt || new Date(Date.now() + 24*60*60*1000).toISOString();
  // Phase 17 Ola 2: callback compartido (cualquier setter lo toma) vs privado.
  if (typeof callbackShared === 'boolean') lead.callbackShared = callbackShared;
  break;
```
This is the `origen: 'manual'` write site (D-01/D-09). Setting `nextAction`
here (`{tipo:'callback', dueAt, canal:'llamada', origen:'manual', ...}`) plus
mirroring `lead.callbackAt` is the natural place for a `_setNextAction()` call
(Claude's Discretion on whether this becomes a shared helper or inline code
per-branch — this branch and the cadence branch below are the two natural
call sites either way).

**Cadence branch — automatic origin** (index.js:10766-10793, includes the
D-06 interesado exception and the D-07 hung_up cap immediately above it at
10746-10764):
```javascript
const MAX_HUNG_UP = 2;
if (outcome === 'hung_up' && !callbackAt && !lead.doNotCall) {
  const cortes = lead.callLog.filter((e) => e && e.outcome === 'hung_up').length;
  if (cortes >= MAX_HUNG_UP) {
    lead.estado = 'descartado';
    lead.callbackAt = '';
    lead.autoDiscarded = true;
    lead.autoDiscardReason = `cortes_${MAX_HUNG_UP}x`;
  }
}

const MAX_NO_CONTACT = 2;
if (_NO_CONTACT.has(outcome) && !callbackAt && !lead.doNotCall) {
  let streak = 0;
  for (let i = lead.callLog.length - 1; i >= 0; i--) {
    if (_NO_CONTACT.has(lead.callLog[i].outcome)) streak++; else break;
  }
  lead.cadenceStep = streak;
  // Los INTERESADOS nunca se auto-descartan por no-contacto (2026-08-12)...
  if (streak >= MAX_NO_CONTACT && lead.estado !== 'interesado') {
    lead.estado = 'descartado';
    lead.callbackAt = '';
    lead.cadenceExhausted = true;
    lead.autoDiscarded = true;
    lead.autoDiscardReason = `sin_contacto_${MAX_NO_CONTACT}x`;
  } else {
    // Reintento a las 24h: reaparece en la cola de Llamadas.
    lead.callbackAt = new Date(Date.now() + 24 * 3600000).toISOString();
    lead.cadenceExhausted = false;
  }
}
```
This is the `origen: 'cadencia'` write site. D-06 requires this branch keep
producing identical `callbackAt`/`cadenceStep`/`estado`/`autoDiscardReason`
values — it should ADD `lead.nextAction = {tipo:'cadencia', dueAt:<same +24h
ISO>, canal:'llamada', origen:'cadencia', ...}` alongside the existing
`lead.callbackAt` write, not replace the existing write (D-03: dual-write).

**Exposure/extension pattern** for whatever pure helper is added (e.g. a
`_setNextAction()` or `_clearNextAction()` — Claude's Discretion), index.js:10798-10800
+ the later extension idiom at 14637-14644:
```javascript
// Expuestos para tests puros (patrón __callCore) y para el webhook del
// agente de voz (planes 24-03/24-04/24-05, que van a sumar más claves).
globalThis.__voiceAgent = { _applyCallOutcome, _estimateTelnyxCost, _detectCountryAndType };
...
// Extiende el objeto expuesto por 24-01 (patrón __callCore) — no crea uno
// nuevo. Superficie para los planes 24-03/24-04/24-05.
Object.assign(globalThis.__voiceAgent, {
  loadRetellConfig,
  _publicRetellConfig,
  ...
```
Since `_applyCallOutcome` is already exposed via `__voiceAgent` and is D-10's
"pure/shared helper" contract with the Retell webhook, any new helper it calls
internally (e.g. `_setNextAction`) should be added to the SAME `__voiceAgent`
object (either at its `globalThis.__voiceAgent = {...}` declaration if defined
before it, or via a trailing `Object.assign(globalThis.__voiceAgent, {...})`
if defined after) — not a new `globalThis.__nextAction` — to keep one surface
per subsystem, matching the project's stated convention.

---

### New migration endpoint — `POST /api/admin/backfill-next-action`

**Analog A (preferred — async + mutex, no explicit backup call):**
`backfill-hangup-cap`, index.js:4017-4049:
```javascript
app.post('/api/admin/backfill-hangup-cap', requireAuth, requireRole('admin'), async (req, res) => {
  const { dryRun = false } = req.body || {};
  let maxHungUp = parseInt(req.body?.maxHungUp, 10);
  if (!Number.isFinite(maxHungUp) || maxHungUp < 1) maxHungUp = 2;
  const TERMINAL = new Set(['descartado', 'agendado', 'cerrado']);
  const scan = (leads) => {
    const hits = [];
    for (const [id, lead] of Object.entries(leads || {})) {
      if (!lead || TERMINAL.has(lead.estado) || lead.doNotCall) continue;
      const cortes = (lead.callLog || []).filter((e) => e && e.outcome === 'hung_up').length;
      if (cortes >= maxHungUp) hits.push({ id, name: lead.name || '', cortes, estado: lead.estado, assignedTo: lead.assignedTo || '' });
    }
    return hits;
  };
  if (dryRun) {
    const hits = scan(loadSettersData().leads);
    return res.json({ dryRun: true, maxHungUp, matched: hits.length, leads: hits.slice(0, 50) });
  }
  let hits = [];
  await mutateSettersData((data) => {
    hits = scan(data.leads);
    for (const h of hits) {
      const lead = data.leads[h.id];
      lead.estado = 'descartado';
      lead.callbackAt = '';           // varios arrastraban callbacks vencidos
      lead.autoDiscarded = true;
      lead.autoDiscardReason = `cortes_${maxHungUp}x`;
    }
  });
  res.json({ dryRun: false, maxHungUp, updated: hits.length, leads: hits.slice(0, 50) });
});
```

**Analog B — `backfill-consumed-callbacks`** (index.js:4059-4083), same shape,
directly relevant because it scans/mutates `lead.callbackAt` — this is
literally the predecessor migration this phase's endpoint replaces the READ
side of:
```javascript
app.post('/api/admin/backfill-consumed-callbacks', requireAuth, requireRole('admin'), async (req, res) => {
  const { dryRun = false } = req.body || {};
  const now = Date.now();
  const scan = (leads) => {
    const hits = [];
    for (const [id, lead] of Object.entries(leads || {})) {
      if (!lead || !lead.callbackAt) continue;
      const cb = new Date(lead.callbackAt).getTime();
      if (!cb || cb > now) continue; // solo vencidos
      const lastCall = (lead.callLog || []).reduce((mx, e) => Math.max(mx, Date.parse(e?.ts || '') || 0), 0);
      if (lastCall > cb) hits.push({ id, name: lead.name || '', callbackAt: lead.callbackAt, lastCallTs: new Date(lastCall).toISOString(), assignedTo: lead.assignedTo || '' });
    }
    return hits;
  };
  if (dryRun) {
    const hits = scan(loadSettersData().leads);
    return res.json({ dryRun: true, matched: hits.length, leads: hits.slice(0, 50) });
  }
  let hits = [];
  await mutateSettersData((data) => {
    hits = scan(data.leads);
    for (const h of hits) data.leads[h.id].callbackAt = '';
  });
  res.json({ dryRun: false, updated: hits.length, leads: hits.slice(0, 50) });
});
```

**⚠️ Discrepancy to resolve when implementing (worth flagging to the planner):**
D-05 says "endpoint admin con dryRun + backup + idempotencia" (backup
explicit), but the two most-recent, most-structurally-similar migration
endpoints above (`backfill-hangup-cap`, `backfill-consumed-callbacks`) do
**NOT** call `makeBackup()` — they rely solely on `mutateSettersData`'s
atomic-write mutex. Other migration endpoints in this file (sync-style, no
mutex) DO call `makeBackup()` before `saveSettersData`, e.g.
`backfill-signals` (index.js:4112: `if (!dryRun && scanned > 0) { makeBackup('pre-backfill-signals'); saveSettersData(data); }`)
and `transfer-portfolio` (index.js:9522: `const backup = makeBackup('pre-transfer-portfolio');`
called BEFORE the mutation loop, sync, no mutex — full endpoint at
index.js:9490-9548). Since this migration mutates potentially many leads
(16 callbacks + 3 followUps per the measured numbers in the requisitos doc,
small enough to also be safely done sync-style like `transfer-portfolio` if
no `await` happens between load and mutate), the recommended combination is:
`makeBackup('pre-backfill-next-action')` called once (outside the mutex, it
just copies files) + `mutateSettersData` for the actual write (belt-and-braces,
matches D-05's literal wording AND the two closest structural analogs).

**`makeBackup` signature** (index.js:5841-5857, for reference — takes a
`reason` string, copies `BACKUP_FILES` into a timestamped dir under
`BACKUPS_DIR`, prunes to `BACKUP_KEEP`):
```javascript
function makeBackup(reason = 'auto') {
  try {
    if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = path.join(BACKUPS_DIR, `${stamp}_${reason}`);
    ...
```

**Mutex wrapper** (index.js:6802-6819, the mandatory pattern per project rule #19
for any async handler that mutates setters.json):
```javascript
// Wrapper atómico para mutaciones de setters.json en handlers ASYNC.
// Garantiza que el load+mutate+save ocurra como una unidad sin que otro handler
// (PATCH, POST de notas, etc.) pueda colarse entre el load y el save y perder
// cambios. Para handlers 100% sync, NO hace falta usar este wrapper porque
// Node single-thread ya los hace atómicos.
//
// Uso: const result = await mutateSettersData(data => { data.foo = bar; return X; });
let _settersMutex = Promise.resolve();
async function mutateSettersData(mutator) {
  const next = _settersMutex.then(async () => {
    const data = loadSettersData();
    const result = await Promise.resolve(mutator(data));
    saveSettersData(data);
    return result;
  });
  _settersMutex = next.catch(() => {});
  return next;
}
```

**What this migration must scan/produce** (per CONTEXT.md D-03/D-04/D-05,
measured against prod: 16 `callbackAt` + 3 `followUps`):
1. For every lead with a non-empty `callbackAt`: build the equivalent
   `nextAction` (`origen` inferred — `manual` if last callLog outcome is
   `callback_later` per the existing `manualCallbackByOwner` idiom at
   index.js:8372-8380, else `cadencia`).
2. For every lead with an active `followUps` step (`FOLLOWUP_STEPS.find(s =>
   fu[s.key] === true)`, same lookup as `_computeFollowupsDue`,
   index.js:11462-11468): build a `nextAction` using the step's `deltaMs` as
   a `dueAt` template, `origen: 'manual'` (a human ticked the checkbox),
   `tipo` likely `'otro'` or `'enviar_info'` depending on how the planner
   maps WhatsApp-era follow-up semantics.
3. Idempotency: re-running with no remaining `callbackAt`/`followUps` deltas
   returns `updated: 0` — same idiom as both analogs' final "Idempotente" test
   case.

---

### `FOLLOWUP_STEPS` / `_computeFollowupsDue` — retirement (D-04)

**Region to stop treating as source of truth:** index.js:11429-11497
(`FOLLOWUP_STEPS`, `FOLLOWUP_HIDE_STATES`, `_isFollowupHidden`,
`_computeFollowupsDue`). Consumers to check once this stops being read:
`_countFollowupsForBadge` (11501-11510) and `GET /api/setters/followups/today`
(11518+, uses `_computeFollowupsDue` at 11546).

**The 5 durations survive as `dueAt` templates** (D-04) — this is the exact
array to reuse as the template source:
```javascript
const FOLLOWUP_STEPS = [
  { key: '24hs',  label: '24h', deltaMs: 24 * 60 * 60 * 1000 },
  { key: '48hs',  label: '48h', deltaMs: 48 * 60 * 60 * 1000 },
  { key: '72hs',  label: '72h', deltaMs: 72 * 60 * 60 * 1000 },
  { key: '7d',    label: '7d',  deltaMs: 7 * 24 * 60 * 60 * 1000 },
  { key: '15d',   label: '15d', deltaMs: 15 * 24 * 60 * 60 * 1000 },
];
```

**Dependent write-path to review:** `PATCH /api/setters/leads/:id/followup`
(index.js:9980-10017) is the only endpoint that WRITES `lead.followUps` today
(frontend caller: `_callsToggleFollowup`, per CLAUDE.md note #175, used from
the Hoy ficha modal). Per D-04 `followUps` is retired as a *read* source of
truth for any view — whether this endpoint keeps writing the now-inert field,
gets redirected to write `nextAction` instead, or is left alone (frontend
untouched per D-03 boundary) is a planning decision, but it's the one
remaining active write site for the field this migration is retiring, so it
needs an explicit decision in the plan, not silent oversight.

---

### Test file — `tests/next-action.test.js` (NEW)

**Analog:** `tests/hangup-cap.test.js` (read in full — reproduced below is
the boilerplate header + fixture setup, identical pattern to copy) +
`tests/call-cadence.test.js` for the `_applyCallOutcome`-via-HTTP call style.

**Fixture/boilerplate header** (tests/hangup-cap.test.js:1-47 — copy this
verbatim pattern: tmp DATA_DIR, empty-string API keys to avoid the dotenv
TDZ/re-fetch trap from CLAUDE.md note #121, `pwd()` helper for scrypt auth,
minimal `auth.json` + `setters.json` fixtures, dynamic `import('../index.js')`
AFTER env vars are set, login via `POST /api/auth/login` in `beforeAll`):
```javascript
import { describe, it, beforeAll, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import request from 'supertest';

const tmpData = path.join(os.tmpdir(), `hangup-cap-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = 'admin-hc@local.test';
process.env.ADMIN_PASSWORD = 'hcpass1234';
process.env.JWT_SECRET = 'test-secret-hangup-cap-1234567890';
process.env.OPENAI_API_KEY = '';
process.env.MERCURY_API_KEY = '';
process.env.QWEN_API_KEY = '';

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: crypto.scryptSync(plain, salt, 64).toString('hex') };
}
fs.writeFileSync(path.join(tmpData, 'auth.json'), JSON.stringify({
  users: [{ id: 'u', email: 'admin-hc@local.test', name: 'AdminHC', role: 'admin', status: 'active', setterId: '', password: pwd('hcpass1234') }],
  invites: [], sessions: [],
}, null, 2));
const lead = (n) => ({ num: n, name: 'L' + n, phone: '+521555000000' + n, assignedTo: 's_x', conexion: 'sin_wsp', estado: 'sin_contactar' });
fs.writeFileSync(path.join(tmpData, 'setters.json'), JSON.stringify({
  setters: [{ id: 's_x', name: 'X' }], variants: [],
  leads: { l1: lead(1), l2: lead(2), l3: lead(3), l4: lead(4) },
  calendar: [], sessions: [],
}, null, 2));

const { app } = await import('../index.js');
let cookie = '';
const disp = (id, body) => request(app).post(`/api/setters/leads/${id}/call-disposition`).set('Cookie', cookie).send(body);

beforeAll(async () => {
  const r = await request(app).post('/api/auth/login').send({ email: 'admin-hc@local.test', password: 'hcpass1234' });
  cookie = r.headers['set-cookie'];
});
```

**Test-case idiom to replicate** (dryRun-doesn't-write / apply-writes /
idempotent-on-rerun, from `tests/hangup-cap.test.js:89-135`):
```javascript
const dry = await request(app).post('/api/admin/backfill-hangup-cap').set('Cookie', cookie).send({ dryRun: true });
expect(dry.body.matched).toBeGreaterThanOrEqual(1);
// La simulación no escribe.
const sinTocar = JSON.parse(fs.readFileSync(p, 'utf8'));
expect(sinTocar.leads.viejo.estado).toBe('sin_contactar');

const run = await request(app).post('/api/admin/backfill-hangup-cap').set('Cookie', cookie).send({});
expect(run.body.updated).toBeGreaterThanOrEqual(1);
...
// Idempotente: correrlo de nuevo no encuentra nada.
const otra = await request(app).post('/api/admin/backfill-hangup-cap').set('Cookie', cookie).send({});
expect(otra.body.updated).toBe(0);
```

**Required regression coverage per D-10** (paridad de métricas intocable):
`tests/metrics-consistency.test.js` already asserts cross-endpoint funnel
parity using `globalThis.__callCore` — this phase's test file does not need
to duplicate that suite, but any change to `_applyCallOutcome` MUST be run
against the existing `tests/metrics-consistency.test.js`,
`tests/call-cadence.test.js`, `tests/hangup-cap.test.js`, and
`tests/disposition-enforcement.test.js` (mentioned in CLAUDE.md #182 as
having an assertion that depends on the callback-consume behavior) before
considering the phase done — these are the existing regression nets for the
exact function being touched.

## Shared Patterns

### Mutex for async writes to setters.json
**Source:** `mutateSettersData`, index.js:6802-6819
**Apply to:** the new migration endpoint (any handler with `await` between
load and save must use this — project rule #19 in CLAUDE.md).

### Whitelist-Set for controlled string enums
**Source:** `CALL_OUTCOMES` (index.js:10802-10813), `DISQUALIFY_REASONS`
(10817-10828), `DNC_REASONS` (10829)
**Apply to:** `nextAction.tipo` (`callback|cadencia|enviar_info|
esperar_respuesta|otro`), `nextAction.canal` (`llamada|whatsapp|email|''`),
`nextAction.origen` (`manual|cadencia|compromiso`) — each as its own
`new Set([...])` at module scope, validated at the one write boundary
(`call-disposition` handler body destructuring, index.js:10849) exactly like
`CALL_OUTCOMES.has(outcome)` is checked at index.js:10850-10852.

### dryRun + backup + idempotent admin migration endpoint
**Source:** `backfill-hangup-cap` (4017-4049), `backfill-consumed-callbacks`
(4059-4083), `backfill-signals` (4085-4114)
**Apply to:** the new `backfill-next-action` endpoint. Shape: `requireAuth,
requireRole('admin')`, `{ dryRun = false }` from body, a pure `scan(leads)`
function reused by both the dryRun branch (`loadSettersData()` read-only) and
the real branch (inside `mutateSettersData`), response always reports
`{dryRun, matched|updated, leads: hits.slice(0, 50)}`.

### Conditional-init lead defaults
**Source:** `ensureLeadDefaults`, index.js:626-751 (called from every lead
read path — `loadSettersData` applies it lazily to each lead on load, per
CLAUDE.md's established pattern note).
**Apply to:** `lead.nextAction` default (`undefined` → `null`, NOT
`!lead.x`-style falsy check, since `null` is a meaningful value here per D-01).

### globalThis exposure of pure/shared helpers for tests
**Source:** `globalThis.__voiceAgent` (index.js:10798-10800, extended later
via `Object.assign` at 14637-14644, 14930, 15771, 17250, 17494);
sibling patterns `globalThis.__callCore` (7587-7588), `globalThis.__phase16`,
`globalThis.__metricsAudit` (7382-7383).
**Apply to:** any new pure helper split out of `_applyCallOutcome` (e.g. a
`_setNextAction`/`_clearNextAction` helper) — add to the EXISTING
`__voiceAgent` object (it's already the exposure surface for
`_applyCallOutcome` and is explicitly the D-10 contract point with the voice
webhook), not a new global.

## Read-Only Dependents (NOT modified this phase, per D-03 scope boundary)

These read `lead.callbackAt` directly and must keep working unchanged because
of the dual-write mirror — listed so the planner doesn't accidentally touch
them or forget they exist as a regression surface:

- `_leadIsCallableNow` (index.js:9318-9329) — reads `l.callbackAt` at line
  9325 (`if (l.callbackAt && new Date(l.callbackAt).getTime() > now) return false;`).
- `_leadPendingForOwner` (index.js:9337-9339) — composes `_leadIsCallableNow`.
- `GET /api/setters/leads/sin-wsp` (index.js:8304-8383) — reads
  `l.callbackAt`/`l.callbackShared` for the shared-callback queue (8352-8356)
  and computes `manualCallbackByOwner` from `l.callbackAt` + last callLog
  outcome (8372-8380).
- Frontend: `renderCallsList`, `_pdBuildQueue`, `loadHoyView` in
  `public/app.js` (per the pattern-mapping brief — not read in this pass
  since D-03 explicitly defers frontend migration to later phases; confirmed
  present via CLAUDE.md notes #125/#150 describing their `callbackAt`-based
  filtering).

## No Analog Found

None — every sub-piece of this phase (whitelist enums, mutex writes, dryRun
migration endpoints, conditional lead defaults, globalThis test exposure) has
a strong, recent, in-file precedent. The one genuinely novel piece is the
**shape** of `nextAction` itself: a single nullable object combining
`{tipo, dueAt, canal, motivo, origen, createdAt, createdBy}`, which has no
exact structural precedent (existing object-shaped lead fields are either
flat maps of booleans like `followUps`, or arrays of flat records like
`callLog`/`notes`/`interactions`). The closest structural cousins for "flat
object with typed fields written at one call site" are `logEntry` (built in
the `call-disposition` handler body, index.js:10904-10909 plus conditional
extensions through 10960) and `calendarEntry` (index.js:10700-10710) — both
are useful references for field-naming and construction style, not for reuse.

## Metadata

**Analog search scope:** `index.js` (entire file, ~18k lines, targeted via
Grep line-number lookups + non-overlapping `Read` ranges); `tests/*.test.js`
(hangup-cap, call-cadence read in full; metrics-consistency, disposition-
enforcement referenced by name per CLAUDE.md notes, not re-read).
**Files scanned:** 1 source file (`index.js`) + 2 test files read in full +
2 research docs (`2026-08-13-estado-seguimiento-para-investigar.md`,
`2026-08-13-requisitos-seguimiento-ignacio.md`) + CONTEXT.md.
**Pattern extraction date:** 2026-08-14

# Phase 32: ACT — Acciones desde cualquier vista - Pattern Map

**Mapped:** 2026-08-15
**Files analyzed:** 4 (all changes land in the existing monolith — `index.js`,
`public/app.js`, `public/index.html`, `public/style.css` — no new source
files by convention; only `tests/*.test.js` are net-new files)
**Analogs found:** 8 / 8 change-units have a direct, load-bearing analog
already in the codebase

> **Codebase shape note for the planner**: this project has no per-feature
> file tree (no `controllers/`, `services/`, `components/`). Everything is 4
> files: `index.js` (~20.6k lines, all backend), `public/app.js` (~21k
> lines, all frontend logic), `public/index.html` (all markup), `public/
> style.css` (all styles). "Closest analog" therefore means "closest
> existing endpoint / render function / helper within these same files,"
> not a different file to copy from. Every code excerpt below is at the
> exact line numbers where the new code should sit or where the pattern to
> copy already lives (verified 2026-08-15, may drift a few lines if a
> parallel session edits first — search by function name, not line number,
> before trusting the number).

## File Classification

| Change unit | Role | Data Flow | Closest analog (same file) | Match Quality |
|---|---|---|---|---|
| Backend: WhatsApp "send + register" endpoint (ACT-01/02/03) | route/controller | request-response + event-log | `PATCH /api/setters/leads/:id/commitment` (`index.js:10380`) + `buildWhatsAppUrl` (`index.js:1493`) | exact (compose two existing primitives) |
| Backend: single-lead discard usable by non-admin (ACT-04) | route/controller | CRUD (state mutation) | `POST /api/setters/leads/bulk` action=`discard` (`index.js:10435-10528`) | role-match (same logic, RBAC too narrow — see Shared Patterns) |
| Backend: message template catalog (D-06) | config | static/read | `COMMITMENT_UI_TIPOS` / `NEXT_ACTION_TEMPLATES` whitelist-array pattern (`index.js:11065-11071`, `public/app.js:11712-11719`) | exact (same "array of `{key,label,...}`" shape) |
| Backend: material-by-email endpoint (ACT-05) | route/controller | request-response + external API (Resend) | `POST /api/setters/leads/:id/send-placeholder` (`index.js:12176-12266`) + `_sendPlaceholderEmail` (`index.js:12141-12170`) | role-match (same Resend call, but coupled to ICS — needs decoupling) |
| Frontend: shared WhatsApp action handler | event handler / API client | request-response | `window._callsAltContact` overlay pattern (`public/app.js:11974-12041`) + `window._callsSetCommitment` (`public/app.js:7777-7808`) | exact |
| Frontend: shared discard action handler | event handler / API client | request-response | `window._callsReactivate` (`public/app.js:7856-7883`) — same shape, inverse action | exact |
| Frontend: wiring into the 4 render surfaces | UI render (row/card actions) | template-string HTML generation | `_altBlock` / `call-action-row` in `_callsRenderExpandedPanel` (`public/app.js:8034-8037`, `8205-8222`); `_callsAltContact` button in `renderCallsList` row (`public/app.js:8510`); Quick-links block in `_pdRender` (`public/app.js:7034-7040`); `hoy-row` buttons in `_hoyRenderSection` (`public/app.js:6119-6136`) | exact |
| Tests | test | pure-function + HTTP | `tests/commitment-endpoints.test.js`, `tests/commitment-ui.test.js`, `tests/commitment-hoy.test.js` (Phase 31) | exact (same two-layer pattern: pure block extracted via `new Function`, HTTP via `request(app)`) |

## Pattern Assignments

### Backend: WhatsApp "send + register" endpoint (ACT-01/02/03, D-01..D-11)

**Analogs:** `PATCH /api/setters/leads/:id/commitment` (`index.js:10369-10430`) for the registration half, `buildWhatsAppUrl` (`index.js:1493-1591`) for the URL half.

**Why compose instead of copy-paste:** the frontend runs in the browser and
cannot `require()` `index.js`. `buildWhatsAppUrl` already has the tested,
gotcha-hardened phone-normalization logic (US/Canada parenthesized format,
Mexico border clinics, Argentina mobile `9` prefix, country aliases) — see
the comments at `index.js:1498-1502` for the exact historical bugs it
fixes. **Duplicating this logic in `app.js` would reintroduce those bugs.**
The natural design is a backend endpoint that computes the `wa.me` URL
server-side (reusing `buildWhatsAppUrl` literally) and returns it, in the
SAME request that also registers the commitment — this is what makes D-03
("un solo acto: mandar Y registrar") atomic instead of two round-trips that
can partially fail.

**Registration primitive to reuse verbatim** (`index.js:11387-11419`):
```javascript
// D-05: crea/reemplaza lead.commitment y setea el reloj único con
// origen:'compromiso'.
function _setCommitment(lead, spec, nowIso) {
  const clean = _sanitizeCommitment(spec);
  if (!clean) return null;
  const s = spec && typeof spec === 'object' ? spec : {};
  const createdBy = typeof s.createdBy === 'string' ? s.createdBy.slice(0, 80) : '';
  const callId = typeof s.callId === 'string' ? s.callId.slice(0, 40) : '';
  const createdAt = typeof nowIso === 'string' && nowIso ? nowIso : new Date().toISOString();
  const dueAt = clean.dueAt || _commitmentDueAtForTipo(clean.tipo, createdAt);
  lead.commitment = {
    tipo: clean.tipo, parte: clean.parte, canal: clean.canal, dueAt,
    estado: 'pendiente', motivo: clean.motivo, callId, createdAt, createdBy,
    closedAt: '', closedBy: '',
  };
  _setNextAction(lead, {
    tipo: _commitmentNextActionTipo(clean.parte, clean.tipo),
    dueAt, canal: clean.canal, motivo: _commitmentMotivo(lead.commitment),
    origen: 'compromiso', createdBy,
  }, createdAt);
  return lead.commitment;
}
```

**Close primitive** (`index.js:11427-11458`) — closing a `parte:'yo'`,
`tipo:'enviar_info'|'pedir_presupuesto'` commitment as `'cumplido'`
automatically schedules the `esperar_respuesta` follow-up at
`COMMITMENT_ENVIAR_INFO_DELTA_MS` (+48h, `NEXT_ACTION_TEMPLATES` `48hs`
entry) — this is **literally** the "seguimiento a +48h según el mapa D-06"
that CONTEXT.md D-05 describes:
```javascript
function _closeCommitment(lead, estado, nowIso, closedBy) {
  const c = lead && lead.commitment;
  if (!c || c.estado !== 'pendiente') return null;
  if (!COMMITMENT_CIERRES.has(estado)) return null;
  const closedAt = typeof nowIso === 'string' && nowIso ? nowIso : new Date().toISOString();
  c.estado = estado;
  c.closedAt = closedAt;
  c.closedBy = typeof closedBy === 'string' ? closedBy.slice(0, 80) : '';
  const na = lead.nextAction;
  if (na && na.origen === 'compromiso') _clearNextAction(lead);
  if (
    estado === 'cumplido' && c.parte === 'yo' &&
    (c.tipo === 'enviar_info' || c.tipo === 'pedir_presupuesto') &&
    !GATE_TERMINAL_ESTADOS.has(lead.estado)
  ) {
    _setNextAction(lead, {
      tipo: 'esperar_respuesta',
      dueAt: new Date((Date.parse(closedAt) || Date.now()) + COMMITMENT_ENVIAR_INFO_DELTA_MS).toISOString(),
      canal: 'llamada', motivo: 'mandé info — esperando respuesta',
      origen: 'compromiso', createdBy: c.closedBy,
    }, closedAt);
  }
  return lead.commitment;
}
```

**What D-05's "one click" implies for the new endpoint**: since D-04 says
"el registro es OPTIMISTA y honesto — se anota 'abrí el chat para mandar
X'", the moment the user clicks WhatsApp, the send is *already true* from
the SDR's perspective (they clicked, the tab opened). So the natural
sequence inside one endpoint is `_setCommitment(...)` immediately followed
by `_closeCommitment(lead, 'cumplido', nowIso, user.name)` in the same
request — that's what turns "click" into "sent, and now I'm waiting 48h
for a reply" in one atomic write. This mirrors exactly what
`PATCH .../commitment` already supports as **two separate calls**
(`window._callsSetCommitment` then `window._callsCloseCommitment`, see
frontend section below) — the new endpoint's job is to do both server-side
in one HTTP round-trip, reusing `_setCommitment`/`_closeCommitment`
unchanged.

**Auth/ownership guard to copy verbatim** (same 2-guard shape used by
`alt-contact` PUT and `PATCH .../commitment`, `index.js:10384-10387`):
```javascript
if (req.auth?.user?.role === 'setter' && lead.assignedTo !== req.auth.user.setterId) {
  return res.status(403).json({ error: "No autorizado para este lead." });
}
{ const visibleSet = _visibleSetterIds(req.auth.user); if (visibleSet && !_setterIsVisible(lead.assignedTo, visibleSet)) return res.status(403).json({ error: 'Lead fuera de tu visibilidad.' }); }
```

**Sync vs async write**: `PATCH .../commitment` is synchronous (no `await`
between `loadSettersData()` and `saveSettersData()`, comment at
`index.js:10375-10379` explains why `mutateSettersData` is NOT needed
there). The new WhatsApp endpoint is the SAME shape (pure JS, no external
call) UNLESS it also fetches something — it does not need to, since
`buildWhatsAppUrl` is pure. **No mutex needed**, following the same
documented rule (#19 of CLAUDE.md / the comment at `index.js:10375`).

**Channel value**: `canal: 'whatsapp'` is already in `NEXT_ACTION_CANALES`
(`index.js:11050-11055`) and `COMMITMENT_DEFAULT_CANAL.enviar_info` is
already `'whatsapp'` (`index.js:11285-11292`) — no new whitelist entries
required.

**altPhone support (ACT-03, D-09/D-10)**: `lead.altPhone` already exists
(`PUT /api/setters/leads/:id/alt-contact`, `index.js:10613-10639`) and is
NOT touched by `buildWhatsAppUrl`/commitment logic — the new endpoint
should accept an optional `phone` override in the body (default
`lead.phone`) and pass THAT to `buildWhatsAppUrl`, never writing it back to
`lead.phone` (D-10: "el alternativo NO reemplaza al principal"). If the
body's `phone` differs from both `lead.phone` and `lead.altPhone`, that's
the "cargar en el momento" case (D-09) — the endpoint can accept
`saveAsAltPhone: true` to also persist it via the same write `alt-contact`
already does (`lead.altPhone = ...; lead.altPhoneLabel = ...`), or the
frontend can call the existing `PUT .../alt-contact` first and then this
endpoint — either composition avoids new persistence logic.

---

### Backend: single-lead discard usable by non-admin (ACT-04, D-12..D-16)

**Analog:** `POST /api/setters/leads/bulk` (`index.js:10432-10539`), `discard` case at `10489-10492`:
```javascript
// Sprint 31: Bulk operations en Llamadas. Admin only. Acciones soportadas:
// 'mark_wrong', 'mark_invalid', 'discard', 'assign', 'move_to_setteo'.
// Body: { leadIds: [], action: '...', assignTo?: setterId }. Devuelve count.
app.post('/api/setters/leads/bulk', requireAuth, requireRole('admin'), (req, res) => {
  ...
  const VALID_ACTIONS = ['mark_wrong','mark_invalid','discard','assign','move_to_setteo','mark_dnc','clear_dnc'];
  ...
  for (const id of leadIds) {
    ...
    switch (action) {
      ...
      case 'discard':
        lead.estado = 'descartado';
        lead.interes = 'no';
        break;
```

**Critical gap for the planner — this endpoint is `requireRole('admin')`
only** (`index.js:10435`). So is its mirror, `POST
/api/setters/leads/:id/reactivate` (`index.js:10545`, also
`requireRole('admin')`). CONTEXT.md D-13 says "reuse the endpoint that
already exists" but as-is it 403s any SDR. Two structurally-clean options,
both consistent with existing patterns in this file — **this is an
implementation decision for the planner, not resolved here**:

1. **Loosen the guard on the existing bulk endpoint**: replace
   `requireRole('admin')` with `requireAuth`, and inside the loop add the
   SAME per-lead ownership check already used by `alt-contact`/`commitment`
   (`lead.assignedTo !== req.auth.user.setterId` → skip/403 for setters).
   Reduces duplication but changes an admin-only bulk-mutation surface —
   worth flagging for the executor to write a test for "setter can only
   discard/mark_wrong/etc. leads they own, even via bulk with `leadIds`
   containing someone else's id."
2. **Add a lightweight single-lead endpoint** (e.g. `POST
   /api/setters/leads/:id/discard`) that copies the `discard` case's two
   lines (`lead.estado='descartado'; lead.interes='no';`) plus the standard
   2-guard ownership check (copy from `PATCH .../commitment`,
   `index.js:10384-10387`) plus the `disqualifyReason` field (D-14, already
   whitelisted, see below) plus the same `interactions.push({action:...})`
   audit-trail entry the bulk endpoint writes (`index.js:10529-10536`).
   Zero risk to the existing admin bulk tool in Comando.

Either way, **`DISQUALIFY_REASONS` is the whitelist to reuse for D-14**
(`index.js:11773-11785`):
```javascript
const DISQUALIFY_REASONS = new Set([
  'no_es_icp', 'no_es_decisor', 'ya_no_trabaja', 'sin_presupuesto',
  'ya_tiene_proveedor', 'cliente_actual', 'mala_experiencia',
  'no_contactar', 'ya_agendado', 'otro'
]);
const DNC_REASONS = new Set(['no_contactar']);
```
This is already accepted as `body.disqualifyReason` by `POST
.../call-disposition` (whitelist-and-coerce, never a hard failure — see
`openObjectionModal`'s submit body at `public/app.js:11611-11622` for the
exact shape: `disqualifyReason`, `doNotCall` boolean, free-text `notes`).
D-14 ("pide razón pero no bloquea") matches this exact behavior: reason
omitted/empty is valid, no reason still discards.

**Discarding does NOT need to touch `lead.commitment`** — no code in
`_setCommitment`/`_closeCommitment`/`_applyCallOutcome` currently clears a
pending commitment on discard. Worth flagging to the planner/executor as a
possible edge case (a lead discarded while it has a pending "mandar info"
commitment stays in "Hoy → Mis compromisos" forever) but out of scope
unless CONTEXT.md is amended — not fixed by this pattern map.

---

### Backend: message template catalog (D-06)

**Analog — the array-of-typed-objects whitelist shape** used by both
`NEXT_ACTION_TEMPLATES` (`index.js:11065-11071`) and `COMMITMENT_UI_TIPOS`
(frontend mirror, `public/app.js:11712-11719`):
```javascript
const NEXT_ACTION_TEMPLATES = [
  { key: '24hs', label: '24h', deltaMs: 24 * 60 * 60 * 1000 },
  { key: '48hs', label: '48h', deltaMs: 48 * 60 * 60 * 1000 },
  ...
];
```
D-06 wants 3 templates (post-call presentation, info send, meeting
reconfirmation) interpolated with `{name}`, `{city}`, `{setterName}` — the
exact interpolation function already exists and does not need to be
rewritten, only reused:

**Interpolation to reuse verbatim** (`public/app.js:10593-10625`):
```javascript
function _interpolateScript(text, lead) {
  const setterName = window.__CURRENT_USER__?.name || window.__CURRENT_USER__?.email?.split('@')[0] || 'el equipo';
  ...
  const repl = {
    '{name}': (lead?.name || 'doctor/a').toString(),
    '{city}': lead?.city || lead?.country || 'la zona',
    '{country}': lead?.country || '',
    '{years}': yearsTxt,
    '{reviews}': reviewsTxt,
    '{rating}': lead?.rating ? `${lead.rating}★` : '',
    '{setterName}': setterName,
    '{setterPhone}': window.__CURRENT_USER__?.phone || '',
    '{date}': new Date().toLocaleDateString('es-AR'),
    '{time}': new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
  };
  let result = text;
  for (const [k, v] of Object.entries(repl)) result = result.split(k).join(v);
  return result;
}
```
This function currently only runs against `call_scripts.json` entries
(`_renderScriptPanel`, `public/app.js:10627+`). The 3 WhatsApp templates
(D-06) can be a small hardcoded array in `app.js` (same "constant in code"
choice CONTEXT.md leaves at Claude's Discretion — recommend code over a new
JSON data file: this project's convention for small enumerable catalogs
that don't need admin-editing is a JS constant, e.g.
`COMMITMENT_UI_TIPOS`/`NEXT_ACTION_TEMPLATES`; a new JSON file would need
its own load/save/mutex/export/pre-deploy wiring per CLAUDE.md note #21,
disproportionate for 3 static strings) and run each body through
`_interpolateScript(body, lead)` before building the `wa.me` URL. **D-08
(anti-brand, note #119)**: none of the 3 templates may mention "SCM" — the
existing `_stripBrandMentions` helper (referenced in CLAUDE.md note #119)
is the analog if a template is ever loaded from persisted data instead of
a hardcoded literal; for hardcoded literals, just don't write the word.

---

### Backend: material-by-email endpoint (ACT-05, D-17/D-18)

**Analog:** `POST /api/setters/leads/:id/send-placeholder`
(`index.js:12176-12266`) + its Resend wrapper `_sendPlaceholderEmail`
(`index.js:12141-12170`).

**Why this is only a role-match, not exact**: `send-placeholder` is
purpose-built for calendar holds — it always builds an `.ics` attachment
(`_buildPlaceholderICS`, `index.js:12118-12140`) and its `htmlBody` text is
hardcoded around "Te dejo este bloque tentativo...". ACT-05 wants a
DIFFERENT kind of email (sending material/info, no calendar attachment).

**What to reuse verbatim**: the Resend HTTP call shape in
`_sendPlaceholderEmail` (`index.js:12141-12170`) — auth via
`process.env.RESEND_API_KEY`, `from`/`to`/`subject`/`html` body, graceful
`{sent:false, reason}` on missing key or HTTP error (never throws):
```javascript
async function _sendPlaceholderEmail({ toEmail, toName, subject, htmlBody, icsContent, fromOverride }) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return { sent: false, reason: 'RESEND_API_KEY no configurada' };
  const fromEmail = fromOverride || process.env.INVITE_FROM_EMAIL || 'Agenda <onboarding@resend.dev>';
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: fromEmail, to: [toEmail], subject, html: htmlBody, attachments: [...] })
    });
    if (resp.ok) return { sent: true };
    const err = await resp.json().catch(() => ({}));
    return { sent: false, reason: err.message || `HTTP ${resp.status}` };
  } catch (e) { return { sent: false, reason: e.message }; }
}
```
Recommend either (a) making `attachments` optional/parameterized in this
same helper so both `send-placeholder` and the new ACT-05 endpoint share
it, or (b) a sibling `_sendMaterialEmail({toEmail, toName, subject,
htmlBody})` that copies the fetch block without the `attachments` array.
Either is a small, low-risk change — this is an implementation decision
for the planner.

**Post-send registration (D-17, same event model as WhatsApp)**: copy the
`mutateSettersData` block from `send-placeholder`
(`index.js:12234-12264`, note the comment explaining WHY the mutex is
needed here specifically — because the mutation happens AFTER an `await`
of the Resend call, unlike the sync WhatsApp/commitment endpoints above):
```javascript
// Audit 2026-06-20: la mutación va DESPUÉS de un await (envío de email) → re-resolvemos
// el lead DENTRO del mutex para no pisar writes concurrentes (regla #19).
const updated = await mutateSettersData((fresh) => {
  const l = fresh.leads?.[req.params.id];
  if (!l) return null;
  if (!Array.isArray(l.callLog)) l.callLog = [];
  l.callLog.push({ ts: nowIso, outcome: 'placeholder_sent', by: u.id || '', notes: `...`, channel: 'email' });
  if (l.callLog.length > 500) l.callLog = l.callLog.slice(-500);
  ...
  return l;
});
```
For ACT-05, the equivalent would push a `callLog` entry (or a
`_setCommitment`+`_closeCommitment` pair with `tipo:'enviar_info'` /
`canal:'email'`, mirroring exactly what the WhatsApp endpoint does — same
model, per D-17) **inside** `mutateSettersData`, since this endpoint also
has an `await` (the Resend call) before the mutation.

**D-18 (no open-tracking)**: nothing to build — simply do not add a
tracking pixel/webhook. `send-placeholder` already does not track opens
(it only logs "sent"), so there's no anti-pattern to remove either.

---

### Frontend: shared WhatsApp action handler

**Analogs:**
1. `window._callsAltContact` (`public/app.js:11974-12041`) for the overlay
   modal pattern (self-contained `<div id="...-overlay">` appended to
   `document.body`, closed on outside-click/Cancel, cleanup via
   `.remove()`).
2. `window._callsSetCommitment` / `window._callsCloseCommitment`
   (`public/app.js:7777-7855`) for the fetch + `_leadStoreApply` +
   `_refreshLeadPanels` + toast sequence.

**Core pattern to copy** (imports/setup are implicit — this is a single
IIFE-scoped module, no ES import statements for these helpers):
```javascript
window._callsSetCommitment = async function(leadId) {
  ...
  try {
    const r = await fetch(apiUrl('/api/setters/leads/' + leadId + '/commitment'), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo, parte, motivo })
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      window.showToast?.(d.error || ('Error guardando compromiso: HTTP ' + r.status), { type: 'error' });
      return;
    }
    if (d.lead) _leadStoreApply(leadId, d.lead);
    window.showToast?.('Compromiso guardado — ...', { type: 'success', duration: 3000 });
  } catch (e) {
    window.showToast?.('Error guardando compromiso: ' + e.message, { type: 'error' });
  } finally {
    _refreshLeadPanels(leadId);
  }
};
```
For the new `window._actSendWhatsApp(leadId)` (name is a suggestion, not a
requirement), the shape is: call the new backend endpoint → on success,
`window.open(d.whatsappUrl, '_blank')` (D-02: new tab, never auto-send) →
`_leadStoreApply(leadId, d.lead)` → toast confirming what was registered
(D-04's honest wording, e.g. "Se abrió el chat — queda anotado que le
mandaste info, seguimiento en 48h") → `_refreshLeadPanels(leadId)` in
`finally`, per note #175 of CLAUDE.md (a modal/panel left in a stale state
after a toggle is exactly the bug class that note documents — always
refresh in `finally`, not just the success branch).

**DO NOT reuse `window._waBtnClick` / `window._waMultiClick`**
(`public/app.js:1336-1425`). These are a DIFFERENT, older feature: the
parked wa-multi desktop-app interception, gated behind
`window._waMultiEnabled()` (true only for the admin/Ignacio's account) and
explicitly deferred by CONTEXT.md ("Envío automático por wa-multi... queda
fuera de esta fase"). The existing `lead.whatsappUrl` field these functions
read is also stale/legacy (built server-side at import time from the old
Setteo `openMessage`, not from the new D-06 templates) — the new ACT
button must NOT read `lead.whatsappUrl` and must NOT call `_waBtnClick`.

**Number-alternative flow (ACT-03, D-09)**: `window._callsAltContact(leadId)`
already exists as a complete, working overlay for entering/editing
`lead.altPhone` (`public/app.js:11974-12041`) and already persists via `PUT
/api/setters/leads/:id/alt-contact`. Two ways to satisfy D-09 without
building a new modal: (a) the WhatsApp action's overlay includes a "usar
otro número" link that opens `_callsAltContact(leadId)` in place, then
re-triggers the send once saved; or (b) a lighter inline `prompt()`-style
override specific to the WhatsApp click that does NOT persist to
`lead.altPhone` unless the user explicitly opts in — CONTEXT.md leaves
"popover vs modal" at Claude's Discretion, but reusing the EXISTING
alt-contact modal (rather than building a parallel number-entry UI) is
strongly preferred: it's already tested, already wired to
`_leadStoreApply`, and keeps "alt phone" a single source of truth across
the app (D-10 requires `lead.altPhone` semantics to stay exactly as they
are).

---

### Frontend: shared discard action handler

**Analog:** `window._callsReactivate` (`public/app.js:7856-7883`) — the
exact inverse action, same file, same shape:
```javascript
window._callsReactivate = async function(leadId) {
  if (!confirm('¿Reactivar este lead? ...')) return;
  try {
    const r = await fetch(apiUrl('/api/setters/leads/' + leadId + '/reactivate'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }
    });
    if (!r.ok) { const errData = await r.json().catch(() => ({})); throw new Error(errData.error || ('HTTP ' + r.status)); }
    const d = await r.json();
    const idx = callsLeadsCache.findIndex(l => l.id === leadId);
    if (idx >= 0) { _leadStoreApply(leadId, { ...d.lead, id: leadId }); }
    else { callsLeadsCache.push({ ...d.lead, id: leadId }); _rebuildCallsLeadsIndex(); }
    _callsRenderCountryChips();
    _refreshLeadPanels(leadId);
    renderCallsStats();
    window.showToast?.('Lead reactivado — ya está en cola para llamar', { type: 'success', duration: 3000 });
  } catch (e) {
    window.showToast?.('Error reactivando: ' + e.message, { type: 'error' });
  }
};
```
For `window._actDiscardLead(leadId)`: same `fetch`/`_leadStoreApply`/
`_refreshLeadPanels`/`renderCallsStats` shape, POSTing to whichever discard
endpoint the backend section above lands on. **D-15 ("confirmación en un
solo paso, no un modal de dos")** — `_callsReactivate`'s plain
`confirm()` is the simplest analog for "no reason needed" discards, but
D-14 wants an optional reason picker. A single custom overlay (same shape
as `_callsAltContact`, ALL fields — reason dropdown defaulting to "Sin
razón específica" (see `DISQUALIFY_REASONS_UI[0]` below) + one confirm
button — visible at once, no wizard/multi-screen flow) satisfies both
D-14 and D-15 without contradicting either.

**Reason list to reuse verbatim** (`public/app.js:11520-11532`):
```javascript
const DISQUALIFY_REASONS_UI = [
  { key: '', label: 'Sin razón específica' },
  { key: 'no_es_icp', label: 'No es el perfil (ICP)' },
  { key: 'no_es_decisor', label: 'No es quien decide' },
  { key: 'ya_no_trabaja', label: 'Esa persona ya no trabaja ahí' },
  { key: 'sin_presupuesto', label: 'Sin presupuesto' },
  { key: 'ya_tiene_proveedor', label: 'Ya tiene agencia / proveedor' },
  { key: 'cliente_actual', label: 'Ya es cliente' },
  { key: 'mala_experiencia', label: 'Ex-cliente / mala experiencia' },
  { key: 'no_contactar', label: 'Pidió NO ser contactado (DNC)' },
  { key: 'ya_agendado', label: 'Ya se coordinó por otra vía' },
  { key: 'otro', label: 'Otro' },
];
```
This exact array is already rendered as a `<select>` in `openObjectionModal`
(`public/app.js:11589`: `reasonSel.innerHTML =
DISQUALIFY_REASONS_UI.map(r => ...).join('')`) — copy that one-liner.

**Destination toast after discard (D-15, "el aviso de destino de la Phase
30 dice a dónde fue")**: `_dispoDestination` (`public/app.js:8880-8992`)
already has a branch for `lead.estado === 'descartado'`
(`public/app.js:8892-8905`) that produces exactly the right text
("«Lead» sale de la cola — queda en Descartados..."). Call
`_dispoAnnounce(leadId, { lead: d.lead })` (`public/app.js:9006+`) after a
successful discard — **do NOT call the heavier `_dispoAfterSaved`**
(`public/app.js:8818-8837`), which is specific to call dispositions (it
also clears the Phase 20 "mark the call result" gate via
`_dispoGateClear`, which has no meaning for a discard that didn't
originate from hanging up a call). `_dispoAnnounce` alone is the correct,
narrower primitive — it is exactly what the calendar-hold flow
(`openPlaceholderModal`) already does for the same reason (see
`30-03-SUMMARY.md` key-decision: "El hold de calendario... llama SOLO
`_dispoAnnounce`, nunca `_dispoAfterSaved`").

---

### Frontend: wiring into the 4 render surfaces (D-01/D-12)

**One component, four call sites** — CONTEXT.md D-01/D-12 explicitly
forbid 4 separate implementations. Recommended shared markup builder
(e.g. `_actButtonsHTML(lead, {compact})`) that each surface calls, mirroring
how `_dispoSelectHTML(leadId, {minWidth, fontSize})` (`public/app.js:6085
-6104`) is already ONE function called from all 4 surfaces with size
options per context — same "shared builder + per-surface sizing knob"
pattern to copy.

**Surface 1 — `renderCallsList`** (`public/app.js:8261-8557`): row actions
currently end with the disposition `<select>` + expand toggle
(`public/app.js:8549-8553`). The alt-contact button is already inline in
the row's badge area (`public/app.js:8510`):
```javascript
<button type="button" onclick="event.stopPropagation(); window._callsAltContact('${escHtml(l.id)}')" title="..." style="...">${l.altPhone ? 'editar' : '+ contacto'}</button>
```
New WA/discard buttons follow this exact shape (`event.stopPropagation()`
first — the row itself has its own click handler for expand/collapse,
verify by checking `data-id` row listeners before adding a new button
here) inserted either in this badge row or as new pills next to
`_dispoSelectHTML(l.id)`.

**Surface 2 — `_pdRender`** (`public/app.js:6793-7041`): the Power Dialer
already links to WhatsApp in its Quick-links block
(`public/app.js:7034-7040`), which is the WRONG analog to copy from (it
uses `lead.whatsappUrl` + `_waBtnClick`, both out of scope — see WAMULTI
warning above) but the RIGHT place to insert the new button/action row —
same visual area, replace/augment that specific link:
```javascript
${lead.whatsappUrl ? `<a href="${escHtml(safeUrl(lead.whatsappUrl) || '#')}" target="_blank" rel="noopener noreferrer" class="pd-quick-link" onclick="return window._waBtnClick(this, event, '${escHtml(lead.id)}');">WhatsApp</a>` : ''}
```
Header action buttons (`Llamar`/`Saltar`) sit at `public/app.js:6972-6982`
— the discard action likely belongs there too (primary actions column),
sized/styled consistently with the existing `Llamar`/`Saltar` buttons.

**Surface 3 — `_callsRenderExpandedPanel`** (`public/app.js:7913-8260`):
the `.call-action-row` (`public/app.js:8205-8222`) is the exact existing
container for exactly this kind of secondary action button
(`Reactivar lead`, `Mandar mail`, `Abrir web`, `Maps` — all rendered as
`class="call-action-btn"`). New buttons append here:
```javascript
<div class="call-action-row">
  ${l.estado === 'descartado' ? `<button class="call-action-btn" onclick="window._callsReactivate('${escHtml(l.id)}')" ...>Reactivar lead</button>` : ''}
  ${(() => { const safeEmail = ...; return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(safeEmail) ? `<a href="mailto:${escHtml(safeEmail)}" class="call-action-btn">Mandar mail</a>` : ''; })()}
  ...
</div>
```
CSS already has `.call-action-btn.is-wsp:hover` defined (green-tinted
hover, `public/style.css:4251-4254`) and **currently unused anywhere in
`app.js`** — this is the ready-made style hook for the new WhatsApp
button's class (`class="call-action-btn is-wsp"`).

**Surface 4 — `_hoyRenderSection`** (`public/app.js:6106-6155`): rows
already end with two buttons, `hoy-ficha-btn` and `hoy-call-btn`
(`public/app.js:6134-6135`, styled at `public/style.css:2085-2121`):
```javascript
<button class="hoy-ficha-btn" onclick="window._hoyOpenFicha('${escHtml(l.id)}')" title="...">Ficha</button>
<button class="hoy-call-btn" onclick="window._startTelnyxCall('${escHtml(l.id)}')">Llamar</button>
```
New buttons follow this same two-class pattern (a filled "primary" style
like `.hoy-call-btn`, an outlined "secondary" style like `.hoy-ficha-btn`)
— no new CSS classes strictly needed, reuse these two visual treatments
(or `.call-action-btn`/`.btn-accent` if a third visual tier is wanted for
discard, per D-16 below). Since `_hoyOpenFicha` opens
`_callsRenderExpandedPanel` inside a modal (`public/app.js:6160-6180`), any
button wired into Surface 3 is ALSO reachable from Hoy for free through
that modal — the explicit per-row buttons in `_hoyRenderSection` are for
the fast path (no need to open the ficha first).

**D-16 — visual language for the discard button**: use `.scm-chip-blocked`
(gray, never red — `public/style.css:5140-5154`) for the STATE indicator
after a lead is discarded (icon + label, matching the "estado EXCLUIDO"
rule already documented at `public/style.css:5140-5141`: *"Un número que
no se puede marcar no necesita alarma, necesita ausencia de acción."*) and
`.scm-row-blocked` (`public/style.css:5158-5172`) for de-emphasizing a
discarded row without hiding it (opacity 0.72, phone gets
`text-decoration:line-through`, and any element with
`[data-action="call"]` inside a `.scm-row-blocked` container is
auto-hidden via `display:none !important` — if the new discard button ends
up co-located with the call button, tag the call button/link with
`data-action="call"` to get this for free). **Neither class is used
anywhere in `app.js` yet** — Phase 32 is their first real consumer; verify
visually in preview since this is untested integration, not copy-paste of
a working example.

**Cache-buster**: bump `app.js?v=` in `public/index.html:3678` (currently
`20260815g`) to the next letter/date on ANY `app.js` edit. Bump
`style.css?v=` in `public/index.html:14` (currently `20260815f`) only if
`style.css` is touched (likely not needed if only reusing existing
classes — see D-16 above). Verify the CURRENT value in the file before
bumping — per `31-03-SUMMARY.md`/`31-04-SUMMARY.md`, parallel sessions
have repeatedly bumped this ahead of what a plan assumed; read
`public/index.html` fresh, don't trust a value copied from this document.

---

### Tests

**Analog:** the Phase 31 two-layer test pattern —
`tests/commitment-model.test.js` (35 pure tests, no HTTP, function-level
via `globalThis.__voiceAgent`), `tests/commitment-endpoints.test.js` (24
HTTP tests via `request(app)`), `tests/commitment-ui.test.js` (46 tests:
pure block extracted with `new Function` from `[31-03] COMMITMENT-PURE`
markers, plus source-text assertions for markup/wiring).

Recommended structure for Phase 32:
- Backend HTTP tests (new endpoint(s), RBAC, whitelist coercion,
  `disqualifyReason`/DNC interplay) — same fixture pattern as
  `tests/commitment-endpoints.test.js` (2 setters + 1 admin, phone prefix
  `+521...`, **≥7 digits** — CLAUDE.md note #163: fixtures with shorter
  phone numbers silently fail `_leadIsCallableNow`-style checks and any
  filter/queue test built on top of them).
- Frontend source-assertion tests for the 4 wiring points (grep-style
  assertions that each of the 4 render functions contains the new
  button/handler, same style as `31-03`/`31-04`'s "cableado" tests) plus a
  pure-block test if a `[32-0N] ACT-PURE` marker block is introduced for
  any helper (e.g. template interpolation wrapper, discard-destination
  text) — follow the exact marker comment format (`// ─── [NN-NN] NAME:
  INICIO ───` / `// ─── [NN-NN] NAME: FIN ───`) so `extractFunctionBody`/
  `new Function` extraction tooling from prior phases keeps working
  unmodified.
- `process.env.X_API_KEY = ""` (empty string, **never `delete`**) for any
  test touching AI/Resend-adjacent code paths — CLAUDE.md note #121: this
  is the fix for the historical flaky-test root cause (`dotenv.config()`
  re-populates deleted env vars from `.env`).

## Shared Patterns

### Ownership/visibility guard (auth)
**Source:** `index.js:10384-10387` (identical in `PATCH .../commitment`,
`PUT .../alt-contact` uses the shorter single-guard variant at
`index.js:10618-10620`).
**Apply to:** any new/loosened endpoint touched by this phase (WhatsApp
send-and-register, discard, material email).
```javascript
if (req.auth?.user?.role === 'setter' && lead.assignedTo !== req.auth.user.setterId) {
  return res.status(403).json({ error: "No autorizado para este lead." });
}
{ const visibleSet = _visibleSetterIds(req.auth.user); if (visibleSet && !_setterIsVisible(lead.assignedTo, visibleSet)) return res.status(403).json({ error: 'Lead fuera de tu visibilidad.' }); }
```

### Write-mutex rule (async vs sync)
**Source:** `index.js:7101-7119` (`mutateSettersData`), with the exact
decision rule documented inline at `index.js:10375-10379` and CLAUDE.md
note #19.
**Apply to:** the material-by-email endpoint (has an `await` before the
mutation — MUST use `mutateSettersData`); the WhatsApp/discard endpoints do
NOT need it if they stay fully synchronous (no `await` between load and
save) — verify this stays true as the endpoint is implemented; the moment
any `await` (e.g. a future validation call) lands before the mutation, wrap
it.

### Optimistic frontend write (`_leadStoreApply`)
**Source:** `public/app.js:5828-5851`.
**Apply to:** every new frontend action handler (WhatsApp send, discard) —
call with the FULL `lead` object from the response body when available
(`d.lead`), not a hand-built partial patch, per the pattern already
established by `_callsSetCommitment`/`_callsCloseCommitment`/
`_callsReactivate` (all three do `_leadStoreApply(leadId, d.lead)` or
equivalent, never reconstruct fields by hand) — CLAUDE.md note #105.

### Refresh-in-`finally` (never just on success)
**Source:** `public/app.js:6211-6214` (`_refreshLeadPanels`), used inside
a `finally` block by every commitment/alt-contact handler.
**Apply to:** both new action handlers — CLAUDE.md note #175 documents the
exact bug class this prevents (a modal left showing stale toggle state
after a write that actually succeeded server-side).

### Destination announcement (never a bespoke toast)
**Source:** `public/app.js:8880-9020` (`_dispoDestination`/`_dispoAnnounce`).
**Apply to:** the discard handler (branch already exists for
`estado==='descartado'`) and, if the WhatsApp registration ever changes
`lead.estado` (it should not — it only touches `commitment`/`nextAction`),
that too. Per `30-03-SUMMARY.md`'s established rule: **"Cualquier
disposición nueva que se agregue en el futuro DEBE pasar por
`_dispoAfterSaved`/`_dispoAnnounce` para heredar el aviso de destino —
nunca llamar `showToast` a mano para 'a dónde se fue el lead'."**

### Whitelist-and-coerce for enum-shaped bodies
**Source:** `_sanitizeCommitment` (`index.js:11370-11380`),
`DISQUALIFY_REASONS`/`NEXT_ACTION_*` `Set`s throughout the COMPROMISOS/GATE
blocks.
**Apply to:** any new body field this phase introduces (discard reason,
template id, email subject/body) — reject unknown values by falling back
to a safe default or `null`, never throw / never hard-500 on bad client
input, matching the "GATE-01... nunca responde 4xx" philosophy already
established in this codebase for disposition-adjacent endpoints.

### Anti-brand text (note #119)
**Source:** CLAUDE.md note #119 (`_stripBrandMentions`, applied to all
prospect-facing text).
**Apply to:** the 3 WhatsApp templates and the material-by-email subject/
body (D-08/D-18 implicitly) — never write "SCM" literally in template
strings; if templates ever become admin-editable/persisted data instead of
hardcoded literals, run them through `_stripBrandMentions` at send time.

## No Analog Found

None — every change unit in this phase has at least a role-match analog
already in the codebase (see table above). The weakest match is the
material-by-email endpoint (ACT-05), whose closest analog
(`send-placeholder`) is coupled to calendar-hold semantics that don't fully
apply; the planner should treat that endpoint as "new code following an
established HTTP/Resend/mutex shape" rather than "copy this file."

## Metadata

**Analog search scope:** `index.js` (backend, ~20,600 lines), `public/
app.js` (frontend, ~21,000 lines), `public/index.html`, `public/style.css`
— the entire application (no other backend/frontend source files exist).
**Files scanned:** 4 source files + 8 SUMMARY.md documents from Phases 29,
30, 31 (upstream dependencies per `32-CONTEXT.md`'s `<canonical_refs>`).
**Pattern extraction date:** 2026-08-15
**Upstream context consumed:** `32-CONTEXT.md` (full), `31-01..04-SUMMARY.md`
(commitment model/endpoints/UI/Hoy — the mechanism ACT-01/02/03 must
compose with), `30-02-SUMMARY.md`/`30-03-SUMMARY.md` (the "Próximo paso"
modal and the universal destination-announcement system ACT-04 must
integrate with).

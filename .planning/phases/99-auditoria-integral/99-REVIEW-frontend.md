---
phase: 99-auditoria-integral
reviewed: 2026-07-05T15:51:58Z
depth: standard
files_reviewed: 2
files_reviewed_list:
  - public/app.js
  - public/wa.js
findings:
  critical: 0
  warning: 3
  info: 2
  total: 5
status: issues
---

# Phase 99: Code Review Report (Frontend)

**Reviewed:** 2026-07-05T15:51:58Z
**Depth:** standard
**Files Reviewed:** 2 (`public/app.js` ~15,874 lines, `public/wa.js` ~1,848 lines)
**Status:** issues_found

## Summary

I reviewed the two vanilla-JS frontend bundles for the concrete failure classes the audit
targets: XSS via `innerHTML`, broken event handlers, state desync between the two lead
caches (`_callsLeadsById` / `callsLeadsCache`), null access on optional lead fields, async
race conditions, memory leaks (uncleared `setInterval`/listeners), and broken
pagination/filter/sort/money logic.

**High-level assessment: the codebase is genuinely well-hardened.** The XSS surface is
consistently defended — there is a global `escHtml` (app.js:490) that escapes `& < > " '`
and a `safeUrl` gate for every `href`, and every lead-derived value I traced through the
card/panel/ficha render paths (name, phone, notes, address, brief, openingAngle, doctor,
signals) is escaped. Timer and listener management is disciplined: every recurring
`setInterval` (speed-to-lead, callback-due, online, system, telnyx metrics, autopilot,
disposition shortcuts) clears the prior handle before re-arming, and the top-level
heartbeats are flag-guarded against duplicate registration. Pagination resets
`_callsCurrentPage = 1` on every filter/search/sort change and clamps to `[1, totalPages]`.
Money/metric display is server-sourced and guarded with `typeof === 'number'` / `|| 0`.

The real findings are concentrated in two places: (1) the `_leadStoreApply` write-sync helper
breaks reference identity between the two caches, which — combined with three write handlers
that mutate the Map directly instead of routing through it — reintroduces the exact list/dialer
desync the helper was built to prevent; and (2) a free-text-adjacent `altPhone` value is placed
into a JS-string-inside-HTML-attribute `onclick` context with HTML-entity escaping, which is the
wrong escaping for that context.

## Warnings

### WR-01: `_leadStoreApply` breaks cache reference identity → list view goes stale after any disposition + note/followup/precall edit

**File:** `public/app.js:4607-4614` (helper), `public/app.js:6056-6057`, `6073-6074`, `6090-6094`, `6145` (bypassing write paths)

**Issue:**
`_callsLeadsById` (the Power-Dialer Map) and `callsLeadsCache` (the list array) are built to
share the SAME object references — `_rebuildCallsLeadsIndex()` does
`new Map(callsLeadsCache.map(l => [l.id, l]))` (app.js:4599), so `map.get(id) === array[idx]`.
The whole "reads are not centralized, writes go through `_leadStoreApply`" design depends on
that shared identity.

But `_leadStoreApply` itself violates it:

```js
function _leadStoreApply(id, patch) {
  // 1) Map: mutates the existing object in place
  try { if (_callsLeadsById?.has?.(id)) Object.assign(_callsLeadsById.get(id), patch); } catch {}
  // 2) Array: REPLACES the element with a brand-new object
  const idx = (callsLeadsCache || []).findIndex(l => l && l.id === id);
  if (idx >= 0) callsLeadsCache[idx] = { ...callsLeadsCache[idx], ...patch, id };
}
```

After one call, `_callsLeadsById.get(id)` (old object, mutated in place at line 4610) and
`callsLeadsCache[idx]` (a NEW object from the spread at line 4613) are **different object
references**. Nothing calls `_rebuildCallsLeadsIndex()` afterward (e.g. `_handleCallDisposition`
at app.js:7831-7832 does `_leadStoreApply(...)` then `renderCallsList()` with no rebuild), so the
two caches stay diverged for the rest of the view session.

Now the three direct-Map write handlers bite:
- `_callsAddNote` (app.js:6057): `lead = _callsLeadsById.get(leadId); lead.notes = d.notes;`
- `_callsDeleteNote` (app.js:6074): same pattern
- `_callsToggleFollowup` (app.js:6090-6094): `lead.followUps = ...; lead.followUpStartedAt = ...`
- `_callsSavePrecallNote` (app.js:6145): `lead.precallNote = d.precallNote`

Each mutates ONLY the Map's object, then calls `renderCallsList()` — which reads from the
**array** (`callsLeadsCache.slice()`, app.js:6342). If the lead's array element was already
replaced by a prior `_leadStoreApply`, the array object never receives the note/followup/precall
update.

**Concrete failure scenario:**
1. Setter is in Llamadas, expands lead X's row.
2. Marks a direct disposition (e.g. "No atendió") → `_handleCallDisposition` → `_leadStoreApply(X, data.lead)`. Now array[X] is a new object; Map[X] is the old-but-mutated object. **They diverge.**
3. Setter adds a note on the same expanded card → `_callsAddNote` sets `Map[X].notes = d.notes`, then `renderCallsList()` reads array[X] (stale) → the note-count badge (app.js:6496) and last-note preview (app.js:6563) do NOT reflect the new note until a full `loadCallsView()` re-fetch.
4. Same for toggling a follow-up chip or editing the pre-call note: the write "sticks" server-side but the list re-render shows the pre-write state, so the setter thinks it failed and re-clicks.

(The Power Dialer, which reads the Map, stays correct — the divergence is one-directional and
hits the LIST view. The objection/schedule/callback modals self-heal because they call
`loadCallsView()`, which rebuilds both caches; the note/followup/precall handlers do not.)

**Fix:** Make `_leadStoreApply` preserve reference identity by mutating in place on BOTH sides
(don't create a new array object), OR rebuild the index after replacing. Mutate-in-place is
simplest and matches what the Map branch already does:

```js
function _leadStoreApply(id, patch) {
  if (!id || !patch || typeof patch !== 'object') return;
  const idx = (callsLeadsCache || []).findIndex(l => l && l.id === id);
  if (idx >= 0) Object.assign(callsLeadsCache[idx], patch, { id }); // mutate, keep the ref
  if (_callsLeadsById?.has?.(id)) {
    // ensure Map points at the SAME object as the array
    if (idx >= 0) _callsLeadsById.set(id, callsLeadsCache[idx]);
    else Object.assign(_callsLeadsById.get(id), patch);
  }
}
```
Alternatively, route the four direct-Map handlers (`_callsAddNote`, `_callsDeleteNote`,
`_callsToggleFollowup`, `_callsSavePrecallNote`) through `_leadStoreApply(leadId, {...})` instead
of mutating `_callsLeadsById.get(leadId)` directly — but that only works once the helper itself
keeps references in sync.

### WR-02: `altPhone` injected into `onclick` JS-string-inside-attribute context with HTML-entity escaping (wrong context) → broken handler / injection if a quote reaches the field

**File:** `public/app.js:6554`, `public/app.js:5505`, `public/app.js:7061` (render sites); `public/app.js:8311` (unsanitized save)

**Issue:**
The secondary-contact phone is rendered into an inline `onclick` as a JS string literal:

```js
onclick="event.stopPropagation(); window._startTelnyxCall('${escHtml(l.id)}','${escHtml(l.altPhone)}')"
```

`escHtml` is the correct tool for HTML **text/attribute-value** context, but here `l.altPhone`
sits inside a **JavaScript string literal that itself sits inside an HTML attribute**. The HTML
parser decodes entities (`&#39;` → `'`) *before* the JS is handed to the JS parser, so
`escHtml`'s single-quote-to-`&#39;` conversion does NOT protect the JS string boundary. A `'` in
`altPhone` decodes back to `'` and terminates the JS string, breaking the handler; a crafted
value like `');alert(document.cookie)//` would execute.

The field is user-writable free text: `_callsAltContact` renders a `<input type="tel">` that is
directly editable (app.js:8271) and saves `phoneInput.value.trim()` verbatim (app.js:8311) with
no client-side digit/`+` whitelist. Whether this is fully exploitable depends on backend
sanitization of `altPhone`, but the frontend pattern is defective regardless: if any `'` ever
survives to storage, every list re-render produces a broken "Llamar" button for that row.

**Concrete failure scenario:**
A setter (or a compromised/typo'd import) sets a secondary contact whose phone contains a
`'`. On the next `renderCallsList()`, the row's inline `onclick` for that lead is malformed —
clicking "Llamar" throws a SyntaxError instead of dialing, and in the worst case the injected
suffix runs in the page's origin (same-origin session cookies, admin actions).

**Fix:** Do not build JS-string arguments via string interpolation. Either (a) pass the value
through a JS-string-safe encoder for that context, or (b) stop putting the phone in the handler
string at all — read it from the lead by id inside `_startTelnyxCall` (which already looks the
lead up), and dial the alt number via a small data attribute + delegated listener. Minimal
hardening: strip to `[\d+]` on save in `_callsAltContact.doSave` before persisting, so no quote
can ever reach the template:

```js
const cleanPhone = (phoneInput.value || '').replace(/[^\d+]/g, '');
```

### WR-03: `loadHoyView` seeds `_callsLeadsById` from a separate fetch but never touches `callsLeadsCache` → Hoy and Llamadas can hold different objects for the same lead

**File:** `public/app.js:4674-4675`

**Issue:**
```js
const leads = (await leadsResp.json()).leads || [];
leads.forEach(l => { if (l && l.id) _callsLeadsById.set(l.id, l); });
```
Hoy fetches its own copy of the callable leads and overwrites the Map entries with those fresh
objects, but leaves `callsLeadsCache` (the array the Llamadas list renders from) untouched. After
visiting Hoy, `_callsLeadsById.get(id)` (Hoy's object) and `callsLeadsCache[idx]` (Llamadas'
object) are different instances for the same lead. This is deliberate for the "Llamar" button
(which reads the Map and needs a resolvable lead), but it compounds WR-01: any subsequent
direct-Map mutation is invisible to the list, and any optimistic array update is invisible to the
Power Dialer / Hoy call flow. Because the two views are reached from the same nav and share the
Map, a stale disposition state can leak across them until a full `loadCallsView()` runs.

**Concrete failure scenario:**
Setter dispositions lead X in Llamadas (array[X] replaced via `_leadStoreApply`), then opens Hoy
(Map[X] replaced with Hoy's fresh fetch), then returns to Llamadas without a re-fetch. The list
shows array[X] (post-disposition), the call button reads Map[X] (Hoy's snapshot) — two different
truths for one lead, with no rebuild reconciling them.

**Fix:** After Hoy's fetch, upsert into the array and rebuild the index so both caches share
references, mirroring what `loadCallsView` does:
```js
leads.forEach(l => {
  if (!l || !l.id) return;
  const idx = callsLeadsCache.findIndex(x => x.id === l.id);
  if (idx >= 0) callsLeadsCache[idx] = l; else callsLeadsCache.push(l);
});
_rebuildCallsLeadsIndex();
```
(Fixing WR-01's reference invariant is a prerequisite for this to fully hold.)

## Info

### IN-01: `renderDashboard` assumes `summary.byStatus` exists → TypeError on malformed stats response

**File:** `public/wa.js:190-194`

**Issue:** `summary.byStatus.CONNECTED || 0` (line 191) dereferences `summary.byStatus`
unconditionally. If `/api/wa/stats/summary` ever returns a summary without `byStatus` (partial
failure, schema drift), the whole dashboard render throws `Cannot read properties of undefined`
with no catch around the card-building block (the try/catch at lines 180-188 only wraps the fetch,
not the render). Low likelihood since the server owns the shape, but a one-line guard removes the
crash class.

**Fix:** `const byStatus = summary.byStatus || {};` then `byStatus.CONNECTED || 0`. Optionally
default `summary` fields with `summary?.totalAccounts ?? 0` etc.

### IN-02: `_hoyRenderSection` accepts a `total` param that `loadHoyView` never passes → the "de N" affordance is dead

**File:** `public/app.js:4730` (signature), `public/app.js:4759` (usage), `public/app.js:4714-4716` (call sites)

**Issue:** `_hoyRenderSection(title, leads, accent, hint, total)` renders a "N de {total}"
count only when `total > leads.length` (line 4759), but both call sites in `loadHoyView`
(lines 4715-4716) omit the `total` argument, so `total` is always `undefined` and the branch is
permanently dead. Not a bug — just a vestigial parameter that suggests an intended
"showing N of M" UX that was never wired up. Either pass the pre-filter counts or drop the param
to avoid implying behavior that doesn't exist.

**Fix:** Drop the unused 5th parameter and the `total &&` branch, or pass the real pre-slice
totals from `loadHoyView` if a "N de M" display is actually wanted.

---

_Reviewed: 2026-07-05T15:51:58Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

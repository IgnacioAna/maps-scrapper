---
phase: 99-auditoria-integral
reviewed: 2026-07-05T00:00:00Z
depth: standard
files_reviewed: 1
files_reviewed_list:
  - index.js
findings:
  critical: 0
  warning: 4
  info: 4
  total: 8
status: issues_found
---

# Phase 99: Code Review Report — Backend (index.js)

**Reviewed:** 2026-07-05
**Depth:** standard
**Files Reviewed:** 1 (index.js, ~13,229 lines)
**Status:** issues_found

## Summary

Reviewed the Express backend monolith `index.js` at standard depth, tracing the auth/session layer, the setters/leads data layer (mutex, cascade, call-disposition, pool distribution), the Telnyx VoIP endpoints (config secrets, webhook signature, webrtc creds, transcribe RBAC), the Mercury/FAQ AI endpoints, and the scraping pipeline.

Overall the backend is in good shape for a monolith this size: the security fixes documented in CLAUDE.md are intact (I verified them rather than re-flagging — `assignedTo` is out of the PATCH mass-assign, note `by` ignores the client body, disposition/transcribe RBAC gate before spending money, JWT/cookie/webhook fail-closed guards are present, prototype-pollution guard in bulk ops, atomic writes via tmp+rename, mutex wrappers used on the async load→await→save paths I checked). Route ordering (`/sin-wsp`, `/enrich-from-maps`, `/manual-add`, `/bulk` before `/:id`) is correct.

The findings below are real defects, not style. The most concrete is a logic bug that permanently disables the speed-to-lead ("responded, call now") alert. The rest are cost/abuse gaps and robustness issues with limited blast radius. No CRITICAL (data-loss/security/crash) issues were found in production paths.

## Warnings

### WR-01: Speed-to-lead alert never fires — snapshot taken after the value is already mutated

**File:** `index.js:6362-6396`
**Issue:** In `PATCH /api/setters/leads/:id`, `respondio` is part of the `allowed` mass-assign list (line 6358), so the loop at 6362-6364 executes `lead.respondio = req.body.respondio` (= `true`) **before** the cascade block runs. Then at line 6379 the "was it already responded?" snapshot is taken:
```js
const wasAlreadyResponded = lead.respondio === true; // already true from line 6363
...
if (!wasAlreadyResponded) { _registerLeadResponse({...}); } // never runs
```
Because `lead.respondio` was already overwritten to `true`, `wasAlreadyResponded` is *always* `true` whenever `req.body.respondio === true`, so `_registerLeadResponse(...)` is dead — the admin "🔥 X respondió, llamá YA" toast (fed by `GET /api/setters/recent-responses`, buffer `_recentLeadResponses`) never receives entries from this endpoint. Verified the frontend does send `{respondio:true, respondioNo:false}` (public/app.js:3463), and `_registerLeadResponse` has no other caller (grep confirms only line 6386).
**Fix:** Capture the pre-mutation value before the mass-assign loop:
```js
const prevRespondio = lead.respondio === true; // BEFORE the allowed[] loop
for (const field of allowed) { if (req.body[field] !== undefined) lead[field] = req.body[field]; }
...
if (req.body.respondio === true) {
  ...
  if (!prevRespondio) { _registerLeadResponse({...}); }
}
```

### WR-02: AI-cost endpoint `/api/mercury/generate` has no rate limiting (credit-burn / abuse)

**File:** `index.js:10448` (endpoint) vs `index.js:9680` (only `aiLimiter` usage)
**Issue:** `aiLimiter` (30 AI calls/hour/user) is applied to exactly one route: `POST /api/faqs/suggest` (line 9680). There is no global limiter middleware (verified: no `app.use(...limit...)`). Meanwhile `POST /api/mercury/generate` (line 10448) is reachable by any authenticated **setter**, calls OpenAI (`ai.chat.completions.create`, potentially twice — the reasoning-cleanup second pass at 10585), and is invoked from the "Generate" button *and* the live-objection helper during calls. A misbehaving or compromised setter account can hammer it with no bound, burning OpenAI credits (the memory note confirms the primary engine is now paid gpt-4o-mini). Same gap applies to `/api/faqs/suggest-tags` (9636) which is not admin-gated.
**Fix:** Add the existing `aiLimiter` to the AI endpoints callable by non-admins:
```js
app.post("/api/mercury/generate", requireAuth, aiLimiter, async (req, res) => { ... });
app.post('/api/faqs/suggest-tags', requireAuth, aiLimiter, async (req, res) => { ... });
```
(The admin-only enrich endpoints already have per-request caps, so they are lower risk, but consider `enrichLimiter` there too.)

### WR-03: `/api/scrape` credit-burn guard under-counts by up to 10x

**File:** `index.js:3830` (guard) vs `index.js:3669` (`searchLocation` page clamp)
**Issue:** The anti-credit-burn guard computes `totalCalls = queries.length * locations.length * Math.min(maxPages, 10)` and rejects if `> 50`. But `searchLocation` clamps pages to `Math.min(Math.max(1, parseInt(maxPages)), 100)` (line 3669) — i.e. up to **100** pages, not 10. So a request with 1 query, 1 location, `maxPages: 100` passes the guard (`1*1*10 = 10`) yet `searchLocation` will iterate up to 100 SerpAPI page requests. The guard's `Math.min(maxPages, 10)` factor silently caps the *estimate* at 10 while the *actual* work can be 10x higher. The early-relevance cut and `scrapeLimiter` (5/min, admin-only) bound the real damage, but the guard as written does not do what its own error message claims.
**Fix:** Make the guard reflect the true per-location page count used by `searchLocation`:
```js
const effectivePages = Math.min(Math.max(1, parseInt(maxPages) || 1), 100);
const totalCalls = queries.length * locations.length * effectivePages;
```
(Or lower the `searchLocation` clamp to 10 if that was the intended ceiling.)

### WR-04: `/api/setters/leads/:id/note` DELETE by numeric index races the 100-note cap and reorders

**File:** `index.js:6799-6813` (delete) with cap at `index.js:6790-6793`
**Issue:** Notes are deleted by array index (`lead.notes.splice(idx, 1)`), and `POST .../note` caps the array with `.slice(-100)` (line 6792), which shifts every index when the 101st note is added. If a client renders a note list, another write trims/shifts the array, and the user then clicks delete, the index sent no longer points to the note the user saw → the wrong note is deleted silently (no error, since the index is still in-range). This is a data-integrity foot-gun inherent to index-based delete on a mutable, capped, shared array.
**Fix:** Delete by a stable identifier instead of positional index. Give each note an `id` on creation and delete by id:
```js
data.leads[id].notes.push({ id: `note_${Date.now()}_${Math.random().toString(36).slice(2,6)}`, text: cleanText, by: cleanBy, date: ... });
// DELETE:
const before = lead.notes.length;
lead.notes = lead.notes.filter(n => n.id !== req.params.noteId);
if (lead.notes.length === before) return res.status(404).json({ error: 'Nota no encontrada.' });
```

## Info

### IN-01: `_briefLLM` comment says 20s timeout but code uses 15s

**File:** `index.js:1005-1009`
**Issue:** The comment reads "20s por intento" but the timeout is `setTimeout(() => rej(new Error('llm_timeout')), 15000)` (15s). Misleading comment for the next maintainer tuning latency budgets.
**Fix:** Align the comment with the code (15s), or bump the timeout to 20s if 20 was intended.

### IN-02: `sanitizeOpeningMessage` markdown strip regex mixes anchored and inline intent

**File:** `index.js:1241`
**Issue:** `s = s.replace(/\*\*+|__+|^>+|^#+\s*|^[-*]\s+/gm, '')` — after the previous line already collapsed the string, the `^`-anchored alternatives (`^>+`, `^#+`, `^[-*]`) with the `m` flag only match at line starts, but by this point multi-line structure is still intact (whitespace collapse happens *after*, at line 1245). The `**`/`__` alternatives are unanchored and will also strip `**` appearing mid-word. Low impact (this is a best-effort sanitizer with a `makeOpeningMessage` fallback), but the regex ordering doesn't do quite what the comment ("strip markdown comun") implies.
**Fix:** Split into two passes (block-level anchored strip on the raw multi-line string, then inline emphasis strip) or document that mid-word `**`/`__` removal is acceptable.

### IN-03: `GET /api/mercury/generations` returns ALL generations to `supervisor` role

**File:** `index.js:12601-12612`
**Issue:** The filter only special-cases `isSetter` (own only) and `isAdmin` (optional `?setterId=` filter). A `supervisor` falls through both branches and receives the full, unfiltered list of every setter's Mercury generations (including `prospectMessage`, `rawOutput`, `finalSent`). If supervisors are meant to be management-with-visibility this is fine, but it's undocumented and worth an explicit decision (the `/mercury/config` GET at 10305 *does* distinguish admin vs setter, so the omission here reads as accidental).
**Fix:** If supervisors should be scoped, add `else if (req.auth?.user?.role === 'supervisor')` handling; if full visibility is intended, add a one-line comment stating so.

### IN-04: `POST /api/setters/calendar` does not verify the `leadId` belongs to the requesting setter

**File:** `index.js:8648-8672`
**Issue:** A setter can POST a calendar entry with an arbitrary `leadId` (forced `setterId` to their own is good, but `leadId` is taken from the body unchecked and only length-capped). This lets a setter attach a calendar entry referencing another setter's lead. Blast radius is small (calendar entries are filtered by `setterId` on read, and the entry's own `setterId` is forced), but the `leadId`↔setter linkage is not validated the way the disposition/note/followup endpoints validate `lead.assignedTo`.
**Fix:** For `role === 'setter'`, resolve the lead and reject if `data.leads[leadId]?.assignedTo !== req.auth.user.setterId` before pushing the entry (mirroring the guard in `POST /api/scheduled-messages` at 8522).

---

_Reviewed: 2026-07-05_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

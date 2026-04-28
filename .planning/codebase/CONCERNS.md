# CONCERNS — Production readiness for 8 concurrent setters

> Generated: 2026-04-27
> Scope: concurrency, load, error handling, rate limits
> Reviewer: code-only static analysis (no runtime profiling)

## Summary

- Critical risks: **3**
- High risks: **5**
- Medium risks: **4**
- Low risks: **6**

**Top recommendation in one sentence:** the entire app uses `loadX() → mutate → saveX()` on multi-MB JSON files with no locking — the realistic worst case tomorrow is **silent lost updates on `setters.json`** (3.4 MB, written on every PATCH/note/follow-up/disposition); add an in-process write queue per file and rate-limit `/api/scrape`, `/api/enrich`, `/api/apify-scrape` before deploy.

---

## Critical risks (block deploy)

### [C-1] Lost updates on `setters.json` under concurrent PATCH
- **File:** `index.js:2477` (PATCH `/api/setters/leads/:id`), pattern repeats at lines 2562, 2626, 2649, 2663, 2679, 2699, 2792
- **Symptom:** Two setters editing different leads at the same time → one of the edits silently disappears (last writer wins on the entire 3.4 MB file). With 8 setters clicking through pipeline + cascade logic, this WILL happen tomorrow.
- **Why:** Every handler does `const data = loadSettersData()` (full file parse) → mutate object in memory → `saveSettersData(data)` (full file overwrite). No locking, no per-lead update, no atomic write. Node is single-threaded so ONE handler is safe, but `saveSettersData` is async I/O — between the read and the write of handler A, handler B's read+write can interleave.
- **Fix (1-line):** Add an in-process serialization queue around `saveSettersData` (single async chain: `pending = pending.then(() => doWrite(data))`), so all writes serialize. Bonus: write to `setters.json.tmp` then `fs.renameSync` for atomicity.
- **Effort:** S (≈30 lines, no API changes)

### [C-2] No rate limit on `/api/scrape`, `/api/enrich`, `/api/apify-scrape` — credit burn risk
- **File:** `index.js:1780` (`/api/scrape`), `index.js:3366` (`/api/enrich`), `index.js:1039` (`/api/apify-scrape`)
- **Symptom:** Admin (or any setter promoted to admin) spam-clicking "Scrape" or import flows can exhaust SerpAPI / Apify credits in minutes. `/api/scrape` accepts `maxPages` up to 100 with NO cap on simultaneous keywords/locations (see line 1789–1792, multiplied by `searchLocation` loop).
- **Why:** `aiLimiter` exists (`index.js:77`) but is only attached to `/api/faqs/suggest` (line 3986). `loginLimiter` is only on `/api/auth/login`. `/api/scrape`, `/api/enrich`, `/api/apify-scrape` have no limiter, no concurrent-request guard.
- **Fix (1-line):** Create a `scrapeLimiter = rateLimit({ windowMs: 60_000, max: 5, keyFn: req => 'scrape:' + req.auth.user.id })` and attach to all three endpoints. Also clamp `maxPages * locations.length * queries.length <= 50` per request.
- **Effort:** S (10 lines)

### [C-3] `loadAuthData()` writes to disk on every authenticated request when sessions expire
- **File:** `index.js:128` (`loadAuthData`), called by `getSessionFromRequest` at `index.js:208`, called by `attachAuth` at `index.js:223` mounted on every `/api/*` (line 620)
- **Symptom:** Every single API request triggers a full `auth.json` parse + (if any session expired since last check) a full `writeFileSync`. With 8 setters polling stats / lists, sessions expire daily → at the moment of expiry, **every request races to be the one that purges**. Concurrent writes on `auth.json` = lost session, lost user, lost invite.
- **Why:** Lines 137–142: `raw.sessions = raw.sessions.filter(...)` then `if (raw.sessions.length < beforeCount) writeFileSync(...)`. Done inside a function called by EVERY request handler. No lock.
- **Fix (1-line):** Move expired-session GC into a setInterval (every 5 min, single owner); make `loadAuthData` read-only.
- **Effort:** S (10 lines)

---

## High risks (should fix before tomorrow)

### [H-1] `/api/faqs/suggest` reads `setters.json` (3.4 MB) on every call
- **File:** `index.js:4009` inside the suggest handler
- **Symptom:** Each AI suggestion call parses 3.4 MB of JSON synchronously to fish out one variant. 8 setters × frequent IA suggestions = noticeable event-loop blocking (50–150ms per parse on Railway shared CPU) plus disk I/O.
- **Why:** `loadSettersData()` parses the whole file even when only `variants` is needed.
- **Fix (1-line):** Add an in-memory `variantsCache` invalidated on save, OR split variants into their own small file.
- **Effort:** S

### [H-2] WA `incrementCounter` has read-modify-write race
- **File:** `src/wa/data.js:119` (`incrementCounter`) — calls `getAccount` (load+find) then `updateAccount` (load+findIndex+spread+save)
- **Symptom:** Two near-simultaneous `incrementCounter('msgsSentToday')` calls → counter increments by 1 instead of 2. Daily caps and ban-detection rely on these counters → cap can be silently bypassed.
- **Why:** Same load→mutate→save pattern, no locking. `updateAccount` re-reads the file but uses the patch from the first call.
- **Fix (1-line):** Inside `updateAccount`, accept a function `(prev) => patch` and apply atomically inside one load+save; serialize via the same write queue as C-1.
- **Effort:** S

### [H-3] `/api/auth/me` (and any GET) writes `auth.json` if expired sessions present
- **File:** Same as C-3, but worth surfacing — even GETs can write disk.
- **Symptom:** `GET /api/auth/me` (frontend polls this on every page load + presence refresh every ~15s) can trigger a write. With 8 clients polling, write contention.
- **Fix:** Same as C-3.
- **Effort:** S

### [H-4] `/api/admin/import-data` overwrites entire data files with NO validation
- **File:** `index.js:1025–1036`
- **Symptom:** A bad payload (or a malicious admin-cookie hijack) can wipe `setters.json`, `auth.json`, `history.json` in one POST. No schema check, no backup-before-overwrite, no size cap (well, 50 mb body limit).
- **Why:** `req.body.{history,auth,setters}` is passed straight to `saveX(...)`. `loadSettersData` will at least re-normalize on next read, but partial/garbage data corrupts everything.
- **Fix (1-line):** Before save, run `makeBackup('pre-import')` (already exists at `index.js:993`) and assert each payload has expected top-level shape (`Array.isArray(setters.setters)`, etc.).
- **Effort:** S

### [H-5] `/api/scrape` makes N×M sequential SerpAPI calls inside the request, no timeout, no streaming
- **File:** `index.js:1806–1855` (nested `for` over queries × locations × pages, awaiting `searchLocation` each iteration)
- **Symptom:** A single scrape with 3 keywords × 5 cities × 5 pages = 75 sequential SerpAPI calls in one HTTP request. Railway will close the socket at 30s/60s; client sees timeout but the loop keeps running on the server burning credits. No `req.aborted` check.
- **Why:** No `AbortController` wired to the request, no batching, no max-time guard.
- **Fix (1-line):** Add `req.on('close', () => { aborted = true; })` and check `if (aborted) break;` between iterations; also clamp total work as in C-2.
- **Effort:** S–M

---

## Medium risks (fix this week)

### [M-1] `getSessionFromRequest` parses 10 KB `auth.json` on EVERY `/api/*` request
- **File:** `index.js:203`, mounted globally at `index.js:620`
- **Symptom:** Disk read + JSON.parse on every request. At low traffic OK; at sustained polling from 8 clients (presence + stats), measurable. Will get worse as `auth.json` grows.
- **Fix:** In-memory cache of `auth.json` invalidated on `saveAuthData`; use mtime check or just keep an in-process copy.
- **Effort:** M

### [M-2] Quiz `quiz-data.json` and onboarding HTML files read from disk per request
- **File:** `index.js:1334` (quiz reads on `GET /onboarding/...`), `index.js:1316` and `index.js:1385` (HTML wrappers)
- **Symptom:** Disk hit on every onboarding page load. Not catastrophic but unnecessary.
- **Fix:** Cache HTML and quiz JSON in memory at boot (already done for onboarding TEXT via `loadOnboardingText`); apply same to raw HTML.
- **Effort:** S

### [M-3] No body validation on `/api/setters/leads/:id/note` and `/interaction`
- **File:** `index.js:2649`, `index.js:2562`
- **Symptom:** A setter posting a 5 MB note string will be accepted (only the global 50 mb body limit applies), get stored in `setters.json`, then every subsequent `loadSettersData` parses it. Not malicious users → unlikely; but copy-pasted CSV into a note field is plausible.
- **Fix:** Cap each free-text field server-side (e.g. `note.text.slice(0, 5000)`) — pattern already exists for `notes` in call-disposition (line 2721 caps at 500).
- **Effort:** S

### [M-4] `wa_events.json` rotation re-reads + re-writes the entire file on every `appendEvent`
- **File:** `src/wa/data.js:259`
- **Symptom:** 137 KB today; will grow with 8 setters generating events. Each event = full read + push + full write. At 1000 events/day × 8 setters this is fine; at sustained socket activity this is the main I/O hot spot.
- **Fix:** Append-only log file (`fs.appendFile`) + periodic rotation; only reload when listing.
- **Effort:** M

---

## Low risks / nice-to-have

- `index.js:1554` — `fs.statSync` + `fs.renameSync` for error-log rotation runs inside the hot path of `logError`; race possible if two errors fire at the same time crossing 5 MB. Switch to `appendFile` + scheduled rotation.
- `index.js:1797–1799` — In-memory `seenKeys`/`seenPhones`/`seenNormNames` `Set`s grow unbounded inside `/api/scrape` for big batches. With `maxPages` clamping (C-2) this is fine.
- `index.js:74` — Login limiter `max=5/15min` per IP is correct, but 8 setters behind shared NAT (e.g. same office WiFi) all logging in tomorrow will share the 5-attempt budget. Consider keying by `email` for the FIRST login burst.
- `index.js:32` — `qwen/qwen3-14b:free` fallback has no timeout configured on the OpenAI client; a stuck OpenRouter call will hold the request handler indefinitely. Wrap in `Promise.race` with 30s timeout.
- `src/wa/data.js:259` — `appendEvent` accepts arbitrary `payload` and JSON.stringifies it into the file; if a caller passes a circular object the whole save throws and the event is dropped (caught silently by `saveJson`'s try/catch).
- `index.js:208` — `getSessionFromRequest` is called even on public endpoints under `/api/*` (e.g. `/api/health` line 41 is registered BEFORE attachAuth, so OK; but `/api/auth/login` runs through it and hits disk before the limiter — minor).

---

## What's already protected (don't re-check)

- ✅ Global error handler at `index.js:4225` and `index.js:4362` — uncaught route errors return 500 instead of crashing the process.
- ✅ `process.on('uncaughtException'/'unhandledRejection')` at `index.js:1565` — the process won't die from a single unhandled rejection; errors are logged to `data/error.log` with rotation.
- ✅ Login rate limiter (`loginLimiter`, 5/15min/IP) at `index.js:72` — brute force on login is mitigated.
- ✅ AI rate limiter (`aiLimiter`, 30/hr/user) on `/api/faqs/suggest` at `index.js:3986`.
- ✅ Periodic backups every 6h via `BACKUPS_DIR` (`index.js:1571`) — recovery path exists if a JSON corrupts.
- ✅ SSRF guard on `/api/enrich` (`index.js:3387–3400`) — blocks localhost / RFC1918 / metadata IP.
- ✅ Body limit `50mb` (`index.js:37`) — very generous but at least bounded.
- ✅ Apify call has 8s `AbortController` timeout (`index.js:3402`) — won't hang forever on enrich.
- ✅ `/api/setters/import` validates batch size (max 10000) and per-lead shape (`index.js:2326–2337`).
- ✅ WA routine sanitization clamps `dailyMessages`, `dripMs`, `hardMaxDailyMessages` (`src/wa/routes.js:25–47`).
- ✅ `wa_events.json` has built-in rotation at 10000 events (`src/wa/data.js:8`).
- ✅ Healthcheck endpoint `/api/admin/health` (`index.js:4255`) gives real-time visibility into file sizes, error count, backup freshness — use this tomorrow to monitor.
- ✅ `ensureLeadDefaults` (`index.js:274`) is defensive about missing fields — old data won't crash handlers.
- ✅ Scryptsync password hashing + `timingSafeEqual` (`index.js:92–104`) — auth crypto is sound.

---

## Action plan for tomorrow (in priority order)

1. **C-1 + H-2** (write queue): single shared serialization helper applied to `saveSettersData`, `saveAuthData`, `saveFaqs`, `saveHistory`, `saveTraining`, and the WA `saveJson`. ~30 lines, eliminates the entire family of lost-update bugs. **Highest ROI.**
2. **C-2** (scrape rate limit + max-work clamp): 10 lines. Prevents the most likely "wtf happened to our SerpAPI bill" incident.
3. **C-3 / H-3** (move session GC out of hot path): 10 lines.
4. **H-4** (import-data validation + auto-backup): 5 lines.
5. **H-5** (scrape abort on client disconnect): 5 lines.
6. **H-1** (cache variants for `/faqs/suggest`): 15 lines.

Total: roughly 75 lines of code, all in `index.js` and `src/wa/data.js`. No schema changes, no API changes, fully backward compatible. Could be done in 2–3 hours including tests.

---

*Concerns audit: 2026-04-27 (pre-launch with 8 setters)*

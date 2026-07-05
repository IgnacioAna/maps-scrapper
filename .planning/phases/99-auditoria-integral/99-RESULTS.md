# Auditoría integral 2026-07 — Resultados

**Rama:** `audit/limpieza-2026-07` (sobre `origin/main` = 1fef309).
**Suite completa:** 670/670 verde tras todos los fixes (backend + frontend + módulos). Cero regresiones.

## Alcance

3 revisores (backend `index.js`, frontend `app.js`/`wa.js`, módulos `src/wa/*`+`enrichment.js`+`pre-deploy.js`).
- **Módulos**: 17 hallazgos (2 crit, 8 warn, 7 info). **15 resueltos, 2 diferidos.**
- **Backend** (`index.js`): 8 hallazgos (0 crit, 4 warn, 4 info). **7 resueltos, 1 salteado** (IN-02 regex best-effort, nitpick sin bug real).
- **Frontend** (`app.js`/`wa.js`): 5 hallazgos (0 crit, 3 warn, 2 info). **5 resueltos.**

## Resueltos backend (índice.js)

| ID | Sev | Qué |
|----|-----|-----|
| BK-WR-01 | warn | speed-to-lead alert nunca disparaba (snapshot tomado después de mutar respondio) |
| BK-WR-02 | warn | /mercury/generate y /faqs/suggest-tags sin rate limit (quema de créditos OpenAI) |
| BK-WR-03 | warn | guard anti-quema de /scrape subcontaba 10× (min(maxPages,10) vs 100 real) |
| BK-WR-04 | warn | borrado de nota por índice → cap FIFO borraba la nota equivocada. Ahora por id |
| BK-IN-04 | info | POST /calendar no validaba ownership del leadId (setter) |
| BK-IN-03 | info | supervisor ve todas las generaciones Mercury — intencional, documentado |
| BK-IN-01 | info | comentario timeout 20s→15s |

## Resueltos frontend (app.js / wa.js)

| ID | Sev | Qué |
|----|-----|-----|
| FE-WR-01 | warn | `_leadStoreApply` rompía la identidad de referencia entre los 2 cachés → lista stale tras disposition+nota |
| FE-WR-03 | warn | `loadHoyView` sembraba solo el Map → Hoy y Llamadas con objetos distintos por lead |
| FE-WR-02 | warn | `altPhone` en onclick con escaping de contexto incorrecto (backend ya validaba E.164; limpieza en save como defensa) |
| FE-IN-01 | info | `summary.byStatus` sin guard → TypeError si falta |
| FE-IN-02 | info | param muerto `total` en `_hoyRenderSection` |

Cache-buster: app.js + wa.js → `v=20260705a`.

## Resueltos (15/17) — módulos

| ID | Sev | Qué | Commit |
|----|-----|-----|--------|
| CR-01 | crit | Setter podía lanzar campañas desde cuentas WA ajenas | c6be192 |
| CR-02 | crit | Setter podía targetear/leer los ~5000 leads del sistema vía leadFilter | c6be192 |
| WR-08 | warn | pre-deploy commiteaba session tokens vivos (cookies gs_session) al repo | 6fff3c9 |
| WR-01 | warn | proxy.pass en claro en 5 endpoints admin | a8f7416 |
| WR-02 | warn | POST /events: ownership check sólo si venía status | 254ecc8 |
| WR-07 | warn | anti-SSRF bypasseable por redirect (safeFetch redirect:follow) | 2f35a86 |
| WR-04 | warn | lead marcado "enviado" con destinatario offline → lead perdido | a2f6f3b |
| WR-06 | warn | JSON corrupto/truncado → wipe silencioso del dataset | 63c2ed0 |
| WR-05 | warn | cap diario anti-ban por-campaña en vez de por-cuenta | 4bd75ba |
| IN-02 | info | match de teléfono endsWith("") matcheaba primera cuenta | 9b1184c |
| IN-03 | info | window hourStart==hourEnd nunca envía | 9b1184c |
| IN-04 | info | leadStates huérfanos → campaña nunca "done" | 9b1184c |
| IN-05 | info | PATCH cuenta mergeaba body crudo (sin whitelist) | 9b1184c |
| IN-01 | info | dead code en requireRole (inner nunca usado) | 6da3428 |
| IN-07 | info | campañas con setterId="" (visibilidad + gestión) | 7a8302d |

Tests nuevos: SSRF redirect x2 (enrichment), CR-01/CR-02 x2 + WR-06 x1 (campaigns), WR-05 x1 (engine).

## Diferidos (2/17) — requieren decisión/presencia del usuario

- **WR-03** (JWT desktop de 30 días sin revocación): un setter desactivado retiene acceso hasta 30 días. Fix real pero requiere exponer `getUserById` por las deps de `mountWa` + leer `auth.json` en cada request (perf) + tocar auth en 2 lugares (requireAuth HTTP + middleware del socket). No hacerlo a ciegas sobre un módulo parkeado — hacer con el usuario. Mitigación actual: rotar `JWT_SECRET`.
- **IN-06** (doble outreach: el launch no excluye leads ya activos en otra campaña running): moderado, requiere lookup cross-campaña de leadStates al lanzar. Bajo impacto con el módulo parkeado.

## Diferidos completados (2026-07-05)

- **Módulos WR-03** ✅ — revocación de JWT: helper `getUserById` (user vivo+activo) por deps de `mountWa`; `requireAuth` (routes) y middleware del socket (gateway) revalidan en cada request. +1 test.
- **Módulos IN-06** ✅ — el launch excluye leads ya activos en otra campaña running (`skippedBusy` en la respuesta). +1 test.

## Pendiente

- **Verificación en vivo** antes del deploy: (1) scrape grande → confirmar el nuevo corte del guard de créditos; (2) flujo de notas en Llamadas → confirmar que aparecen al toque (fix `_leadStoreApply`).
- Merge de `audit/limpieza-2026-07` → `main` + `npm run pre-deploy` + push (cuando el usuario lo apruebe).

## Resumen final

- **Total: 30 hallazgos, 29 resueltos** (2 críticos + 15 warnings + 12 info), 1 salteado con criterio (backend IN-02, nitpick de regex sin bug real).
- Cada fix con test o verificación; **672/672 tests verdes**.
- Nada pusheado — todo en `audit/limpieza-2026-07`.

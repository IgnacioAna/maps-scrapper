# Auditoría integral 2026-07 — Resultados

**Rama:** `audit/limpieza-2026-07` (11 commits sobre `origin/main` = 1fef309).
**Suite completa:** 662/662 verde tras los fixes (línea base: 621 verde + 16 flaky de Mercury por rate-limit 429 de OpenRouter, no regresiones).

## Alcance

3 agentes revisores en paralelo (backend `index.js`, frontend `app.js`/`wa.js`, módulos `src/wa/*`+`enrichment.js`+`pre-deploy.js`).
- **Módulos**: completó → 17 hallazgos (2 crit, 8 warn, 7 info). **15 resueltos, 2 diferidos.**
- **Backend + Frontend**: los 2 revisores se quedaron sin cuota de sesión antes de escribir su reporte. **Pendiente re-correr** (`gsd-code-review` sobre `index.js` y `public/app.js`+`wa.js`).

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

## Pendiente

- Re-correr `gsd-code-review` sobre `index.js` (backend) y `public/app.js`+`public/wa.js` (frontend) — los revisores murieron por cuota.
- Decisión sobre WR-03 e IN-06.
- Merge de `audit/limpieza-2026-07` → `main` + `npm run pre-deploy` + push (cuando el usuario lo apruebe).

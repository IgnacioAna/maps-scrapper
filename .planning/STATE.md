# SCM — STATE

> Estado vivo del proyecto. Actualización: 2026-07-26.

---

## Current Milestone

**v2.0 — Gestión por excepción** (iniciado 2026-07-25)

Reportes diario/semanal automáticos al grupo de WhatsApp de los 3 socios
(fallback email), disposición obligatoria, coaching por vendedora desde
transcripciones, alertas que llegan solas. Solo vendedoras nuevas.

## Current Position

- **Phase:** 20 — Disposición obligatoria — 3/3 planes EXECUTED +
  verificados. **Preview checklist a-f: 6/6 PASS** (documentado en
  20-03-SUMMARY). Code review: 1 critical **CR-01 FIXED** (`84ebf4a` —
  re-discar el mismo lead ya invalida la ventana de correctsAutoMarked;
  cache-buster app.js → `v=20260725c`), 4 warnings advisory + 4 info en
  `20-REVIEW.md` (candidatos de hardening: stash de franja sin expiración
  WR-01, meta consumida ante red caída WR-02, ghost ad-hoc y gate sin row
  WR-03, cancel race WR-04).
- **Status:** VERIFICATION **human_needed 14/15** (`20-VERIFICATION.md`):
  todo lo automatizable verificado (endpoints, guard, bifurcación
  enteredActive||committedRemote, D-04 intacto por diff, suite
  **864/864**); quedan 3 ítems humanos en `20-HUMAN-UAT.md` (llamada
  Telnyx real, % marcada tras 1 semana en prod, feedback SDRs).
- **Last activity:** 2026-07-26 — (1) Phase 20 ejecutada completa (waves 1-2,
  preview checklist, review + fix CR-01, verificación) y **DEPLOYADA**:
  push de 30 commits a `main` (`060013c`), `/api/version` en prod devuelve
  `20260725c`, los 3 endpoints nuevos responden 401 (vivos). ⚠️ El push
  incluyó también la **Phase 19 completa**, que nunca había llegado a
  producción — el cron del reporte semanal recién ahora corre en prod.
  (2) **Phase 21 discutida** — `21-CONTEXT.md` + `21-DISCUSSION-LOG.md`
  escritos (29 decisiones D-01..D-29, listo para planificar).

**Próximo paso:** UAT humano de `20-HUMAN-UAT.md` (las SDRs recargan el tab
una vez — el banner de versión avisa; la regla arranca de cero, D-05). Al
aprobar el UAT: `/gsd-verify-work 20` → marcar COMPLETE. La Phase 21 ya tiene
contexto: `/gsd-plan-phase 21`.
**Decisión del user (2026-07-26):** `RESEND_API_KEY` NO es prioridad — el
reporte diario va al grupo de WhatsApp y **NO tiene fallback a email**
(Phase 21 D-04, acota REP-07); el email queda cableado y apagado. Las
invitaciones se mandan copiando el link a mano.
**Hallazgo de la Phase 21 (verificado en código, corrige el roadmap):** el
JID del grupo NO destraba nada — el desktop maneja WhatsApp Web como una
persona vía deeplink `send?phone=` y WhatsApp no tiene equivalente para
grupos. La solución es elegir el grupo de una lista una vez y guardar su
identificador (Phase 21 D-03).
**Pendiente del user:** cargar `RESEND_API_KEY` (y opcional `REPORT_EMAILS`)
en Railway → Variables — sin la key el cron no manda nada.

---

## Phase Status (v2.0)

| # | Phase | Reqs | Status |
|---|-------|------|--------|
| 19 | Encender el reporte semanal | REP-01..03 | **COMPLETE** (2/2 planes, 2026-07-25) |
| 20 | Disposición obligatoria | DISP-01..03 | Ejecutada 3/3 + verificada (human_needed — UAT en prod pendiente, 2026-07-26) |
| 21 | Reporte diario + canal WhatsApp | REP-04..10 | Context gathered (2026-07-26, 29 decisiones) — listo para plan |
| 22 | Coaching por vendedora | COACH-01..06 | Pending (gate: verificación Whisper ronda 8) |
| 23 | Notificación por excepción | ALERT-01..03 | Pending |

Milestone anterior (v1.x, Phases 1–18): ver `MILESTONES.md`.

---

## Verificaciones de la sesión 2026-07-25 (base del roadmap)

Contra HEAD `a9e4886`:

- **Bug `now`** en `maybeRunWeeklyReportCron` confirmado (index.js:1861 y
  :1870 usan `now`; solo existe `nowTs` en :1857). `data/reports.json` no
  existe → nunca persistió un envío.
- Sección WhatsApp del mail semanal mezcla acumulados históricos bajo
  encabezado "semana" (index.js:1821).
- `/analyze` (index.js:13678) admin/supervisor-only, cachea en
  `call.mercuryAnalysis`, **cero tests**.
- Hook post-transcripción para el auto-analyze: donde ya corre
  `_autoDispositionLLM` (index.js:14525).
- Alertas de equipo se calculan (index.js:9772) pero solo pintan pantalla.
- Patrón de cola a copiar: `scheduledMessagesTick` (index.js:5126) — el
  módulo NO se reusa (atado a leadId).
- **Handler `followup:send-message` de wa-multi NO soporta grupos**: manda
  vía deeplink `web.whatsapp.com/send?phone=` (out/main/index.js:630,736
  del desktop). Plan B: repack con group-send (búsqueda por nombre +
  typing; `out/` ES el source, NUNCA `npm run build`). Plan C: 3 DMs
  individuales. Plan D: solo email.
- `gsd-sdk` no está en PATH → commits/estado manuales con git.

---

## Open Questions (a resolver en discuss-phase, NO antes)

- **Phase 20**: forma exacta del enforcement (modal bloqueante vs cola de
  pendientes vs ambas); tratamiento de llamadas viejas sin marcar; cómo
  evitar disposiciones falsas; interacción con la ventana de 10 min del
  audio.
- ~~**Phase 21**~~: RESUELTA en `21-CONTEXT.md` (2026-07-26, 29 decisiones).
  Expiración de diarios = 3 días. El molde quedó elegido con datos reales y
  se valida definitivamente en el celular con el primer envío real.
- **Phase 22**: ¿las vendedoras ven su propio scorecard? (hoy
  admin/supervisor only — sin verlo es vigilancia, viéndolo es coaching).
- **Phase 23**: quién de los 3 socios actúa ante cada tipo de alerta.
- **Acciones del user pendientes (bloquean la prueba en vivo de la Phase 21,
  NO la construcción)**: (1) conseguir un número de WhatsApp NUEVO dedicado y
  registrarlo; (2) crear el grupo con los 2 socios — **cerrado, sin las
  vendedoras**; (3) abrir `wa-multi-portable-v0.5.10`, escanear el QR con ese
  número, elegir el grupo de la lista y dejar la app abierta.
  `RESEND_API_KEY` dejó de ser necesaria para el diario (decisión D-04: sin
  fallback a email); sigue haciendo falta para el mail semanal.

---

## Accumulated Context

### Roadmap Evolution

- 2026-07-25 — **Milestone v2.0 iniciado**. Roadmap v1 (phases 1–18)
  archivado en MILESTONES.md. Numeración continúa: 19–23. Decisiones del
  user: canal = grupo WhatsApp (email fallback), disposición obligatoria
  (adelantada a Phase 20), alcance = solo vendedoras nuevas, reportes por
  excepción sin métricas en cero. Advertencia de alcance: NO ampliar a
  orquestador de agentes/Stripe/GHL antes de que 19–22 corran con datos
  reales.
- 2026-07-12 — Phase 18 EXECUTED y verificada (commits 6b00175 backend,
  a196b76 tests 21/21, 53b7db7 frontend; suite completa 751/751;
  verificación en vivo: supervisor scoped ve solo sus 3 SDRs, 403 en
  financieros/pool/command, home = view-team).
- 2026-07-12 — Phase 18 added: Supervisor restringido + panel de
  rendimiento SDR. `visibleSetterIds[]` en el user record.
- 2026-06-10 — Phase 8 added: Anti-detección wa-multi (Proxy +
  Fingerprint por cuenta). DONE 2026-06-11, luego parkeada con el pivot.
- 2026-06-10 — Phase 7 added: Motor de Campañas Drip WhatsApp. v2
  2026-06-12, luego parkeada con el pivot a llamadas.
- 2026-05-21/22 — Phase 6 Telnyx Calls Foundation ejecutada y cerrada
  (~22h, 5 bugs del SDK resueltos). Base del call center actual.

### Decisiones arquitectónicas Phase 6 (siguen vigentes)

1. **API key NUNCA en browser** — siempre vía endpoints backend
2. **Env vars > JSON** — secrets en Railway env vars; self-healing del JSON
3. **WebRTC vía CDN** (`@telnyx/webrtc@2/lib/bundle.js`)
4. **Caller ID por país destino** + rotación round-robin
5. **Estados terminales reales del SDK** — `hangup`/`destroy`/`purge`
6. **`remoteElement` en `newCall(options)`**
7. **Ringback fake con Web Audio API**
8. **Manual attach del remoteStream con retry**

---

*Last updated: 2026-07-26.*

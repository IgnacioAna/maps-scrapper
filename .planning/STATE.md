# SCM — STATE

> Estado vivo del proyecto. Actualización: 2026-07-25.

---

## Current Milestone

**v2.0 — Gestión por excepción** (iniciado 2026-07-25)

Reportes diario/semanal automáticos al grupo de WhatsApp de los 3 socios
(fallback email), disposición obligatoria, coaching por vendedora desde
transcripciones, alertas que llegan solas. Solo vendedoras nuevas.

## Current Position

- **Phase:** 19 — Encender el reporte semanal (en ejecución)
- **Plan:** 19-01 EXECUTED (fix backend, commits 2a41048/be1445d/b13d051,
  90/90 tests afectados verdes) — sigue 19-02 (tests de regresión)
- **Status:** Executing — wave 1 completa, SUMMARY en
  `.planning/phases/19-encender-reporte-semanal/19-01-SUMMARY.md`
- **Last activity:** 2026-07-25 — 19-01 ejecutado: cron sin ReferenceError
  (REP-01), REPORT_EMAILS multi-destinatario (REP-02), data del CALL METRICS
  CORE sin sección WSP + Ignacio/Paula excluidos (REP-03), reports.json en
  persistencia de 4 lugares + BACKUP_FILES

**Próximo paso:** ejecutar 19-02 (tests de regresión del reporte semanal).
**Pendiente del user:** cargar `RESEND_API_KEY` (y opcional `REPORT_EMAILS`)
en Railway → Variables — sin la key el cron no manda nada.

---

## Phase Status (v2.0)

| # | Phase | Reqs | Status |
|---|-------|------|--------|
| 19 | Encender el reporte semanal | REP-01..03 | Planned (2 planes, ready to execute) |
| 20 | Disposición obligatoria | DISP-01..03 | Pending (adelantada a pedido del user) |
| 21 | Reporte diario + canal WhatsApp | REP-04..10 | Pending (prueba JID de grupo = primera tarea) |
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
- **Phase 21**: N de expiración de diarios pendientes (propuesta: 3 días);
  validación del molde de mensaje con el user en el celular.
- **Phase 22**: ¿las vendedoras ven su propio scorecard? (hoy
  admin/supervisor only — sin verlo es vigilancia, viéndolo es coaching).
- **Phase 23**: quién de los 3 socios actúa ante cada tipo de alerta.
- **Acción del user pendiente**: crear el grupo de WhatsApp con los 2
  socios y avisar (para la prueba de la Phase 21); cargar
  `RESEND_API_KEY` en Railway (fallback email).

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

*Last updated: 2026-07-25.*

# SCM — STATE

> Estado vivo del proyecto. Actualización: 2026-05-22.

---

## Current Phase

**Phase 6 — Telnyx Calls Foundation** ✅ **DONE (operativo + post-validación)**

**Status:** módulo de llamadas VoIP funcionando end-to-end. Audio bidireccional
validado contra celular real. Detección de hangup remoto OK. UI rediseñada como
modal centrado con backdrop + script panel lateral con framework PACE sticky.
Scripts oficiales SCM Cold Call v2 cargados (30 guiones en 12 triggers basados
en `SCM_Cold_Call_v2.docx` + frameworks de Julio Sagantini).

**Wave breakdown:**
- ✅ Wave 1 (4h): Backend foundation — config + endpoints + ephemeral creds proxy + webhook ed25519
- ✅ Wave 2 (5h): Frontend dialer MVP — SDK Telnyx WebRTC + botón Llamar + panel WebRTC + disposition
- ✅ Wave 3 (4h): Polish — endpoint /metrics + vista admin Centralita Telnyx + script panel + value statement framework
- ✅ Wave 4 (~3h): Docs + deploy + testing E2E real
- ✅ **Sprint 0** (~1h): paginación + sort + restricción admin-only en Llamadas
- ✅ **Sprint 1** (~1h): scripts oficiales SCM v2 (30 guiones) + endpoint reset-to-seed
- ✅ **Sprint 2** (~1.5h): rediseño panel scripts con PACE sticky + buscador + tone chip

**Total invertido**: ~22h (estimación inicial 16h — overage por 5 bugs críticos del SDK Telnyx que requirieron investigación profunda del bundle).

**Bugs críticos resueltos en Wave 4 / post-validación:**
1. CDN URL del SDK (`lib/index.iife.js` no existe → `lib/bundle.js`)
2. `loadCallsView` no llamaba `_telnyx.fetchConfig()` → botón caía a fallback `tel:`
3. Audio bidireccional roto: `remoteElement` debe ir en `client.newCall(options)`, no solo en constructor de TelnyxRTC
4. Estados terminales reales del SDK: `hangup`/`destroy`/`purge` (yo había puesto `done`/`ended` que NO existen como call states)
5. Performance: backdrop-filter blur + audio controls + console.log defensivos en cada notification ralentizaban la web

**Commits acumulados (Phase 6 completa)**:
1. `ec7e9f5` Add phase 6
2. `272a111` Plan wave breakdown
3. `7033bc5` Wave 1.1 config storage
4. `2571e9a` Wave 1.2 endpoints REST
5. `7cd3034` Wave 1.3 ephemeral creds proxy
6. `cce191f` Wave 1.4 webhook + events
7. `20e7e71` Wave 2.1 SDK + cliente module
8. `bfedd21` Wave 2.2+2.3 botón Llamar + panel WebRTC
9. `915e83e` Wave 2.4 disposition con metadata + costos
10. `6b73f4c` Wave 3.1 endpoint /metrics
11. `82b3b6f` Wave 3.2 vista admin Centralita Telnyx
12. `fb5c319` Wave 3.3 script panel + value statement framework
13. `e1cc2b8` docs(phase-6): documentación módulo Telnyx
14. `77c0eeb` env vars con prioridad para secrets Telnyx
15. `6f161e6` fix: loadCallsView refrescar config Telnyx antes del render
16. `77d8a3e` fix: corregir URL del CDN del SDK Telnyx WebRTC
17. `12409b8` fix: ringback audio local + z-index del panel
18. `e6aef4d` fix: panel de llamada con fondo sólido (no transparente)
19. `ec675af` lead manual + rediseño panel y Centralita
20. `50ce463` fix: audio bidireccional + state detection + UI call mode
21. `8c459eb` fix: estados reales del SDK (intento fallido — done/ended)
22. `2c0eb48` perf: quitar backdrop-filter blur, audio controls, logs ruidosos
23. `578dda0` fix: manual attach del remoteStream con retry
24. `44975da` fix: estados terminales correctos (hangup/destroy) + remoteElement en newCall
25. `12fce73` sprint 0: paginación + sort + admin-only en Llamadas
26. `6af7d90` sprint 1: scripts oficiales SCM Cold Call v2
27. `b22df14` sprint 2: panel de scripts rediseñado durante llamada

**Verificación E2E**: ver `.planning/phases/06-telnyx-calls-foundation/06-VERIFICATION.md` para el checklist completo de tests validados contra producción.

**Próximo paso**: usar el sistema en operación real. El admin (Ignacio) lo usa solo
por ahora, los 15 setters siguen con WhatsApp. Quick wins futuros: rediseño deeper
del flow de scripts en vivo (Phase 7 candidate), parallel dialer, call recording.

---

## Phase Status

| # | Phase | Status |
|---|-------|--------|
| 1 | Bloque A — Cierre v1 | Mayormente done (15 setters operativos) |
| 2 | Bloque B — UX setters / warmer | Parcialmente done (warming-lunes + warming-ai-to-ai ejecutadas) |
| 3 | Bloque C — GHL-ready | Pending |
| 3.5 | Bloque C.5 — Extensión "pegar humano" | ✅ Completado y deployado v0.2.0 (2026-04-27) |
| 4 | Bloque D — IA mejorada | Pending (futuro) |
| 5 | Bloque E — Llamadas IA | Pending (futuro lejano — depende de Phase 6) |
| 6 | **Telnyx Calls Foundation** | ✅ **DONE (2026-05-22)** |
| 7 | **Motor de Campañas Drip WhatsApp** | Pending — añadida 2026-06-10, próximo `/gsd-plan-phase 7` |
| 8 | **Anti-detección wa-multi: Proxy + Fingerprint** | Pending — añadida 2026-06-10, próximo `/gsd-plan-phase 8` |
| 9+ | (Futuro) Cold Calling efectividad | Posible: parallel dialer, call recording, Mercury IA en vivo, scoring leads |

---

## Recent Sessions

### 2026-05-22 — Phase 6 cerrada operativamente

Sesión maratónica que incluyó testing E2E real, fix de 5 bugs críticos del SDK
Telnyx (vía investigación profunda del bundle minified + spawn de agent
Explore), adopción de los scripts oficiales SCM Cold Call v2 + frameworks de
Julio Sagantini (PACE, 3-S, problem-based pitch), y mejoras UI/UX del panel
de llamada y de scripts.

Cambios operativos clave:
- **Setters NO usan llamadas todavía** — solo Ignacio llama. view-calls
  restringido a `admin,supervisor`. Los 15 setters siguen con WhatsApp.
- **Paginación 50/página** en Llamadas (se trababa con muchos leads).
- **Sort dropdown** con 7 opciones (nunca llamados / recientes / país / etc.).
- **Lead manual** desde admin — para testing y referidos puntuales.

Próximos pasos (futuro):
- Operar el sistema en frío y medir ratio opener (>70% según script)
- Si hace falta, agregar Phase 7 con: parallel dialer, call recording,
  scoring leads, Mercury IA en vivo durante la llamada.

### 2026-05-21 — Phase 6 iniciada y waves 1-3 ejecutadas

Sprint dedicado para integrar Telnyx WebRTC. 12 commits en ~13h. Wave 4
quedó pendiente del KYC del usuario (que se aprobó al día siguiente).

### 2026-05-01 (PM++) — Phase 2.3 AI-to-AI Warming Network ejecutada

Cierre del gap fundamental del warmer: el anterior era scheduled outbound,
NO warming real. Real warming = cuentas chatean entre sí con IA conversacional
para construir reputación natural. 6 waves ejecutadas con disciplina GSD.
Reusó Mercury (Inception Labs) + Qwen fallback EXISTENTES — cero API keys
nuevas. Cost estimado ~$0.45/mes para 30 cuentas × 10 msgs/día.

### 2026-05-01 (PM) — Phase 2.1 Warming-Lunes ejecutada (sprint Vie→Lun)

6 waves del PLAN.md ejecutadas. fingerprint-patcher.ts (Canvas/WebGL/Audio
randomizado por accountId con seed determinístico). Botón "🔥 Calentar"
one-click. Distribuible v3.0.0 zip (145 MB). Doc setter-quickstart.md.

### 2026-04-27 — Phase 3.5 (Bloque C.5) completada

Extensión Chrome MV3 "Pegar como humano" — distribuible 
`scm-paste-as-human-v0.2.0.zip`. Test pasado contra WA Web.

---

## Open Questions / Blockers

- **Phase 2 (warmer):** falta context refresh — qué del warmer ya
  funciona, qué rompe en operación real con 15 setters.
- **GSD tooling:** workaround manual sigue siendo necesario.
- **Phase 6 → operación real**: el sistema está listo. Ignacio empieza a llamar
  con los scripts v2 cargados. Medir ratio opener y ajustar.

---

## Notes

- Source of truth narrativo del roadmap sigue siendo el `ROADMAP.md` de raíz.
- Phase 6 quedó documentada completa en `.planning/phases/06-telnyx-calls-foundation/`
  con CONTEXT, PLAN, VERIFICATION, y este STATE.md.

---

## Accumulated Context

### Roadmap Evolution

- 2026-06-10 — Phase 8 added: Anti-detección wa-multi (Proxy +
  Fingerprint por cuenta). Modelo "perfil antidetect" tipo Dolphin Anty.
  Proxy por cuenta vía `session.setProxy` nativo de Electron (HTTP/SOCKS5;
  V2Ray excluido). Fingerprint determinista por seed (canvas/webgl/audio/
  navigator/dom) + coherencia geo↔proxy (timezone/locale/UA matchean país
  del proxy). Referencia: WAWarmer 1.1.2 extraído en tmp/app_source/
  (gitignored) — proxy+fingerprint ya probados contra WhatsApp Web.
  Infraestructura anti-baneo para correr Phase 7 a volumen.

- 2026-06-10 — Phase 7 added: Motor de Campañas Drip WhatsApp. Replica
  el workflow de campañas de GHL dentro del SCM: drip pacing
  configurable (batch/intervalo), split de variantes con pesos,
  bloques con delays humanos, bumps automáticos con cancelación al
  recibir respuesta, caps por cuenta según warming. Reusa el scheduler
  de scheduled_messages + wa-multi sendMessageInWindow. El handoff a
  Mercury IA (conversación + agendamiento) queda para Phase 4
  (Bloque D), que se redefine como "Mercury Autopilot" sobre esta base.
  Decisión del user: empezar por drip+mensajes; tools de Mercury
  (agendar, programar follow-ups) diferidas a Phase 4.

- 2026-05-21 — Phase 6 added: Telnyx Calls Foundation. Sprint dedicado
  de 2 días (16 hs) antes del corte del plan de Claude. Construye el
  módulo de llamadas internacionales VoIP dentro del SCM usando Telnyx
  ($35-55/mes vs CloudTalk $90-140/mes). Es la base de infraestructura
  para Phase 5 (Llamadas IA con voz automatizada), que queda diferida.

- 2026-05-22 — Phase 6 cerrada operativamente. Total ~22h (overage 6h
  por bugs del SDK). Sistema validado contra celular real. Scripts
  oficiales SCM Cold Call v2 cargados. Próximo objetivo: operación
  real + medición de ratio opener (target >70%).

### Decisiones arquitectónicas Phase 6 (resumen)

1. **API key NUNCA en browser** — siempre vía endpoints backend
2. **Env vars > JSON** — secrets en Railway env vars, JSON solo para
   datos no-sensibles (numbers, routing). Self-healing: si env var
   activa, el JSON se limpia automáticamente en próximo save.
3. **WebRTC vía CDN** (`@telnyx/webrtc@2/lib/bundle.js`) — sin app desktop
4. **Caller ID por país destino** — `countryRouting: { US: numId, default: numId }`
5. **Estados terminales reales del SDK** — `hangup`, `destroy`, `purge`
   (verificado en source vía agent Explore). NO `done`/`ended`.
6. **`remoteElement` en `newCall(options)`** — no solo en constructor del
   client. Sin esto el audio entrante no se monta.
7. **Ringback fake con Web Audio API** — el SDK v2 no reproduce el del
   carrier en outbound. Sintetizamos 440Hz+480Hz patrón US 2s ON / 4s OFF.
8. **Manual attach del remoteStream con retry** — fallback defensivo
   si el auto-mount del SDK falla por race conditions.

---

*Last updated: 2026-05-22.*

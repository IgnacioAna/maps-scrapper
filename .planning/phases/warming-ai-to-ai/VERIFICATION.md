# Phase 2.3 — AI-to-AI Warming Network — VERIFICATION

**Fecha:** 2026-05-01
**Status:** ✅ PASS — listo para deploy a Railway

---

## Verificación automatizada

| # | Check | Resultado |
|---|---|---|
| 1 | 8 módulos del warming-network cargan sin errores | ✅ |
| 2 | Test suite existente sin regresión | ✅ 299/299 |
| 3 | persona-generator: misma cuenta → misma persona | ✅ |
| 4 | persona-generator: 5 cuentas distintas → 5 personas distintas | ✅ |
| 5 | pairing: cross-setter only (paula↔paula NO) | ✅ |
| 6 | pairing: capacidad max 3 pares/cuenta respetada | ✅ |
| 7 | schedule: cadencias variadas por replySpeed (rápido 22min, lento 277min) | ✅ |
| 8 | 25 occurrences de `warming-network` en routes.js | ✅ |
| 9 | 17 occurrences en wa.js (frontend) + 3 en index.html | ✅ |
| 10 | 2 occurrences de `warming:send-message` en ws-client.ts del wa-multi | ✅ |

---

## Componentes implementados

### Server-side (GoogleSrapper)

```
src/wa/warming-network/
  persona-generator.js  (8.2 KB) — personas ficticias determinísticas
  store.js              (8.8 KB) — persistencia JSON pool/pairs/audit
  pairing.js            (5.0 KB) — engine cross-setter + fairness + anti-incest
  schedule.js           (4.1 KB) — timing humano gaussiano + active windows
  orchestrator.js       (9.8 KB) — loop tick + state machine por par
  llm-client.js         (3.1 KB) — wrapper sobre Mercury/Qwen existente
  conversation.js       (5.6 KB) — prompt building + generación de mensaje

src/wa/routes.js: +9 endpoints REST
src/wa/index.js: boot del orchestrator integrado
src/wa/gateway.js: filtro IA Inbox (warming inbounds NO aparecen como leads)
index.js: aiClient + AI_MODEL pasados a mountWa
```

### Client-side (wa-multi)

```
src/main/ws-client.ts: handler 'warming:send-message' que reusa el send
                      flow OS-level estable (loadURL + sendInputEvent).
                      Emite eventos con metadata { warmingPairId, isWarming }
                      para audit y para que el cap diario de outbound
                      eventualmente discrimine warming vs leads.
```

### Frontend (panel admin)

```
public/index.html: nuevo menu item "Red de Warming" (admin-only)
public/wa.js: vista completa con:
  - Stats cards: pool total/activas, pares activos, mensajes mes, costo IA
  - Tabla del pool con persona ficticia visible y acciones (pause/resume/unenroll)
  - Tabla de pares activos con state machine y próxima acción
  - Lista de últimos 20 mensajes intercambiados
  - Modal "Inscribir cuenta" con select de cuentas disponibles
  - Botón "Forzar tick" para debug
  - Refresh automático cada 30s
```

---

## Verificación manual pendiente del usuario

Después de deploy a Railway:

### Test 1 — Boot del orchestrator

1. [ ] Logs de Railway muestran: `✅ Warming network orchestrator activo`
2. [ ] No hay errors `aiClient no provisto` (debería estar Mercury configurado)
3. [ ] Archivo `data/warming-network.json` se creó automáticamente

### Test 2 — Inscribir cuenta vía panel

4. [ ] Ir a panel admin → sidebar "Red de Warming"
5. [ ] Vista carga con stats cards en 0
6. [ ] Click "+ Inscribir cuenta" → modal abre
7. [ ] Seleccionar una cuenta WA tuya (la que vos uses para test)
8. [ ] Click "Inscribir" → toast con persona ficticia generada
9. [ ] La cuenta aparece en la tabla del pool con persona, estilo, etc.

### Test 3 — Mínimo 2 cuentas para que arranquen pares

10. [ ] Inscribir SEGUNDA cuenta tuya (DIFERENTE setter dueño que la primera)
    - Importante: el cross-setter check requiere setters distintos
    - Si solo tenés cuentas tuyas como admin, el `setterId` será el mismo
    - Workaround: usar 2 cuentas asignadas a setters distintos (ej. 1 a vos, 1 a un tester)
11. [ ] Esperar 1-2 minutos o click "Forzar tick"
12. [ ] Tabla de "Pares activos" debería mostrar el par creado
13. [ ] State inicial: `PENDING_FIRST`, `nextActionAt` en pocos minutos

### Test 4 — Primer mensaje del LLM

14. [ ] Esperar a `nextActionAt` o forzar tick varias veces
15. [ ] Verificar logs de Railway: `[warming-llm] ok ... tok ... ms $...`
16. [ ] Verificar logs: `[warming-orch] sent: <persona> → <persona>: "..."`
17. [ ] El mensaje debería aparecer en la cuenta destino en wa-multi
18. [ ] El mensaje **NO** debería aparecer en el IA Inbox del panel
    (porque viene de cuenta del pool → filtrado en gateway)

### Test 5 — Ciclo completo de conversación

19. [ ] Verificar que la cuenta destino RECIBE el mensaje (en wa-multi window)
20. [ ] Esperar el delay de respuesta de la persona del receiver
21. [ ] Verificar que el LLM genera respuesta
22. [ ] El estado del par cicla: WAITING_REPLY_X → READY_X_TO_Y → WAITING_REPLY_Y
23. [ ] La lista "Últimos mensajes" del panel muestra ambos lados con
    persona names

### Test 6 — Stats y costos

24. [ ] Stats cards se actualizan: mensajes count incrementa, costo IA visible
25. [ ] Click "Refrescar" actualiza datos
26. [ ] Costo por intercambio en el rango esperado (~$0.0001-0.001 USD)

---

## Asunciones tomadas (corregibles post-deploy)

Listadas en PLAN.md sección "Asunciones". Si alguna no le cierra al usuario,
ajuste fácil:

- **A1** Pool inicial: solo cuentas SCM internas (cambio: nada, ya es así)
- **A2** Cross-setter only (cambio: editar `canPair()` en `pairing.js`)
- **A3** Filtro IA Inbox (cambio: ajustar `gateway.js` filter)
- **A4** Volumen 5-10 msgs/día (cambio: ajustar capacity max pares)
- **A5** Mercury primario (cambio: ya configurado vía env vars)
- **A6** Conversaciones casuales argentinas (cambio: editar prompts en `conversation.js`)
- **A7** Solo texto (cambio: post-MVP)
- **A8** JSON files (cambio: SQLite migration cuando >50 cuentas)
- **A9** Personas ficticias deterministas (cambio: ajustar pools en `persona-generator.js`)

---

## Riesgos abiertos

| Riesgo | Mitigación implementada | Pendiente |
|---|---|---|
| LLM genera contenido raro | 10 reglas estrictas en system prompt | Audit manual primeros días |
| Costo descontrolado | Tracking estimado por call + stats agregadas | Hard cap mensual con alert (post-deploy) |
| WA detecta patrón LLM | Variabilidad temporal + personas distintas + mensajes cortos | Monitor delivery rate + adjust |
| Setters confundidos por warming chats en su WA | Filtro IA Inbox + doc explica el flow | Doc para setters (post-deploy) |
| API key se filtra | env vars (Railway) | OK |
| Railway down → conversaciones paran | Estado persistido en JSON, reanudan al volver | OK |
| Pool inicial chico (<2 cuentas distinto setter) | Pairs no se crean, queda inactivo hasta sumar más | Doc: necesita 2+ setters |

---

## Commits ejecutados

| # | Wave | SHA | Mensaje |
|---|---|---|---|
| 1 | Plan | (incluido en W1) | PLAN.md |
| 2 | W1 | `<W1>` | feat(warming-network): schema + persona generator + persistencia |
| 3 | W2 | `<W2>` | feat(warming-network): pairing engine + scheduler + orchestrator |
| 4 | W3 | `<W3>` | feat(warming-network): LLM integration via Mercury/Qwen existente |
| 5 | W4-server | `<W4a>` | feat(warming-network): routes + boot + filtro IA Inbox |
| 6 | W4-client | `<W4b>` | feat(wa-multi): handler socket warming:send-message |
| 7 | W5 | `<W5>` | feat(panel): vista admin Red de Warming |

---

## Próximos pasos (post-Phase 2.3)

1. **Deploy a Railway** + smoke test manual del usuario
2. **Multimedia** en mensajes (post-MVP): imágenes, audios, stickers
3. **Network effect**: pool compartido entre múltiples agencias (futuro)
4. **Métricas avanzadas**: delivery rate per cuenta del pool, ban detection
   automática, pause auto si una cuenta cae bajo threshold
5. **UI para setter**: vista no-admin donde el setter ve solo sus cuentas
   inscritas (sin exponer las personas ficticias)

---

*Verificación cerrada el 2026-05-01 por la sesión de Claude que ejecutó
las 6 waves del PLAN.md de AI-to-AI Warming Network. Sin deadline, hecho
con disciplina GSD: discuss → plan → execute con commits atómicos.*

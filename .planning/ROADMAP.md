# SCM — Roadmap

> Versión GSD del roadmap. Source of truth narrativo: `../ROADMAP.md` (raíz
> del repo). Este archivo lo mapea a phases numeradas para que los skills
> `/gsd-*` puedan operar.
>
> Numeración: Bloque A=1, B=2, C=3, **C.5=3.5**, D=4, E=5.
> Última actualización: 2026-04-27 (bootstrap manual).

---

## Phase 1 — Bloque A: Cierre primera versión

**Goal:** Cerrar la v1 operativa: probar end-to-end con un setter real,
recolectar feedback, ajustar lo que rompa.

**Status:** En curso — depende mayormente de tareas humanas del usuario.

**Requirements mapped:** A-01, A-02, A-03, A-04

**Success criteria:**
1. `response-bank.json` poblado con contenido real (no placeholders)
2. Al menos un setter (Paula / Tiago / Evelio / Leandro) ha mandado 10-20
   mensajes reales con wa-multi v2 sin bloqueos críticos
3. IA Inbox capturó y clasificó al menos 3 inbounds reales con suggestion
   editable funcional
4. Lista de bugs/UX issues recolectada y triaged

**UI hint:** no (operativo + datos)

---

## Phase 2 — Bloque B: UX para setters

**Goal:** Reducir fricción operativa de los setters: ventana única
wa-multi, notificaciones de inbound, banco editable desde panel, métricas
útiles, inbox unificado.

**Status:** Pending. Bloqueado por completar Phase 1 (validación con setter
real).

**Depends on:** Phase 1

**Requirements mapped:** B-01, B-02, B-03, B-04, B-05

**Success criteria:**
1. wa-multi corre con un solo `BrowserWindow` y sidebar de cuentas
   (`<webview>` por cuenta), cap subido a 5
2. Send flow OS-level (`loadURL` + `sendInputEvent`) sigue funcionando
   sobre la `webContents` de la webview activa
3. Setter recibe notificación visible al recibir un inbound (badge rojo
   en sidebar + IA Inbox)
4. Admin puede CRUD el banco de respuestas desde el panel sin tocar JSON
5. Dashboard muestra enviados / respondieron / agendados en 24h y 7d por
   setter
6. Inbox unificado lista todas las conversaciones activas del setter

**UI hint:** yes (Electron + panel admin)

---

## Phase 3 — Bloque C: GHL-ready

**Goal:** Dejar la integración a GHL armada (sin destino) para que el día
que se decida integrar, sea cambiar una URL.

**Status:** Pending. Posterior a Phase 2.

**Depends on:** Phase 2 (estable) — no es estrictamente bloqueante pero
conviene no introducir cambios de schema mientras la UX se asienta.

**Requirements mapped:** C-01

**Success criteria:**
1. Pantalla admin para configurar URLs y suscripción a eventos
2. Eventos disparados con payloads schema-compatible GHL: `lead.created`,
   `message.sent`, `message.received`, `lead.status.changed`,
   `lead.replied`, `lead.qualified`
3. Payload incluye `firstName`, `lastName`, `phone`, `email`, `customFields`
4. Sin destino configurado por defecto (es opt-in del admin)
5. Test de webhook con endpoint dummy (`webhook.site` o similar) responde 2xx

**UI hint:** yes (pantalla admin)

---

## Phase 3.5 — Bloque C.5: Extensión Chrome "Pegar como humano"

**Goal:** Reemplazar el paste instantáneo en `web.whatsapp.com` por typing
humano caracter por caracter para evitar que WhatsApp detecte el patrón
de paste como tell de bot. Sirve a setters que NO usen wa-multi.

**Status:** Pending — CONTEXT.md ya capturado (`phases/03.5-pegar-como-humano/03.5-CONTEXT.md`).
Próximo paso: `/gsd-plan-phase 3.5`.

**Depends on:** ninguna phase de este roadmap. Operativamente requiere
un mini cambio en el panel SCM (botón "Copiar con marker") que se planea
como sub-tarea o phase mini coordinada.

**Requirements mapped:** C5-01, C5-02, C5-03, C5-04, C5-05, C5-06

**Success criteria:**
1. Extensión instalable en Chrome via drag-drop del .zip a
   `chrome://extensions/` (modo desarrollador)
2. En `web.whatsapp.com`, `Ctrl+Espacio` con clipboard que empieza con
   `__SCM_TYPE__:` tipea el contenido (sin el marker) caracter por
   caracter en el chat focuseado
3. `Ctrl+Espacio` sin marker muestra toast "Falta marker SCM" y no hace
   nada
4. Typing usa naturalismo máximo: delay random 50-150ms + pausas largas
   en puntuación + typos ocasionales con backspace + pausas de "pensar"
5. Mini badge flotante muestra progreso `Tipeando... X/Y`
6. Esc cancela; cualquier tecla manual pausa el typing
7. Botón "Copiar con marker" en panel SCM (al menos en `view-faqs` o
   variantes) copia al clipboard con `__SCM_TYPE__:` prefijado
8. Validado en al menos 1 setter mandando 5-10 mensajes reales con la
   extensión, sin que WA detecte patrón anómalo

**UI hint:** yes (mini badge en extensión + botón "Copiar" en panel)

**Canonical refs:**
- `phases/03.5-pegar-como-humano/03.5-CONTEXT.md` — decisiones
- `../C5-CONTEXT.md` — copia legacy en raíz (mismo contenido, anterior
  al bootstrap GSD)
- `../ROADMAP.md` líneas 155-171 — definición original del bloque

---

## Phase 4 — Bloque D: Mejora de IA (futuro)

**Goal:** Reemplazar plantillas estáticas del banco por respuestas IA
contextuales con master switch + modos progresivos.

**Status:** Pending — futuro, después de validar 2-3 meses de operación
real con plantillas.

**Depends on:** Phase 1 (datos reales para evaluar dónde la plantilla
falla)

**Requirements mapped:** D-01, D-02, D-03

**Success criteria:**
1. Settings expone master switch IA + modo (`log-only` / `suggest` /
   `auto-reply`) + horario laboral + provider + API key
2. Mode `log-only` registra sugerencias sin mostrarlas (modo evaluación)
3. Mode `suggest` reemplaza la sugerencia del banco cuando el match
   score es bajo
4. Mode `auto-reply` responde sola en intents seguros (saludo,
   descalificado) sin esperar al setter
5. Métricas: % de intervención humana antes vs después

**UI hint:** yes (Settings)

---

## Phase 6 — Telnyx Calls Foundation

**Goal:** Habilitar a setters y admin a llamar internacional desde el browser
(WebRTC) usando números virtuales de Telnyx con caller ID local según el
país destino. Cierra el loop de "leads sin WSP" que hoy quedan en limbo
porque los setters no usan sus celulares personales para llamar al
extranjero. Reusa el callLog/disposition existente — esto es la base de
infraestructura, no es Phase 5 (Llamadas IA con voz automatizada).

**Status:** Active — sprint de 2 días, 16 horas reales.

**Depends on:** módulo Llamadas (view-calls) existente, callLog/disposition
del Bloque A ya en producción.

**Requirements mapped:** F-01..F-07 (nuevos, agregar a REQUIREMENTS.md)

**Success criteria:**
1. Admin configura API key Telnyx + lista de números comprados con país
2. Botón "📞 Llamar" en cada lead de view-calls inicia llamada WebRTC
3. Panel de llamada activa muestra timer, botón mute, botón colgar
4. Caller ID saliente se elige automáticamente según país destino del lead
5. Al colgar, prompt de disposition se abre (reusa endpoint existente)
6. Stats reales: minutos consumidos hoy/mes, costo USD por setter y país
7. Script panel inline con value statement framework adaptado a dental
   (apertura, manejo de objeción "ya tengo sistema", doble apuesta sobre
   la reunión, NO sobre la solución)

**Out of scope (queda para Phase 5 Llamadas IA o futuras):**
- Grabación con storage en S3/disco
- Transcripción Whisper post-llamada
- Mercury IA en vivo durante la llamada
- Coaching dashboard avanzado
- Dialer predictivo / automation

**Constraints:**
- 16 horas reales de desarrollo total
- Distribuido en 2 días (deadline duro: plan de Claude se acaba)
- Costo target operativo: ~$35-55/mes (vs $90-140 de CloudTalk)

**UI hint:** yes (botón + panel de llamada activa + métricas + script panel)

---

## Phase 7 — Motor de Campañas Drip WhatsApp

**Goal:** Replicar en SCM el workflow de campañas de Go High Level:
outbound masivo por WhatsApp configurable por campaña, con drip pacing,
mensajes en bloques con delays humanos, bumps automáticos si no hay
respuesta, y cancelación al recibir reply. Es la base sobre la que la
fase siguiente monta el handoff a Mercury IA (Phase 4 / Bloque D).

**Status:** Pending — añadida 2026-06-10. Próximo paso: `/gsd-plan-phase 7`.

**Depends on:** ninguna bloqueante. Reusa infra ya en producción:
scheduler de `scheduled_messages` (tick 60s + stagger anti-ban +
`followup:send-message` → wa-multi `sendMessageInWindow`), variantes
con bloques, `wa_accounts.json` (fase de warming), gateway socket.io
(`ai-classified-inbound` para detección de respuesta). El handoff a
Mercury queda EXCLUIDO de esta fase (es Phase 4).

**Configuración por campaña (nada hardcodeado — espíritu GHL):**
- Cuenta(s) WhatsApp de salida (una o varias con distribución)
- Selección de leads: filtro país / setter / estado / cantidad
- Split de variantes con pesos (reusa variantes con bloques)
- Ritmo drip: `batchSize` cada `intervalMinutes` (ej. "1 cada 5 min",
  "3 cada 10")
- Ventana horaria + días de la semana
- Delays random entre bloques del mensaje (rango min–max)
- Steps de bump: lista `{tras X horas sin respuesta, texto}` (ej.
  24h / 48h / 72h)
- Caps diarios por cuenta + respeto de la fase de warming
- Controles en vivo: pausar / reanudar / cancelar

**Máquina de estados por lead:**
```
encolado → opener enviado (bloques con delays) → esperando respuesta
   ├─ respondió → mensaje de calificación → respondió → marcado para
   │   el setter (acá termina esta fase; Phase 4 enchufa Mercury)
   ├─ sin respuesta → bump 1 → bump 2 → … → fin sin respuesta
   └─ intent descalificado → descartado, frena todo
```

**Data:** `wa_campaigns.json` nuevo (campañas + estado por lead).
Incluirlo en `/api/admin/export-data` y `pre-deploy` (regla #21 de
CLAUDE.md — sin esto un redeploy pierde las campañas).

**Success criteria:**
1. Admin crea una campaña desde el panel eligiendo cuenta, leads,
   variantes, drip, ventana, bumps — y la lanza
2. Los mensajes salen al ritmo configurado, en bloques separados con
   delays random, solo dentro de la ventana horaria
3. Si el lead responde, los bumps pendientes se cancelan
   automáticamente y avanza al mensaje de calificación
4. Si no responde, los bumps salen a las horas configuradas
5. Pausar la campaña frena los envíos en <60s; reanudar los retoma
6. Caps por cuenta respetados (una cuenta en warming no excede su fase)
7. Vista de campaña muestra progreso y stats por variante
8. `wa_campaigns.json` sobrevive un redeploy (export + pre-deploy)

**UI hint:** yes (vista nueva "Campañas" en el panel: builder + lista
con progreso + controles pausar/reanudar/cancelar)

---

## Phase 5 — Bloque E: Llamadas con IA (futuro lejano)

**Goal:** Llamar a leads que respondieron pero no avanzaron por chat,
calificar y agendar via IA voice (Vapi / Bland / Retell), pasar leads
calientes al setter humano.

**Status:** Pending — futuro lejano. No definido provider ni costos.

**Depends on:** Phase 4 (IA estable en chat antes de llevarla a voz)

**Requirements mapped:** E-01, E-02

**Success criteria:**
1. Integración con un provider voice IA (TBD)
2. Lead clasificado como "respondió pero no avanza" dispara llamada
   automática
3. La IA califica/agenda en la llamada y registra el outcome en el panel
4. Lead caliente (interesado_quiere_agendar) se devuelve al setter
   humano para cierre
5. Costo por lead procesado documentado y sostenible

**UI hint:** yes (vista de llamadas IA en panel)

---

## Coverage check

Todos los requirements en `REQUIREMENTS.md` están mapeados a una phase:

| REQ-IDs | Phase |
|---------|-------|
| WAM-*, PNL-* | Validated (no phase, ya en producción) |
| A-01..A-04 | 1 |
| B-01..B-05 | 2 |
| C-01 | 3 |
| C5-01..C5-06 | 3.5 |
| D-01..D-03 | 4 |
| E-01..E-02 | 5 |

✓ 100% cobertura.

---

*Last updated: 2026-04-27 — bootstrap manual.*

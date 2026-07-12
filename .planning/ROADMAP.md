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

## Phase 8 — Anti-detección wa-multi: Proxy + Fingerprint por cuenta

**Goal:** Agregar PROXY opt-in por cuenta de WhatsApp en wa-multi y
completar el fingerprint existente para que sea coherente con ese proxy
(timezone/idioma/UA). Infraestructura anti-baneo sobre la que Phase 7
(campañas a volumen) se apoya.

**NOTA (2026-06-10): el fingerprint base YA EXISTE** — se construyó en
Warming-Lunes (`out/preload/whatsapp.js`, falsea WebGL/Canvas/Audio/
cores/RAM/Chrome por seed determinista). Esta fase NO lo reconstruye.
Lo que falta y construye esta fase: (1) proxy por cuenta opt-in, (2)
timezone+locale coherentes SOLO cuando hay proxy, (3) UA variable por
seed. Ver 08-CONTEXT.md para el detalle del gap real.

**Status:** Pending — añadida 2026-06-10. Próximo paso: `/gsd-plan-phase 8`.

**Depends on:** ninguna bloqueante. Construye sobre el modelo de
partición persistente por cuenta que wa-multi YA usa
(`persist:acc-{id}` en out/main/index.js). Phase 7 debería respetar
esta fase (no mandar volumen por cuentas sin proxy asignado).

**Referencia clave:** `tmp/app_source/` (gitignored) contiene WAWarmer
1.1.2 extraído — herramienta comercial de warmeo WA con proxy +
fingerprint ya probados contra WhatsApp Web. NO copiar tal cual; tomar
el modelo:
- Proxy: `session.fromPartition(p).setProxy({proxyRules:"http=h:p;https=h:p;socks5=h:p"})` + reload del webview. NATIVO de Electron, no requiere libs. (WAWarmer embebe V2Ray para vmess/vless/ss — EXCLUIDO, los proxies residenciales que se compran son HTTP/SOCKS5 normales.)
- Fingerprint: seed numérico por cuenta → PRNG determinista (LCG) que perturba canvas/webgl/audio/navigator/dom de forma CONSISTENTE (mismo seed = mismo "dispositivo" siempre). Inyectado como preload scripts con plantillas `{{*_seed}}`. Template completo en `tmp/app_source/dist/electron/static/fingerprint-template/`.

**Decisiones de diseño:**
- Config por cuenta en `wa_accounts.json`:
  `proxy:{type,host,port,user,pass}`, `fingerprintSeed`,
  `geo:{timezone,locale,country}`. Editable desde la card de la cuenta
  en el panel admin.
- **Coherencia geo↔proxy es el criterio central**: timezone + locale +
  UA deben matchear el país del proxy. IP mexicana → America/Mexico_City
  + es-MX. El mismatch delata MÁS que no tener proxy.
- Proxy con auth user:pass: requiere handler `app.on('login')` en el
  main (gotcha de Electron — `setProxy` solo no pasa credenciales).
- Secrets de proxy (user:pass) NO viajan al frontend en claro innecesa-
  riamente; seguir el patrón env>JSON donde aplique. Evaluar en el plan.
- Test de proxy: botón "Probar" que abre la partición y verifica IP
  saliente (ej. fetch a un echo-IP) antes de asignar la cuenta.

**Success criteria:**
1. Admin asigna un proxy (HTTP o SOCKS5, con o sin auth) a una cuenta
   desde el panel y la cuenta sale por esa IP (verificable)
2. Cada cuenta tiene un fingerprintSeed estable; reabrir la cuenta da
   el MISMO fingerprint (canvas/webgl/audio/navigator coherentes)
3. Timezone + locale + UA de la sesión matchean el país configurado
4. Proxy caído → la cuenta no abre con la IP real (fail-safe, avisa al
   user en vez de filtrar la IP local)
5. Cuentas sin proxy siguen funcionando (proxy es opt-in por cuenta)
6. Phase 7 respeta el flag: campaña no encola volumen por cuenta sin
   proxy si el admin activó esa política

**UI hint:** yes (sección Proxy + Fingerprint en la card de cada cuenta
WA + botón "Probar proxy")

---

## Phase 18 — Supervisor restringido + panel de rendimiento SDR

**Goal:** Un usuario supervisor con visibilidad LIMITADA a un subconjunto
configurable de setters (Judith Mendez, Roxana Cabaleiro, Nadine
Tortonese), que NO puede ver nada de setter_ignacio ni
setter_paula_kroff (métricas, leads, llamadas, transcripciones,
dropdowns, comparativas). Home del supervisor = panel de rendimiento pro
con las 3 SDRs.

**Status:** Planned — 2026-07-12. 3 plans (2 waves). Próximo paso: `/gsd-execute-phase 18`.

**Plans:** 3 plans
- [ ] 18-01-PLAN.md — Scoping server-side (helpers + audit de endpoints + auth plumbing de visibleSetterIds) [wave 1]
- [ ] 18-02-PLAN.md — tests/supervisor-scope.test.js (scoping, regresión, gestión admin) [wave 2]
- [ ] 18-03-PLAN.md — Frontend (editor de setters visibles, home scoped en view-team, hide de sidebar, cache-buster) [wave 2]

**Depends on:** nada bloqueante. Extiende el RBAC existente
(`requireRole`/`getEffectiveAuth` en index.js) y los endpoints de
métricas ya construidos (team-performance, cold-call-metrics, telnyx
metrics, training/calls).

**Decisiones de diseño:**
- Campo `visibleSetterIds[]` en el user record (`auth.json`). Vacío o
  ausente = supervisor ve todo (comportamiento actual intacto, cero
  regresión para Paula). Con valores = scoping server-side.
- El filtro se aplica en BACKEND (RBAC real), no solo en UI: auditar
  todos los endpoints que supervisor puede tocar hoy y filtrar por la
  lista de setters visibles.
- Admin gestiona `visibleSetterIds` desde el Centro de Comando al
  crear/editar usuarios.
- El usuario supervisor real se crea vía el flujo de invitación
  existente.

**Success criteria:**
1. Supervisor scoped NO recibe data de setters fuera de su lista en
   NINGÚN endpoint (verificado con tests estilo training-privacy)
2. Supervisor sin `visibleSetterIds` sigue viendo todo (sin regresión)
3. Home del supervisor scoped = panel de rendimiento (llamadas/día,
   connects, conversaciones, agendas, deals, tendencias, alertas,
   comparativa entre sus SDRs)
4. Admin puede editar la lista de setters visibles desde el panel
5. Tests verdes siguiendo el patrón del repo

**UI hint:** yes (panel de rendimiento del supervisor + editor de
visibilidad en Centro de Comando)

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

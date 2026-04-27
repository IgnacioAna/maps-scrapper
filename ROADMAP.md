# SCM — Roadmap del sistema interno

> Documento vivo. Decisiones estratégicas + estado actual + próximos pasos.
> Ultima actualización: 26 abril 2026

---

## Contexto y decisión estratégica

### El stack que tenemos

**SCM (la agencia)** opera dos sistemas distintos:

1. **GoHighLevel** → para los **clientes** (clínicas dentales)
   - Cada clínica tiene su subaccount
   - Workflows de pacientes, calendar booking, email/SMS automation
   - Esto seguimos usándolo. Sin cambios.

2. **GoogleSrapper + wa-multi** → para **SCM internal**
   - Lo que usan los **setters de SCM** para prospectar nuevas clínicas
   - Cold outreach masivo por WhatsApp
   - Multi-cuenta, warming engine, captura de respuestas con IA classifier

### Por qué NO usamos GHL para SCM internal

Discusión: 26 abril 2026.

- El modelo de prospección de SCM es **100% cold WhatsApp**. No hay inbound
  forms, no hay email nurturing, no hay funnels de pago en este flujo.
- GHL es excelente en CRM warm pero **caro y restrictivo para cold outreach
  masivo de WhatsApp**. Requiere provider externo (~$50/mes/línea × N setters
  × M cuentas = costo significativo).
- Setters operativos = baja necesidad de CRM features avanzadas. Su flujo
  es: ver leads → mandar mensaje → marcar respuesta. Una herramienta simple
  hecha para ese flujo gana en productividad vs aprender GHL.
- wa-multi + panel custom = $0 de costo extra (solo el Railway que ya
  pagamos), control total del código, multi-cuenta nativo, sin lock-in.

### "GHL-ready" para el futuro

No usamos GHL hoy, pero **dejamos puertas abiertas** para integrar mañana:

- Schema de datos compatible (`name`, `phone`, `email`, `city`, etc.)
  mapean directo a contacts de GHL.
- Pendiente: módulo de **webhooks outbound** que emita eventos
  (`lead.created`, `message.sent`, `message.received`, `lead.replied`,
  `lead.qualified`) a una URL configurable. Día 1 sin destino, día N apuntás
  a GHL y los leads empiezan a fluir.
- No re-implementamos features donde GHL gana (calendar booking complejo,
  email sequences, pipelines profundos). Si en algún momento las
  necesitamos, las consumimos de GHL.

---

## Estado actual del sistema (qué funciona hoy)

### wa-multi (desktop Electron)

- ✅ Multi-cuenta (3 max concurrent — config bumpeable)
- ✅ Send confiable: `loadURL(wa.me/PHONE)` + OS-level mouse/keyboard
  (sendInputEvent) → evita detección de bot
- ✅ Cap diario 80/cuenta con contador persistido
- ✅ Cola serializada por cuenta (no se pisan envios paralelos)
- ✅ Auto-kill electron zombies en npm run (predev/prebuild/predist)
- ✅ Detección de inbound: nombre, teléfono, texto del último mensaje
- ✅ Classifier rule-based en 9 intents (saludo, pregunta_info,
  pregunta_precio, objecion_caro, objecion_ya_tengo, interesado_quiere_info,
  interesado_quiere_agendar, descalificado, off_topic_o_ruido)
- ✅ Persistencia de conversaciones en `userData/conversations.json`
- ✅ Banco de respuestas template editable
- ✅ Build portable distribuible: `release/wa-multi-portable-v2.zip` (145MB)

### GoogleSrapper / panel Railway

- ✅ Auth multi-rol (admin / setter)
- ✅ Scraper Google Maps
- ✅ Setteo / asignación de leads por setter
- ✅ Stats por setter
- ✅ Modal de campaña con números + mensajes que rotan
- ✅ Normalización de teléfonos por prefijo internacional
- ✅ Tests vitest+supertest passing
- ✅ **IA Inbox**: vista que muestra mensajes inbound clasificados con
  sugerencia editable + acciones (Enviar / Ignorar)
- ✅ Filtros: todos / requieren humano / auto / leads calientes
- ✅ Refresh automático cada 30s

---

## Pendiente — ordenado por prioridad

### Bloque A — Cerrar primera versión (esta semana)

1. **[USUARIO]** Llenar `response-bank.json` con contenido real de SCM:
   - Elevator pitch y diferenciador
   - 5-7 objeciones comunes con sus respuestas
   - Qué NUNCA decir (precios sin calificar, garantías, etc.)
   - Modalidad de servicio + rangos de precio
2. **Probar end-to-end** con vos como tester (mandar mensajes a tu propio
   número de prueba, verificar que el IA Inbox lo capture y clasifique bien)
3. **Onboarding de un setter** real (Paula / Tiago / Evelio / Leandro):
   instalar wa-multi v2 en su PC, escanear QR, mandar 10-20 mensajes reales
4. Recolectar feedback de ese día y ajustar lo que rompa

### Bloque B — UX para setters (próxima semana)

5. **REFACTOR ARQUITECTURA: ventana única con sidebar de cuentas**
   (priority alta — pedido directo del usuario)
   - Hoy: cada cuenta = `BrowserWindow` separada → setter tiene 3-5 ventanas
     dispersas en el escritorio, dolor de Alt+Tab.
   - Cambio: un solo `BrowserWindow` principal con UI custom + cada cuenta
     embebida como `<webview>` (tag HTML) o `WebContentsView`.
   - Layout objetivo (estilo WAWarmer):
     ```
     ┌──────────────────────────────────────────────────┐
     │ wa-multi                              [_][□][X]  │
     ├──────────┬───────────────────────────────────────┤
     │ Cuentas  │                                       │
     │ ● Paula  │     [WhatsApp Web de la activa]      │
     │ ○ Tiago  │                                       │
     │ ○ Léo    │                                       │
     │ + Nueva  │                                       │
     └──────────┴───────────────────────────────────────┘
     ```
   - Sidebar muestra cada cuenta con: avatar, label, indicador de estado
     (verde conectado / amarillo QR / rojo bann), badge de mensajes
     no leidos.
   - Click cambia cual webview esta visible (las otras quedan cargadas en
     background, warmings/respuestas siguen entrando).
   - Subir cap a 5 cuentas concurrentes.
   - Referencia visual analizada: WAWarmer 1.1.2 (Vue 2 + element-ui +
     `<webview>` con partition por cuenta). Confirmado en
     `dist/electron/renderer/pages/main/*.js` del app.asar.
   - **El send flow OS-level (loadURL + sendInputEvent) se preserva**:
     se aplica sobre la `webContents` de la webview activa en vez de la
     ventana de cuenta.
6. **Notificación visual** en el panel + en wa-multi cuando entra una
   respuesta nueva (badge rojo en sidebar de cuenta + en menú IA Inbox)
7. **Banco de respuestas editable desde panel** (no tener que tocar JSON):
   tabla CRUD por intent, con preview
8. **Métricas por setter** en dashboard: enviados / respondieron / agendados
   en últimas 24h y 7d
9. **Inbox unificado por setter**: ver TODAS sus conversaciones activas
   (no solo respuestas pendientes)

### Bloque C — GHL-ready (cuando A y B estén estables)

9. **Webhooks outbound** desde el panel:
   - Pantalla admin para configurar URLs y eventos
   - Eventos disparados: `lead.created`, `message.sent`, `message.received`,
     `lead.status.changed`, `lead.replied`, `lead.qualified`
   - Payloads con schema compatible GHL (firstName, lastName, phone, email,
     customFields)
   - Hoy sin destino. El día que se decida integrar GHL, se le pega la URL.

### Bloque C.5 — Extensión Chrome "Pegar como humano"

10. **Chrome extension** que reemplaza el paste en `web.whatsapp.com` por
    typing humano caracter por caracter (delay 50-150ms aleatorio).
    - Hotkey: Ctrl+Shift+V (o reemplazar Ctrl+V opcionalmente)
    - Lee del clipboard normal del SO
    - Tipea en el input focuseado del chat actual
    - Bonus: el panel SCM puede prefijar el texto copiado con un marker
      invisible (`__SCM_TYPE__:`); la extension solo activa el typing humano
      cuando ve ese marker. Cualquier otro paste normal funciona como Ctrl+V.
    - Ventaja: sirve **incluso para setters que NO usen wa-multi** y prefieran
      WA Web directo en Chrome. Cero fricción de instalacion (~10s drag and
      drop a chrome://extensions/).
    - Esfuerzo: 2-3 horas de codigo + 1 hora de testing.
    - Idea original del usuario (27 abril 2026) — observo que el paste
      instantaneo es uno de los tells mas fuertes para WA. Esta extension lo
      mata.

### Bloque D — Mejora de IA (futuro, opcional)

10. **Conectar Claude API o GPT-4o-mini** para generar respuestas
    contextuales (en vez de plantillas estáticas del banco)
11. Settings: master switch IA (`enabled`), modo (`log-only` / `suggest` /
    `auto-reply`), horario laboral (default 10-19h), provider, API key
12. Mode `auto-reply` para intents seguros (saludo, descalificado): la IA
    responde sola sin esperar al setter

### Bloque E — Llamadas con IA (futuro lejano)

13. Integración con Vapi / Bland / Retell para llamar leads que respondieron
    pero no avanzaron por chat
14. Mismo principio: la IA llama, califica, agenda — y le pasa el lead
    caliente al setter humano para cerrar

---

## Notas operativas importantes

### Para distribuir wa-multi a setters

1. Pasarles el `wa-multi-portable-v2.zip` (145MB)
2. Que descompriman donde quieran (no requiere instalación, es portable)
3. Doble-click en `wa-multi.exe`
4. Avast/Defender pueden alertar la primera vez (binario sin firma) →
   agregar excepción
5. Cuando la app abra, hacen login con sus credenciales del panel
6. Cada setter conecta sus WhatsApps escaneando QR — la sesión persiste
   entre reinicios

### Mientras esté enviando mensajes

- **No tocar el mouse durante una campaña** (los OS-level events necesitan
  el cursor libre — si lo movés, los clicks pueden caer en lugares
  distintos)
- La ventana de WhatsApp se trae al frente automáticamente en cada send.
  Cuando termina la campaña, vuelve atrás.
- Cap diario: 80 mensajes por cuenta. Después de eso bloquea hasta el
  día siguiente. Si tenés 3 cuentas → 240 msgs/día.

### Anti-friction principles (no romper esto)

1. **Setters NO necesitan saber GHL** ni ninguna otra herramienta. Solo
   el panel + wa-multi.
2. **Panel y wa-multi tienen que ser obvios** sin entrenamiento. Si algo
   requiere instructivo, es señal de mala UX.
3. **Cero passwords/API keys que el setter tenga que recordar** — todo
   se configura una vez por el admin (vos).

---

## Cómo retomar este documento

Si pasa tiempo y querés saber dónde estamos: leer este archivo. Está en
`GoogleSrapper/ROADMAP.md`. Cualquier decisión estratégica nueva se agrega
acá con fecha.

---

## Setup de herramientas para evitar "las 3 horas dándole vueltas"

**GSD (Get Shit Done) instalado el 27 abril 2026** en `~/.claude/` global.

Skills `/gsd-*` disponibles en todas las sesiones de Claude Code:
- `/gsd-resume-work` — retomar sesión anterior con contexto restaurado
- `/gsd-discuss-phase` — preguntas adaptativas antes de planear (cero asunciones)
- `/gsd-plan-phase` — plan detallado verificable
- `/gsd-execute-phase` — ejecucion con sub-agents + commits atomicos
- `/gsd-verify-work` — UAT conversacional
- `/gsd-debug` — debugging sistematico que persiste entre context resets
- `/gsd-do "<lo que quiero>"` — auto-routing a skill correcta

**Hooks activos** (todas las sesiones):
- Read-before-edit guard
- Prompt injection guard
- Context window monitor
- Workflow guard

**Por qué importa**: este workflow obliga a discutir/planear ANTES de codear,
con preguntas adaptativas. Resuelve el problema de "no nos entendíamos al
toque" y de "perder contexto cuando se llena la conversacion".

**Para los próximos bloques (B/C/D del roadmap)**: arrancar con
`/gsd-discuss-phase` describiendo el problema → revisar las preguntas que
GSD haga → confirmar el plan → ejecutar con `/gsd-execute-phase`.

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

5. **Notificación visual** en el panel cuando entra una respuesta nueva
   (badge rojo en el menú IA Inbox + sonido opcional)
6. **Banco de respuestas editable desde panel** (no tener que tocar JSON):
   tabla CRUD por intent, con preview
7. **Métricas por setter** en dashboard: enviados / respondieron / agendados
   en últimas 24h y 7d
8. **Inbox unificado por setter**: ver TODAS sus conversaciones activas
   (no solo respuestas pendientes)

### Bloque C — GHL-ready (cuando A y B estén estables)

9. **Webhooks outbound** desde el panel:
   - Pantalla admin para configurar URLs y eventos
   - Eventos disparados: `lead.created`, `message.sent`, `message.received`,
     `lead.status.changed`, `lead.replied`, `lead.qualified`
   - Payloads con schema compatible GHL (firstName, lastName, phone, email,
     customFields)
   - Hoy sin destino. El día que se decida integrar GHL, se le pega la URL.

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

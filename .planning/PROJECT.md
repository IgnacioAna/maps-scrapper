# SCM — Sistema interno de prospección WhatsApp

> Proyecto interno de la agencia SCM (clínicas dentales).
> Última actualización: 2026-04-27 (bootstrap GSD desde docs existentes).

---

## What This Is

**SCM** opera dos sistemas independientes:

1. **GoHighLevel (GHL)** — para los **clientes** (clínicas dentales). Workflows
   de pacientes, calendar booking, email/SMS. Sin cambios.
2. **GoogleSrapper + wa-multi** (este proyecto) — para **SCM internal**. Lo
   usan los setters de SCM para prospectar nuevas clínicas. Cold outreach
   masivo por WhatsApp, multi-cuenta, warming engine, captura de respuestas
   con IA classifier.

Este `.planning/` cubre el segundo sistema.

---

## Core Value

**Que los setters de SCM (Paula, Tiago, Evelio, Leandro) prospecten clínicas
dentales por WhatsApp con la mínima fricción operativa posible y sin que
WhatsApp los detecte como bots.**

Todo lo demás (CRM features, métricas, IA, GHL-readiness) es soporte de ese
core. Si una decisión rompe ese core, se rechaza.

---

## Context

### Por qué NO usamos GHL para SCM internal

- El modelo es **100% cold WhatsApp**. No hay inbound forms, ni email
  nurturing, ni funnels de pago.
- GHL es excelente en CRM warm pero **caro y restrictivo para cold outreach
  masivo de WhatsApp** (~$50/mes/línea con provider externo × N setters × M
  cuentas).
- Setters operativos = baja necesidad de CRM features avanzadas. Su flujo
  es: ver leads → mandar mensaje → marcar respuesta.
- wa-multi + panel custom = $0 extra (solo el Railway que ya pagamos),
  control total, multi-cuenta nativo, sin lock-in.

### "GHL-ready" para el futuro

No usamos GHL hoy, pero **dejamos puertas abiertas**:
- Schema de datos compatible (`name`, `phone`, `email`, `city`) mapean
  directo a contacts de GHL.
- Pendiente: módulo de **webhooks outbound** (Bloque C) que emita eventos
  a una URL configurable.
- No re-implementamos features donde GHL gana (calendar booking complejo,
  email sequences, pipelines profundos).

### Stack

- Node.js >= 20 + Express 5 (ESM)
- Persistencia JSON file-based (Railway Volume `/data`), sin DB
- SerpAPI (Google Maps), Apify (Instagram), OpenRouter Qwen + Mercury
  (IA con fallback)
- Socket.io 4.x (módulo WA en `src/wa/`)
- vitest + supertest
- Geist + Geist Mono (Design System v1.1)
- Electron desktop app `wa-multi` (separado, distribuible portable)

### Anti-friction principles (no romper)

1. Setters NO necesitan saber GHL ni ninguna otra herramienta. Solo el
   panel + wa-multi.
2. Panel y wa-multi tienen que ser obvios sin entrenamiento. Si requiere
   instructivo, es señal de mala UX.
3. Cero passwords/API keys que el setter tenga que recordar — todo se
   configura una vez por el admin.

---

## Requirements

### Validated (ya funciona en producción)

#### wa-multi (desktop Electron)

- ✓ **WAM-01** Multi-cuenta (3 max concurrent, bumpeable)
- ✓ **WAM-02** Send confiable: `loadURL(wa.me/PHONE)` + OS-level
  mouse/keyboard (sendInputEvent) → evita detección de bot
- ✓ **WAM-03** Cap diario 80/cuenta con contador persistido
- ✓ **WAM-04** Cola serializada por cuenta (no se pisan envíos paralelos)
- ✓ **WAM-05** Auto-kill electron zombies en npm run
- ✓ **WAM-06** Detección de inbound: nombre, teléfono, texto último mensaje
- ✓ **WAM-07** Classifier rule-based en 9 intents (saludo, pregunta_info,
  pregunta_precio, objecion_caro, objecion_ya_tengo, interesado_quiere_info,
  interesado_quiere_agendar, descalificado, off_topic_o_ruido)
- ✓ **WAM-08** Persistencia conversaciones en `userData/conversations.json`
- ✓ **WAM-09** Banco de respuestas template editable
- ✓ **WAM-10** Build portable distribuible (`wa-multi-portable-v2.zip`, 145MB)

#### GoogleSrapper / panel Railway

- ✓ **PNL-01** Auth multi-rol (admin / setter)
- ✓ **PNL-02** Scraper Google Maps (SerpAPI) con dedup estricta vs history
- ✓ **PNL-03** Setteo / asignación de leads por setter
- ✓ **PNL-04** Stats por setter
- ✓ **PNL-05** Modal de campaña con números + mensajes que rotan
- ✓ **PNL-06** Normalización de teléfonos por prefijo internacional
- ✓ **PNL-07** Tests vitest+supertest passing (66 tests)
- ✓ **PNL-08** **IA Inbox**: vista de mensajes inbound clasificados con
  sugerencia editable + acciones (Enviar / Ignorar)
- ✓ **PNL-09** Filtros: todos / requieren humano / auto / leads calientes
- ✓ **PNL-10** Refresh automático cada 30s
- ✓ **PNL-11** Pipeline cascada bidireccional (sin contactar → conexión
  enviada → respondió → calificado → interesado → agendado)
- ✓ **PNL-12** Banco de Respuestas con few-shot RAG (Mercury → Qwen
  fallback) + retrieval por cosine similarity
- ✓ **PNL-13** Centro de Entrenamiento con 8 módulos de onboarding + quizzes
- ✓ **PNL-14** Módulo WA Multi-Account (cuentas, rutinas warming, bulk
  commands) con curva default 5→400 msg/día en 15 días
- ✓ **PNL-15** Detección de ban → status `BANNED_TEMP` con cooldown 4 días
- ✓ **PNL-16** Presencia in-memory ("Quién está conectado")
- ✓ **PNL-17** Design System v1.1 (violeta `#9D85F2`, dark `#0F1115`, Geist)

### Active (en backlog, ordenado por bloque)

Ver `ROADMAP.md` para el desglose por fases.

#### Bloque A — Cierre primera versión
- [ ] **A-01** Llenar `response-bank.json` con contenido real SCM
- [ ] **A-02** Probar end-to-end con tester
- [ ] **A-03** Onboarding de un setter real (Paula / Tiago / Evelio / Leandro)
- [ ] **A-04** Recolectar feedback y ajustar

#### Bloque B — UX para setters
- [ ] **B-01** REFACTOR: ventana única wa-multi con sidebar de cuentas
  (estilo WAWarmer, `<webview>` por cuenta, subir cap a 5)
- [ ] **B-02** Notificación visual cuando entra inbound (badge en sidebar +
  IA Inbox)
- [ ] **B-03** Banco de respuestas editable desde panel (tabla CRUD por
  intent, con preview)
- [ ] **B-04** Métricas por setter en dashboard (24h y 7d)
- [ ] **B-05** Inbox unificado por setter (todas sus conversaciones, no
  solo respuestas pendientes)

#### Bloque C — GHL-ready
- [ ] **C-01** Webhooks outbound desde el panel: pantalla admin para URLs
  + eventos (`lead.created`, `message.sent`, `message.received`,
  `lead.status.changed`, `lead.replied`, `lead.qualified`) con payload
  schema-compatible GHL

#### Bloque C.5 — Extensión Chrome "Pegar como humano"
- [ ] **C5-01** Extensión MV3 que reemplaza paste en `web.whatsapp.com` por
  typing humano (delay random 50-150ms + pausas en puntuación + typos
  ocasionales + pausas de "pensar")
- [ ] **C5-02** Hotkey `Ctrl+Espacio` con marker `__SCM_TYPE__:` obligatorio
- [ ] **C5-03** Botón "Copiar con marker" en el panel SCM (mini cambio
  coordinado, dependencia)
- [ ] **C5-04** Distribución vía ZIP unpacked (drag-drop a chrome://extensions/)

#### Bloque D — Mejora de IA
- [ ] **D-01** Conectar Claude API o GPT-4o-mini para generar respuestas
  contextuales (en vez de plantillas estáticas)
- [ ] **D-02** Settings: master switch IA (`enabled`), modo (`log-only` /
  `suggest` / `auto-reply`), horario laboral, provider, API key
- [ ] **D-03** Mode `auto-reply` para intents seguros (saludo,
  descalificado): IA responde sola

#### Bloque E — Llamadas con IA (futuro lejano)
- [ ] **E-01** Integración con Vapi / Bland / Retell para llamar leads que
  respondieron pero no avanzaron por chat
- [ ] **E-02** Mismo principio: IA llama, califica, agenda → pasa el lead
  caliente al setter humano

### Out of Scope

- **Replicar features de GHL** (calendar booking complejo, email sequences,
  pipelines profundos) — si las necesitamos, se consumen de GHL via
  webhooks outbound (Bloque C).
- **Inbound forms / landing pages para captura de leads** — el modelo es
  100% cold outbound, no warm inbound.
- **Pago / checkout integrado** — el cierre comercial es humano fuera del
  sistema.
- **CRM avanzado para los clientes (las clínicas)** — eso lo hace GHL en
  los subaccounts de cada cliente.
- **Soporte multi-tenant para otras agencias** — sistema interno de SCM
  exclusivamente.

---

## Key Decisions

| Decisión | Rationale | Outcome |
|----------|-----------|---------|
| Stack JSON file-based en Railway Volume, sin DB | Velocidad de iteración, costo $0 extra, footprint simple | ✓ En producción, performante para volumen actual |
| Send WA via Electron OS-level (sendInputEvent) | Evita detección de bot vs web automation | ✓ wa-multi v2 estable |
| IA Banco de Respuestas con few-shot RAG (Mercury→Qwen) | Retrieval barato + fallback redundante; no requiere fine-tune | ✓ En producción |
| Cap diario 80/cuenta + curva warming 5→400 en 15 días | Balance throughput vs ban risk validado empíricamente | ✓ Default operativo |
| Auth dual (cookie session + JWT Bearer) | Cookie para browser, JWT para wa-multi desktop | ✓ Funcionando, no mezclar |
| Bloque C.5 separado de wa-multi | Sirve a setters que NO quieren instalar Electron — ataca el mismo problema (paste como tell de bot) desde el otro frente | Pendiente — Phase 3.5 |
| Bloque B refactor wa-multi a `<webview>` único | Hoy: 3-5 ventanas Electron sueltas = dolor Alt+Tab. Referencia visual: WAWarmer 1.1.2 | Pendiente — Phase 2 |

---

## Evolution

Este documento evoluciona en transiciones de phase y boundaries de milestone.

**Después de cada phase transition:**
1. Requirements invalidados → mover a Out of Scope con razón
2. Requirements validados → mover a Validated con phase reference
3. Requirements nuevos emergentes → agregar a Active
4. Decisiones nuevas → log en Key Decisions
5. "What This Is" sigue accurate? Update si drifteó

**Después de cada milestone (`/gsd-complete-milestone`):**
1. Review completo de todas las secciones
2. Core Value check — sigue siendo la prioridad correcta?
3. Audit Out of Scope — razones siguen válidas?
4. Update Context con estado actual

---

## Notas operativas

### Para distribuir wa-multi a setters
1. Pasarles el `wa-multi-portable-v2.zip` (145MB)
2. Que descompriman donde quieran (es portable, no requiere instalación)
3. Doble-click en `wa-multi.exe`
4. Avast/Defender pueden alertar la primera vez (binario sin firma) →
   agregar excepción
5. Login con credenciales del panel
6. Cada setter conecta sus WhatsApps escaneando QR — sesión persiste
   entre reinicios

### Mientras esté enviando mensajes
- **No tocar el mouse durante una campaña** (los OS-level events necesitan
  el cursor libre)
- La ventana de WhatsApp se trae al frente automáticamente en cada send;
  cuando termina, vuelve atrás
- Cap diario: 80 mensajes por cuenta. Después bloquea hasta el día siguiente

### Antes de cada deploy
```bash
npm run pre-deploy   # descarga data actual de Railway, evita perder leads
git add data/
git commit -m "backup data"
git push origin main && git push origin main:master
```

---

*Last updated: 2026-04-27 — bootstrap manual a `.planning/` desde
`ROADMAP.md`, `MANUAL-ADMIN.md`, `MANUAL-SETTER.md`, `CLAUDE.md`. No se
modificó código ni docs originales.*

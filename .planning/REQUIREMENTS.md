# SCM — Requirements

> Bootstrap manual desde docs existentes (2026-04-27).
> Source of truth para el contenido detallado: `PROJECT.md` (sección
> Requirements) — este archivo es el índice trazable phase ↔ REQ.

---

## v1 Requirements

### Validated (en producción)

Ver `PROJECT.md` → Requirements → Validated. Bloques `WAM-*` (wa-multi)
y `PNL-*` (panel Railway) cubren el sistema operativo actual.

### Active — Bloque A (cierre primera versión)

- [ ] **A-01** Llenar `response-bank.json` con contenido real SCM (elevator
  pitch, 5-7 objeciones comunes, qué nunca decir, modalidad + rangos de
  precio)
- [ ] **A-02** Probar end-to-end con tester (mensajes reales → IA Inbox
  los captura y clasifica)
- [ ] **A-03** Onboarding de un setter real (instalar wa-multi v2, escanear
  QR, mandar 10-20 mensajes reales)
- [ ] **A-04** Recolectar feedback del primer día de uso real y ajustar
  lo que rompa

### Active — Bloque B (UX para setters)

- [ ] **B-01** Refactor wa-multi: ventana única con sidebar de cuentas,
  cada cuenta como `<webview>`, layout estilo WAWarmer 1.1.2, subir cap
  a 5 cuentas concurrentes, preservar send flow OS-level
- [ ] **B-02** Notificación visual de inbound (badge rojo en sidebar de
  cuenta + en menú IA Inbox)
- [ ] **B-03** Banco de respuestas editable desde panel (tabla CRUD por
  intent, con preview, sin tener que tocar JSON)
- [ ] **B-04** Métricas por setter en dashboard (enviados / respondieron /
  agendados en últimas 24h y 7d)
- [ ] **B-05** Inbox unificado por setter (todas sus conversaciones
  activas, no solo respuestas pendientes)

### Active — Bloque C (GHL-ready)

- [ ] **C-01** Webhooks outbound desde el panel:
  - Pantalla admin para configurar URLs y eventos
  - Eventos: `lead.created`, `message.sent`, `message.received`,
    `lead.status.changed`, `lead.replied`, `lead.qualified`
  - Payload schema-compatible GHL (firstName, lastName, phone, email,
    customFields)
  - Hoy sin destino — el día que se decida integrar GHL, se le pega la URL

### Active — Bloque C.5 (extensión Chrome "Pegar como humano")

- [ ] **C5-01** Extensión Chrome MV3 que reemplaza paste en
  `web.whatsapp.com` por typing humano
  - Naturalismo máximo: delay random 50-150ms + pausas en puntuación +
    typos ocasionales con backspace + pausas de "pensar"
  - Trade-off conocido: mensaje de 200 chars puede tardar 30-40s
- [ ] **C5-02** Hotkey `Ctrl+Espacio` con marker `__SCM_TYPE__:` obligatorio
  - Sin marker → toast "Falta marker SCM" y abortar
  - Ctrl+V nativo se preserva intacto
- [ ] **C5-03** Botón "Copiar con marker" en panel SCM (dependencia
  bloqueante para uso real, mini cambio en `view-faqs` y/o variantes)
- [ ] **C5-04** Distribución vía ZIP unpacked (drag-drop a
  chrome://extensions/, no Web Store)
- [ ] **C5-05** UI: mini badge flotante con progreso (`Tipeando... X/Y`)
- [ ] **C5-06** Cancelación: Esc cancela + cualquier tecla pausa la
  extensión (no pisa lo que el setter empieza a escribir manualmente)

### Active — Bloque D (mejora de IA, futuro)

- [ ] **D-01** Conectar Claude API o GPT-4o-mini para respuestas
  contextuales (reemplaza plantillas estáticas del banco para los casos
  donde el matching no alcanza)
- [ ] **D-02** Settings: master switch IA (`enabled`), modo (`log-only` /
  `suggest` / `auto-reply`), horario laboral (default 10-19h), provider,
  API key
- [ ] **D-03** Mode `auto-reply` para intents seguros (saludo,
  descalificado): IA responde sin esperar al setter

### Active — Bloque E (llamadas con IA, futuro lejano)

- [ ] **E-01** Integración con Vapi / Bland / Retell para llamar leads
  que respondieron pero no avanzaron por chat
- [ ] **E-02** Pipeline: IA llama, califica, agenda → pasa lead caliente
  al setter humano para cerrar

---

## Out of Scope

- Replicar features de GHL (calendar, email sequences, pipelines complejos)
  → consumir de GHL vía webhooks (C-01) si se necesita
- Inbound forms / landing pages → modelo 100% cold outbound
- Pago / checkout → cierre comercial humano fuera del sistema
- CRM avanzado para clínicas clientes → eso lo hace GHL en los subaccounts
- Multi-tenant para otras agencias → sistema interno SCM exclusivo

---

## Traceability

| Phase | Requirements | Status |
|-------|--------------|--------|
| 1 (Bloque A) | A-01..A-04 | Active — depende del usuario |
| 2 (Bloque B) | B-01..B-05 | Active |
| 3 (Bloque C) | C-01 | Active |
| 3.5 (Bloque C.5) | C5-01..C5-06 | Active — CONTEXT.md ya capturado |
| 4 (Bloque D) | D-01..D-03 | Active — futuro |
| 5 (Bloque E) | E-01..E-02 | Active — futuro lejano |

---

*Last updated: 2026-04-27 — bootstrap GSD.*

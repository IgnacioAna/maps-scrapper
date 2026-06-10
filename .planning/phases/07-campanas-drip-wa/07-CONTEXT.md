# Phase 7 — Motor de Campañas Drip WhatsApp — CONTEXT

> Capturado de la conversación con Ignacio el 2026-06-10. Referencia
> visual: screenshots de su workflow actual en Go High Level (trigger
> por tag → drip 1 c/5min → split en 5 paths SMS 1–5 → waits → bumps
> x.1–x.4 → tags V1–V5 → tag IA → END).

## Qué pidió el user (en sus palabras)

1. Mensaje de apertura → espera respuesta (con delays para no parecer bot)
2. Cuando responden → mensaje de calificación
3. Cuando responden la calificación → entra la IA (Mercury) a tratar de
   agendar — **eso es Phase 4, NO esta fase**
4. Poder programar "para mañana esta cantidad de leads por este número"
   con toda la lógica de tiempos
5. **Personalización total tipo GHL**: "si quiero mandar un drip cada 5
   minutos 1, o cada 10 mando 3 — que no sea algo fijo"
6. Acepta que wa-multi debe estar corriendo en una compu ("entiendo que
   tengo que tener la compu prendida")

## Mapeo GHL → SCM (acordado)

| GHL | SCM |
|---|---|
| Contact Tag trigger | Selección de leads al crear campaña |
| Drip Mode | Extensión del scheduler de scheduled_messages |
| Split 5 paths (SMS 1–5) | Variantes con bloques existentes + pesos |
| Mensajes en bloques con waits | Bloques de variante como mensajes separados, delay random min–max |
| Wait esperando respuesta | `ai-classified-inbound` + cancelOnReply |
| SMS x.1..x.4 (bumps) | Steps de bump por campaña |
| Tags V1–V5 | `lead.varianteId` (ya existe) |
| Tag IA + handoff | Phase 4 (Mercury Autopilot) — fuera de scope |

## Decisiones de diseño

- **Máquina de estados por lead** en vez de grafo visual: encolado →
  opener_enviado → esperando_respuesta → (respondió → calificación →
  respondió → marcado para setter | bumps 1..N → fin_sin_respuesta |
  descalificado → descartado).
- **Data**: `wa_campaigns.json` nuevo. OBLIGATORIO sumarlo a
  `/api/admin/export-data` + `scripts/pre-deploy.js` (regla #21
  CLAUDE.md) o un redeploy pierde las campañas.
- **Envío**: reusar el canal `followup:send-message` → wa-multi
  `sendMessageInWindow` (probado en producción con followups y warming).
  Considerar comando nuevo `campaign:send-message` para distinguir en
  logs/eventos, mismo handler del lado desktop o uno gemelo.
- **Detección de respuesta**: el gateway ya recibe `ai-classified-inbound`
  del desktop. El orquestador de campaña matchea contactPhone → lead
  (normalización de teléfono, helpers existentes) y avanza el estado.
  Si intent=descalificado → frenar todo para ese lead.
- **Anti-ban**: drip configurable + stagger random existente + delays
  entre bloques + ventana horaria + cap diario por cuenta que respeta
  la fase de warming de `wa_accounts.json`. Cuentas BANNED/QR_PENDING
  no envían (requeue).
- **wa-multi offline**: si el desktop no está conectado, los envíos se
  requeuean (el scheduler ya tiene retry +5min / SCHEDULED_MAX_ATTEMPTS).
  La campaña no falla, se atrasa.
- **Mercury tools (agendar = entry en data.calendar como
  scheduled_with_admin; follow-up = crear scheduled_message)**:
  factibles y deseadas, pero diferidas a Phase 4 por decisión del user.

## Gotchas conocidos del stack (de CLAUDE.md)

- `leads` en setters.json es MAP, no array.
- Rutas sin `:id` antes de rutas con `:id` en Express.
- Mutex async para writes JSON en handlers async (`mutateSettersData`
  etc.) — el motor de campañas necesitará su propio
  `mutateCampaigns` si hay awaits antes de load+save.
- Cache-buster en index.html ante CUALQUIER cambio a app.js/style.css
  (actual: v=20260529c, verificar al momento de tocar).
- Tests: patrón DATA_DIR=tmpdir + pre-popular auth.json antes de
  importar index.js.

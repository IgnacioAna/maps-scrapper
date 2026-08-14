# SCM — Call center SDR para clínicas dentales

> Proyecto interno de la agencia SCM (reactivación de pacientes para clínicas
> dentales en LATAM/España).
> Última actualización: 2026-08-13 — milestone v4.0 "Seguimiento bajo control".
> ⚠️ **Cambio de contexto operativo (2026-08)**: se disolvió el equipo de
> vendedoras. **Ignacio trabaja solo** con toda la base (4.133 leads
> propios). Todo el andamiaje multi-SDR (supervisores scoped, reportes por
> vendedora, distribución del pool, privacidad de la biblioteca) sigue
> funcionando, pero **dejó de ser una restricción de diseño**: el usuario
> real del sistema es uno.

---

## What This Is

**SCM Setting App** es el sistema operativo del equipo SDR de SCM: CRM +
dialer WebRTC (Telnyx) + scraper de leads (Google Maps/SerpAPI) + enrichment +
transcripción y análisis IA de llamadas + panel de métricas.

> **Deriva histórica**: el proyecto nació (2026-04) como sistema de
> prospección **WhatsApp** (wa-multi desktop + campañas drip). Desde
> 2026-06 el canal operativo es **cold calling** — el módulo WhatsApp
> quedó **parkeado** (backend completo, UI oculta) y toda la operación
> corre por llamadas. La fuente narrativa del detalle técnico es
> `CLAUDE.md` (raíz del repo, ~160 notas numeradas).

El sistema lo usa (desde 2026-08):
- **Ignacio, solo.** Llama, hace el seguimiento, cierra. Toda la base es
  suya (4.133 leads, ~52 en seguimiento activo).
- Histórico: hasta 2026-07 lo usaban 3-5 SDRs (Judith, Teresa, Brenda,
  Melissa, Paula) + supervisores scoped. **Ese trabajo dejó historial
  valioso** — notas, "interesado", transcripciones — sobre leads que hoy
  son de Ignacio. Ese historial es un activo del milestone v4.0, no ruido.

---

## Core Value

**Que el equipo SDR agende reuniones con decisores de clínicas dentales al
menor costo por llamada posible, y que la gestión del equipo se reduzca a
decisiones puntuales que llegan solas — sin que nadie tenga que mirar
dashboards.**

Nadie del equipo directivo quiere gestionar gente día a día, y eso no va a
cambiar. El sistema habla **por excepción**: un reporte que hay que
acordarse de abrir ya falló.

---

## Current Milestone: v4.0 Seguimiento bajo control

**Goal:** Que Ignacio pueda trabajar solo toda la base sin que se le caiga
un lead: cada lead activo tiene exactamente un próximo paso con fecha, los
compromisos hablados ("mandame info", "llamame en dos semanas") son objetos
del sistema y no notas sueltas, y el Power Dialer, Hoy y Llamadas se
comportan como una sola herramienta en vez de tres.

**Target features:**
- **Un solo reloj**: `nextAction` como único objeto de próxima acción por
  lead. Absorbe `callbackAt` y mata el sistema viejo de `followUps`.
- **Gate de próximo paso**: no se cierra una disposición sin definir el
  próximo paso o marcar un estado terminal. Con calendario real (hoy es un
  `datetime-local` nativo y termina contando días a mano).
- **Compromisos como objeto de primera clase**, distinguiendo quién se
  comprometió (él o el prospecto).
- **Acciones desde todas las vistas**: botón de WhatsApp (`wa.me` con
  plantilla + registro del envío + soporte de número alternativo) y botón
  de descartar que saque el lead de todas las listas.
- **Power Dialer como motor único**: entrar al dialer desde cualquier lead,
  no perderlo al marcar un resultado, ficha rediseñada con el historial de
  las vendedoras al frente, panel de llamada arrastrable.
- **Hoy reordenada**, con filtro por país (husos horarios) y panel de
  higiene.

**Criterio de éxito:** pasa una semana llamando y al abrir el sistema no
hay ningún lead trabajado sin próximo paso, ningún callback vencido
olvidado, y sabe de memoria a quién le mandó información y cuándo toca
volver. Si tiene que acordarse de algo que el sistema debería recordarle,
el milestone falló.

**Decisiones ya tomadas (no re-litigar):**
- **Fuente de verdad de los requisitos**:
  `.planning/research/2026-08-13-requisitos-seguimiento-ignacio.md` (R1-R8,
  dichos por el user). Si el plan contradice eso, gana eso.
- El invariante "todo lead activo tiene próximo paso" aplica **solo a leads
  ya tocados** (137 hoy), nunca al stock virgen (3.699) — si no, la métrica
  nace inservible.
- **WhatsApp sale por `wa.me` manual + registro.** Nada de envío
  automático. wa-multi queda como opción futura *solo* para detectar
  respuestas (recibir no quema la cuenta; mandar en volumen, sí).
- **Fuera de alcance**: extracción IA de compromisos desde la transcripción
  (el research es claro en que falla justo en los condicionales, que son
  el caso de él). Entra después, con el objeto `commitment` ya rodado.
- El research externo que fundamenta esto ya está incorporado; **no
  re-investigar** el dominio.

<details>
<summary>Milestone v3.0 Agente de voz — PARKEADO 2026-08-13 (referencia)</summary>

> Parkeado con las fases 24-27 archivadas en
> `.planning/archive/v3.0-agente-voz/`. **No estaba frenado por código**:
> el plan 26-03 quedó en un checkpoint que depende de que el user haga el
> setup en los dashboards de Telnyx y Retell. Se retoma después de v4.0, y
> hay una razón técnica para ese orden: el webhook del agente escribe por
> `_applyCallOutcome`, el mismo modelo que v4.0 rediseña. Integrarlo antes
> obligaría a rehacerlo.

**Goal:** Un agente de voz IA (Retell AI + SIP trunk de Telnyx) llama en
frío a clínicas dentales, pasa la recepción e intenta agendar la reunión
con el decisor; lo que no agenda vuelve como datos accionables (nota de
seguimiento, callback con fecha, nombres de doctor/recepcionista, objeción)
al MISMO circuito que usan las SDRs humanas — callLog, cadencia, funnel,
Hoy, biblioteca de transcripts.

**Target features:**
- Integración backend Retell: config env>JSON (patrón Telnyx), dispatch por
  lote, tool HTTP `/book`, webhook firmado fail-closed, pseudo-SDR
  `setter_agente_ia` con métricas comparables lado a lado.
- Refactor `_applyCallOutcome`: la cascada de dispositions extraída a helper
  puro reusable por el handler humano y el webhook del agente (paridad
  garantizada por `metrics-consistency`).
- Sección "Agente de voz" en el panel (config + armado de lote + disparo +
  resultados). Cero vistas de métricas nuevas.
- Agente en Retell: Conversational Flow Rigid de 9 nodos derivado de los
  guiones oficiales del user + Post Call Data Extraction + setup del SIP
  trunk + piloto México (~$50, primera llamada al propio user).
- Banco de conocimiento unificado: la oferta/objeciones/casos en UNA fuente
  que alimenta prompt del agente + asistente + Banco de Respuestas +
  Centro de Entrenamiento (solo OpenAI — verificar estado Mercury/Qwen).

**Criterio de éxito:** el agente completa un lote piloto real en México con
transcripts legibles en la biblioteca, su fila en Equipo/Comando es
comparable con las SDRs humanas, y al menos un lead termina agendado o con
callback+nota utilizables por el user — con costo por conversación conocido.

**Decisiones ya tomadas (no re-litigar):** ver
`.planning/research/2026-08-01-agente-voz-retell.md` (síntesis completa) y
los `*-CONTEXT.md` de las phases 24-27. Las centrales: sin transferencia a
humano; sin voicemail; no se identifica como IA (esquive con humor);
persona con nombre propio del equipo; lotes manuales; interesados los
cierra el user; guiones PACE = materia prima de los nodos; Retell con BYO
SIP Telnyx (conserva números, caller ID, tarifas, DNC, CDRs).

**v2.0 al momento del switch (2026-08-01):** phases 19-20-21 ejecutadas
(21 con 6/7 planes — falta 21-07 prueba en vivo, queda como pending todo);
**phases 22 (Coaching) y 23 (Alertas) DIFERIDAS** a backlog — se retoman
post-piloto del agente. La advertencia de alcance del roadmap v2.0
("orquestador de agentes… decirlo, no construirlo") fue dicha al user;
decisión explícita del user: priorizar el agente de voz.

<details>
<summary>Milestone v2.0 anterior (referencia)</summary>

**Goal v2.0:** Ignacio y sus dos socios reciben automáticamente — sin entrar a
ningún panel — un reporte de rendimiento por vendedora (diario y semanal)
en un grupo de WhatsApp, y las transcripciones de llamadas se convierten en
feedback de coaching por persona en vez de quedar como archivo muerto.

**Target features:**
- Reporte semanal existente ENCENDIDO (hoy roto por un `ReferenceError` de
  dos líneas) con test de regresión y multi-destinatario.
- Disposición de llamada **obligatoria** (adelantada: cada día sin
  enforcement son llamadas sin registro ni transcript).
- Reporte diario en texto plano al grupo de WhatsApp, con excepciones
  arriba (quién no trabajó hoy), solo métricas con señal, fallback a email
  y cola de pendientes con consolidación.
- Coaching automático por vendedora: análisis IA post-transcripción,
  agregación por persona, cola semanal de 3-5 llamadas a escuchar.
- Alertas `high` convertidas en notificación real con anti-spam.

**Criterio de éxito:** pasa una semana entera sin que nadie entre al
panel, y aun así los tres saben qué vendedora se cayó y qué llamada hay
que escuchar. Si el reporte llega pero igual hay que entrar a mirar para
entender algo, el milestone falló.

**Decisiones v2.0 ya tomadas (no re-litigar):**
- Canal primario = **grupo de WhatsApp** (Ignacio + 2 socios). La razón es
  la conversación: el grupo es donde se discute el reporte.
  ⚠️ **Actualizado el 2026-07-26 por la decisión D-04 de la Phase 21:** el
  email NO es fallback del diario. Si la máquina que sostiene el canal está
  apagada, el reporte queda en cola y espera; no sale por mail. El envío por
  email queda cableado y apagado detrás de una bandera, para que encenderlo
  después sea configuración y no construcción. Esto acota REP-07 a su guard
  de alcanzabilidad. (El reporte semanal detallado SÍ sigue saliendo por
  mail — eso no cambió.)
- **Disposición obligatoria** — la forma exacta (modal bloqueante vs cola
  de pendientes) se discute en discuss-phase de la Phase 20.
- **Alcance = solo vendedoras nuevas** — `setter_ignacio` y
  `setter_paula_kroff` fuera del reporte (reusar `ADMIN_ONLY_SETTER_IDS` +
  `_filterSettersVisible`, criterio Phase 18).
- **Nada de métricas en cero** en los reportes (agendados/shows/deals dan
  0 hoy — entrenarían a los destinatarios a ignorar el reporte).

</details>

</details>

---

## Context

### Estado real de la base (2026-08-13, condiciona el diseño de v4.0)

Medido sobre la copia del pre-deploy del 12/08, leads de `setter_ignacio`:

| Dato | Valor |
|---|---|
| Leads propios | 4.133 (3.819 activos, 571 con al menos una llamada) |
| **Interesados** | **36** — mediana de **21 días** desde que dijeron que sí |
| Callbacks manuales pendientes | 16, de los cuales **12 vencidos** |
| En seguimiento activo | ~52 → banda sana para una persona, sin margen |
| Leads tocados sin próxima acción | **137** ← baseline de la métrica de higiene |
| Leads con `followUps` viejo | 3 → migración trivial |
| Agendados | 1 |

Lecturas que condicionan el diseño:
- **La cola ya no se vacía**: 12 de 16 callbacks vencidos es el KPI de
  saturación en rojo. El problema no es volumen de llamadas, es que lo
  prometido no se cumple.
- **Los interesados se enfrían en silencio** (21 días de mediana).
- **El invariante no puede aplicar al stock virgen**: 3.699 leads sin tocar
  no son "seguimiento", son inventario.

### Estado real de los datos (2026-07-25, condiciona el diseño)

6.413 leads, 603 llamadas desde 28/05/2026. Con señal real: llamadas,
atendidas, minutos hablados, última actividad. En cero o casi: agendados
(1/603), shows (0), deals (0), notas (3,5%), embudo WhatsApp (0%),
sesiones de trabajo (muerto). "Cuánto trabajó" NO se puede medir hoy; el
único proxy honesto es el span primera→última llamada del día, etiquetado
como proxy. 78 llamadas `channel='manual'` sin `duration` (sesgo a
manejar). ~15 llamadas sin atribuir (users borrados — intencional, la suma
por SDR no cuadra con el total global).

### Stack

- Node.js >= 20 + Express 5 (ESM), `index.js` ~15.3k líneas
- Persistencia JSON file-based (Railway Volume `/data`), sin DB
- Telnyx WebRTC (dialer browser + caller ID por país + CDRs de costo real)
- Whisper post-llamada (transcripción 2 canales) + LLM (OpenAI gpt-4o-mini
  primario, Mercury fallback — la UI dice "Mercury")
- SerpAPI (scraping Maps) + enrichment gratis (web/NPI/RDAP)
- Socket.io (gateway wa-multi, módulo parkeado)
- vitest + supertest (~836 tests) — CI en `main`, TZ AR
- Frontend vanilla JS (`public/app.js` + `index.html` + `style.css`,
  cache-buster obligatorio en cada edit)

### Anti-friction principles (no romper)

1. Las SDRs solo necesitan el panel — cero herramientas externas.
2. Todo obvio sin entrenamiento; si requiere instructivo, es mala UX.
3. Cero passwords/API keys que la SDR tenga que recordar.
4. **El equipo directivo no entra al panel** (nuevo, v2.0): lo accionable
   llega solo, por WhatsApp/email.

---

## Requirements

### Validated (en producción — resumen; detalle en CLAUDE.md)

Phases 6–18 cerradas y deployadas (2026-05 → 2026-07):

- ✓ **Telnyx Calls** (Phase 6+): dialer WebRTC, caller ID por país con
  rotación, costos reales por CDR, saldo, filtro de tarifas rojas
- ✓ **Power Dialer**: cola priorizada, atajos, autopiloto, disposiciones
  1-9, cadencia auto-redial, DNC
- ✓ **Whisper + coaching manual**: transcripción 2 canales (8 rondas de
  hardening), endpoint `/analyze` con framework Cold Call v2 (manual,
  admin/supervisor-only), auto-disposición IA
- ✓ **CALL METRICS CORE** (2026-07-24): fuente única del funnel de
  llamadas — connect/conversation/appointment/deal canónicos, series,
  atribución por quién llamó. `tests/metrics-consistency.test.js` es la
  garantía anti-regresión. **Toda métrica nueva DERIVA de estos helpers.**
- ✓ **Vistas**: Hoy, Llamadas, Mi rendimiento, Equipo, Distribución
  (pool), Comando, Centralita, Entrenamiento IA
- ✓ **Supervisor scoped** (Phase 18): `visibleSetterIds[]` +
  `ADMIN_ONLY_SETTER_IDS`, ~40 endpoints filtrados
- ✓ **Enrichment/scraping global** (Phase 16): señales, brief IA,
  validación de números, multi-país
- ✓ **Módulo WhatsApp** (Phases 7-8): motor drip + proxies — backend
  completo, **parkeado** sin UI
- ✓ Reporte semanal por email: construido pero **roto** (bug `now` — se
  arregla en Phase 19)

### Active — v2.0

Ver `REQUIREMENTS.md` (REP-01..10, DISP-01..03, COACH-01..06,
ALERT-01..03) y `ROADMAP.md` (Phases 19–23).

### Out of Scope

- **Orquestador de agentes / integración Stripe / GoHighLevel** — el
  pedido original era más grande; no está justificado por los datos
  actuales (1 agendado en 603 llamadas). Si reaparece antes de que las
  Phases 19–22 corran con datos reales: decirlo, no construirlo.
- **Persistir audio de llamadas** — decisión de diseño (storage/backup);
  solo transcript. La ventana de 10 min del audio en el browser es límite
  duro para la disposición.
- **Métricas de "horas trabajadas"** — no hay fuente honesta; solo proxy
  de span de llamadas, etiquetado como tal.
- **Reactivar WhatsApp como canal de prospección** — parkeado hasta
  decisión explícita del user.
- **Replicar features de GHL / multi-tenant / checkout** — sin cambios
  desde v1.

---

## Key Decisions

| Decisión | Rationale | Outcome |
|----------|-----------|---------|
| Stack JSON file-based en Railway Volume, sin DB | Iteración rápida, costo $0 | ✓ En producción, performante |
| Pivot WhatsApp → cold calling (2026-06) | WhatsApp riesgoso/lento; llamadas convierten mejor con caller ID local | ✓ Operación 100% llamadas, WA parkeado |
| CALL METRICS CORE como fuente única (2026-07-24) | El funnel llegó a estar implementado 4 veces con 3 definiciones — los dashboards no cuadraban | ✓ `__callCore` + tests de consistencia |
| Canal de reportes = grupo WhatsApp, email fallback (2026-07-25) | El grupo es donde se conversa el reporte; 3 bandejas de email no son un hilo | Milestone v2.0 |
| Disposición obligatoria (2026-07-25) | Sin disposición no hay registro ni transcript (audio se descarta a los 10 min) | Phase 20 — forma a discutir |
| Reportes solo con métricas con señal | Filas de ceros entrenan a ignorar el reporte | Regla de diseño v2.0 |
| Solo vendedoras nuevas en reportes | Ignacio/Paula distorsionan; mismo criterio que Phase 18 | Reusar `ADMIN_ONLY_SETTER_IDS` |
| Enforcement adelantado (Phase 20, no última) | Cada día sin enforcement = llamadas sin datos para las fases siguientes | Confirmado 2026-07-25 |
| `WHISPER_PROMPT = ''` — nunca reintroducir | Whisper regurgita el prompt en canales con poca señal; falló 2 veces | Marca en index.js:14378 |

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

### Antes de cada deploy (CRÍTICO)
```bash
npm run pre-deploy   # baja la data de Railway — sin esto se pierden leads
git add data/
git commit -m "backup data"
git push origin main         # Railway escucha MAIN
git push origin main:master  # espejo opcional
```

### Reglas que se olvidan fácil
- Cache-buster en `index.html` ante CUALQUIER edit a `app.js`/`style.css`.
- `leads` en setters.json es un MAP, no array.
- Mutex async (`mutateSettersData` etc.) en todo handler async que hace
  load+save.
- Tests nuevos: `process.env.X_API_KEY = ""` (nunca `delete`).

---

*Last updated: 2026-07-25 — arranque milestone v2.0 "Gestión por
excepción". Rewrite del PROJECT.md que estaba congelado en la era
WhatsApp (2026-04-27); el histórico v1.x quedó en `MILESTONES.md`.*

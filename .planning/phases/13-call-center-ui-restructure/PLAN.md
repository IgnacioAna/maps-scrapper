# Phase 13 — Reestructuración UI/IA del Call Center

> Síntesis de 2 agentes (2026-06-17): auditoría de la UI/estado actual en código +
> research de patrones de los mejores dialers SDR (Orum, Nooks, Kixie, Close,
> Salesloft, Aircall). Ataca las 5 quejas del user: cohesión visual, dialpad real,
> sync de estado, home único de "mi día/seguimientos", filtros repensados.

---

## Problemas confirmados en el código (auditoría)

1. **Estado desincronizado** [queja c, CRÍTICO]: el Power Dialer (`_pd.queue` + `_callsLeadsById`) y la lista Calls (`callsLeadsCache`) mantienen **copias locales independientes**. Una disposition en el dialer no se propaga a la lista sin reload (y viceversa). La queue solo se reconstruye en `_pdStart()`. Race conditions entre el update optimista y `loadCallsView()`. (app.js:4253, 4502, 4609, 6808+)

2. **Trabajo del rep fragmentado en 5 espacios** [queja d, CRÍTICO]: "qué hago hoy / a quién seguir / qué hice ayer" disperso entre: filtro `follow_up`, agenda de callbacks (14d), bloque follow-up del dialer, contador "Hoy" del dialer (solo visible fullscreen), view-myperf, view-call-history. **NO hay una cola única de "mi día".**

3. **3 mecanismos de seguimiento paralelos y confusos** [queja e]: (a) sort `follow_up` (último outcome cortó/no-atendió/buzón + callback vencido), (b) `lead.callbackAt` (outcome callback_later, futuros), (c) `lead.followUps{24hs..15d}` (flags). No se integran; el nombre `follow_up` engaña.

4. **Dialpad = input de texto plano** [queja b]: `manual-dial-modal` es un `<input>` para tipear, sin keypad visual 3×4, sin DTMF durante la llamada, sin validación E.164 visible. (index.html:780)

5. **Incoherencia visual** [queja a]: la tarjeta del Power Dialer y la fila de Calls son layouts COMPLETAMENTE distintos para el mismo lead. Chips construidos ad-hoc en cada vista. Inline styles vs tokens del Design System. No hay anatomía única de lead-card ni componente chip.

6. **El trabajo del día no es recuperable**: no hay "mi diario de hoy/ayer" navegable; el contador vive solo en el dialer fullscreen.

---

## El blueprint (research de los mejores dialers)

### Nueva IA de nivel superior — 5 entradas (consolida lo disperso)

```
📅 Hoy           ← NUEVO home. Cola priorizada + "qué hice hoy/ayer". Absorbe la vista Calls+filtros.
⚡ Power Dialer   ← Modo foco, alimentado por la cola de "Hoy". (ya existe, refactor)
🗓 Agenda         ← Reuniones agendadas/ganadas. (ya existe)
📜 Historial      ← Auditoría + transcripts. (ya existe)
📈 Mi rendimiento ← Cold Call Funnel + KPIs. (ya existe)
```

La vista "Calls + filtros" actual **se fusiona dentro de "Hoy"**. "Seguimientos" NO es vista nueva: es la parte de arriba de "Hoy".

### El home "Hoy" — 4 secciones apiladas (listas accionables, NO filtros)

1. **🔁 Callbacks vencidos/de hoy** (más urgente arriba) — `callbackAt <= hoy`, más vencido primero.
2. **🟢 Interesados sin agendar** — `estado='interesado'` esperando agenda. Acción: "Agendar".
3. **📞 Para reintentar** — último outcome ∈ {no_answer, voicemail, hung_up}, no descartados.
4. **🆕 Vírgenes priorizados** — nunca llamados, ordenados por `_callScore`. Alimenta el Power Dialer.

Arriba: barra de KPIs **hoy vs ayer** (delta) desde `/api/setters/cold-call-metrics`. El principio: el outcome que el rep marca **aterriza solo** en la sección correcta — no se busca con filtros.

### Sync de estado — single source of truth + optimistic UI [la mejora más sentida]

- **Un único `_leadStore`** (Map en memoria) compartido por TODAS las vistas del call center (hoy cada vista tiene su copia).
- **Optimistic update + render dirigido**: al dispositonar, `_leadStore.apply(id, patch)` → muta + dispara POST + **notifica a todas las vistas montadas** para re-renderizar esa fila/tarjeta. Falla → rollback + toast.
- El rep NUNCA aprieta refresh ni re-navega para ver el cambio. KPIs se recalculan del mismo store (extender el patrón `_updateStatsLocal()` que ya existe en el CRM de setteo).

### Dialpad real

- Componente keypad **3×4** (1-9, * 0 #, letras como teléfono real) + botón llamar + borrar. Tokens del Design System.
- Usado en: (1) modal "Discar número", (2) **ícono DTMF en el panel de llamada activa** (para IVRs de centrales — hoy falta), (3) opcional edición de número de lead.
- Selector de país con bandera+prefijo, paste inteligente → normaliza a E.164 (reusar `buildWhatsAppUrl`), mostrar siempre qué número y con qué caller ID se disca. `type="tel"`.

### Vistas guardadas como chips/tabs (no filter-soup)

- **Nivel 1 — chips/tabs horizontales** (reemplazan el sort dropdown como navegación primaria): `Todos · 🆕 Nunca llamados · 🔁 Callbacks hoy · 🟢 Interesados · 📞 Para reintentar · ⭐ Hot (score) · 🗓 Agendados`. Cada chip = vista guardada (filtro+orden).
- **Nivel 2 — filtros finos** (secundario): país, ciudad, intentos, rango de score. Pocos y precisos.
- Segmented control para período (Hoy/Semana/Mes).

### Cohesión visual — mini design-system de call-center

- **Color = estado, semántica estricta en todas las vistas**: interesado/connect/ganada=verde · no-interesado/descartado=rojo/gris · callback/pendiente=ámbar · agendado=violeta `--accent` (reservado para acento, NO para "interesado"/"urgente").
- **Un componente `chip`** (color+ícono+label) usado idéntico en Calls/Dialer/Historial.
- **Una anatomía única de lead-card** reutilizada en lista, dialer e historial (misma info, spacing, chips). Hoy divergen — esa es la raíz de "no se siente cohesivo".
- 3 niveles de superficie en dark (`--bg-app` → `--surface` → `--surface-raised`). Nunca `backdrop-filter: blur()` fullscreen.

---

## Orden de implementación (del agente, validado)

1. **`_leadStore` + optimistic sync** [invisible pero crítico] — mata la queja c y media d.
2. **Anatomía única de lead-card + chips semánticos** — mata la queja a.
3. **Home "Hoy" con las 4 secciones** — mata la queja d.
4. **Vistas-chip reemplazando el sort dropdown** — mata la queja e.
5. **Dialpad + DTMF** — mata la queja b (lo vistoso, al final).

Empezar por lo invisible-pero-crítico (sync, cohesión), terminar con lo vistoso (dialpad), para que cuando lleguen los reps encuentren una herramienta calma, coherente y que se prioriza sola.

---

## Cómo se conecta con las otras fases

- Phase 13 es **el contenedor donde TODO aterriza**: el brief de Phase 10, las battlecards de Phase 11, el dashboard/persistencia/role-play de Phase 12 — todos se ven dentro de esta IA reestructurada.
- Por eso el `_leadStore` + la anatomía de card + el home "Hoy" son fundacionales: conviene hacerlos temprano para que las features de las otras fases caigan en una estructura limpia, no sobre la fragmentación actual.

---

## Estado

- 2026-06-17 — Phase 13 sintetizada de 2 agentes (auditoría UI + research de dialers).
  Pendiente: el user decide si esto va PRIMERO (es fundacional) o después del enrichment.

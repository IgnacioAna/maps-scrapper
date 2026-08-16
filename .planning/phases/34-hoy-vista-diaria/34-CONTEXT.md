# Phase 34: HOY — La vista diaria - Context

**Gathered:** 2026-08-16
**Status:** Ready for planning
**Mode:** Decisiones del orquestador a pedido explícito del user ("terminá
todo"), fundadas en R3 del relevamiento y en el research externo.

<domain>
## Phase Boundary

La última fase del milestone. Hoy se reordena con criterio, se puede filtrar
por país, se trabaja en modo cola, y muestra la red de seguridad de la
higiene del seguimiento.

Requirements: HOY-01, HOY-02, HOY-03, HOY-04, HOY-05.

Queja textual del user: *"la vista de hoy… es poco intuitiva, está muy
mezclado todo y es muy caótico"*.

</domain>

<decisions>
## Implementation Decisions

### El orden (HOY-01)

- **D-01 — Orden fijo y opinado, de arriba hacia abajo**, que es también el
  orden de trabajo:
  1. **Compromisos que vencen hoy** — callbacks manuales, "mandame info" con
     seguimiento vencido, "llamame hoy". Son promesas explícitas; romperlas
     es el peor costo.
  2. **Interesados con próximo paso vencido o sin próximo paso** — los
     calientes primero.
  3. **Reintentos de no-contacto que vencen hoy** — bajo esfuerzo, alto
     volumen. Bloque de Power Dialer.
  4. **Nuevos por score** — solo cuando 1-3 están limpios. Protege el
     pipeline futuro sin canibalizar el seguimiento.
  5. **Red de seguridad** (abajo, colapsable) — leads tocados sin próxima
     acción. Idealmente vacía.
- **D-02 — Un lead aparece en UNA sola sección**, por prioridad. Ya es así
  hoy (nota #105) y no se cambia.
- **D-03 — Las reglas vigentes de qué entra NO se tocan** (nota #125): el
  interesado aparece todos los días hasta agendar o descartar; el callback
  manual solo el día pactado; no_answer/voicemail nunca van a Hoy.

  > **Nota aclaratoria (checker, 2026-08-16)**: existe una tensión textual
  > entre este punto de D-03 ("no_answer/voicemail nunca van a Hoy", un
  > carry-over literal de la nota #125, que es una regla PRE-Phase 34) y
  > D-01 #3, que agrega explícitamente el tier "Reintentos de no-contacto
  > que vencen hoy" — leads en `no_answer`/`voicemail` cuyo reintento
  > automático de cadencia vence hoy. La lectura correcta, que los 3 planes
  > de esta fase (34-01/34-02/34-03) implementan, es **D-01**: coincide con
  > ROADMAP.md y con el texto literal de REQUIREMENTS.md (HOY-01, tier 3).
  > D-03 sigue vigente para el resto de las reglas que no cambian
  > (interesados visibles todos los días, callback manual solo el día
  > pactado) — la única excepción es que Fase 34 SÍ suma no_answer/voicemail
  > a Hoy, pero únicamente como el tier 3 nuevo (reintentos que vencen hoy),
  > nunca mezclados con los demás tiers.

### El filtro por país (HOY-02)

- **D-04 — Reusar el patrón que ya existe en Llamadas**
  (`calls_country_filter_<userId>` en localStorage, con su `<select>`). No
  se inventa un control nuevo.
- **D-05 — Ordenar el desplegable por "llamable ahora"**: los países dentro
  de horario hábil primero. Ya existe el panel "¿A qué país llamar ahora?"
  de la vista Distribución (nota #86) — misma lógica.
- **D-06 — La preferencia se persiste** por usuario, como en Llamadas.

### Modo cola (HOY-03)

- **D-07 — Reusar el Power Dialer por sección que YA existe** (notas
  #179/#180): `_pdStart('hoy-callbacks')` y `_pdStart('hoy-interesados')`.
  Falta extenderlo a las secciones que no lo tienen y unificar el botón.
- **D-08 — Contador "quedan N" por sección**, visible antes de entrar. Da
  sensación de progreso y de fin.

### La red de seguridad (HOY-04)

- **D-09 — Sección colapsable al fondo: "tocados sin próximo paso"**. Es la
  métrica #1 del research y arrancó en **137 leads** el 2026-08-13.
- **D-10 — Solo cuenta leads TOCADOS** (con al menos una llamada). El stock
  virgen (3.699) no entra: si entrara, la métrica nace con 3.699 defectos y
  es inservible. Es la restricción transversal del milestone.
- **D-11 — Desde ahí se puede resolver en el momento**: cada lead con su
  botón para ponerle próximo paso o descartarlo (los botones de la Phase 32
  ya existen).

### El panel de higiene (HOY-05)

- **D-12 — Tres números, no un dashboard**: cuántos tocados sin próximo
  paso · cuántos compromisos vencidos · si la cola de vencidos creció o se
  achicó respecto de ayer.
- **D-13 — El tercero es el que importa**: el research lo marca como el KPI
  de saturación. *Si la cola de vencidos crece día a día en vez de vaciarse,
  el pipeline activo es más grande que la capacidad.* No es un número de
  vanidad, es una alarma.

  > **Nota aclaratoria (checker, 2026-08-16)**: para que D-13 signifique algo
  > (una tendencia real "vs. ayer"), los 2 números que alimentan el panel
  > tienen que medir SIEMPRE el mismo universo — el pipeline completo del
  > SDR, no el subconjunto que el filtro de país (D-04/D-05) esté mostrando
  > en un instante dado. El filtro de país es una preferencia visual que se
  > espera que cambie varias veces por día (ese es el punto de D-05); si el
  > panel de higiene midiera sobre el array ya filtrado, cada cambio de
  > filtro pisaría el snapshot de "hoy" con un recorte distinto y la
  > tendencia dejaría de ser comparable. Los planes 34-02/34-03 resuelven
  > esto manteniendo una clasificación separada, sin filtro de país, solo
  > para los 2 números del panel de higiene.
- **D-14 — Nada de métricas en cero.** Regla vigente del proyecto: un
  número que siempre da 0 entrena a ignorar el panel.

### Fuera de alcance

- **D-15 — No se rediseña visualmente Hoy entero.** La marca ya se aplicó y
  el barrido del verde corrió aparte. Esta fase es orden, filtro, cola y
  red de seguridad — no una reescritura estética.

### Claude's Discretion

- Forma del contador y del colapsable.
- Si el panel de higiene va arriba (como encabezado) o al pie.
- Cómo se calcula "creció o se achicó" (comparación con el día anterior
  persistida, o derivada al vuelo).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

- `.planning/research/2026-08-13-requisitos-seguimiento-ignacio.md` — R3
  (Hoy caótica + filtro por país). Fuente de verdad.
- `.planning/phases/33-dial-motor-unico/33-*-SUMMARY.md` — **leerlos**: la
  Phase 33 acaba de tocar Hoy (repintado desde el store, `_hoyRenderFromStore`)
  y el Power Dialer. Esta fase construye encima, no en paralelo.
- `.planning/phases/32-act-acciones/32-*-SUMMARY.md` — `_actButtonsHTML`,
  el builder único de botones que se reusa en la red de seguridad (D-11).
- `.planning/phases/31-comm-compromisos/31-*-SUMMARY.md` — los compromisos
  que alimentan la sección 1 y el contador de vencidos.
- `CLAUDE.md` — notas #125 (qué entra a Hoy y qué no — **no romperlas**),
  #147 (filtro por SDR en Hoy), #179/#180 (Power Dialer por sección), #86
  (panel de "a qué país llamar ahora"), #105 (`_leadStoreApply`).
- `BRAND-SCM.md` — reglas visuales vigentes.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets — NO reimplementar
- `loadHoyView` / `_hoyRenderSection` / `_hoyState` — la vista ya existe con
  sus 4 secciones
- `_hoyRenderFromStore` (Phase 33) — el repintado desde el estado
- `_pdStart('hoy')` / `'hoy-callbacks'` / `'hoy-interesados'` — el dialer
  por sección ya existe
- `calls_country_filter_<userId>` + su `<select>` en Llamadas — el patrón
  del filtro por país
- `_leadLocalTime()` — hora local por país, para ordenar el desplegable
- `_actButtonsHTML` (Phase 32) — botones por lead
- `_hoyOpenFicha` (#175) — la ficha desde Hoy

### Established Patterns
- Preferencias por usuario en localStorage con la clave sufijada por userId
- `_leadStoreApply` para toda escritura optimista
- Cache-buster obligatorio al tocar `public/*`

### Integration Points
- `loadHoyView` (public/app.js) — el punto central de esta fase
- `GET /api/setters/leads/sin-wsp?include=callable` — de donde salen los
  leads de Hoy
- `GET /api/setters/cold-call-metrics` — los KPIs del encabezado

</code_context>

<specifics>
## Specific Ideas

El user pidió el filtro por país por una razón concreta y operativa: los
husos horarios. Quiere saber **a quién puede llamar ahora**, no filtrar por
gusto. Por eso D-05 ordena el desplegable por horario hábil en vez de
alfabéticamente.

</specifics>

<deferred>
## Deferred Ideas

- Priorización por señal de intención dentro de cada sección (patrón
  Salesloft Rhythm del research): sobredimensionado para un vendedor solo.
- Límite de WIP configurable: el research lo sugiere, pero primero hay que
  ver el número real de la cola de vencidos con el panel de D-12.

</deferred>

---

*Phase: 34-HOY — La vista diaria*
*Context gathered: 2026-08-16*

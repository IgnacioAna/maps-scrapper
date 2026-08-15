# SCM — Roadmap · Milestone v4.0 "Seguimiento bajo control"

> Creado 2026-08-13. El roadmap v3.0 completo quedó archivado en
> `.planning/archive/v3.0-agente-voz/ROADMAP-v3.0.md` (Phase 24 ejecutada
> 5/5 planes; Phases 25-27 sin arrancar — **parkeado**, no cancelado, ver
> resumen al final de este archivo). La numeración continúa: **28–34**.
>
> **27 requirements** (NEXT 4 + GATE 4 + COMM 4 + ACT 5 + DIAL 5 + HOY 5),
> mapeados 1:1 a fase. (El commit que definió los requisitos dice "23" —
> fue un error de conteo del orquestador, corregido acá y en
> `REQUIREMENTS.md`.)

**Criterio de éxito del milestone:** pasa una semana llamando y al abrir
el sistema no hay ningún lead trabajado sin próximo paso, ningún callback
vencido olvidado, y sabe de memoria a quién le mandó información y cuándo
toca volver. Si tiene que acordarse de algo que el sistema debería
recordarle, el milestone falló.

**Reglas transversales (aplican a todas las phases):**

- **Riesgo #1 del milestone**: las Phases 29-30 tocan el flujo que el user
  usa TODOS LOS DÍAS para llamar. No puede quedar un día sin poder discar.
  Preferir cambios aditivos y reversibles (campos nuevos que conviven con
  los viejos hasta migrar, feature flags si hace falta) sobre reescrituras
  grandes de una sola vez.

- El invariante "todo lead activo tiene próximo paso" aplica **solo a
  leads ya tocados** (137 hoy), nunca al stock virgen (3.699) — no forzar
  `nextAction` sobre leads sin tocar.

- `_applyCallOutcome` (index.js ~10700) es el corazón de las disposiciones
  y lo comparte el webhook del agente de voz (v3.0, parkeado). El helper
  se mantiene puro y su paridad con `tests/metrics-consistency.test.js`
  intacta — ninguna phase de v4.0 puede romper ese contrato.

- Toda métrica nueva DERIVA del CALL METRICS CORE
  (`globalThis.__callCore`); jamás re-implementar el funnel inline.

- Toda migración de datos (callbackAt → nextAction, followUps →
  nextAction) sigue el patrón ya establecido del proyecto: backup +
  `dryRun` + ejecución idempotente, verificable antes/después contra los
  números medidos en `PROJECT.md` (16 callbacks, 3 followUps, 36
  interesados, 137 tocados sin próxima acción).

- Cache-buster ante cualquier cambio de `app.js`/`style.css`/`index.html`
  (regla dura, se olvida fácil — ver CLAUDE.md nota final de cada sesión).

- Handlers async que escriben `setters.json` → `mutateSettersData` (regla
  #19 de CLAUDE.md).

- Rutas sin `:id` ANTES de rutas con `:id` (Express, regla #3 del repo).
- Suite completa verde antes de cerrar cada phase (base: ~1181 tests al
  2026-08-13).

- `npm run pre-deploy` antes de push a `main` (lo corre el user); Railway
  escucha `main`.

- El usuario real del sistema es UNO (Ignacio, admin). El andamiaje
  multi-SDR (supervisores scoped, reportes por vendedora, privacidad de
  biblioteca) sigue funcionando pero deja de ser una restricción de
  diseño — no hay que preservarlo a costa de complejidad para el caso de
  uso real.

- Contexto completo del milestone:
  `.planning/research/2026-08-13-requisitos-seguimiento-ignacio.md` (qué
  duele, R1-R8, fuente de verdad por encima de este roadmap) y
  `.planning/research/2026-08-13-estado-seguimiento-para-investigar.md`
  (estado del código antes del rediseño).

---

## Resumen

| # | Phase | Reqs | Depende de |
|---|-------|------|-----------|
| 28 | 3/3 | Complete   | 2026-08-14 |
| 29 | NEXT — El reloj único (4/4 planes, COMPLETE) | NEXT-01..04 | — |
| 30 | 3/3 | Complete   | 2026-08-15 |
| 31 | COMM — Compromisos como objeto (1/4 planes) | COMM-01..04 | 29 |
| 32 | ACT — Acciones desde cualquier vista | ACT-01..05 | 29, 31 |
| 33 | DIAL — Power Dialer como motor único | DIAL-01..04 | 29, 30, 32 |
| 34 | HOY — La vista diaria | HOY-01..05 | 29, 30, 33 |

- [x] **Phase 28: QUICK — Alivio inmediato** — calendario real al programar fecha + panel de llamada arrastrable. Solo interfaz, cero modelo de datos (completed 2026-08-14)
- [x] **Phase 29: NEXT — El reloj único** — `nextAction` como único objeto de próxima acción por lead, absorbe `callbackAt` y mata `followUps` (completed 2026-08-14)
- [x] **Phase 30: GATE — Cierra la llamada, define el próximo paso** — no se cierra una disposición sin próximo paso o estado terminal (completed 2026-08-15)
- [ ] **Phase 31: COMM — Compromisos como objeto** — "mandame info"/"llamame en dos semanas" como objetos con dueño y fecha, no notas sueltas
- [ ] **Phase 32: ACT — Acciones desde cualquier vista** — WhatsApp/descartar/número alternativo desde lista, dialer, ficha y Hoy
- [ ] **Phase 33: DIAL — Power Dialer como motor único** — lanzar sobre un lead puntual, no expulsar al marcar, ficha con historial al frente
- [ ] **Phase 34: HOY — La vista diaria** — reordenada por prioridad, filtro por país, red de seguridad de higiene

> **Por qué la Phase 28 existe**: decisión del user (2026-08-13). Las dos
> mejoras que más se sienten a diario (contar días a mano para programar un
> callback, y el panel que tapa lo que hay detrás) **no dependen del modelo
> de datos**. Se adelantan para tener alivio en días en vez de esperar a que
> baje toda la cadena. Es puramente de interfaz: no toca `_applyCallOutcome`,
> ni `setters.json`, ni las métricas.

---

## Phase Details

### Phase 28: QUICK — Alivio inmediato

**Goal**: Las dos molestias diarias que NO dependen del modelo de datos se
resuelven ya: programar una fecha sin contar días a mano, y poder correr el
panel de llamada cuando tapa algo.
**Depends on**: Nothing (first phase — solo interfaz)
**Requirements**: GATE-03, DIAL-05
**Success Criteria** (what must be TRUE):

  1. Al programar una fecha (modal "Volver a llamar" y cualquier otro punto
     donde hoy se usa `<input type="datetime-local">`) aparece un
     calendario propio con el mes visible y clickeable, más etiquetas
     relativas ("en 3 días", "el martes") — no hay que contar días a mano
     para saber dónde cae la fecha que pactó.

  2. Los atajos rápidos que ya existen (`#call-cb-quickpicks`) siguen
     funcionando igual: la fase suma una forma de elegir, no reemplaza la
     que ya se usa.

  3. El panel de llamada se puede arrastrar con el mouse y recuerda su
     posición entre llamadas.

  4. El panel no vuelve a saltar solo al abrir el panel de guiones — la
     regla CSS `body.tlx-script-open #telnyx-call-panel` (index.html:1461)
     que hoy lo reposiciona se resuelve JUNTO con el arrastre, no en
     paralelo, o el panel se movería solo después de que el usuario lo
     acomodó.

  5. Nada de esto toca `_applyCallOutcome`, `setters.json` ni las
     métricas: la suite completa sigue verde sin cambios de backend, y la
     fase se puede deployar sin migración de datos.
**Plans**: 3 plans

Plans:
**Wave 1**

- [x] 28-01-PLAN.md — Componente de calendario propio (popover anclado, mes navegable, franjas 09:00–19:00, etiqueta relativa)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 28-02-PLAN.md — Cableado a los 5 campos de fecha + hora local del lead + carga de compromisos por día

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 28-03-PLAN.md — Paneles de llamada arrastrables con posición recordada (resuelve el empuje CSS de D-11)

### Phase 29: NEXT — El reloj único

**Goal**: Cada lead tiene UN SOLO objeto de próxima acción (`nextAction`)
que reemplaza a `callbackAt` y al sistema viejo de `followUps`, sin perder
ningún comportamiento vigente hoy (cadencia automática, callback manual,
consumo al re-discar).
**Depends on**: Phase 28 (solo por orden de trabajo; no hay dependencia técnica)
**Requirements**: NEXT-01, NEXT-02, NEXT-03, NEXT-04
**Success Criteria** (what must be TRUE):

  1. Cualquier lead con callback pendiente o con `followUps` activo (los 3
     casos de hoy) muestra un ÚNICO próximo paso (`nextAction`) tras la
     migración — ya no conviven dos relojes con vistas y semánticas
     distintas para la misma pregunta ("¿cuándo vuelvo a este lead?").

  2. La cadencia automática de no-contacto (reintento a 24h, descarte al
     2° seguido salvo interesados) y el callback manual (`callback_later`)
     siguen produciendo la MISMA fecha visible que hoy para el usuario —
     ambos escriben ahora el mismo objeto `nextAction` en vez de dos
     mecanismos paralelos.

  3. Marcar cualquier resultado de llamada sobre un lead con un
     `nextAction` pendiente (vencido o no) lo reemplaza siempre — la regla
     ya vigente hoy solo para `callbackAt`/cortes (nota #182 de CLAUDE.md)
     se generaliza a todo el modelo nuevo, así que no puede volver a
     aparecer un lead clavado arriba de la cola por un compromiso viejo.

  4. `lead.followUps` deja de ser leído como fuente de verdad por ninguna
     vista — sus 5 pasos (24h/48h/72h/7d/15d) sobreviven solo como
     plantillas de duración al elegir un `nextAction`.

  5. Migración ejecutada en producción con backup + `dryRun` corridos
     antes: los 16 callbacks y los 3 `followUps` quedan correctamente
     representados en `nextAction`, y la suite completa (incluido
     `metrics-consistency`) sigue verde sin cambiar ningún número de
     funnel/atribución.
**Plans**: 4 plans

Plans:
**Wave 1**

- [x] 29-01-PLAN.md — Modelo `nextAction` + helpers (`_setNextAction` / `_clearNextAction` / `_deriveNextActionFromLegacy` / `_leadNextAction`) + invariante de espejo con `callbackAt` en los 7 writers existentes (completed 2026-08-14, 29-01-SUMMARY.md)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 29-02-PLAN.md — `_applyCallOutcome` sobre el reloj único: consumo en toda disposición (NEXT-04), cadencia y callback manual, "En seguimiento" por `origen`, paridad con el agente de voz (completed 2026-08-14, 29-02-SUMMARY.md)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 29-03-PLAN.md — Retiro de `followUps` como reloj paralelo: el toggle programa `nextAction`, `_computeFollowupsDue` deriva del modelo nuevo (NEXT-03) (completed 2026-08-14, 29-03-SUMMARY.md)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 29-04-PLAN.md — Migración `POST /api/admin/backfill-next-action` (dryRun + backup + idempotente) + ensayo contra datos reales + one-shot de producción (completed 2026-08-14, 29-04-SUMMARY.md)

### Phase 30: GATE — Cierra la llamada, define el próximo paso

**Goal**: No se puede cerrar una disposición sin un `nextAction` o un
estado terminal explícito, con una propuesta de próximo paso ya cargada y
feedback claro de a dónde se fue el lead. (El calendario para elegir la
fecha ya existe desde la Phase 28.)
**Depends on**: Phase 29
**Requirements**: GATE-01, GATE-02, GATE-04
**Success Criteria** (what must be TRUE):

  1. Al intentar cerrar cualquier disposición (incluida "interesado") sin
     `nextAction` y sin marcar un estado terminal (descartado/agendado/
     cerrado), el sistema lo impide con un aviso claro — un lead con
     interés declarado no puede quedar sin fecha.

  2. Cada resultado de llamada llega con una propuesta de próximo paso ya
     cargada (fecha + motivo) — interesado, "mandame info", "llamame en
     X" — que el usuario acepta con un click o edita antes de guardar.

  3. Al guardar, un mensaje visible dice explícitamente a dónde se fue el
     lead y cómo volver a encontrarlo (qué vista, qué fecha) — el reclamo
     "desaparece" (R2) queda resuelto sin tener que adivinar ni navegar a
     ciegas.
**Plans**: 3 plans (3 olas — backend, paso de próximo paso, feedback de destino)

Plans:

- [x] 30-01-PLAN.md — Backend: defaults D-02 por outcome + red de seguridad GATE-01 + override sanitizado + esperar_respuesta en el hold (wave 1)
- [x] 30-02-PLAN.md — Frontend: paso "Próximo paso" para Interesado (+3 días propuestos, atajos y calendario) + fix de expulsión del Power Dialer (wave 2)
- [x] 30-03-PLAN.md — Feedback GATE-04: destino universal por vista real + integración en el banner del Power Dialer (wave 3)

### Phase 31: COMM — Compromisos como objeto

**Goal**: Los compromisos hablados ("mandame info", "llamame en dos
semanas", "lo hablo con mi socio") son objetos del sistema con dueño,
canal y fecha — no texto suelto dentro de una nota.
**Depends on**: Phase 29
**Requirements**: COMM-01, COMM-02, COMM-03, COMM-04
**Success Criteria** (what must be TRUE):

  1. Al anotar un compromiso durante o después de una llamada, el usuario
     carga un objeto con tipo, quién se comprometió (él o el prospecto),
     canal y fecha — no queda como texto libre dentro de una nota.

  2. Un compromiso pendiente aparece como el `nextAction` del lead — no
     son dos cosas separadas que hay que revisar por separado.

  3. Si el compromiso es del prospecto ("te mando el presupuesto", "lo
     hablo con mi socio") y vence sin novedades, el lead reaparece en el
     flujo de seguimiento con ese vencimiento como motivo visible — no
     necesita acordarse a mano de qué esperaba de quién.

  4. Existe una vista o filtro donde puede consultar, en cualquier
     momento, a quién le mandó información, cuándo, y cuáles compromisos
     siguen sin resolver.
**Plans**: 4 plans (4 olas — modelo, endpoints, carga en UI, consulta)

Plans:

- [x] 31-01-PLAN.md — Modelo del compromiso: whitelists D-02/03/04, mapa D-06 y los helpers que lo atan al reloj único (wave 1)
- [ ] 31-02-PLAN.md — Endpoints: `commitment` en call-disposition (D-08) + `PATCH .../commitment` para la ficha (D-09) (wave 2)
- [ ] 31-03-PLAN.md — Carga en UI: selector en el modal “Próximo paso”, bloque en la ficha y destino nombrando la sección real (wave 3)
- [ ] 31-04-PLAN.md — Consulta: secciones de compromisos en Hoy (D-10) + el cerrado en el timeline del lead (D-11) (wave 4)

### Phase 32: ACT — Acciones desde cualquier vista

**Goal**: Botón de WhatsApp (con número alternativo) y botón de descartar
disponibles en toda vista donde aparece el lead, con el envío registrado
como evento del mismo modelo que los compromisos.
**Depends on**: Phase 29, Phase 31
**Requirements**: ACT-01, ACT-02, ACT-03, ACT-04, ACT-05
**Success Criteria** (what must be TRUE):

  1. Desde la lista de Llamadas, el Power Dialer, la ficha del lead y Hoy
     hay un botón de WhatsApp que abre `wa.me` con el mensaje precargado,
     sin tener que navegar a otra vista para mandarlo.

  2. Ese mismo click, además de abrir WhatsApp, registra el envío como
     evento del lead y arma el próximo paso (compromiso "yo mandé info,
     espero respuesta") — mandar y registrar es un solo acto, no dos.

  3. Puede cargar un número alternativo en el momento (durante la llamada,
     cuando le pasan otro número) y mandarle el WhatsApp a ESE número sin
     perder la asociación con el lead original.

  4. Hay un botón de descartar en las mismas 4 vistas; al usarlo, el lead
     sale de Llamadas, Power Dialer y Hoy de una sola vez, sin tener que
     entrar a una vista específica para sacarlo de circulación.

  5. El envío de material por email queda registrado con el mismo modelo
     de evento que el WhatsApp (mismo timeline del lead), sin ningún
     tracking de apertura.
**Plans**: TBD

Plans:

- [ ] 32-01: TBD (definido en plan-phase)

### Phase 33: DIAL — Power Dialer como motor único

**Goal**: El Power Dialer deja de ser una herramienta aislada: se lanza
sobre un lead puntual desde cualquier lista, no expulsa al marcar un
resultado, comparte estado en vivo con Hoy y Llamadas, y su ficha muestra
el historial de las vendedoras al frente.
**Depends on**: Phase 29, Phase 30, Phase 32
**Requirements**: DIAL-01, DIAL-02, DIAL-03, DIAL-04
**Success Criteria** (what must be TRUE):

  1. Desde cualquier lista (Llamadas, Hoy, resultado de búsqueda, ficha),
     un botón "Discar en Power Dialer" abre el dialer con la cola
     arrancando en ESE lead puntual, sin tener que empezar desde el
     principio.

  2. Al marcar un resultado dentro del Power Dialer, el lead NO se saca de
     la vista hasta que el usuario decide avanzar (extensión del patrón de
     hold ya existente — nota #151 de CLAUDE.md — a todo el flujo del
     dialer, incluida la cola de Hoy).

  3. Un cambio hecho en el Power Dialer (disposición, nota, callback) se
     ve reflejado en Hoy y en Llamadas sin recargar la página, y
     viceversa — las 3 vistas leen y escriben el mismo estado.

  4. La ficha del lead, al entrar en llamada, muestra arriba de todo —
     antes de que atiendan — quién lo trabajó antes, qué anotó y en qué
     quedó (si tiene historial de otra vendedora); llamar a un lead
     trabajado ya no se siente ni se ve como una llamada en frío.
**Plans**: TBD

Plans:

- [ ] 33-01: TBD (definido en plan-phase)

### Phase 34: HOY — La vista diaria

**Goal**: Hoy se reordena con criterio, se puede filtrar por país, se
trabaja en modo cola, y muestra una red de seguridad visible de la
higiene del seguimiento.
**Depends on**: Phase 29, Phase 30, Phase 33
**Requirements**: HOY-01, HOY-02, HOY-03, HOY-04, HOY-05
**Success Criteria** (what must be TRUE):

  1. Al abrir Hoy, las secciones aparecen en este orden: compromisos que
     vencen hoy → interesados con paso vencido → reintentos de
     no-contacto → nuevos por score — en vez del orden mezclado actual.

  2. Puede filtrar Hoy por país y ver solo los leads llamables ahora según
     el huso horario de ese país.

  3. Cada sección se trabaja como una cola (una tarjeta a la vez, marcar y
     pasa la siguiente) con un contador de cuántas quedan — extensión del
     Power Dialer por sección que ya existe (notas #179-181 de CLAUDE.md).

  4. Hay una sección/panel visible con los leads tocados que quedaron sin
     próxima acción (el baseline de 137 medido el 2026-08-13), pensada
     para vaciarse con el uso — nunca para crecer sin que se note.

  5. Un indicador de higiene muestra si la cola de vencidos crece o se
     achica respecto de días anteriores — la señal de saturación que hoy
     solo se nota mirando manualmente (12 de 16 callbacks vencidos al
     2026-08-13).
**Plans**: TBD

Plans:

- [ ] 34-01: TBD (definido en plan-phase)

---

## Progress

**Execution Order:** Phases execute in numeric order: 28 → 29 → 30 → 31 → 32 → 33 → 34

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 28. QUICK — Alivio inmediato | 3/3 | Complete | 2026-08-14 |
| 29. NEXT — El reloj único | 4/4 | Complete | 2026-08-14 |
| 30. GATE — Cierra la llamada, define el próximo paso | 0/TBD | Not started | - |
| 31. COMM — Compromisos como objeto | 0/TBD | Not started | - |
| 32. ACT — Acciones desde cualquier vista | 0/TBD | Not started | - |
| 33. DIAL — Power Dialer como motor único | 0/TBD | Not started | - |
| 34. HOY — La vista diaria | 0/TBD | Not started | - |

---

## Milestone v3.0 "Agente de voz" — estado al parkear (2026-08-13)

Roadmap completo archivado en
`.planning/archive/v3.0-agente-voz/ROADMAP-v3.0.md`.

| # | Phase | Reqs | Status |
|---|-------|------|--------|
| 24 | Integración backend Retell | VOICE-01..06 | **COMPLETE** (5/5 planes, 2026-07-31, suite 1131/1131) |
| 25 | Panel Agente de voz | VOICE-07 | No arrancó |
| 26 | Agente en Retell + piloto | VOICE-08..09 | No arrancó (mayoría `autonomous: false`) |
| 27 | Banco de conocimiento unificado | VOICE-10 | No arrancó (paralelizable, sin dependencias) |

**Por qué se parkeó** (decisión del user, 2026-08-13): se disolvió el
equipo de vendedoras — Ignacio pasó a trabajar solo toda la base, y el
problema urgente dejó de ser "sumar volumen de llamadas" (el rol del
agente) para ser "no perder ningún lead trabajado" (seguimiento). Razón
técnica adicional: el webhook de Retell (Phase 24) escribe resultados por
`_applyCallOutcome`, el mismo helper que v4.0 rediseña con `nextAction` —
integrar el agente antes habría obligado a rehacerlo. Se retoma después de
v4.0.

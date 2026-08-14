# SCM — Roadmap · Milestone v3.0 "Agente de voz"

> Creado 2026-08-01. El roadmap v2.0 completo quedó archivado en
> `ROADMAP-v2.0-archived.md` (sus phases 19-21 están ejecutadas; 22-23
> DIFERIDAS a backlog — se retoman post-piloto). La numeración continúa:
> **24–27**.

**Criterio de éxito del milestone:** el agente completa un lote piloto real
en México con transcripts legibles en la biblioteca, su fila en
Equipo/Comando es comparable con las SDRs humanas, y al menos un lead
termina agendado o con callback+nota utilizables — con costo por
conversación conocido contra el baseline humano.

**Reglas transversales (aplican a todas las phases):**

- El agente alimenta el MISMO circuito que una SDR humana. Cero circuito
  paralelo de métricas; toda métrica DERIVA del CALL METRICS CORE
  (`tests/metrics-consistency.test.js` es la garantía).

- Alcance acotado del agente: agenda vía `/book`, termina en un outcome
  canónico, y NADA más. No mueve estados por criterio propio.

- Suite completa verde antes de cerrar cada phase (base: ~991 tests).
- Cache-buster ante cualquier cambio de `app.js`/`style.css`/`index.html`.
- Rutas sin `:id` ANTES de rutas con `:id` (Express, regla #3 del repo).
- `npm run pre-deploy` antes de push a `main` (lo corre el user); Railway
  escucha `main`.

- Pasos que requieren al user (dashboard Retell, trunk, voz, gasto,
  llamada de prueba): `autonomous: false`.

- Handlers async que escriben setters.json → `mutateSettersData` (regla #19).
- Contexto completo del milestone:
  `.planning/research/2026-08-01-agente-voz-retell.md`.

---

## Resumen

| # | Phase | Reqs | Depende de |
|---|-------|------|-----------|
| 24 | Integración backend Retell | VOICE-01..06 | — |
| 25 | Panel Agente de voz | VOICE-07 | 24 |
| 26 | Agente en Retell + piloto | VOICE-08..09 | 24 (25 deseable) |
| 27 | Banco de conocimiento unificado | VOICE-10 | — (paralelizable) |

- [x] **Phase 24: Integración backend Retell** — config, refactor cascada, dispatch, tool book, webhook, pseudo-SDR
- [ ] **Phase 25: Panel Agente de voz** — sección admin de config + lote + resultados
- [ ] **Phase 26: Agente en Retell + piloto** — flow de 9 nodos cargable, setup trunk, prueba y lote MX
- [ ] **Phase 27: Banco de conocimiento unificado** — oferta/objeciones en una fuente para agente + asistente + banco + entrenamiento

---

## Phase Details

### Phase 24: Integración backend Retell

**Goal**: Todo el lado servidor del agente: una llamada de Retell entra y
sale del sistema exactamente como una llamada de SDR humana.
**Depends on**: Nothing (first phase)
**Requirements**: VOICE-01, VOICE-02, VOICE-03, VOICE-04, VOICE-05, VOICE-06
**Success Criteria** (what must be TRUE):

  1. Un webhook `call_analyzed` simulado (curl firmado) produce en el lead:
     callLog entry `channel:'retell'` con transcript visible en la
     biblioteca de Entrenamiento IA, outcome canónico aplicado con cascada
     (estado/cadencia/DNC/calendar idénticos a los del handler humano), y
     nota de seguimiento en notes[].

  2. La suite completa está verde y `metrics-consistency` NO cambió ningún
     número tras el refactor `_applyCallOutcome` (paridad handler humano ↔
     helper).

  3. El dispatch rechaza leads DNC/tarifa-roja/muertos/callback-futuro
     (pasa por `_leadIsCallableNow`), respeta `dailyCap`, y arma las
     variables dinámicas con `leadId` incluido.

  4. `/book` con header secreto crea la cita (`sourceCall:true`,
     `setterId:'setter_agente_ia'`) y sin header devuelve 401; el webhook
     sin firma devuelve 401 y en producción sin secret configurado 503.

  5. `setter_agente_ia` aparece como fila en Equipo/Comando con sus
     llamadas atribuidas (by:'' → assignedTo) sin tocar código de métricas.

  6. `retell_config.json` sobrevive un redeploy (export/import/backup/
     pre-deploy) y sus secrets viven en env vars con lock en el PUT.
**Plans**: 5 (planificado 2026-07-31 — los 3 sugeridos se abrieron a 5: todo
toca `index.js`, así que las waves se serializan para que dos planes nunca
editen el archivo en paralelo, y el webhook no entraba en un solo plan dentro
del presupuesto de contexto)

Plans:
**Wave 1**

- [x] 24-01-PLAN.md — Refactor `_applyCallOutcome` + hoisting de los helpers de costo + test de paridad doble-vía (VOICE-02, wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 24-02-PLAN.md — Config Retell env>JSON + regla #21 completa + pseudo-SDR `setter_agente_ia` (VOICE-01/06, wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 24-03-PLAN.md — Dispatch por lote + caller ID server-side + dry-run + cap diario (VOICE-03, wave 3)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 24-04-PLAN.md — Tool `/book` con header secreto + webhook firmado (HMAC nativo, sin SDK nuevo) (VOICE-04/05, wave 4)

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 24-05-PLAN.md — Procesamiento del webhook: transcript, outcome, cascada, extracción + tests end-to-end (VOICE-05, wave 5)

### Phase 25: Panel Agente de voz

**Goal**: El user opera el agente desde el panel sin tocar API ni consola.
**Depends on**: Phase 24
**Requirements**: VOICE-07
**Success Criteria**:

  1. Sección "Agente de voz" (admin only) muestra estado de config con
     locks 🔒 de env vars, y permite editar agentId/dailyCap/enabled.

  2. El user arma un lote (cantidad, país, filtro con/sin nombre de
     doctor), ve el gasto estimado, confirma y dispara; el resultado del
     dispatch (aceptadas/rechazadas y por qué) queda visible.

  3. Las llamadas de hoy del agente y sus últimos resultados se ven en la
     misma sección; el rendimiento comparativo se ve en Equipo/Comando sin
     UI nueva (fila "Agente IA").

  4. Cache-buster bumpeado; cero regresión visual en el resto del panel.

**Plans**: 1 (sugerido)

Plans:

- [ ] 25-01: Sección completa + wiring a los endpoints de 24 + cache-buster

### Phase 26: Agente en Retell + piloto

**Goal**: El agente existe en Retell, suena bien en español, y completa un
lote piloto real en México con resultados medibles.
**Depends on**: Phase 24 (25 deseable para operar cómodo)
**Requirements**: VOICE-08, VOICE-09
**Success Criteria**:

  1. Existe el documento "agente cargable" (global prompt + 9 nodos +
     transiciones por ecuación + variables + Post Call Data Extraction +
     settings de voz + tool book) derivado de los guiones oficiales, y el
     user lo cargó en su dashboard.

  2. SIP trunk Telnyx↔Retell operativo con los números propios importados
     (guía paso a paso seguida; números chequeados contra "spam likely"
     llamando a un teléfono propio).

  3. Llamada de prueba al user completada: escuchó el flujo completo
     (gatekeeper→pitch→objeción→agendar), eligió la voz entre 3 candidatas
     en español, y aprobó seguir.

  4. Lote piloto real en México ejecutado dentro del presupuesto (~$50):
     transcripts en la biblioteca, fila del agente en Equipo, y cierre del
     piloto con % atención, % gatekeeper pasado, % conversación ≥30s,
     agendas/callbacks y costo por conversación vs baseline humano.

  5. Confirmado con Retell antes de gastar: facturación ring vs conectado,
     costo real de la voz elegida, formato de firma del webhook.
**Plans**: 6 (planificado 2026-07-31 — los 3 sugeridos se abrieron a 6. Motivos:
el documento del agente no entra en un plan dentro del presupuesto de contexto
(contrato con el código + 9 nodos + globals + checklist), el setup del trunk y
la llamada de prueba son sesiones de dashboard distintas con dependencia real
entre ellas, y la compuerta bloqueante D-26-03 se modeló como plan propio para
que "probar" y "gastar" no compartan plan. 4 de los 6 son `autonomous: false`)

Plans:

**Wave 1**
- [ ] 26-01: Documento del agente — Parte A: contrato con el código (Global Settings, global prompt, variables dinámicas, Post Call Data Extraction, tool book, webhook)

**Wave 2**
- [ ] 26-02: Documento del agente — Parte B: los 9 nodos, Global Nodes (DNC + "¿sos un robot?"), tabla de transiciones y checklist de carga

**Wave 3**
- [ ] 26-03: Guía + setup del trunk Telnyx↔Retell, decisión de números, import a Retell y pregunta de facturación enviada *(autonomous: false)*

**Wave 4**
- [ ] 26-04: Cargar el agente en Retell + elegir voz entre 3 candidatas + llamada de prueba al user + verificación de `agent_version` *(autonomous: false)*

**Wave 5**
- [ ] 26-05: **Compuerta D-26-03** — reputación de cada caller ID + GO/NO-GO con presupuesto por escenario de facturación *(autonomous: false)*

**Wave 6**
- [ ] 26-06: Lote piloto MX por tandas de 10 + cierre vs baseline humano *(autonomous: false)*

### Phase 27: Banco de conocimiento unificado

**Goal**: Una sola fuente de verdad de la oferta que alimenta al agente, al
asistente, al Banco de Respuestas y al Centro de Entrenamiento.
**Depends on**: Nothing (paralelizable con 25/26; el prompt de 26-01 la
consume si ya está)
**Requirements**: VOICE-10
**Success Criteria**:

  1. La oferta (reactivación sin publicidad paga, 6 fugas, casos reales,
     calificación base 800+) y las objeciones v2 están consolidadas en una
     fuente versionada en el repo.

  2. El system prompt del asistente refleja esa fuente y el estado real de
     proveedores IA (verificado en código: qué quedó de Mercury/Qwen; user
     reporta solo OpenAI).

  3. El Banco de Respuestas tiene las objeciones oficiales v2 cargadas
     (seed idempotente, dedup por pregunta) sin pisar entries con métricas
     de uso.

  4. El Centro de Entrenamiento tiene el playbook consolidado de los 5
     cursos (material para SDRs humanas, incluida la sección mindset/miedo
     que al agente no le sirve).
**Plans**: 2 (sugeridos)

Plans:

- [ ] 27-01: Fuente unificada de la oferta + system prompt + verificación de proveedores IA
- [ ] 27-02: Seed de objeciones al Banco + material del Centro de Entrenamiento

---

## Milestone v2.0 — estado al switch (2026-08-01)

| # | Phase | Reqs | Status |
|---|-------|------|--------|
| 19 | Encender el reporte semanal | REP-01..03 | COMPLETE |
| 20 | Disposición obligatoria | DISP-01..03 | Ejecutada + verificada (UAT humano en prod pendiente) |
| 21 | Reporte diario + canal WhatsApp | REP-04..10 | 6/7 planes — falta SOLO 21-07 (prueba en vivo, pending todo) |
| 22 | Coaching por vendedora | COACH-01..06 | **DIFERIDA a backlog** |
| 23 | Notificación por excepción | ALERT-01..03 | **DIFERIDA a backlog** |

La advertencia de alcance del roadmap v2.0 (no ampliar a orquestador de
agentes antes de que 19-22 corran con datos) fue dicha explícitamente al
user; su decisión: priorizar el agente de voz. 22-23 se retoman post-piloto.

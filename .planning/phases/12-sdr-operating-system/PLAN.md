# Phase 12 — SDR Operating System (capa de proceso + gestión)

> Síntesis de 3 agentes (2026-06-17): modelo operativo SDR, stack de tooling 2026,
> métricas/coaching/AI-shift. Todo en inglés, mapeado a SCM.
>
> **La realización grande:** SCM ya tiene el STACK TÉCNICO que la mayoría de equipos
> SDR paga carísimo (dialer con autopiloto, enrichment, IA live assist, transcripts,
> WhatsApp nativo) y va ADELANTE para SMB local LatAm. **El gap NO es tecnología — es
> la capa de PROCESO y GESTIÓN.** Y los vendedores llegan pronto → esta capa es urgente.

---

## Dónde SCM ya está adelante del stack comercial (no tocar)

- Enrichment de SMB local LatAm/España (ZoomInfo/Apollo no llegan).
- WhatsApp como canal de primera clase (ninguna tool gringa lo trata así).
- Transcripción de cold-call telefónico (Gong/Chorus/Fireflies NO cubren bien el blitz desde teléfono).
- Live assist de objeciones (Mercury) — feature premium de Nooks/Gong, ya lo tiene.
- Costo marginal $0/seat al escalar reps (el stack comercial son $700-1900/mes/seat).

## El gap real = proceso codificado en software + capa de gestión

### P0 — Mayor leverage, convergente en los 3 agentes

1. **Regla de persistencia + alerta de leads abandonados** [la mayor fuga]. Dato: 92% de los reps abandonan al 4º intento, pero al **3er intento ya capturás el 93%** de las conversaciones posibles; 95% de los convertidos se alcanzan al 6º. **SCM hoy hace lo CONTRARIO**: el `_callScore` PENALIZA los intentos. Hay que **invertir**: empujar leads con 1-2 intentos, bloquear/advertir el descarte antes de N (5-6), filtro "abandonados temprano". Lógica de backend sobre el callLog que ya existe.

2. **Auto-disposition desde transcript (Whisper→LLM)** [mayor ROI / menor esfuerzo]. Ya tenés transcripts + Mercury. Un prompt lee el segment setter/lead y propone outcome + razón + next step. Quita fricción, mejora la calidad del dato del funnel, alimenta el scoring. Días de trabajo sobre infra existente.

3. **Cadencia multicanal unificada call+WhatsApp** sobre el mismo lead. Hoy Power Dialer y campañas WA están SEPARADOS. Unirlos en una cadencia de 9-12 toques front-loaded (días 1-3 fuertes): auto-disparar WhatsApp template tras `no_answer`/`voicemail` el mismo día (el motor ya emite `followup:send-message`). Multicanal convierte 4-7% vs 2% single-channel.

4. **Dashboard de equipo cold-call con benchmarks** [no podés gestionar sin esto]. Replicar `view-team` para el embudo SDR (connect/conversation/meeting/close por rep) **con la barra de benchmark 2026 al lado**: connect SMB **15-25%** (tu ventaja: llamás al dueño, no a un CFO), 12-15 reuniones/mes, show 70-80%. Ya tenés casi toda la data (cold-call-metrics); es agregación + UI.

### P1 — Capa de gestión para onboardear reps (llegan pronto)

5. **Role-play IA como certification gate + quota graduada**. Mercury hace de dueño de clínica con objeciones; el rep nuevo practica ANTES de discar leads reales (patrón Hyperbound, -60% ramp). Quota 0%/50%/75-100% por semana. **Protege tus leads caros (scraping+enrich) de manos verdes.** Reusa Mercury + Centro de Entrenamiento (que ya tiene quizzes = gate de conocimiento; falta gate de skill).

6. **Scorecard de calidad + cola de coaching sobre transcripts**. Mercury puntúa cada transcript (rapport, preguntas abiertas, manejo de objeción, talk-ratio) y arma la cola semanal de 3-5 llamadas a revisar (deals perdidos + primeras de nuevos). Convierte transcripts de archivo muerto en motor de coaching. Documentado: +27% deals, +38% conversión.

7. **BANT-lite en disposition + recordatorios de no-show**. Checklist decisor/dolor/timeline antes de marcar agendado (sube qualification accuracy a 60-75%). Secuencia automática 48h/24h/mismo-día por WhatsApp con confirmación bidireccional (baja no-shows ~28%). Reusa calendar + WhatsApp.

8. **Leaderboard de doble eje + comp tracker**. Ranking de volumen Y de calidad ("Quality King" por meeting→deal). Comp variable atado a **reunión presentada / deal cerrado**, NO a booked (sino te llenan de basura). Alinea incentivo con el north-star desde día 1.

### P2 — Productividad pura de cold call

9. **Voicemail drop + local presence por ciudad + number rotation**. Local presence sube connect ~4x. Tenés `countryRouting`; extender a área/ciudad + rotación con monitoreo "spam likely". VM drop ahorra segundos × cientos de buzones.
10. **Cola "speed-to-lead"** de leads frescos del día al tope (78% compra al primer responder; <5min = +391%).
11. **Modo "call block"** con meta + progreso (40 dials/2h) alineado a horarios óptimos por país (Mar-Jue 10-11h y 16-17h hora local).

### P3 — Apuesta de alto techo (pilotear, no apostar la casa)

12. **Parallel dialer con AMD nativo de Telnyx**. Disca 3-10 a la vez, AMD (97% precisión Telnyx) filtra buzones, bridge el primer humano al WebRTC del rep. **3-5x dials** PERO: connect rate cae a la mitad en meses, conversión peor (power 6.4% vs parallel 3.8%), talk-time baja, "connection lag", y requiere migrar a **Call Control API server-side** (no el credential-auth WebRTC actual). Límites: cuenta nueva 2 concurrentes, CPS surcharge. **Veredicto: mayor techo pero PEOR ROI inmediato para team lean high-touch.** Pilotear con 2 líneas y medir antes de comprometer.

---

## Benchmarks 2026 de referencia (para el dashboard)

- Connect rate SMB-local (tu caso, dueño de clínica): **15-25%** (top 25%+). Genérico B2B 8-12%.
- Conversation rate (una vez conectado): 50-60% (top 70-85%).
- Conversation→meeting: 10-15% (top 20-30%).
- ~1 reunión cada 33-50 dials. Meetings/mes: 12-15 (top 20-25).
- Show rate: 70-80% (top 85-90%). Meeting→opportunity: 40-60% (top 60-75%).
- Persistencia: 3er intento = 93% de las conversaciones posibles. Ramp: 6-8 sem con onboarding estructurado.
- Comp: ~64% base / 36% variable. $75-200 por reunión calificada / $150-500 por oportunidad.

---

## Cómo se conecta con Phase 10/11

- **Phase 10** (lead quality/enrichment) = hace los LEADS mejores (el arsenal).
- **Phase 11** (battlecards) = hace el QUÉ DECIR mejor.
- **Phase 12** (este) = hace al REP/EQUIPO efectivo + protege los leads + gestión.

Los tres se refuerzan. Pero el trigger "llegan vendedores pronto" empuja a priorizar de Phase 12 lo que hace al rep nuevo productivo rápido y no quema leads: **dashboard con benchmarks, role-play+ramp, regla de persistencia, scorecard de coaching.**

---

## Estado

- 2026-06-17 — Phase 12 sintetizada de 3 agentes (operación SDR + tooling + métricas).
  Pendiente: el user decide el sequencing entre Phase 10/11/12 (los reps llegan pronto).

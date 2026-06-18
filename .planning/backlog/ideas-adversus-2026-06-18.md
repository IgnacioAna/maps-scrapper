# Ideas de UX desde Adversus (cold-call CRM) — 2026-06-18

> El user compartió un screenshot de Adversus (power-dialer B2B). Ideas aplicables a nuestro
> call center de clínicas. Capturadas para priorizar DESPUÉS del testeo. NO construido aún.

## Vale la pena (prioridad sugerida)

1. **Flag "No llamar / DNC" (blocklist) explícito** — ALTA (compliance).
   - Adversus tiene "Blocklist lead" separado de descartar.
   - Para nosotros = compliance del expansión internacional: DNC/TPS (UE/UK), CASL (Canadá), DNC (USA) — ver `.planning/research/2026-06-17-scraping-expansion.md` (sección legal).
   - Propuesta: `lead.doNotCall = true` + razón + fecha + quién. Lo saca de TODA cola (Power Dialer, sin-wsp, distribución) para siempre. Distinto de `descartado` (que es por-campaña) y de `phoneStatus` (wrong/invalid).
   - Esfuerzo: bajo-medio. 1 flag + filtros + botón en disposition.

2. **Quick-links grandes durante la llamada** — BAJA (UX).
   - Botones prominentes Web / Google Maps / Instagram (+ NPI profile USA) en el panel de llamada activa.
   - Hoy están en `_renderLeadFile` pero poco visibles. Hacerlos botones grandes ahorra segundos/llamada.
   - Esfuerzo: bajo (solo layout).

3. **Activity timeline unificada por lead** — MEDIA (UX).
   - Adversus: tabs Timeline / Notes / Calls / Messages en un panel lateral.
   - Hoy tenemos historial de llamadas (view-call-history) + notas[] + callLog separados. Unificar en un timeline por-lead visible durante la llamada.
   - Esfuerzo: medio (agregar panel + merge de callLog/notes/interactions ordenado por fecha).

## Ronda 2 — capturas en vivo durante demo (2026-06-18)

4. **Status con RAZÓN obligatoria condicional (disqualification reasons)** — ALTA (analytics + data quality). ⭐ el mejor hallazgo.
   - Al elegir Status="Unqualified", aparece campo requerido **"Razón de unqualified*"** (dropdown). Sin esto no se guarda.
   - Taxonomía que usan (adaptable a clínicas): *No es ICP · No es Buyer · Ya no trabaja más ahí · Sin poder de decisión · No contactar a su número personal · Cliente actual · Ex-cliente con mala experiencia · Ya se agendó reunión con esta empresa*.
   - Por qué importa: hoy nuestros outcomes dicen QUÉ pasó (no atendió, no interesado) pero no POR QUÉ se pierde. Capturar la razón estructurada = saber si el problema es la lista (no-ICP), el pitch, o el timing. Reporting de "razones de pérdida".
   - Sinergia: varias razones mapean a acciones — "No contactar a su número personal" / "Ex-cliente mala experiencia" → candidatos a DNC (idea #1). "Cliente actual" / "Ya se agendó" → sacar de la cola sin marcar como perdido.
   - Propuesta: `lead.disqualifyReason` + dropdown condicional cuando outcome = no_interesado/unqualified. Editable la lista de razones (como las battlecards). Reporte en el Cold Call Funnel.
   - Esfuerzo: medio. Dropdown condicional en disposition + persistir + agregación.

5. **Auto-redial + Shared vs Private callback** — MEDIA.
   - **Aut. redial**: si no atiende, el sistema reintenta solo más tarde (cadencia automática), sin que el setter agende a mano. Hoy tenemos callback manual + follow-ups.
   - **Shared callback vs Private callback**: un callback puede ser *privado* (solo el setter que lo agendó) o *compartido* (cualquiera lo puede tomar). Cola de callbacks compartida = no se pierde el lead si el setter no está. Hoy el callback está atado al dueño del lead.
   - El timeline loguea la disposición + **"Next call is @ fecha hora"** (refina idea #3: el timeline muestra la próxima acción agendada).
   - Propuesta: `lead.callbackShared` (bool) + cola de callbacks compartidos en view-calls; cadencia de auto-redial opcional por outcome no_answer.
   - Esfuerzo: medio-alto (auto-redial toca el motor de discado).

## Ronda 3 — estructura/nav (2026-06-18)

6. **"Journeys" = constructor de cadencias de contacto** — MEDIA/ALTA (generaliza el auto-redial de idea #5).
   - Flujo configurable: llamada → no atiende → esperar Xh → reintentar (hasta N) → buzón → SMS/WA → sin respuesta → reasignar/DNC.
   - Es el motor de cadencia. La parte SDR (reintentos de llamada por outcome) NO depende de bots. La parte multicanal (SMS/WA auto) sí toca el módulo WA parkeado / Phase 7 (campañas drip).
   - Propuesta incremental: arrancar por cadencia de SOLO-llamada (reglas por outcome: no_answer → +2h x3; voicemail → +1d) antes de meter multicanal. Reusa scheduledMessages/followups que ya existen.
   - Nota: el resto del nav de Adversus (Dialer/Users/Insights/Warehouse/Leads/Messages/Settings) ya tiene equivalente nuestro. "Changelog" (feed de novedades para el equipo) = idea menor, hoy suplido por la Guía.

## NO aplica (otro vertical)
- Campos firmográficos (Company Size/Domain/Industry/Specialities/LinkedIn): son para vender SaaS a empresas. Nuestro vertical = clínicas locales (rating/reseñas/web/IG/doctor). Excepción: `specialty` ya lo sacamos del NPI (USA).

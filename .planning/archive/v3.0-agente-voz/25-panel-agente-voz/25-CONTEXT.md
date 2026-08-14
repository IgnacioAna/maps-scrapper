# Phase 25: Panel Agente de voz - Context

**Gathered:** 2026-08-01
**Status:** Ready for planning (depende de Phase 24)
**Research base:** `.planning/research/2026-08-01-agente-voz-retell.md` (§3)

<domain>
## Phase Boundary

El user opera el agente desde el panel sin tocar API ni consola: ve el
estado de la config, arma un lote (cantidad, país, filtro con/sin nombre de
doctor), ve el gasto estimado, dispara, y ve resultados. Cubre VOICE-07.

NO incluye: métricas nuevas (la comparativa vive en Equipo/Comando vía el
pseudo-SDR de la Phase 24), el prompt del agente (Phase 26).

</domain>

<decisions>
## Implementation Decisions

- **D-25-01 — Sección propia** (pedido explícito del user: "una sección que
  sea agente de voz y ahí esté todo"). Vista `view-voice-agent` en el
  sidebar (grupo Administración, `data-roles="admin"`) o card grande
  primera en Comando — decidir en plan-phase mirando el espacio real; el
  user pidió "sección propia", default: vista propia.
- **D-25-02 — Config visible con locks.** Patrón de Centralita Telnyx:
  campos env-sourced muestran 🔒 y no se editan; agentId/dailyCap/enabled/
  fromNumberId editables. Estado del webhook (último evento recibido,
  rechazos) como diagnóstico — patrón `webhook-health`.
- **D-25-03 — Armador de lote**: cantidad (input), país (dropdown de países
  con leads del agente), filtro "solo con nombre de doctor" (checkbox).
  Muestra ANTES de disparar: cuántos leads elegibles hay y el gasto
  estimado (count × duración estimada × tarifa aproximada). Confirmación
  explícita de gasto (patrón de los botones COST del Comando). El disparo
  llama al dispatch de la Phase 24 y muestra el resultado por lead
  (aceptado/rechazado y por qué).
- **D-25-04 — Resultados**: llamadas de hoy del agente (contador vs
  dailyCap) + últimas N llamadas con outcome/duración/link al lead. Sin
  charts nuevos: para comparar, el user va a Equipo/Comando donde el
  agente ya es una fila.
- **D-25-05 — Cache-buster** bumpeado (app.js + index.html; style.css solo
  si se toca — preferir clases existentes del design system, patrón #114).
- **D-25-06 — Todo fetch de la vista** usa `apiUrl()` si la vista fuera
  visible para supervisor (no lo es: admin-only → fetch normal está OK,
  pero documentarlo).

</decisions>

<specifics>
## Specific Ideas

- El botón de lote deshabilitado con hint cuando: config incompleta (sin
  apiKey/agentId), `enabled:false`, dailyCap agotado, o 0 leads elegibles.
  El diagnóstico de "qué falta" es la UI (patrón del chip "Sin configurar"
  del panel del reporte diario, 21-04).
- Recordatorio en la UI: los leads del agente se asignan desde la vista
  Distribución (pool-distribute → destino "Agente IA") — link directo.
</specifics>

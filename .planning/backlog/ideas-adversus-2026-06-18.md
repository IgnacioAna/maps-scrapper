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

## NO aplica (otro vertical)
- Campos firmográficos (Company Size/Domain/Industry/Specialities/LinkedIn): son para vender SaaS a empresas. Nuestro vertical = clínicas locales (rating/reseñas/web/IG/doctor). Excepción: `specialty` ya lo sacamos del NPI (USA).

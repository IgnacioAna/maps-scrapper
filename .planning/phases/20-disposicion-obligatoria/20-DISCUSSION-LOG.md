# Phase 20: Disposición obligatoria - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-25
**Phase:** 20-disposicion-obligatoria
**Areas discussed:** Forma del enforcement, Ventana de 10 min del audio, Llamadas viejas sin marcar, Anti-disposición falsa

---

## Forma del enforcement — mecanismo principal

| Option | Description | Selected |
|--------|-------------|----------|
| Bloqueo de discado + cola | Sin modal intrusivo: no se puede iniciar OTRA llamada mientras haya una sin marcar (banner persistente) + cola de pendientes al abrir el panel | ✓ |
| Modal bloqueante duro | Modal que tapa todo al colgar; cerrar el tab igual lo escapa | |
| Solo cola de pendientes | Nada en vivo; resolver al iniciar sesión | |

**User's choice:** Bloqueo de discado + cola (opción recomendada)

## Forma del enforcement — auto-marca

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-marcar no-contacto | Llamada que nunca llegó a 'active' → "No atendió" automático; SDR corrige si quiere | ✓ |
| Todas manuales | Cada dial exige marca del SDR | |
| Auto-marcar solo tras timeout | Híbrido con gracia de segundos | |

**User's choice:** Auto-marcar no-contacto (opción recomendada)

## Forma del enforcement — cola al login

| Option | Description | Selected |
|--------|-------------|----------|
| Bloquea el discado | No disca hasta resolver pendientes viejas | |
| Solo recordatorio | Franja visible, puede seguir discando | ✓ |
| Overlay total | Panel inutilizable hasta vaciar la cola | |

**User's choice:** Solo recordatorio — respuesta freeform: la SDR maneja el
criterio de prioridades; el sistema no debe trabarla para tomar decisiones.
Confirmado explícitamente tras re-explicación en lenguaje simple ("si asi
me cierra, dale"). **La única traba dura es la del vivo** (marcar la
recién cortada antes de discar la siguiente).

## Ventana de 10 min del audio

| Option | Description | Selected |
|--------|-------------|----------|
| Dejarla como está | El enforcement en vivo ya salva el caso típico; marcar tarde pierde solo la grabación | ✓ |
| Avisar antes de descartar | Contador visible de descarte | |
| Estirar a 30 min | Más margen, más memoria retenida | |

**User's choice:** Dejarla como está (opción recomendada)

## Llamadas viejas sin marcar

| Option | Description | Selected |
|--------|-------------|----------|
| Arrancar de cero | Regla solo para llamadas nuevas post-deploy | ✓ |
| Reconstruir desde Telnyx | Cruzar CDRs para crear pendientes del pasado | |
| Solo medir el hueco viejo | Análisis one-shot CDRs vs callLog, sin acción de SDRs | |

**User's choice:** Arrancar de cero (opción recomendada)

## Anti-disposición falsa

| Option | Description | Selected |
|--------|-------------|----------|
| Auditoría pasiva | Distribución de resultados por SDR + cruce duración-vs-resultado; cero fricción extra | ✓ |
| Fricción dirigida | Motivo obligatorio en resultados de descarte | |
| Confiar y nada más | Sin controles automáticos | |

**User's choice:** Auditoría pasiva (opción recomendada)

## Claude's Discretion

- Mecanismo técnico del registro de llamada pendiente (server-side vs client + sync)
- Detalle visual del banner y la franja recordatorio (UI minimalista sin emojis)
- Aplicación del bloqueo a admin/supervisor (sugerido: sí)
- Discados ad-hoc sin lead
- Umbrales del cruce duración-vs-resultado

## Deferred Ideas

- Hardening del reporte semanal (WR-01/02/03 del review de Phase 19) → Phase 21
- Cruce outcome-vs-transcript con IA → ya es Phase 22

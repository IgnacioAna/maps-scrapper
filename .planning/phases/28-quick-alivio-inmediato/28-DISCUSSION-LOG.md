# Phase 28: QUICK — Alivio inmediato - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-14
**Phase:** 28-QUICK — Alivio inmediato
**Areas discussed:** Dónde va el calendario, Cómo se ve y elige la hora, Qué paneles se mueven, Memoria de posición, Hora local del lead, Carga por día

---

## Dónde va el calendario

| Option | Description | Selected |
|--------|-------------|----------|
| En los 5 lugares (Recomendado) | Un solo componente reutilizado en callback, agendar ×2, hold por mail y mensaje programado | ✓ |
| Solo en el callback | El lugar que más usa; los demás quedan nativos | |
| Callback + agendar reunión | Los dos que se usan durante llamada en vivo | |

**User's choice:** En los 5 lugares.

---

## Cómo se ve y elige la hora

| Option | Description | Selected |
|--------|-------------|----------|
| Siempre a la vista (Recomendado) | Mes abierto directo en el modal | |
| Se abre al tocar el campo | Popover; modal compacto, un click más | ✓ |

| Option | Description | Selected |
|--------|-------------|----------|
| Franjas + ajuste fino (Recomendado) | Botones de horas laborales + campo para afinar minutos | ✓ |
| Campo de hora simple | Día en calendario, hora en input HH:MM | |
| Lista desplegable cada 30 min | Dropdown tipo Calendly | |

| Option | Description | Selected |
|--------|-------------|----------|
| En el calendario y al confirmar (Recomendado) | "faltan N días" en hover de cada día + confirmación fija | |
| Solo al confirmar | La etiqueta relativa aparece recién al elegir | ✓ |

| Option | Description | Selected |
|--------|-------------|----------|
| Afuera, como están (Recomendado) | Los atajos siguen siendo botones directos en el modal | ✓ |
| Adentro del calendario | Se mudan arriba del popover | |

**User's choice:** Popover + franjas con ajuste fino + etiqueta solo al confirmar + atajos afuera.
**Notes:** En las dos preguntas donde no eligió la recomendación (popover, etiqueta solo al confirmar) prefirió lo más limpio/compacto sobre lo más asistido.

---

## Qué paneles se mueven

| Option | Description | Selected |
|--------|-------------|----------|
| Los dos (Recomendado) | Panel principal y panel de guiones, cada uno por su lado | ✓ |
| Solo el principal | Timer/colgar se mueve; guiones fijo | |
| Solo el de guiones | El que más tapa; principal centrado | |

| Option | Description | Selected |
|--------|-------------|----------|
| Desde la barra de arriba (Recomendado) | Header del panel, patrón de ventanas clásico | ✓ |
| Desde cualquier parte vacía | Más cómodo, más arrastres accidentales | |

**User's choice:** Los dos paneles, agarre desde el header.

---

## Memoria de posición

| Option | Description | Selected |
|--------|-------------|----------|
| Para siempre (Recomendado) | localStorage + botón para volver al centro | ✓ |
| Solo durante la sesión | Hasta recargar la página | |
| Vuelve al centro siempre | Cada llamada arranca centrada | |

| Option | Description | Selected |
|--------|-------------|----------|
| Solo si no lo moviste (Recomendado) | El empuje automático de guiones sigue hasta que el user arrastra; después manda su posición | ✓ |
| Eliminar el empuje | El principal nunca más se corre solo | |

**User's choice:** Posición recordada para siempre + empuje solo mientras no haya posición guardada.

---

## Hora local del lead (área agregada por el user en la exploración extra)

| Option | Description | Selected |
|--------|-------------|----------|
| Mostrar + avisar (Recomendado) | Equivalencia + ámbar si cae fuera de 9-19h local | |
| Solo mostrar | Ve la equivalencia y decide él, sin colores | ✓ |

**User's choice:** Solo mostrar.

---

## Carga por día (área agregada por el user en la exploración extra)

| Option | Description | Selected |
|--------|-------------|----------|
| Callbacks + reuniones (Recomendado) | Promesas reales; los reintentos de cadencia no cuentan | ✓ |
| Todo lo que vence ese día | Incluye reintentos automáticos | |
| Solo callbacks manuales | El número más estricto | |

**User's choice:** Callbacks + reuniones.

---

## Claude's Discretion

- Diseño visual del calendario dentro del Design System v1.1
- Clamping del drag al viewport
- Fuente de datos de la carga por día (lo que no agregue latencia)
- Accesibilidad del popover (Esc, click afuera)

## Deferred Ideas

None — las dos ideas surgidas en la exploración extra (hora local, carga
por día) se incorporaron a la fase por decisión del user.

# Medición de guiones de llamada — no se puede atribuir un resultado a un script

> Anotado 2026-08-16. **Prioridad: después del milestone v4.0.**
> Origen: requisito traído por el user (sesión paralela). Todo lo de acá está
> **verificado contra `data/setters.json`** (1.206 entradas de callLog,
> 6.413 leads) — los números no son estimaciones.
> Detalle del embudo con línea de base: `Segundo Cerebro/skills/coach-llamadas/medicion/embudo.md`

## El problema

Nacho va a testear guiones por ciclos. Hoy, si prueba un opener en un ciclo y
otro en el siguiente, al final tiene dos montones de resultados que **no se
pueden comparar**: cambiaron el guion, los países, la hora y los leads a la
vez. No hay forma de aislar el efecto del script.

`data/call_scripts.json` tiene 22 guiones con `id` (5 rutas de gatekeeper, 3
formas de pedir la reunión, 7 rebatidas). El callLog guarda el resultado pero
no cuál de los 22 se usó.

## Hueco 1 — No se registra qué script se usó

**Verificado: 0 de 1.206 entradas del callLog tienen `scriptId`.** El campo
no existe.

Mínimo necesario: que el entry guarde el id del script activo en el momento
de marcar el resultado. El panel de guiones ya sabe cuál está abierto
(`#telnyx-script-panel`), así que el dato está disponible en el cliente — es
cuestión de mandarlo en el `call-disposition`.

## Hueco 2 — "Agendada" — RESUELTO, NO es un agujero de datos

El requisito pedía averiguar si el agendamiento se registra por otra vía
antes de agregar un outcome nuevo. **Averiguado: se registra bien, en tres
lugares, y los tres coinciden.**

| Vía | Cantidad |
|---|---|
| `scheduled_with_admin` en callLog | 2 |
| Leads con `estado='agendado'` | 2 |
| Entradas en `data.calendar` | 4 (2 cancelada · 1 realizada · 1 pendiente) |
| De esas, con `sourceCall` (vinculada a la llamada) | 2 |

Si el agendamiento estuviera ocurriendo y registrándose por otro canal, el
calendario tendría decenas de entradas y el outcome dos. Tiene cuatro.

**Conclusión: la infraestructura de medición funciona; lo que casi no hay son
agendas.** 2 reuniones sobre 311 conversaciones conectadas = **0,6%**, contra
un benchmark de 15-25%.

Eso mueve el problema aguas arriba: no es que falte un outcome, es que falta
el resultado. **No hay nada que construir acá.** Cuando el volumen suba, el
cruce llamada→reunión ya existe vía `sourceCall`.

## Hueco 3 — Hasta dónde llegó la llamada (el más valioso)

**Verificado: 0 de 1.206 entradas registran la etapa alcanzada.**

Hoy no se puede distinguir "atendió la recepción y me cortó" de "atendió la
recepción y me pasó con el doctor". Las dos caen en outcomes distintos por
casualidad, no por diseño.

Es **el paso de mayor volumen del embudo y el único con números suficientes
para comparar guiones**: 311 conversaciones conectadas contra 2 agendas. Sin
esto hay que leer transcripciones a mano.

Propuesta: un campo independiente del outcome que registre hasta dónde llegó
—contestador / recepción / decisor—, ortogonal a cómo terminó. Un mismo
outcome (`hung_up`) significa cosas muy distintas según si cortó la
recepcionista o el doctor.

## Hueco 4 — El tramo posterior a colgar

El funnel real sigue después de la llamada: se manda el WhatsApp con la
calculadora, el prospecto carga sus números, eso le avisa, y con ese dato
encara la segunda llamada. Nada de eso queda registrado.

**La Phase 32 (en curso) resuelve la mitad**: el botón de WhatsApp registra
el envío como evento del lead y crea el compromiso. Lo que falta es el
**retorno** —si abrió la calculadora—, que depende de la landing, no del
dialer.

## Orden sugerido cuando se retome

1. **Hueco 3** (etapa alcanzada) — el de mayor retorno: da volumen suficiente
   para comparar guiones desde el primer ciclo.
2. **Hueco 1** (scriptId) — barato, y sin él el hueco 3 no se puede atribuir.
3. **Hueco 4** (retorno de la calculadora) — depende de la landing.
4. **Hueco 2** — nada que hacer.

## Advertencia de método

Con 311 conversaciones totales, un ciclo de prueba de un guion va a tener
pocas decenas de casos. **Dos guiones que difieran 5 puntos porcentuales no
van a ser distinguibles del ruido** con ese volumen. Conviene decidir de
antemano cuántas llamadas necesita cada variante antes de declarar un
ganador, o el sistema va a producir conclusiones falsas con apariencia de
dato.

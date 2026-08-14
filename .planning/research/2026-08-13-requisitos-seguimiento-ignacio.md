# Requisitos del rediseño de seguimiento — dichos por Ignacio (2026-08-13)

> Capturado de viva voz. **Esta es la fuente de verdad de qué duele**, por
> encima del research y de mi propuesta de fases. Si algo del plan contradice
> esto, gana esto.

---

## 0. El objetivo real, en sus palabras

> "Ordenarlo para yo poder ahora trabajar todos los leads y usar la
> información que ya hay cargada de ellos, o sea, de lo que trabajaron las
> vendedoras."

No es un proyecto de métricas ni de higiene de pipeline. Es: **poder trabajar
la base entero él solo, sin perder nada, apoyándose en el historial que ya
existe.** La higiene se entiende y se acepta, pero es consecuencia, no meta.

---

## R1 — El historial de las vendedoras es un activo, no basura

Muchos leads ya fueron trabajados por Paula, Judith, Brenda, Teresa, Melissa.
Tienen notas, tienen "interesado", tienen transcripciones. **Llamar a ese lead
no es una llamada en frío** y el sistema tiene que dejarlo claro *antes* de
discar, no enterrado en un panel.

- Al abrir/discar un lead se tiene que ver de una: quién lo trabajó, qué dijo,
  qué se le anotó, en qué quedó.
- **No borrar ni resetear esa información** al redistribuir.

## R2 — El Power Dialer es la herramienta principal, pero está aislada

> "El power dialer, me gusta mucho usarlo, pero no conecta bien con el resto."

Tres problemas concretos:

1. **No se puede lanzar el Power Dialer sobre un lead puntual.** Está viendo un
   lead en una lista, quiere discarlo en modo dialer, y no puede: el botón
   arranca la cola desde el principio.
2. **Al marcar un resultado el lead desaparece y no lo puede volver a llamar.**
   (Ojo: parte de esto es *diseño actual* — los callbacks manuales salen de
   Llamadas y pasan a vivir en Hoy. Pero el efecto vivido es "se me perdió".
   El rediseño tiene que hacer obvio a dónde se fue y cómo volver.)
3. **Falta conexión entre Power Dialer ↔ Hoy ↔ Llamadas.** Se siente como tres
   herramientas distintas en vez de una.

## R3 — La vista Hoy es caótica y poco intuitiva

> "Está muy mezclado todo", "es como muy caótico".

- Reordenar y separar con criterio (el orden opinado del research).
- **Poder dividir/filtrar Hoy por país** — por zona horaria: saber a quién se
  puede llamar *ahora*. Pedido explícito.

## R4 — Botón de mandar mensaje/info, en todos lados

- Botón de WhatsApp visible desde cualquier lugar donde vea el lead (lista,
  Power Dialer, ficha, Hoy).
- **Tiene que poder mandar a un número alternativo**: pasa seguido que el
  número que llamó no tiene WhatsApp y le pasan otro en la llamada. Ese número
  nuevo se carga en el momento y desde ahí mismo se le manda.
- Manda **él, a mano** (`wa.me` con el mensaje precargado) — acepta esto y no
  necesita envío automático.
- Lo que sí necesita es que **quede registrado que a esa persona ya le mandó
  información**, para poder hacerle seguimiento después.
- Le interesaba wa-multi justamente por el registro; si el botón ya deja el
  registro, con eso alcanza.

## R5 — Botón de descartar desde todos lados

Un botón para descartar el lead **desde cualquier vista**, y que desaparezca de
todas las listas de una. Caso típico: se da cuenta de que no es una clínica.
Hoy tiene que entrar a una vista específica para sacarlo de circulación.

## R6 — Las fichas del lead son poco prácticas para llamar

> "Las fichas, las vistas están mal, son poco prácticas o poco lindas para
> llamar al lead directamente, o capaz que falta información."

Rediseñar la ficha con foco en: qué necesito ver en los 3 segundos antes de
que atiendan.

## R7 — Calendario real al programar un callback

Hoy el modal de "Volver a llamar" usa un `<input type="datetime-local">`
(widget nativo del browser, chico, sin mes a la vista) → termina **contando
días a mano** para saber cuándo cae la fecha que pactó.

- Calendario propio, con el mes visible y clickeable.
- Etiquetas relativas ("en 3 días", "el martes") además de la fecha.
- Conservar los atajos rápidos que ya existen (`#call-cb-quickpicks`).

## R8 — El panel de llamada tiene que ser movible

El panel que aparece al llamar (info del lead, guion) está **fijo al centro**
(`position:fixed` + `transform` fijo) y tapa lo que hay detrás. Quiere poder
agarrarlo y correrlo.

- Arrastrable, y que recuerde dónde lo dejó.
- ⚠️ Ojo al implementar: existe una regla CSS
  (`body.tlx-script-open #telnyx-call-panel`) que **reposiciona el panel sola**
  cuando se abre el de guiones. Pelea con el arrastre — hay que resolver las
  dos cosas juntas o el panel va a saltar después de moverlo.

---

## Decisiones ya tomadas

| Tema | Decisión |
|---|---|
| Alcance del milestone | **Las 5 fases completas.** Sin la extracción IA de compromisos |
| Canal de salida WhatsApp | `wa.me` manual + registro. **No** hace falta envío automático |
| wa-multi | No se usa para mandar. Queda como opción futura para *detectar respuestas* |
| Historial de las vendedoras | Se conserva y se pone al frente |

## Contexto medido de su base (12/08)

- 36 interesados activos · mediana de **21 días** desde que dijeron que sí
- 16 callbacks manuales, **12 vencidos**
- ~52 en seguimiento activo → banda sana para una persona, sin margen
- 137 leads ya trabajados sin próxima acción ← el invariante aplica **solo a
  leads tocados**, nunca al stock virgen (3.699, sería ruido)
- 3 leads con `followUps` viejo → migración trivial

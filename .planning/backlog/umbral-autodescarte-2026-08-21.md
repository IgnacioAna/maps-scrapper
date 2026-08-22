# Umbral de auto-descarte: el número antes de decidir

> Medido el 2026-08-21 sobre `data/setters.json` del commit `e13659c`
> (17/08 16:35). **No implementar nada con esto todavía** — es el dato para
> que la decisión se tome con el número adelante cuando la base sin tocar
> se agote.

## Lo que hay hoy

| Razón de auto-descarte | Leads | Regla |
|---|---:|---|
| `sin_contacto_2x` | **249** | 2 "no atendió"/buzón seguidos (`MAX_NO_CONTACT`, index.js) |
| `cortes_2x` | **8** | 2 "me cortó" del mismo SDR (`MAX_HUNG_UP`) |
| *(no hay otras razones en la base)* | | |

El tope de no-contacto se bajó de 3 a 2 el **25/06** para reducir la tasa de
abandono de Telnyx y su recargo asociado. Es una razón real, no una
preferencia: cada reintento a un número muerto es otra llamada abandonada.

## Por qué todavía no toca cambiarlo

- **88,3% de la base nunca recibió una sola llamada**: 5.665 de 6.413 leads
  con `callLog` vacío.
- **1.067 leads con cero marcaciones** en tres países enteros: Chile (576),
  Ecuador (312) y Costa Rica (179) — ninguno fue discado nunca.

Mientras haya base sin tocar, descartar a los dos intentos puede ser
correcto: el costo de oportunidad de insistir es más alto que el de pasar al
siguiente.

## Cuándo revisarlo

Cuando la base sin tocar se agote (o baje lo suficiente como para que
reponer stock cueste más que insistir), la pregunta pasa a ser: **de los 249
descartados por no-contacto, ¿cuántos habrían atendido al tercer intento?**
Eso no se puede responder con los datos actuales — habría que levantar una
muestra de esos 249 y volver a llamarlos.

Dato para esa medición futura: los interesados ya están exentos de los dos
auto-descartes (fix del 16/08), así que el universo de 249 es todo lead frío.

## Qué NO hacer

- No subir el umbral "porque sí": vuelve el problema de la tasa de abandono.
- No confundirlo con la cadencia del lead (`racha` en index.js:12457+): eso
  es el reloj de reintentos, no el tope.

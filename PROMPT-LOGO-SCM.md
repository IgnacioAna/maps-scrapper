# Prompts para generar el símbolo y el favicon de SCM

> Fecha: 2026-08-15 · Base: `BRAND-SCM.md` (verde bosque `#3FA872`,
> concepto rector "el instrumento que te deja llamar tranquilo").
> **Alcance: solo el símbolo.** El wordmark es tipográfico (mono, sin
> inicial destacada) y no se genera con IA.

## Antes de pegar nada

| Herramienta | Sirve |
|---|---|
| **Recraft V3** | ✅ La mejor. Genera **SVG vectorial real**, editable, con paleta fija |
| **Ideogram** | ✅ Buena para marca, respeta texto si hiciera falta |
| Midjourney / DALL·E | ❌ Generan *imágenes de* logos: bordes sucios, asimetría, sin vector |

Pedir **siempre el símbolo solo, sin letras**. El wordmark en tipografía
mono ya está resuelto y no necesita IA.

---

## Prompt base (pegar tal cual, en inglés)

```
Minimalist geometric app icon for a B2B sales-calling software called SCM.
Single symbol only, no text, no letters.

Concept: an instrument that confirms a number is safe to call before dialing.
It should feel like calm operational confidence, precision and permission,
never speed or aggression.

Style: flat vector, dark-first UI icon in the visual language of Linear,
Vercel and Stripe. Strict geometric construction, consistent stroke weight,
generous negative space, optically balanced, perfectly symmetrical where the
form allows. Designed on an even grid. Readable at 16 pixels.

Color: single accent #3FA872 (forest green) on a #141619 near-black
background. No other colors.

Strictly avoid: telephone handsets, headsets, call-center clichés, speech
bubbles, rockets, gears, lightning bolts, checkmarks in circles, globes,
purple or blue gradients, glow, neon, bevels, 3D, drop shadows, texture,
mascots, any letterform.
```

## Tres direcciones para agregar al final del prompt

Correr las tres por separado y comparar. La **A** es la más defendible: es
literalmente lo que el operador ve en el producto.

**A · El punto de estado** (recomendada)
```
Direction: a solid filled dot with one or two concentric rings expanding
outward, like a status indicator that has turned green. The rings are open
arcs, not closed circles.
```

**B · La progresión**
```
Direction: three or four vertical bars of increasing height forming a
forward chevron, suggesting a sequence advancing cleanly through a list.
```

**C · El filtro**
```
Direction: a rounded square outline with one segment of its border removed,
and a single dot passing through the opening, suggesting a gate that lets
the right item through.
```

## Qué exigirle a la salida

1. **Que funcione a 16 px.** Achicarlo en el navegador. Si se convierte en
   una mancha, no sirve por más lindo que se vea a 512.
2. **Un solo peso de trazo.** Si tiene líneas finas y gruesas mezcladas,
   está mal construido.
3. **Que se lea en un solo color plano.** Sin degradado, sin sombra.
4. **Que no dependa del fondo oscuro.** Probarlo también en `#F2F4F5`: va a
   ir en la pestaña del navegador y ahí no controlás el fondo.
5. **Que no se parezca al de Vincca.** Vincca es la V bronce sobre noche.
   Nada de inicial destacada acá.

## Favicon

Del símbolo elegido, exportar:
- `favicon.svg` — el símbolo en `#3FA872` sobre `#141619`, con esquinas
  redondeadas de radio 18% del lado.
- `favicon-transparente.svg` — el mismo símbolo sin fondo, para sidebars y
  fondos claros.

📌 Lección de Vincca: el favicon con fondo propio se recorta feo en los
sidebars de plataformas ajenas. Tener siempre la versión transparente.

## Relacionado
`BRAND-SCM.md` · segundo cerebro: `WIKI/scm-software-y-canal.md`

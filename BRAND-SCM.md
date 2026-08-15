# BRAND — Kit de marca de SCM

> Fecha: 2026-08-14 · Base: research de identidad del 14/08 (segundo
> cerebro, `OUTPUTS/2026-08-14-research-identidad-scm.md`), con dos
> correcciones del bibliotecario marcadas abajo.
> **Alcance: la herramienta.** La marca personal y la agencia (Vincca) son
> otras marcas, con su propio kit.

## Concepto rector

**"El instrumento que te deja llamar tranquilo."**

El diferencial no es velocidad de venta: ese terreno está ocupado y quemado.
Es que el sistema ya chequeó por vos antes de marcar. La marca comunica
**calma operativa**, en lenguaje afirmativo. Nunca miedo, nunca "evitá la
multa".

## Paleta

| Token | Hex | Uso |
|---|---|---|
| `base` | `#141619` | Fondo de la aplicación. Nunca negro puro |
| `superficie` | `#1E2227` | Paneles, tarjetas |
| `superficie-alta` | `#262B31` | Elementos elevados, modales |
| `linea` | `#31373E` | Bordes y divisores |
| `texto` | `#F2F4F5` | Texto principal (contraste >13:1) |
| `texto-suave` | `#A9B0B7` | Secundario, etiquetas (~7:1) |
| **`acento`** | **`#3FA872`** | **El único acento de marca Y el estado habilitado**: CTA, foco, ítem activo, chip de verificado |
| `acento-hover` | `#4FBF84` | Hover del acento |
| `bloqueado-gris` | `#7E858C` | Estado excluido: gris atenuado, **sin botón de llamar** |


### 🔧 Por qué verde bosque y no lo que proponía el research

El research proponía dos verdes (lima de marca y esmeralda de estado), lo
que contradecía su propia regla de "un solo acento saturado". Se resolvió
al revés de lo que sugería, y mejor: **el acento de marca ES el verde de
estado.** Un solo color, `#3FA872`.

Tres razones, decididas el 14/08 tras revisar 16 candidatos y dos
investigaciones:

1. **Es el único acento que significa algo.** En esta herramienta el verde
   ya quiere decir "podés llamar". La marca deja de ser un color elegido y
   pasa a ser el mensaje del producto.
2. **Elimina la competencia interna.** El chip de habilitado necesita un
   verde sí o sí. Con cualquier otro acento habría dos colores peleando
   atención; con este hay uno solo.
3. **No está quemado, está libre.** Relevamiento de software de call center
   y dialers: el azul domina hasta la invisibilidad, los rojos y violetas
   están desaconsejados en la categoría, y **el verde aparece solo en rol
   secundario** (Aircall, Genesys). Nadie lo reclamó como marca.

El estado bloqueado no usa rojo: es **gris atenuado y sin botón de llamar**.
Un número que no se puede marcar no necesita alarma, necesita ausencia de
acción.

### 🔧 La relación con Vincca

El research asumió que Vincca es oscura con bronce. **Vincca es clara
(marfil) con una isla oscura para el diagnóstico.** La separación entre las
dos marcas queda así:

| | Vincca | SCM |
|---|---|---|
| Superficie | Clara, con isla oscura | Oscura de punta a punta |
| Acento | Bronce `#D4A853` | Verde bosque `#3FA872` |
| Tipografía | Sans humanista, inicial en acento | Mono, sin inicial destacada |
| Tono | Sobrio, clínico, ritmo lento | Técnico, directo, ritmo rápido |
| Público | Médicos de 45 a 60 | Vendedores y agencias |

Lo único que comparten es el fondo oscuro donde vive el dato. **Nunca
compartir acento ni tratamiento de wordmark**: si SCM se parece a Vincca, el
espectador no sabe qué le están vendiendo.

## Tipografía

- **Interfaz**: sans nítida con cifras tabulares. Los números de las colas y
  métricas se alinean a la derecha (patrón Stripe).
- **Peso medio o alto** en todo lo que aparezca en cámara.
- **Mono para números de teléfono e identificadores**: refuerza el registro
  técnico y ocupa uno de los huecos libres del nicho.

## Reglas de uso

1. **Un solo acento saturado por pantalla.** La jerarquía se construye con
   luminancia y peso, nunca con matiz.
2. **Nada de gradientes oscuros amplios**: generan bandas al comprimirse en
   video. Superficies planas con micro-elevación (cada capa 3 a 6% más
   clara).
3. **Ningún dato crítico depende del color.** Todo estado lleva forma más
   ícono más etiqueta. En video comprimido el color se degrada; la forma no.
4. **Densidad reducida** respecto de la vista de trabajo. Menos columnas,
   más aire, una métrica protagonista por pantalla.
5. **Contraste objetivo 7:1** en texto que aparezca en cámara, no el mínimo
   de 4,5:1.
6. **El chip de "número habilitado" es el componente estrella** y usa el acento de marca: es el
   diferencial hecho pixel. Tiene que leerse en un celular a pantalla
   partida.

## Prohibido (el anti-brief)

Degradados de azul a violeta (el SaaS genérico que vuelve invisible),
capturas de ganancias, flechas rojas, contadores regresivos, badges
apilados, testimonios con fotos de archivo, dorado brillante sobre negro
(código de gurú), tipografía gritona, rojos y azules saturados sobre fondo
oscuro, urgencia manufacturada.

## Arquitectura de marca

**Modelo vigente: persona ↔ herramienta.** SCM es la extensión visible del
método de Nacho y hereda su tono. Vincca queda deliberadamente aparte.

**Umbral de cambio, escrito para no discutirlo después**: cuando el ingreso
del software supere al de contenido y comunidad, o aparezca un comprador
serio, SCM migra a identidad transferible, menos dependiente de la cara del
fundador. Precedente a favor: ConvertKit, que se pudo separar de Nathan
Barry. Precedente en contra: los productos de Pieter Levels, atados a él.

## Antes de fijar los hex

Prototipar la interfaz con esta paleta, grabar 60 segundos reales, subirlos
a YouTube y mirarlos **en un celular**. Si el texto de estado pierde nitidez
o el acento vibra, bajar saturación y subir luminancia. Los valores de acá
son punto de partida, no dogma.

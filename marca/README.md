# marca/ — identidad visual de SCM

> Cerrado el 2026-08-15. El kit de reglas vive en `../BRAND-SCM.md`;
> acá están los archivos.

## Los cuatro que se usan

| Archivo | Dónde va |
|---|---|
| `simbolo-scm.svg` | El símbolo completo, con los dos puntos laterales. Solo para el bloque con letras: header, login, presentaciones |
| `favicon.svg` | Solo la puerta, fondo `#141619`, `rx=18`. Pestaña del navegador |
| `favicon-transparente.svg` | La puerta sin fondo. Sidebars y plataformas ajenas que recortan |
| `simbolo-scm-claro.svg` | Versión `#2F8A5B`. Documentos y facturas sobre fondo claro |

## Reglas que no se rompen

1. **Bajo 24 px van solo la puerta, sin los puntos laterales.** Los puntos se
   empastan y ensucian.
2. **Color plano.** Nada de degradados, glow ni sombras (el favicon anterior
   tenía un degradado y por eso se reemplazó).
3. **Sobre fondo claro el verde se oscurece a `#2F8A5B`.** El `#3FA872` sobre
   blanco no llega al contraste mínimo.
4. **El bloque con letras** es símbolo + `SCM` en JetBrains Mono 700,
   `#F2F4F5`, separados por un cuarto del alto del símbolo.
5. **En el producto, SCM no se expande.** "Sales Closing Machine" queda
   reservado para el canal de YouTube, que le habla a otro público.

## Por qué esta forma

La puerta: lo que pasa queda adentro. Soporta dos lecturas según con quién se
esté hablando, el cierre de la venta y el filtro de lo que no debe marcarse.

Se eligió entre 23 candidatos, en tres tandas. Sobrevivió por ser el único que
significa algo del producto y sigue legible a 16 px. Verificado contra los
íconos de sistema que más se le parecen (play, detener, proyector) en
`test-confusion.html`: se distingue a 16 y a 32.

Descartado el anillo con punto, que era el favorito previo: colisiona de
frente con el ícono universal de grabación.

## Los archivos de trabajo

- `verificacion.html` — los cuatro SVG a 16/32/64, sobre claro y oscuro.
  Correr después de cualquier cambio.
- `test-confusion.html` — el símbolo contra los íconos de sistema parecidos.
- `exploracion/` — las tres tandas de color y las tres de símbolo, con los
  descartes. Se guardan para no volver a discutir decisiones ya cerradas.

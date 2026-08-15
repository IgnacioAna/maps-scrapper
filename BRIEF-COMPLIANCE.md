# BRIEF — Milestone: Cumplimiento de registros de exclusión

> Fecha: 2026-08-14 · Milestone 1 de 3 sobre el sistema existente.
> Origen: research de mercado del 14/08 (segundo cerebro,
> `OUTPUTS/2026-08-14-research-mercado-scm-comunidad.md`).
> **Es el milestone más urgente: la exposición legal ya existe con la
> operación actual, y es el único diferencial que ningún competidor tiene.**

## Por qué

En España, Colombia, México, Argentina y Chile existen registros oficiales
donde una persona pide no recibir llamadas comerciales. Consultarlos antes
de llamar es obligación legal del que llama, con multas documentadas: 30.000
euros a una empresa española por llamar a un inscrito, y 300.000 euros
confirmados por la Audiencia Nacional a telemarketers subcontratados.

Hoy el sistema tiene 3.246 negocios cargados (1.180 Colombia, 903 México,
701 España, 358 Perú, 65 Costa Rica, 37 Chile) y **ninguno fue cruzado
contra ningún registro**.

Además, si el sistema se ofrece a terceros, el operador pasa a ser encargado
del tratamiento y no queda exento: un software que facilita ignorar los
registros aumenta la exposición de su dueño.

## Objetivo

Que el sistema **no permita marcar un número excluido**, que el cruce se
mantenga actualizado sin trabajo manual, y que quede evidencia auditable de
que la consulta se hizo.

## Los registros y su mecánica (cada uno es distinto)

| País | Registro | Acceso | Prioridad |
|---|---|---|---|
| Colombia | RNE (CRC) | Registro de empresa **gratuito**, consulta en plataforma | **1** (mercado más grande, sin costo) |
| México | REPEP (Profeco) | Descarga de listas, actualizar cada 1-2 semanas | 2 |
| España | Lista Robinson (Adigital) | **API de pago** que anonimiza y cruza; también carga de CSV y devolución de CSV | 3 |
| Argentina | No Llame (AAIP) | Registro nacional | 4 |
| Chile | No Molestar (SERNAC) | Registro | 5 |

⚠️ Perú: el reglamento vigente desde 31/03/2025 no permite primer contacto
indiscriminado ni para pedir consentimiento. **Decisión de negocio pendiente
de Nacho**: si se sigue prospectando ahí o se marca el país como bloqueado.

## Requisitos

1. **Modelo de datos**: cada contacto tiene estado de exclusión (excluido,
   permitido, sin verificar), fecha de la última verificación, y contra qué
   registro se verificó.
2. **Bloqueo en el marcador**: un número excluido no se puede discar, ni por
   power dialer ni por marcación manual. El bloqueo es duro, no una
   advertencia.
3. **Abstracción por país**: cada registro tiene mecánica propia (API,
   descarga, consulta). Diseñar una interfaz común con implementaciones
   distintas, de modo que sumar un país no toque el resto.
4. **Colombia primero**: implementación completa del RNE. Es gratis y cubre
   el mercado más grande.
5. **Carga y cruce de listas descargadas** (México, y España si se usa la
   vía CSV): subir el archivo, cruzar contra la base, marcar exclusiones.
6. **Reverificación periódica**: los registros se actualizan; un número
   permitido hoy puede estar excluido en dos semanas. Definir vigencia por
   país (México recomienda cada 1-2 semanas) y reverificar automáticamente
   lo vencido.
7. **Evidencia auditable**: registro inmutable de cada consulta, con fecha,
   registro consultado y resultado. Es la prueba ante un reclamo.
8. **Visible en la interfaz**: contador de excluidos en el panel, junto a
   los números muertos que ya se muestran.

## Fuera de alcance en este milestone

- Verificación de número activo con Telnyx (milestone 2).
- Follow-up multicanal (milestone 3).
- Multi-tenant o venta a terceros: sigue siendo un sistema de un solo
  operador. Pero el diseño no debe impedirlo después.

## Criterio de éxito

Marcar un número inscrito en un registro es imposible desde el sistema; la
base de los tres mercados principales queda cruzada; y ante un reclamo se
puede mostrar cuándo se consultó cada número.

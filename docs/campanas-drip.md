# Motor de Campañas Drip — guía

> Cómo armar campañas de outbound por WhatsApp tipo Go High Level, dentro del
> SCM. Phase 7 (2026-06-10). Requiere wa-multi corriendo en una compu.

## Qué es

Una campaña manda mensajes a una lista de leads, sola, al ritmo que vos
configures — igual que los drips de GHL. **Flujo (v2, 2026-06-12):**

```
encolado → OPENER (mensaje corto de apertura) → espera respuesta
   ├─ NO responde → no se manda NADA más (sin bumps)
   ├─ dice "no me interesa" → descartado
   └─ responde → PITCH (la variante, bloque por bloque con delays) →
        espera respuesta → responde → 🤖 MERCURY conversa y trata de agendar
           └─ Mercury detecta que quiere agendar → pasa al setter humano
```

Clave: **el opener es un primer contacto corto y separado**. La variante (el
pitch completo) se manda SOLO a los que responden el opener. Y cuando responden
después del pitch, **Mercury IA toma la conversación** (si lo dejás activado).

## Lo que configurás por campaña

- **Cuenta(s) WhatsApp** de salida (si ponés varias, reparte round-robin).
- **Leads**: filtro por país / setter / estado + cantidad (ej. 50 de México).
- **Split de variantes**: qué variantes entran y con qué peso (ej. V1 y V2
  50/50, o V1 con peso 3 y V2 con peso 1 = 75/25). Los **bloques** de cada
  variante (Apertura, Problema, Prueba social, Cierre) se mandan como mensajes
  separados.
- **Drip**: cuántos leads liberar y cada cuántos minutos (ej. "1 cada 5 min"
  o "3 cada 10").
- **Ventana horaria + días**: solo manda dentro de ese horario (en la zona
  horaria que elijas) y esos días.
- **Delay entre bloques**: rango min–max random (ej. 1–3 min) para parecer
  humano.
- **Bumps**: lista de seguimientos si no responde — cada uno con "a las X horas"
  y su texto (ej. 24h, 48h, 72h).
- **Mensaje de calificación**: lo que se manda cuando el lead responde por
  primera vez.

`{{nombre}}` en cualquier texto se reemplaza por el nombre del lead.

## Cómo funciona el anti-ban

- **Cap diario por cuenta**: respeta la fase de warming. Una cuenta nueva
  (Fase 1 = 12 msg/día) no se revienta aunque la campaña tenga 500 leads —
  se reparten en los días. Podés poner un override manual.
- **Cuenta no conectada / wa-multi cerrado**: no manda, reencola. La campaña
  no falla, se atrasa hasta que la cuenta vuelva.
- **Drip + delays + ventana horaria**: el ritmo se ve humano.
- Combinalo con **proxy por cuenta** (ver `proxy-setup.md`) para cuentas
  múltiples. Hay una política opcional `requireProxyForCampaigns` que exige
  proxy para poder lanzar campañas.

## Estados de un lead en la campaña

| Estado | Qué significa |
|---|---|
| `queued` | en cola, esperando que el drip lo libere |
| `opener_sending` | mandando los bloques del opener |
| `awaiting_reply` | opener mandado, esperando respuesta (o el próximo bump) |
| `qualifying` | respondió, se le mandó la calificación |
| `replied_for_setter` | respondió la calificación → el setter lo toma |
| `no_reply` | agotó los bumps sin responder |
| `disqualified` | dijo que no le interesa |

## Importante

- **wa-multi debe estar corriendo** en una compu con las cuentas conectadas.
  El motor del servidor decide QUÉ y CUÁNDO mandar, pero el envío físico lo
  hace wa-multi. Si la app está cerrada, los envíos esperan.
- La IA (Mercury) que conversa y agenda automáticamente es la **fase
  siguiente** (Phase 4). Por ahora, cuando el lead responde la calificación,
  queda marcado para que el **setter humano** cierre.
- Las campañas se guardan en `wa_campaigns.json` y sobreviven los redeploys
  (entran en el pre-deploy).

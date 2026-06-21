# Auditoría de Arquitectura y Deuda Técnica — SCM Dental

> Fecha: 2026-06-20 · Foco: arquitectura + deuda técnica (NO seguridad, NO tests).
> Todos los hallazgos verificados leyendo el código (archivo:línea + cita).

## Resumen ejecutivo

El monolito JSON es razonable para la escala (solo-dev, pragmático) y **las dos convenciones
frágiles documentadas SE RESPETAN**: (1) las rutas con `:id` van después de las estáticas en
todos los grupos revisados (setters, telnyx, faqs, mercury) — no encontré shadowing real; (2)
`data.leads` se trata como MAP en todos lados (`Object.keys(data.leads).length`), nunca `.length`
directo sobre el objeto. **No hay TODO/FIXME/HACK reales** (los "TODO" del grep son la palabra
española "todo"). La deuda real está en otro lado: lógica de negocio de priorización de leads
que vive SOLO en el frontend y se reimplementa por vista, dos cachés de leads que pueden
divergir porque no todo pasa por el store unificado, ~8 endpoints one-shot muertos todavía
montados, handlers gigantes (call-disposition ~378 líneas), y helpers inline duplicados.

**Conteo por severidad:** ALTO: 3 · MEDIO: 5 · BAJO: 4

---

## ALTO

### A1 — Lógica de priorización/clasificación de leads vive SOLO en el frontend
**`public/app.js:5549` (`_callScore`), `public/app.js:4363-4412` (`loadHoyView`), `public/app.js:5968+` (`renderCallsList`)**

El scoring que decide a quién llamar (`_callScore`) y la clasificación del día (callbacks /
interesados / vírgenes / "para seguir") son **100% client-side**. El backend NO conoce el score
ni el ordenamiento — solo devuelve la lista cruda de `sin-wsp?include=callable` y cada vista la
re-clasifica en el browser:

```js
// app.js:5549  — el "cerebro" de a quién llamar, solo en el navegador
function _callScore(l) { let s = 50; ... if (attempts === 0) s += 18; ... }
```

`_callScore` SÍ está centralizado (una sola definición, reusado por Hoy/PowerDialer/lista), eso
está bien. El problema es el **acoplamiento de la regla de negocio al cliente**: cualquier
consumidor no-browser (un cron de reportes, una app desktop, un test de integración real, la
futura IA de llamadas) tendría que reimplementar el score. Además los KPIs del funnel SÍ están
en backend (`cold-call-metrics`) pero la priorización NO — la fuente de verdad de "qué llamar
hoy" está partida entre dos capas.

**Mejora:** exponer `computeCallScore(lead)` en el backend (junto a `computeLeadSignals`, que ya
está ahí en `index.js:730`) y devolver `score` + `bucket` ya calculado en el endpoint
`sin-wsp`. El frontend solo ordena/pinta. Costo bajo (la fórmula es pura), elimina el SPOF en el
browser y deja el orden testeable.

---

### A2 — Los dos cachés de leads (`callsLeadsCache` / `_callsLeadsById`) divergen en escrituras que no pasan por `_leadStoreApply`
**`public/app.js:5763-5765` (reactivate) — bypassa el store unificado**

`_leadStoreApply(id, patch)` (`app.js:4311`) existe justamente para mantener sincronizados los
dos cachés (documentado en CLAUDE.md #105). Pero NO todas las escrituras lo usan. En la
reactivación de un lead se muta solo `callsLeadsCache`:

```js
// app.js:5763
const idx = callsLeadsCache.findIndex(l => l.id === leadId);
if (idx >= 0) callsLeadsCache[idx] = { ...callsLeadsCache[idx], ...d.lead, id: leadId };
else callsLeadsCache.push({ ...d.lead, id: leadId });
// ❌ nunca se actualiza _callsLeadsById → el Power Dialer (_callsLeadsById.get(id)) queda stale
```

El Power Dialer lee SIEMPRE de `_callsLeadsById` (`app.js:4685, 4896, 5455…`). Tras reactivar un
lead desde la lista, si el setter abre el Power Dialer ese lead tiene el estado viejo. Es
exactamente la clase de bug que `_leadStoreApply` venía a matar — pero la cobertura es parcial.
(`loadHoyView` también hace `_callsLeadsById.set(...)` directo en `app.js:4375` sin tocar
`callsLeadsCache`, asimetría del mismo problema.)

**Mejora:** rutear TODA escritura de lead por `_leadStoreApply` (incluida la rama reactivate y
el set de Hoy). Es 1-2 líneas por sitio. Idealmente el store sería la única fuente y las vistas
leerían siempre de él (el "single-store reactivo" que #105 dejó pendiente), pero como mínimo
cerrar los bypasses actuales.

---

### A3 — ~8 endpoints admin one-shot/migración muertos siguen montados sin frontend
**`index.js:1886, 1928, 1993, 2449, 2477, 2520, 4822, 6760, 6789` + `recycle-pool:6046`**

Verifiqué endpoint por endpoint contra `app.js/index.html/wa.js`. Estos no tienen NINGUNA
referencia en el frontend (son one-shots ya ejecutados, varios documentados como tales en
CLAUDE.md #84/#86/#90):

| Endpoint | Línea | Refs frontend |
|---|---|---|
| `POST /api/admin/backfill-corrupt-phones` | 1886 | 0 |
| `POST /api/admin/backfill-country` | 1928 | 0 |
| `POST /api/admin/backfill-signals` | 1993 | 0 |
| `POST /api/admin/backfill-us-borderphones` | 2449 | 0 |
| `POST /api/admin/backfill-wa-text` | 2477 | 0 |
| `POST /api/admin/backfill-doctor-from-name` | 2520 | 0 |
| `POST /api/setters/leads/orphans/reset` | 4822 | 0 |
| `POST /api/setters/leads/migrate-phones` | 6760 | 0 |
| `POST /api/setters/leads/reroute-no-wsp` | 6789 | 0 |
| `POST /api/admin/recycle-pool` | 6046 | 1 (pero #86 dice que el botón se removió) |

CLAUDE.md #86: *"El botón 'Reciclar todo el pool' se REMOVIÓ del HTML/JS tras usarse (era
one-time, no debe re-dispararse)"* — pero el endpoint sigue vivo y es destructivo (desasigna +
resetea TODO el pool). Son ~600+ líneas de handlers que nadie llama, que confunden el mapa de la
API, y que en el caso de recycle-pool/orphans-reset son una bomba de relojería (un POST manual
con credenciales admin borra el trabajo de todos).

**Mejora:** mover los one-shots ya ejecutados a `scripts/` (corren con el mismo `mutateSettersData`
+ backup) o borrarlos. Si se quiere conservar capacidad de re-correr backfills, dejarlos pero
detrás de un flag/guard explícito y documentar cuáles son destructivos. Como mínimo, eliminar
los puramente muertos (backfill-* ya aplicados a toda la data).

---

## MEDIO

### M1 — Handler `call-disposition` es una megafunción de ~378 líneas
**`index.js:6885-7263`**

Un solo `app.post(...)` arranca en 6885 y el siguiente route recién aparece en 7263. Adentro:
parsing del body, RBAC de callback compartido, whitelist de outcomes/objection-tags/disqualify,
cálculo de cadencia (CADENCE_HOURS), costo Telnyx, cascade de estado, DNC, push al callLog,
calendario. Es el corazón del producto y el más difícil de modificar sin romper algo. Mezcla
~8 responsabilidades en un closure.

**Mejora:** extraer helpers puros y testeables: `_applyCadence(lead, outcome)`,
`_applyDisposition(lead, outcome, opts)`, `_pushCallLogEntry(...)`. Reduce el blast radius de
cada cambio y permite unit-tests de la cadencia/cascade sin levantar Express.

### M2 — Helper inline `lastOutcome` duplicado (último outcome del callLog)
**`public/app.js:4380` vs `public/app.js:6011`**

```js
// app.js:4380 (loadHoyView)
const lastOutcome = (l) => (Array.isArray(l.callLog) && l.callLog.length) ? l.callLog[l.callLog.length - 1].outcome : null;
// app.js:6011 (renderCallsList) — idéntico, otro nombre
const _lastOutcome = (l) => (Array.isArray(l.callLog) && l.callLog.length) ? l.callLog[l.callLog.length - 1].outcome : null;
```

Mismo patrón "último elemento del callLog" aparece además inline en `app.js:5541` y como
`_lastOutcome` en `app.js:6011`. Si cambia la forma del callLog (p.ej. se filtran entries
fallidos), hay que tocar N sitios.

**Mejora:** un solo `function _lastCallOutcome(l)` a nivel de IIFE, reusado.

### M3 — Lógica de teléfono/país duplicada backend↔frontend
**Backend: `index.js:869` `countryFromPhonePrefix`, `index.js:1180` `buildWhatsAppUrl`, `index.js:1139-1151` (largos por prefijo).
Frontend: `public/app.js:1340-1410` (normalización por país), `public/app.js:5586` `_LEAD_TZ`.**

Las reglas de "qué celular es válido por país" y los prefijos internacionales viven en los dos
lados con tablas paralelas (el backend tiene el mapa de longitudes por prefijo en 1139-1151; el
frontend repite reglas tipo "Chile: 9XXXXXXXX", "Colombia: 3XXXXXXXXX" en 1353-1402). Cualquier
ajuste de un país hay que hacerlo dos veces y es fácil que diverjan (ya pasó: bug Paula
documentado en `phone-normalization.smoke.test.js:90`).

**Mejora:** no es trivial unificar (browser no importa módulos del server acá), pero al menos
extraer el mapa de prefijos/longitudes a un `public/` + `src/` compartido por copia versionada
con un test que verifique que las dos tablas coinciden. O servir la tabla desde un endpoint.

### M4 — `view-crm` parkeada pero todavía alcanzable desde el command palette
**`public/index.html:99` (`data-roles="parked"`) vs `public/app.js:13773`**

El menú lateral marca Setteo como `parked`, y CLAUDE.md #108 dice que se redirigieron 4 nav a
`view-hoy`. Pero el quick-jump/command palette sigue ofreciendo el destino:

```js
// app.js:13773
{ id: 'v-crm', target: 'view-crm', label: 'Ir a Setteo (WhatsApp)', icon: '💬', roles: ['admin','setter','supervisor'] },
```

Un usuario que tipea "Setteo" en el palette aterriza en una vista parkeada (link semi-muerto).
Inconsistencia entre "parked" en el sidebar y "navegable" en el palette.

**Mejora:** quitar la entry del palette (o filtrar entries cuyo `target` esté `data-roles="parked"`).

### M5 — `app.js` es un único IIFE de 15.221 líneas con ~230 funciones y estado de módulo compartido por closure
**`public/app.js` (todo el archivo)**

No es "el archivo es grande" genérico: el problema concreto es que TODO comparte un solo scope
de closure (`callsLeadsCache`, `_callsLeadsById`, `_pd`, `_telnyxCallState`, etc. son variables
libres accesibles desde cualquiera de las 230 funciones). Eso es lo que habilita bugs como A2
(cualquier función puede mutar `callsLeadsCache` sin pasar por el store) y hace imposible testear
una vista en aislamiento. La exposición a `window._x` es ad-hoc (decenas de `window._foo = foo`)
en vez de una superficie definida.

**Mejora:** no hace falta un build/bundler. Partir por dominio en archivos `<script>` separados
(`calls.js`, `hoy.js`, `pool.js`, `telnyx.js`, `faqs.js`) cada uno con su propio IIFE y un
namespace explícito (`window.SCM.calls = {...}`). Empezar por extraer el módulo de Llamadas
(el más grande y el que tiene el problema de cachés).

---

## BAJO

### B1 — `intentos` (scheduled-messages) vs `callAttempts` (lead) — dos contadores con nombres confusamente parecidos
**`index.js:3038, 3104, 3125` (`intentos`) vs `index.js:553, 6493, 7072` (`callAttempts`)**

Coexisten `intentos` (reintentos de envío de mensajes programados) y `callAttempts` (intentos de
llamada del lead). No es un bug —son cosas distintas— pero el naming invita a confundirlos al
leer. Verifiqué que `_callScore` lee correctamente `callAttempts` (no `intentos`).

**Mejora:** renombrar `intentos`→`sendAttempts` en scheduled-messages (o documentar el contraste
en el comentario de `ensureLeadDefaults`).

### B2 — `index.js` con 188 route handlers en un solo archivo
**`index.js` (188 × `app.METHOD(...)`)**

Es manejable hoy, pero el archivo de 12.9k líneas concentra TODO el routing genérico. Ya hay
precedente bueno: el módulo WA está bien separado en `src/wa/*` (data/routes/gateway/engine) y
enrichment en `src/enrichment.js`. El resto no siguió ese patrón.

**Mejora:** seguir el patrón WA: extraer routers por dominio (`src/leads/routes.js`,
`src/telnyx/routes.js`, `src/faqs/routes.js`) montados desde `index.js`. Mecánico y de bajo
riesgo (mover bloques + `export`/`import`). No urgente.

### B3 — Tres definiciones inline de "último elemento del callLog" además de M2
**`public/app.js:5541` y patrón repetido en `index.js:7169`, `index.js:12051` (recorridos `for (i = callLog.length-1...)`)**

Mismo concepto ("la última llamada") implementado a mano en backend y frontend varias veces.
Relacionado con M2 pero cruzando capas.

**Mejora:** helper `lastCallEntry(lead)` en cada capa.

### B4 — Archivos de data pesados y artefactos sueltos en el repo root
**`paula-old.json` (9.2 MB) en root, `server.err.log`/`server.out.log`, `tmp/`**

`paula-old.json` (9.2MB) es un backup viejo que vive en la raíz del repo (no en `data/`, no en
`.bak`). `server.out.log`/`server.err.log` (logs runtime) están commiteables. Ensucian el root y
pesan en clones.

**Mejora:** mover backups a `data/*.bak-*` (ya gitignored) o borrar; agregar `*.log` y
`paula-old.json` a `.gitignore` si no están.

---

## Lo que está BIEN (verificado, para no "arreglar" lo que no está roto)

- **Route ordering `:id` después de estáticas: RESPETADO** en setters/telnyx/faqs/mercury. No
  hay shadowing real (los aparentes conflictos son métodos HTTP distintos o shapes distintos).
- **`data.leads` como MAP: RESPETADO.** Todos los `.length` sobre leads son sobre arrays de
  `Object.values()`/`Map.get()`; los conteos del map usan `Object.keys(data.leads).length`
  (`index.js:5692, 6196, 6782…`).
- **Sin TODO/FIXME/HACK reales.** El grep da falsos positivos por "todo"/"XXX" españoles.
- **`_callScore` centralizado** (una definición, reusado) — no duplicado.
- **Módulo WA y enrichment bien modularizados** (`src/wa/*`, `src/enrichment.js`) — el patrón a
  replicar para el resto.
- **Mutex async (`mutateSettersData`/`mutateFaqs`) documentado y usado** para writes concurrentes.

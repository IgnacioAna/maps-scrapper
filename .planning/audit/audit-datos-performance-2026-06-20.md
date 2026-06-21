# Auditoría de Integridad de Datos + Performance — SCM Dental

Fecha: 2026-06-20
Foco: concurrencia de escrituras JSON, crecimiento ilimitado, performance de loops, consistencia de datos, integridad de backups, lecturas síncronas en hot path.
Alcance: `index.js` (~12.900 líneas), `src/wa/data.js`.

> Metodología: cada hallazgo verificado leyendo el código real, con `archivo:línea` + cita. Se descartaron varios "posibles problemas" que al verificar ya estaban resueltos (ver sección "Lo que YA está bien").

## Conteo por severidad

- CRÍTICO: 0
- ALTO: 1
- MEDIO: 4
- BAJO: 3

---

## ALTO

### A1 — `send-placeholder` es async y NO usa el mutex (TOCTOU / write pisado)

- **Severidad:** ALTO (es el único handler async de setters que rompe el patrón mutex; los demás ya migraron).
- **Archivo:** `index.js:7263-7333` (`POST /api/setters/leads/:id/send-placeholder`).
- **Descripción:** El handler es `async`. Hace `const data = loadSettersData()` (7264), luego `await _sendPlaceholderEmail(...)` (7308, llamada de red que puede tardar segundos), y recién después muta `lead.callLog` + `lead.placeholderSentAt` + `lead.lastContactAt` y hace `saveSettersData(data)` (7332) **sin** `mutateSettersData`. Esto es exactamente el patrón que la nota #19 de CLAUDE.md prohíbe: "handlers async que tienen `await` ANTES de load+save deben envolver la mutación en estos wrappers". Si durante el `await` del email otro handler (call-disposition, PATCH lead, note) escribe y eso provoca un re-parse del cache (p.ej. `import-data` o cualquier flujo que cambie el mtime de forma que las referencias diverjan), el `saveSettersData(data)` final pisa esos cambios escribiendo el snapshot viejo + su parche.
  - Mitigante parcial: `loadSettersData()` devuelve el **mismo objeto cacheado** mientras el mtime no cambie (4037-4039), así que en el caso común (otros writes sincrónicos que mutan la misma referencia) los cambios concurrentes SÍ sobreviven. El riesgo real es cuando la referencia diverge (re-parse). Aun así, es el único endpoint async de setters que no respeta la regla y conviene cerrarlo.
- **Fix concreto:** Mover la mutación a `mutateSettersData`, re-resolviendo el lead fresco después del `await`:
  ```js
  // tras el await _sendPlaceholderEmail(...)
  await mutateSettersData((fresh) => {
    const fl = fresh.leads?.[req.params.id];
    if (!fl) return;
    if (!Array.isArray(fl.callLog)) fl.callLog = [];
    fl.callLog.push({ ts: nowIso, outcome: 'placeholder_sent', /* ... */ });
    if (fl.callLog.length > 500) fl.callLog = fl.callLog.slice(-500);
    fl.placeholderSentAt = nowIso;
    fl.lastContactAt = nowIso;
  });
  ```
  Nota: la respuesta `res.json({ ok:true, lead, ... })` debería devolver el lead fresco post-mutación, no el `lead` del snapshot inicial.

---

## MEDIO

### M1 — Doble `ensureLeadDefaults` + spread de los ~5000 leads en cada request de varios endpoints

- **Severidad:** MEDIO (trabajo redundante en cada GET; afecta latencia y GC, no corrige datos).
- **Archivos:**
  - `index.js:7832` — `GET /api/setters/performance`: `Object.entries(data.leads||{}).map(([id,l]) => ({ ...ensureLeadDefaults(l), _id: id }))`
  - `index.js:7960` — `GET /api/setters/team-performance`: idéntico.
  - `index.js:8271` — `GET /api/setters/export`: `Object.entries(...).map(([id,lead]) => ({ id, ...ensureLeadDefaults(lead) }))`
- **Descripción:** `loadSettersData()` **ya** ejecuta `ensureLeadDefaults` sobre cada lead al cargar/cachear (`index.js:4104-4106`). Estos endpoints lo vuelven a llamar por lead **y además** hacen un spread `{...lead}` que crea una copia superficial completa de cada uno de los ~5000 objetos (cada copia incluye referencias a `callLog`/`notes`/`interactions`). Es trabajo y allocations duplicados en cada request. `ensureLeadDefaults` es barato e idempotente (la única parte cara, `computeLeadSignals`, solo corre si `lead.signals` falta — y tras el backfill #90 nunca falta), así que el costo real es el `Object.entries(...).map(spread)` sobre 5000 objetos.
- **Fix concreto:** Como `loadSettersData()` ya garantiza defaults, eliminar el `ensureLeadDefaults` redundante y evitar el spread cuando solo se necesita leer + un `id`. Si se necesita el id embebido, iterar `for (const [id,l] of Object.entries(data.leads))` sin copiar, o agregar el id con `l._id` una sola vez en `loadSettersData`. En `performance`/`team-performance` el filtro por setter podría aplicarse ANTES de cualquier copia.

### M2 — `_perfAggregate` re-parsea `new Date(lead.lastContactAt)` por lead × por bucket (O(buckets × leads) con parseo repetido)

- **Severidad:** MEDIO (latencia del panel; peor para la vista de equipo/admin que escanea los 5000).
- **Archivo:** `index.js:7733-7775` (`_perfAggregate`), llamada desde `index.js:7847-7861` y `7977-7981`.
- **Descripción:** `GET /api/setters/performance` arma N buckets (`_perfBucketsForPeriod`: hasta ~14 para period=day por el default range de 14 días, `index.js:7713`) y llama `_perfAggregate(filtered, ...)` por cada bucket + total + período anterior (~16 pasadas). Cada pasada recorre los leads filtrados y hace `new Date(lead.lastContactAt).getTime()`, `new Date(lead.importedAt)`, `new Date(lead.asistioAt)` **otra vez** en cada bucket. Para la vista de equipo (setterFilter vacío) `filtered` = los 5000 leads → ~16 × 5000 = ~80k iteraciones, cada una con 2-3 `new Date()` (parseo de string + alloc). `team-performance` lo hace por setter (2 pasadas c/u) pero sobre slices.
- **Fix concreto:** Pre-parsear los timestamps una vez por lead antes del bucketing (mapear cada lead filtrado a `{ lc:Number, imp:Number, ats:Number, conexion, respondio, ... }` con los `getTime()` ya resueltos) y pasar ese array liviano a `_perfAggregate`. Convierte ~16 reparseos por lead en 1.

### M3 — `loadHistory()` re-lee y re-parsea `history.json` (~4 MB) en cada llamada, sin cache

- **Severidad:** MEDIO (I/O síncrono de 4 MB que bloquea el event loop; bajo impacto porque vive en endpoints de scraping, no en el hot path del call center).
- **Archivo:** `index.js:3413-3425` (`loadHistory`), llamadas en `index.js:1726, 2689, 2751, 2801, 2854, 2884, 3656, 3848, 3864, 3959, 12693`.
- **Descripción:** A diferencia de `loadSettersData()` (que tiene cache por mtime, `index.js:4036-4039`), `loadHistory()` hace `JSON.parse(fs.readFileSync(HISTORY_FILE,'utf8'))` cada vez. El archivo pesa ~4 MB (verificado: `data/history.json` = 3.99 MB) y el parse + readFileSync síncrono bloquea el event loop. La mayoría de las llamadas están en flujos de scraping/admin (baja frecuencia), pero `index.js:12693` lo hace en un endpoint de diagnóstico y `2751/2801/2854` en endpoints de gestión de history que un admin puede pegar repetido.
- **Fix concreto:** Aplicar el mismo patrón de cache por mtime que `loadSettersData` (un `_historyCache` + `_historyCacheMtime`), invalidado/actualizado en `saveHistory`. Bajo riesgo porque solo un punto escribe `history.json` (`saveHistory`).

### M4 — `cold-call-metrics` / `telnyx/metrics` / `objection-analytics` escanean los 5000 leads × todos sus callLog en cada request

- **Severidad:** MEDIO (O(leads × callLog) por request; cada `new Date(entry.ts)` por entry).
- **Archivos:** `index.js:4647-4672` (cold-call-metrics), `index.js:5282-5290` (objection-analytics), `index.js:12170-12189` (telnyx/metrics), `index.js:4720-4728` (calls-today).
- **Descripción:** Todos hacen `for (const id in data.leads)` (los 5000) y dentro `for (const entry of lead.callLog)` con `new Date(entry.ts).getTime()` por entrada. callLog está capeado a 500, así que el peor teórico es 5000 × 500 = 2.5M parses; en la práctica los logs son chicos pero el escaneo de los 5000 leads ocurre aunque un setter pida solo lo suyo (el filtro `if (setterId && lead.assignedTo !== setterId) continue` salta DESPUÉS de entrar al loop, lo cual está bien, pero igual itera el map completo). Estos endpoints se piden al abrir view-myperf / Hoy / Centralita y al cambiar de período.
- **Fix concreto:** Bajo prioridad si la latencia es aceptable. Opción incremental: cachear por (setterId, period) con TTL corto (p.ej. 30-60s) ya que las métricas no necesitan ser instantáneas. Alternativa estructural (mayor): mantener un índice `callLog by setter` materializado, pero rompe la simplicidad file-based — no recomendado todavía.

---

## BAJO

### B1 — Backups: snapshot completo (~15 MB) × 8 copias, sin compresión; el repo acumula `.bak-*` no rotados

- **Severidad:** BAJO (consumo de disco; el mecanismo en sí es correcto y robusto).
- **Archivo:** `index.js:3364-3411` (`makeBackup`, `BACKUP_KEEP=8`), y el `pre-import` adicional en `index.js:1849`.
- **Descripción:** Cada backup copia los archivos completos (setters.json solo ya pesa ~14.8 MB). Con `BACKUP_KEEP=8` son ~120 MB en `data/backups/`, ya comentado y consciente en el código (3366-3368). Además **cada** `import-data` dispara un `makeBackup('pre-import')` (1849) y cada backfill/recycle/pool-distribute uno más (`pre-backfill-*`, `pre-recycle-pool`, etc.) — todos cuentan para el `BACKUP_KEEP=8`, así que una ráfaga de operaciones admin puede expulsar los snapshots `cron`/`boot` y dejar la retención efectiva en minutos. Aparte, en `data/` hay `.bak-*` manuales (`setters.json.bak-pre-redistribution-*`, `.bak-pre-nophonedelete-*`, ~10 MB c/u) que NO los rota nadie (son one-shot históricos; gitignored según CLAUDE.md pero ocupan disco del volumen).
- **Fix concreto:** (1) Considerar separar la retención de snapshots `cron`/`boot` (los de seguridad temporal) de los `pre-*` (de operación puntual) para que una ráfaga de imports no borre el histórico de 2 días. (2) Si el disco del volumen aprieta, comprimir (gzip) los snapshots o guardar solo diffs. (3) Limpiar manualmente los `.bak-*` viejos del volumen/repo.

### B2 — `_telnyxReconcileCosts` hace O(entries × sessions) DENTRO del mutex

- **Severidad:** BAJO (job de fondo cada 6h; sessionList acotado a CDRs de 7 días).
- **Archivo:** `index.js:11086-11113` (dentro de `mutateSettersData`).
- **Descripción:** El writeback recorre todos los leads × sus callLog telnyx × `sessionList` (`for (const s of sessionList)` anidado, 11096). El fetch de CDRs ya está fuera del lock (correcto, 11054-11058), pero el matching nested O(E×S) corre **adentro** del mutex, bloqueando call-disposition / PATCH lead mientras dura. Con el auto-reconcile de `last_7_days` sessionList es chico, así que el impacto real es bajo, pero si alguna vez se corre `last_30_days` manual con mucho volumen, el lock se sostiene más de lo deseable.
- **Fix concreto:** Indexar `sessionList` por `destDigits` (Map de últimos-8-dígitos → sesiones) antes de entrar al mutex, para que el match interno sea O(1) por entry en vez de O(S). Reduce el tiempo bajo lock.

### B3 — Migraciones one-shot en `loadSettersData` que llaman `saveSettersData` durante un GET

- **Severidad:** BAJO (solo ocurre una vez por archivo nuevo; defensivo).
- **Archivo:** `index.js:4042-4089` (bloques de migración que terminan en `saveSettersData(raw)`).
- **Descripción:** `loadSettersData` puede disparar un `saveSettersData(raw)` (escritura de ~15 MB) la primera vez que ve un formato viejo o `!raw.__wspClassified`. Como `loadSettersData` se llama desde muchos GET (incluido handlers sync que asumen lectura barata), el primer GET tras un deploy con data sin migrar paga una escritura grande inesperada. Tras la primera ejecución queda flag-eado (`__wspClassified=true`) y no se repite. Es defensivo y de bajo impacto, pero conviene saber que un GET puede escribir.
- **Fix concreto:** Aceptable como está. Si molesta, mover la migración a una rutina explícita de boot (una sola vez) en lugar de lazy dentro del load.

---

## Lo que YA está bien (verificado)

- **Mutex async aplicado correctamente** en todos los handlers async de setters que importan: `POST /sessions/end` (`index.js:8433`), `POST /telnyx/calls/:leadId/transcribe` (`index.js:12038`), `POST /telnyx/calls/:leadId/:callIdx/analyze` (`index.js:11676`), `_telnyxReconcileCosts` writeback (`index.js:11083`). Y `mutateFaqs` en `POST /api/faqs` (`index.js:9069`). El único que falta es A1 (`send-placeholder`).
- **Los handlers de escritura de leads de alta frecuencia son síncronos** (sin `await` entre load y save): `PATCH /leads/:id` (6218), `call-disposition` (6885), `note` (6647), `interaction` (6337), `followup` (6409) → Node single-thread los hace atómicos, no necesitan mutex. Correcto.
- **Caps de crecimiento presentes y consistentes:** callLog 500 (6492/6500/6540/7071/7329), interactions 200 (6363), notes 100 (6667), scheduled_messages FIFO 5000 (4167/4189), scrape_batches FIFO 50 (3809), telnyx_events FIFO 1000 (11256), mercury_generations FIFO 5000 (10374/12859), wa_events rotación a 10000 con archivo (`src/wa/data.js:8,324-333`), error.log rotación a 5 MB (3349).
- **Cache de setters por mtime** (`index.js:4036-4039`) evita re-parsear los ~15 MB en cada request; `saveSettersData` actualiza el cache post-write (4129-4133) y usa write atómico tmp+rename (4124-4126). Solo `saveSettersData` escribe `setters.json` (verificado: no hay otro `writeFileSync(SETTERS_FILE)`), así que el cache no se vuelve stale por escrituras externas dentro del proceso.
- **Conteo de leads sobre el MAP usa `Object.keys(...).length`** (5692, 6196, 6782, 6811, 7413) y los `.length` directos son sobre arrays ya materializados con `Object.values(...)`. No se encontró el bug de `.length` sobre el map.
- **Endpoints de agregación pesados ya optimizados a una sola pasada de agrupación:** `command` (8086-8095, agrupa por setter y variante una vez), `team-performance` (7970-7975, agrupa por setter una vez), stats de llamadas (8203-8210). Los comentarios "Audit fix" documentan que el O(S×N) anterior ya se corrigió.
- **`scheduledMessagesTick`** hoistea `loadSettersData()`/`loadAuthData()` fuera del loop (4246-4252) y hace early-return si no hay mensajes due (4244) → no re-lee archivos grandes por mensaje.
- **`seedVolumeFromRepo`** hace skip en `NODE_ENV=test` (3315) y solo copia si el archivo no existe en el volumen (3322) → no pisa data viva.

# Phase 14 — Lead-Ops: Pool único, 3 carriles, distribución limpia

> Síntesis de 3 agentes (2026-06-17): estado base exacto de la DB, modelo de
> ownership en código, y arquitectura óptima de pool multicanal + bots.
>
> **Idea central:** un solo pool de leads limpios y tiereados es la fuente de verdad.
> Los "carriles" (llamada / WhatsApp humano / bot) NO son copias — son **vistas
> filtradas sobre el pool** por un campo `lane`. El lead vive una vez; el carril y
> el dueño son atributos.

---

## Estado base REAL de la base (medido, 5178 leads)

**La base está sorprendentemente sana — la limpieza es marginal, no masiva.**

- **Dueños:** Paula 2282 (44%), Maximiliano 1021, Ignacio 843, Genaro 733, **+299 huérfanos sin assignedTo**. ⚠️ Solo quedan **4 setters** vivos (Alexander/Gabriela/Yesxander/Ivi YA no existen — CLAUDE.md #47 obsoleta).
- **Trabajados 71.8% (3720) / sin tocar 28.2% (1458).**
- **WhatsApp-capable ~76.7%** (móvil/high). Fijo-only (call lane) ~485 (9.4%). ⚠️ `wspProbability` es binario y casi todo 'low' por default → la heurística de prefijo es el discriminador real.
- **Riqueza:** RICH 1845 (36%), MEDIUM 2293 (44%), THIN 1040 (20%). Perú es el más pobre; México/España los más ricos.
- **Roto/suprimir:** solo **56** (39 invalid + otros). **0 sin teléfono.** Data MUY limpia.

### Los cross-tabs que importan (cuánto hay en cada carril)

| Segmento | count |
|---|---|
| **Re-engage** (trabajado no cerrado: contactado/respondió/calificado/interesado) | **2465** (47% — el mayor volumen) |
| **Prime bot/mensaje** (nunca tocado + WA + RICH/MEDIUM) | **1235** |
| Mensaje tras enriquecer (nunca tocado + WA + THIN) | 136 |
| Carril llamada (nunca tocado + sin WA) | 86 |
| Suprimir (roto/invalid/voicemail) | 56 |
| Remover (THIN + sin WA) | 270 |

→ **El peso real NO es prospección fría — es re-engagement (2465).** Y la cola limpia para arrancar el bot son 1235 leads.

### history.json (9179 entradas)
Es el **log de scraping, NO accionable** (no tiene teléfonos). ~6122 negocios scrapeados nunca entraron a setters → pool sin explotar, pero **requiere re-scraping** para usarse.

---

## Hallazgo de código relevante (BUG confirmado)

⚠️ El flag **`include=callable`** (CLAUDE.md #53, el checkbox "Incluir leads de Setteo") **NO está cableado** — `GET /api/setters/leads/sin-wsp` solo mira el param `setter`, no `include`. Por eso no podés ver el pool completo callable. **Hay que arreglarlo** (es justo lo que pediste: "tener la lista completa de leads para distribuir").

Otros: `assignedTo` = ownership. `conexion='sin_wsp'` rutea a llamadas. Import auto-rutea (sin señal WA → sin_wsp). `reassign-bulk` (admin, untouched-only, backups). Phase 7 campaigns = el carril bot (`selectLeadsFromMap` por país/setter/estado). Patrón de migración atómico (`/api/admin/import-data` + backups) reusable.

---

## El blueprint: pool único + 4 cuadrantes de propiedad

### Paso 0 — Enriquecer el pool (la inversión #1)
Dos campos derivados, no editables a mano:
- `lineType`: mobile | landline | voip | invalid (line-type lookup: IPQS/Veriphone/Clearout).
- `waCapable`: true | false | unknown (WhatsApp-capable check: Whapi/CheckNumber, batch).
Sin esto, todo el routing es adivinanza.

### Paso 1 — Higiene (DELETE solo lo muerto, SUPPRESS el resto)
```
lineType=invalid/disconnected        → DELETE (archivar)
duplicado                            → MERGE al más rico, DELETE sobrante
optOut/bloqueó/reportó "no escribir" → SUPPRESS permanente (lista global, NUNCA re-importar)
sin teléfono y sin otro canal        → DELETE
resto                                → KEEP
```

### Paso 2 — Score + Tier (deriva del `_callScore`, conserva la memoria previa)
```
score = fit(reseñas+rating) + dataCompleteness + reachability(WA>móvil>fijo)
      + historial(interesado+, callback vencido+, intentos−, voicemail−) − (wrong/invalid)
tier = A | B | C
```

### Paso 3 — Routing a `lane`
```
waCapable + tier A/B + (frío/tibio)        → LANE_WA_HUMANO (Paula/Maxi)  [message-first]
waCapable + tier C + frío bajo riesgo      → LANE_BOT (pool sistema)       [automate-first]
sin WA (mobile/landline/voip con voz)      → LANE_CALL (admin/vos)         [call-first]
intención alta/interesado/decisor/valor    → LANE_CALL (override, gana)    [voz cierra]
```
Fallback: bot no responde N → WA humano → no responde → llamada.

### Paso 4 — Propiedad híbrida (4 cuadrantes sobre el mismo pool)
- **LANE_WA_HUMANO** → `assignedTo`=Paula/Maxi. Su cartera, sus métricas. (sin cambio)
- **LANE_CALL** → `assignedTo`=setter_ignacio (tu espacio de llamada). (ya existe)
- **LANE_BOT** → sin dueño humano; lo gestiona el motor (Phase 7). Al responder → handoff: assignedTo=setter + respondio=true. (ya implementado)
- **POOL_STAGING** → sin asignar, limpio y tiereado, **desde donde VOS distribuís.** Tu panel de reparto.

### Paso 5 — Prioridad dentro de cada carril
Callbacks vencidos → interesados/tibios → vírgenes tier A → B → C. (Por score desc.)

### Re-contacto
Cooldown 3-6 meses para trabajado-sin-éxito. "Interesado" viejo no cerrado = **tier A de re-engagement** (vale más que un virgen). Opt-out/bloqueó = nunca reentra.

---

## Correcciones al modelo mental del user (importantes)

1. **Sin-WhatsApp NO es borrar** — es `LANE_CALL`. Un fijo de una clínica con 200 reseñas es un lead A de llamada, no basura.
2. **Borrar solo lo técnicamente muerto** (inválido/desconectado/duplicado). Lo demás se **suprime o baja de tier, nunca se destruye** — re-scrapear te lo devuelve y perdés el historial.
3. **Reordenar desde cero ≠ borrar la memoria.** Limpiá la *asignación operativa*, conservá `callLog/interactions/notes` como combustible del score. El trabajo de Paula/Maxi es tu mejor señal. (El redistribute del 2026-05-24 SÍ borró esa memoria — esta vez NO.)
4. **La lista de supresión (opt-outs/blocks) es el activo de seguridad #1 del bot** — lo que mantiene vivas tus cuentas de WhatsApp. Sagrada.

---

## Surgical scope (de la auditoría de código)

- Agregar campos al lead: `lineType`, `waCapable`, `lane`, `tier`, `score`, `suppressedReason`, `lastWorkedAt`.
- **Arreglar el bug `include=callable`** (el pool completo callable).
- Migración one-shot: derivar `lane` de `conexion` actual + reasignar 299 huérfanos + enriquecer lineType/waCapable (batch). Reusar patrón atómico `/api/admin/import-data` + backups.
- Vistas = carriles: `view-calls`/Power Dialer=LANE_CALL; `view-crm`=LANE_WA_HUMANO; Phase 7=LANE_BOT; **nueva vista admin POOL_STAGING** para distribuir.
- Stats channel-aware. Lista de supresión global nueva.

---

## Estado

- 2026-06-17 — Phase 14 sintetizada de 3 agentes. La base está sana (limpieza marginal).
  El trabajo grande es re-engagement (2465) + enriquecer lineType/waCapable + el pool de staging.
  Pendiente: cerrar planificación y definir secuencia de build.

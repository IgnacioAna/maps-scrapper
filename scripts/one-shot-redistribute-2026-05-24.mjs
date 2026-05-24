#!/usr/bin/env node
/**
 * One-shot 2026-05-24 — Reset + redistribute Yesxander + Evelio + Ivi,
 * recuperar limbo restante, eliminar setter_evelio.
 *
 * Pasos:
 *  1. Lee data/setters.json local (debe estar fresh post-pre-deploy)
 *  2. Fase 1: reset CERO de CERO los 325 leads (Yesxander 298 + Evelio 4 + Ivi 23)
 *     y redistribuye con weights Paula 30 / Maxi 25 / Genaro 20 / Gabriela 15 / Alex 10
 *  3. Fase 2: recupera 627 limbo restantes (clean conexion='sin_wsp' a '')
 *  4. Fase 3: elimina setter_evelio del array
 *  5. Sube via /api/admin/import-data
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, "..", "data");

const RAILWAY_URL = (process.env.RAILWAY_URL || "https://scm-setting.up.railway.app").replace(/\/+$/, "");
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error("Faltan ADMIN_EMAIL / ADMIN_PASSWORD env vars");
  process.exit(1);
}

const DESTS = [
  { id: "setter_paula",                weight: 30, name: "Paula" },
  { id: "setter_maximiliano_escalera", weight: 25, name: "Maxi" },
  { id: "setter_genaro_de_mori",       weight: 20, name: "Genaro" },
  { id: "setter_gabriela_palazzotti",  weight: 15, name: "Gabriela" },
  { id: "setter_alexander_salgueiro",  weight: 10, name: "Alexander" },
];
const SOURCES_TO_RESET = ["setter_yesxander", "setter_evelio", "setter_ivi_treise"];

const data = JSON.parse(fs.readFileSync(path.join(DATA, "setters.json"), "utf8"));
const allLeadEntries = Object.entries(data.leads || {});

console.log(`Loaded ${allLeadEntries.length} leads from data/setters.json`);

// ───────────────────────────────────────────────────────────────────
// FASE 1: identificar y resetear los 325 leads
// ───────────────────────────────────────────────────────────────────
const toReset = allLeadEntries.filter(([_, l]) => SOURCES_TO_RESET.includes(l.assignedTo));
console.log(`\n[FASE 1] Leads a resetear (Yesxander+Evelio+Ivi): ${toReset.length}`);

const total = toReset.length;
const totalWeight = DESTS.reduce((s, d) => s + d.weight, 0);
// Calcular cuántos van a cada destino
const quotas = DESTS.map((d) => ({
  ...d,
  quota: Math.floor((d.weight / totalWeight) * total),
}));
// Asignar el resto al primero (mayor weight)
let assigned = quotas.reduce((s, q) => s + q.quota, 0);
let leftover = total - assigned;
let i = 0;
while (leftover > 0) {
  quotas[i % quotas.length].quota += 1;
  leftover--;
  i++;
}
console.log("[FASE 1] Distribución:");
for (const q of quotas) console.log(`  ${q.name}: ${q.quota}`);

// Shuffle leads para distribución uniforme (no quedan todos los de Yesxander en un setter)
const shuffled = [...toReset].sort(() => Math.random() - 0.5);

let cursor = 0;
let resetCount = 0;
for (const q of quotas) {
  const batch = shuffled.slice(cursor, cursor + q.quota);
  for (const [id, lead] of batch) {
    // Reset CERO de CERO: borrar todo el historial + reasignar
    data.leads[id] = {
      // Preservar SOLO la data estática del lead original (scraping data)
      ...lead,
      // Reset de campos de estado
      conexion: "",
      apertura: "",
      respondio: false,
      calificado: false,
      interes: null,
      estado: "sin_contactar",
      // Reset de cascada / historial
      interactions: [],
      notes: [],
      callLog: [],
      followUps: {},
      followUpStartedAt: null,
      followUpNotes: {},
      followUpDueOverrides: {},
      followUpsReactivated: false,
      lastContactAt: "",
      lastStage: null,
      lastVariantId: null,
      phoneStatus: "",
      callbackAt: "",
      callAttempts: 0,
      precallNote: "",
      asistio: null,
      asistioAt: "",
      asistioBy: "",
      // Reasignar
      assignedTo: q.id,
      // Limpiar variant assignment (que el nuevo setter use la suya por default)
      varianteId: null,
      setterPhoneId: null,
    };
    resetCount++;
  }
  cursor += q.quota;
}
console.log(`[FASE 1] Reseteados + reasignados: ${resetCount}`);

// ───────────────────────────────────────────────────────────────────
// FASE 2: recuperar limbo de los 5 setters restantes
// ───────────────────────────────────────────────────────────────────
let recoverCount = 0;
for (const [id, lead] of allLeadEntries) {
  if (SOURCES_TO_RESET.includes(lead.assignedTo)) continue; // ya manejados en fase 1
  if (lead.estado === "sin_contactar" && lead.conexion === "sin_wsp") {
    data.leads[id] = {
      ...data.leads[id],
      conexion: "",
    };
    recoverCount++;
  }
}
console.log(`\n[FASE 2] Limbo recuperados (in-place): ${recoverCount}`);

// ───────────────────────────────────────────────────────────────────
// FASE 3: eliminar setter_evelio del array de setters
// ───────────────────────────────────────────────────────────────────
const beforeSetters = (data.setters || []).length;
data.setters = (data.setters || []).filter((s) => s.id !== "setter_evelio");
const afterSetters = data.setters.length;
console.log(`\n[FASE 3] Setters: ${beforeSetters} → ${afterSetters} (eliminado setter_evelio)`);

// ───────────────────────────────────────────────────────────────────
// Verificación pre-upload
// ───────────────────────────────────────────────────────────────────
const finalCounts = {};
for (const lead of Object.values(data.leads)) {
  finalCounts[lead.assignedTo || "(none)"] = (finalCounts[lead.assignedTo || "(none)"] || 0) + 1;
}
console.log("\n=== TOTAL por setter (post-cambios) ===");
for (const [s, n] of Object.entries(finalCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${s}: ${n}`);
}

const sinContactarFinal = Object.values(data.leads).filter((l) => !l.conexion);
const scByS = {};
for (const l of sinContactarFinal) scByS[l.assignedTo || "(none)"] = (scByS[l.assignedTo || "(none)"] || 0) + 1;
console.log("\n=== Sin contactar (!l.conexion) por setter ===");
for (const [s, n] of Object.entries(scByS).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${s}: ${n}`);
}

// ───────────────────────────────────────────────────────────────────
// Subir a producción via /api/admin/import-data
// ───────────────────────────────────────────────────────────────────
console.log("\n[UPLOAD] Logueando en Railway...");
const loginResp = await fetch(`${RAILWAY_URL}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
});
if (!loginResp.ok) {
  console.error("Login falló:", await loginResp.text());
  process.exit(1);
}
const setCookie = loginResp.headers.getSetCookie?.() || loginResp.headers.raw?.()?.["set-cookie"] || [];
const cookie = (Array.isArray(setCookie) ? setCookie : [setCookie]).map((c) => c.split(";")[0]).join("; ");
if (!cookie) { console.error("No cookie"); process.exit(1); }
console.log("[UPLOAD] Login OK. Subiendo data...");

const upResp = await fetch(`${RAILWAY_URL}/api/admin/import-data`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: cookie },
  body: JSON.stringify({ setters: data }),
});
const upBody = await upResp.text();
if (!upResp.ok) {
  console.error(`[UPLOAD] Falló (${upResp.status}):`, upBody);
  process.exit(1);
}
console.log(`[UPLOAD] OK:`, upBody);

// Guardar local también
fs.writeFileSync(path.join(DATA, "setters.json"), JSON.stringify(data, null, 2));
console.log("\n[LOCAL] data/setters.json actualizado tambien (consistente con prod).");
console.log("\nLISTO.");

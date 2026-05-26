#!/usr/bin/env node
/**
 * 2026-05-25 — Devolver los 100 mexicanos trabajados a sus setters originales
 * y mandar a Ignacio 100 mexicanos REALMENTE sin trabajar (reseteados cero
 * de cero por las dudas). Incluye Mex puro (+52), Tijuana fronteriza (+1
 * area codes 619/664), y leads scrapeados en city Mexico/Tijuana/etc.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, "..", "data");
const BACKUP = path.join(DATA, "setters.json.bak-pre-nophonedelete-1779807884");
const RAILWAY_URL = "https://scm-setting.up.railway.app";

const data = JSON.parse(fs.readFileSync(path.join(DATA, "setters.json"), "utf8"));
const backup = JSON.parse(fs.readFileSync(BACKUP, "utf8"));
const setters = (data.setters || []).reduce((m, s) => { m[s.id] = s.name; return m; }, {});

// ── FASE 1: Revertir los 100 mexicanos actuales en Ignacio
const mexInIgnacio = Object.entries(data.leads || {})
  .filter(([id, l]) => l.assignedTo === "setter_ignacio" && typeof l.num === "number" && l.num >= -10000 && l.num <= -9901)
  .map(([id]) => id);
let reverted = 0;
for (const id of mexInIgnacio) {
  const orig = backup.leads[id];
  if (!orig) continue;
  data.leads[id] = orig; // restaurar lead completo
  reverted++;
}
console.log(`[FASE 1] Mexicanos revertidos a setters originales: ${reverted}`);

// ── FASE 2: Buscar mexicanos SIN trabajar (cero de cero)
const isUnworked = (l) =>
  l.estado === "sin_contactar" &&
  !l.conexion &&
  !l.respondio &&
  !l.calificado &&
  !l.interes &&
  (!Array.isArray(l.interactions) || l.interactions.length === 0) &&
  (!Array.isArray(l.callLog) || l.callLog.length === 0) &&
  (!Array.isArray(l.notes) || l.notes.length === 0) &&
  !l.lastContactAt &&
  !l.callbackAt &&
  l.assignedTo !== "setter_ignacio" &&
  l.phone && String(l.phone).trim();

const isMexLike = (l) => {
  const c = String(l.country || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();
  if (c === "mexico") return true;
  const city = String(l.city || "").toLowerCase();
  if (/tijuana|monterrey|guadalajara|puebla|ciudad.*mexico|cdmx|mexico city|juarez|cancun/.test(city)) return true;
  const loc = String(l.locationSearched || "").toLowerCase();
  if (/mexico|tijuana|monterrey|guadalajara|puebla/.test(loc)) return true;
  const p = String(l.phone || "").replace(/\D/g, "");
  if (p.startsWith("52")) return true;
  // Tijuana usa US area codes 619, 664, 686, etc. detect raw 10-digit phones from BC border
  if (p.length === 10 && /^(619|664|686|663|686)/.test(p)) return true;
  return false;
};

const candidates = Object.entries(data.leads || {}).filter(([id, l]) => isMexLike(l) && isUnworked(l));
console.log(`[FASE 2] Candidatos Mex+Tijuana sin trabajar: ${candidates.length}`);

if (candidates.length < 100) {
  console.warn(`  Solo hay ${candidates.length} candidatos. Mando todos.`);
}

// Distribución proporcional desde varios setters
const bySetter = {};
for (const [id, l] of candidates) {
  if (!bySetter[l.assignedTo]) bySetter[l.assignedTo] = [];
  bySetter[l.assignedTo].push([id, l]);
}
const total = Math.min(100, candidates.length);
const sids = Object.keys(bySetter);
const sourceTotal = candidates.length;
const quotas = sids.map((sid) => ({ sid, quota: Math.floor((bySetter[sid].length / sourceTotal) * total) }));
let assigned = quotas.reduce((s, q) => s + q.quota, 0);
let leftover = total - assigned;
quotas.sort((a, b) => bySetter[b.sid].length - bySetter[a.sid].length);
let i = 0;
while (leftover > 0 && i < 1000) {
  if (quotas[i % quotas.length].quota < bySetter[quotas[i % quotas.length].sid].length) {
    quotas[i % quotas.length].quota += 1;
    leftover--;
  }
  i++;
}

console.log("[FASE 2] Distribución origen (proporcional):");
for (const q of quotas) console.log(`  ${setters[q.sid] || q.sid}: ${q.quota}`);

// Pickear shuffled de cada setter
const picked = [];
for (const q of quotas) {
  const shuf = [...bySetter[q.sid]].sort(() => Math.random() - 0.5);
  picked.push(...shuf.slice(0, q.quota));
}
console.log(`[FASE 2] Pickeados: ${picked.length}`);

// ── FASE 3: Reset cero de cero + asignar con num negativo
let cursor = -10000;
for (const [id, l] of picked) {
  data.leads[id] = {
    ...l,
    // estado limpio
    conexion: "",
    apertura: "",
    respondio: false,
    calificado: false,
    interes: null,
    estado: "sin_contactar",
    // historial vacío
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
    // reasignar
    assignedTo: "setter_ignacio",
    num: cursor,
    // limpiar variant
    varianteId: null,
    setterPhoneId: null,
  };
  cursor++;
}
console.log(`[FASE 3] Reseteados + asignados a Ignacio: ${picked.length} (num -10000 → ${cursor - 1})`);

// ── FASE 4: Upload
const login = await fetch(`${RAILWAY_URL}/api/auth/login`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "ignacio.scmdental@gmail.com", password: "Ignacio2026!" }),
});
const setCookie = login.headers.getSetCookie?.() || login.headers.raw?.()?.["set-cookie"] || [];
const cookie = (Array.isArray(setCookie) ? setCookie : [setCookie]).map((c) => c.split(";")[0]).join("; ");
const up = await fetch(`${RAILWAY_URL}/api/admin/import-data`, {
  method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
  body: JSON.stringify({ setters: data }),
});
console.log("[UPLOAD]", up.status, await up.text());
if (!up.ok) process.exit(1);

fs.writeFileSync(path.join(DATA, "setters.json"), JSON.stringify(data, null, 2));
console.log("\nLISTO.");

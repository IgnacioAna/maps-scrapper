#!/usr/bin/env node
/**
 * 2026-05-25 — Mover 100 leads de México + 100 de Quito a setter_ignacio.
 * Distribución proporcional (saca más del setter que más tiene).
 * Asigna num negativo así aparecen PRIMERO en la lista del setter Ignacio.
 * Mexicanos primero (num más negativo), Quito después.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, "..", "data");
const RAILWAY_URL = "https://scm-setting.up.railway.app";

const data = JSON.parse(fs.readFileSync(path.join(DATA, "setters.json"), "utf8"));
const setters = (data.setters || []).reduce((m, s) => { m[s.id] = s.name; return m; }, {});
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();

// 1. Identificar candidatos
const allEntries = Object.entries(data.leads || {});
const mexCandidates = allEntries.filter(([id, l]) =>
  norm(l.country) === "mexico" && l.assignedTo !== "setter_ignacio" && l.phone && String(l.phone).trim()
);
const quitoCandidates = allEntries.filter(([id, l]) =>
  (norm(l.city) === "quito" || /quito/i.test(l.locationSearched || "")) &&
  l.assignedTo !== "setter_ignacio" && l.phone && String(l.phone).trim()
);
console.log(`Candidatos México: ${mexCandidates.length} · Quito: ${quitoCandidates.length}`);

// 2. Distribución proporcional helper
function pickProportional(candidates, total) {
  const bySetter = {};
  for (const [id, l] of candidates) {
    if (!bySetter[l.assignedTo]) bySetter[l.assignedTo] = [];
    bySetter[l.assignedTo].push([id, l]);
  }
  const setterIds = Object.keys(bySetter);
  const totals = setterIds.reduce((s, id) => s + bySetter[id].length, 0);
  // Calcular quota por setter (floor)
  const quotas = setterIds.map((sid) => ({
    sid,
    quota: Math.floor((bySetter[sid].length / totals) * total),
  }));
  // Repartir resto al setter con MÁS disponibles
  let assigned = quotas.reduce((s, q) => s + q.quota, 0);
  let leftover = total - assigned;
  quotas.sort((a, b) => bySetter[b.sid].length - bySetter[a.sid].length);
  let i = 0;
  while (leftover > 0) {
    if (quotas[i % quotas.length].quota < bySetter[quotas[i % quotas.length].sid].length) {
      quotas[i % quotas.length].quota += 1;
      leftover--;
    }
    i++;
    if (i > 1000) break; // safety
  }
  // Tomar leads shuffled de cada setter
  const picked = [];
  for (const q of quotas) {
    const shuffled = [...bySetter[q.sid]].sort(() => Math.random() - 0.5);
    picked.push(...shuffled.slice(0, q.quota));
  }
  return { picked, quotas };
}

const mexPick = pickProportional(mexCandidates, 100);
const quitoPick = pickProportional(quitoCandidates, 100);

console.log("\n=== MÉXICO (100) — origen ===");
for (const q of mexPick.quotas) console.log(`  ${setters[q.sid] || q.sid}: ${q.quota}`);
console.log("\n=== QUITO (100) — origen ===");
for (const q of quitoPick.quotas) console.log(`  ${setters[q.sid] || q.sid}: ${q.quota}`);

// 3. Reasignar + setear num negativo. México primero (más negativo).
let cursor = -10000;
for (const [id, l] of mexPick.picked) {
  data.leads[id] = { ...l, assignedTo: "setter_ignacio", num: cursor };
  cursor++;
}
const mexLast = cursor; // ahora -9900 si pickeó 100
console.log(`\nMéxico num: -10000 → ${mexLast - 1}`);

for (const [id, l] of quitoPick.picked) {
  data.leads[id] = { ...l, assignedTo: "setter_ignacio", num: cursor };
  cursor++;
}
console.log(`Quito num: ${mexLast} → ${cursor - 1}`);

// 4. Upload
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
console.log("\n[UPLOAD]", up.status, await up.text());

fs.writeFileSync(path.join(DATA, "setters.json"), JSON.stringify(data, null, 2));
console.log("Local actualizado. LISTO.");

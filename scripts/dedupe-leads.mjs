#!/usr/bin/env node
/**
 * dedupe-leads.mjs
 *
 * Detecta leads en data/setters.json con el mismo teléfono normalizado.
 * NUNCA borra ni mergea — solo reporta para revisión manual del admin.
 *
 * Output:
 *   - lista de grupos duplicados con leadId, nombre, estado, assignedTo, last contact
 *   - JSON exportable a stdout con --json para procesar después
 *
 * Phone normalization: sólo dígitos, mínimo 8 chars (filtra basura).
 *
 * Uso:
 *   node scripts/dedupe-leads.mjs            # report human-readable
 *   node scripts/dedupe-leads.mjs --json     # JSON estructurado
 *   node scripts/dedupe-leads.mjs --by email # dedup por email en vez de phone
 *
 * Read-only. Nunca modifica data/.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "setters.json");

const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json");
const byIdx = args.indexOf("--by");
const BY = byIdx >= 0 ? args[byIdx + 1] : "phone";

if (!["phone", "email"].includes(BY)) {
  console.error(`--by debe ser "phone" o "email" (recibido: "${BY}")`);
  process.exit(1);
}

if (!fs.existsSync(FILE)) {
  console.error(`FATAL: no existe ${FILE}`);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
const leads = data.leads || {};
const setters = (data.setters || []).reduce((acc, s) => { acc[s.id] = s.name; return acc; }, {});

function normalize(value) {
  if (!value) return "";
  if (BY === "phone") {
    const digits = String(value).replace(/\D/g, "");
    return digits.length >= 8 ? digits : "";
  }
  if (BY === "email") {
    const v = String(value).toLowerCase().trim();
    // Filtrar placeholders y basura común
    const blocked = ["info@", "soporte@", "usuario@", "ejemplo@", "user@", "nombre@", "email@", "contacto@", "cliente@", "consulta@"];
    if (blocked.some((b) => v.startsWith(b))) return "";
    if (!/^[^@]+@[^@.]+\.[a-z]/.test(v)) return "";
    return v;
  }
}

const buckets = new Map();
for (const [lid, l] of Object.entries(leads)) {
  const k = normalize(l[BY]);
  if (!k) continue;
  if (!buckets.has(k)) buckets.set(k, []);
  buckets.get(k).push({ lid, ...l });
}

const dupes = [...buckets.entries()].filter(([, arr]) => arr.length > 1);

if (JSON_OUT) {
  const output = dupes.map(([key, arr]) => ({
    key,
    count: arr.length,
    leads: arr.map((l) => ({
      id: l.lid,
      name: l.name,
      assignedTo: l.assignedTo,
      setterName: setters[l.assignedTo] || "(huerfano)",
      estado: l.estado,
      conexion: l.conexion,
      respondio: l.respondio,
      lastContactAt: l.lastContactAt || null,
    })),
  }));
  console.log(JSON.stringify({ groupBy: BY, totalLeads: Object.keys(leads).length, duplicateGroups: output.length, output }, null, 2));
  process.exit(0);
}

console.log("=".repeat(70));
console.log(`DEDUPE-LEADS (por ${BY})`);
console.log("=".repeat(70));
console.log(`Total leads:           ${Object.keys(leads).length}`);
console.log(`Grupos duplicados:     ${dupes.length}`);
console.log(`Total leads dupes:     ${dupes.reduce((a, [, arr]) => a + arr.length, 0)}`);

if (dupes.length === 0) {
  console.log("\nOK — sin duplicados.");
  process.exit(0);
}

// Ordenar por tamaño de grupo desc (más urgentes primero)
dupes.sort((a, b) => b[1].length - a[1].length);

console.log("\n=== TOP 20 GRUPOS ===");
for (const [key, arr] of dupes.slice(0, 20)) {
  console.log(`\n${BY}=${key} -> ${arr.length} leads`);
  for (const l of arr) {
    const sname = setters[l.assignedTo] || "(huerfano)";
    const status = [l.estado || "?", l.conexion || "-", l.respondio ? "resp" : "", l.calificado ? "cal" : ""].filter(Boolean).join("/");
    console.log(`  - ${l.lid}  "${(l.name || "").slice(0, 40)}"  ${sname}  [${status}]`);
  }
}

if (dupes.length > 20) {
  console.log(`\n... +${dupes.length - 20} grupos más (usar --json para ver todos)`);
}

console.log(`\nNo se modificó nada. Para mergear, revisar caso por caso desde el panel admin.`);

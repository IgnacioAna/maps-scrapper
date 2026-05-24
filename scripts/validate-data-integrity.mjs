#!/usr/bin/env node
/**
 * validate-data-integrity.mjs
 *
 * Chequea integridad referencial de data/ y exit code != 0 si encuentra
 * orphans (refs a IDs inexistentes). Pensado para pre-deploy hooks o CI.
 *
 * Detecta:
 *   - leads.assignedTo apuntando a setter que no existe
 *   - leads.varianteId apuntando a variante que no existe
 *   - leads.interactions[].setterId huerfano
 *   - leads.callLog[].setterId / byId huerfano
 *   - sesiones de setteo con setter huerfano
 *   - wa_events[].accountId apuntando a cuenta WA que no existe
 *   - calendar[].setterId/leadId huerfanos
 *   - sesiones de setteo abiertas (endedAt:null) > 24h (warning, no error)
 *
 * Uso:
 *   node scripts/validate-data-integrity.mjs           # exit 1 si hay orphans
 *   node scripts/validate-data-integrity.mjs --warn    # exit 0 siempre, log only
 *
 * Read-only. Nunca modifica data/.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, "..", "data");
const WARN_ONLY = process.argv.includes("--warn");

function readJson(name) {
  const p = path.join(DATA_DIR, name);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    console.error(`PARSE ERR ${name}: ${e.message}`);
    return null;
  }
}

const auth = readJson("auth.json") || { users: [] };
const settersDoc = readJson("setters.json");
const waAcc = readJson("wa_accounts.json") || { accounts: [] };
const waEv = readJson("wa_events.json") || { events: [] };

if (!settersDoc) {
  console.error("FATAL: data/setters.json no existe o no parsea.");
  process.exit(1);
}

const setterIds = new Set((settersDoc.setters || []).map((s) => s.id));
const variantIds = new Set((settersDoc.variants || []).map((v) => v.id));
const userIds = new Set((auth.users || []).map((u) => u.id));
const leads = settersDoc.leads || {};
const leadIds = new Set(Object.keys(leads));
const calendar = settersDoc.calendar || [];
const sessions = settersDoc.sessions || [];
const accountIds = new Set((waAcc.accounts || []).map((a) => a.id));

const problems = [];
const warnings = [];

// 1. leads.assignedTo
let orphanAssigned = 0;
for (const [lid, l] of Object.entries(leads)) {
  if (l.assignedTo && !setterIds.has(l.assignedTo)) {
    orphanAssigned++;
    if (orphanAssigned <= 5) problems.push(`lead ${lid}.assignedTo = "${l.assignedTo}" (setter no existe)`);
  }
}
if (orphanAssigned > 5) problems.push(`... +${orphanAssigned - 5} leads más con assignedTo huerfano`);

// 2. leads.varianteId
let orphanVar = 0;
for (const [lid, l] of Object.entries(leads)) {
  if (l.varianteId && !variantIds.has(l.varianteId)) {
    orphanVar++;
    if (orphanVar <= 5) problems.push(`lead ${lid}.varianteId = "${l.varianteId}" (variante no existe)`);
  }
}
if (orphanVar > 5) problems.push(`... +${orphanVar - 5} leads más con varianteId huerfano`);

// 3. interactions[].setterId
let orphanInt = 0;
for (const [lid, l] of Object.entries(leads)) {
  for (const i of l.interactions || []) {
    if (i.setterId && !setterIds.has(i.setterId)) {
      orphanInt++;
      if (orphanInt <= 5) problems.push(`lead ${lid}.interactions[].setterId = "${i.setterId}" huerfano`);
    }
  }
}
if (orphanInt > 5) problems.push(`... +${orphanInt - 5} interactions huérfanas`);

// 4. callLog[].setterId / byId
let orphanCall = 0;
for (const [lid, l] of Object.entries(leads)) {
  for (const c of l.callLog || []) {
    if (c.setterId && !setterIds.has(c.setterId)) {
      orphanCall++;
      if (orphanCall <= 5) problems.push(`lead ${lid}.callLog[].setterId = "${c.setterId}" huerfano`);
    }
    if (c.byId && !userIds.has(c.byId)) {
      orphanCall++;
      if (orphanCall <= 5) problems.push(`lead ${lid}.callLog[].byId = "${c.byId}" huerfano`);
    }
  }
}
if (orphanCall > 5) problems.push(`... +${orphanCall - 5} callLog entries huérfanas`);

// 5. sessions[].setter
let orphanSess = 0;
for (const s of sessions) {
  if (s.setter && !setterIds.has(s.setter)) {
    orphanSess++;
    problems.push(`session ${s.id}.setter = "${s.setter}" huerfano`);
  }
}

// 6. wa_events[].accountId
let orphanWaEv = 0;
for (const e of waEv.events || []) {
  if (e.accountId && !accountIds.has(e.accountId)) {
    orphanWaEv++;
    if (orphanWaEv <= 5) problems.push(`wa_event ${e.id}.accountId = "${e.accountId}" huerfano`);
  }
}
if (orphanWaEv > 5) problems.push(`... +${orphanWaEv - 5} wa_events huérfanos`);

// 7. calendar[].setterId / leadId
let orphanCal = 0;
for (const c of calendar) {
  if (c.setterId && !setterIds.has(c.setterId)) {
    orphanCal++;
    problems.push(`calendar ${c.id}.setterId = "${c.setterId}" huerfano`);
  }
  if (c.leadId && !leadIds.has(c.leadId)) {
    orphanCal++;
    problems.push(`calendar ${c.id}.leadId = "${c.leadId}" huerfano`);
  }
}

// WARNINGS (no error de exit, solo informativo)

// 8. Sesiones de setteo abiertas (endedAt:null) > 24h
const NOW = Date.now();
const MS_24H = 86400000;
const openSessions = sessions.filter((s) => s.endedAt === null || s.endedAt === undefined);
for (const s of openSessions) {
  const age = NOW - new Date(s.startedAt).getTime();
  if (isNaN(age)) continue;
  const ageH = (age / 3600000).toFixed(1);
  if (age > MS_24H) warnings.push(`session ${s.id} (setter=${s.setter}) abierta hace ${ageH}h (>24h)`);
}

// 9. Variantes huérfanas (informativo)
const usedVariantIds = new Set();
for (const l of Object.values(leads)) if (l.varianteId) usedVariantIds.add(l.varianteId);
const unusedVariants = (settersDoc.variants || []).filter((v) => !usedVariantIds.has(v.id));
for (const v of unusedVariants) warnings.push(`variante "${v.name}" (${v.id}) no usada por ningún lead`);

// 10. myPhones con phone vacío
for (const s of settersDoc.setters || []) {
  for (const p of s.myPhones || []) {
    if (!p.phone || !String(p.phone).trim()) {
      warnings.push(`setter "${s.name}".myPhones[${p.id}] tiene phone vacío`);
    }
  }
}

// ========== REPORT ==========
console.log("=".repeat(70));
console.log("VALIDATE-DATA-INTEGRITY — " + new Date().toISOString());
console.log("=".repeat(70));
console.log(`Setters: ${setterIds.size} | Variants: ${variantIds.size} | Leads: ${leadIds.size}`);
console.log(`Sessions: ${sessions.length} (${openSessions.length} abiertas) | Calendar: ${calendar.length}`);
console.log(`WA accounts: ${accountIds.size} | WA events: ${(waEv.events || []).length}`);

if (problems.length === 0) {
  console.log("\nOK — sin orphans referenciales.");
} else {
  console.log(`\nORPHANS DETECTADOS: ${problems.length}`);
  for (const p of problems) console.log("  - " + p);
}

if (warnings.length > 0) {
  console.log(`\nWARNINGS: ${warnings.length}`);
  for (const w of warnings) console.log("  ? " + w);
}

if (problems.length > 0 && !WARN_ONLY) {
  console.error("\nExit 1: hay orphans. Usá --warn para no fallar.");
  process.exit(1);
}
process.exit(0);

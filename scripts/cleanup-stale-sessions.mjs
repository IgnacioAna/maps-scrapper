#!/usr/bin/env node
/**
 * cleanup-stale-sessions.mjs
 *
 * Cierra sesiones de setteo (setters.json -> sessions[]) con endedAt:null
 * abiertas hace más de N días (default 7). Setea endedAt = lastActivityAt
 * (si existe) o startedAt, y agrega autoClosedAt + autoClosedReason.
 *
 * Las sesiones abiertas viejas distorsionan métricas (sumario de duraciones)
 * y suelen ser resultado de un crash del browser o el setter cerrando tab sin
 * "finalizar sesión". El cierre es seguro porque el setter siempre puede
 * iniciar una nueva.
 *
 * Uso:
 *   node scripts/cleanup-stale-sessions.mjs                  # default 7d, dry-run
 *   node scripts/cleanup-stale-sessions.mjs --apply           # aplica cambios
 *   node scripts/cleanup-stale-sessions.mjs --days 14 --apply # cambia umbral
 *
 * Hace backup automático a setters.json.bak-pre-cleanup-<ts> antes de escribir.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "setters.json");

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const dIdx = args.indexOf("--days");
const DAYS = dIdx >= 0 ? parseInt(args[dIdx + 1], 10) || 7 : 7;

if (!fs.existsSync(FILE)) {
  console.error(`FATAL: no existe ${FILE}`);
  process.exit(1);
}

const raw = fs.readFileSync(FILE, "utf8");
const data = JSON.parse(raw);
const sessions = data.sessions || [];

const NOW = Date.now();
const MS = DAYS * 86400000;

const candidates = sessions.filter((s) => {
  if (s.endedAt !== null && s.endedAt !== undefined) return false;
  const t = new Date(s.startedAt).getTime();
  return !isNaN(t) && NOW - t > MS;
});

console.log(`=== CLEANUP-STALE-SESSIONS ===`);
console.log(`Threshold: ${DAYS} días | Total sessions: ${sessions.length}`);
console.log(`Candidatas a cerrar (open >${DAYS}d): ${candidates.length}`);
for (const s of candidates) {
  const ageD = ((NOW - new Date(s.startedAt).getTime()) / 86400000).toFixed(1);
  console.log(`  ${s.id} setter=${s.setter} startedAt=${s.startedAt} age=${ageD}d`);
}

if (candidates.length === 0) {
  console.log("\nNada que cerrar.");
  process.exit(0);
}

if (!APPLY) {
  console.log("\n[dry-run] Usar --apply para escribir cambios.");
  process.exit(0);
}

// Apply
const ts = new Date().toISOString().replace(/[:.]/g, "-");
const backup = `${FILE}.bak-pre-cleanup-${ts}`;
fs.writeFileSync(backup, raw);
console.log(`\nBackup: ${backup}`);

const closedAt = new Date().toISOString();
let closed = 0;
for (const s of sessions) {
  if (!candidates.includes(s)) continue;
  s.endedAt = s.lastActivityAt || s.startedAt;
  s.autoClosedAt = closedAt;
  s.autoClosedReason = `stale session (>${DAYS}d open, auto-closed by cleanup-stale-sessions)`;
  closed++;
}

fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
console.log(`\nCerradas: ${closed} sesiones. Backup en ${backup}`);

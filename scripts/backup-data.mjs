#!/usr/bin/env node
/**
 * backup-data.mjs
 *
 * Snapshot manual de data/*.json a data/backups/<timestamp>/.
 * No interactúa con Railway — copia el estado local actual.
 *
 * Útil:
 *   - antes de correr un one-shot que modifica setters.json
 *   - antes de un pre-deploy si querés tener un punto de retorno
 *   - como rotación local complementaria al backup cron del server
 *
 * Convención del proyecto: data/backups/ está en .gitignore, no se commitea.
 * Rotación: borra automáticamente los snapshots con >30 días, conservando
 * siempre los últimos 10 sin importar edad.
 *
 * Uso:
 *   node scripts/backup-data.mjs           # snapshot + rotación
 *   node scripts/backup-data.mjs --no-rotate
 *   node scripts/backup-data.mjs --keep N  # cambiar mínimo de retención (default 10)
 *
 * Read-only para data/ (excepto el directorio backups/).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, "..", "data");
const BACKUPS_DIR = path.join(DATA_DIR, "backups");

const args = process.argv.slice(2);
const NO_ROTATE = args.includes("--no-rotate");
const KEEP_IDX = args.indexOf("--keep");
const KEEP_MIN = KEEP_IDX >= 0 ? parseInt(args[KEEP_IDX + 1], 10) || 10 : 10;
const MAX_AGE_DAYS = 30;

if (!fs.existsSync(DATA_DIR)) {
  console.error(`FATAL: no existe ${DATA_DIR}`);
  process.exit(1);
}

const ts = new Date().toISOString().replace(/[:.]/g, "-");
const target = path.join(BACKUPS_DIR, ts);
fs.mkdirSync(target, { recursive: true });

const files = fs
  .readdirSync(DATA_DIR)
  .filter((f) => f.endsWith(".json"))
  .filter((f) => !f.startsWith("."));

let copied = 0;
let totalBytes = 0;
for (const f of files) {
  const src = path.join(DATA_DIR, f);
  const dst = path.join(target, f);
  try {
    fs.copyFileSync(src, dst);
    const size = fs.statSync(dst).size;
    totalBytes += size;
    copied++;
    console.log(`  ok  ${f}  (${(size / 1024).toFixed(1)} KB)`);
  } catch (e) {
    console.error(`  ERR ${f}: ${e.message}`);
  }
}

const manifest = {
  createdAt: new Date().toISOString(),
  source: DATA_DIR,
  files: copied,
  totalBytes,
};
fs.writeFileSync(path.join(target, "_manifest.json"), JSON.stringify(manifest, null, 2));

console.log(`\nBackup -> ${target}`);
console.log(`  ${copied} archivos, ${(totalBytes / 1024).toFixed(1)} KB total`);

// ROTACIÓN: borrar snapshots > MAX_AGE_DAYS, conservando últimos KEEP_MIN
if (!NO_ROTATE && fs.existsSync(BACKUPS_DIR)) {
  const all = fs
    .readdirSync(BACKUPS_DIR)
    .filter((d) => {
      try { return fs.statSync(path.join(BACKUPS_DIR, d)).isDirectory(); }
      catch { return false; }
    })
    .map((d) => ({ name: d, mtime: fs.statSync(path.join(BACKUPS_DIR, d)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime); // más nuevo primero

  const keepers = new Set(all.slice(0, KEEP_MIN).map((x) => x.name));
  const NOW = Date.now();
  const MS = MAX_AGE_DAYS * 86400000;

  let removed = 0;
  for (const { name, mtime } of all) {
    if (keepers.has(name)) continue;
    if (NOW - mtime > MS) {
      try {
        fs.rmSync(path.join(BACKUPS_DIR, name), { recursive: true, force: true });
        removed++;
        console.log(`  rotate: borrado ${name} (>${MAX_AGE_DAYS}d)`);
      } catch (e) {
        console.error(`  rotate fail ${name}: ${e.message}`);
      }
    }
  }
  if (removed > 0) console.log(`\nRotación: ${removed} snapshots viejos borrados (>${MAX_AGE_DAYS} días, manteniendo últimos ${KEEP_MIN})`);
}

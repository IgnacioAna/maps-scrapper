// One-shot: clasifica todos los leads existentes con wspProbability (informativa).
// NO rutea automáticamente a Llamadas — la heurística "sin wa.me en web = sin WSP"
// tiene muchos falsos positivos (la mayoría de clínicas tienen WSP aunque no lo
// pongan como wa.me en su web). El setter sigue marcando "Sin WSP" a mano.
//
// Lo que sí hace:
//  - Computa lead.wspProbability ('high' | 'low' | 'unknown')
//  - Inicializa los campos nuevos para llamadas (phoneStatus, callLog, callAttempts, callbackAt)
//  - Backup automático antes de tocar
//
// Uso: node scripts/migrate-wsp-classification.mjs
// Idempotente: si ya corrió, no hace nada (chequea raw.__wspClassified).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || (fs.existsSync('/data') ? '/data' : path.join(__dirname, '..', 'data'));
const SETTERS_FILE = path.join(DATA_DIR, 'setters.json');

if (!fs.existsSync(SETTERS_FILE)) {
  console.error(`❌ No existe ${SETTERS_FILE}`);
  process.exit(1);
}

function computeWspProbability(lead = {}) {
  const hasWaWeb = !!(lead.webWhatsApp && String(lead.webWhatsApp).trim());
  const hasWaAi = !!(lead.aiWhatsApp && String(lead.aiWhatsApp).trim());
  if (hasWaWeb || hasWaAi) return 'high';
  const hasPhone = !!(lead.phone && String(lead.phone).replace(/\D/g, '').length >= 7);
  if (hasPhone) return 'low';
  return 'unknown';
}

const raw = JSON.parse(fs.readFileSync(SETTERS_FILE, 'utf8'));

if (raw.__wspClassified) {
  console.log('✅ Ya clasificado previamente (flag __wspClassified=true). Nada que hacer.');
  process.exit(0);
}

// Backup antes de tocar
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = `${SETTERS_FILE}.bak-pre-wsp-classification-${stamp}`;
fs.copyFileSync(SETTERS_FILE, backupPath);
console.log(`📦 Backup: ${backupPath}`);

const stats = { total: 0, high: 0, low: 0, unknown: 0, alreadyInLlamadas: 0 };

for (const key in raw.leads) {
  const l = raw.leads[key];
  stats.total++;

  if (!l.wspProbability) l.wspProbability = computeWspProbability(l);
  stats[l.wspProbability] = (stats[l.wspProbability] || 0) + 1;

  // Defaults nuevos para llamadas
  if (!l.phoneStatus) l.phoneStatus = '';
  if (!Array.isArray(l.callLog)) l.callLog = [];
  if (typeof l.callAttempts !== 'number') l.callAttempts = 0;
  if (!l.callbackAt) l.callbackAt = '';

  if (l.conexion === 'sin_wsp') stats.alreadyInLlamadas++;
}

raw.__wspClassified = true;
fs.writeFileSync(SETTERS_FILE, JSON.stringify(raw, null, 2));

console.log('\n📊 Resultado (clasificación informativa, sin mover leads):');
console.log(`   Total leads:                            ${stats.total}`);
console.log(`   Con señal de WhatsApp en web (high):    ${stats.high}`);
console.log(`   Solo teléfono, sin señal WSP (low):     ${stats.low}`);
console.log(`   Sin teléfono ni señal (unknown):        ${stats.unknown}`);
console.log(`   En Llamadas (marcados manualmente):     ${stats.alreadyInLlamadas}`);
console.log(`\n✅ Migración completada. Flag __wspClassified=true.`);
console.log('   Los pipelines existentes NO se tocaron.');

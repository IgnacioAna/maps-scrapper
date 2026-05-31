#!/usr/bin/env node
/**
 * Convierte el CSV global de tarifas de Telnyx a data/telnyx_rates.json
 * optimizado para lookup por prefijo.
 *
 * Uso:
 *   node scripts/import-telnyx-rates.mjs <ruta-al-csv>
 *
 * El CSV viene de Telnyx por mail con headers:
 *   ISO,Country,Origination Prefixes,Destination Prefixes,Description,
 *   Interval 1,Interval N,Rate,Price Per Call,Exact Match
 *
 * Filtramos las rutas con Origination Prefixes específico (locales) y
 * nos quedamos solo con las default que aplican a nuestro origen US.
 * Guardamos {p,r,m,c,n} = prefix, rate USD/min, mobile(0|1), country ISO, name.
 */
import fs from 'fs';
import path from 'path';

function parseCsv(line) {
  const out = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; continue; }
    if (c === ',' && !inQ) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

const csvPath = process.argv[2];
if (!csvPath) {
  console.error('Falta ruta al CSV. Uso: node scripts/import-telnyx-rates.mjs <csv>');
  process.exit(1);
}
if (!fs.existsSync(csvPath)) {
  console.error('No existe:', csvPath);
  process.exit(1);
}

const lines = fs.readFileSync(csvPath, 'utf8').split(/\r?\n/);
const rates = [];
let skipped = 0;
for (let i = 1; i < lines.length; i++) {
  if (!lines[i]) continue;
  const c = parseCsv(lines[i]);
  const [iso, country, origPref, destPref, desc, , , rateStr] = c;
  if (origPref && origPref.trim()) { skipped++; continue; }
  const rate = parseFloat(rateStr);
  if (!Number.isFinite(rate) || !destPref || !destPref.trim()) { skipped++; continue; }
  rates.push({
    p: destPref.trim(),
    r: Math.round(rate * 1e6) / 1e6,
    m: /mobile/i.test(desc) ? 1 : 0,
    c: iso,
    n: String(country || '').replace(/^"|"$/g, '').slice(0, 40),
  });
}
rates.sort((a, b) => b.p.length - a.p.length || a.p.localeCompare(b.p));

const outPath = path.join(process.cwd(), 'data', 'telnyx_rates.json');
fs.writeFileSync(outPath, JSON.stringify({
  source: path.basename(csvPath),
  importedAt: new Date().toISOString(),
  count: rates.length,
  rates,
}));
console.log(`OK: ${rates.length} tarifas guardadas en ${outPath} (${(fs.statSync(outPath).size / 1024 / 1024).toFixed(2)}MB), ${skipped} filas saltadas.`);

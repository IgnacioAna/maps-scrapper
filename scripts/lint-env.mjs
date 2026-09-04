#!/usr/bin/env node
// Auditoría 2026-09-03 (CONF-05) — lint de variables de entorno.
//
// El problema que mata: 13 variables que el código lee no estaban declaradas
// en ningún lado, así que el modo de fallo era siempre el mismo — algo no
// andaba en producción y el motivo (una env que nadie sabía que existía) no
// estaba escrito. Casos reales de esa auditoría: PLACEHOLDER_FROM_EMAIL (sin
// ella el correo al prospecto no sale), REPORT_EMAILS (decide a quién le
// llega el reporte semanal), MAIL_TRANSPORT (decide el canal de salida).
//
// Qué hace: junta todo lo que el código LEE y lo compara contra .env.example.
//   - Leída y NO declarada  → ERROR (exit 1). Es la clase entera de hallazgos.
//   - Declarada y NO leída  → aviso, no rompe: el scanner puede no ver una
//     lectura dinámica, y romper el CI por eso sería peor que el aviso.
//
// .env.example NO lleva valores, solo nombres y una línea de comentario.
//
// Uso: npm run lint:env

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SCAN_ROOTS = ['index.js', 'src', 'scripts'];
const EXAMPLE = path.join(ROOT, '.env.example');
const SELF = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

// Provistas por el runtime o el runner, no por el operador: no van al ejemplo.
const RUNTIME_PROVIDED = new Set(['NODE_ENV', 'VITEST', 'PORT']);

function walk(p, out = []) {
  const st = fs.statSync(p);
  if (st.isDirectory()) {
    for (const e of fs.readdirSync(p)) {
      if (e === 'node_modules' || e.startsWith('.')) continue;
      walk(path.join(p, e), out);
    }
  } else if (/\.(js|mjs|cjs)$/.test(p)) {
    // El propio lint se excluye: sus comentarios y regex nombran variables de
    // ejemplo que no son lecturas reales.
    if (path.resolve(p) !== path.resolve(SELF)) out.push(p);
  }
  return out;
}

const files = [];
for (const r of SCAN_ROOTS) {
  const p = path.join(ROOT, r);
  if (fs.existsSync(p)) walk(p, files);
}

// Lecturas directas: process.env.NOMBRE y process.env["NOMBRE"].
const RE_DOT = /process\.env\.([A-Z_][A-Z0-9_]*)/g;
const RE_IDX = /process\.env\[\s*['"]([A-Z_][A-Z0-9_]*)['"]\s*\]/g;
// Lecturas INDIRECTAS: los mapas *_ENV_FIELDS (Telnyx, Retell) guardan el
// nombre de la env como string y después hacen process.env[envName]. Sin esto
// el scanner no vería RETELL_API_KEY ni TELNYX_SIP_PASSWORD y el lint daría
// un falso "declarada y no leída" sobre secrets que sí se usan.
const RE_ENV_FIELDS = /ENV_FIELDS\s*=\s*\{([\s\S]*?)\}/g;
const RE_QUOTED = /['"]([A-Z_][A-Z0-9_]{2,})['"]/g;

const readVars = new Map(); // nombre -> Set(archivos)
function note(name, file) {
  if (!readVars.has(name)) readVars.set(name, new Set());
  readVars.get(name).add(path.relative(ROOT, file).split(path.sep).join('/'));
}

for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(RE_DOT)) note(m[1], f);
  for (const m of src.matchAll(RE_IDX)) note(m[1], f);
  for (const block of src.matchAll(RE_ENV_FIELDS)) {
    for (const q of block[1].matchAll(RE_QUOTED)) note(q[1], f);
  }
}

if (!fs.existsSync(EXAMPLE)) {
  console.error('[lint:env] Falta .env.example. Crealo con los nombres de las variables (sin valores).');
  process.exit(1);
}
const declared = new Set(
  fs.readFileSync(EXAMPLE, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split('=')[0].trim())
    .filter(Boolean)
);

const missing = [...readVars.keys()]
  .filter((v) => !declared.has(v) && !RUNTIME_PROVIDED.has(v))
  .sort();
const unused = [...declared].filter((v) => !readVars.has(v)).sort();

if (unused.length) {
  console.warn(`[lint:env] aviso — declaradas en .env.example y sin lectura encontrada (${unused.length}): ${unused.join(', ')}`);
  console.warn('           Puede ser una lectura dinámica que el scanner no ve, o una variable que quedó vieja. No rompe el CI.');
}

if (missing.length) {
  console.error(`\n[lint:env] ERROR — ${missing.length} variable(s) leída(s) por el código y NO declarada(s) en .env.example:\n`);
  for (const v of missing) {
    console.error(`  ${v}\n      leída en: ${[...readVars.get(v)].sort().join(', ')}`);
  }
  console.error('\nAgregalas a .env.example (nombre + una línea de comentario, SIN el valor real).\n');
  process.exit(1);
}

console.log(`[lint:env] OK — ${readVars.size} variables leídas, todas declaradas en .env.example.`);

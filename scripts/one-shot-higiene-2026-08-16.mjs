#!/usr/bin/env node
/**
 * Higiene general de la base de leads (one-shot, 2026-08-16).
 *
 * Qué toca, y SOLO esto:
 *   1. `name` TODO EN MAYÚSCULAS  -> Title Case en castellano (506 leads)
 *   2. `name` con emoji           -> se le sacan los emoji (12)
 *   3. `doctor` TODO EN MAYÚSCULAS-> Title Case (15)
 *   4. `doctor` placeholder basura-> se vacía ("No se menciona", "N/A", "-")
 *   5. `doctor` con prefijo `Dr/a.` o basura al final -> nombre pelado
 *   6. Espacios dobles y bordes en `name`/`doctor`
 *
 * NO toca: teléfonos, emails, webs, direcciones, estados, callLog, ni nada
 * del flujo de trabajo. NO inventa ortografía de nombres propios: si la
 * fuente escribió "Gonzales", queda "Gonzales".
 *
 * Uso:
 *   node scripts/one-shot-higiene-2026-08-16.mjs           # simula
 *   node scripts/one-shot-higiene-2026-08-16.mjs --apply   # escribe
 *
 * Hace backup del setters.json antes de escribir. Idempotente: correrlo dos
 * veces no cambia nada la segunda vez.
 */
import fs from 'fs';
import path from 'path';

const APPLY = process.argv.includes('--apply');
const DATA = path.join(process.cwd(), 'data', 'setters.json');

// Conectores que van en minúscula salvo al principio.
const MINUS = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'en', 'a', 'al', 'por', 'para', 'con', 'da', 'do', 'dos', 'das']);
// Siglas conocidas del rubro que NO se deben "titlecasear".
const SIGLAS = new Set(['SCM', 'CED', 'ASISA', 'IMED', 'UDLA', 'UCM', 'SA', 'SRL', 'SAS', 'SL', 'LTDA', 'EIRL', 'CA', 'AC', 'RUT', 'NIT', 'DDS', 'DMD', 'ONG', 'IPS', 'EPS', 'UBA', 'USA', 'UK', 'VIP', 'PH', 'TJ', 'GDL', 'CDMX', 'BDC']);
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu;

const soloLetras = (s) => s.replace(/[^A-Za-zÁÉÍÓÚÑÜáéíóúñü]/g, '');
const esTodoMayus = (s) => { const l = soloLetras(s); return l.length > 4 && l === l.toUpperCase(); };

function titleCase(str) {
  const partes = str.split(/(\s+|[-/&|,.()])/); // conserva separadores
  let primeraPalabra = true;
  return partes
    .map((tok) => {
      if (!/[A-Za-zÁÉÍÓÚÑÜáéíóúñü]/.test(tok)) return tok; // separador
      if (SIGLAS.has(tok.toUpperCase())) { primeraPalabra = false; return tok.toUpperCase(); }
      if (/\d/.test(tok)) { primeraPalabra = false; return tok; } // deja "360", "3D"
      const bajo = tok.toLowerCase();
      const salida = (!primeraPalabra && MINUS.has(bajo))
        ? bajo
        : bajo.charAt(0).toUpperCase() + bajo.slice(1);
      primeraPalabra = false;
      return salida;
    })
    .join('');
}

const limpiarEspacios = (s) => s.replace(/\s+/g, ' ').trim();
const sacarEmoji = (s) => limpiarEspacios(s.replace(EMOJI, ''));

const DOCTOR_BASURA = /^(?:n\/?a|no\s+se\s+menciona|no\s+menciona|sin\s+nombre|desconocid[oa]|ningun[oa]?|-+|\.+|_+)$/i;

function limpiarDoctor(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let s = limpiarEspacios(raw);
  if (DOCTOR_BASURA.test(s)) return '';
  s = s.replace(/^(?:Dr\/a\.?|Dra?\.?|Doctora?|Odont[oó]log[oa]?\.?|Od\.?)\s+/i, ''); // prefijo
  s = s.replace(/\s*[-–—|,;:]\s*.*$/, '');   // todo lo que sigue a un guion
  s = s.replace(/[\s\-–—,;:.]+$/, '');       // basura al final
  s = limpiarEspacios(s);
  if (DOCTOR_BASURA.test(s)) return '';
  if (esTodoMayus(s)) s = titleCase(s);
  return s;
}

// ── main ──
const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const leads = data.leads || {};
const cambios = { nameMayus: 0, nameEmoji: 0, nameEspacios: 0, doctorMayus: 0, doctorPrefijo: 0, doctorVaciado: 0 };
const muestra = [];

for (const id of Object.keys(leads)) {
  const l = leads[id];

  // ── name ──
  const nombreOrig = typeof l.name === 'string' ? l.name : '';
  if (nombreOrig) {
    let n = nombreOrig;
    if (EMOJI.test(n)) { EMOJI.lastIndex = 0; n = sacarEmoji(n); if (n !== nombreOrig) cambios.nameEmoji++; }
    EMOJI.lastIndex = 0;
    if (esTodoMayus(n)) { const t = titleCase(n); if (t !== n) { n = t; cambios.nameMayus++; } }
    const compacto = limpiarEspacios(n);
    if (compacto !== n) { n = compacto; cambios.nameEspacios++; }
    if (n && n !== nombreOrig) {
      if (muestra.length < 25) muestra.push({ campo: 'name', antes: nombreOrig, despues: n });
      if (APPLY) l.name = n;
    }
  }

  // ── doctor ──
  const docOrig = typeof l.doctor === 'string' ? l.doctor : '';
  if (docOrig) {
    const d = limpiarDoctor(docOrig);
    if (d !== docOrig.trim()) {
      if (!d) cambios.doctorVaciado++;
      else if (esTodoMayus(docOrig)) cambios.doctorMayus++;
      else cambios.doctorPrefijo++;
      if (muestra.length < 40) muestra.push({ campo: 'doctor', antes: docOrig, despues: d || '(vaciado)' });
      if (APPLY) l.doctor = d;
    }
  }
}

const total = Object.values(cambios).reduce((a, b) => a + b, 0);
console.log(`\n=== HIGIENE ${APPLY ? '(APLICANDO)' : '(SIMULACIÓN)'} ===`);
console.log('leads:', Object.keys(leads).length);
console.log('cambios:', JSON.stringify(cambios));
console.log('total de campos tocados:', total);

console.log('\n=== MUESTRA ===');
muestra.slice(0, 24).forEach((m) => {
  console.log(`  [${m.campo}] ${JSON.stringify(m.antes.slice(0, 46))}`);
  console.log(`         -> ${JSON.stringify(m.despues.slice(0, 46))}`);
});

if (APPLY && total > 0) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const bak = `${DATA}.bak-pre-higiene-${stamp}`;
  fs.copyFileSync(DATA, bak);
  fs.writeFileSync(DATA, JSON.stringify(data, null, 2), 'utf8');
  console.log(`\nBackup: ${path.basename(bak)}`);
  console.log('Escrito.');
} else if (!APPLY) {
  console.log('\n(simulación — nada escrito. Correr con --apply)');
}

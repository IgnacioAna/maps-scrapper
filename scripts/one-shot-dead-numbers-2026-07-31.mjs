// One-shot 2026-07-31 — saca de la cola los números muertos que revivió el
// reciclaje del pool.
//
// Contexto: el reciclaje masivo de junio (CLAUDE.md #86) reseteó todos los leads
// a `sin_contactar` conservando el callLog. Los leads cuyo ÚLTIMO resultado había
// sido "número equivocado" o "no existe" volvieron a la cola de discado como si
// nunca se hubieran trabajado. El flujo de disposición NO tiene el bug: marcar
// equivocado descarta correctamente — esto es secuela de aquella operación.
//
// Criterio (verificado antes de ejecutar): último outcome del callLog es
// wrong_number/invalid_number, el lead no está en estado terminal y no tiene
// phoneStatus. Ninguno fue re-llamado después de esa marca.
//
// Uso:  node scripts/one-shot-dead-numbers-2026-07-31.mjs [--apply]
// Sin --apply solo simula y escribe el listado.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

const BASE = (process.env.RAILWAY_URL || 'https://scm-setting.up.railway.app').replace(/\/+$/, '');
const APPLY = process.argv.includes('--apply');
const DEAD = new Set(['wrong_number', 'invalid_number']);
const TERMINAL = new Set(['descartado', 'agendado', 'cerrado']);

const login = async () => {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }),
  });
  if (!r.ok) throw new Error('login falló: ' + r.status);
  return (r.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
};

const cookie = await login();
const data = await (await fetch(BASE + '/api/admin/export-data', { headers: { cookie } })).json();

// Backup del setters.json vivo ANTES de tocar nada.
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join(process.cwd(), 'data');
fs.mkdirSync(backupDir, { recursive: true });
const backupPath = path.join(backupDir, `setters.json.bak-dead-numbers-${stamp}`);
fs.writeFileSync(backupPath, JSON.stringify(data.setters, null, 2));
console.log('Backup:', backupPath);

const objetivo = { wrong_number: [], invalid_number: [] };
const listado = [];
for (const [id, l] of Object.entries(data.setters?.leads || {})) {
  const log = Array.isArray(l.callLog) ? l.callLog : [];
  if (!log.length) continue;
  const ultimo = log[log.length - 1];
  if (!ultimo || !DEAD.has(ultimo.outcome)) continue;   // el ÚLTIMO resultado manda
  if (TERMINAL.has(l.estado)) continue;                  // ya está fuera
  if (l.phoneStatus) continue;                           // ya marcado
  objetivo[ultimo.outcome].push(id);
  listado.push([l.name || '', l.country || '', l.phone || '', ultimo.outcome, (ultimo.ts || '').slice(0, 10), l.assignedTo || ''].join(' | '));
}

const total = objetivo.wrong_number.length + objetivo.invalid_number.length;
console.log(`\nA sacar de la cola: ${total}  (equivocado: ${objetivo.wrong_number.length}, no existe: ${objetivo.invalid_number.length})`);
const listPath = path.join(backupDir, `dead-numbers-${stamp}.txt`);
fs.writeFileSync(listPath, listado.join('\n'));
console.log('Listado:', listPath);
console.log('\nMuestra:');
listado.slice(0, 10).forEach((l) => console.log('  ' + l));

if (!APPLY) {
  console.log('\n(simulación — no se tocó nada. Correr con --apply para ejecutar)');
  process.exit(0);
}

const acciones = [['wrong_number', 'mark_wrong'], ['invalid_number', 'mark_invalid']];
for (const [outcome, action] of acciones) {
  const ids = objetivo[outcome];
  if (!ids.length) continue;
  // El endpoint capea en 500 por request.
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    const r = await fetch(BASE + '/api/setters/leads/bulk', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ leadIds: chunk, action }),
    });
    const d = await r.json().catch(() => ({}));
    console.log(`  ${action}: ${r.status} → ${d.count ?? d.error ?? ''}`);
  }
}

// Verificación: volver a mirar la data y confirmar que ya no quedan.
const after = await (await fetch(BASE + '/api/admin/export-data', { headers: { cookie } })).json();
let quedan = 0;
for (const l of Object.values(after.setters?.leads || {})) {
  const log = Array.isArray(l.callLog) ? l.callLog : [];
  const ultimo = log[log.length - 1];
  // Tras el bulk el último entry es el de la marca, así que se mira el estado.
  if (!TERMINAL.has(l.estado) && !l.phoneStatus && log.some((e) => DEAD.has(e.outcome))
      && !log.slice(log.findIndex((e) => DEAD.has(e.outcome)) + 1).some((e) => !DEAD.has(e.outcome))) quedan++;
  void ultimo;
}
console.log('\nVerificación — números muertos todavía en cola:', quedan);

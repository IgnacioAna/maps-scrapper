#!/usr/bin/env node
// Restaura el estado de Maximiliano (y opcionalmente Agustin) desde un
// backup específico. Para cada lead actualmente sin_contactar, busca su
// estado en el backup y le devuelve conexion/estado/respondio/calificado/
// interes si en el backup tenía flags.

import fs from 'node:fs';

const baseUrl = (process.env.RAILWAY_URL || '').replace(/\/+$/, '');
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
const SNAPSHOT = process.argv[2] || './backup-may7-1632.json';
const TARGETS = (process.argv[3] || 'Maximiliano').split(',');

if (!baseUrl || !email || !password) {
  console.error('Faltan env vars');
  process.exit(1);
}
if (!fs.existsSync(SNAPSHOT)) {
  console.error('No existe snapshot:', SNAPSHOT);
  process.exit(1);
}

async function main() {
  const r = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    redirect: 'manual',
  });
  const cookie = (r.headers.get('set-cookie') || '').match(/gs_session=[^;]+/)[0];

  const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
  const snapLeads = snap.leads || {};

  const sr = await fetch(`${baseUrl}/api/admin/export-data`, { headers: { Cookie: cookie } });
  const sd = await sr.json();
  const settersJson = sd.setters || {};
  const setters = settersJson.setters || [];
  const liveLeads = settersJson.leads || {};

  for (const tname of TARGETS) {
    const setter = setters.find((s) => new RegExp(tname, 'i').test(s.name));
    if (!setter) { console.error(`No encontré ${tname}`); continue; }

    const candidates = Object.entries(liveLeads)
      .filter(([_, l]) => l.assignedTo === setter.id)
      .filter(([_, l]) => !l.conexion && (l.estado === 'sin_contactar' || !l.estado))
      .map(([id, l]) => ({ id }));

    let toRestore = [];
    let alreadyClean = 0, noHistory = 0;
    for (const c of candidates) {
      const s = snapLeads[c.id];
      if (!s) { noHistory++; continue; }
      const hadFlag = (s.conexion && s.conexion !== 'sin_wsp') || s.respondio || s.calificado || (s.estado && s.estado !== 'sin_contactar' && s.estado !== 'sin_wsp');
      if (!hadFlag) { alreadyClean++; continue; }
      toRestore.push({ id: c.id, snap: s });
    }
    console.log(`\n${setter.name}: candidatos sin_contactar=${candidates.length}, a restaurar=${toRestore.length}, limpios en backup=${alreadyClean}, sin historial=${noHistory}`);

    let ok = 0, fail = 0;
    for (const { id, snap } of toRestore) {
      const body = {};
      if (snap.conexion) body.conexion = snap.conexion;
      if (snap.respondio === true) body.respondio = true;
      if (snap.calificado === true) body.calificado = true;
      if (snap.interes && snap.interes !== 'no') body.interes = snap.interes;
      if (snap.estado) body.estado = snap.estado;
      const pr = await fetch(`${baseUrl}/api/setters/leads/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify(body),
      });
      if (pr.ok) ok++;
      else { fail++; console.error('  Fail', id, pr.status); }
      if ((ok + fail) % 25 === 0) console.log(`  progreso: ${ok + fail}/${toRestore.length}`);
    }
    console.log(`  ${setter.name} → OK=${ok} FAIL=${fail}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

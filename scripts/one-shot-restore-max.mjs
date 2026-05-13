#!/usr/bin/env node
// One-shot: restaurar el estado de los leads de Maximiliano que reseteé hoy.
// Estrategia: para cada lead de Max actualmente sin_contactar, buscar su
// estado en el snapshot de may-4 (puede estar assignedTo Leandro o quien
// fuera) y restaurarle conexion/estado/respondio/calificado/interes/etc.

import fs from 'node:fs';
import path from 'node:path';

const baseUrl = (process.env.RAILWAY_URL || '').replace(/\/+$/, '');
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
if (!baseUrl || !email || !password) {
  console.error('Faltan env vars RAILWAY_URL, ADMIN_EMAIL, ADMIN_PASSWORD');
  process.exit(1);
}

const SNAPSHOT_PATH = process.argv[2] || './setters-may4.json';
if (!fs.existsSync(SNAPSHOT_PATH)) {
  console.error('No existe el snapshot:', SNAPSHOT_PATH);
  process.exit(1);
}

async function main() {
  console.log('Logueando...');
  const r = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    redirect: 'manual',
  });
  if (!r.ok && r.status !== 302) {
    console.error('Login falló:', r.status);
    process.exit(1);
  }
  const cookieMatch = (r.headers.get('set-cookie') || '').match(/gs_session=[^;]+/);
  if (!cookieMatch) { console.error('No cookie'); process.exit(1); }
  const cookie = cookieMatch[0];
  console.log('Login OK.');

  // Snapshot histórico
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
  const snapLeads = snapshot.leads || {};

  // Estado actual en Railway
  const sr = await fetch(`${baseUrl}/api/admin/export-data`, { headers: { Cookie: cookie } });
  const sd = await sr.json();
  const settersJson = sd.setters || {};
  const setters = settersJson.setters || [];
  const liveLeads = settersJson.leads || {};

  const max = setters.find((s) => /maximiliano/i.test(s.name));
  if (!max) { console.error('No encontré Maximiliano'); process.exit(1); }

  // Candidatos: leads de Max actualmente sin_contactar (los que reseteé)
  const candidates = Object.entries(liveLeads)
    .filter(([_, l]) => l.assignedTo === max.id)
    .filter(([_, l]) => !l.conexion && (l.estado === 'sin_contactar' || !l.estado))
    .map(([id, l]) => ({ id, current: l }));

  console.log(`Max sin_contactar actuales: ${candidates.length}`);

  // Buscar cada uno en el snapshot histórico
  let toRestore = [];
  let noHistory = 0;
  let alreadyClean = 0;
  for (const c of candidates) {
    const snap = snapLeads[c.id];
    if (!snap) { noHistory++; continue; }
    const hadFlag = (snap.conexion && snap.conexion !== 'sin_wsp') || snap.respondio || snap.calificado || (snap.estado && snap.estado !== 'sin_contactar' && snap.estado !== 'sin_wsp');
    if (!hadFlag) { alreadyClean++; continue; }
    toRestore.push({ id: c.id, snap, current: c.current });
  }

  console.log(`  Tenían flags en may4 (a restaurar): ${toRestore.length}`);
  console.log(`  Estaban limpios en may4 (no tocar): ${alreadyClean}`);
  console.log(`  Sin historial may4 (no tocar): ${noHistory}`);

  if (toRestore.length === 0) {
    console.log('Nada para restaurar.');
    return;
  }

  // PATCH cada uno con el estado del snapshot
  let ok = 0, fail = 0;
  for (const { id, snap } of toRestore) {
    // Aplicar campos en orden tal que la cascada respete el avance final
    // Empezar con conexion=enviada (si tenía), luego respondio, calificado,
    // interes, finalmente estado correcto.
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
    if ((ok + fail) % 20 === 0) console.log(`  progreso: ${ok + fail}/${toRestore.length}`);
  }
  console.log(`\nMaximiliano restore — OK=${ok} FAIL=${fail}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

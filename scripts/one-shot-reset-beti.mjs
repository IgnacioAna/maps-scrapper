#!/usr/bin/env node
// One-shot: reset 87 worked-looking leads de Betiana + mover 100 untouched de Nico a Beti.
// Uso: RAILWAY_URL=... ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/one-shot-reset-beti.mjs

const baseUrl = (process.env.RAILWAY_URL || '').replace(/\/+$/, '');
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
if (!baseUrl || !email || !password) {
  console.error('Faltan env vars RAILWAY_URL, ADMIN_EMAIL, ADMIN_PASSWORD');
  process.exit(1);
}

async function main() {
  // 1. Login
  console.log('Logueando...');
  const r = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    redirect: 'manual',
  });
  if (!r.ok && r.status !== 302) {
    console.error('Login falló:', r.status, await r.text());
    process.exit(1);
  }
  const setCookie = r.headers.get('set-cookie') || '';
  const cookieMatch = setCookie.match(/gs_session=[^;]+/);
  if (!cookieMatch) { console.error('No cookie'); process.exit(1); }
  const cookie = cookieMatch[0];
  console.log('Login OK.');

  // 2. Descargar setters + leads (export-data trae todo)
  const sr = await fetch(`${baseUrl}/api/admin/export-data`, { headers: { Cookie: cookie } });
  const sd = await sr.json();
  const settersJson = sd.setters || sd['setters.json'] || {};
  const setters = settersJson.setters || [];
  const leadsObj = settersJson.leads || {};
  const beti = setters.find(s => /betiana/i.test(s.name));
  const nico = setters.find(s => /debiass|debrass|nicolas/i.test(s.name));
  if (!beti || !nico) { console.error('No encontré setters'); process.exit(1); }
  console.log('Beti:', beti.id, '| Nico:', nico.id);

  const leads = Object.entries(leadsObj).map(([id, l]) => ({ id, ...l }));
  const workedBeti = leads.filter(l =>
    l.assignedTo === beti.id &&
    ((l.estado && l.estado !== 'sin_contactar') || l.conexion === 'enviada' || l.respondio || l.calificado)
  );
  console.log('Beti worked-looking leads a resetear:', workedBeti.length);

  // 3. Reset uno por uno con PATCH conexion=null (cascada reversa limpia todo)
  let ok = 0, fail = 0;
  for (const lead of workedBeti) {
    const pr = await fetch(`${baseUrl}/api/setters/leads/${lead.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ conexion: null }),
    });
    if (pr.ok) ok++;
    else { fail++; console.error('Fail', lead.id, pr.status); }
    if ((ok + fail) % 20 === 0) console.log(`  progreso: ${ok+fail}/${workedBeti.length}`);
  }
  console.log(`Reset terminado. OK=${ok} FAIL=${fail}`);

  // 4. Reassign skipped (ya se hizo en run anterior)
  console.log('Skipping reassign (ya hecho).');
}

main().catch(e => { console.error(e); process.exit(1); });

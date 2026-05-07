#!/usr/bin/env node
// One-shot: reset 100 leads en Maximiliano + 100 en Agustin Rueda — los que
// vienen del move reciente desde Leandro y llegaron con flags pre-seteados.
// Heurística: legacy-flag leads (estado avanzado SIN interactions[]) ordenados
// por lastContactAt asc (los más viejos = los de Leandro, los recientes son
// del setter destino).

const baseUrl = (process.env.RAILWAY_URL || '').replace(/\/+$/, '');
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
if (!baseUrl || !email || !password) {
  console.error('Faltan env vars RAILWAY_URL, ADMIN_EMAIL, ADMIN_PASSWORD');
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
    console.error('Login falló:', r.status, await r.text());
    process.exit(1);
  }
  const cookieMatch = (r.headers.get('set-cookie') || '').match(/gs_session=[^;]+/);
  if (!cookieMatch) { console.error('No cookie'); process.exit(1); }
  const cookie = cookieMatch[0];
  console.log('Login OK.');

  const sr = await fetch(`${baseUrl}/api/admin/export-data`, { headers: { Cookie: cookie } });
  const sd = await sr.json();
  const settersJson = sd.setters || {};
  const setters = settersJson.setters || [];
  const leadsObj = settersJson.leads || {};

  const targets = [
    { name: 'Maximiliano', limit: 100 },
    { name: 'Agustin', limit: 100 },
  ];

  for (const t of targets) {
    const setter = setters.find((s) => new RegExp(t.name, 'i').test(s.name));
    if (!setter) { console.error(`No encontré setter "${t.name}"`); continue; }
    const all = Object.entries(leadsObj).map(([id, l]) => ({ id, ...l }))
      .filter((l) => l.assignedTo === setter.id);

    // Legacy flag = estado avanzado / conexion / respondio / calificado, SIN interactions[]
    const legacy = all.filter((l) => {
      const hasFlag = (l.conexion && l.conexion !== 'sin_wsp') || l.respondio || l.calificado || (l.estado && l.estado !== 'sin_contactar' && l.estado !== 'sin_wsp');
      const hasInteractions = Array.isArray(l.interactions) && l.interactions.length > 0;
      return hasFlag && !hasInteractions;
    });

    // Ordenar por lastContactAt asc (los más viejos primero — esos son los heredados)
    legacy.sort((a, b) => {
      const ta = a.lastContactAt ? new Date(a.lastContactAt).getTime() : 0;
      const tb = b.lastContactAt ? new Date(b.lastContactAt).getTime() : 0;
      return ta - tb;
    });

    const toReset = legacy.slice(0, t.limit);
    console.log(`\n${setter.name}: legacy-flag leads disponibles=${legacy.length}, a resetear=${toReset.length}`);

    let ok = 0, fail = 0;
    for (const lead of toReset) {
      const pr = await fetch(`${baseUrl}/api/setters/leads/${lead.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ conexion: null }),
      });
      if (pr.ok) ok++;
      else { fail++; console.error('  Fail', lead.id, pr.status); }
      if ((ok + fail) % 20 === 0) console.log(`  progreso: ${ok + fail}/${toReset.length}`);
    }
    console.log(`  ${setter.name} → reset OK=${ok} FAIL=${fail}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

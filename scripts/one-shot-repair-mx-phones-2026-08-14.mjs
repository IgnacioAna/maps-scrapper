// One-shot 2026-08-14 — repara los teléfonos mexicanos rotos de la base.
//
// Contexto: hay leads de México cuyo teléfono quedó con 10 dígitos y SIN código
// de país. Tal cual están son indiscables: `+6195029242` no marca a México, sale
// hacia Australia (+61).
//
// El detalle que importa: NO todos son mexicanos. Las clínicas de la frontera
// publican su número de EE.UU. — 619 y 858 son San Diego, 760 California, 928
// Arizona. Ese número es real y se disca a ~$0.007/min; el arreglo ahí es `+1`,
// no `+52`. Ponerle +52 a un 619 lo deja igual de muerto.
//
// Aparte, los `+521XXXXXXXXXX` (13 dígitos) son el formato viejo de móvil
// mexicano: México sacó ese "1" en 2019 y el E.164 vigente tiene 12 dígitos.
//
// Lo ambiguo NO se toca (LADAs que se pisan con áreas de EE.UU., toll-free
// 800/888, números truncados): quedan listados como `unresolved` para revisar.
//
// El trabajo real lo hace `POST /api/admin/repair-mx-phones` (mismo endpoint que
// usa el panel), así que la reparación corre server-side con backup y mutex.
//
// Uso:  node scripts/one-shot-repair-mx-phones-2026-08-14.mjs [--apply]
// Sin --apply solo simula (dryRun) y no escribe nada en producción.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

const BASE = (process.env.RAILWAY_URL || 'https://scm-setting.up.railway.app').replace(/\/+$/, '');
const APPLY = process.argv.includes('--apply');

const login = async () => {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }),
  });
  if (!r.ok) throw new Error('login falló: ' + r.status);
  return (r.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
};

const cookie = await login();

// Backup del setters.json vivo ANTES de tocar nada (el endpoint también hace el
// suyo server-side; este queda local por si hay que revertir a mano).
if (APPLY) {
  const data = await (await fetch(BASE + '/api/admin/export-data', { headers: { cookie } })).json();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.mkdirSync(path.join(process.cwd(), 'data'), { recursive: true });
  const backupPath = path.join(process.cwd(), 'data', `setters.json.bak-repair-mx-${stamp}`);
  fs.writeFileSync(backupPath, JSON.stringify(data.setters, null, 2));
  console.log('Backup local:', backupPath);
}

const run = async (dryRun) => {
  const r = await fetch(BASE + '/api/admin/repair-mx-phones', {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ dryRun }),
  });
  if (!r.ok) throw new Error('repair falló: ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return r.json();
};

const sim = await run(true);
console.log(`\n${APPLY ? 'SIMULACIÓN previa' : 'SIMULACIÓN (sin --apply no se escribe nada)'}`);
console.log(`  candidatos rotos : ${sim.scanned}`);
console.log(`  → +52 (México)   : ${sim.byFix.mx}`);
console.log(`  → +1  (EE.UU.)   : ${sim.byFix.us}`);
console.log(`  colisiones        : ${sim.collided}   (el número reparado ya existía en otro lead)`);
console.log(`  sin resolver      : ${sim.unresolved.length}`);
if (sim.sample.length) {
  console.log('\nEjemplos:');
  for (const s of sim.sample) console.log(`  ${s.antes}  →  ${s.despues}   (${s.city} · ${s.name})`);
}
if (sim.unresolved.length) {
  console.log('\nSin resolver (quedan como están, para revisar a mano):');
  for (const u of sim.unresolved) console.log(`  ${u.phone}  [${u.city || '?'}]  ${u.name || ''}`);
}

if (!APPLY) {
  console.log('\nNada escrito. Para ejecutar: node scripts/one-shot-repair-mx-phones-2026-08-14.mjs --apply');
  process.exit(0);
}

const res = await run(false);
console.log(`\nAPLICADO: ${res.repaired} teléfonos reparados (${res.byFix.mx} a +52, ${res.byFix.us} a +1).`);
console.log('El número viejo quedó en `phoneBroken` y el lookup se reseteó (el número cambió,');
console.log('lo que sabíamos del anterior no aplica). Para revalidarlos: "Validar números ($)".');

// Verificación: una segunda corrida no debe encontrar nada nuevo (idempotencia).
const check = await run(true);
console.log(`Verificación post: quedan ${check.byFix.mx + check.byFix.us} reparables (esperado 0).`);

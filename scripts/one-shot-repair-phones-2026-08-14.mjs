// One-shot 2026-08-14 — repara los teléfonos rotos de la base, todos los países.
//
// Contexto: hay leads cuyo teléfono quedó mal armado en el scraping y no se
// puede discar. `+6195029242` no marca a México: sale hacia Australia (+61).
//
// Los patrones, verificados uno por uno contra la base antes de escribir cada
// regla:
//
//   línea de EE.UU.      619/858 son San Diego, 760 California, 786 Miami. Las
//                        clínicas de frontera (Tijuana) y las de turismo dental
//                        (Costa Rica) publican una línea gringa. Es un número
//                        real y se disca a ~$0.007/min: ahí el arreglo es +1,
//                        no el código del país donde está la clínica.
//   nacional sin código  España `605 14 00 77`, Costa Rica `55059966`.
//   troncal 0            Ecuador `099 583 9310` → el 0 es para marcar adentro.
//   basura concatenada   Colombia `5731750311112202033202020200`: los primeros
//                        12 dígitos son el celular, el resto es relleno.
//   móvil viejo de MX    `+521XXXXXXXXXX`: México sacó ese "1" en 2019.
//
// Lo ambiguo NO se toca y sale listado: los 600 de Chile (inalcanzables desde el
// exterior), los peruanos a los que les falta un dígito, los uruguayos que son
// números brasileños con un 598 pegado, y los que tienen el país mal cargado.
//
// Por defecto solo toca los leads que se van a llamar de verdad (`onlyAlive`):
// fuera descartados, agendados, cerrados y no-llamar.
//
// El trabajo lo hace `POST /api/admin/repair-phones`, así que corre server-side
// con backup y sin crear teléfonos duplicados.
//
// Uso:  node scripts/one-shot-repair-phones-2026-08-14.mjs [--apply] [--todos]
//   sin --apply  → solo simula, no escribe nada en producción
//   --todos      → incluye también los leads descartados/agendados/cerrados
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

const BASE = (process.env.RAILWAY_URL || 'https://scm-setting.up.railway.app').replace(/\/+$/, '');
const APPLY = process.argv.includes('--apply');
const ONLY_ALIVE = !process.argv.includes('--todos');

const login = async () => {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }),
  });
  if (!r.ok) throw new Error('login falló: ' + r.status);
  return (r.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
};

const cookie = await login();

// Backup local ANTES de tocar nada (el endpoint hace el suyo server-side; este
// queda a mano por si hay que revertir).
if (APPLY) {
  const data = await (await fetch(BASE + '/api/admin/export-data', { headers: { cookie } })).json();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.mkdirSync(path.join(process.cwd(), 'data'), { recursive: true });
  const backupPath = path.join(process.cwd(), 'data', `setters.json.bak-repair-phones-${stamp}`);
  fs.writeFileSync(backupPath, JSON.stringify(data.setters, null, 2));
  console.log('Backup local:', backupPath);
}

const run = async (dryRun) => {
  const r = await fetch(BASE + '/api/admin/repair-phones', {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ dryRun, onlyAlive: ONLY_ALIVE }),
  });
  if (!r.ok) throw new Error('repair falló: ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return r.json();
};

const sim = await run(true);
console.log(`\nSIMULACIÓN${APPLY ? ' previa' : ' (sin --apply no se escribe nada)'}`);
console.log(`  alcance          : ${ONLY_ALIVE ? 'solo leads que se van a llamar' : 'TODOS los leads'}`);
console.log(`  candidatos rotos : ${sim.scanned}`);
console.log(`  reparables       : ${sim.repaired}`);
console.log(`  colisiones       : ${sim.collided}   (el número reparado ya existía en otro lead)`);
console.log(`  sin resolver     : ${sim.unresolved.length}`);
console.log('\nPor país y destino:');
for (const [k, n] of Object.entries(sim.byCountry).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(3)}  ${k}`);
}
if (sim.sample.length) {
  console.log('\nEjemplos:');
  for (const s of sim.sample) console.log(`  ${s.antes}  →  ${s.despues}   (${s.country} · ${s.name})`);
}
if (sim.unresolved.length) {
  console.log('\nSin resolver (quedan como están, para revisar a mano):');
  for (const u of sim.unresolved) console.log(`  ${(u.country + '          ').slice(0, 11)} ${String(u.phone).padEnd(34)} ${u.name || ''}`);
}

if (!APPLY) {
  console.log('\nNada escrito. Para ejecutar: node scripts/one-shot-repair-phones-2026-08-14.mjs --apply');
  process.exit(0);
}

const res = await run(false);
console.log(`\nAPLICADO: ${res.repaired} teléfonos reparados.`);
console.log('El número viejo quedó en `phoneBroken` y el lookup se reseteó (el número cambió,');
console.log('lo que sabíamos del anterior no aplica). Para revalidarlos: "Validar números ($)".');

// Idempotencia: una segunda corrida no debe encontrar nada nuevo.
const check = await run(true);
console.log(`Verificación post: quedan ${check.repaired} reparables (esperado 0).`);

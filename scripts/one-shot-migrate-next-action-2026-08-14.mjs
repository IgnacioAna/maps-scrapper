// One-shot 2026-08-14 — migra el reloj único a producción (Phase 29, plan
// 29-04, NEXT-02/NEXT-03).
//
// Contexto: desde 29-01/29-03, TODA lectura del "próximo paso" de un lead
// (colas de callback, badge de follow-ups, Power Dialer, Hoy) ya deriva de
// `lead.callbackAt` + `lead.followUps` a través de `_leadNextAction` — nada
// se rompe si esta migración no corre. Lo que hace este script es persistir
// esa derivación como `lead.nextAction` explícito (el modelo que las fases
// 30-34 van a leer/escribir sin fallback). No mueve ninguna fecha visible:
// usa el MISMO endpoint que ya trae dryRun + backup + mutex + idempotencia
// (`POST /api/admin/backfill-next-action`, index.js) — este script solo
// automatiza login + backup local + la secuencia dryRun→apply→dryRun contra
// Railway, mismo patrón que scripts/one-shot-dead-numbers-2026-07-31.mjs.
//
// Uso:  node scripts/one-shot-migrate-next-action-2026-08-14.mjs [--apply]
// Sin --apply: SIEMPRE corre dryRun e imprime los contadores (simulación,
// no toca nada). Con --apply: corre la migración real y al final vuelve a
// correr un dryRun para demostrar la idempotencia (matched: 0).
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

const backfillNextAction = async (cookie, dryRun) => {
  const r = await fetch(BASE + '/api/admin/backfill-next-action', {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ dryRun }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`backfill-next-action (dryRun=${dryRun}) falló: ${r.status} ${JSON.stringify(d)}`);
  return d;
};

const printCounters = (label, d) => {
  console.log(`\n${label}`);
  console.log(`  ${d.dryRun ? 'matched' : 'updated'}: ${d.dryRun ? d.matched : d.updated}  (scanned: ${d.scanned}, yaMigrados: ${d.yaMigrados})`);
  console.log(`  conCallbackAt: ${d.conCallbackAt}  conFollowUpActivo: ${d.conFollowUpActivo}`);
  console.log(`  byOrigen: manual=${d.byOrigen?.manual ?? 0} cadencia=${d.byOrigen?.cadencia ?? 0}`);
  console.log(`  byFuente: callbackAt=${d.byFuente?.callbackAt ?? 0} followUps=${d.byFuente?.followUps ?? 0}`);
  if (Array.isArray(d.leads) && d.leads.length) {
    console.log('  Muestra (máx 10 de hasta 50):');
    d.leads.slice(0, 10).forEach((l) => console.log(`    ${l.id} | ${l.name} | ${l.origen} | ${l.fuente} | ${l.dueAt}`));
  }
};

const cookie = await login();

// Backup local del setters.json VIVO antes de tocar nada (mismo idioma que
// el one-shot de referencia: .bak-*, gitignoreado, nunca pisa data/setters.json).
const data = await (await fetch(BASE + '/api/admin/export-data', { headers: { cookie } })).json();
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join(process.cwd(), 'data');
fs.mkdirSync(backupDir, { recursive: true });
const backupPath = path.join(backupDir, `setters.json.bak-pre-next-action-${stamp}`);
fs.writeFileSync(backupPath, JSON.stringify(data.setters, null, 2));
console.log('Backup local:', backupPath);

const dry = await backfillNextAction(cookie, true);
printCounters('DRY RUN (simulación, no escribió nada):', dry);

if (!APPLY) {
  console.log('\n(simulación — no se tocó nada. Correr con --apply para ejecutar la migración real)');
  process.exit(0);
}

const applied = await backfillNextAction(cookie, false);
printCounters('APPLY (escrito bajo mutex, con backup server-side pre-backfill-next-action):', applied);

const verify = await backfillNextAction(cookie, true);
console.log(`\nVerificación de idempotencia — segundo dryRun: matched=${verify.matched} (esperado: 0)`);
if (verify.matched !== 0) {
  console.warn('⚠️  matched no dio 0 — revisar antes de confiar en que la migración terminó.');
}

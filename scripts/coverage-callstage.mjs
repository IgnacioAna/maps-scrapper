// Cobertura de la etapa de llamada (callStage) sobre la data real.
//
// Para qué: la etapa es el escalón del embudo que compara guiones entre sí
// ("pasé recepción"), pero solo sirve si se carga. Este script responde tres
// cosas de una: cuántas llamadas la traen, cuántas de esas son DERIVADAS por
// el sistema (voicemail → contestador) en vez de registradas por una persona,
// y desde qué superficie se están cargando.
//
// La ventana ARRANCA en el deploy de callStage, siempre. Una llamada anterior
// no puede tener etapa ni la va a tener nunca: incluirla en el denominador
// hunde la cobertura a 0% para siempre y el número deja de decir nada. (Caso
// real: una ventana de 30 días corrida el 17/08 arrastraba las 105 llamadas
// que Judith marcó entre el 13 y el 22 de julio.)
//
// Uso:
//   node scripts/coverage-callstage.mjs                 # desde el deploy (correr pre-deploy antes)
//   node scripts/coverage-callstage.mjs --days 7        # últimos 7 días, recortado al deploy
//   node scripts/coverage-callstage.mjs --all           # histórico entero (siempre va a dar ~0%)
//   node scripts/coverage-callstage.mjs --file <ruta>   # otro snapshot
//
// Lectura del resultado:
//   · "a mano" alto  → el dato sirve para medir guiones.
//   · "a mano" ~0 con llamadas nuevas → el problema es de hábito o de UI, no de
//     captura: revisar si los controles se están viendo donde se marca.
//   · sin llamadas nuevas → todavía no hay muestra; no concluir nada.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const argOf = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const file = argOf('--file') || path.join(process.cwd(), 'data', 'setters.json');
const days = parseInt(argOf('--days') || '0', 10);
// Commit 90bce4d "feat(medicion): etapa alcanzada por llamada" — antes de este
// instante ninguna llamada pudo registrar etapa. Si se cambia la captura de
// forma que invalide lo registrado, mover esta fecha.
const DEPLOY_ISO = '2026-08-16T19:42:52-03:00';
const DEPLOY_TS = Date.parse(DEPLOY_ISO);

if (!fs.existsSync(file)) {
  console.error(`No encuentro ${file}. Si querés medir producción, corré antes: npm run pre-deploy`);
  process.exit(1);
}

// Mismas listas que index.js. Si allá cambian, cambiar acá.
const RELEVANT = new Set(['answered_interested', 'answered_not_interested', 'hung_up',
  'callback_later', 'scheduled_with_admin', 'placeholder_sent']);
const STAGES = new Set(['contestador', 'recepcion', 'decisor']);

const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const verTodo = args.includes('--all');
const pedido = days > 0 ? Date.now() - days * 86400000 : 0;
// El piso es el deploy, salvo --all explícito. Con --days N más viejo que el
// deploy, gana el deploy y se avisa: si no, el denominador incluiría llamadas
// que nunca pudieron tener etapa.
const desde = verTodo ? 0 : Math.max(pedido, DEPLOY_TS);
const recortado = !verTodo && pedido > 0 && pedido < DEPLOY_TS;

let relevantes = 0, conEtapa = 0, aMano = 0, derivadas = 0, conGuion = 0;
let ultima = '', primeraAMano = '', ultimaAMano = '';
const porEtapa = {}, porDia = {};

for (const lead of Object.values(data.leads || {})) {
  for (const c of (lead.callLog || [])) {
    const ts = c.ts ? new Date(c.ts).getTime() : 0;
    if (ts && (!ultima || c.ts > ultima)) ultima = c.ts;
    if (desde && ts < desde) continue;
    if (!RELEVANT.has(c.outcome)) continue;
    relevantes++;
    if (Array.isArray(c.scriptIdsUsed) && c.scriptIdsUsed.length) conGuion++;
    if (!STAGES.has(c.callStage)) continue;
    conEtapa++;
    porEtapa[c.callStage] = (porEtapa[c.callStage] || 0) + 1;
    if (c.callStageAuto === true) { derivadas++; continue; }
    aMano++;
    const dia = (c.ts || '').slice(0, 10);
    if (dia) porDia[dia] = (porDia[dia] || 0) + 1;
    if (!primeraAMano || c.ts < primeraAMano) primeraAMano = c.ts;
    if (!ultimaAMano || c.ts > ultimaAMano) ultimaAMano = c.ts;
  }
}

const pct = (n, d) => (d > 0 ? ((n / d) * 100).toFixed(1) + '%' : '—');
const fmtDia = (ts) => new Date(ts).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
const ventana = verTodo
  ? 'histórico completo (incluye llamadas anteriores a la función)'
  : (days > 0 && !recortado ? `últimos ${days} días` : 'desde el deploy de la función');

console.log(`\nCobertura de etapa · ${ventana} · ${path.basename(file)}`);
console.log(`Desde ${verTodo ? 'siempre' : fmtDia(desde)}`);
if (recortado) console.log(`(--days ${days} pedía más atrás; se recortó al deploy — antes no había etapa que registrar)`);
if (verTodo) console.log('(--all: el denominador trae llamadas que nunca pudieron tener etapa; la cobertura va a dar ~0%)');
console.log('─'.repeat(58));
console.log(`Llamadas donde alguien atendió   ${String(relevantes).padStart(6)}`);
console.log(`  con etapa cargada              ${String(conEtapa).padStart(6)}   ${pct(conEtapa, relevantes)}`);
console.log(`    registrada por una persona   ${String(aMano).padStart(6)}   ${pct(aMano, relevantes)}  ← el número que importa`);
console.log(`    derivada por el sistema      ${String(derivadas).padStart(6)}   ${pct(derivadas, conEtapa)} de las que tienen`);
console.log(`  con guion atribuido            ${String(conGuion).padStart(6)}   ${pct(conGuion, relevantes)}`);
if (conEtapa) console.log(`\nReparto por etapa: ${JSON.stringify(porEtapa)}`);

// El % de paso de recepción, que es lo que decide si un guion sirve. El
// denominador excluye contestador a propósito: un contestador no es una
// recepción que se pueda pasar (mismo criterio que /script-effectiveness).
const rec = porEtapa.recepcion || 0, dec = porEtapa.decisor || 0;
if (rec + dec > 0) {
  const paso = (dec / (rec + dec)) * 100;
  const veredicto = paso >= 70 ? 'por encima del umbral del guion (70%)' : 'POR DEBAJO del umbral del guion (70%) — cambiar algo';
  console.log(`Paso de recepción: ${paso.toFixed(1)}%  (${dec} de ${rec + dec})  · ${veredicto}`);
}

const dias = Object.keys(porDia).sort();
if (dias.length) {
  console.log(`\nCargas a mano por día:`);
  for (const d of dias.slice(-10)) console.log(`   ${d}  ${porDia[d]}`);
  console.log(`Rango: ${primeraAMano} → ${ultimaAMano}`);
} else {
  console.log(`\nNingún registro a mano todavía.`);
}
console.log(`\nÚltima llamada en el snapshot: ${ultima || '—'}`);
if (relevantes === 0) console.log('Sin llamadas en la ventana: no hay muestra para concluir nada.');
console.log('');

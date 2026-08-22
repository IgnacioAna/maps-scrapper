// Cobertura de ATRIBUCIÓN DE GUION (scriptIdsUsed) sobre la data real.
//
// Para qué: SCR-04. Con la siembra automática de 35-02, "cuántas llamadas
// tienen guion" va a ser casi el 100% enseguida — eso no dice nada, porque un
// default no es un experimento. La pregunta que importa es cuántas de esas
// las ELIGIÓ una persona (`scriptIdsAuto !== true`): ese es el número que
// permite comparar dos guiones entre sí. Si "a mano" es ~0 mientras "con
// guion" es ~100%, la tabla de /api/telnyx/script-effectiveness está
// comparando el guion oficial contra sí mismo.
//
// La ventana ARRANCA en el deploy de la siembra (plan 35-02), siempre, salvo
// --all explícito. Antes de ese instante ninguna llamada pudo nacer con
// guion atribuido en la práctica (35-01 solo abría la puerta si algo lo
// mandaba; nada lo mandaba todavía) — incluirla en el denominador hunde la
// cobertura a 0% para siempre. D-01 fija además el default en **7 días, no
// 30**: 30 días arrastran las llamadas de las vendedoras de julio (ninguna
// pudo tener guion) y la cobertura da 0% para siempre sin decir nada nuevo.
// Mismo criterio que scripts/coverage-callstage.mjs, que es el molde de este
// script.
//
// Uso:
//   node scripts/coverage-script.mjs                 # últimos 7 días (D-01), recortado al deploy
//   node scripts/coverage-script.mjs --days 30        # otra ventana, igual recortada al deploy
//   node scripts/coverage-script.mjs --all            # histórico entero (siempre va a dar ~0%)
//   node scripts/coverage-script.mjs --file <ruta>    # otro snapshot
//   node scripts/coverage-script.mjs --json            # salida en una sola línea, machine-readable
//
// El script lee `data/setters.json` (por defecto): un snapshot LOCAL. Para
// medir producción, correr antes `npm run pre-deploy` — sin eso se está
// midiendo lo que había en el repo, no lo que pasó en Railway.
//
// Lectura del resultado:
//   · "elegido por una persona" alto  → se pueden comparar guiones entre sí,
//     hay experimento real.
//   · cobertura total alta con "elegido por una persona" ~0 → todo es el
//     default automático: la tabla de efectividad está comparando el guion
//     oficial contra sí mismo, todavía no hay nada que comparar.
//   · sin llamadas en la ventana → no hay muestra, no concluir nada.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const argOf = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const file = argOf('--file') || path.join(process.cwd(), 'data', 'setters.json');
const days = parseInt(argOf('--days') || '7', 10); // D-01: default 7, no 30.
const asJson = args.includes('--json');

// Plan 35-02 es el commit que hace que una llamada empiece a poder nacer con
// `scriptIdsUsed`/`scriptIdsAuto` sin que nadie toque nada (35-01 solo abría
// la puerta si algo lo mandaba; hasta 35-02 nada lo mandaba). Fecha tomada
// del commit de CIERRE de ese plan (`7f78cb8`, "docs(35-02): completar plan
// 02 de la fase 35"), tal como indica `35-02-SUMMARY.md` explícitamente para
// que la use este script. Si se cambia la captura de forma que invalide lo
// registrado, mover esta fecha.
const DEPLOY_ISO = '2026-08-22T18:37:47-03:00';
const DEPLOY_TS = Date.parse(DEPLOY_ISO);

if (!fs.existsSync(file)) {
  console.error(`No encuentro ${file}. Si querés medir producción, corré antes: npm run pre-deploy`);
  process.exit(1);
}

// Mismo Set que SCRIPT_RELEVANT_OUTCOMES en index.js (35-01). Si allá
// cambian, cambiar acá — es el mismo tradeoff que ya acepta
// coverage-callstage.mjs (T-35-14): sin importar index.js, este script no
// necesita servidor ni env vars y corre en ~200ms.
const RELEVANT = new Set(['answered_interested', 'answered_not_interested', 'hung_up',
  'callback_later', 'scheduled_with_admin', 'placeholder_sent']);
// Mismo Set que CALL_STAGES en index.js — solo para la línea de referencia
// cruzada con coverage:callstage, no gatea nada de la cobertura de guion.
const STAGES = new Set(['contestador', 'recepcion', 'decisor']);

let data;
try {
  data = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (err) {
  console.error(`No pude leer ${file} como JSON: ${err.message}`);
  process.exit(1);
}

// Banco de guiones (opcional): pone nombre a cada scriptId en el reporte.
// Nunca rompe si no existe o está corrupto — el reporte sigue con ids solos.
function loadScriptLabels(settersFile) {
  try {
    const p = path.join(path.dirname(settersFile), 'call_scripts.json');
    if (!fs.existsSync(p)) return {};
    const bank = JSON.parse(fs.readFileSync(p, 'utf8'));
    const map = {};
    for (const s of (bank.scripts || [])) {
      if (s && typeof s.id === 'string' && s.id) map[s.id] = s.label || s.id;
    }
    return map;
  } catch {
    return {};
  }
}
const scriptLabels = loadScriptLabels(file);

const verTodo = args.includes('--all');
const pedido = days > 0 ? Date.now() - days * 86400000 : 0;
// El piso es el deploy de la siembra, salvo --all explícito. Con --days más
// viejo que el deploy, gana el deploy y se avisa: si no, el denominador
// incluiría llamadas que nunca pudieron tener guion.
const desde = verTodo ? 0 : Math.max(pedido, DEPLOY_TS);
const recortado = !verTodo && pedido > 0 && pedido < DEPLOY_TS;
const hastaTs = Date.now();

let relevantes = 0, conGuion = 0, aMano = 0, automaticas = 0, conEtapa = 0;
let ultima = '', primeraAMano = '', ultimaAMano = '';
const porCanal = {
  dialer: { total: 0, conGuion: 0 },   // channel === 'telnyx_webrtc'
  manual: { total: 0, conGuion: 0 },   // todo lo demás (manual/email/otros) — mismo filtro que ignora /script-effectiveness
};
const porGuion = {}; // scriptId -> { automatico, manual }
const porDia = {};   // solo elegidas a mano (D-03: son las que dicen algo)

for (const lead of Object.values(data.leads || {})) {
  if (!Array.isArray(lead.callLog)) continue;
  for (const c of lead.callLog) {
    if (!c || typeof c !== 'object') continue;

    const tsRaw = c.ts;
    const ts = tsRaw ? new Date(tsRaw).getTime() : NaN;
    if (Number.isFinite(ts)) {
      if (!ultima || tsRaw > ultima) ultima = tsRaw;
    } else {
      continue; // ts inválido: no se puede ubicar en la ventana, se salta sin romper
    }
    if (desde && ts < desde) continue;
    if (!RELEVANT.has(c.outcome)) continue;
    relevantes++;

    const canal = c.channel === 'telnyx_webrtc' ? porCanal.dialer : porCanal.manual;
    canal.total++;

    if (STAGES.has(c.callStage)) conEtapa++;

    const ids = Array.isArray(c.scriptIdsUsed)
      ? c.scriptIdsUsed.filter((id) => typeof id === 'string' && id)
      : [];
    if (!ids.length) continue;
    conGuion++;
    canal.conGuion++;

    const isAuto = c.scriptIdsAuto === true;
    if (isAuto) automaticas++; else aMano++;

    if (!isAuto) {
      const dia = (tsRaw || '').slice(0, 10);
      if (dia) porDia[dia] = (porDia[dia] || 0) + 1;
      if (!primeraAMano || tsRaw < primeraAMano) primeraAMano = tsRaw;
      if (!ultimaAMano || tsRaw > ultimaAMano) ultimaAMano = tsRaw;
    }

    // Dedup dentro de la misma llamada — mismo criterio que /script-effectiveness
    // (un setter que clickeó el mismo guion 2 veces no infla el reparto).
    for (const id of new Set(ids)) {
      if (!porGuion[id]) porGuion[id] = { automatico: 0, manual: 0 };
      if (isAuto) porGuion[id].automatico++; else porGuion[id].manual++;
    }
  }
}

const pct = (n, d) => (d > 0 ? ((n / d) * 100).toFixed(1) + '%' : '—');
const fmtDia = (ts) => new Date(ts).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
const ventana = verTodo
  ? 'histórico completo (incluye llamadas anteriores al deploy de la captura)'
  : (days > 0 && !recortado ? `últimos ${days} días` : 'desde el deploy de la captura de guion');

const guionesOrdenados = Object.entries(porGuion)
  .map(([id, v]) => ({ id, label: scriptLabels[id] || '(eliminado)', automatico: v.automatico, manual: v.manual }))
  .sort((a, b) => (b.automatico + b.manual) - (a.automatico + a.manual));

if (asJson) {
  const payload = {
    file: path.basename(file),
    ventana,
    desde: verTodo ? null : new Date(desde).toISOString(),
    hasta: new Date(hastaTs).toISOString(),
    recortado,
    relevantes,
    conGuion,
    aMano,
    automaticas,
    porCanal,
    porGuion: guionesOrdenados,
    porDia,
    primeraAMano: primeraAMano || null,
    ultimaAMano: ultimaAMano || null,
    ultima: ultima || null,
    conEtapa,
  };
  console.log(JSON.stringify(payload));
  process.exit(0);
}

console.log(`\nCobertura de atribución de guion · ${ventana} · ${path.basename(file)}`);
console.log(`Desde ${verTodo ? 'siempre' : fmtDia(desde)}`);
if (recortado) console.log(`(--days ${days} pedía más atrás; se recortó al deploy de la siembra — antes no había guion que registrar)`);
if (verTodo) console.log('(--all: el denominador trae llamadas que nunca pudieron tener guion; la cobertura va a dar ~0%)');
console.log('─'.repeat(64));
console.log(`Llamadas donde alguien atendió       ${String(relevantes).padStart(6)}`);
console.log(`  con guion atribuido                 ${String(conGuion).padStart(6)}   ${pct(conGuion, relevantes)}`);
console.log(`    elegido por una persona           ${String(aMano).padStart(6)}   ${pct(aMano, relevantes)}  ← el número que importa`);
console.log(`    default automático                ${String(automaticas).padStart(6)}   ${pct(automaticas, conGuion)} de las que tienen`);
console.log(`  del dialer (WebRTC)                 ${String(porCanal.dialer.total).padStart(6)}   ${pct(porCanal.dialer.total, relevantes)}   con guion: ${porCanal.dialer.conGuion} (${pct(porCanal.dialer.conGuion, porCanal.dialer.total)})`);
console.log(`  fuera del dialer (manual/email/otros)${String(porCanal.manual.total).padStart(5)}   ${pct(porCanal.manual.total, relevantes)}   con guion: ${porCanal.manual.conGuion} (${pct(porCanal.manual.conGuion, porCanal.manual.total)})`);
console.log(`  con etapa cargada (referencia)      ${String(conEtapa).padStart(6)}   ${pct(conEtapa, relevantes)}   (mismo criterio que coverage:callstage)`);

console.log('\nPor qué puede no coincidir con "Guiones de llamada":');
console.log('  /api/telnyx/script-effectiveness solo mira channel=telnyx_webrtc (el dialer).');
console.log('  Este reporte suma TODOS los canales — la fila de arriba es la que se compara con el panel.');

if (guionesOrdenados.length) {
  console.log('\nReparto por guion (a mano · automático):');
  for (const g of guionesOrdenados) {
    console.log(`  ${g.id.padEnd(24)} ${g.label.padEnd(28)} ${String(g.manual).padStart(4)} a mano · ${String(g.automatico).padStart(4)} auto`);
  }
} else {
  console.log('\nNingún guion atribuido todavía en la ventana.');
}

const dias = Object.keys(porDia).sort();
if (dias.length) {
  console.log('\nCargas a mano por día:');
  for (const d of dias.slice(-10)) console.log(`   ${d}  ${porDia[d]}`);
  console.log(`Rango: ${primeraAMano} → ${ultimaAMano}`);
} else {
  console.log('\nNingún registro a mano todavía.');
}

console.log(`\nÚltima llamada en el snapshot: ${ultima || '—'}`);
if (relevantes === 0) console.log('Sin llamadas en la ventana: no hay muestra para concluir nada.');
console.log('');

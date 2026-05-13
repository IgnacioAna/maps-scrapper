#!/usr/bin/env node
// Auditoría completa del estado del sistema.

const baseUrl = 'https://scm-setting.up.railway.app';

async function main() {
  // Usar archivos locales — pre-deploy más reciente.
  const fs = await import('node:fs');
  const settersData = JSON.parse(fs.readFileSync('./data/setters.json', 'utf8'));
  const authData = JSON.parse(fs.readFileSync('./data/auth.json', 'utf8'));
  const setters = settersData.setters || [];
  const allLeads = settersData.leads || {};
  const variants = settersData.variants || [];
  const users = authData.users || [];

  console.log('='.repeat(80));
  console.log('AUDITORIA SCM — Generada:', new Date().toISOString());
  console.log('='.repeat(80));

  const allArr = Object.values(allLeads);
  const setterMap = new Map(setters.map(s => [s.id, s]));

  console.log('\n[1] TOTALES');
  console.log('  Leads:', allArr.length, '| Setters:', setters.length, '| Variantes:', variants.length, '| Usuarios:', users.length);

  // Por setter
  console.log('\n[2] POR SETTER');
  console.log('  ' + 'Setter'.padEnd(28) + 'tot'.padStart(6) + 'sin'.padStart(6) + 'env'.padStart(6) + 'resp'.padStart(6) + 'cal'.padStart(5) + 'int'.padStart(5) + 'ag'.padStart(5) + 'sinW'.padStart(6) + 'desc'.padStart(5) + 'fu'.padStart(5));
  console.log('  ' + '─'.repeat(88));
  let unassigned = 0;
  let orphans = {};
  const bySetter = {};
  for (const l of allArr) {
    const sid = l.assignedTo || '';
    if (!sid) { unassigned++; continue; }
    if (!setterMap.has(sid)) { orphans[sid] = (orphans[sid]||0)+1; continue; }
    if (!bySetter[sid]) bySetter[sid] = [];
    bySetter[sid].push(l);
  }
  for (const s of setters) {
    const ml = bySetter[s.id] || [];
    const sin = ml.filter(l => !l.conexion && (l.estado === 'sin_contactar' || !l.estado)).length;
    const env = ml.filter(l => l.conexion === 'enviada').length;
    const resp = ml.filter(l => l.respondio === true).length;
    const cal = ml.filter(l => l.calificado === true).length;
    const inter = ml.filter(l => l.interes === 'si').length;
    const ag = ml.filter(l => l.estado === 'agendado').length;
    const sinW = ml.filter(l => l.conexion === 'sin_wsp').length;
    const desc = ml.filter(l => l.estado === 'descartado').length;
    const fu = ml.filter(l => l.followUps && Object.values(l.followUps).some(v => v === true)).length;
    console.log('  ' + s.name.padEnd(28) + String(ml.length).padStart(6) + String(sin).padStart(6) + String(env).padStart(6) + String(resp).padStart(6) + String(cal).padStart(5) + String(inter).padStart(5) + String(ag).padStart(5) + String(sinW).padStart(6) + String(desc).padStart(5) + String(fu).padStart(5));
  }
  console.log('  ' + '─'.repeat(88));
  console.log('  Sin asignar:', unassigned);
  if (Object.keys(orphans).length > 0) {
    console.log('  Huérfanos (asignado a setter inexistente):');
    for (const [sid, n] of Object.entries(orphans)) console.log('     →', sid, ':', n, 'leads');
  }

  // Por país
  console.log('\n[3] POR PAÍS (prefijo)');
  const byPrefix = {};
  for (const l of allArr) {
    const m = (l.phone || '').replace(/\s/g, '').match(/^\+?(\d{1,3})/);
    const k = m ? m[1] : 'sin';
    byPrefix[k] = (byPrefix[k] || 0) + 1;
  }
  const country = {
    '54':'AR', '57':'CO', '573':'CO-mob', '571':'CO', '575':'CO', '576':'CO', '577':'CO',
    '52':'MX', '521':'MX-mob', '56':'CL', '562':'CL-Sgo', '564':'CL', '567':'CL', '569':'CL-mob',
    '598':'UY', '591':'BO', '34':'ES', '593':'EC', '51':'PE', '593':'EC',
    '503':'SV', '506':'CR', '504':'HN', '507':'PA', '593':'EC',
  };
  for (const [p, c] of Object.entries(byPrefix).sort((a, b) => b[1] - a[1]).slice(0, 25)) {
    console.log('  +' + p.padEnd(5), (country[p] || '?').padEnd(8), '→', c);
  }

  // Estados
  console.log('\n[4] ESTADOS GLOBALES');
  const est = {};
  for (const l of allArr) est[l.estado || '__sin_estado__'] = (est[l.estado || '__sin_estado__'] || 0) + 1;
  for (const [k, v] of Object.entries(est).sort((a, b) => b[1] - a[1])) console.log('  ' + k.padEnd(20), v);

  // Conexión
  console.log('\n[5] CONEXIÓN GLOBALES');
  const conex = {};
  for (const l of allArr) conex[l.conexion || '__sin__'] = (conex[l.conexion || '__sin__'] || 0) + 1;
  for (const [k, v] of Object.entries(conex).sort((a, b) => b[1] - a[1])) console.log('  ' + k.padEnd(20), v);

  // Variantes
  console.log('\n[6] VARIANTES (' + variants.length + ')');
  for (const v of variants) {
    const owners = [v.setterId, ...(v.sharedWith || [])].filter(Boolean);
    const names = owners.map(id => setterMap.get(id)?.name || id).join(', ') || '(sin asignar)';
    console.log('  -', v.name.padEnd(50), '→', names);
  }

  // Usuarios
  console.log('\n[7] USUARIOS');
  for (const u of users) {
    const lastSeen = u.lastSeen ? new Date(u.lastSeen).toISOString().slice(0, 16).replace('T', ' ') : 'nunca';
    console.log('  -', (u.email || u.name || '').padEnd(40), 'role=' + (u.role || '').padEnd(11), 'status=' + (u.status || '').padEnd(8), 'lastSeen=' + lastSeen, 'setter=' + (u.setterId || '-'));
  }

  // Integridad
  console.log('\n[8] INTEGRIDAD — flags incoherentes');
  const incoh = { 'respondio sin conexion': 0, 'calificado sin respondio': 0, 'interes sin calificado': 0, 'agendado sin calificado': 0, 'enviada sin lastContact': 0, 'estado contactado sin conexion': 0 };
  for (const l of allArr) {
    if (l.respondio && !l.conexion) incoh['respondio sin conexion']++;
    if (l.calificado === true && !l.respondio) incoh['calificado sin respondio']++;
    if (l.interes === 'si' && l.calificado !== true) incoh['interes sin calificado']++;
    if (l.estado === 'agendado' && l.calificado !== true) incoh['agendado sin calificado']++;
    if (l.conexion === 'enviada' && !l.lastContactAt) incoh['enviada sin lastContact']++;
    if (l.estado === 'contactado' && !l.conexion) incoh['estado contactado sin conexion']++;
  }
  for (const [k, v] of Object.entries(incoh)) console.log('  ' + k.padEnd(35), v);

  // Duplicados por teléfono
  console.log('\n[9] DUPLICADOS POR TELÉFONO (en setters.json)');
  const byPhone = new Map();
  for (const [id, l] of Object.entries(allLeads)) {
    const p = (l.phone || '').replace(/\D/g, '');
    if (!p || p.length < 6) continue;
    if (!byPhone.has(p)) byPhone.set(p, []);
    byPhone.get(p).push({ id, ...l });
  }
  const dupes = [...byPhone.entries()].filter(([_, arr]) => arr.length > 1);
  console.log('  Teléfonos duplicados:', dupes.length);
  if (dupes.length > 0 && dupes.length < 15) {
    for (const [p, arr] of dupes.slice(0, 10)) {
      console.log('   - +' + p, '→', arr.length, 'leads:', arr.map(x => (setterMap.get(x.assignedTo)?.name || 'sin') + ':' + (x.estado || '')).join(' | '));
    }
  } else if (dupes.length >= 15) {
    console.log('   (' + dupes.length + ' total — muchos para listar)');
  }

  // Follow-ups
  console.log('\n[10] FOLLOW-UPS PROGRAMADOS');
  let totalFu = 0, fuBySetter = {};
  for (const l of allArr) {
    if (!l.followUps) continue;
    const has = Object.values(l.followUps).some(v => v === true);
    if (!has) continue;
    totalFu++;
    const sname = setterMap.get(l.assignedTo)?.name || 'sin';
    fuBySetter[sname] = (fuBySetter[sname] || 0) + 1;
  }
  console.log('  Total leads con follow-up activo:', totalFu);
  for (const [s, c] of Object.entries(fuBySetter).sort((a, b) => b[1] - a[1])) console.log('   -', s.padEnd(28), c);

  // Backups (no se puede en modo offline)
  console.log('\n[11] BACKUPS — modo offline, omitido');

  console.log('\n' + '='.repeat(80));
  console.log('FIN DE AUDITORIA');
  console.log('='.repeat(80));
}

main().catch(e => { console.error(e); process.exit(1); });

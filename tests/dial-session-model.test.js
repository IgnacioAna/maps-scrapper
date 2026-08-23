// Fase 37-01 (SES-01/SES-05): la sesión de discado como objeto persistido.
// Suite HTTP + pura del ciclo de vida (abrir/cerrar), auto-cierre de
// huérfanas, RBAC/IDOR, coerción de input y el invariante que justifica la
// fase: los contadores de la sesión == CALL METRICS CORE sobre la MISMA
// ventana. Molde: tests/hoy-hygiene-snapshot.test.js (fixture inline en
// tmpData, cookies, lectura de setters.json de disco para side-effects) +
// tests/metrics-consistency.test.js (acceso a globalThis.__callCore).
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import request from 'supertest';

const tmpData = path.join(os.tmpdir(), `dial-session-model-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = 'admin-ds@local.test';
process.env.ADMIN_PASSWORD = 'dspass1234';
process.env.JWT_SECRET = 'test-secret-dial-session-model-1234567890';
// Nota #121 de CLAUDE.md: definida-vacía, NUNCA `delete` (dotenv repone las
// borradas y los tests terminan pegándole a la IA real).
process.env.OPENAI_API_KEY = '';
process.env.MERCURY_API_KEY = '';
process.env.QWEN_API_KEY = '';

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: crypto.scryptSync(plain, salt, 64).toString('hex') };
}

fs.writeFileSync(path.join(tmpData, 'auth.json'), JSON.stringify({
  users: [
    { id: 'u_admin', email: 'admin-ds@local.test', name: 'AdminDS', role: 'admin', status: 'active', setterId: '', password: pwd('dspass1234') },
    { id: 'u_a', email: 'a-ds@local.test', name: 'SdrA', role: 'setter', status: 'active', setterId: 's_a', password: pwd('apass123456') },
    { id: 'u_b', email: 'b-ds@local.test', name: 'SdrB', role: 'setter', status: 'active', setterId: 's_b', password: pwd('bpass123456') },
    // Cuenta setter mal configurada: sin setterId vinculado.
    { id: 'u_broken', email: 'broken-ds@local.test', name: 'SdrBroken', role: 'setter', status: 'active', setterId: '', password: pwd('brokenpass123456') },
    // Supervisor scoped: solo ve a s_a. Sin setterId propio (caso real más común).
    { id: 'u_sup', email: 'sup-ds@local.test', name: 'SupDS', role: 'supervisor', status: 'active', setterId: '', visibleSetterIds: ['s_a'], password: pwd('suppass123456') },
    { id: 'u_open', email: 'open-ds@local.test', name: 'SdrOpen', role: 'setter', status: 'active', setterId: 's_open', password: pwd('openpass123456') },
    { id: 'u_orphan', email: 'orphan-ds@local.test', name: 'SdrOrphan', role: 'setter', status: 'active', setterId: 's_orphan', password: pwd('orphanpass123456') },
    { id: 'u_orphan2', email: 'orphan2-ds@local.test', name: 'SdrOrphan2', role: 'setter', status: 'active', setterId: 's_orphan2', password: pwd('orphan2pass123456') },
    { id: 'u_prune', email: 'prune-ds@local.test', name: 'SdrPrune', role: 'setter', status: 'active', setterId: 's_prune', password: pwd('prunepass123456') },
  ], invites: [], sessions: [],
}, null, 2));

const lead = (n, extra = {}) => ({
  num: n, name: 'L' + n, phone: '+521555200' + String(n).padStart(3, '0'),
  assignedTo: 's_a', conexion: 'sin_wsp', estado: 'sin_contactar', callLog: [], ...extra,
});

fs.writeFileSync(path.join(tmpData, 'setters.json'), JSON.stringify({
  setters: [
    { id: 's_a', name: 'A' }, { id: 's_b', name: 'B' }, { id: 's_open', name: 'Open' },
    { id: 's_orphan', name: 'Orphan' }, { id: 's_orphan2', name: 'Orphan2' }, { id: 's_prune', name: 'Prune' },
  ],
  variants: [],
  leads: {
    l_a: lead(1, { assignedTo: 's_a' }),
    l_b: lead(2, { assignedTo: 's_b' }),
  },
  calendar: [], sessions: [], dialSessions: [],
}, null, 2));

const { app } = await import('../index.js');
const CC = globalThis.__callCore;
const DS = globalThis.__dialSessions;

const SETTERS_FILE = path.join(tmpData, 'setters.json');
function readSettersFile() { return JSON.parse(fs.readFileSync(SETTERS_FILE, 'utf8')); }
function writeSettersFile(sd) { fs.writeFileSync(SETTERS_FILE, JSON.stringify(sd, null, 2)); }

function injectCall(leadId, entry) {
  const sd = readSettersFile();
  const lead = sd.leads[leadId];
  if (!Array.isArray(lead.callLog)) lead.callLog = [];
  lead.callLog.push(entry);
  writeSettersFile(sd);
}
function injectCalendarWin(setterId, leadId, valorProyecto) {
  const sd = readSettersFile();
  if (!Array.isArray(sd.calendar)) sd.calendar = [];
  sd.calendar.push({
    id: 'cal_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    leadId, nombre: leadId, calendarioEstado: 'ganada', valorProyecto, setterId,
    closedAt: new Date().toISOString(),
  });
  writeSettersFile(sd);
}
function seedOpenSession(setterId, userId, startedAtIso, id) {
  const sd = readSettersFile();
  if (!Array.isArray(sd.dialSessions)) sd.dialSessions = [];
  sd.dialSessions.push({
    id, setterId, by: userId, startedAt: startedAtIso, endedAt: null,
    mode: 'calls', hoyFilter: null, filtro: {}, queueSize: 5,
    processed: 0, mood: '', closedBy: '', counters: null,
  });
  writeSettersFile(sd);
}
function seedClosedSessions(setterId, userId, count, idPrefix) {
  const sd = readSettersFile();
  if (!Array.isArray(sd.dialSessions)) sd.dialSessions = [];
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    // i=0 la más VIEJA, i=count-1 la más NUEVA del lote (todas en el pasado).
    const startedAt = new Date(now - (count + 20 - i) * 60000).toISOString();
    const endedAt = new Date(now - (count + 19 - i) * 60000).toISOString();
    sd.dialSessions.push({
      id: `${idPrefix}_${i}`, setterId, by: userId, startedAt, endedAt, durationS: 60,
      mode: 'calls', hoyFilter: null, filtro: {}, queueSize: 1, processed: 0, mood: '',
      closedBy: 'user',
      counters: { dials: 0, connects: 0, conversations: 0, appointments: 0, deals: 0, totalDurationS: 0, avgConvDurationS: 0, leads: 0, byOutcome: {} },
    });
  }
  writeSettersFile(sd);
}

async function login(email, password) {
  const r = await request(app).post('/api/auth/login').send({ email, password });
  const c = (r.headers['set-cookie'] || []).find((x) => x.startsWith('gs_session='));
  if (!c) throw new Error(`login falló para ${email}: ${r.status} ${JSON.stringify(r.body)}`);
  return c.split(';')[0];
}
function openSession(cookie, body = {}) {
  return request(app).post('/api/setters/dial-sessions').set('Cookie', cookie).send(body);
}
function closeSession(cookie, id, body = {}) {
  return request(app).post(`/api/setters/dial-sessions/${id}/close`).set('Cookie', cookie).send(body);
}

let cookieA = '', cookieB = '', cookieBroken = '', cookieSup = '', cookieOpen = '', cookieOrphan = '', cookieOrphan2 = '', cookiePrune = '';

beforeAll(async () => {
  cookieA = await login('a-ds@local.test', 'apass123456');
  cookieB = await login('b-ds@local.test', 'bpass123456');
  cookieBroken = await login('broken-ds@local.test', 'brokenpass123456');
  cookieSup = await login('sup-ds@local.test', 'suppass123456');
  cookieOpen = await login('open-ds@local.test', 'openpass123456');
  cookieOrphan = await login('orphan-ds@local.test', 'orphanpass123456');
  cookieOrphan2 = await login('orphan2-ds@local.test', 'orphan2pass123456');
  cookiePrune = await login('prune-ds@local.test', 'prunepass123456');
});
afterAll(() => { try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {} });

describe('Apertura', () => {
  it('200 con session.id, setterId del usuario real, startedAt ISO, endedAt null, counters null', async () => {
    const r = await openSession(cookieOpen, { mode: 'calls', queueSize: 12 });
    expect(r.status).toBe(200);
    const s = r.body.session;
    expect(typeof s.id).toBe('string');
    expect(s.id.length).toBeGreaterThan(0);
    expect(s.setterId).toBe('s_open');
    expect(s.endedAt).toBeNull();
    expect(s.counters).toBeNull();
    expect(s.queueSize).toBe(12);
    expect(new Date(s.startedAt).toString()).not.toBe('Invalid Date');
  });

  it('startedAt lo pone el SERVIDOR: un startedAt del 2020 en el body se ignora', async () => {
    const r = await openSession(cookieOpen, { mode: 'calls', startedAt: '2020-01-01T00:00:00.000Z' });
    expect(r.status).toBe(200);
    expect(new Date(r.body.session.startedAt).getFullYear()).toBeGreaterThan(2020);
  });

  it("mode fuera de la whitelist → 'calls'; hoyFilter inventado → null; queueSize negativo/no-numérico → 0", async () => {
    const r1 = await openSession(cookieOpen, { mode: 'algo_raro', hoyFilter: 'invento', queueSize: -3 });
    expect(r1.status).toBe(200);
    expect(r1.body.session.mode).toBe('calls');
    expect(r1.body.session.hoyFilter).toBeNull();
    expect(r1.body.session.queueSize).toBe(0);

    const r2 = await openSession(cookieOpen, { mode: 'hoy', queueSize: 'muchos' });
    expect(r2.status).toBe(200);
    expect(r2.body.session.mode).toBe('hoy');
    expect(r2.body.session.queueSize).toBe(0);
  });

  it('mode/hoyFilter válidos se conservan tal cual', async () => {
    const r = await openSession(cookieOpen, { mode: 'hoy', hoyFilter: 'interesados', queueSize: 7 });
    expect(r.status).toBe(200);
    expect(r.body.session.mode).toBe('hoy');
    expect(r.body.session.hoyFilter).toBe('interesados');
    expect(r.body.session.queueSize).toBe(7);
  });

  it('filtro con 30 claves, valores largos y un objeto anidado → como mucho 8 claves, strings recortadas, sin anidados', async () => {
    const filtro = { anidado: { a: 1, b: [1, 2, 3] } };
    for (let i = 0; i < 29; i++) filtro['clave_muy_larga_numero_' + i] = 'y'.repeat(200);
    const r = await openSession(cookieOpen, { mode: 'calls', filtro, queueSize: 2 });
    expect(r.status).toBe(200);
    const f = r.body.session.filtro;
    expect(Object.keys(f).length).toBeLessThanOrEqual(8);
    for (const k of Object.keys(f)) {
      expect(k.length).toBeLessThanOrEqual(24);
      expect(typeof f[k]).toBe('string');
      expect(f[k].length).toBeLessThanOrEqual(60);
    }
    // El valor anidado quedó aplastado a texto plano, nunca un objeto.
    expect(typeof f.anidado).toBe('string');
  });

  it('usuario setter sin setterId vinculado → 400, sin dejar basura en dialSessions', async () => {
    const before = readSettersFile();
    const beforeCount = (before.dialSessions || []).length;
    const r = await openSession(cookieBroken, { mode: 'calls', queueSize: 1 });
    expect(r.status).toBe(400);
    expect(r.body.error).toBeTruthy();
    const after = readSettersFile();
    expect((after.dialSessions || []).length).toBe(beforeCount);
    const mine = (after.dialSessions || []).filter((s) => s.by === 'u_broken' || s.setterId === '');
    expect(mine.length).toBe(0);
  });

  it('supervisor scoped sin setterId vinculado → 400 (mismo guard que un setter roto)', async () => {
    const r = await openSession(cookieSup, { mode: 'calls' });
    expect(r.status).toBe(400);
  });

  it('sin auth → 401/403', async () => {
    const r = await request(app).post('/api/setters/dial-sessions').send({ mode: 'calls' });
    expect([401, 403]).toContain(r.status);
  });
});

describe('Cierre y SES-05 (el invariante que justifica la fase)', () => {
  let session1 = null;

  it('sesión 1: counters EXACTOS y == CALL METRICS CORE recalculado sobre la MISMA ventana', async () => {
    const openRes = await openSession(cookieA, { mode: 'calls', queueSize: 10 });
    expect(openRes.status).toBe(200);
    session1 = openRes.body.session;

    // Dentro de la ventana, atribuidas a u_a (s_a).
    injectCall('l_a', { ts: new Date().toISOString(), outcome: 'answered_interested', by: 'u_a', channel: 'telnyx_webrtc', duration: 40 });
    injectCall('l_a', { ts: new Date().toISOString(), outcome: 'no_answer', by: 'u_a', channel: 'telnyx_webrtc', duration: 0 });
    injectCall('l_a', { ts: new Date().toISOString(), outcome: 'scheduled_with_admin', by: 'u_a', channel: 'manual', duration: 0 });
    // ANTES de startedAt → no debe contar.
    injectCall('l_a', { ts: new Date(new Date(session1.startedAt).getTime() - 10 * 60000).toISOString(), outcome: 'hung_up', by: 'u_a', channel: 'telnyx_webrtc', duration: 5 });
    // De OTRO SDR dentro de la misma ventana temporal → no debe colarse en la sesión de s_a.
    injectCall('l_b', { ts: new Date().toISOString(), outcome: 'answered_interested', by: 'u_b', channel: 'telnyx_webrtc', duration: 40 });
    // Deal ganada de s_a dentro de la ventana.
    injectCalendarWin('s_a', 'l_a', 300);

    const closeRes = await closeSession(cookieA, session1.id, { processed: 5 });
    expect(closeRes.status).toBe(200);
    session1 = closeRes.body.session;
    expect(session1.endedAt).toBeTruthy();
    expect(session1.closedBy).toBe('user');
    expect(session1.processed).toBe(5);

    // Números EXACTOS esperados (no solo el invariante contra el CORE).
    expect(session1.counters.dials).toBe(3);
    expect(session1.counters.connects).toBe(2); // interested + scheduled (no_answer no es connect)
    expect(session1.counters.conversations).toBe(2); // interested (dur>=30) + scheduled (appointment)
    expect(session1.counters.appointments).toBe(1);
    expect(session1.counters.deals).toBe(1);
    expect(session1.counters.leads).toBe(1); // solo l_a — la de l_b no cuenta acá

    // sum(byOutcome) === dials.
    const sumByOutcome = Object.values(session1.counters.byOutcome).reduce((a, b) => a + b, 0);
    expect(sumByOutcome).toBe(session1.counters.dials);

    // durationS coherente con endedAt - startedAt.
    const fromTs = new Date(session1.startedAt).getTime();
    const toTs = new Date(session1.endedAt).getTime();
    const expectedDuration = Math.round((toTs - fromTs) / 1000);
    expect(Math.abs(session1.durationS - expectedDuration)).toBeLessThanOrEqual(1);

    // INVARIANTE SES-05: recalculado independientemente contra el CORE.
    const data = readSettersFile();
    const calls = CC._ccCollectCalls(data, { setterId: 's_a' });
    const inWindow = calls.filter((c) => c.ts >= fromTs && c.ts < toTs);
    const agg = CC._ccFunnelAggregate(inWindow, data.calendar, fromTs, toTs, { setterId: 's_a' });
    for (const k of ['dials', 'connects', 'conversations', 'appointments', 'deals', 'totalDurationS', 'avgConvDurationS']) {
      expect(session1.counters[k], `counters.${k} difiere del CORE`).toBe(agg[k]);
    }

    expect(closeRes.body.previous).toBeNull();
  });

  it('cerrar dos veces: la segunda responde alreadyClosed y NO recalcula (aunque se agregue una llamada nueva)', async () => {
    const before = JSON.parse(JSON.stringify(session1.counters));
    // Llamada nueva DESPUÉS del cierre — no debería filtrarse al recontar.
    injectCall('l_a', { ts: new Date().toISOString(), outcome: 'answered_interested', by: 'u_a', channel: 'telnyx_webrtc', duration: 60 });
    const r = await closeSession(cookieA, session1.id, { processed: 999 });
    expect(r.status).toBe(200);
    expect(r.body.alreadyClosed).toBe(true);
    expect(r.body.session.counters).toEqual(before);
    expect(r.body.session.processed).toBe(5); // el processed del primer cierre real, NO 999
  });

  it('sesión 2 sin llamadas nuevas: previous es la sesión 1 (dials>0); sesión 2 misma no se ofrece si queda en 0', async () => {
    const openRes = await openSession(cookieA, { mode: 'calls', queueSize: 3 });
    expect(openRes.status).toBe(200);
    const session2 = openRes.body.session;
    const closeRes = await closeSession(cookieA, session2.id);
    expect(closeRes.status).toBe(200);
    expect(closeRes.body.session.counters.dials).toBe(0);
    expect(closeRes.body.previous).toBeTruthy();
    expect(closeRes.body.previous.id).toBe(session1.id);
    expect(closeRes.body.previous.counters.dials).toBe(session1.counters.dials);
  });

  it('sesión 3: previous SALTA la sesión sin llamadas (sesión 2) y devuelve la sesión 1', async () => {
    const openRes = await openSession(cookieA, { mode: 'hoy', hoyFilter: 'callbacks', queueSize: 1 });
    expect(openRes.status).toBe(200);
    const session3 = openRes.body.session;
    injectCall('l_a', { ts: new Date().toISOString(), outcome: 'no_answer', by: 'u_a', channel: 'telnyx_webrtc', duration: 0 });
    const closeRes = await closeSession(cookieA, session3.id);
    expect(closeRes.status).toBe(200);
    expect(closeRes.body.session.counters.dials).toBe(1);
    expect(closeRes.body.previous.id).toBe(session1.id);
  });
});

describe('RBAC / IDOR', () => {
  it('u_b no puede cerrar la sesión de u_a (404, no 403 mudo ni éxito) — la sesión sigue abierta', async () => {
    const openRes = await openSession(cookieA, { mode: 'calls', queueSize: 5 });
    expect(openRes.status).toBe(200);
    const session = openRes.body.session;

    const idorRes = await closeSession(cookieB, session.id);
    expect(idorRes.status).toBe(404);

    // Sigue abierta de verdad: cerrarla como su dueña real funciona.
    const realClose = await closeSession(cookieA, session.id);
    expect(realClose.status).toBe(200);
    expect(realClose.body.alreadyClosed).toBeFalsy();
  });

  it(':id inexistente → 404', async () => {
    const r = await closeSession(cookieA, 'dsess_no_existe_para_nadie');
    expect(r.status).toBe(404);
  });

  it('usuario sin setterId vinculado intentando cerrar → 400 (guard corre antes del lookup)', async () => {
    const r = await closeSession(cookieBroken, 'dsess_cualquiera');
    expect(r.status).toBe(400);
  });
});

describe('Auto-cierre de huérfanas', () => {
  it('sesión huérfana con llamadas: se cierra sola al abrir la siguiente, anclada a la última llamada real', async () => {
    const startedAt = new Date(Date.now() - 3 * 3600000).toISOString(); // hace 3 horas
    seedOpenSession('s_orphan', 'u_orphan', startedAt, 'dsess_orphan_seed');
    const lastCallTs = new Date(Date.now() - 2 * 3600000).toISOString(); // hace 2 horas
    injectCall('l_a', { ts: lastCallTs, outcome: 'no_answer', by: 'u_orphan', channel: 'telnyx_webrtc', duration: 0 });
    // Una llamada MÁS VIEJA que la anterior (dentro de la ventana igual) — el
    // ancla debe ser la ÚLTIMA, no cualquiera.
    injectCall('l_a', { ts: new Date(Date.now() - 2.5 * 3600000).toISOString(), outcome: 'no_answer', by: 'u_orphan', channel: 'telnyx_webrtc', duration: 0 });

    const openRes = await openSession(cookieOrphan, { mode: 'calls', queueSize: 4 });
    expect(openRes.status).toBe(200);
    const newSession = openRes.body.session;
    expect(newSession.id).not.toBe('dsess_orphan_seed');
    expect(newSession.endedAt).toBeNull();

    const sd = readSettersFile();
    const orphan = sd.dialSessions.find((s) => s.id === 'dsess_orphan_seed');
    expect(orphan).toBeTruthy();
    expect(orphan.closedBy).toBe('auto');
    expect(orphan.endedAt).toBeTruthy();
    expect(new Date(orphan.endedAt).getTime()).toBe(new Date(lastCallTs).getTime());
    expect(orphan.counters).toBeTruthy();
    expect(orphan.counters.dials).toBeGreaterThanOrEqual(1);

    // Nunca quedan 2 abiertas del mismo setter tras abrir.
    const openOnes = sd.dialSessions.filter((s) => s.setterId === 's_orphan' && !s.endedAt);
    expect(openOnes.length).toBe(1);
    expect(openOnes[0].id).toBe(newSession.id);
  });

  it('sesión huérfana SIN ninguna llamada: endedAt === startedAt, durationS 0, no se traga horas muertas', async () => {
    const startedAt = new Date(Date.now() - 3600000).toISOString(); // hace 1 hora, sin llamadas
    seedOpenSession('s_orphan2', 'u_orphan2', startedAt, 'dsess_orphan2_seed');

    const openRes = await openSession(cookieOrphan2, { mode: 'calls' });
    expect(openRes.status).toBe(200);

    const sd = readSettersFile();
    const orphan = sd.dialSessions.find((s) => s.id === 'dsess_orphan2_seed');
    expect(orphan).toBeTruthy();
    expect(orphan.closedBy).toBe('auto');
    expect(new Date(orphan.endedAt).getTime()).toBe(new Date(startedAt).getTime());
    expect(orphan.durationS).toBe(0);
    expect(orphan.counters.dials).toBe(0);
  });
});

describe('Poda', () => {
  it('95 sesiones cerradas de s_prune + 3 de s_b: abrir una de s_prune deja como mucho el cap, s_b intacto', async () => {
    seedClosedSessions('s_prune', 'u_prune', 95, 'dsess_prune');
    seedClosedSessions('s_b', 'u_b', 3, 'dsess_sb_untouched');

    const before = readSettersFile();
    const sbBefore = before.dialSessions.filter((s) => s.setterId === 's_b');
    expect(sbBefore.length).toBe(3);

    const openRes = await openSession(cookiePrune, { mode: 'calls', queueSize: 1 });
    expect(openRes.status).toBe(200);
    const newId = openRes.body.session.id;

    const after = readSettersFile();
    const pruneAfter = after.dialSessions.filter((s) => s.setterId === 's_prune');
    expect(pruneAfter.length).toBeLessThanOrEqual(90);
    // La recién abierta (la más nueva de todas) sobrevive a la poda.
    expect(pruneAfter.some((s) => s.id === newId)).toBe(true);
    // La más vieja del lote sembrado fue podada.
    expect(pruneAfter.some((s) => s.id === 'dsess_prune_0')).toBe(false);
    // La más nueva del lote sembrado sobrevive.
    expect(pruneAfter.some((s) => s.id === 'dsess_prune_94')).toBe(true);

    // s_b, un setter DISTINTO, queda intacto.
    const sbAfter = after.dialSessions.filter((s) => s.setterId === 's_b');
    expect(sbAfter.length).toBe(3);
    expect(sbAfter.map((s) => s.id).sort()).toEqual(sbBefore.map((s) => s.id).sort());
  });
});

describe('Puros (globalThis.__dialSessions)', () => {
  it('_dialSessionSanitize con null/undefined/string → no revienta, devuelve defaults', () => {
    const expected = { mode: 'calls', hoyFilter: null, filtro: {}, queueSize: 0 };
    expect(DS._dialSessionSanitize(null)).toEqual(expected);
    expect(DS._dialSessionSanitize(undefined)).toEqual(expected);
    expect(DS._dialSessionSanitize('un string cualquiera')).toEqual(expected);
    expect(DS._dialSessionSanitize(42)).toEqual(expected);
  });

  it('_dialSessionSanitize acepta mode/hoyFilter válidos y coerciona queueSize numérico-string', () => {
    const r = DS._dialSessionSanitize({ mode: 'hoy', hoyFilter: 'interesados', queueSize: '7' });
    expect(r).toEqual({ mode: 'hoy', hoyFilter: 'interesados', filtro: {}, queueSize: 7 });
  });

  it('_dialSessionCounters con setterId vacío → todo en 0, nunca las llamadas del equipo', () => {
    const data = {
      leads: { x: { callLog: [{ ts: new Date().toISOString(), outcome: 'answered_interested', by: 'u_a', duration: 60 }] } },
      calendar: [],
    };
    const session = { setterId: '', startedAt: new Date(Date.now() - 60000).toISOString() };
    const c = DS._dialSessionCounters(data, session, Date.now());
    expect(c).toEqual({ dials: 0, connects: 0, conversations: 0, appointments: 0, deals: 0, totalDurationS: 0, avgConvDurationS: 0, leads: 0, byOutcome: {} });
  });

  it('_dialSessionPrune no toca las sesiones de otros setters', () => {
    const list = [
      { id: 'x1', setterId: 's_x', startedAt: new Date(Date.now() - 1000).toISOString() },
      { id: 'y1', setterId: 's_y', startedAt: new Date(Date.now() - 2000).toISOString() },
    ];
    const pruned = DS._dialSessionPrune(list, 's_x');
    expect(pruned.length).toBe(2); // muy por debajo del cap, nada se poda
    expect(pruned.find((s) => s.id === 'y1')).toBeTruthy();
  });
});

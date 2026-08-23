// Fase 37-02 (SES-03/SES-04): historial de sesiones de discado + estado del
// que marcó. Suite HTTP. Molde: tests/dial-session-model.test.js (fixture
// inline en tmpData, seed directo de dialSessions en setters.json, login por
// cookie) + tests/admin-only-setters.test.js (supervisor scoped).
//
// Las sesiones se SIEMBRAN directo en el archivo (no vía POST abrir/cerrar):
// esta suite testea LECTURA y PATCH, no el ciclo de vida (eso ya lo cubre
// dial-session-model.test.js con el invariante SES-05).
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import request from 'supertest';

const tmpData = path.join(os.tmpdir(), `dial-session-history-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = 'admin-dsh@local.test';
process.env.ADMIN_PASSWORD = 'dshpass1234';
process.env.JWT_SECRET = 'test-secret-dial-session-history-1234567890';
// TZ de negocio fija (evita la clase de flaky documentada en CLAUDE.md #163:
// una fecha "hoy/ayer" calculada sin anclar la TZ puede caer del otro lado
// de medianoche según cuándo corra la suite).
process.env.BUSINESS_TZ = 'America/Argentina/Buenos_Aires';
// Nota #121 de CLAUDE.md: definida-vacía, NUNCA `delete`.
process.env.OPENAI_API_KEY = '';
process.env.MERCURY_API_KEY = '';
process.env.QWEN_API_KEY = '';

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: crypto.scryptSync(plain, salt, 64).toString('hex') };
}

fs.writeFileSync(path.join(tmpData, 'auth.json'), JSON.stringify({
  users: [
    { id: 'u_admin', email: 'admin-dsh@local.test', name: 'AdminDSH', role: 'admin', status: 'active', setterId: '', password: pwd('dshpass1234') },
    { id: 'u_a', email: 'a-dsh@local.test', name: 'SdrA', role: 'setter', status: 'active', setterId: 's_a', password: pwd('apass123456') },
    { id: 'u_b', email: 'b-dsh@local.test', name: 'SdrB', role: 'setter', status: 'active', setterId: 's_b', password: pwd('bpass123456') },
    // Supervisor scoped: solo ve a s_a.
    { id: 'u_sup', email: 'sup-dsh@local.test', name: 'SupDSH', role: 'supervisor', status: 'active', setterId: '', visibleSetterIds: ['s_a'], password: pwd('suppass123456') },
    { id: 'u_clamp', email: 'clamp-dsh@local.test', name: 'SdrClamp', role: 'setter', status: 'active', setterId: 's_clamp', password: pwd('clamppass123456') },
  ], invites: [], sessions: [],
}, null, 2));

fs.writeFileSync(path.join(tmpData, 'setters.json'), JSON.stringify({
  setters: [
    { id: 's_a', name: 'A' }, { id: 's_b', name: 'B' }, { id: 's_clamp', name: 'Clamp' },
  ],
  variants: [], leads: {}, calendar: [], sessions: [], dialSessions: [],
}, null, 2));

const { app } = await import('../index.js');
const DS = globalThis.__dialSessions;
const MA = globalThis.__metricsAudit;

const SETTERS_FILE = path.join(tmpData, 'setters.json');
function readSettersFile() { return JSON.parse(fs.readFileSync(SETTERS_FILE, 'utf8')); }
function writeSettersFile(sd) { fs.writeFileSync(SETTERS_FILE, JSON.stringify(sd, null, 2)); }

function baseSession(overrides) {
  return {
    id: overrides.id, setterId: overrides.setterId, by: overrides.by || 'u_x',
    startedAt: overrides.startedAt, endedAt: overrides.endedAt ?? null,
    durationS: overrides.durationS ?? 0,
    mode: 'calls', hoyFilter: null, filtro: {}, queueSize: overrides.queueSize ?? 1,
    processed: overrides.processed ?? 0, mood: '', closedBy: overrides.endedAt ? 'user' : '',
    counters: overrides.counters ?? null,
  };
}
function counters(dials) {
  return { dials, connects: 0, conversations: 0, appointments: 0, deals: 0, totalDurationS: 0, avgConvDurationS: 0, leads: 0, byOutcome: {} };
}
function seedSessions(list) {
  const sd = readSettersFile();
  if (!Array.isArray(sd.dialSessions)) sd.dialSessions = [];
  sd.dialSessions.push(...list.map(baseSession));
  writeSettersFile(sd);
}

async function login(email, password) {
  const r = await request(app).post('/api/auth/login').send({ email, password });
  const c = (r.headers['set-cookie'] || []).find((x) => x.startsWith('gs_session='));
  if (!c) throw new Error(`login falló para ${email}: ${r.status} ${JSON.stringify(r.body)}`);
  return c.split(';')[0];
}
function getHistory(cookie, query = '') {
  return request(app).get(`/api/setters/dial-sessions${query}`).set('Cookie', cookie);
}
function patchMood(cookie, id, body) {
  return request(app).patch(`/api/setters/dial-sessions/${id}`).set('Cookie', cookie).send(body);
}
function openSession(cookie, body = {}) {
  return request(app).post('/api/setters/dial-sessions').set('Cookie', cookie).send(body);
}

let cookieA = '', cookieB = '', cookieSup = '', cookieAdmin = '', cookieClamp = '';

// Anclados al MEDIODÍA de cada biz-day (no cerca de medianoche) — la misma
// clase de precaución que CLAUDE.md nota #163 (fixtures atados al reloj).
const todayNoon = MA._bizStartOfDay() + 12 * 3600000;
const yesterdayNoon = MA._bizStartOfDay(MA._bizStartOfDay() - 1) + 12 * 3600000;

beforeAll(async () => {
  cookieA = await login('a-dsh@local.test', 'apass123456');
  cookieB = await login('b-dsh@local.test', 'bpass123456');
  cookieSup = await login('sup-dsh@local.test', 'suppass123456');
  cookieAdmin = await login('admin-dsh@local.test', 'dshpass1234');
  cookieClamp = await login('clamp-dsh@local.test', 'clamppass123456');

  seedSessions([
    { id: 'dsess_a_today', setterId: 's_a', by: 'u_a', startedAt: new Date(todayNoon).toISOString(), endedAt: new Date(todayNoon + 1800000).toISOString(), durationS: 1800, counters: counters(5) },
    { id: 'dsess_a_yesterday', setterId: 's_a', by: 'u_a', startedAt: new Date(yesterdayNoon).toISOString(), endedAt: new Date(yesterdayNoon + 1800000).toISOString(), durationS: 1800, counters: counters(3) },
    // Ruido: 0 marcadas y 30s de duración — no se lista por defecto.
    { id: 'dsess_a_noise', setterId: 's_a', by: 'u_a', startedAt: new Date(todayNoon + 2 * 3600000).toISOString(), endedAt: new Date(todayNoon + 2 * 3600000 + 30000).toISOString(), durationS: 30, counters: counters(0) },
    // Abierta: nunca cuenta como ruido aunque no tenga counters todavía.
    { id: 'dsess_a_open', setterId: 's_a', by: 'u_a', startedAt: new Date(todayNoon + 3 * 3600000).toISOString(), endedAt: null, counters: null },
    // 0 marcadas pero MÁS de DIAL_SESSION_NOISE_MAX_S de duración → NO es ruido.
    { id: 'dsess_a_longzero', setterId: 's_a', by: 'u_a', startedAt: new Date(todayNoon + 4 * 3600000).toISOString(), endedAt: new Date(todayNoon + 4 * 3600000 + 500000).toISOString(), durationS: 500, counters: counters(0) },

    { id: 'dsess_b_1', setterId: 's_b', by: 'u_b', startedAt: new Date(todayNoon + 3600000).toISOString(), endedAt: new Date(todayNoon + 3600000 + 900000).toISOString(), durationS: 900, counters: counters(2) },
  ]);
});
afterAll(() => { try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {} });

describe('GET /api/setters/dial-sessions — historial (SES-03)', () => {
  it('un SDR sin parámetros ve solo sus sesiones, orden startedAt descendente, counters completos', async () => {
    const r = await getHistory(cookieA);
    expect(r.status).toBe(200);
    expect(r.body.setterId).toBe('s_a');
    const ids = r.body.sessions.map((s) => s.id);
    expect(ids).not.toContain('dsess_b_1');
    // Orden descendente: cada startedAt >= al siguiente.
    for (let i = 1; i < r.body.sessions.length; i++) {
      expect(new Date(r.body.sessions[i - 1].startedAt).getTime()).toBeGreaterThanOrEqual(new Date(r.body.sessions[i].startedAt).getTime());
    }
    const today = r.body.sessions.find((s) => s.id === 'dsess_a_today');
    expect(today.counters).toEqual(counters(5));
  });

  it('la de hoy contra la de ayer: las dos vienen, se distinguen por startedAt, total las cuenta a las dos', async () => {
    const r = await getHistory(cookieA);
    expect(r.status).toBe(200);
    const today = r.body.sessions.find((s) => s.id === 'dsess_a_today');
    const yesterday = r.body.sessions.find((s) => s.id === 'dsess_a_yesterday');
    expect(today).toBeTruthy();
    expect(yesterday).toBeTruthy();
    expect(new Date(today.startedAt).getTime()).toBeGreaterThan(new Date(yesterday.startedAt).getTime());
    expect(r.body.total).toBeGreaterThanOrEqual(2);
  });

  it('limit=1 devuelve 1, total sigue reflejando cuántas había', async () => {
    const full = await getHistory(cookieA);
    const r = await getHistory(cookieA, '?limit=1');
    expect(r.status).toBe(200);
    expect(r.body.sessions.length).toBe(1);
    expect(r.body.total).toBe(full.body.total);
  });

  it('limit=999999 se clampea a 100', async () => {
    const seeded = [];
    for (let i = 0; i < 105; i++) {
      seeded.push({
        id: `dsess_clamp_${i}`, setterId: 's_clamp', by: 'u_clamp',
        startedAt: new Date(todayNoon - i * 60000).toISOString(),
        endedAt: new Date(todayNoon - i * 60000 + 1000).toISOString(),
        durationS: 60, counters: counters(1),
      });
    }
    seedSessions(seeded);
    const r = await getHistory(cookieClamp, '?limit=999999');
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(105);
    expect(r.body.sessions.length).toBe(100);
  });

  it('la sesión de ruido (0 marcadas, 30s) NO aparece por defecto y SÍ con all=1', async () => {
    const withoutNoise = await getHistory(cookieA);
    expect(withoutNoise.body.sessions.some((s) => s.id === 'dsess_a_noise')).toBe(false);

    const withNoise = await getHistory(cookieA, '?all=1');
    expect(withNoise.body.sessions.some((s) => s.id === 'dsess_a_noise')).toBe(true);
    // El total con all=1 también sube (el filtro es de presentación, no de borrado).
    expect(withNoise.body.total).toBeGreaterThan(withoutNoise.body.total);
  });

  it('0 marcadas pero >= 120s de duración NO es ruido: aparece igual por defecto', async () => {
    const r = await getHistory(cookieA);
    expect(r.body.sessions.some((s) => s.id === 'dsess_a_longzero')).toBe(true);
  });

  it('una sesión ABIERTA aparece con endedAt: null (se ve que hay una en curso)', async () => {
    const r = await getHistory(cookieA);
    const open = r.body.sessions.find((s) => s.id === 'dsess_a_open');
    expect(open).toBeTruthy();
    expect(open.endedAt).toBeNull();
  });

  it('un setter mandando ?setter=s_b sigue recibiendo las suyas (nunca las de s_b)', async () => {
    const r = await getHistory(cookieA, '?setter=s_b');
    expect(r.status).toBe(200);
    expect(r.body.setterId).toBe('s_a');
    expect(r.body.sessions.some((s) => s.setterId === 's_b')).toBe(false);
  });

  it('admin con ?setter=s_b recibe las de s_b', async () => {
    const r = await getHistory(cookieAdmin, '?setter=s_b');
    expect(r.status).toBe(200);
    expect(r.body.setterId).toBe('s_b');
    expect(r.body.sessions.length).toBeGreaterThan(0);
    expect(r.body.sessions.every((s) => s.setterId === 's_b')).toBe(true);
  });

  it('supervisor scoped (ve solo s_a) con ?setter=s_b → 403', async () => {
    const r = await getHistory(cookieSup, '?setter=s_b');
    expect(r.status).toBe(403);
  });

  it('supervisor scoped sin ?setter= → solo sesiones de s_a, ninguna de s_b', async () => {
    const r = await getHistory(cookieSup);
    expect(r.status).toBe(200);
    expect(r.body.sessions.length).toBeGreaterThan(0);
    expect(r.body.sessions.every((s) => s.setterId === 's_a')).toBe(true);
  });

  it('sin auth → 401/403', async () => {
    const r = await request(app).get('/api/setters/dial-sessions');
    expect([401, 403]).toContain(r.status);
  });

  it('la respuesta NO trae ninguna clave de totales por día', async () => {
    const r = await getHistory(cookieA);
    expect(r.status).toBe(200);
    expect(r.body.totals).toBeUndefined();
    expect(r.body.byDay).toBeUndefined();
    expect(r.body.hoy).toBeUndefined();
  });
});

describe('PATCH /api/setters/dial-sessions/:id — estado del que marcó (SES-04)', () => {
  let target = null;

  beforeAll(async () => {
    const r = await openSession(cookieA, { mode: 'calls', queueSize: 1 });
    expect(r.status).toBe(200);
    target = r.body.session;
  });

  it('cada mood de la whitelist → 200, session.mood guardado, moodAt ISO', async () => {
    for (const mood of DS.DIAL_SESSION_MOODS) {
      const r = await patchMood(cookieA, target.id, { mood });
      expect(r.status).toBe(200);
      expect(r.body.session.mood).toBe(mood);
      expect(new Date(r.body.session.moodAt).toString()).not.toBe('Invalid Date');
    }
  });

  it("mood 'buenisimo' (inventado) → 400, la sesión no cambia", async () => {
    const beforeMood = readSettersFile().dialSessions.find((s) => s.id === target.id).mood;
    const r = await patchMood(cookieA, target.id, { mood: 'buenisimo' });
    expect(r.status).toBe(400);
    const afterMood = readSettersFile().dialSessions.find((s) => s.id === target.id).mood;
    expect(afterMood).toBe(beforeMood);
  });

  it('mood numérico → 400, sesión intacta', async () => {
    const r = await patchMood(cookieA, target.id, { mood: 42 });
    expect(r.status).toBe(400);
  });

  it("mood '' borra el valor", async () => {
    await patchMood(cookieA, target.id, { mood: 'bien' });
    const r = await patchMood(cookieA, target.id, { mood: '' });
    expect(r.status).toBe(200);
    expect(r.body.session.mood).toBe('');
    expect(r.body.session.moodAt).toBe('');
  });

  it('PATCH sobre la sesión de otro SDR → 404, la sesión ajena intacta', async () => {
    const before = readSettersFile().dialSessions.find((s) => s.id === 'dsess_b_1');
    const r = await patchMood(cookieA, 'dsess_b_1', { mood: 'costo' });
    expect(r.status).toBe(404);
    const after = readSettersFile().dialSessions.find((s) => s.id === 'dsess_b_1');
    expect(after).toEqual(before);
  });

  it('PATCH sobre una sesión ABIERTA → 200 (el estado no depende del cierre)', async () => {
    // `target` (abierta en el beforeAll de este describe, nunca cerrada acá)
    // sigue abierta: no reusar 'dsess_a_open' — abrirla la auto-cerró (T-37-01,
    // toda apertura nueva de ese setter cierra sus huérfanas).
    expect(target.endedAt).toBeNull();
    const r = await patchMood(cookieA, target.id, { mood: 'pesimo' });
    expect(r.status).toBe(200);
    expect(r.body.session.mood).toBe('pesimo');
    expect(r.body.session.endedAt).toBeNull();
  });

  it('el mood viaja en el GET (si no, sería write-only)', async () => {
    await patchMood(cookieA, target.id, { mood: 'normal' });
    const r = await getHistory(cookieA, '?all=1');
    const found = r.body.sessions.find((s) => s.id === target.id);
    expect(found.mood).toBe('normal');
  });

  it(':id inexistente → 404', async () => {
    const r = await patchMood(cookieA, 'dsess_no_existe', { mood: 'bien' });
    expect(r.status).toBe(404);
  });

  it('sin auth → 401/403', async () => {
    const r = await request(app).patch(`/api/setters/dial-sessions/${target.id}`).send({ mood: 'bien' });
    expect([401, 403]).toContain(r.status);
  });
});

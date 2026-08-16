// Fase 34-01 (HOY-04/HOY-05): dos cambios de backend, condición necesaria
// para que Hoy (34-02/34-03) pueda reordenar en el frontend:
//
// 1. GET /api/setters/leads/sin-wsp devuelve l.nextAction RESUELTO (vía
//    _leadNextAction), no el crudo — un lead legacy sin migrar (nextAction:
//    null en disco pero derivable de callbackAt/followUps) responde igual
//    que uno ya migrado.
// 2. POST /api/setters/hoy-hygiene-snapshot persiste los 2 números del panel
//    de higiene (vencidos, redSeguridad) dentro de setters.json, sin archivo
//    nuevo, y devuelve el de ayer + la tendencia (D-12/D-13).
import { describe, it, beforeAll, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import request from 'supertest';

const tmpData = path.join(os.tmpdir(), `hoy-hygiene-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = 'admin-hh@local.test';
process.env.ADMIN_PASSWORD = 'hhpass1234';
process.env.JWT_SECRET = 'test-secret-hoy-hygiene-1234567890';
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
    { id: 'u_admin', email: 'admin-hh@local.test', name: 'AdminHH', role: 'admin', status: 'active', setterId: '', password: pwd('hhpass1234') },
    { id: 'u_a', email: 'a-hh@local.test', name: 'SdrA', role: 'setter', status: 'active', setterId: 's_a', password: pwd('apass123456') },
    // Cuenta setter mal configurada: sin setterId vinculado.
    { id: 'u_broken', email: 'broken-hh@local.test', name: 'SdrBroken', role: 'setter', status: 'active', setterId: '', password: pwd('brokenpass123456') },
    // Supervisor scoped: solo ve a s_a.
    { id: 'u_sup', email: 'sup-hh@local.test', name: 'SupHH', role: 'supervisor', status: 'active', setterId: '', visibleSetterIds: ['s_a'], password: pwd('suppass123456') },
    { id: 'u_up', email: 'up-hh@local.test', name: 'SdrUp', role: 'setter', status: 'active', setterId: 's_up', password: pwd('uppass123456') },
    { id: 'u_grow', email: 'grow-hh@local.test', name: 'SdrGrow', role: 'setter', status: 'active', setterId: 's_grow', password: pwd('growpass123456') },
    { id: 'u_shrink', email: 'shrink-hh@local.test', name: 'SdrShrink', role: 'setter', status: 'active', setterId: 's_shrink', password: pwd('shrinkpass123456') },
    { id: 'u_flat', email: 'flat-hh@local.test', name: 'SdrFlat', role: 'setter', status: 'active', setterId: 's_flat', password: pwd('flatpass123456') },
    { id: 'u_coerce', email: 'coerce-hh@local.test', name: 'SdrCoerce', role: 'setter', status: 'active', setterId: 's_coerce', password: pwd('coercepass123456') },
    { id: 'u_prune', email: 'prune-hh@local.test', name: 'SdrPrune', role: 'setter', status: 'active', setterId: 's_prune', password: pwd('prunepass123456') },
  ], invites: [], sessions: [],
}, null, 2));

const lead = (n, extra = {}) => ({
  num: n, name: 'L' + n, phone: '+521555000' + String(n).padStart(3, '0'),
  assignedTo: 's_a', conexion: 'sin_wsp', estado: 'sin_contactar', ...extra,
});

fs.writeFileSync(path.join(tmpData, 'setters.json'), JSON.stringify({
  setters: [
    { id: 's_a', name: 'A' }, { id: 's_up', name: 'Up' }, { id: 's_grow', name: 'Grow' },
    { id: 's_shrink', name: 'Shrink' }, { id: 's_flat', name: 'Flat' }, { id: 's_coerce', name: 'Coerce' },
    { id: 's_prune', name: 'Prune' },
  ],
  variants: [],
  leads: {
    // Legacy: callbackAt seteado, SIN migrar (nextAction:null), último
    // callLog outcome 'callback_later' → derivado debe ser origen 'manual'.
    l_legacy: lead(1, {
      callbackAt: '2026-09-01T10:00:00.000Z',
      nextAction: null,
      callLog: [{ ts: '2026-08-10T10:00:00.000Z', outcome: 'callback_later', by: 'u_a' }],
    }),
    // Ya migrado: nextAction explícito en disco.
    l_migrated: lead(2, {
      callbackAt: '2026-09-05T15:30:00.000Z',
      nextAction: {
        tipo: 'callback', dueAt: '2026-09-05T15:30:00.000Z', canal: 'llamada',
        motivo: 'texto de prueba', origen: 'manual',
        createdAt: '2026-08-10T10:00:00.000Z', createdBy: 'u_a',
      },
    }),
    // Sin nada derivable: nextAction debe quedar null.
    l_none: lead(3, { callbackAt: '', nextAction: null }),
  },
  calendar: [], sessions: [],
}, null, 2));

const { app } = await import('../index.js');
const M = globalThis.__metricsAudit;

async function login(email, password) {
  const r = await request(app).post('/api/auth/login').send({ email, password });
  const c = (r.headers['set-cookie'] || []).find((x) => x.startsWith('gs_session='));
  if (!c) throw new Error(`login falló para ${email}: ${r.status} ${JSON.stringify(r.body)}`);
  return c.split(';')[0];
}

let adminCookie = '', setterACookie = '', brokenCookie = '', supCookie = '';
let upCookie = '', growCookie = '', shrinkCookie = '', flatCookie = '', coerceCookie = '', pruneCookie = '';

const SETTERS_FILE = path.join(tmpData, 'setters.json');
function readSettersFile() { return JSON.parse(fs.readFileSync(SETTERS_FILE, 'utf8')); }
function writeSettersFile(sd) { fs.writeFileSync(SETTERS_FILE, JSON.stringify(sd, null, 2)); }

// Siembra el bucket de AYER (día de negocio) para un scope, directo en disco
// — el endpoint solo puede sembrar "hoy" vía POST, así que la única forma de
// tener un "ayer" determinístico es escribirlo nosotros.
function seedYesterday(scope, vencidos, redSeguridad) {
  const sd = readSettersFile();
  if (!sd.hoyHygieneSnapshots || typeof sd.hoyHygieneSnapshots !== 'object') sd.hoyHygieneSnapshots = {};
  if (!sd.hoyHygieneSnapshots[scope]) sd.hoyHygieneSnapshots[scope] = {};
  const yStr = M._bizDayStr(M._bizStartOfDay(Date.now()) - 1);
  sd.hoyHygieneSnapshots[scope][yStr] = { vencidos, redSeguridad, updatedAt: new Date(Date.now() - 86400000).toISOString() };
  writeSettersFile(sd);
}

// Siembra `n` fechas PASADAS (2 a n+1 días atrás — nunca hoy ni ayer, para no
// chocar con lo que el POST de la prueba va a escribir) para el test de poda.
function seedManyDays(scope, n) {
  const sd = readSettersFile();
  if (!sd.hoyHygieneSnapshots || typeof sd.hoyHygieneSnapshots !== 'object') sd.hoyHygieneSnapshots = {};
  const base = M._bizStartOfDay(Date.now());
  const bucket = {};
  for (let i = 2; i <= n + 1; i++) {
    const ts = base - i * 86400000;
    bucket[M._bizDayStr(ts)] = { vencidos: i, redSeguridad: 0, updatedAt: new Date(ts).toISOString() };
  }
  sd.hoyHygieneSnapshots[scope] = bucket;
  writeSettersFile(sd);
}

beforeAll(async () => {
  adminCookie = await login('admin-hh@local.test', 'hhpass1234');
  setterACookie = await login('a-hh@local.test', 'apass123456');
  brokenCookie = await login('broken-hh@local.test', 'brokenpass123456');
  supCookie = await login('sup-hh@local.test', 'suppass123456');
  upCookie = await login('up-hh@local.test', 'uppass123456');
  growCookie = await login('grow-hh@local.test', 'growpass123456');
  shrinkCookie = await login('shrink-hh@local.test', 'shrinkpass123456');
  flatCookie = await login('flat-hh@local.test', 'flatpass123456');
  coerceCookie = await login('coerce-hh@local.test', 'coercepass123456');
  pruneCookie = await login('prune-hh@local.test', 'prunepass123456');
});

describe('l.nextAction resuelto en GET /api/setters/leads/sin-wsp', () => {
  it('lead legacy con callbackAt y último callLog callback_later → nextAction derivado, origen manual', async () => {
    const r = await request(app).get('/api/setters/leads/sin-wsp').set('Cookie', adminCookie);
    expect(r.status).toBe(200);
    const l = r.body.leads.find((x) => x.id === 'l_legacy');
    expect(l).toBeTruthy();
    expect(l.nextAction).not.toBeNull();
    expect(l.nextAction.dueAt).toBe('2026-09-01T10:00:00.000Z');
    expect(l.nextAction.origen).toBe('manual');
  });

  it('lead ya migrado (nextAction explícito) responde con el mismo contenido, byte a byte', async () => {
    const r = await request(app).get('/api/setters/leads/sin-wsp').set('Cookie', adminCookie);
    const l = r.body.leads.find((x) => x.id === 'l_migrated');
    expect(l).toBeTruthy();
    expect(l.nextAction).toEqual({
      tipo: 'callback', dueAt: '2026-09-05T15:30:00.000Z', canal: 'llamada',
      motivo: 'texto de prueba', origen: 'manual',
      createdAt: '2026-08-10T10:00:00.000Z', createdBy: 'u_a',
    });
  });

  it('lead sin callbackAt ni followUps activo → nextAction null (caso ya cubierto por next-action-model, replicado acá)', async () => {
    const r = await request(app).get('/api/setters/leads/sin-wsp').set('Cookie', adminCookie);
    const l = r.body.leads.find((x) => x.id === 'l_none');
    expect(l).toBeTruthy();
    expect(l.nextAction).toBeNull();
  });
});

describe('POST /api/setters/hoy-hygiene-snapshot', () => {
  it('un setter graba su propio snapshot (200)', async () => {
    const r = await request(app).post('/api/setters/hoy-hygiene-snapshot').set('Cookie', setterACookie)
      .send({ vencidos: 5, redSeguridad: 3 });
    expect(r.status).toBe(200);
    expect(r.body.scope).toBe('s_a');
    expect(r.body.today.vencidos).toBe(5);
    expect(r.body.today.redSeguridad).toBe(3);
  });

  it('setter sin setterId vinculado (cuenta mal configurada) → 403, no pisa el scope compartido \'\'', async () => {
    const r = await request(app).post('/api/setters/hoy-hygiene-snapshot').set('Cookie', brokenCookie)
      .send({ vencidos: 1, redSeguridad: 1 });
    expect(r.status).toBe(403);
    const sd = readSettersFile();
    expect(sd.hoyHygieneSnapshots && sd.hoyHygieneSnapshots['']).toBeFalsy();
  });

  it('sin auth → 401/403 (patrón estándar del proyecto)', async () => {
    const r = await request(app).post('/api/setters/hoy-hygiene-snapshot').send({ vencidos: 1, redSeguridad: 1 });
    expect([401, 403]).toContain(r.status);
  });

  it('primera vez del día para un scope nuevo → yesterday null, trend sin_dato_previo', async () => {
    const r = await request(app).post('/api/setters/hoy-hygiene-snapshot').set('Cookie', upCookie)
      .send({ vencidos: 2, redSeguridad: 0 });
    expect(r.status).toBe(200);
    expect(r.body.yesterday).toBeNull();
    expect(r.body.trend).toBe('sin_dato_previo');
  });

  it('segunda llamada el MISMO día con número mayor → sigue sin_dato_previo, today se actualiza (upsert, no acumula)', async () => {
    const r = await request(app).post('/api/setters/hoy-hygiene-snapshot').set('Cookie', upCookie)
      .send({ vencidos: 9, redSeguridad: 4 });
    expect(r.status).toBe(200);
    expect(r.body.trend).toBe('sin_dato_previo');
    expect(r.body.today.vencidos).toBe(9);
    expect(r.body.today.redSeguridad).toBe(4);
  });

  it('un setter no puede mandar {setter: otro} para escribir en el scope de otro — se ignora, escribe en el suyo', async () => {
    const before = readSettersFile();
    const upBefore = before.hoyHygieneSnapshots?.s_up || {};
    const r = await request(app).post('/api/setters/hoy-hygiene-snapshot').set('Cookie', setterACookie)
      .send({ vencidos: 1, redSeguridad: 1, setter: 's_up' });
    expect(r.status).toBe(200);
    expect(r.body.scope).toBe('s_a');
    const after = readSettersFile();
    // El bucket de s_up (dueño real: SdrUp) queda intacto.
    expect(after.hoyHygieneSnapshots.s_up).toEqual(upBefore);
  });

  it('vencidos negativo se coerciona a 0, nunca 400', async () => {
    const r = await request(app).post('/api/setters/hoy-hygiene-snapshot').set('Cookie', coerceCookie)
      .send({ vencidos: -5, redSeguridad: 2 });
    expect(r.status).toBe(200);
    expect(r.body.today.vencidos).toBe(0);
    expect(r.body.today.redSeguridad).toBe(2);
  });

  it('vencidos no-numérico se coerciona a 0, nunca 400', async () => {
    const r = await request(app).post('/api/setters/hoy-hygiene-snapshot').set('Cookie', coerceCookie)
      .send({ vencidos: 'texto', redSeguridad: 2 });
    expect(r.status).toBe(200);
    expect(r.body.today.vencidos).toBe(0);
  });

  it('con bucket de ayer sembrado, vencidos de hoy MAYOR que ayer → trend creciendo', async () => {
    seedYesterday('s_grow', 3, 1);
    const r = await request(app).post('/api/setters/hoy-hygiene-snapshot').set('Cookie', growCookie)
      .send({ vencidos: 10, redSeguridad: 1 });
    expect(r.status).toBe(200);
    expect(r.body.yesterday).toEqual({ vencidos: 3, redSeguridad: 1, date: M._bizDayStr(M._bizStartOfDay(Date.now()) - 1) });
    expect(r.body.trend).toBe('creciendo');
  });

  it('con bucket de ayer sembrado, vencidos de hoy MENOR que ayer → trend bajando', async () => {
    seedYesterday('s_shrink', 10, 1);
    const r = await request(app).post('/api/setters/hoy-hygiene-snapshot').set('Cookie', shrinkCookie)
      .send({ vencidos: 2, redSeguridad: 1 });
    expect(r.status).toBe(200);
    expect(r.body.trend).toBe('bajando');
  });

  it('con bucket de ayer sembrado, vencidos de hoy IGUAL a ayer → trend estable', async () => {
    seedYesterday('s_flat', 7, 2);
    const r = await request(app).post('/api/setters/hoy-hygiene-snapshot').set('Cookie', flatCookie)
      .send({ vencidos: 7, redSeguridad: 9 });
    expect(r.status).toBe(200);
    expect(r.body.trend).toBe('estable');
  });

  it('poda a 14 días: sembrar 20 fechas + 1 POST de hoy → el bucket queda con máximo 14 claves', async () => {
    seedManyDays('s_prune', 20);
    const r = await request(app).post('/api/setters/hoy-hygiene-snapshot').set('Cookie', pruneCookie)
      .send({ vencidos: 100, redSeguridad: 1 });
    expect(r.status).toBe(200);
    const sd = readSettersFile();
    const keys = Object.keys(sd.hoyHygieneSnapshots.s_prune || {});
    expect(keys.length).toBeLessThanOrEqual(14);
    // El de hoy (recién escrito) sobrevive a la poda — nunca se pierde el dato fresco.
    expect(sd.hoyHygieneSnapshots.s_prune[r.body.date]).toBeTruthy();
  });

  it('RBAC de scope: supervisor scoped mandando un setter fuera de su visibilidad → 403', async () => {
    const r = await request(app).post('/api/setters/hoy-hygiene-snapshot').set('Cookie', supCookie)
      .send({ setter: 's_grow', vencidos: 1, redSeguridad: 1 }); // s_grow no está en visibleSetterIds:['s_a']
    expect(r.status).toBe(403);
  });
});

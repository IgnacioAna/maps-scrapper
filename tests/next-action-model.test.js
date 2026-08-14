// Modelo nextAction — el reloj único de próxima acción (Phase 29, plan 29-01).
// Cubre: whitelists con coerción defensiva, espejo dueAt<->callbackAt (D-03),
// y la derivación legacy que va a usar tanto las lecturas (leads sin migrar)
// como el endpoint de migración del plan 29-04.
import { describe, it, beforeAll, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import request from 'supertest';

const tmpData = path.join(os.tmpdir(), `next-action-model-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = 'admin-nam@local.test';
process.env.ADMIN_PASSWORD = 'nampass1234';
process.env.JWT_SECRET = 'test-secret-next-action-model-1234567890';
// Regla #121: NUNCA `delete` — dotenv re-carga el .env y repone las borradas.
process.env.OPENAI_API_KEY = '';
process.env.MERCURY_API_KEY = '';
process.env.QWEN_API_KEY = '';

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: crypto.scryptSync(plain, salt, 64).toString('hex') };
}
fs.writeFileSync(path.join(tmpData, 'auth.json'), JSON.stringify({
  users: [{ id: 'u', email: 'admin-nam@local.test', name: 'AdminNAM', role: 'admin', status: 'active', setterId: '', password: pwd('nampass1234') }],
  invites: [], sessions: [],
}, null, 2));
// Regla #163: teléfonos de fixture con >= 7 dígitos, prefijo +521, o
// GET /leads/sin-wsp los descarta silenciosamente por "sin número".
const lead = (n) => ({ num: n, name: 'L' + n, phone: '+521555000000' + n, assignedTo: 's_x', conexion: 'sin_wsp', estado: 'sin_contactar' });
fs.writeFileSync(path.join(tmpData, 'setters.json'), JSON.stringify({
  setters: [{ id: 's_x', name: 'X' }], variants: [],
  leads: { l1: lead(1) },
  calendar: [], sessions: [],
}, null, 2));

const { app } = await import('../index.js');
const va = globalThis.__voiceAgent;

let cookie = '';
beforeAll(async () => {
  const r = await request(app).post('/api/auth/login').send({ email: 'admin-nam@local.test', password: 'nampass1234' });
  cookie = r.headers['set-cookie'];
});

// Fixture base de lead en memoria — no toca disco. Suficiente para los tests
// puros de helpers (que operan sobre el objeto JS, no sobre setters.json).
function freshLead(overrides = {}) {
  return {
    id: 'lx', name: 'Fixture', phone: '+5215550000001',
    callLog: [], followUps: { '24hs': false, '48hs': false, '72hs': false, '7d': false, '15d': false },
    followUpStartedAt: null, callbackAt: '', nextAction: null,
    ...overrides,
  };
}

describe('_setNextAction — whitelists y coerción defensiva', () => {
  it('tipo/canal/origen inválidos coercionan a otro/\'\'/manual y NO lanza', () => {
    const l = freshLead();
    let thrown = null;
    let result;
    try {
      result = va._setNextAction(l, { tipo: 'no-existe', canal: 'fax', origen: 'ajeno', dueAt: '2026-09-01T10:00:00.000Z' }, '2026-08-14T00:00:00.000Z');
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeNull();
    expect(result.tipo).toBe('otro');
    expect(result.canal).toBe('');
    expect(result.origen).toBe('manual');
  });

  it('motivo y createdBy se recortan a 200/80 chars', () => {
    const l = freshLead();
    const motivoLargo = 'x'.repeat(500);
    const createdByLargo = 'y'.repeat(500);
    const result = va._setNextAction(l, { tipo: 'callback', dueAt: '2026-09-01T10:00:00.000Z', motivo: motivoLargo, createdBy: createdByLargo });
    expect(result.motivo.length).toBe(200);
    expect(result.createdBy.length).toBe(80);
  });

  it('dueAt vacío o no-string deja nextAction=null y callbackAt=\'\'', () => {
    const l1 = freshLead({ callbackAt: 'algo-viejo', nextAction: { tipo: 'callback', dueAt: 'algo-viejo' } });
    const r1 = va._setNextAction(l1, { tipo: 'callback', dueAt: '' });
    expect(r1).toBeNull();
    expect(l1.nextAction).toBeNull();
    expect(l1.callbackAt).toBe('');

    const l2 = freshLead({ callbackAt: 'algo-viejo', nextAction: { tipo: 'callback', dueAt: 'algo-viejo' } });
    const r2 = va._setNextAction(l2, { tipo: 'callback', dueAt: 12345 });
    expect(r2).toBeNull();
    expect(l2.nextAction).toBeNull();
    expect(l2.callbackAt).toBe('');
  });

  it('tras _setNextAction, lead.callbackAt === lead.nextAction.dueAt (string idéntico, sin normalizar)', () => {
    const l = freshLead();
    const dueAt = '2026-09-01T10:00:00.123Z'; // milisegundos no-redondos a propósito
    va._setNextAction(l, { tipo: 'callback', canal: 'llamada', origen: 'manual', dueAt });
    expect(l.callbackAt).toBe(l.nextAction.dueAt);
    expect(l.callbackAt).toBe(dueAt); // byte-idéntico, no re-parseado
  });

  it('createdAt usa nowIso si vino, si no new Date().toISOString()', () => {
    const l = freshLead();
    const nowIso = '2026-08-14T12:00:00.000Z';
    const result = va._setNextAction(l, { tipo: 'callback', dueAt: '2026-09-01T10:00:00.000Z' }, nowIso);
    expect(result.createdAt).toBe(nowIso);

    const l2 = freshLead();
    const before = Date.now();
    const result2 = va._setNextAction(l2, { tipo: 'callback', dueAt: '2026-09-01T10:00:00.000Z' });
    const createdAtTs = new Date(result2.createdAt).getTime();
    expect(createdAtTs).toBeGreaterThanOrEqual(before);
  });
});

describe('_clearNextAction', () => {
  it('deja los dos campos apagados a la vez', () => {
    const l = freshLead({ callbackAt: '2026-09-01T10:00:00.000Z', nextAction: { tipo: 'callback', dueAt: '2026-09-01T10:00:00.000Z' } });
    va._clearNextAction(l);
    expect(l.nextAction).toBeNull();
    expect(l.callbackAt).toBe('');
  });
});

describe('_deriveNextActionFromLegacy — PURA, no muta', () => {
  it('no muta el lead que recibe', () => {
    const l = freshLead({
      callbackAt: '2026-09-01T10:00:00.000Z',
      callLog: [{ ts: '2026-08-10T10:00:00.000Z', outcome: 'callback_later' }],
    });
    const clone = structuredClone(l);
    va._deriveNextActionFromLegacy(l);
    expect(l).toEqual(clone);
  });

  it('callbackAt + último callLog callback_later → origen:manual, tipo:callback', () => {
    const l = freshLead({
      callbackAt: '2026-09-01T10:00:00.000Z',
      callLog: [
        { ts: '2026-08-01T10:00:00.000Z', outcome: 'no_answer' },
        { ts: '2026-08-10T10:00:00.000Z', outcome: 'callback_later' },
      ],
    });
    const r = va._deriveNextActionFromLegacy(l);
    expect(r.origen).toBe('manual');
    expect(r.tipo).toBe('callback');
    expect(r.dueAt).toBe('2026-09-01T10:00:00.000Z');
    expect(r.createdAt).toBe('2026-08-10T10:00:00.000Z');
  });

  it('callbackAt + último callLog no_answer → origen:cadencia, tipo:cadencia', () => {
    const l = freshLead({
      callbackAt: '2026-09-01T10:00:00.000Z',
      callLog: [{ ts: '2026-08-10T10:00:00.000Z', outcome: 'no_answer' }],
    });
    const r = va._deriveNextActionFromLegacy(l);
    expect(r.origen).toBe('cadencia');
    expect(r.tipo).toBe('cadencia');
  });

  it('callbackAt + último callLog con outcome que no es ninguno de esos → origen:cadencia (D-09)', () => {
    const l = freshLead({
      callbackAt: '2026-09-01T10:00:00.000Z',
      callLog: [{ ts: '2026-08-10T10:00:00.000Z', outcome: 'hung_up' }],
    });
    const r = va._deriveNextActionFromLegacy(l);
    expect(r.origen).toBe('cadencia');
    expect(r.tipo).toBe('cadencia');
  });

  it('callbackAt Y followUps activo a la vez → gana callbackAt (la fecha visible no se mueve)', () => {
    const l = freshLead({
      callbackAt: '2026-09-01T10:00:00.000Z',
      followUps: { '24hs': false, '48hs': false, '72hs': true, '7d': false, '15d': false },
      followUpStartedAt: '2026-08-01T00:00:00.000Z',
      callLog: [{ ts: '2026-08-10T10:00:00.000Z', outcome: 'callback_later' }],
    });
    const r = va._deriveNextActionFromLegacy(l);
    expect(r.dueAt).toBe('2026-09-01T10:00:00.000Z'); // el callbackAt, NO started+72h
    expect(r.tipo).toBe('callback');
  });

  it('SIN callbackAt, con followUps[72hs] + followUpStartedAt → dueAt=started+72h, origen:manual, y _nextActionTemplateForDelta recupera la plantilla 72hs', () => {
    const started = '2026-08-01T00:00:00.000Z';
    const l = freshLead({
      callbackAt: '',
      followUps: { '24hs': false, '48hs': false, '72hs': true, '7d': false, '15d': false },
      followUpStartedAt: started,
    });
    const r = va._deriveNextActionFromLegacy(l);
    expect(r).not.toBeNull();
    expect(r.origen).toBe('manual');
    expect(r.tipo).toBe('callback');
    const expectedDueMs = new Date(started).getTime() + 72 * 60 * 60 * 1000;
    expect(new Date(r.dueAt).getTime()).toBe(expectedDueMs);
    const deltaMs = new Date(r.dueAt).getTime() - new Date(r.createdAt).getTime();
    const tpl = va._nextActionTemplateForDelta(deltaMs);
    expect(tpl).not.toBeNull();
    expect(tpl.key).toBe('72hs');
  });

  it('lead sin nada (sin callbackAt, sin followUps activo) → null', () => {
    const l = freshLead();
    expect(va._deriveNextActionFromLegacy(l)).toBeNull();
  });

  it('followUps activo pero SIN base (followUpStartedAt ni lastContactAt) → null', () => {
    const l = freshLead({
      followUps: { '24hs': false, '48hs': false, '72hs': true, '7d': false, '15d': false },
      followUpStartedAt: null,
    });
    expect(va._deriveNextActionFromLegacy(l)).toBeNull();
  });
});

describe('_leadNextAction — único lector', () => {
  it('devuelve el nextAction explícito cuando existe', () => {
    const explicit = { tipo: 'callback', dueAt: '2026-09-01T10:00:00.000Z', canal: 'llamada', motivo: '', origen: 'manual', createdAt: '', createdBy: '' };
    const l = freshLead({ nextAction: explicit, callbackAt: '2026-09-01T10:00:00.000Z' });
    expect(va._leadNextAction(l)).toBe(explicit); // misma referencia, no re-derivado
  });

  it('devuelve la derivación cuando nextAction es null', () => {
    const l = freshLead({
      nextAction: null,
      callbackAt: '2026-09-01T10:00:00.000Z',
      callLog: [{ ts: '2026-08-10T10:00:00.000Z', outcome: 'callback_later' }],
    });
    const r = va._leadNextAction(l);
    expect(r).not.toBeNull();
    expect(r.dueAt).toBe('2026-09-01T10:00:00.000Z');
    expect(r.origen).toBe('manual');
  });
});

describe('Superficie de la API — sin migración previa', () => {
  it('GET /api/setters/leads/sin-wsp trae nextAction (null por default) en cada lead', async () => {
    const r = await request(app).get('/api/setters/leads/sin-wsp').set('Cookie', cookie);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.leads)).toBe(true);
    expect(r.body.leads.length).toBeGreaterThan(0);
    const l1 = r.body.leads.find((l) => l.id === 'l1');
    expect(l1).toBeTruthy();
    expect(l1.nextAction).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Verificación por mutación (documentada también en 29-01-SUMMARY.md):
// revertir el espejo dentro de _setNextAction (no asignar lead.callbackAt)
// hizo fallar el test "tras _setNextAction, lead.callbackAt ===
// lead.nextAction.dueAt" de arriba; revertir la prioridad callbackAt >
// followUps en _deriveNextActionFromLegacy hizo fallar el test "callbackAt Y
// followUps activo a la vez → gana callbackAt" de arriba. Código restaurado
// después de confirmar el fallo en ambos casos — no queda ninguna mutación
// viva en index.js.
// ─────────────────────────────────────────────────────────────────────────

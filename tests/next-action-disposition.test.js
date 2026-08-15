// Phase 29 Plan 02 (Task 3) — Comportamiento del reloj único (nextAction) en
// las disposiciones. Cubre cadencia, callback manual, consumo del compromiso
// pendiente al re-discar (NEXT-04/D-08, el bug real del 2026-08-12), tope de
// cortes (#171), la excepción de interesados (#183), y la lectura sin
// migración de un lead legacy (D-09).
//
// Modelo: tests/call-cadence.test.js (fixture mínimo, helper disp/hoursFromNow)
// + tests/hangup-cap.test.js (fixture multi-lead, idioma de aserción del tope).

import { describe, it, beforeAll, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import request from 'supertest';

const tmpData = path.join(os.tmpdir(), `next-action-disp-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = 'admin-nad@local.test';
process.env.ADMIN_PASSWORD = 'nadpass1234';
process.env.JWT_SECRET = 'test-secret-next-action-disposition-1234567890';
// Regla #121: env vars de IA a "" (nunca delete — dotenv las repone y el
// test termina llamando a la IA real hasta hacer timeout).
process.env.OPENAI_API_KEY = '';
process.env.MERCURY_API_KEY = '';
process.env.QWEN_API_KEY = '';

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: crypto.scryptSync(plain, salt, 64).toString('hex') };
}
fs.writeFileSync(path.join(tmpData, 'auth.json'), JSON.stringify({
  users: [{ id: 'u', email: 'admin-nad@local.test', name: 'AdminNAD', role: 'admin', status: 'active', setterId: '', password: pwd('nadpass1234') }],
  invites: [], sessions: [],
}, null, 2));

// Teléfonos +521 (México, no bloqueado por _expensiveTariffLabel) con >= 7
// dígitos (regla #163) — si no, el lead nunca entra en las colas.
const lead = (n, extra = {}) => ({
  num: n, name: 'L' + n, phone: '+521555000' + String(n).padStart(4, '0'),
  assignedTo: 's_x', conexion: 'sin_wsp', estado: 'sin_contactar',
  ...extra,
});

// Lead legacy (D-09, "sin migración"): callbackAt manual + último callLog
// entry callback_later, ESCRITO A MANO — nunca pasó por _applyCallOutcome,
// no tiene nextAction. `by:''` cae al fallback de _callSetterId
// (lead.assignedTo), así que la atribución cierra sin necesitar mapear un
// user real en auth.json.
const legacyCallbackAt = new Date(Date.now() + 3 * 24 * 3600000).toISOString();

fs.writeFileSync(path.join(tmpData, 'setters.json'), JSON.stringify({
  setters: [{ id: 's_x', name: 'X' }], variants: [],
  leads: {
    l_cb_explicit: lead(1),
    l_cb_default: lead(2),
    l_na_once: lead(3),
    l_na_twice: lead(4),
    l_interesado: lead(5),
    l_consume_future: lead(6),
    l_consume_stale: lead(7),
    l_hangup_twice: lead(8),
    l_interested_terminal: lead(9),
    l_scheduled: lead(10),
    l_legacy: lead(11, {
      callbackAt: legacyCallbackAt,
      callLog: [{ ts: new Date().toISOString(), outcome: 'callback_later', by: '' }],
    }),
  },
  calendar: [], sessions: [],
}, null, 2));

const { app } = await import('../index.js');
let cookie = '';
const disp = (id, body) => request(app).post(`/api/setters/leads/${id}/call-disposition`).set('Cookie', cookie).send(body);
const hoursFromNow = (iso) => (new Date(iso).getTime() - Date.now()) / 3600000;

beforeAll(async () => {
  const r = await request(app).post('/api/auth/login').send({ email: 'admin-nad@local.test', password: 'nadpass1234' });
  cookie = (r.headers['set-cookie'] || []).find((c) => c.startsWith('gs_session=')).split(';')[0];
});

describe('nextAction — el reloj único en disposiciones (Phase 29-02)', () => {
  it('callback_later con fecha explícita → nextAction manual con esa fecha, espejado en callbackAt', async () => {
    const manual = new Date(Date.now() + 5 * 24 * 3600000).toISOString();
    const r = await disp('l_cb_explicit', { outcome: 'callback_later', callbackAt: manual });
    expect(r.status).toBe(200);
    const { nextAction, callbackAt } = r.body.lead;
    expect(nextAction).toBeTruthy();
    expect(nextAction.tipo).toBe('callback');
    expect(nextAction.origen).toBe('manual');
    expect(nextAction.dueAt).toBe(manual);
    expect(callbackAt).toBe(nextAction.dueAt); // espejo D-03
  });

  it('callback_later SIN fecha → default a +24h, origen manual', async () => {
    const r = await disp('l_cb_default', { outcome: 'callback_later' });
    const { nextAction, callbackAt } = r.body.lead;
    expect(nextAction.origen).toBe('manual');
    expect(nextAction.tipo).toBe('callback');
    expect(hoursFromNow(nextAction.dueAt)).toBeGreaterThan(23);
    expect(hoursFromNow(nextAction.dueAt)).toBeLessThan(25);
    expect(callbackAt).toBe(nextAction.dueAt);
  });

  it('1er no_answer → nextAction de cadencia a +24h, cadenceStep 1, no descartado', async () => {
    const r = await disp('l_na_once', { outcome: 'no_answer' });
    const { nextAction, callbackAt, cadenceStep, estado } = r.body.lead;
    expect(nextAction.tipo).toBe('cadencia');
    expect(nextAction.origen).toBe('cadencia');
    expect(hoursFromNow(nextAction.dueAt)).toBeGreaterThan(23);
    expect(hoursFromNow(nextAction.dueAt)).toBeLessThan(25);
    expect(callbackAt).toBe(nextAction.dueAt);
    expect(cadenceStep).toBe(1);
    expect(estado).not.toBe('descartado');
  });

  it('2do no_answer seguido → descartado, nextAction null, callbackAt vacío, cadenceExhausted', async () => {
    await disp('l_na_twice', { outcome: 'no_answer' });
    const r = await disp('l_na_twice', { outcome: 'no_answer' });
    const { nextAction, callbackAt, estado, cadenceExhausted } = r.body.lead;
    expect(estado).toBe('descartado');
    expect(nextAction).toBeNull();
    expect(callbackAt).toBeFalsy();
    expect(cadenceExhausted).toBe(true);
  });

  it('interesado con dos no-contactos seguidos → sigue interesado y CONSERVA nextAction de cadencia (#183)', async () => {
    await disp('l_interesado', { outcome: 'answered_interested' });
    await disp('l_interesado', { outcome: 'no_answer' });
    const r = await disp('l_interesado', { outcome: 'no_answer' });
    const { nextAction, callbackAt, estado } = r.body.lead;
    expect(estado).toBe('interesado');
    expect(nextAction).toBeTruthy();
    expect(nextAction.tipo).toBe('cadencia');
    expect(nextAction.origen).toBe('cadencia');
    expect(hoursFromNow(nextAction.dueAt)).toBeGreaterThan(23);
    expect(hoursFromNow(nextAction.dueAt)).toBeLessThan(25);
    expect(callbackAt).toBe(nextAction.dueAt);
  });

  it('consumo (NEXT-04): callback manual a futuro + wrong_number → nextAction null, callbackAt vacío', async () => {
    const manual = new Date(Date.now() + 5 * 24 * 3600000).toISOString();
    await disp('l_consume_future', { outcome: 'callback_later', callbackAt: manual });
    const r = await disp('l_consume_future', { outcome: 'wrong_number' });
    expect(r.body.lead.nextAction).toBeNull();
    expect(r.body.lead.callbackAt).toBeFalsy();
  });

  it('consumo con vencido: callback manual VENCIDO + hung_up (1er corte) → cadencia fresca +24h, NO el vencido (caso real 2026-08-12, default Phase 30)', async () => {
    // El caso real del 2026-08-12 era que el callback viejo quedaba
    // arrastrado para siempre (+60 de score, lead clavado 1° en Prioridad).
    // La Phase 29 lo consumía dejando nextAction null; la Phase 30 (D-02) va
    // un paso más allá: el 1er corte ya no deja el lead sin próximo paso —
    // programa una cadencia +24h que reemplaza al vencido.
    const stale = new Date(Date.now() - 18 * 24 * 3600000).toISOString();
    await disp('l_consume_stale', { outcome: 'callback_later', callbackAt: stale });
    const r = await disp('l_consume_stale', { outcome: 'hung_up' });
    expect(r.body.lead.estado).not.toBe('descartado'); // 1er corte, sigue vivo
    expect(r.body.lead.nextAction).toBeTruthy();
    expect(r.body.lead.nextAction.origen).toBe('cadencia');
    expect(hoursFromNow(r.body.lead.nextAction.dueAt)).toBeGreaterThan(23);
    expect(hoursFromNow(r.body.lead.nextAction.dueAt)).toBeLessThan(25);
    expect(new Date(r.body.lead.nextAction.dueAt).getTime()).toBeGreaterThan(Date.now());
    expect(r.body.lead.callbackAt).toBe(r.body.lead.nextAction.dueAt); // espejo D-03
  });

  it('2do hung_up → descartado, nextAction null', async () => {
    await disp('l_hangup_twice', { outcome: 'hung_up' });
    const r = await disp('l_hangup_twice', { outcome: 'hung_up' });
    expect(r.body.lead.estado).toBe('descartado');
    expect(r.body.lead.nextAction).toBeNull();
  });

  it('answered_interested → nextAction callback manual a +3 días (Phase 30/D-02: default de seguimiento del interesado)', async () => {
    const r = await disp('l_interested_terminal', { outcome: 'answered_interested' });
    expect(r.body.lead.estado).toBe('interesado');
    const { nextAction, callbackAt } = r.body.lead;
    expect(nextAction).toBeTruthy();
    expect(nextAction.tipo).toBe('callback');
    expect(nextAction.origen).toBe('manual');
    expect(hoursFromNow(nextAction.dueAt)).toBeGreaterThan(71);
    expect(hoursFromNow(nextAction.dueAt)).toBeLessThan(73);
    expect(callbackAt).toBe(nextAction.dueAt); // espejo D-03
  });

  it('scheduled_with_admin → nextAction null (terminal, sin cambios en Phase 30)', async () => {
    const fecha = new Date(Date.now() + 2 * 24 * 3600000).toISOString();
    const r = await disp('l_scheduled', { outcome: 'scheduled_with_admin', scheduled: { fecha, nombre: 'Dra. Test' } });
    expect(r.body.lead.estado).toBe('agendado');
    expect(r.body.lead.nextAction).toBeNull();
  });

  it('lead legacy con callbackAt y SIN nextAction responde con próximo paso derivado en GET sin-wsp (D-09, sin migración)', async () => {
    const r = await request(app).get('/api/setters/leads/sin-wsp').set('Cookie', cookie);
    expect(r.status).toBe(200);
    const l = (r.body.leads || []).find((x) => x.id === 'l_legacy');
    expect(l).toBeTruthy();
    expect(l.manualCallbackByOwner).toBe(true);
  });
});

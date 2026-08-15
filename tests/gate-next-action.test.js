// Phase 30 Plan 01 (Task 3) — cobertura del mapa D-02, la red de seguridad
// GATE-01 y el override de próximo paso sobre call-disposition.
//
// Setup calcado de tests/next-action-disposition.test.js (mismo idioma de
// fixture/disp/hoursFromNow) — ver ese archivo para el modelo completo del
// reloj único (nextAction/callbackAt) heredado de la Phase 29.

import { describe, it, beforeAll, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import request from 'supertest';

const tmpData = path.join(os.tmpdir(), `gate-next-action-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = 'admin-gate@local.test';
process.env.ADMIN_PASSWORD = 'gatepass1234';
process.env.JWT_SECRET = 'test-secret-gate-next-action-1234567890';
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
  users: [{ id: 'u', email: 'admin-gate@local.test', name: 'AdminGate', role: 'admin', status: 'active', setterId: '', password: pwd('gatepass1234') }],
  invites: [], sessions: [],
}, null, 2));

// Teléfonos +521 (México, no bloqueado por _expensiveTariffLabel) con >= 7
// dígitos (regla #163) — si no, el lead nunca entra en las colas.
const lead = (n) => ({
  num: n, name: 'L' + n, phone: '+521555000' + String(n).padStart(4, '0'),
  assignedTo: 's_x', conexion: 'sin_wsp', estado: 'sin_contactar',
});

fs.writeFileSync(path.join(tmpData, 'setters.json'), JSON.stringify({
  setters: [{ id: 's_x', name: 'X' }], variants: [],
  leads: {
    l_interesado: lead(1),
    l_hangup1: lead(2),
    l_hangup2: lead(3),
    l_not_interested: lead(4),
    l_wrong: lead(5),
    l_invalid: lead(6),
    l_scheduled: lead(7),
    l_dnc: lead(8),
    l_override_ok: lead(9),
    l_override_invalid: lead(10),
    l_override_terminal: lead(11),
    l_override_compromiso: lead(12),
    l_override_garbage: lead(13),
  },
  calendar: [], sessions: [],
}, null, 2));

const { app } = await import('../index.js');
const va = globalThis.__voiceAgent;
let cookie = '';
const disp = (id, body) => request(app).post(`/api/setters/leads/${id}/call-disposition`).set('Cookie', cookie).send(body);
const hoursFromNow = (iso) => (new Date(iso).getTime() - Date.now()) / 3600000;

beforeAll(async () => {
  const r = await request(app).post('/api/auth/login').send({ email: 'admin-gate@local.test', password: 'gatepass1234' });
  cookie = (r.headers['set-cookie'] || []).find((c) => c.startsWith('gs_session=')).split(';')[0];
});

describe('GATE — mapa D-02 (defaults por outcome)', () => {
  it('1. answered_interested → callback +3 días, origen manual, espejado en callbackAt', async () => {
    const r = await disp('l_interesado', { outcome: 'answered_interested' });
    expect(r.status).toBe(200);
    const { nextAction, callbackAt, estado } = r.body.lead;
    expect(estado).toBe('interesado');
    expect(nextAction).toBeTruthy();
    expect(nextAction.tipo).toBe('callback');
    expect(nextAction.origen).toBe('manual');
    expect(hoursFromNow(nextAction.dueAt)).toBeGreaterThan(71);
    expect(hoursFromNow(nextAction.dueAt)).toBeLessThan(73);
    expect(callbackAt).toBe(nextAction.dueAt);
  });

  it('2. hung_up 1er corte → cadencia +24h, sigue vivo', async () => {
    const r = await disp('l_hangup1', { outcome: 'hung_up' });
    expect(r.status).toBe(200);
    const { nextAction, estado } = r.body.lead;
    expect(estado).not.toBe('descartado');
    expect(nextAction).toBeTruthy();
    expect(nextAction.tipo).toBe('cadencia');
    expect(nextAction.origen).toBe('cadencia');
    expect(hoursFromNow(nextAction.dueAt)).toBeGreaterThan(23);
    expect(hoursFromNow(nextAction.dueAt)).toBeLessThan(25);
  });

  it('3. hung_up 2do corte → descartado, nextAction null, callbackAt vacío (el tope gana sobre el default D-02)', async () => {
    await disp('l_hangup2', { outcome: 'hung_up' });
    const r = await disp('l_hangup2', { outcome: 'hung_up' });
    expect(r.body.lead.estado).toBe('descartado');
    expect(r.body.lead.nextAction).toBeNull();
    expect(r.body.lead.callbackAt).toBeFalsy();
  });

  it('4. terminales (answered_not_interested, wrong_number, invalid_number, scheduled_with_admin) → nextAction null en los 4', async () => {
    const rNi = await disp('l_not_interested', { outcome: 'answered_not_interested', disqualifyReason: 'no_es_icp' });
    expect(rNi.body.lead.estado).toBe('descartado');
    expect(rNi.body.lead.nextAction).toBeNull();

    const rWrong = await disp('l_wrong', { outcome: 'wrong_number' });
    expect(rWrong.body.lead.estado).toBe('descartado');
    expect(rWrong.body.lead.nextAction).toBeNull();

    const rInvalid = await disp('l_invalid', { outcome: 'invalid_number' });
    expect(rInvalid.body.lead.estado).toBe('descartado');
    expect(rInvalid.body.lead.nextAction).toBeNull();

    const fecha = new Date(Date.now() + 2 * 24 * 3600000).toISOString();
    const rSched = await disp('l_scheduled', { outcome: 'scheduled_with_admin', scheduled: { fecha, nombre: 'Dra. Test' } });
    expect(rSched.body.lead.estado).toBe('agendado');
    expect(rSched.body.lead.nextAction).toBeNull();
  });

  it('5. DNC (answered_not_interested + no_contactar) → doNotCall, descartado, nextAction null', async () => {
    const r = await disp('l_dnc', { outcome: 'answered_not_interested', disqualifyReason: 'no_contactar' });
    expect(r.body.lead.doNotCall).toBe(true);
    expect(r.body.lead.estado).toBe('descartado');
    expect(r.body.lead.nextAction).toBeNull();
  });
});

describe('GATE — override de próximo paso mandado por el cliente (D-01)', () => {
  it('6. override respetado sobre un outcome no-terminal (gana sobre el default de +3 días)', async () => {
    const target = new Date(Date.now() + 10 * 24 * 3600000).toISOString();
    const r = await disp('l_override_ok', { outcome: 'answered_interested', nextAction: { dueAt: target } });
    expect(r.status).toBe(200);
    expect(hoursFromNow(r.body.lead.nextAction.dueAt)).toBeGreaterThan(239);
    expect(hoursFromNow(r.body.lead.nextAction.dueAt)).toBeLessThan(241);
    expect(r.body.lead.nextAction.origen).toBe('manual');
  });

  it('7. override con dueAt inválido → se ignora en silencio, status 200, queda el default de +3 días (D-01: nunca 400)', async () => {
    const r = await disp('l_override_invalid', { outcome: 'answered_interested', nextAction: { dueAt: 'no-es-fecha' } });
    expect(r.status).toBe(200);
    expect(hoursFromNow(r.body.lead.nextAction.dueAt)).toBeGreaterThan(71);
    expect(hoursFromNow(r.body.lead.nextAction.dueAt)).toBeLessThan(73);
  });

  it('8. override ignorado cuando el outcome es terminal (el estado terminal siempre gana, T-30-02)', async () => {
    const target = new Date(Date.now() + 5 * 24 * 3600000).toISOString();
    const r = await disp('l_override_terminal', { outcome: 'answered_not_interested', nextAction: { dueAt: target } });
    expect(r.body.lead.estado).toBe('descartado');
    expect(r.body.lead.nextAction).toBeNull();
  });

  it('9. el override NO puede escribir origen:\'compromiso\' — siempre queda \'manual\' (reservado Phase 31)', async () => {
    const target = new Date(Date.now() + 4 * 24 * 3600000).toISOString();
    const r = await disp('l_override_compromiso', { outcome: 'answered_interested', nextAction: { dueAt: target, origen: 'compromiso' } });
    expect(r.body.lead.nextAction.origen).toBe('manual');
  });

  it('10. override con tipo/canal basura → caen a los defaults válidos (callback/llamada)', async () => {
    const target = new Date(Date.now() + 6 * 24 * 3600000).toISOString();
    const r = await disp('l_override_garbage', { outcome: 'answered_interested', nextAction: { dueAt: target, tipo: 'inventado', canal: 'paloma' } });
    expect(r.body.lead.nextAction.tipo).toBe('callback');
    expect(r.body.lead.nextAction.canal).toBe('llamada');
  });
});

describe('GATE — red de seguridad (GATE-01)', () => {
  it('11. un no_answer con callbackAt presente en opts saltea la cadencia (guard !callbackAt) — la red de seguridad igual deja el lead con nextAction de cadencia', () => {
    // Camino directo (patrón de tests/apply-call-outcome.test.js): protege
    // específicamente al webhook del agente de voz, que comparte
    // _applyCallOutcome con el handler humano pero no pasa por el mismo
    // sanitizado de body que el endpoint HTTP.
    const l = { callLog: [], estado: 'sin_contactar', assignedTo: 's_x', conexion: 'sin_wsp' };
    const data = { calendar: [] };
    const nowIso = new Date().toISOString();
    const logEntry = { ts: nowIso, outcome: 'no_answer', by: '', notes: '' };
    va._applyCallOutcome(data, l, logEntry, {
      leadId: 'x', nowIso, outcome: 'no_answer',
      // callbackAt presente → el bloque MAX_NO_CONTACT NO corre (guard
      // !callbackAt), así que sin la red de seguridad el lead quedaría sin
      // próximo paso definido.
      callbackAt: new Date(Date.now() + 999 * 3600000).toISOString(),
    });
    expect(l.estado).not.toBe('descartado');
    expect(l.nextAction).toBeTruthy();
    expect(l.nextAction.tipo).toBe('cadencia');
    expect(l.nextAction.origen).toBe('cadencia');
    expect(l.nextAction.motivo).toBe('sin próximo paso definido');
  });
});

describe('GATE — send-placeholder (source-assertion)', () => {
  // No se puede ejercitar el envío real de mail (depende de Resend/red) en
  // este entorno. Se verifica el contrato a nivel fuente, mismo criterio que
  // usan tests/app-version.test.js / tests/dtpicker-wiring.test.js para lo
  // que no se puede ejecutar acá: leer index.js como texto y confirmar que
  // el bloque de mutateSettersData del endpoint escribe 'esperar_respuesta'.
  it('12. el bloque de mutateSettersData de /send-placeholder programa esperar_respuesta', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'index.js'), 'utf8');
    const epIdx = src.indexOf("app.post('/api/setters/leads/:id/send-placeholder'");
    expect(epIdx).toBeGreaterThan(-1);
    const muIdx = src.indexOf('mutateSettersData((fresh)', epIdx);
    expect(muIdx).toBeGreaterThan(epIdx);
    // Cierre del endpoint: el próximo '});' de nivel de ruta después del
    // mutex — usamos el siguiente 'app.post(' o 'app.get(' como límite
    // superior para no barrer el archivo entero.
    const nextRouteIdx = src.indexOf("\napp.post('/api/setters/dedup'", muIdx);
    expect(nextRouteIdx).toBeGreaterThan(muIdx);
    const block = src.slice(muIdx, nextRouteIdx);
    expect(block).toContain('esperar_respuesta');
    expect(block).toContain('_setNextAction(l');
  });
});

// Phase 32 Plan 01 (Task 3) — cobertura HTTP de
// POST /api/setters/leads/:id/whatsapp-send (ACT-01/02/03). Setup calcado de
// tests/commitment-endpoints.test.js (mismo idioma de fixture/hoursFromNow).

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import request from 'supertest';

const tmpData = path.join(os.tmpdir(), `act-whatsapp-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = 'admin-actwa@local.test';
process.env.ADMIN_PASSWORD = 'actwapass1234';
process.env.JWT_SECRET = 'test-secret-act-whatsapp-1234567890';
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
  users: [
    { id: 'u_admin', email: 'admin-actwa@local.test', name: 'AdminActWa', role: 'admin', status: 'active', setterId: '', password: pwd('actwapass1234'), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: 'u_setterA', email: 'setterA-actwa@local.test', name: 'SetterA', role: 'setter', status: 'active', setterId: 's_owner', password: pwd('setterpass'), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: 'u_setterB', email: 'setterB-actwa@local.test', name: 'SetterB', role: 'setter', status: 'active', setterId: 's_other', password: pwd('setterpass'), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  ],
  invites: [], sessions: [],
}, null, 2));

// Teléfonos +521 (México, no bloqueado por _expensiveTariffLabel) con >= 7
// dígitos (regla #163) — si no, el lead nunca entra en las colas.
const lead = (n, extra) => ({
  num: n, name: 'L' + n, phone: '+521555100' + String(n).padStart(4, '0'),
  assignedTo: 's_owner', conexion: 'sin_wsp', estado: 'sin_contactar',
  country: 'Mexico',
  ...extra,
});

const settersFile = path.join(tmpData, 'setters.json');
fs.writeFileSync(settersFile, JSON.stringify({
  setters: [{ id: 's_owner', name: 'Owner' }, { id: 's_other', name: 'Other' }],
  variants: [],
  leads: {
    // URL (ACT-01)
    l_url_mx: lead(1),
    l_url_us: lead(2),
    l_url_bad: lead(3, { country: '', phone: '12345' }),
    l_url_empty: lead(4),
    // Registro (ACT-02 / D-04 / D-05) — el lead ya trae 2 entries de callLog
    // preexistentes para que "misma longitud que antes" sea una prueba real,
    // no solo "sigue en 0".
    l_reg: lead(5, {
      callLog: [
        { ts: '2026-08-01T00:00:00.000Z', outcome: 'no_answer' },
        { ts: '2026-08-02T00:00:00.000Z', outcome: 'voicemail' },
      ],
    }),
    // Plantilla fuera de whitelist / lead terminal
    l_tpl_unknown: lead(6),
    l_terminal: lead(7, { estado: 'descartado' }),
    // Número alternativo (ACT-03 / D-10)
    l_alt_save: lead(8),
    l_alt_nosave: lead(9),
    // Marca y tamaño (D-08)
    l_brand: lead(10),
    l_long_msg: lead(11),
    // Seguridad
    l_sec_other: lead(12),
    l_sec_nocookie: lead(13),
  },
  calendar: [], sessions: [],
}, null, 2));

const { app } = await import('../index.js');

let adminCookie = '';
let setterACookie = '';
let setterBCookie = '';
let V;

const send = (id, body, cookie) => request(app).post(`/api/setters/leads/${id}/whatsapp-send`).set('Cookie', cookie || adminCookie).send(body || {});
const hoursFromNow = (iso) => (new Date(iso).getTime() - Date.now()) / 3600000;

// Relee el lead DIRECTO del disco — para probar que un 400 no persistió nada
// (el endpoint es síncrono: si corta antes de saveSettersData, el archivo
// queda exactamente como estaba).
function readLead(id) {
  const raw = JSON.parse(fs.readFileSync(settersFile, 'utf8'));
  return raw.leads[id];
}

beforeAll(async () => {
  let r = await request(app).post('/api/auth/login').send({ email: 'admin-actwa@local.test', password: 'actwapass1234' });
  adminCookie = (r.headers['set-cookie'] || []).find((c) => c.startsWith('gs_session=')).split(';')[0];
  r = await request(app).post('/api/auth/login').send({ email: 'setterA-actwa@local.test', password: 'setterpass' });
  setterACookie = (r.headers['set-cookie'] || []).find((c) => c.startsWith('gs_session=')).split(';')[0];
  r = await request(app).post('/api/auth/login').send({ email: 'setterB-actwa@local.test', password: 'setterpass' });
  setterBCookie = (r.headers['set-cookie'] || []).find((c) => c.startsWith('gs_session=')).split(';')[0];
  V = globalThis.__voiceAgent;
});

afterAll(() => {
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
});

// ────────────────────────────────────────────────────────────────────────
// URL (ACT-01)
// ────────────────────────────────────────────────────────────────────────
describe('URL (ACT-01)', () => {
  it('1. México + mensaje → wa.me/521... con ?text= url-encoded', async () => {
    const r = await send('l_url_mx', { templateId: 'envio_info', message: 'hola doctor' });
    expect(r.status).toBe(200);
    expect(r.body.whatsappUrl).toMatch(/^https:\/\/wa\.me\/521/);
    expect(r.body.whatsappUrl).toContain('?text=' + encodeURIComponent('hola doctor'));
  });

  it('2. Formato US con paréntesis → wa.me/1305... (delegación real en buildWhatsAppUrl, incluye el caso frontera de México)', async () => {
    const r = await send('l_url_us', { phone: '(305) 555-1234' });
    expect(r.status).toBe(200);
    expect(r.body.whatsappUrl).toMatch(/^https:\/\/wa\.me\/1305/);
  });

  it('3. Sin país + teléfono corto sin prefijo → 400 con error y lead.commitment sin cambios (nada se registró)', async () => {
    const before = readLead('l_url_bad');
    expect(before.commitment == null).toBe(true);
    const r = await send('l_url_bad', { message: 'hola' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBeTruthy();
    const after = readLead('l_url_bad');
    expect(after.commitment == null).toBe(true);
    expect(after.interactions == null || after.interactions.length === 0).toBe(true);
  });

  it('4. message vacío/ausente → URL sin ?text=', async () => {
    const r = await send('l_url_empty', {});
    expect(r.status).toBe(200);
    expect(r.body.whatsappUrl).not.toContain('?text=');
  });
});

// ────────────────────────────────────────────────────────────────────────
// Registro (ACT-02 / D-04 / D-05)
// ────────────────────────────────────────────────────────────────────────
describe('Registro (ACT-02 / D-04 / D-05)', () => {
  let sendResp;

  beforeAll(async () => {
    sendResp = await send('l_reg', { templateId: 'envio_info', message: 'te mando la info' });
  });

  it('5. lead.commitment queda enviar_info/yo/whatsapp/cumplido, con closedAt', () => {
    expect(sendResp.status).toBe(200);
    const c = sendResp.body.commitment;
    expect(c).toBeTruthy();
    expect(c.tipo).toBe('enviar_info');
    expect(c.parte).toBe('yo');
    expect(c.canal).toBe('whatsapp');
    expect(c.estado).toBe('cumplido');
    expect(c.closedAt).toBeTruthy();
  });

  it('6. lead.nextAction = esperar_respuesta, origen compromiso, dueAt entre 47 y 49 horas en el futuro', () => {
    const na = sendResp.body.nextAction;
    expect(na).toBeTruthy();
    expect(na.tipo).toBe('esperar_respuesta');
    expect(na.origen).toBe('compromiso');
    const h = hoursFromNow(na.dueAt);
    expect(h).toBeGreaterThan(47);
    expect(h).toBeLessThan(49);
  });

  it('7. lead.interactions termina con material_sent (canal/templateId/to) y SIN la clave setterId', () => {
    const interactions = sendResp.body.lead.interactions;
    const last = interactions[interactions.length - 1];
    expect(last.action).toBe('material_sent');
    expect(last.canal).toBe('whatsapp');
    expect(last.templateId).toBe('envio_info');
    expect(last.to).toBeTruthy();
    expect('setterId' in last).toBe(false);
  });

  it('8. lead.callLog conserva EXACTAMENTE la misma longitud que antes del envío (no es una llamada)', () => {
    expect(sendResp.body.lead.callLog.length).toBe(2);
  });
});

it("9. templateId fuera de whitelist ('basura') → 200 y la entry queda con templateId: '' (nunca 4xx)", async () => {
  const r = await send('l_tpl_unknown', { templateId: 'basura', message: 'hola' });
  expect(r.status).toBe(200);
  expect(r.body.templateId).toBe('');
  const interactions = r.body.lead.interactions;
  expect(interactions[interactions.length - 1].templateId).toBe('');
});

it("10. Envío sobre lead estado:'descartado' → 200, whatsappUrl presente, nextAction sigue sin fecha, entry se escribió igual", async () => {
  const r = await send('l_terminal', { message: 'hola' });
  expect(r.status).toBe(200);
  expect(r.body.whatsappUrl).toBeTruthy();
  expect(r.body.nextAction).toBeFalsy();
  const interactions = r.body.lead.interactions;
  expect(interactions[interactions.length - 1].action).toBe('material_sent');
});

// ────────────────────────────────────────────────────────────────────────
// Número alternativo (ACT-03 / D-10)
// ────────────────────────────────────────────────────────────────────────
describe('Número alternativo (ACT-03 / D-10)', () => {
  it('11. saveAsAltPhone:true → persiste altPhone/altPhoneLabel, lead.phone INTACTO', async () => {
    const originalPhone = readLead('l_alt_save').phone;
    const r = await send('l_alt_save', { phone: '+5215559999999', saveAsAltPhone: true, altPhoneLabel: 'Encargado' });
    expect(r.status).toBe(200);
    expect(r.body.lead.altPhone).toBe('+5215559999999');
    expect(r.body.lead.altPhoneLabel).toBe('Encargado');
    expect(r.body.lead.phone).toBe(originalPhone);
  });

  it('12. saveAsAltPhone ausente → lead.altPhone sigue vacío, pero sentTo de la respuesta es el número alternativo', async () => {
    const r = await send('l_alt_nosave', { phone: '+5215558888888' });
    expect(r.status).toBe(200);
    expect(r.body.sentTo).toBe('+5215558888888');
    expect(r.body.lead.altPhone).toBe('');
  });
});

// ────────────────────────────────────────────────────────────────────────
// Marca y tamaño (D-08)
// ────────────────────────────────────────────────────────────────────────
describe('Marca y tamaño (D-08)', () => {
  it('13. message que contiene la marca → el ?text= de la URL no la contiene', async () => {
    const r = await send('l_brand', { message: 'Somos SCM y te queremos ayudar con la agenda' });
    expect(r.status).toBe(200);
    const url = new URL(r.body.whatsappUrl);
    const text = url.searchParams.get('text');
    expect(text).not.toMatch(/\bSCM\b/);
  });

  it('14. message de 3000 chars → la entry/URL no supera ACT_MESSAGE_MAX (vía _actSanitizeMessage expuesto)', async () => {
    const longMsg = 'x'.repeat(3000);
    const expected = V._actSanitizeMessage(longMsg);
    expect(expected.length).toBeLessThanOrEqual(900);
    const r = await send('l_long_msg', { message: longMsg });
    expect(r.status).toBe(200);
    const url = new URL(r.body.whatsappUrl);
    expect(url.searchParams.get('text')).toBe(expected);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Seguridad
// ────────────────────────────────────────────────────────────────────────
describe('Seguridad', () => {
  it('15. Setter que no es dueño (s_other) → 403', async () => {
    const r = await send('l_sec_other', { message: 'hola' }, setterBCookie);
    expect(r.status).toBe(403);
  });

  it('16. Sin cookie → 401', async () => {
    const r = await request(app).post('/api/setters/leads/l_sec_nocookie/whatsapp-send').send({ message: 'hola' });
    expect(r.status).toBe(401);
  });

  it('17. Lead inexistente → 404', async () => {
    const r = await send('no_existe_este_id', { message: 'hola' });
    expect(r.status).toBe(404);
  });
});

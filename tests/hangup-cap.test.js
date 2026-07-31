// Tope de cortes (2026-07-31).
// Antes `hung_up` ("Me cortó") no tenía límite: no cuenta como no-contacto
// (correcto, atendieron) pero además ROMPÍA la racha de no-contacto, así que el
// lead volvía a la cola para siempre. Caso real que lo destapó: un lead con
// `no_answer > hung_up ×4` seguía figurando como "sin contactar" en el Power
// Dialer. Criterio del user: al 2do corte se descarta.
import { describe, it, beforeAll, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import request from 'supertest';

const tmpData = path.join(os.tmpdir(), `hangup-cap-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = 'admin-hc@local.test';
process.env.ADMIN_PASSWORD = 'hcpass1234';
process.env.JWT_SECRET = 'test-secret-hangup-cap-1234567890';
process.env.OPENAI_API_KEY = '';
process.env.MERCURY_API_KEY = '';
process.env.QWEN_API_KEY = '';

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: crypto.scryptSync(plain, salt, 64).toString('hex') };
}
fs.writeFileSync(path.join(tmpData, 'auth.json'), JSON.stringify({
  users: [{ id: 'u', email: 'admin-hc@local.test', name: 'AdminHC', role: 'admin', status: 'active', setterId: '', password: pwd('hcpass1234') }],
  invites: [], sessions: [],
}, null, 2));
const lead = (n) => ({ num: n, name: 'L' + n, phone: '+521555000000' + n, assignedTo: 's_x', conexion: 'sin_wsp', estado: 'sin_contactar' });
fs.writeFileSync(path.join(tmpData, 'setters.json'), JSON.stringify({
  setters: [{ id: 's_x', name: 'X' }], variants: [],
  leads: { l1: lead(1), l2: lead(2), l3: lead(3), l4: lead(4) },
  calendar: [], sessions: [],
}, null, 2));

const { app } = await import('../index.js');
let cookie = '';
const disp = (id, body) => request(app).post(`/api/setters/leads/${id}/call-disposition`).set('Cookie', cookie).send(body);

beforeAll(async () => {
  const r = await request(app).post('/api/auth/login').send({ email: 'admin-hc@local.test', password: 'hcpass1234' });
  cookie = r.headers['set-cookie'];
});

describe('tope de cortes ("Me cortó")', () => {
  it('el 1er corte NO descarta: sigue llamable', async () => {
    const r = await disp('l1', { outcome: 'hung_up' });
    expect(r.status).toBe(200);
    expect(r.body.lead.estado).not.toBe('descartado');
  });

  it('el 2do corte descarta solo y limpia el callback', async () => {
    const r = await disp('l1', { outcome: 'hung_up' });
    expect(r.body.lead.estado).toBe('descartado');
    expect(r.body.lead.autoDiscarded).toBe(true);
    expect(r.body.lead.autoDiscardReason).toBe('cortes_2x');
    expect(r.body.lead.callbackAt).toBeFalsy();
  });

  it('cuenta el TOTAL de cortes, no la racha: alternar con no_answer ya no lo vuelve eterno', async () => {
    // Este es el bug de fondo. Con racha consecutiva, no_answer entre cortes
    // reiniciaba el contador y el lead no salía nunca de la cola.
    await disp('l2', { outcome: 'hung_up' });
    await disp('l2', { outcome: 'no_answer' });
    const r = await disp('l2', { outcome: 'hung_up' });
    expect(r.body.lead.estado).toBe('descartado');
    expect(r.body.lead.autoDiscardReason).toBe('cortes_2x');
  });

  it('el caso real que lo destapó (no_answer + cortes repetidos) queda descartado', async () => {
    await disp('l3', { outcome: 'no_answer' });   // 1er intento: no atiende
    await disp('l3', { outcome: 'hung_up' });     // atiende y corta
    const r = await disp('l3', { outcome: 'hung_up' }); // 2do corte → afuera
    expect(r.body.lead.estado).toBe('descartado');
    // NOTA de arquitectura (verificado al escribir este test): la cola
    // /leads/sin-wsp devuelve TODO lo que tiene conexion='sin_wsp' sin mirar el
    // estado — quien esconde los descartados es el frontend (renderCallsList
    // app.js:6903 y _pdBuildQueue app.js:5430). Por eso acá se asserta el estado,
    // que es la señal de la que depende ese filtrado.
    const cola = await request(app).get('/api/setters/leads/sin-wsp?include=callable').set('Cookie', cookie);
    const l3 = (cola.body.leads || []).find((l) => l.id === 'l3');
    expect(l3.estado).toBe('descartado');
  });

  it('el callback manual NO se puede colgar de un corte: "me cortó" siempre cuenta', async () => {
    // Comportamiento real del endpoint (verificado en index.js:10501): callbackAt
    // solo se aplica en el outcome 'callback_later'. Si el prospecto pidió que lo
    // llamen más tarde, el SDR marca "Volver a llamar", no "Me cortó" — así que
    // un corte con fecha adjunta igual cuenta para el tope.
    const manual = new Date(Date.now() + 3 * 24 * 3600000).toISOString();
    await disp('l4', { outcome: 'hung_up' });
    const r = await disp('l4', { outcome: 'hung_up', callbackAt: manual });
    expect(r.body.lead.estado).toBe('descartado');
    expect(r.body.lead.callbackAt).toBeFalsy();

    // Y la vía correcta sí preserva el lead: marcar "Volver a llamar".
    const r2 = await disp('l2', { outcome: 'callback_later', callbackAt: manual });
    expect(new Date(r2.body.lead.callbackAt).toISOString()).toBe(manual);
  });
});

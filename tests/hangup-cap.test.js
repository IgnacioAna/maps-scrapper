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

  it('el backfill aplica el tope a los leads que YA lo superaban', async () => {
    // El tope solo actúa al marcar un corte nuevo, así que los leads que venían
    // acumulando cortes de antes seguían en la cola. Eso lo vio el user apenas
    // se deployó: "aprieto el power dialer y me lleva de vuelta al mismo lead".
    const p = path.join(tmpData, 'setters.json');
    const d = JSON.parse(fs.readFileSync(p, 'utf8'));
    d.leads.viejo = {
      num: 9, name: 'Viejo con cortes', phone: '+5215559999999', assignedTo: 's_x',
      conexion: 'sin_wsp', estado: 'sin_contactar',
      callbackAt: new Date(Date.now() - 30 * 24 * 3600000).toISOString(), // vencido
      callLog: [
        { ts: new Date().toISOString(), outcome: 'no_answer' },
        { ts: new Date().toISOString(), outcome: 'hung_up' },
        { ts: new Date().toISOString(), outcome: 'hung_up' },
        { ts: new Date().toISOString(), outcome: 'hung_up' },
      ],
    };
    // Un lead con UN solo corte no debe tocarse.
    d.leads.uno_solo = {
      num: 10, name: 'Un solo corte', phone: '+5215558888888', assignedTo: 's_x',
      conexion: 'sin_wsp', estado: 'sin_contactar',
      callLog: [{ ts: new Date().toISOString(), outcome: 'hung_up' }],
    };
    fs.writeFileSync(p, JSON.stringify(d, null, 2));

    const dry = await request(app).post('/api/admin/backfill-hangup-cap').set('Cookie', cookie).send({ dryRun: true });
    expect(dry.body.matched).toBeGreaterThanOrEqual(1);
    expect(dry.body.leads.some((l) => l.id === 'viejo')).toBe(true);
    expect(dry.body.leads.some((l) => l.id === 'uno_solo')).toBe(false);
    // La simulación no escribe.
    const sinTocar = JSON.parse(fs.readFileSync(p, 'utf8'));
    expect(sinTocar.leads.viejo.estado).toBe('sin_contactar');

    const run = await request(app).post('/api/admin/backfill-hangup-cap').set('Cookie', cookie).send({});
    expect(run.body.updated).toBeGreaterThanOrEqual(1);
    const after = JSON.parse(fs.readFileSync(p, 'utf8'));
    expect(after.leads.viejo.estado).toBe('descartado');
    expect(after.leads.viejo.autoDiscardReason).toBe('cortes_2x');
    expect(after.leads.viejo.callbackAt).toBe('');   // limpia el callback vencido
    expect(after.leads.viejo.callLog.length).toBe(4); // no toca el historial
    expect(after.leads.viejo.interes).toBeFalsy();    // cortar no es "no interesado"
    expect(after.leads.uno_solo.estado).toBe('sin_contactar');

    // Idempotente: correrlo de nuevo no encuentra nada.
    const otra = await request(app).post('/api/admin/backfill-hangup-cap').set('Cookie', cookie).send({});
    expect(otra.body.updated).toBe(0);
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

  it('cualquier disposición consume el callback pendiente arrastrado (lead clavado 1° en Prioridad)', async () => {
    // Caso real (2026-08-12): lead con callback de cadencia del 25/7 vencido; el
    // SDR lo llamó el 11/8 y marcó "Me cortó" (1er corte, no descarta). Ninguna
    // rama limpiaba el callback viejo → "callback vencido" = +60 de score → el
    // lead quedaba clavado PRIMERO en la cola de Prioridad sin importar cuántas
    // veces se lo llamara, tapando a los vírgenes.
    const p = path.join(tmpData, 'setters.json');
    const d = JSON.parse(fs.readFileSync(p, 'utf8'));
    const stale = new Date(Date.now() - 18 * 24 * 3600000).toISOString();
    d.leads.zombie = {
      num: 11, name: 'Callback zombie', phone: '+5215557777777', assignedTo: 's_x',
      conexion: 'sin_wsp', estado: 'sin_contactar',
      callbackAt: stale, callLog: [{ ts: stale, outcome: 'no_answer' }],
    };
    // Mismo arrastre pero el próximo resultado es no-contacto: la cadencia debe
    // RE-programar (+24h), no conservar el vencido ni quedar vacío.
    d.leads.zombie2 = {
      num: 12, name: 'Callback zombie 2', phone: '+5215556666666', assignedTo: 's_x',
      conexion: 'sin_wsp', estado: 'sin_contactar',
      callbackAt: stale, callLog: [],
    };
    fs.writeFileSync(p, JSON.stringify(d, null, 2));

    // "Me cortó" (1er corte): sigue vivo, y el callback VIEJO arrastrado se
    // reemplaza por una cadencia FRESCA a +24h (Phase 30/D-02: un 1er corte
    // ya no deja el lead sin próximo paso — antes de ese gate quedaba vacío
    // acá, ahora queda un reintento nuevo, nunca el vencido).
    const r = await disp('zombie', { outcome: 'hung_up' });
    expect(r.body.lead.estado).not.toBe('descartado');
    expect(r.body.lead.callbackAt).not.toBe(stale);
    const cbHours = (new Date(r.body.lead.callbackAt).getTime() - Date.now()) / 3600000;
    expect(cbHours).toBeGreaterThan(23);
    expect(cbHours).toBeLessThan(25);

    const r2 = await disp('zombie2', { outcome: 'no_answer' });
    const cb = new Date(r2.body.lead.callbackAt).getTime();
    expect(cb).toBeGreaterThan(Date.now());
  });

  it('el backfill limpia los callbacks consumidos que YA estaban arrastrados', async () => {
    // El fix de arriba solo actúa hacia adelante (mismo gap que el tope de
    // cortes): los zombies existentes en la base seguían clavados hasta que
    // alguien los volviera a llamar. En prod había 6 al momento del fix.
    const p = path.join(tmpData, 'setters.json');
    const d = JSON.parse(fs.readFileSync(p, 'utf8'));
    const DAY = 24 * 3600000;
    const base = { assignedTo: 's_x', conexion: 'sin_wsp', estado: 'sin_contactar' };
    // Vencido + llamada POSTERIOR → consumido, se limpia.
    d.leads.consumido = { ...base, num: 20, name: 'Consumido', phone: '+5215551111111',
      callbackAt: new Date(Date.now() - 18 * DAY).toISOString(),
      callLog: [{ ts: new Date(Date.now() - 1 * DAY).toISOString(), outcome: 'hung_up' }] };
    // Vencido SIN llamada posterior → sigue legítimamente pendiente, NO se toca.
    d.leads.pendiente = { ...base, num: 21, name: 'Pendiente real', phone: '+5215552222222',
      callbackAt: new Date(Date.now() - 2 * DAY).toISOString(),
      callLog: [{ ts: new Date(Date.now() - 3 * DAY).toISOString(), outcome: 'callback_later' }] };
    // Callback FUTURO → NO se toca aunque haya llamadas viejas.
    d.leads.futuro = { ...base, num: 22, name: 'Futuro', phone: '+5215553333333',
      callbackAt: new Date(Date.now() + 2 * DAY).toISOString(),
      callLog: [{ ts: new Date(Date.now() - 1 * DAY).toISOString(), outcome: 'callback_later' }] };
    fs.writeFileSync(p, JSON.stringify(d, null, 2));

    const dry = await request(app).post('/api/admin/backfill-consumed-callbacks').set('Cookie', cookie).send({ dryRun: true });
    expect(dry.body.leads.some((l) => l.id === 'consumido')).toBe(true);
    expect(dry.body.leads.some((l) => l.id === 'pendiente')).toBe(false);
    expect(dry.body.leads.some((l) => l.id === 'futuro')).toBe(false);
    // La simulación no escribe.
    expect(JSON.parse(fs.readFileSync(p, 'utf8')).leads.consumido.callbackAt).toBeTruthy();

    const run = await request(app).post('/api/admin/backfill-consumed-callbacks').set('Cookie', cookie).send({});
    expect(run.body.updated).toBeGreaterThanOrEqual(1);
    const after = JSON.parse(fs.readFileSync(p, 'utf8'));
    expect(after.leads.consumido.callbackAt).toBe('');
    expect(after.leads.consumido.callLog.length).toBe(1); // historial intacto
    expect(after.leads.pendiente.callbackAt).toBeTruthy();
    expect(after.leads.futuro.callbackAt).toBeTruthy();

    // Idempotente.
    const otra = await request(app).post('/api/admin/backfill-consumed-callbacks').set('Cookie', cookie).send({});
    expect(otra.body.updated).toBe(0);
  });
});

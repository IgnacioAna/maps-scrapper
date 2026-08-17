// Marca "info enviada" (lead.infoSentAt) — 2026-08-16.
//
// El compromiso 'enviar_info' de la Phase 31 es un EVENTO con reloj: se cumple,
// vence y desaparece de la vista. Lo que faltaba es el HECHO: "a este ya le pasé
// el link", que no caduca y tiene que verse en todas las superficies antes de
// discar, porque la llamada empieza distinta.
//
// Reglas que estos tests protegen:
//  · Es un hecho acumulable, NO un estado: convive con interesado/callback sin
//    pisarlos, y no toca el reloj ni el compromiso.
//  · Se marca sola al mandar desde el sistema, y a mano cuando el link salió
//    del celular.
//  · Un lead terminal (agendado) conserva la marca: el envío ocurrió igual.
import { describe, it, beforeAll, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import request from 'supertest';

const tmpData = path.join(os.tmpdir(), `info-sent-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = 'admin-is@local.test';
process.env.ADMIN_PASSWORD = 'ispass1234';
process.env.JWT_SECRET = 'test-secret-info-sent-1234567890';
process.env.OPENAI_API_KEY = '';
process.env.MERCURY_API_KEY = '';
process.env.QWEN_API_KEY = '';

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: crypto.scryptSync(plain, salt, 64).toString('hex') };
}
fs.writeFileSync(path.join(tmpData, 'auth.json'), JSON.stringify({
  users: [
    { id: 'u', email: 'admin-is@local.test', name: 'AdminIS', role: 'admin', status: 'active', setterId: '', password: pwd('ispass1234') },
    { id: 'u_otra', email: 'otra-is@local.test', name: 'Otra', role: 'setter', status: 'active', setterId: 's_otra', password: pwd('ispass1234') },
  ],
  invites: [], sessions: [],
}, null, 2));

const lead = (n, extra = {}) => ({
  num: n, name: 'L' + n, phone: '+521555000000' + n, assignedTo: 's_x',
  conexion: 'sin_wsp', estado: 'sin_contactar', ...extra,
});
fs.writeFileSync(path.join(tmpData, 'setters.json'), JSON.stringify({
  setters: [{ id: 's_x', name: 'X' }, { id: 's_otra', name: 'Otra' }], variants: [],
  leads: {
    l1: lead(1),
    l2: lead(2, { estado: 'interesado', interes: 'si' }),
    l3: lead(3),
    // Ya tiene envíos registrados por Phase 32 pero sin la marca: material del backfill.
    l_viejo: lead(4, {
      interactions: [
        { action: 'material_sent', canal: 'whatsapp', to: '+5215550000004', by: 'u', byName: 'AdminIS', createdAt: '2026-08-10T12:00:00.000Z' },
        { action: 'material_sent', canal: 'email', to: 'x@y.com', by: 'u', byName: 'AdminIS', createdAt: '2026-08-12T12:00:00.000Z' },
      ],
    }),
    l_ajeno: lead(5, { assignedTo: 's_x' }),
  },
  calendar: [], sessions: [],
}, null, 2));

const { app } = await import('../index.js');
let cookie = '';
let cookieOtra = '';
const marcar = (id, body) => request(app).post(`/api/setters/leads/${id}/info-sent`).set('Cookie', cookie).send(body);
const verLead = (id) => JSON.parse(fs.readFileSync(path.join(tmpData, 'setters.json'), 'utf8')).leads[id];

beforeAll(async () => {
  const r = await request(app).post('/api/auth/login').send({ email: 'admin-is@local.test', password: 'ispass1234' });
  cookie = r.headers['set-cookie'];
  const r2 = await request(app).post('/api/auth/login').send({ email: 'otra-is@local.test', password: 'ispass1234' });
  cookieOtra = r2.headers['set-cookie'];
});

describe('marcar a mano', () => {
  it('marca el hecho con fecha, autor y canal', async () => {
    const r = await marcar('l1', { sent: true });
    expect(r.status).toBe(200);
    expect(r.body.infoSentAt).toBeTruthy();
    expect(r.body.infoSentBy).toBe('AdminIS');
    expect(r.body.infoSentCanal).toBe('manual'); // salió por fuera del sistema
    expect(r.body.infoSentCount).toBe(1);
    // Lo afirma una persona: nunca queda como optimista.
    expect(r.body.infoSentAuto).toBe(false);
  });

  it('NO es un estado: el lead no cambia de estado, ni de reloj, ni de compromiso', async () => {
    const antes = verLead('l2');
    await marcar('l2', { sent: true });
    const despues = verLead('l2');
    expect(despues.estado).toBe('interesado');                 // sigue siendo lo que era
    expect(despues.nextAction ?? null).toEqual(antes.nextAction ?? null);
    expect(despues.commitment ?? null).toEqual(antes.commitment ?? null);
    expect(despues.callbackAt || '').toBe(antes.callbackAt || '');
    expect(despues.infoSentAt).toBeTruthy();                   // y suma el hecho
  });

  it('marcar de nuevo acumula el contador', async () => {
    await marcar('l3', { sent: true });
    const r = await marcar('l3', { sent: true });
    expect(r.body.infoSentCount).toBe(2);
  });

  it('desmarcar limpia todo (se apretó por error)', async () => {
    const r = await marcar('l3', { sent: false });
    expect(r.body.infoSentAt).toBe('');
    expect(r.body.infoSentCount).toBe(0);
    expect(r.body.infoSentBy).toBe('');
  });

  it('un canal fuera de la whitelist cae a "manual", no rompe', async () => {
    const r = await marcar('l1', { sent: true, canal: 'paloma_mensajera' });
    expect(r.status).toBe(200);
    expect(r.body.infoSentCanal).toBe('manual');
  });

  it('un setter no puede marcar un lead ajeno', async () => {
    const r = await request(app).post('/api/setters/leads/l_ajeno/info-sent').set('Cookie', cookieOtra).send({ sent: true });
    expect(r.status).toBe(403);
  });

  it('404 si el lead no existe', async () => {
    const r = await marcar('no_existe', { sent: true });
    expect(r.status).toBe(404);
  });
});

describe('mandar desde el sistema deja la marca solo', () => {
  it('el registro de envío (WhatsApp/email) escribe la marca', async () => {
    // _actRegisterSendEvent es el registro compartido por los dos canales.
    const { _actRegisterSendEvent } = globalThis.__voiceAgent;
    const l = { estado: 'sin_contactar', interactions: [] };
    _actRegisterSendEvent(l, { canal: 'whatsapp', templateId: '', to: '+549', byId: 'u', byName: 'AdminIS' }, '2026-08-16T10:00:00.000Z');
    expect(l.infoSentAt).toBe('2026-08-16T10:00:00.000Z');
    expect(l.infoSentCanal).toBe('whatsapp');
    expect(l.infoSentCount).toBe(1);
  });

  it('WhatsApp queda OPTIMISTA: el registro sale al abrir el chat, no al enviar', async () => {
    // El endpoint devuelve el link wa.me y registra en el mismo request (D-03),
    // así que abrir la conversación y no escribir nada también marca. Si esto
    // no se distinguiera, los clics vacíos se mezclarían con los envíos reales.
    const { _actRegisterSendEvent } = globalThis.__voiceAgent;
    const l = { estado: 'sin_contactar', interactions: [] };
    _actRegisterSendEvent(l, { canal: 'whatsapp', to: '+549', byName: 'A' }, '2026-08-16T10:00:00.000Z');
    expect(l.infoSentAuto).toBe(true);
  });

  it('el email por Resend queda CONFIRMADO; por mailto, optimista', async () => {
    const { _actRegisterSendEvent } = globalThis.__voiceAgent;
    const conResend = { estado: 'sin_contactar', interactions: [] };
    _actRegisterSendEvent(conResend, { canal: 'email', to: 'x@y.com', byName: 'A', confirmed: true }, '2026-08-16T10:00:00.000Z');
    expect(conResend.infoSentAuto).toBe(false); // el proveedor lo aceptó

    const conMailto = { estado: 'sin_contactar', interactions: [] };
    _actRegisterSendEvent(conMailto, { canal: 'email', to: 'x@y.com', byName: 'A', confirmed: false }, '2026-08-16T10:00:00.000Z');
    expect(conMailto.infoSentAuto).toBe(true);  // se abrió el cliente, nada más
  });

  it('un lead AGENDADO conserva la marca: el envío ocurrió igual', async () => {
    // El corte por lead terminal (que evita crear compromiso/reloj) no debe
    // saltearse el hecho — por eso la marca se escribe antes de ese corte.
    const { _actRegisterSendEvent } = globalThis.__voiceAgent;
    const l = { estado: 'agendado', interactions: [] };
    const out = _actRegisterSendEvent(l, { canal: 'email', to: 'x@y.com', byId: 'u', byName: 'AdminIS' }, '2026-08-16T11:00:00.000Z');
    expect(out.terminal).toBe(true);       // no le pone compromiso ni reloj
    expect(l.infoSentAt).toBeTruthy();     // pero sí registra el envío
    expect(l.infoSentCanal).toBe('email');
  });

  it('envíos sucesivos acumulan', async () => {
    const { _actRegisterSendEvent } = globalThis.__voiceAgent;
    const l = { estado: 'sin_contactar', interactions: [] };
    _actRegisterSendEvent(l, { canal: 'whatsapp', to: '+1', byName: 'A' }, '2026-08-16T10:00:00.000Z');
    _actRegisterSendEvent(l, { canal: 'email', to: 'x@y.com', byName: 'A' }, '2026-08-16T12:00:00.000Z');
    expect(l.infoSentCount).toBe(2);
    expect(l.infoSentAt).toBe('2026-08-16T12:00:00.000Z'); // el último manda
    expect(l.infoSentCanal).toBe('email');
  });
});

describe('backfill desde los envíos ya registrados', () => {
  it('dryRun encuentra los leads con envíos y no escribe', async () => {
    const r = await request(app).post('/api/admin/backfill-info-sent').set('Cookie', cookie).send({ dryRun: true });
    expect(r.status).toBe(200);
    expect(r.body.leads.some((l) => l.id === 'l_viejo')).toBe(true);
    expect(verLead('l_viejo').infoSentAt || '').toBe('');
  });

  it('siembra la marca con el ÚLTIMO envío y el total como contador', async () => {
    const r = await request(app).post('/api/admin/backfill-info-sent').set('Cookie', cookie).send({});
    expect(r.body.updated).toBeGreaterThanOrEqual(1);
    const l = verLead('l_viejo');
    expect(l.infoSentAt).toBe('2026-08-12T12:00:00.000Z'); // el más reciente
    expect(l.infoSentCanal).toBe('email');
    expect(l.infoSentCount).toBe(2);
    // Los envíos viejos no registraron confirmación: quedan como optimistas.
    // Marcarlos como confirmados sería inventar evidencia.
    expect(l.infoSentAuto).toBe(true);
  });

  it('es idempotente: no pisa lo que ya tiene marca', async () => {
    const antes = verLead('l_viejo').infoSentAt;
    const r = await request(app).post('/api/admin/backfill-info-sent').set('Cookie', cookie).send({});
    expect(r.body.updated).toBe(0);
    expect(verLead('l_viejo').infoSentAt).toBe(antes);
  });

  it('solo admin', async () => {
    const r = await request(app).post('/api/admin/backfill-info-sent').set('Cookie', cookieOtra).send({ dryRun: true });
    expect(r.status).toBe(403);
  });
});

describe('la marca viaja a la cola de llamadas', () => {
  it('los leads devueltos traen los campos para pintar el chip', async () => {
    const r = await request(app).get('/api/setters/leads/sin-wsp?include=callable').set('Cookie', cookie);
    const l1 = (r.body.leads || []).find((l) => l.id === 'l1');
    expect(l1).toBeTruthy();
    expect(l1.infoSentAt).toBeTruthy();
    expect(typeof l1.infoSentCount).toBe('number');
  });
});

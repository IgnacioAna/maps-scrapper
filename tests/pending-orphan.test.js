// Pendientes huérfanos (2026-07-31).
// Al colgar, el front registra el pendiente SIN await y acto seguido auto-marca
// no_answer. Si la disposición llega primero, su limpieza no encuentra nada y el
// POST posterior crea un pendiente que ya nunca se resuelve: el SDR ve "tenés una
// llamada sin marcar" de una llamada que SÍ marcó. Caso real: el admin con una
// llamada de 37s ya registrada como no_answer y el lead hasta descartado.
import { describe, it, beforeAll, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import request from 'supertest';

const tmpData = path.join(os.tmpdir(), `pending-orphan-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = 'admin-po@local.test';
process.env.ADMIN_PASSWORD = 'popass1234';
process.env.JWT_SECRET = 'test-secret-pending-orphan-12345';
process.env.OPENAI_API_KEY = '';
process.env.MERCURY_API_KEY = '';
process.env.QWEN_API_KEY = '';

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: crypto.scryptSync(plain, salt, 64).toString('hex') };
}
fs.writeFileSync(path.join(tmpData, 'auth.json'), JSON.stringify({
  users: [{ id: 'u_admin', email: 'admin-po@local.test', name: 'AdminPO', role: 'admin', status: 'active', setterId: 's_x', password: pwd('popass1234') }],
  invites: [], sessions: [],
}, null, 2));
fs.writeFileSync(path.join(tmpData, 'setters.json'), JSON.stringify({
  setters: [{ id: 's_x', name: 'X' }], variants: [],
  leads: {
    l1: { num: 1, name: 'Lead 1', phone: '+5215551110001', assignedTo: 's_x', conexion: 'sin_wsp', estado: 'sin_contactar' },
    l2: { num: 2, name: 'Lead 2', phone: '+5215551110002', assignedTo: 's_x', conexion: 'sin_wsp', estado: 'sin_contactar' },
  },
  calendar: [], sessions: [],
}, null, 2));

const { app } = await import('../index.js');
let cookie = '';
beforeAll(async () => {
  const r = await request(app).post('/api/auth/login').send({ email: 'admin-po@local.test', password: 'popass1234' });
  cookie = r.headers['set-cookie'];
});

const pendientes = async () => (await request(app).get('/api/setters/pending-calls').set('Cookie', cookie)).body.pending;

describe('pendientes huérfanos', () => {
  it('el orden normal (pendiente y después marca) resuelve el pendiente', async () => {
    const startedAt = new Date(Date.now() - 60000).toISOString();
    await request(app).post('/api/setters/pending-calls').set('Cookie', cookie)
      .send({ leadId: 'l1', startedAt, endedAt: new Date().toISOString(), durationSecs: 37 });
    expect((await pendientes()).length).toBe(1);
    await request(app).post('/api/setters/leads/l1/call-disposition').set('Cookie', cookie).send({ outcome: 'no_answer' });
    expect((await pendientes()).length).toBe(0);
  });

  it('con la marca PRIMERO, el pendiente tardío ya no se crea (el race)', async () => {
    const startedAt = new Date(Date.now() - 60000).toISOString();
    // La disposición llega antes que el registro del pendiente.
    await request(app).post('/api/setters/leads/l2/call-disposition').set('Cookie', cookie).send({ outcome: 'no_answer' });
    const r = await request(app).post('/api/setters/pending-calls').set('Cookie', cookie)
      .send({ leadId: 'l2', startedAt, endedAt: new Date().toISOString(), durationSecs: 37 });
    expect(r.body.skipped).toBe('already_dispositioned');
    expect((await pendientes()).length).toBe(0);
  });

  it('una llamada NUEVA posterior a la última marca sí registra pendiente', async () => {
    // No debe quedar tan defensivo que se coma pendientes legítimos: el lead l1
    // ya tiene una marca de antes, pero esta llamada empieza DESPUÉS.
    const startedAt = new Date().toISOString();
    await request(app).post('/api/setters/pending-calls').set('Cookie', cookie)
      .send({ leadId: 'l1', startedAt, endedAt: new Date().toISOString(), durationSecs: 12 });
    const list = await pendientes();
    expect(list.length).toBe(1);
    expect(list[0].leadId).toBe('l1');
  });
});

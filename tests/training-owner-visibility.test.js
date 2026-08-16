// Visibilidad de las llamadas del dueño en la biblioteca de Entrenamiento IA
// (2026-07-31). La exclusión de `setter_ignacio` se puso para que las SDRs no
// tuvieran las pruebas del dueño como material de aprendizaje. Ahora el dueño
// cold-callea en serio y quiere revisarse: la exclusión pasa a ser DIRECCIONAL —
// admin/supervisor ven todo, la SDR sigue sin ver las del dueño.
import { describe, it, beforeAll, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import request from 'supertest';

const tmpData = path.join(os.tmpdir(), `training-owner-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = 'owner-tv@local.test';
process.env.ADMIN_PASSWORD = 'ownerpass1234';
process.env.JWT_SECRET = 'test-secret-training-owner-123456';
process.env.OPENAI_API_KEY = '';
process.env.MERCURY_API_KEY = '';
process.env.QWEN_API_KEY = '';

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: crypto.scryptSync(plain, salt, 64).toString('hex') };
}
const transcript = { segments: [{ speaker: 'setter', text: 'Hola, buenas tardes.' }, { speaker: 'lead', text: 'Si, digame.' }] };
const call = (by) => ({ ts: new Date().toISOString(), by, outcome: 'hung_up', duration: 62, transcript });

fs.writeFileSync(path.join(tmpData, 'auth.json'), JSON.stringify({
  users: [
    { id: 'user_owner', email: 'owner-tv@local.test', name: 'Ignacio', role: 'admin', status: 'active', setterId: 'setter_ignacio', password: pwd('ownerpass1234') },
    { id: 'user_sdr', email: 'sdr-tv@local.test', name: 'SDR', role: 'setter', status: 'active', setterId: 'setter_sdr', password: pwd('sdrpass1234') },
  ],
  invites: [], sessions: [],
}, null, 2));
fs.writeFileSync(path.join(tmpData, 'setters.json'), JSON.stringify({
  setters: [{ id: 'setter_ignacio', name: 'Ignacio' }, { id: 'setter_sdr', name: 'SDR' }],
  variants: [],
  leads: {
    del_owner: { id: 'del_owner', num: 1, name: 'Lead del dueño', phone: '+5215500000001', assignedTo: 'setter_ignacio', estado: 'sin_contactar', callLog: [call('user_owner')] },
    de_la_sdr: { id: 'de_la_sdr', num: 2, name: 'Lead de la SDR', phone: '+5215500000002', assignedTo: 'setter_sdr', estado: 'sin_contactar', callLog: [call('user_sdr')] },
  },
  calendar: [], sessions: [],
}, null, 2));

const { app } = await import('../index.js');
const login = async (email, password) => (await request(app).post('/api/auth/login').send({ email, password })).headers['set-cookie'];

describe('biblioteca de entrenamiento: llamadas del dueño', () => {
  it('el dueño (admin) SÍ ve sus propias llamadas', async () => {
    const cookie = await login('owner-tv@local.test', 'ownerpass1234');
    const r = await request(app).get('/api/training/calls').set('Cookie', cookie);
    expect(r.status).toBe(200);
    const ids = r.body.calls.map((c) => c.leadId);
    expect(ids).toContain('del_owner');
    expect(ids).toContain('de_la_sdr'); // y sigue viendo las del equipo
  });

  it('la SDR NO ve las llamadas del dueño', async () => {
    const cookie = await login('sdr-tv@local.test', 'sdrpass1234');
    const r = await request(app).get('/api/training/calls').set('Cookie', cookie);
    const ids = r.body.calls.map((c) => c.leadId);
    expect(ids).not.toContain('del_owner');
    // Y sí ve la suya (privacidad de 2026-07-10: cada SDR ve solo las propias).
    expect(ids).toContain('de_la_sdr');
  });

  it('con "Ver como SDR" el admin ve lo mismo que ella (rol efectivo)', async () => {
    const cookie = await login('owner-tv@local.test', 'ownerpass1234');
    const r = await request(app).get('/api/training/calls?viewAs=setter&asSetterId=setter_sdr').set('Cookie', cookie);
    const ids = r.body.calls.map((c) => c.leadId);
    expect(ids).not.toContain('del_owner');
  });

  // 2026-08-16: el dueño trabaja su cartera en "Ver como SDR · Ignacio". Con la
  // exclusión ciega por rol la biblioteca le quedaba VACÍA (se escondía a sí
  // mismo). Nadie puede quedar sin ver su propio material.
  it('con "Ver como SDR · Ignacio" el dueño SÍ ve sus propias llamadas', async () => {
    const cookie = await login('owner-tv@local.test', 'ownerpass1234');
    const r = await request(app).get('/api/training/calls?viewAs=setter&asSetterId=setter_ignacio').set('Cookie', cookie);
    expect(r.status).toBe(200);
    const ids = r.body.calls.map((c) => c.leadId);
    expect(ids).toContain('del_owner');
    // Y sigue respetando la privacidad: en modo SDR solo ve las SUYAS.
    expect(ids).not.toContain('de_la_sdr');
  });

  // El detalle ya validaba ownership: la llamada del dueño se abre en modo SDR.
  it('el detalle de su propia llamada se abre en modo "Ver como SDR · Ignacio"', async () => {
    const cookie = await login('owner-tv@local.test', 'ownerpass1234');
    const r = await request(app).get('/api/training/calls/del_owner/0?viewAs=setter&asSetterId=setter_ignacio').set('Cookie', cookie);
    expect(r.status).toBe(200);
    expect(r.body.segments.length).toBe(2);
  });
});

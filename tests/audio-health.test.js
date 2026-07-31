// Salud del audio por vendedor (2026-07-31).
// Origen: en producción las 3 SDRs con más volumen venían hablando con voz baja
// hace 2 semanas (pico promedio 0.198 / 0.219 / 0.225 cuando lo sano es 0.5-0.9)
// y no había forma de verlo — el único síntoma es que el cliente escucha mal.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';

const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'scm-audio-health-'));
process.env.DATA_DIR = tmpData;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-para-audio-health-1234567890';
// Sin esto dotenv repone las keys del .env local y los tests llaman a la IA real
// (patrón de la nota #121: setear vacío, NUNCA delete).
process.env.OPENAI_API_KEY = '';
process.env.MERCURY_API_KEY = '';
process.env.QWEN_API_KEY = '';

const ADMIN = { email: 'admin@test.com', password: 'admin12345' };
const SETTER = { email: 'sdr@test.com', password: 'sdr12345' };

function passwordRecord(password) {
  const crypto = require('node:crypto');
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: crypto.scryptSync(String(password), salt, 64).toString('hex') };
}

// Una llamada con su recMeta: `voice` es el pico del canal del SDR (lo que se le
// envía al cliente) — el número que define si lo escuchan o no.
function call(by, ts, voice, extra = {}) {
  return {
    ts: new Date(ts).toISOString(), by, outcome: 'hung_up', duration: 60,
    channel: 'telnyx_webrtc',
    transcript: { segments: [], recMeta: { setterLvlMax: voice, leadLvlMax: 0.4, ...extra } },
  };
}

let app;
const now = Date.now();
const HOY = now - 3600 * 1000;
const HACE_40_DIAS = now - 40 * 24 * 3600 * 1000;

beforeAll(async () => {
  fs.writeFileSync(path.join(tmpData, 'auth.json'), JSON.stringify({
    users: [
      { id: 'user_admin', email: ADMIN.email, name: 'Admin', role: 'admin', status: 'active', password: passwordRecord(ADMIN.password) },
      { id: 'user_bajo', email: SETTER.email, name: 'Voz Baja', role: 'setter', status: 'active', setterId: 'setter_bajo', password: passwordRecord(SETTER.password) },
      { id: 'user_ok', email: 'ok@test.com', name: 'Nivel Ok', role: 'setter', status: 'active', setterId: 'setter_ok', password: passwordRecord('x12345678') },
      { id: 'user_satura', email: 'sat@test.com', name: 'Satura', role: 'setter', status: 'active', setterId: 'setter_satura', password: passwordRecord('x12345678') },
    ],
    sessions: [], invites: [],
  }, null, 2));

  fs.writeFileSync(path.join(tmpData, 'setters.json'), JSON.stringify({
    setters: [
      { id: 'setter_bajo', name: 'Voz Baja' },
      { id: 'setter_ok', name: 'Nivel Ok' },
      { id: 'setter_satura', name: 'Satura' },
    ],
    variants: [], calendar: [], sessions: [],
    leads: {
      lead1: {
        id: 'lead1', name: 'Clinica 1', phone: '+5215512345678', assignedTo: 'setter_bajo',
        callLog: [
          call('user_bajo', HOY, 0.19, { micLabel: 'Varios micrófonos (Intel® Smart Sound Technology)', v: '20260731e' }),
          call('user_bajo', HOY, 0.22, { micLabel: 'Varios micrófonos (Intel® Smart Sound Technology)' }),
          call('user_bajo', HOY, 0.30),
        ],
      },
      lead2: {
        id: 'lead2', name: 'Clinica 2', phone: '+5215512345679', assignedTo: 'setter_ok',
        callLog: [call('user_ok', HOY, 0.62), call('user_ok', HOY, 0.75)],
      },
      lead3: {
        id: 'lead3', name: 'Clinica 3', phone: '+5215512345670', assignedTo: 'setter_satura',
        callLog: [call('user_satura', HOY, 1.05), call('user_satura', HOY, 1.12), call('user_satura', HOY, 0.55)],
      },
      // Llamada vieja: no debe entrar en la ventana de 14 días.
      lead4: {
        id: 'lead4', name: 'Clinica 4', phone: '+5215512345671', assignedTo: 'setter_ok',
        callLog: [call('user_ok', HACE_40_DIAS, 0.05)],
      },
      // Llamada sin recMeta (versión vieja del front): se ignora, no rompe.
      lead5: {
        id: 'lead5', name: 'Clinica 5', phone: '+5215512345672', assignedTo: 'setter_ok',
        callLog: [{ ts: new Date(HOY).toISOString(), by: 'user_ok', outcome: 'no_answer', duration: 10 }],
      },
    },
  }, null, 2));

  fs.writeFileSync(path.join(tmpData, 'history.json'), JSON.stringify({ entries: {}, searches: [], lastPages: {} }, null, 2));
  const mod = await import('../index.js');
  app = mod.default || mod.app;
});

async function login(creds) {
  const r = await request(app).post('/api/auth/login').send(creds);
  return r.headers['set-cookie'];
}

describe('salud del audio por vendedor', () => {
  it('marca voz baja, nivel ok y saturación según el promedio', async () => {
    const cookie = await login(ADMIN);
    const r = await request(app).get('/api/telnyx/audio-health?days=14').set('Cookie', cookie);
    expect(r.status).toBe(200);
    const by = Object.fromEntries(r.body.rows.map(x => [x.setterId, x]));

    expect(by.setter_bajo.verdict).toBe('low');
    expect(by.setter_bajo.voiceAvg).toBeCloseTo(0.237, 2);
    expect(by.setter_bajo.calls).toBe(3);

    expect(by.setter_ok.verdict).toBe('ok');
    // La llamada de hace 40 días (0.05) queda fuera de la ventana: si entrara,
    // el promedio se hundiría y lo marcaría mal.
    expect(by.setter_ok.measured).toBe(2);
    expect(by.setter_ok.voiceAvg).toBeCloseTo(0.685, 2);

    // Satura en 2 de 3 (>20%) aunque el promedio quede en rango: ese es el punto,
    // el clipping se detecta por frecuencia, no por promedio.
    expect(by.setter_satura.verdict).toBe('clipping');
    expect(by.setter_satura.clippedPct).toBe(67);
  });

  it('ordena los peores primero y resuelve nombre, mic y versión', async () => {
    const cookie = await login(ADMIN);
    const r = await request(app).get('/api/telnyx/audio-health').set('Cookie', cookie);
    expect(r.body.rows[0].setterId).toBe('setter_bajo');
    expect(r.body.rows[0].setterName).toBe('Voz Baja');
    // El mic más usado: sirve para detectar "está con el de la laptop".
    expect(r.body.rows[0].mic).toContain('Intel');
    expect(r.body.days).toBe(14);
    expect(r.body.thresholds.low).toBe(0.35);
  });

  it('acota la ventana de días al rango permitido', async () => {
    const cookie = await login(ADMIN);
    const r1 = await request(app).get('/api/telnyx/audio-health?days=999').set('Cookie', cookie);
    expect(r1.body.days).toBe(90);
    const r2 = await request(app).get('/api/telnyx/audio-health?days=abc').set('Cookie', cookie);
    expect(r2.body.days).toBe(14);
    // Con ventana de 1 día, la llamada vieja sigue afuera y las de hoy entran.
    const r3 = await request(app).get('/api/telnyx/audio-health?days=1').set('Cookie', cookie);
    expect(r3.body.rows.length).toBe(3);
  });

  it('marca problema si la mayoría de las llamadas salen bajas aunque el promedio zafe', async () => {
    // Caso real de producción: 59% de llamadas con voz baja y promedio 0.38 (por
    // encima del umbral). Decir "bien" ahí le miente al admin.
    const p = path.join(tmpData, 'setters.json');
    const d = JSON.parse(fs.readFileSync(p, 'utf8'));
    d.setters.push({ id: 'setter_irregular', name: 'Irregular' });
    d.leads.lead6 = {
      id: 'lead6', name: 'Clinica 6', phone: '+5215512345673', assignedTo: 'setter_irregular',
      callLog: [
        call('user_irregular', HOY, 0.20), call('user_irregular', HOY, 0.22),
        call('user_irregular', HOY, 0.25), call('user_irregular', HOY, 0.90),
        call('user_irregular', HOY, 0.85),
      ],
    };
    fs.writeFileSync(p, JSON.stringify(d, null, 2));
    const auth = JSON.parse(fs.readFileSync(path.join(tmpData, 'auth.json'), 'utf8'));
    auth.users.push({ id: 'user_irregular', email: 'irr@test.com', name: 'Irregular', role: 'setter', status: 'active', setterId: 'setter_irregular', password: passwordRecord('x12345678') });
    fs.writeFileSync(path.join(tmpData, 'auth.json'), JSON.stringify(auth, null, 2));

    const cookie = await login(ADMIN);
    const r = await request(app).get('/api/telnyx/audio-health').set('Cookie', cookie);
    const row = r.body.rows.find(x => x.setterId === 'setter_irregular');
    expect(row.voiceAvg).toBeGreaterThan(0.35); // el promedio zafa…
    expect(row.lowPct).toBe(60);                // …pero 3 de 5 salieron bajas
    expect(row.verdict).toBe('low');
  });

  it('no lo puede ver un vendedor', async () => {
    const cookie = await login(SETTER);
    const r = await request(app).get('/api/telnyx/audio-health').set('Cookie', cookie);
    expect(r.status).toBe(403);
  });

  it('atribuye por quién LLAMÓ, no por el dueño actual del lead', async () => {
    // lead1 está asignado a setter_bajo pero la llamada la hizo user_ok:
    // tiene que contarle a setter_ok (criterio de atribución de la nota #113).
    const cookie = await login(ADMIN);
    const before = await request(app).get('/api/telnyx/audio-health').set('Cookie', cookie);
    const okBefore = before.body.rows.find(x => x.setterId === 'setter_ok').measured;

    const p = path.join(tmpData, 'setters.json');
    const d = JSON.parse(fs.readFileSync(p, 'utf8'));
    d.leads.lead1.callLog.push(call('user_ok', HOY, 0.7));
    fs.writeFileSync(p, JSON.stringify(d, null, 2));

    const after = await request(app).get('/api/telnyx/audio-health').set('Cookie', cookie);
    const okAfter = after.body.rows.find(x => x.setterId === 'setter_ok');
    expect(okAfter.measured).toBe(okBefore + 1);
    // Y el dueño del lead no se contamina con una llamada que no hizo.
    expect(after.body.rows.find(x => x.setterId === 'setter_bajo').measured).toBe(3);
  });
});

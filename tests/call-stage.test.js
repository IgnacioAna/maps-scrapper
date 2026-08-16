// Medición de guiones (2026-08-16): hasta dónde llegó la llamada.
//
// El problema que resuelve: `outcome` colapsaba dos dimensiones distintas. "Me
// cortó la recepcionista" y "me cortó el doctor" son el MISMO outcome
// (`hung_up`) y dos problemas de guion completamente distintos. Sin separarlas,
// un ciclo de prueba de 40 llamadas no produce ninguna conclusión.
//
// `callStage` es esa segunda dimensión: contestador | recepcion | decisor.
import { describe, it, beforeAll, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import request from 'supertest';

const tmpData = path.join(os.tmpdir(), `call-stage-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = 'admin-cs@local.test';
process.env.ADMIN_PASSWORD = 'cspass1234';
process.env.JWT_SECRET = 'test-secret-call-stage-1234567890';
// Definidas-vacías, NUNCA `delete`: index.js corre dotenv.config() y repone las
// borradas desde el .env local → los tests llamarían a la IA real (nota #121).
process.env.OPENAI_API_KEY = '';
process.env.MERCURY_API_KEY = '';
process.env.QWEN_API_KEY = '';

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: crypto.scryptSync(plain, salt, 64).toString('hex') };
}
fs.writeFileSync(path.join(tmpData, 'auth.json'), JSON.stringify({
  users: [
    { id: 'u', email: 'admin-cs@local.test', name: 'AdminCS', role: 'admin', status: 'active', setterId: '', password: pwd('cspass1234') },
    { id: 'u_sdr', email: 'sdr-cs@local.test', name: 'SdrCS', role: 'setter', status: 'active', setterId: 's_x', password: pwd('cspass1234') },
  ],
  invites: [], sessions: [],
}, null, 2));
const lead = (n) => ({ num: n, name: 'L' + n, phone: '+521555000000' + n, assignedTo: 's_x', conexion: 'sin_wsp', estado: 'sin_contactar' });
const leads = {};
for (let i = 1; i <= 12; i++) leads['l' + i] = lead(i);
fs.writeFileSync(path.join(tmpData, 'setters.json'), JSON.stringify({
  setters: [{ id: 's_x', name: 'X' }], variants: [], leads, calendar: [], sessions: [],
}, null, 2));

const { app } = await import('../index.js');
let cookie = '';
const disp = (id, body) => request(app).post(`/api/setters/leads/${id}/call-disposition`).set('Cookie', cookie).send(body);
// Se lee del JSON persistido, no de la cola: la cola filtra por estado (un
// descartado no vuelve) y lo que se está verificando acá es qué QUEDÓ GUARDADO.
const lastCall = (id) => {
  const d = JSON.parse(fs.readFileSync(path.join(tmpData, 'setters.json'), 'utf8'));
  const log = d.leads?.[id]?.callLog || [];
  return log[log.length - 1] || null;
};
// Metadata mínima para que el entry quede como llamada del dialer: el endpoint
// de medición solo mira `telnyx_webrtc` (los `manual` son carga a mano, y el
// agendamiento se registra como un entry manual aparte segundos después de la
// llamada real — contarlos duplicaría la misma conversación).
const meta = { durationSecs: 62, fromNumber: '+13055550000' };

beforeAll(async () => {
  const r = await request(app).post('/api/auth/login').send({ email: 'admin-cs@local.test', password: 'cspass1234' });
  cookie = r.headers['set-cookie'];
});

describe('callStage — persistencia y validación', () => {
  it('persiste la etapa cuando alguien atendió', async () => {
    const r = await disp('l1', { outcome: 'hung_up', callStage: 'recepcion', telnyxCallMeta: meta });
    expect(r.status).toBe(200);
    const c = lastCall('l1');
    expect(c.callStage).toBe('recepcion');
    expect(c.callStageAuto).toBeUndefined(); // lo marcó una persona
  });

  it('es una dimensión SEPARADA del outcome: decisor + no interesado conviven', async () => {
    // El caso que justifica todo el campo: llegó a quien decide y aun así dijo
    // que no. El guion de recepción funcionó; el pitch no.
    await disp('l2', { outcome: 'answered_not_interested', callStage: 'decisor', telnyxCallMeta: meta });
    const c = lastCall('l2');
    expect(c.outcome).toBe('answered_not_interested');
    expect(c.callStage).toBe('decisor');
  });

  it('deriva "contestador" en buzón sin preguntar', async () => {
    const r = await disp('l3', { outcome: 'voicemail', telnyxCallMeta: meta });
    expect(r.status).toBe(200);
    const c = lastCall('l3');
    expect(c.callStage).toBe('contestador');
    expect(c.callStageAuto).toBe(true); // derivado, no registrado por una persona
  });

  it('NO inventa etapa en el resto de los outcomes', async () => {
    await disp('l4', { outcome: 'no_answer', telnyxCallMeta: meta });
    const c = lastCall('l4');
    expect(c.callStage).toBeUndefined();
  });

  it('ignora una etapa contradictoria con el outcome', async () => {
    // "No atendió" + "hablé con el decisor" no puede ser. Guardarlo haría que
    // el % de paso de recepción mienta hacia arriba.
    await disp('l5', { outcome: 'no_answer', callStage: 'decisor', telnyxCallMeta: meta });
    const c = lastCall('l5');
    expect(c.callStage).toBeUndefined();
  });

  it('ignora un valor fuera de la whitelist sin romper la disposición', async () => {
    const r = await disp('l6', { outcome: 'hung_up', callStage: 'gerente_general', telnyxCallMeta: meta });
    expect(r.status).toBe(200); // nunca 400: el endpoint lo comparte el webhook del agente de voz
    const c = lastCall('l6');
    expect(c.callStage).toBeUndefined();
  });
});

describe('script-effectiveness — funnel de etapa y cobertura', () => {
  it('cuenta el paso de recepción sobre las que atendió una PERSONA', async () => {
    // Un contestador no es una recepción que se pueda pasar: meterlo en el
    // denominador hundiría el % por calidad de la base, no por el guion.
    await disp('l7', { outcome: 'hung_up', callStage: 'recepcion', telnyxCallMeta: meta });
    await disp('l8', { outcome: 'answered_interested', callStage: 'decisor', telnyxCallMeta: meta });
    await disp('l9', { outcome: 'voicemail', telnyxCallMeta: meta });
    const r = await request(app).get('/api/telnyx/script-effectiveness?range=all').set('Cookie', cookie);
    expect(r.status).toBe(200);
    const f = r.body.stageFunnel;
    expect(f.humanAnswered).toBe(f.recepcion + f.decisor);
    expect(f.pasoRecepcionPct).toBe(Math.round((f.decisor / f.humanAnswered) * 100));
    expect(f.contestador).toBeGreaterThan(0);
  });

  it('reporta cobertura: distingue "no funciona" de "nadie lo registró"', async () => {
    const r = await request(app).get('/api/telnyx/script-effectiveness?range=all').set('Cookie', cookie);
    const cov = r.body.coverage;
    expect(cov.calls).toBeGreaterThan(0);
    expect(cov.withStage).toBeGreaterThan(0);
    expect(cov.withStage).toBeLessThanOrEqual(cov.calls);
    // Ningún guion se atribuyó en estas llamadas: la vista tiene que poder
    // decirlo en vez de mostrar 0% como si fuera un resultado.
    expect(cov.withScripts).toBe(0);
    expect(r.body.scripts).toEqual([]);
  });

  it('atribuye la etapa al guion usado en esa llamada', async () => {
    await disp('l10', { outcome: 'answered_interested', callStage: 'decisor', telnyxCallMeta: { ...meta, scriptIdsUsed: ['sc_opener_a'] } });
    await disp('l11', { outcome: 'hung_up', callStage: 'recepcion', telnyxCallMeta: { ...meta, scriptIdsUsed: ['sc_opener_a'] } });
    const r = await request(app).get('/api/telnyx/script-effectiveness?range=all').set('Cookie', cookie);
    const s = r.body.scripts.find(x => x.scriptId === 'sc_opener_a');
    expect(s.used).toBe(2);
    expect(s.staged).toBe(2);
    expect(s.decisor).toBe(1);
    expect(s.recepcion).toBe(2);       // recepción o más arriba
    expect(s.recepcionPct).toBe(50);   // 1 de 2 pasó al decisor
    expect(s.interested).toBe(1);
    expect(s.interestedPct).toBe(50);
  });

  it('un porcentaje sin datos es null, no 0 — 0% se lee como fracaso', async () => {
    const r = await request(app).get('/api/telnyx/script-effectiveness?range=today').set('Cookie', cookie);
    for (const s of r.body.scripts) {
      if (s.staged === 0) expect(s.decisorPct).toBeNull();
    }
  });

  it('el SDR no puede leer la medición del equipo', async () => {
    const login = await request(app).post('/api/auth/login').send({ email: 'sdr-cs@local.test', password: 'cspass1234' });
    const r = await request(app).get('/api/telnyx/script-effectiveness?range=all').set('Cookie', login.headers['set-cookie']);
    expect(r.status).toBe(403);
  });
});

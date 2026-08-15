// Phase 31 Plan 02 (Task 3) — cobertura HTTP de los dos caminos de carga del
// compromiso (D-08 en call-disposition, D-09 en PATCH .../commitment) y del
// cierre. Setup calcado de tests/gate-next-action.test.js (mismo idioma de
// fixture/disp/hoursFromNow) — ver ese archivo para el modelo completo del
// reloj único (nextAction/callbackAt) heredado de la Phase 29.

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import request from 'supertest';

const tmpData = path.join(os.tmpdir(), `commitment-endpoints-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = 'admin-commit@local.test';
process.env.ADMIN_PASSWORD = 'commitpass1234';
process.env.JWT_SECRET = 'test-secret-commitment-endpoints-1234567890';
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
    { id: 'u_admin', email: 'admin-commit@local.test', name: 'AdminCommit', role: 'admin', status: 'active', setterId: '', password: pwd('commitpass1234'), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: 'u_setterA', email: 'setterA-commit@local.test', name: 'SetterA', role: 'setter', status: 'active', setterId: 's_owner', password: pwd('setterpass'), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: 'u_setterB', email: 'setterB-commit@local.test', name: 'SetterB', role: 'setter', status: 'active', setterId: 's_other', password: pwd('setterpass'), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  ],
  invites: [], sessions: [],
}, null, 2));

// Teléfonos +521 (México, no bloqueado por _expensiveTariffLabel) con >= 7
// dígitos (regla #163) — si no, el lead nunca entra en las colas.
const lead = (n, extra) => ({
  num: n, name: 'L' + n, phone: '+521555100' + String(n).padStart(4, '0'),
  assignedTo: 's_owner', conexion: 'sin_wsp', estado: 'sin_contactar',
  ...extra,
});

fs.writeFileSync(path.join(tmpData, 'setters.json'), JSON.stringify({
  setters: [{ id: 's_owner', name: 'Owner' }, { id: 's_other', name: 'Other' }],
  variants: [],
  leads: {
    // Camino A (call-disposition + commitment)
    l_a_enviar_info: lead(1),
    l_a_hereda_fecha: lead(2),
    l_a_fecha_propia: lead(3),
    l_a_tipo_invalido: lead(4),
    l_a_string: lead(5),
    l_a_null: lead(6),
    l_a_terminal: lead(7),
    // Camino B (PATCH .../commitment)
    l_b_socio: lead(10),
    l_b_parte_explicita: lead(11),
    l_b_validacion: lead(12),
    l_b_terminal: lead(13, { estado: 'descartado' }),
    l_b_cerrar_generico: lead(14),
    l_b_cerrar_enviar_info: lead(15),
    l_b_cerrar_sin_pendiente: lead(16),
    l_b_cerrar_dos_veces: lead(17),
    l_b_estado_basura: lead(18),
    l_b_reemplaza: lead(19),
    // Seguridad
    l_sec_crear: lead(20),
    l_sec_cerrar: lead(21),
    l_sec_dueno: lead(22),
    l_sec_motivo: lead(23),
    l_sec_extra: lead(24),
  },
  calendar: [], sessions: [],
}, null, 2));

const { app } = await import('../index.js');

let adminCookie = '';
let setterACookie = '';
let setterBCookie = '';

const disp = (id, body, cookie) => request(app).post(`/api/setters/leads/${id}/call-disposition`).set('Cookie', cookie || adminCookie).send(body);
const patchCommitment = (id, body, cookie) => request(app).patch(`/api/setters/leads/${id}/commitment`).set('Cookie', cookie || adminCookie).send(body);
const hoursFromNow = (iso) => (new Date(iso).getTime() - Date.now()) / 3600000;

beforeAll(async () => {
  let r = await request(app).post('/api/auth/login').send({ email: 'admin-commit@local.test', password: 'commitpass1234' });
  adminCookie = (r.headers['set-cookie'] || []).find((c) => c.startsWith('gs_session=')).split(';')[0];
  r = await request(app).post('/api/auth/login').send({ email: 'setterA-commit@local.test', password: 'setterpass' });
  setterACookie = (r.headers['set-cookie'] || []).find((c) => c.startsWith('gs_session=')).split(';')[0];
  r = await request(app).post('/api/auth/login').send({ email: 'setterB-commit@local.test', password: 'setterpass' });
  setterBCookie = (r.headers['set-cookie'] || []).find((c) => c.startsWith('gs_session=')).split(';')[0];
});

afterAll(() => {
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
});

// ────────────────────────────────────────────────────────────────────────
// CAMINO A — commitment dentro de call-disposition (D-08)
// ────────────────────────────────────────────────────────────────────────
describe('Camino A — commitment en call-disposition', () => {
  it('1. answered_interested + commitment enviar_info/yo → pendiente, nextAction origen compromiso, callId = ts del callLog', async () => {
    const r = await disp('l_a_enviar_info', {
      outcome: 'answered_interested',
      commitment: { tipo: 'enviar_info', parte: 'yo' },
    });
    expect(r.status).toBe(200);
    const { commitment, nextAction, callLog } = r.body.lead;
    expect(commitment).toBeTruthy();
    expect(commitment.estado).toBe('pendiente');
    expect(commitment.tipo).toBe('enviar_info');
    expect(commitment.parte).toBe('yo');
    expect(nextAction.origen).toBe('compromiso');
    // Atado a ESTA llamada: callId === ts del último entry del callLog.
    const lastEntry = callLog[callLog.length - 1];
    expect(commitment.callId).toBe(lastEntry.ts);
  });

  it('2. nextAction con dueAt propio + commitment SIN dueAt → el compromiso HEREDA esa fecha', async () => {
    const dueAt = new Date(Date.now() + 9 * 24 * 3600000).toISOString();
    const r = await disp('l_a_hereda_fecha', {
      outcome: 'answered_interested',
      nextAction: { dueAt },
      commitment: { tipo: 'pensarlo', parte: 'prospecto' },
    });
    expect(r.status).toBe(200);
    const { commitment, nextAction } = r.body.lead;
    expect(commitment.dueAt).toBe(dueAt);
    expect(nextAction.dueAt).toBe(dueAt);
    // Gana el compromiso por construcción: origen queda 'compromiso', no 'manual'.
    expect(nextAction.origen).toBe('compromiso');
  });

  it('3. commitment con dueAt propio → gana ese dueAt (no el default del mapa D-06)', async () => {
    const dueAt = new Date(Date.now() + 20 * 24 * 3600000).toISOString();
    const r = await disp('l_a_fecha_propia', {
      outcome: 'answered_interested',
      commitment: { tipo: 'hablar_con_socio', dueAt },
    });
    expect(r.status).toBe(200);
    expect(r.body.lead.commitment.dueAt).toBe(dueAt);
    expect(r.body.lead.nextAction.dueAt).toBe(dueAt);
  });

  it('4. commitment con tipo inventado → 200 igual, lead.commitment===null, nextAction es el default D-02 del outcome (nunca 4xx)', async () => {
    const r = await disp('l_a_tipo_invalido', {
      outcome: 'answered_interested',
      commitment: { tipo: 'tipo_que_no_existe' },
    });
    expect(r.status).toBe(200);
    expect(r.body.lead.commitment).toBeNull();
    expect(r.body.lead.nextAction).toBeTruthy();
    expect(r.body.lead.nextAction.origen).toBe('manual');
    expect(hoursFromNow(r.body.lead.nextAction.dueAt)).toBeGreaterThan(71);
    expect(hoursFromNow(r.body.lead.nextAction.dueAt)).toBeLessThan(73);
  });

  it('5. commitment como string → 200, sin compromiso, sin excepción', async () => {
    const r = await disp('l_a_string', { outcome: 'answered_interested', commitment: 'mandame info' });
    expect(r.status).toBe(200);
    expect(r.body.lead.commitment).toBeNull();
  });

  it('6. commitment como null → 200, sin compromiso, sin excepción', async () => {
    const r = await disp('l_a_null', { outcome: 'answered_interested', commitment: null });
    expect(r.status).toBe(200);
    expect(r.body.lead.commitment).toBeNull();
  });

  it('7. answered_not_interested (terminal) + commitment válido → 200, commitment===null y nextAction===null (el estado terminal gana, T-30-02)', async () => {
    const r = await disp('l_a_terminal', {
      outcome: 'answered_not_interested',
      commitment: { tipo: 'enviar_info', parte: 'yo' },
    });
    expect(r.status).toBe(200);
    expect(r.body.lead.estado).toBe('descartado');
    expect(r.body.lead.commitment).toBeNull();
    expect(r.body.lead.nextAction).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────
// CAMINO B — PATCH /api/setters/leads/:id/commitment (D-09)
// ────────────────────────────────────────────────────────────────────────
describe('Camino B — PATCH .../commitment (crear/reemplazar y cerrar)', () => {
  it('8. crear hablar_con_socio sin fecha → dueAt +5 días, parte prospecto (default), nextAction esperar_respuesta / origen compromiso', async () => {
    const r = await patchCommitment('l_b_socio', { tipo: 'hablar_con_socio' });
    expect(r.status).toBe(200);
    expect(r.body.commitment.tipo).toBe('hablar_con_socio');
    expect(r.body.commitment.parte).toBe('prospecto');
    const hrs = hoursFromNow(r.body.commitment.dueAt);
    expect(hrs).toBeGreaterThan(5 * 24 - 5 / 60);
    expect(hrs).toBeLessThan(5 * 24 + 5 / 60);
    expect(r.body.nextAction.tipo).toBe('esperar_respuesta');
    expect(r.body.nextAction.origen).toBe('compromiso');
  });

  it('9. crear con parte:"yo" explícito sobre hablar_con_socio → la parte explícita gana sobre el default', async () => {
    const r = await patchCommitment('l_b_parte_explicita', { tipo: 'hablar_con_socio', parte: 'yo' });
    expect(r.status).toBe(200);
    expect(r.body.commitment.parte).toBe('yo');
  });

  it('10. crear con tipo faltante → 400 con mensaje de valores válidos', async () => {
    const r = await patchCommitment('l_b_validacion', {});
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/tipo/i);
  });

  it('11. crear con tipo inválido → 400 con mensaje de valores válidos', async () => {
    const r = await patchCommitment('l_b_validacion', { tipo: 'no_existe' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/enviar_info/);
  });

  it('12. crear sobre un lead descartado → 409, el lead queda sin compromiso', async () => {
    const r = await patchCommitment('l_b_terminal', { tipo: 'otro' });
    expect(r.status).toBe(409);
    const check = await patchCommitment('l_b_terminal', { estado: 'cumplido' });
    // No hay compromiso pendiente (nunca se creó) → 409 en el cierre confirma
    // que el 409 de arriba no dejó nada guardado.
    expect(check.status).toBe(409);
  });

  it('13. cerrar {estado:"cumplido"} → commitment.estado cumplido, closedAt no vacío, nextAction===null, callbackAt===""', async () => {
    const created = await patchCommitment('l_b_cerrar_generico', { tipo: 'llamar_despues' });
    expect(created.status).toBe(200);
    const r = await patchCommitment('l_b_cerrar_generico', { estado: 'cumplido' });
    expect(r.status).toBe(200);
    expect(r.body.commitment.estado).toBe('cumplido');
    expect(r.body.commitment.closedAt).toBeTruthy();
    expect(r.body.nextAction).toBeNull();
    expect(r.body.lead.callbackAt).toBe('');
  });

  it('14. cerrar un enviar_info de parte "yo" con {estado:"cumplido"} → nextAction esperar_respuesta, origen compromiso, dueAt +48h (D-06 fila 1)', async () => {
    const created = await patchCommitment('l_b_cerrar_enviar_info', { tipo: 'enviar_info', parte: 'yo' });
    expect(created.status).toBe(200);
    const r = await patchCommitment('l_b_cerrar_enviar_info', { estado: 'cumplido' });
    expect(r.status).toBe(200);
    expect(r.body.commitment.estado).toBe('cumplido');
    expect(r.body.nextAction).toBeTruthy();
    expect(r.body.nextAction.tipo).toBe('esperar_respuesta');
    expect(r.body.nextAction.origen).toBe('compromiso');
    const hrs = hoursFromNow(r.body.nextAction.dueAt);
    expect(hrs).toBeGreaterThan(48 - 5 / 60);
    expect(hrs).toBeLessThan(48 + 5 / 60);
  });

  it('15. cerrar sin compromiso pendiente → 409', async () => {
    const r = await patchCommitment('l_b_cerrar_sin_pendiente', { estado: 'cumplido' });
    expect(r.status).toBe(409);
  });

  it('16. cerrar dos veces → la segunda devuelve 409', async () => {
    const created = await patchCommitment('l_b_cerrar_dos_veces', { tipo: 'pensarlo' });
    expect(created.status).toBe(200);
    const first = await patchCommitment('l_b_cerrar_dos_veces', { estado: 'incumplido' });
    expect(first.status).toBe(200);
    const second = await patchCommitment('l_b_cerrar_dos_veces', { estado: 'incumplido' });
    expect(second.status).toBe(409);
  });

  it('17. {estado:"basura"} → 400', async () => {
    const r = await patchCommitment('l_b_estado_basura', { estado: 'basura' });
    expect(r.status).toBe(400);
  });

  it('18. crear un compromiso nuevo sobre uno pendiente lo REEMPLAZA (limitación aceptada de D-01)', async () => {
    const first = await patchCommitment('l_b_reemplaza', { tipo: 'pensarlo' });
    expect(first.status).toBe(200);
    expect(first.body.commitment.tipo).toBe('pensarlo');
    const second = await patchCommitment('l_b_reemplaza', { tipo: 'pedir_presupuesto', parte: 'yo' });
    expect(second.status).toBe(200);
    expect(second.body.commitment.tipo).toBe('pedir_presupuesto');
    expect(second.body.commitment.estado).toBe('pendiente');
  });
});

// ────────────────────────────────────────────────────────────────────────
// SEGURIDAD (T-31-02) — dueño, visibilidad, sanitización defensiva
// ────────────────────────────────────────────────────────────────────────
describe('Seguridad — dueño y sanitización del PATCH .../commitment', () => {
  it('19. un setter que NO es dueño del lead recibe 403 al crear, y el lead no cambia', async () => {
    const r = await patchCommitment('l_sec_crear', { tipo: 'otro' }, setterBCookie);
    expect(r.status).toBe(403);
    const verify = await patchCommitment('l_sec_crear', { estado: 'cumplido' }, adminCookie);
    expect(verify.status).toBe(409); // no hay compromiso pendiente: el 403 no dejó nada
  });

  it('20. un setter que NO es dueño del lead recibe 403 al cerrar', async () => {
    const created = await patchCommitment('l_sec_cerrar', { tipo: 'otro' }, adminCookie);
    expect(created.status).toBe(200);
    const r = await patchCommitment('l_sec_cerrar', { estado: 'cumplido' }, setterBCookie);
    expect(r.status).toBe(403);
    // El compromiso sigue pendiente — el 403 no lo cerró.
    const stillPending = await patchCommitment('l_sec_cerrar', { estado: 'cumplido' }, adminCookie);
    expect(stillPending.status).toBe(200);
  });

  it('21. el dueño recibe 200 sobre su propio lead', async () => {
    const r = await patchCommitment('l_sec_dueno', { tipo: 'otro' }, setterACookie);
    expect(r.status).toBe(200);
  });

  it('22. un motivo de 500 chars queda truncado a 200 en el lead persistido', async () => {
    const longMotivo = 'x'.repeat(500);
    const r = await patchCommitment('l_sec_motivo', { tipo: 'otro', motivo: longMotivo });
    expect(r.status).toBe(200);
    expect(r.body.commitment.motivo.length).toBe(200);
  });

  it('23. un body con campos extra desconocidos no aparece en lead.commitment (exactamente las 11 claves del contrato)', async () => {
    const r = await patchCommitment('l_sec_extra', {
      tipo: 'otro',
      hackField: 'inyectado',
      __proto__: { polluted: true },
      estadoFalso: 'cumplido',
    });
    expect(r.status).toBe(200);
    const keys = Object.keys(r.body.commitment).sort();
    expect(keys).toEqual([
      'callId', 'canal', 'closedAt', 'closedBy', 'createdAt', 'createdBy',
      'dueAt', 'estado', 'motivo', 'parte', 'tipo',
    ].sort());
    expect(r.body.commitment.hackField).toBeUndefined();
    expect(r.body.commitment.polluted).toBeUndefined();
  });

  it('24. sin cookie (401), nunca 500', async () => {
    const r = await request(app).patch('/api/setters/leads/l_sec_extra/commitment').send({ tipo: 'otro' });
    expect(r.status).toBe(401);
  });
});

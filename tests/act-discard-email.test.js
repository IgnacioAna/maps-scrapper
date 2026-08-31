// Phase 32 Plan 02 (Task 3) — cobertura HTTP de POST .../discard (ACT-04) y
// POST .../send-material (ACT-05). Setup calcado de tests/act-whatsapp.test.js
// (mismo idioma de fixture/hoursFromNow/readLead).

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import request from 'supertest';

const tmpData = path.join(os.tmpdir(), `act-discard-email-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = 'admin-actde@local.test';
process.env.ADMIN_PASSWORD = 'actdepass1234';
process.env.JWT_SECRET = 'test-secret-act-discard-email-1234567890';
// Regla #121: env vars de IA/Resend a "" (nunca delete — dotenv las repone y
// el test intentaría mandar un email real / llamar a la IA real).
process.env.OPENAI_API_KEY = '';
process.env.MERCURY_API_KEY = '';
process.env.QWEN_API_KEY = '';
process.env.RESEND_API_KEY = '';
// Milestone v5.0: send-material ahora sale por Gmail SMTP. Sin estas dos, la vía
// 'resend' (renombrada por dentro a Gmail) cae al 409-con-mailtoUrl.
process.env.GMAIL_USER = '';
process.env.GMAIL_APP_PASSWORD = '';

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: crypto.scryptSync(plain, salt, 64).toString('hex') };
}

fs.writeFileSync(path.join(tmpData, 'auth.json'), JSON.stringify({
  users: [
    { id: 'u_admin', email: 'admin-actde@local.test', name: 'AdminActDe', role: 'admin', status: 'active', setterId: '', password: pwd('actdepass1234'), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: 'u_setterA', email: 'setterA-actde@local.test', name: 'SetterA', role: 'setter', status: 'active', setterId: 's_owner', password: pwd('setterpass'), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: 'u_setterB', email: 'setterB-actde@local.test', name: 'SetterB', role: 'setter', status: 'active', setterId: 's_other', password: pwd('setterpass'), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  ],
  invites: [], sessions: [],
}, null, 2));

// Teléfonos +521 (México, no bloqueado por _expensiveTariffLabel) con >= 7
// dígitos (regla #163) — si no, el lead nunca entra en las colas.
const lead = (n, extra) => ({
  num: n, name: 'L' + n, phone: '+521555200' + String(n).padStart(4, '0'),
  assignedTo: 's_owner', conexion: 'sin_wsp', estado: 'sin_contactar',
  country: 'Mexico',
  ...extra,
});

const settersFile = path.join(tmpData, 'setters.json');
fs.writeFileSync(settersFile, JSON.stringify({
  setters: [{ id: 's_owner', name: 'Owner' }, { id: 's_other', name: 'Other' }],
  variants: [],
  leads: {
    // Descarte (ACT-04)
    l_discard_nobody: lead(1),
    l_discard_reason: lead(2),
    l_discard_dnc_reason: lead(3),
    l_discard_dnc_manual: lead(4),
    l_discard_badreason: lead(5),
    // 2026-08-17: para el caso de la llamada sin marcar (ver el test al final
    // del bloque de descarte).
    l_discard_pending: lead(50),
    l_discard_pending_otro: lead(51),
    l_discard_commitment: lead(6),
    // Nota: trae un nextAction MANUAL (no de compromiso — origen:'compromiso'
    // es lo único que _closeCommitment apaga por su cuenta) para que el test
    // 7 realmente ejercite el _clearNextAction propio del endpoint, no el que
    // ya corre adentro de _closeCommitment cuando hay compromiso pendiente.
    l_discard_nocommitment: lead(7, {
      nextAction: { tipo: 'callback', dueAt: '2027-01-01T00:00:00.000Z', canal: 'llamada', motivo: '', origen: 'manual', createdAt: '2026-08-01T00:00:00.000Z', createdBy: 'SetterA' },
      callbackAt: '2027-01-01T00:00:00.000Z',
    }),
    l_discard_calllog: lead(8, {
      callLog: [
        { ts: '2026-08-01T00:00:00.000Z', outcome: 'no_answer' },
        { ts: '2026-08-02T00:00:00.000Z', outcome: 'voicemail' },
      ],
    }),
    l_discard_dnc_queue: lead(9),
    // RBAC
    l_sec_other: lead(10),
    l_sec_nocookie: lead(11),
    l_bulk_admin_only: lead(12),
    // Material por email (ACT-05)
    l_email_mailto: lead(13, { email: 'doc13@example.test' }),
    l_email_resend_unavail: lead(14, { email: 'doc14@example.test' }),
    l_email_noemail: lead(15),
    l_email_emptymsg: lead(16, { email: 'doc16@example.test' }),
    l_email_brand: lead(17, { email: 'doc17@example.test' }),
    l_email_long: lead(18, { email: 'doc18@example.test' }),
  },
  calendar: [], sessions: [],
}, null, 2));

const { app } = await import('../index.js');

let adminCookie = '';
let setterACookie = '';
let setterBCookie = '';

const discard = (id, body, cookie) => request(app).post(`/api/setters/leads/${id}/discard`).set('Cookie', cookie || adminCookie).send(body || {});
const sendMaterial = (id, body, cookie) => request(app).post(`/api/setters/leads/${id}/send-material`).set('Cookie', cookie || adminCookie).send(body || {});
const patchCommitment = (id, body, cookie) => request(app).patch(`/api/setters/leads/${id}/commitment`).set('Cookie', cookie || adminCookie).send(body);
const bulk = (body, cookie) => request(app).post('/api/setters/leads/bulk').set('Cookie', cookie || adminCookie).send(body);
const hoursFromNow = (iso) => (new Date(iso).getTime() - Date.now()) / 3600000;

// Relee el lead DIRECTO del disco — para probar que un corte (409/502/400) no
// persistió nada.
function readLead(id) {
  const raw = JSON.parse(fs.readFileSync(settersFile, 'utf8'));
  return raw.leads[id];
}

beforeAll(async () => {
  let r = await request(app).post('/api/auth/login').send({ email: 'admin-actde@local.test', password: 'actdepass1234' });
  adminCookie = (r.headers['set-cookie'] || []).find((c) => c.startsWith('gs_session=')).split(';')[0];
  r = await request(app).post('/api/auth/login').send({ email: 'setterA-actde@local.test', password: 'setterpass' });
  setterACookie = (r.headers['set-cookie'] || []).find((c) => c.startsWith('gs_session=')).split(';')[0];
  r = await request(app).post('/api/auth/login').send({ email: 'setterB-actde@local.test', password: 'setterpass' });
  setterBCookie = (r.headers['set-cookie'] || []).find((c) => c.startsWith('gs_session=')).split(';')[0];
});

afterAll(() => {
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
});

// ────────────────────────────────────────────────────────────────────────
// Descarte (ACT-04)
// ────────────────────────────────────────────────────────────────────────
describe('Descarte (ACT-04)', () => {
  it('1. s_owner descarta su lead sin body → 200, estado descartado, interes no, disqualifyReason vacío (D-14)', async () => {
    const r = await discard('l_discard_nobody', undefined, setterACookie);
    expect(r.status).toBe(200);
    expect(r.body.lead.estado).toBe('descartado');
    expect(r.body.lead.interes).toBe('no');
    expect(r.body.lead.disqualifyReason).toBe('');
  });

  it('2. Con {reason:"no_es_icp"} → disqualifyReason = no_es_icp, doNotCall false', async () => {
    const r = await discard('l_discard_reason', { reason: 'no_es_icp' }, setterACookie);
    expect(r.status).toBe(200);
    expect(r.body.lead.disqualifyReason).toBe('no_es_icp');
    expect(r.body.lead.doNotCall).toBe(false);
    expect(r.body.doNotCall).toBe(false);
  });

  it('3. Con {reason:"no_contactar"} → DNC true, doNotCallReason = no_contactar, doNotCallBy = nombre del user autenticado (nunca del body)', async () => {
    const r = await discard('l_discard_dnc_reason', { reason: 'no_contactar', doNotCallBy: 'nombre inventado' }, setterACookie);
    expect(r.status).toBe(200);
    expect(r.body.lead.doNotCall).toBe(true);
    expect(r.body.doNotCall).toBe(true);
    expect(r.body.lead.doNotCallReason).toBe('no_contactar');
    expect(r.body.lead.doNotCallBy).toBe('SetterA');
    expect(r.body.lead.doNotCallBy).not.toBe('nombre inventado');
  });

  it('4. Con {doNotCall:true} y sin razón → DNC true, doNotCallReason = manual', async () => {
    const r = await discard('l_discard_dnc_manual', { doNotCall: true }, setterACookie);
    expect(r.status).toBe(200);
    expect(r.body.lead.doNotCall).toBe(true);
    expect(r.body.lead.doNotCallReason).toBe('manual');
  });

  it('5. Con {reason:"basura"} → 200 y disqualifyReason vacío (nunca 4xx)', async () => {
    const r = await discard('l_discard_badreason', { reason: 'basura' }, setterACookie);
    expect(r.status).toBe(200);
    expect(r.body.lead.disqualifyReason).toBe('');
  });

  it('6. Lead con compromiso PENDIENTE → tras descartar: commitment vencido con closedAt, nextAction/callbackAt apagados, commitmentClosed:true', async () => {
    const created = await patchCommitment('l_discard_commitment', { tipo: 'enviar_info', parte: 'yo' }, setterACookie);
    expect(created.status).toBe(200);
    expect(created.body.commitment.estado).toBe('pendiente');

    const r = await discard('l_discard_commitment', undefined, setterACookie);
    expect(r.status).toBe(200);
    expect(r.body.commitmentClosed).toBe(true);
    expect(r.body.lead.commitment.estado).toBe('vencido');
    expect(r.body.lead.commitment.closedAt).toBeTruthy();
    expect(r.body.lead.nextAction == null).toBe(true);
    expect(r.body.lead.callbackAt).toBe('');
  });

  it('7. Lead SIN compromiso (con un nextAction manual previo) → commitmentClosed:false, nextAction igualmente apagado', async () => {
    const before = readLead('l_discard_nocommitment');
    expect(before.nextAction).toBeTruthy();
    expect(before.nextAction.origen).toBe('manual');
    const r = await discard('l_discard_nocommitment', undefined, setterACookie);
    expect(r.status).toBe(200);
    expect(r.body.commitmentClosed).toBe(false);
    expect(r.body.lead.nextAction == null).toBe(true);
    expect(r.body.lead.callbackAt).toBe('');
  });

  it('8. lead.callLog conserva la MISMA longitud que antes del descarte; última entry de interactions es discard sin setterId', async () => {
    const before = readLead('l_discard_calllog');
    expect(before.callLog.length).toBe(2);
    const r = await discard('l_discard_calllog', undefined, setterACookie);
    expect(r.status).toBe(200);
    expect(r.body.lead.callLog.length).toBe(2);
    const interactions = r.body.lead.interactions;
    const last = interactions[interactions.length - 1];
    expect(last.action).toBe('discard');
    expect('setterId' in last).toBe(false);
  });

  it('9. GET /leads/sin-wsp como s_owner ya no incluye el lead descartado por DNC', async () => {
    let callable = (await request(app).get('/api/setters/leads/sin-wsp?include=callable').set('Cookie', setterACookie)).body.leads.map((l) => l.id);
    expect(callable).toContain('l_discard_dnc_queue');
    const r = await discard('l_discard_dnc_queue', { reason: 'no_contactar' }, setterACookie);
    expect(r.status).toBe(200);
    callable = (await request(app).get('/api/setters/leads/sin-wsp?include=callable').set('Cookie', setterACookie)).body.leads.map((l) => l.id);
    expect(callable).not.toContain('l_discard_dnc_queue');
  });

  // 2026-08-17 — el bug: descartar dejaba viva la "llamada sin marcar" del
  // lead, y la traba de disposición la usa para bloquear TODOS los puntos de
  // discado. Nadie le va a marcar el resultado a un lead muerto, así que ese
  // pendiente quedaba huérfano para siempre. El frontend limpia su gate, pero
  // sin esto el pendiente sobrevivía en el server y la traba volvía al primer
  // refresh. Mismo remedio que ya usa transfer-portfolio.
  const armarPendiente = (leadId, cookie) => request(app)
    .post('/api/setters/pending-calls').set('Cookie', cookie)
    .send({ leadId, startedAt: new Date(Date.now() - 120000).toISOString(), endedAt: new Date().toISOString(), durationSecs: 45 });
  const pendientesDe = async (cookie) => ((await request(app).get('/api/setters/pending-calls').set('Cookie', cookie)).body.pending || []).map((p) => p.leadId);

  it('9c. descartar resuelve la llamada sin marcar de ESE lead', async () => {
    expect((await armarPendiente('l_discard_pending', setterACookie)).status).toBe(200);
    expect(await pendientesDe(setterACookie)).toContain('l_discard_pending');

    const r = await discard('l_discard_pending', { reason: 'no_es_icp' }, setterACookie);
    expect(r.status).toBe(200);
    expect(r.body.pendientesLimpiados).toBe(1);
    expect(await pendientesDe(setterACookie)).not.toContain('l_discard_pending');
  });

  it('9d. no toca los pendientes de otros leads', async () => {
    await armarPendiente('l_discard_pending_otro', setterACookie);
    await armarPendiente('l_discard_commitment', setterACookie);
    const antes = await pendientesDe(setterACookie);
    expect(antes).toContain('l_discard_pending_otro');
    expect(antes).toContain('l_discard_commitment');

    const r = await discard('l_discard_pending_otro', undefined, setterACookie);
    expect(r.body.pendientesLimpiados).toBe(1);
    const despues = await pendientesDe(setterACookie);
    expect(despues).not.toContain('l_discard_pending_otro');
    expect(despues).toContain('l_discard_commitment'); // el ajeno sigue vivo
  });

  it('9e. descartar un lead sin llamadas pendientes no rompe ni reporta de más', async () => {
    const r = await discard('l_discard_badreason', { reason: 'no_existe_esta_razon' }, setterACookie);
    expect(r.status).toBe(200);
    expect(r.body.pendientesLimpiados).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────
// RBAC (el hueco que cierra este plan)
// ────────────────────────────────────────────────────────────────────────
describe('RBAC', () => {
  it('10. s_other sobre un lead de s_owner → 403', async () => {
    const r = await discard('l_sec_other', undefined, setterBCookie);
    expect(r.status).toBe(403);
  });

  it('11. Sin cookie → 401', async () => {
    const r = await request(app).post('/api/setters/leads/l_sec_nocookie/discard').send({});
    expect(r.status).toBe(401);
  });

  it('11b. Lead inexistente → 404', async () => {
    const r = await discard('no_existe_este_id', undefined, adminCookie);
    expect(r.status).toBe(404);
  });

  it('12. El bulk sigue siendo admin-only: POST /leads/bulk discard con cookie de setter → 403 (regresión explícita)', async () => {
    const r = await bulk({ leadIds: ['l_bulk_admin_only'], action: 'discard' }, setterACookie);
    expect(r.status).toBe(403);
    expect(readLead('l_bulk_admin_only').estado).toBe('sin_contactar');
  });
});

// ────────────────────────────────────────────────────────────────────────
// Material por email (ACT-05)
// ────────────────────────────────────────────────────────────────────────
describe('Material por email (ACT-05)', () => {
  let mailtoResp;

  it('13. via:"mailto" con mensaje sobre lead con email → 200, sent:false, mailtoUrl con mailto: y subject/body url-encodeados', async () => {
    mailtoResp = await sendMaterial('l_email_mailto', { via: 'mailto', message: 'te paso la info' }, setterACookie);
    expect(mailtoResp.status).toBe(200);
    expect(mailtoResp.body.sent).toBe(false);
    expect(mailtoResp.body.mailtoUrl).toMatch(/^mailto:/);
    expect(mailtoResp.body.mailtoUrl).toContain(encodeURIComponent('te paso la info'));
    expect(mailtoResp.body.mailtoUrl).toContain('subject=');
    expect(mailtoResp.body.mailtoUrl).toContain('body=');
  });

  it('14. Tras ese envío: commitment enviar_info/email/cumplido, nextAction esperar_respuesta a 71-73hs', () => {
    const c = mailtoResp.body.lead.commitment;
    expect(c.tipo).toBe('enviar_info');
    expect(c.canal).toBe('email');
    expect(c.estado).toBe('cumplido');
    const na = mailtoResp.body.lead.nextAction;
    expect(na.tipo).toBe('esperar_respuesta');
    const h = hoursFromNow(na.dueAt);
    expect(h).toBeGreaterThan(71);
    expect(h).toBeLessThan(73);
  });

  it('15. La entry de interactions es material_sent con canal:email', () => {
    const interactions = mailtoResp.body.lead.interactions;
    const last = interactions[interactions.length - 1];
    expect(last.action).toBe('material_sent');
    expect(last.canal).toBe('email');
  });

  it('16. via:"resend" sin credenciales Gmail → 409 con resendUnavailable:true y mailtoUrl, lead sin cambios', async () => {
    const before = readLead('l_email_resend_unavail');
    expect(before.commitment == null).toBe(true);
    const r = await sendMaterial('l_email_resend_unavail', { via: 'resend', message: 'info por resend' }, setterACookie);
    expect(r.status).toBe(409);
    expect(r.body.resendUnavailable).toBe(true);
    expect(r.body.mailtoUrl).toMatch(/^mailto:/);
    const after = readLead('l_email_resend_unavail');
    expect(after.commitment == null).toBe(true);
    expect(after.interactions == null || after.interactions.length === 0).toBe(true);
  });

  it('17. Sin email en el lead ni en el body → 400', async () => {
    const r = await sendMaterial('l_email_noemail', { message: 'hola' }, setterACookie);
    expect(r.status).toBe(400);
  });

  it('18. message vacío → 400', async () => {
    const r = await sendMaterial('l_email_emptymsg', { message: '' }, setterACookie);
    expect(r.status).toBe(400);
  });

  it('19. subject con la marca → el mailtoUrl no la contiene (D-08 vía _stripBrandMentions)', async () => {
    const r = await sendMaterial('l_email_brand', { via: 'mailto', subject: 'Info de SCM', message: 'hola' }, setterACookie);
    expect(r.status).toBe(200);
    expect(r.body.mailtoUrl).not.toMatch(/SCM/);
  });

  it('20. Aserción de fuente (D-18): el bloque del endpoint send-material no contiene <img (sin pixel de tracking)', () => {
    const src = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const start = src.indexOf("app.post('/api/setters/leads/:id/send-material'");
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf('// ── Deduplicar leads de setters', start);
    expect(end).toBeGreaterThan(start);
    const block = src.slice(start, end);
    expect(block).not.toContain('<img');
    expect(block.toLowerCase()).not.toContain('pixel');
  });

  it('21. Milestone v5.0 REVERTIDO: send-material sale por Resend (_sendPlaceholderEmail) por default, con Gmail detrás de MAIL_TRANSPORT y parte text/plain', () => {
    const src = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const start = src.indexOf("app.post('/api/setters/leads/:id/send-material'");
    const end = src.indexOf('// ── Deduplicar leads de setters', start);
    const block = src.slice(start, end);
    // Railway bloquea SMTP saliente → el canal por default volvió a Resend…
    expect(block).toContain('_sendPlaceholderEmail(');
    // …pero Gmail NO se borró: queda detrás del flag para local / Railway Pro.
    expect(block).toContain('MAIL_TRANSPORT');
    expect(block).toContain('_sendGmailEmail(');
    // …con parte text/plain (MAIL-03) en las dos vías…
    expect(block).toContain('textBody:');
    // …el From del prospecto se fija con PLACEHOLDER_FROM_EMAIL (vincca.co)…
    expect(block).toContain('PLACEHOLDER_FROM_EMAIL');
    // …y el gate del 409 sigue mirando credenciales de ambos transportes.
    expect(block).toContain('RESEND_API_KEY');
    expect(block).toContain('GMAIL_USER');
  });

  it('22. El helper _sendGmailEmail existe, usa smtp.gmail.com con GMAIL_USER/GMAIL_APP_PASSWORD y barre puertos 465/587', () => {
    const src = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const start = src.indexOf('async function _sendGmailEmail(');
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf('\n}\n', start);
    const block = src.slice(start, end > start ? end : start + 3200);
    expect(block).toContain('smtp.gmail.com');
    expect(block).toContain('process.env.GMAIL_USER');
    expect(block).toContain('process.env.GMAIL_APP_PASSWORD');
    // Barrido de conexión: prueba 465 (TLS directo) y 587 (STARTTLS) hasta que
    // una mande — Railway dio timeout con IPv4 forzado en 465.
    expect(block).toContain('port: 465');
    expect(block).toContain('port: 587');
    // Contrato preservado: misma forma de retorno { sent, reason }.
    expect(block).toContain('sent: false');
    expect(block).toContain('sent: true');
    // Un fallo de auth corta el barrido (no se arregla cambiando de puerto).
    expect(block).toMatch(/responseCode === 535|Auth Gmail rechazada/);
  });

  it('23. GUARDA DURA (MAIL-09): via:"mailto" con {{HORARIO_1}} sin resolver → 400, no registra', async () => {
    const before = readLead('l_email_mailto');
    const beforeCount = (before.interactions || []).length;
    const r = await sendMaterial('l_email_mailto', { via: 'mailto', message: 'Le queda mejor {{HORARIO_1}} o {{HORARIO_2}}?' }, setterACookie);
    expect(r.status).toBe(400);
    const after = readLead('l_email_mailto');
    expect((after.interactions || []).length).toBe(beforeCount);
  });

  it('24. GUARDA DURA (MAIL-09): corchetes en el asunto → 400', async () => {
    const r = await sendMaterial('l_email_mailto', { via: 'mailto', subject: 'Hola [DÍA]', message: 'texto limpio' }, setterACookie);
    expect(r.status).toBe(400);
  });

  it('25. Un cuerpo sin variables sin resolver pasa la guarda (via mailto → 200)', async () => {
    const r = await sendMaterial('l_email_mailto', { via: 'mailto', message: 'Le queda mejor el jueves 10hs o el viernes 16hs?' }, setterACookie);
    expect(r.status).toBe(200);
  });

  it('26. MEMBRETADO LIVIANO Y PROLIJO (MAIL-08, 2026-08-31): send-material usa _brandedEmailHtml sin la tarjeta de marketing (Principal, no Promociones) pero con marca', () => {
    const src = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const start = src.indexOf("app.post('/api/setters/leads/:id/send-material'");
    const end = src.indexOf('// ── Deduplicar leads de setters', start);
    const block = src.slice(start, end);
    expect(block).toContain('_brandedEmailHtml(');
    const bStart = src.indexOf('function _brandedEmailHtml(');
    expect(bStart).toBeGreaterThan(-1);
    const bBlock = src.slice(bStart, bStart + 2200);
    // SIN los disparadores del clasificador de Promociones: sin tarjeta centrada
    // con fondo/borde ni fondo de página detrás del mail.
    expect(bBlock).not.toContain('#FAF7F0');   // fondo de la tarjeta (ya no)
    expect(bBlock).not.toContain('#F1EDE3');   // fondo de página detrás del mail (ya no)
    expect(bBlock).not.toMatch(/width="600"/); // tabla centrada (ya no)
    // CON marca prolija: acento bronce corto + wordmark Vincca + firma.
    expect(bBlock).toContain('#A67C1B');       // acento bronce (44px) + V del wordmark
    expect(bBlock).toContain('>V</span>');     // wordmark Vincca
    expect(bBlock).toContain('Ignacio Ana');
    // A lo sumo 2 links (varios links = señal de promoción).
    const links = (bBlock.match(/<a\s/g) || []).length;
    expect(links).toBeLessThanOrEqual(2);
    // D-18: cero imágenes / beacons de tracking en el membretado.
    expect(bBlock).not.toContain('<img');
  });

  it('26b. CAP EMAIL (2026-08-31): un cuerpo > 900 chars NO se trunca en el correo (el cap de 900 era para wa.me)', async () => {
    // El template del puente ronda ~1250 chars; con el cap viejo de 900 el mail
    // salía cortado a mitad de palabra, sin la pregunta de horarios ni el cierre.
    const msg = 'Detalle del correo. ' + 'ancla '.repeat(180) + 'CIERRE-72H-FIN';
    expect(msg.length).toBeGreaterThan(900);
    const r = await sendMaterial('l_email_long', { via: 'mailto', message: msg }, setterACookie);
    expect(r.status).toBe(200);
    const decoded = decodeURIComponent((r.body.mailtoUrl.split('&body=')[1] || ''));
    // El final del mensaje sobrevive → no se cortó a 900.
    expect(decoded).toContain('CIERRE-72H-FIN');
  });

  it('27. Email templates: presentacion_puente aceptado por email; envio_info (WhatsApp) no cuenta como email', () => {
    const src = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const start = src.indexOf('const ACT_EMAIL_TEMPLATE_IDS = new Set(');
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, src.indexOf(');', start));
    expect(block).toContain("'presentacion_puente'");
    expect(block).not.toContain("'envio_info'");
  });
});

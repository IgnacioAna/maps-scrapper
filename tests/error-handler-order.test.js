// Auditoría 2026-09-03 (OBS-01 / OBS-04) — observabilidad de errores.
//
// Había DOS error handlers globales. El primero (montado a ~200 líneas del
// final) respondía 500 y nunca llamaba next(err); como Express recorre los
// handlers en orden de registro, para las ~237 rutas registradas antes ese
// ganaba siempre y el que SÍ loguea no corría nunca. Y el segundo estaba
// ANTES de mountWa, así que los ~56 endpoints de /api/wa/* no caían en
// ninguno (13 de sus 18 rutas async no tienen try/catch propio) y respondían
// el HTML de finalhandler.
//
// Efecto conjunto: logError es el único que escribe ERROR_LOG, así que
// /api/admin/errors/recent y el bloque checks.errors de /api/admin/health no
// contaban ni un error de ruta. El panel de salud decía "0 errores" por
// construcción, no por estar sano.
//
// Este archivo es estructural a propósito (lee index.js como texto, patrón que
// el repo ya usa en app-version / dtpicker-wiring / gate-next-action): el orden
// de registro de middlewares no se puede observar desde afuera sin provocar un
// throw real en una ruta arbitraria, y lo que hay que proteger es justamente
// que nadie apendee un `app.use` al final del archivo.

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import request from 'supertest';

const tmpData = path.join(os.tmpdir(), `err-handler-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = 'admin-eh@local.test';
process.env.ADMIN_PASSWORD = 'ehpass1234';
process.env.JWT_SECRET = 'test-secret-error-handler-1234567890';
// Regla #121: env de IA a "" (nunca delete — dotenv las repone del .env).
process.env.OPENAI_API_KEY = '';
process.env.MERCURY_API_KEY = '';
process.env.QWEN_API_KEY = '';

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: crypto.scryptSync(plain, salt, 64).toString('hex') };
}
fs.writeFileSync(path.join(tmpData, 'auth.json'), JSON.stringify({
  users: [{ id: 'u', email: 'admin-eh@local.test', name: 'AdminEH', role: 'admin', status: 'active', setterId: '', password: pwd('ehpass1234') }],
  invites: [], sessions: [],
}, null, 2));
fs.writeFileSync(path.join(tmpData, 'setters.json'), JSON.stringify({ setters: [], variants: [], leads: {}, calendar: [], sessions: [] }, null, 2));

const { app } = await import('../index.js');
const ERROR_LOG = path.join(tmpData, 'error.log');

const src = fs.readFileSync(path.join(process.cwd(), 'index.js'), 'utf8');
const lineOf = (idx) => src.slice(0, idx).split('\n').length;

describe('error handler global — orden de registro', () => {
  it('hay UN solo error handler global (4 argumentos), no dos', () => {
    const matches = [...src.matchAll(/app\.use\(\s*\(\s*err\s*,/g)];
    expect(matches.length).toBe(1);
  });

  it('el error handler se registra DESPUÉS de mountWa (si no, /api/wa/* no cae en ninguno)', () => {
    const mountIdx = src.indexOf('mountWa(app,');
    expect(mountIdx).toBeGreaterThan(-1);
    const errIdx = src.search(/app\.use\(\s*\(\s*err\s*,/);
    expect(errIdx).toBeGreaterThan(-1);
    expect(lineOf(errIdx)).toBeGreaterThan(lineOf(mountIdx));
  });

  it('el handler llama a logError — es el único que escribe ERROR_LOG', () => {
    const errIdx = src.search(/app\.use\(\s*\(\s*err\s*,/);
    const block = src.slice(errIdx, errIdx + 1200);
    expect(block).toContain('logError(err');
    expect(block).toContain('req.path');
  });

  it('sigue sin filtrar err.message en producción (el guard viajó con el handler)', () => {
    const errIdx = src.search(/app\.use\(\s*\(\s*err\s*,/);
    const block = src.slice(errIdx, errIdx + 1600);
    expect(block).toContain("process.env.NODE_ENV === 'production'");
    expect(block).toContain('Error interno del servidor');
  });

  it('ninguna ruta ni mount queda registrada DESPUÉS del error handler', () => {
    const errIdx = src.search(/app\.use\(\s*\(\s*err\s*,/);
    // Desde el handler hasta el final: no puede aparecer el registro de una
    // ruta nueva ni otro mount. Es el modo de fallo que vuelve solo — alguien
    // apendea `app.get(...)` al final del archivo y deja de loguear sin que
    // nada se rompa a la vista.
    const tail = src.slice(errIdx);
    expect(tail).not.toMatch(/\napp\.(get|post|put|patch|delete)\s*\(/);
    expect(tail).not.toMatch(/\nmount[A-Z]\w*\s*\(app/);
  });

  it('registerWaRoutes corre SÍNCRONO en mountWa, antes del primer await (por eso alcanza con registrar el handler en la línea siguiente)', () => {
    const wa = fs.readFileSync(path.join(process.cwd(), 'src', 'wa', 'index.js'), 'utf8');
    const fnIdx = wa.indexOf('export async function mountWa(');
    expect(fnIdx).toBeGreaterThan(-1);
    const regIdx = wa.indexOf('registerWaRoutes(app', fnIdx);
    const awaitIdx = wa.indexOf('await ', fnIdx);
    expect(regIdx).toBeGreaterThan(fnIdx);
    expect(awaitIdx).toBeGreaterThan(regIdx);
  });
});

// Prueba FUNCIONAL de que el handler se alcanza y escribe: un body JSON
// malformado hace que express.json() tire un SyntaxError con status 400, que
// viaja por next(err) hasta el handler global — el mismo camino que recorre el
// throw de cualquier ruta. Antes del fix esto moría en el handler duplicado,
// que respondía sin loguear, y ERROR_LOG quedaba vacío.
describe('error handler global — se alcanza y escribe en ERROR_LOG', () => {
  let adminCookie = '';
  beforeAll(async () => {
    const r = await request(app).post('/api/auth/login').send({ email: 'admin-eh@local.test', password: 'ehpass1234' });
    adminCookie = (r.headers['set-cookie'] || []).find((c) => c.startsWith('gs_session=')).split(';')[0];
  });
  afterAll(() => { try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {} });

  it('un error de parseo responde JSON (no el HTML de finalhandler) y deja una línea en el log', async () => {
    const antes = fs.existsSync(ERROR_LOG) ? fs.readFileSync(ERROR_LOG, 'utf8').split('\n').filter(Boolean).length : 0;

    const r = await request(app)
      .post('/api/setters/leads/l_x/alt-contact')
      .set('Cookie', adminCookie)
      .set('Content-Type', 'application/json')
      .send('{"phone": ');   // JSON roto a propósito

    expect(r.status).toBe(400);
    // Contrato de API: JSON, no una página de error de Express.
    expect(r.headers['content-type']).toMatch(/json/);
    expect(typeof r.body.error).toBe('string');

    expect(fs.existsSync(ERROR_LOG)).toBe(true);
    const lineas = fs.readFileSync(ERROR_LOG, 'utf8').split('\n').filter(Boolean);
    expect(lineas.length).toBeGreaterThan(antes);
    const ultima = JSON.parse(lineas[lineas.length - 1]);
    expect(ultima.path).toBe('/api/setters/leads/l_x/alt-contact');
    expect(ultima.method).toBe('POST');
  });

  it('lo que el handler logueó aparece en /api/admin/errors/recent (el panel dejó de decir 0 por construcción)', async () => {
    const r = await request(app).get('/api/admin/errors/recent').set('Cookie', adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.total).toBeGreaterThan(0);
    expect(r.body.errors.some((e) => e.path === '/api/setters/leads/l_x/alt-contact')).toBe(true);
  });

  it('/api/admin/health cuenta ese error en checks.errors y reporta prodGuardsActive (CONF-01)', async () => {
    const r = await request(app).get('/api/admin/health').set('Cookie', adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.checks.errors.last24hCount).toBeGreaterThan(0);
    // CONF-01: el health ya no dice "production" cuando la variable no está.
    expect(r.body.checks.server.nodeEnv).toBe('test');
    expect(r.body.checks.server.prodGuardsActive).toBe(false);
  });
});

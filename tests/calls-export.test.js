// Auditoría 2026-09-03 · Fase A-bis (EXPORT-01) — paginación de
// GET /api/telnyx/calls/recent.
//
// El endpoint no tenía NINGÚN test. Devolvía `calls.slice(0, limit)` con el
// limit capado en 500 y `total` completo: un cliente externo podía DETECTAR
// que había más (total > calls.length) pero no llegar a ellas. Hoy son ~344
// llamadas con transcripción y entra justo; el proyecto vincca-ventas, que las
// analiza, hoy lee data/setters.json del disco y por eso trabaja con datos
// congelados al último pre-deploy.
//
// El tope de 500 por página SE QUEDA a propósito: devolver la base entera en un
// JSON sin límite es cómo se tumba el container cuando el callLog crezca. Lo
// que se agrega es `offset` para poder cruzar el corte.

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `calls-export-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-ce@local.test";
process.env.ADMIN_PASSWORD = "cepass1234";
process.env.ADMIN_NAME = "AdminCE";
process.env.JWT_SECRET = "test-secret-calls-export-1234567890";
// Regla #121: env de IA a "" (nunca delete — dotenv las repone del .env local).
process.env.OPENAI_API_KEY = "";
process.env.MERCURY_API_KEY = "";
process.env.QWEN_API_KEY = "";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  return { salt, hash: crypto.scryptSync(plain, salt, 64).toString("hex") };
}

fs.writeFileSync(path.join(tmpData, "auth.json"), JSON.stringify({
  users: [
    { id: "user_admin_ce", email: "admin-ce@local.test", name: "AdminCE", role: "admin", status: "active", setterId: "", password: pwd("cepass1234") },
    { id: "user_ana_ce", email: "ana-ce@local.test", name: "AnaCE", role: "setter", status: "active", setterId: "setter_ana", password: pwd("anapass1234") },
  ],
  invites: [], sessions: [],
}, null, 2));

// 7 llamadas de Ana + 3 de Beto = 10 en total, todas telnyx_webrtc y con ts
// distinto (el orden es ts desc y la paginación depende de que sea estable).
// Regla #163: teléfonos de >= 7 dígitos.
const base = Date.parse("2026-08-01T12:00:00.000Z");
const mkCalls = (n, offsetMin) => Array.from({ length: n }, (_, i) => ({
  ts: new Date(base + (offsetMin + i) * 60000).toISOString(),
  outcome: i % 2 === 0 ? "answered_interested" : "no_answer",
  duration: 30 + i,
  channel: "telnyx_webrtc",
  by: "",
}));

fs.writeFileSync(path.join(tmpData, "setters.json"), JSON.stringify({
  setters: [{ id: "setter_ana", name: "AnaCE" }, { id: "setter_beto", name: "BetoCE" }],
  variants: [],
  leads: {
    lead_ana: {
      num: 1, name: "Clinica Ana", phone: "+525550000001", country: "México",
      assignedTo: "setter_ana", estado: "sin_contactar", callLog: mkCalls(7, 0),
    },
    lead_beto: {
      num: 2, name: "Clinica Beto", phone: "+525550000002", country: "México",
      assignedTo: "setter_beto", estado: "sin_contactar", callLog: mkCalls(3, 100),
    },
    // Ruido que NO debe contarse: un canal que no es Telnyx.
    lead_otro_canal: {
      num: 3, name: "Clinica Manual", phone: "+525550000003", country: "México",
      assignedTo: "setter_ana", estado: "sin_contactar",
      callLog: [{ ts: new Date(base + 500 * 60000).toISOString(), outcome: "no_answer", duration: 5, channel: "manual" }],
    },
  },
  calendar: [], sessions: [],
}, null, 2));

const { app } = await import("../index.js");
const URL_BASE = "/api/telnyx/calls/recent";
let adminCookie = "", anaCookie = "";

async function login(email, password) {
  const r = await request(app).post("/api/auth/login").send({ email, password });
  expect(r.status).toBe(200);
  return (r.headers["set-cookie"] || []).find((c) => c.startsWith("gs_session=")).split(";")[0];
}
const get = (qs, cookie) => request(app).get(`${URL_BASE}${qs}`).set("Cookie", cookie || adminCookie);
const clave = (c) => `${c.leadId}#${c.callIdx}`;

beforeAll(async () => {
  adminCookie = await login("admin-ce@local.test", "cepass1234");
  anaCookie = await login("ana-ce@local.test", "anapass1234");
});
afterAll(() => { try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {} });

describe("EXPORT-01 — contrato que ya existía (no se rompe)", () => {
  it("sin parámetros devuelve las primeras 50 y el total FILTRADO (no el de la página)", async () => {
    const r = await get("");
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(10);           // 7 + 3, sin la de canal 'manual'
    expect(r.body.calls.length).toBe(10);    // caben en la página default
    expect(r.body.calls.some((c) => c.leadId === "lead_otro_canal")).toBe(false);
  });

  it("el limit sigue capado en 500 aunque se pida más", async () => {
    const r = await get("?limit=99999");
    expect(r.status).toBe(200);
    expect(r.body.limit).toBe(500);
  });

  it("ordena por fecha descendente", async () => {
    const r = await get("");
    const ts = r.body.calls.map((c) => new Date(c.ts).getTime());
    expect([...ts].sort((a, b) => b - a)).toEqual(ts);
  });
});

describe("EXPORT-01 — paginación con offset", () => {
  it("offset avanza sin repetir ni saltear: recorrer todas las páginas da exactamente el total", async () => {
    const vistas = [];
    let offset = 0, vueltas = 0;
    while (offset !== null) {
      const r = await get(`?limit=3&offset=${offset}`);
      expect(r.status).toBe(200);
      expect(r.body.total).toBe(10);         // el total no cambia al paginar
      expect(r.body.offset).toBe(offset);
      vistas.push(...r.body.calls.map(clave));
      offset = r.body.nextOffset;
      if (++vueltas > 20) throw new Error("nextOffset no termina — bucle infinito");
    }
    expect(vistas.length).toBe(10);
    expect(new Set(vistas).size).toBe(10);   // ninguna repetida
    expect(vueltas).toBe(4);                 // 3+3+3+1
  });

  it("hasMore y nextOffset dicen la verdad en el borde", async () => {
    const primera = await get("?limit=4&offset=0");
    expect(primera.body.hasMore).toBe(true);
    expect(primera.body.nextOffset).toBe(4);

    const ultima = await get("?limit=4&offset=8");
    expect(ultima.body.calls.length).toBe(2);
    expect(ultima.body.hasMore).toBe(false);
    expect(ultima.body.nextOffset).toBe(null);
  });

  it("un offset más allá del total devuelve página vacía, no un error", async () => {
    const r = await get("?limit=5&offset=9999");
    expect(r.status).toBe(200);
    expect(r.body.calls).toEqual([]);
    expect(r.body.total).toBe(10);
    expect(r.body.hasMore).toBe(false);
    expect(r.body.nextOffset).toBe(null);
  });

  it("offset basura o negativo cae a 0 (nunca rompe ni devuelve de atrás para adelante)", async () => {
    for (const v of ["-5", "abc", "", "1.9"]) {
      const r = await get(`?limit=2&offset=${v}`);
      expect(r.status).toBe(200);
      expect(r.body.offset).toBeGreaterThanOrEqual(0);
      expect(r.body.calls.length).toBeLessThanOrEqual(2);
    }
    const cero = await get("?limit=2&offset=0");
    const neg = await get("?limit=2&offset=-5");
    expect(neg.body.calls.map(clave)).toEqual(cero.body.calls.map(clave));
  });

  it("paginar respeta el filtro: total y páginas son del subconjunto filtrado", async () => {
    const r = await get("?outcome=answered_interested&limit=2&offset=0");
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(6);            // 4 de Ana + 2 de Beto (índices pares)
    expect(r.body.calls.every((c) => c.outcome === "answered_interested")).toBe(true);
    expect(r.body.nextOffset).toBe(2);
  });
});

describe("EXPORT-01 — la paginación no abre un agujero de permisos", () => {
  it("el setter sigue viendo SOLO sus llamadas, aunque pagine", async () => {
    const vistas = [];
    let offset = 0;
    while (offset !== null) {
      const r = await get(`?limit=2&offset=${offset}`, anaCookie);
      expect(r.status).toBe(200);
      vistas.push(...r.body.calls.map((c) => c.leadId));
      offset = r.body.nextOffset;
    }
    expect(vistas.length).toBe(7);
    expect(new Set(vistas)).toEqual(new Set(["lead_ana"]));
  });

  it("sin sesión, 401 — con offset también", async () => {
    const r = await request(app).get(`${URL_BASE}?offset=0&limit=5`);
    expect(r.status).toBe(401);
  });
});

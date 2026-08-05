// Traspaso de cartera completa entre SDRs, CONSERVANDO el trabajo (2026-07-28).
//
// Hueco real que este endpoint cierra: para mover la cartera de 3 vendedoras a
// otra persona no había camino usable.
//   · pool-distribute → mueve todo pero RESETEA (los interesados y callbacks
//                       llegan como leads fríos: el que recibe no los ve en Hoy).
//   · reassign-bulk   → conserva, pero fuerza "solo sin tocar" y esa definición
//                       exige !lead.conexion. Con la app 100% llamadas TODOS los
//                       leads de la cola tienen conexion='sin_wsp' → movía 99
//                       de 1692 en producción.
//
// Lo que este archivo protege es justamente lo que se rompería sin querer: que
// NADA del trabajo se resetee al mover.

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `transfer-portfolio-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-tp@local.test";
process.env.ADMIN_PASSWORD = "tppass1234";
process.env.JWT_SECRET = "test-secret-tp";
process.env.OPENAI_API_KEY = "";   // regla #121: definida-VACÍA, jamás delete
process.env.MERCURY_API_KEY = "";
process.env.QWEN_API_KEY = "";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}
fs.writeFileSync(path.join(tmpData, "auth.json"), JSON.stringify({
  users: [
    { id: "u_admin", email: "admin-tp@local.test", name: "AdminTP", role: "admin", status: "active", setterId: "", password: pwd("tppass1234") },
    { id: "u_a", email: "a-tp@local.test", name: "Ana", role: "setter", status: "active", setterId: "s_a", password: pwd("apass123456") },
  ], invites: [], sessions: [],
}, null, 2));

const SETTERS = [
  { id: "s_a", name: "Ana" }, { id: "s_b", name: "Bea" }, { id: "s_dest", name: "Destino" },
];
fs.writeFileSync(path.join(tmpData, "setters.json"), JSON.stringify({
  setters: SETTERS, variants: [], leads: {}, calendar: [], sessions: [],
}, null, 2));

const { app } = await import("../index.js");

const lead = (id, assignedTo, extra = {}) => ({
  [id]: {
    num: 1, name: `L-${id}`, phone: "+5215550001122", assignedTo,
    conexion: "sin_wsp", estado: "sin_contactar", callLog: [], notes: [], interactions: [], ...extra,
  },
});
function writeFixture(leads, pending = []) {
  fs.writeFileSync(path.join(tmpData, "setters.json"), JSON.stringify({
    setters: SETTERS, variants: [], leads, calendar: [], sessions: [],
  }, null, 2));
  fs.writeFileSync(path.join(tmpData, "pending_calls.json"), JSON.stringify({ pending }, null, 2));
}
const read = () => JSON.parse(fs.readFileSync(path.join(tmpData, "setters.json"), "utf8")).leads;
const readPending = () => JSON.parse(fs.readFileSync(path.join(tmpData, "pending_calls.json"), "utf8")).pending;

let adminCookie = "";
beforeAll(async () => {
  const a = await request(app).post("/api/auth/login").send({ email: "admin-tp@local.test", password: "tppass1234" });
  adminCookie = (a.headers["set-cookie"] || []).find((c) => c.startsWith("gs_session=")).split(";")[0];
});
afterAll(() => { try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {} });

const post = (body) => request(app).post("/api/setters/transfer-portfolio").set("Cookie", adminCookie).send(body);

describe("transfer-portfolio", () => {
  it("dryRun por DEFECTO: informa qué viajaría y no mueve nada", async () => {
    writeFixture({
      ...lead("i1", "s_a", { estado: "interesado" }),
      ...lead("c1", "s_a", { callbackAt: "2026-07-30T14:00:00.000Z" }),
      ...lead("x1", "s_b"),
      ...lead("ajeno", "s_dest"),
    });
    const r = await post({ fromSetterIds: ["s_a", "s_b"], toSetterId: "s_dest" });
    expect(r.status).toBe(200);
    expect(r.body.dryRun).toBe(true);
    expect(r.body.leads).toBe(3);
    expect(r.body.interesadosQueViajan).toBe(1);
    expect(r.body.callbacksQueViajan).toBe(1);
    expect(r.body.porOrigen.s_a).toMatchObject({ nombre: "Ana", leads: 2 });
    expect(read().i1.assignedTo).toBe("s_a");   // intacto
  });

  it("aplicado: NADA del trabajo se resetea — es lo que distingue este camino", async () => {
    const trabajado = {
      estado: "interesado", interes: "si", respondio: true, calificado: true,
      callbackAt: "2026-07-30T14:00:00.000Z",
      followUps: { "24hs": true, "48hs": false, "72hs": false, "7d": false, "15d": false },
      followUpStartedAt: "2026-07-28T10:00:00.000Z",
      callLog: [{ ts: "2026-07-27T15:00:00.000Z", outcome: "answered_interested", by: "u_a", duration: 120 }],
      notes: [{ text: "Pidió llamar el jueves", by: "Ana", at: "2026-07-27T15:05:00.000Z" }],
      interactions: [{ action: "call", setterId: "s_a", createdAt: "2026-07-27T15:00:00.000Z" }],
    };
    writeFixture({ ...lead("t1", "s_a", trabajado) });
    const r = await post({ fromSetterIds: ["s_a"], toSetterId: "s_dest", dryRun: false });
    expect(r.body.leads).toBe(1);

    const l = read().t1;
    expect(l.assignedTo).toBe("s_dest");
    // El estado de trabajo viaja ENTERO: esto es lo que pool-distribute borraba.
    expect(l.estado).toBe("interesado");
    expect(l.callbackAt).toBe("2026-07-30T14:00:00.000Z");
    expect(l.interes).toBe("si");
    expect(l.respondio).toBe(true);
    expect(l.calificado).toBe(true);
    expect(l.followUps["24hs"]).toBe(true);
    expect(l.followUpStartedAt).toBe("2026-07-28T10:00:00.000Z");
    expect(l.callLog.length).toBe(1);
    expect(l.notes.length).toBe(1);
    expect(l.interactions.length).toBe(1);
    // Audit
    expect(l.transferredFrom).toBe("s_a");
    expect(l.transferredAt).toBeTruthy();
    expect(l.transferredBy).toBe("u_admin");
  });

  it("los DNC también viajan: es un traspaso de cartera, no una distribución", async () => {
    writeFixture({ ...lead("d1", "s_a", { doNotCall: true }), ...lead("n1", "s_a") });
    const r = await post({ fromSetterIds: ["s_a"], toSetterId: "s_dest", dryRun: false });
    expect(r.body.leads).toBe(2);
    expect(r.body.dnc).toBe(1);
    expect(read().d1.assignedTo).toBe("s_dest");
    expect(read().d1.doNotCall).toBe(true);
  });

  it("limpia las llamadas sin marcar de los leads que se van", async () => {
    // Si no, la SDR de origen queda con una traba de disposición sobre un lead
    // que ya no es suyo: no puede marcarlo (ownership) y no puede discar.
    writeFixture(
      { ...lead("m1", "s_a"), ...lead("q1", "s_b") },
      [
        // createdAt REAL: savePendingCalls poda los de más de 14 días y una
        // entrada sin fecha cuenta como vieja (lo aprendí rompiendo este test).
        { id: "pc1", leadId: "m1", setterId: "s_a", startedAt: new Date().toISOString(), createdAt: new Date().toISOString() },
        { id: "pc2", leadId: "q1", setterId: "s_b", startedAt: new Date().toISOString(), createdAt: new Date().toISOString() },
      ],
    );
    const r = await post({ fromSetterIds: ["s_a"], toSetterId: "s_dest", dryRun: false });
    expect(r.body.pendientesLimpiados).toBe(1);
    const p = readPending();
    expect(p.length).toBe(1);
    expect(p[0].leadId).toBe("q1");   // el de la SDR que NO se movió sigue
  });

  it("valida orígenes, destino y que no se pisen", async () => {
    writeFixture({ ...lead("z1", "s_a") });
    expect((await post({ toSetterId: "s_dest" })).status).toBe(400);
    expect((await post({ fromSetterIds: ["s_a"] })).status).toBe(400);
    expect((await post({ fromSetterIds: ["s_a"], toSetterId: "s_a" })).status).toBe(400);
    expect((await post({ fromSetterIds: ["no_existe"], toSetterId: "s_dest" })).status).toBe(404);
    expect((await post({ fromSetterIds: ["s_a"], toSetterId: "no_existe" })).status).toBe(404);
  });

  it("solo admin", async () => {
    const s = await request(app).post("/api/auth/login").send({ email: "a-tp@local.test", password: "apass123456" });
    const c = (s.headers["set-cookie"] || []).find((x) => x.startsWith("gs_session=")).split(";")[0];
    expect((await request(app).post("/api/setters/transfer-portfolio").set("Cookie", c)
      .send({ fromSetterIds: ["s_a"], toSetterId: "s_dest" })).status).toBe(403);
    expect((await request(app).post("/api/setters/transfer-portfolio")
      .send({ fromSetterIds: ["s_a"], toSetterId: "s_dest" })).status).toBe(401);
  });
});

// Phase 17 Ola 3 — cadencia de auto-redial.
// Cada no_answer/voicemail (sin callback manual) reprograma el próximo intento a
// +24h. Reaparece 3 VECES (steps 1-3); al 4to no-contacto seguido el lead se
// DESCARTA solo. Un connect rompe la racha. Reaparece en Llamadas/Power Dialer
// (no en "Próximos callbacks" ni en Hoy — eso es solo para callbacks manuales).

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `cadence-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-cad@local.test";
process.env.ADMIN_PASSWORD = "cadpass1234";
process.env.JWT_SECRET = "test-secret-cad";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}
fs.writeFileSync(path.join(tmpData, "auth.json"), JSON.stringify({ users: [{ id: "u", email: "admin-cad@local.test", name: "AdminCad", role: "admin", status: "active", setterId: "", password: pwd("cadpass1234") }], invites: [], sessions: [] }, null, 2));
fs.writeFileSync(path.join(tmpData, "setters.json"), JSON.stringify({
  setters: [{ id: "s_x", name: "X" }],
  variants: [],
  leads: {
    l1: { num: 1, name: "L1", phone: "+5215550000001", assignedTo: "s_x", conexion: "sin_wsp", estado: "sin_contactar" },
  },
  calendar: [], sessions: [],
}, null, 2));

const { app } = await import("../index.js");
let cookie = "";
const disp = (body) => request(app).post("/api/setters/leads/l1/call-disposition").set("Cookie", cookie).send(body);
const hoursFromNow = (iso) => (new Date(iso).getTime() - Date.now()) / 3600000;
beforeAll(async () => {
  const r = await request(app).post("/api/auth/login").send({ email: "admin-cad@local.test", password: "cadpass1234" });
  cookie = (r.headers["set-cookie"] || []).find((c) => c.startsWith("gs_session=")).split(";")[0];
});
afterAll(() => { try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {} });

describe("cadencia de auto-redial (3 reintentos a 24h, descarte al 4to)", () => {
  it("1er no_answer → callback +24h, step 1, no descartado", async () => {
    const r = await disp({ outcome: "no_answer" });
    expect(r.body.lead.cadenceStep).toBe(1);
    expect(r.body.lead.estado).not.toBe("descartado");
    expect(hoursFromNow(r.body.lead.callbackAt)).toBeGreaterThan(23);
    expect(hoursFromNow(r.body.lead.callbackAt)).toBeLessThan(25);
  });
  it("2do no_answer → +24h, step 2, todavía no descartado", async () => {
    const r = await disp({ outcome: "no_answer" });
    expect(r.body.lead.cadenceStep).toBe(2);
    expect(r.body.lead.estado).not.toBe("descartado");
    expect(hoursFromNow(r.body.lead.callbackAt)).toBeGreaterThan(23);
    expect(hoursFromNow(r.body.lead.callbackAt)).toBeLessThan(25);
  });
  it("3er no_answer → +24h, step 3, TODAVÍA no descartado (3a reaparición)", async () => {
    const r = await disp({ outcome: "no_answer" });
    expect(r.body.lead.cadenceStep).toBe(3);
    expect(r.body.lead.estado).not.toBe("descartado");
    expect(hoursFromNow(r.body.lead.callbackAt)).toBeGreaterThan(23);
    expect(hoursFromNow(r.body.lead.callbackAt)).toBeLessThan(25);
  });
  it("4to no_answer → DESCARTADO automático, sin callback", async () => {
    const r = await disp({ outcome: "no_answer" });
    expect(r.body.lead.cadenceStep).toBe(4);
    expect(r.body.lead.estado).toBe("descartado");
    expect(r.body.lead.autoDiscarded).toBe(true);
    expect(r.body.lead.callbackAt).toBeFalsy();
  });
  it("un connect (hung_up) rompe la racha → próximo no_answer vuelve a step 1 (+24h)", async () => {
    await disp({ outcome: "hung_up" });
    const r = await disp({ outcome: "no_answer" });
    expect(r.body.lead.cadenceStep).toBe(1);
    expect(hoursFromNow(r.body.lead.callbackAt)).toBeGreaterThan(23);
    expect(hoursFromNow(r.body.lead.callbackAt)).toBeLessThan(25);
  });
  it("callback manual NO es pisado por la cadencia", async () => {
    const manual = new Date(Date.now() + 10 * 24 * 3600000).toISOString();
    const r = await disp({ outcome: "callback_later", callbackAt: manual });
    expect(new Date(r.body.lead.callbackAt).toISOString()).toBe(manual);
  });
});

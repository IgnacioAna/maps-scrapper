// Phase 17 Ola 3 — cadencia de auto-redial.
// Cada no_answer/voicemail (sin callback manual) auto-programa el próximo intento
// según la racha de no-contacto: +1d, +2d, +3d, +4d, +7d, +7d; tras agotar → cadenceExhausted.
// Un connect rompe la racha. Reusa callbackAt (cola "Para seguir"), sin dialer.

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

describe("cadencia de auto-redial", () => {
  it("1er no_answer → callback +1d (24h), step 1", async () => {
    const r = await disp({ outcome: "no_answer" });
    expect(r.body.lead.cadenceStep).toBe(1);
    expect(r.body.lead.estado).not.toBe("descartado");
    expect(hoursFromNow(r.body.lead.callbackAt)).toBeGreaterThan(23);
    expect(hoursFromNow(r.body.lead.callbackAt)).toBeLessThan(25);
  });
  it("2do no_answer → +2d (48h), step 2", async () => {
    const r = await disp({ outcome: "no_answer" });
    expect(r.body.lead.cadenceStep).toBe(2);
    expect(hoursFromNow(r.body.lead.callbackAt)).toBeGreaterThan(47);
    expect(hoursFromNow(r.body.lead.callbackAt)).toBeLessThan(49);
  });
  it("3er no_answer → +3d, step 3", async () => {
    const r = await disp({ outcome: "no_answer" });
    expect(r.body.lead.cadenceStep).toBe(3);
    expect(hoursFromNow(r.body.lead.callbackAt)).toBeGreaterThan(71);
    expect(hoursFromNow(r.body.lead.callbackAt)).toBeLessThan(73);
  });
  it("4to no_answer → +4d, step 4 (persistencia: ya no agota al 4to)", async () => {
    const r = await disp({ outcome: "no_answer" });
    expect(r.body.lead.cadenceStep).toBe(4);
    expect(hoursFromNow(r.body.lead.callbackAt)).toBeGreaterThan(95);
    expect(hoursFromNow(r.body.lead.callbackAt)).toBeLessThan(97);
    expect(r.body.lead.cadenceExhausted).toBe(false);
  });
  it("5to y 6to no_answer → +7d cada uno; recién el 7mo agota", async () => {
    let r = await disp({ outcome: "no_answer" }); // 5
    expect(r.body.lead.cadenceStep).toBe(5);
    r = await disp({ outcome: "no_answer" }); // 6
    expect(r.body.lead.cadenceStep).toBe(6);
    expect(hoursFromNow(r.body.lead.callbackAt)).toBeGreaterThan(167);
    r = await disp({ outcome: "no_answer" }); // 7 → agota
    expect(r.body.lead.cadenceExhausted).toBe(true);
  });
  it("un connect (hung_up) rompe la racha → próximo no_answer vuelve a step 1", async () => {
    await disp({ outcome: "hung_up" });
    const r = await disp({ outcome: "no_answer" });
    expect(r.body.lead.cadenceStep).toBe(1);
  });
  it("callback manual NO es pisado por la cadencia", async () => {
    const manual = new Date(Date.now() + 10 * 24 * 3600000).toISOString();
    const r = await disp({ outcome: "callback_later", callbackAt: manual });
    expect(new Date(r.body.lead.callbackAt).toISOString()).toBe(manual);
  });
});

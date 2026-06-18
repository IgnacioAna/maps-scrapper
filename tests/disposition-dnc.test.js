// Phase 17 — razón de descalificación + DNC (no-llamar).
// Verifica: disqualifyReason whitelisteada, auto-DNC por 'no_contactar', DNC explícito,
// exclusión de DNC de las colas (sin-wsp callable + pool-summary), bulk mark/clear DNC,
// y byReason en cold-call-metrics.

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `dnc-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-dnc@local.test";
process.env.ADMIN_PASSWORD = "dncpass1234";
process.env.JWT_SECRET = "test-secret-dnc";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}
fs.writeFileSync(path.join(tmpData, "auth.json"), JSON.stringify({ users: [{ id: "u", email: "admin-dnc@local.test", name: "AdminDNC", role: "admin", status: "active", setterId: "", password: pwd("dncpass1234") }], invites: [], sessions: [] }, null, 2));
fs.writeFileSync(path.join(tmpData, "setters.json"), JSON.stringify({
  setters: [{ id: "s_x", name: "X" }],
  variants: [],
  leads: {
    l1: { num: 1, name: "L1", phone: "+5215550000001", assignedTo: "s_x", conexion: "sin_wsp", estado: "sin_contactar" },
    l2: { num: 2, name: "L2", phone: "+5215550000002", assignedTo: "s_x", conexion: "sin_wsp", estado: "sin_contactar" },
    l3: { num: 3, name: "L3", phone: "+5215550000003", assignedTo: "s_x", conexion: "sin_wsp", estado: "sin_contactar" },
  },
  calendar: [], sessions: [],
}, null, 2));

const { app } = await import("../index.js");
let cookie = "";
beforeAll(async () => {
  const r = await request(app).post("/api/auth/login").send({ email: "admin-dnc@local.test", password: "dncpass1234" });
  cookie = (r.headers["set-cookie"] || []).find((c) => c.startsWith("gs_session=")).split(";")[0];
});
afterAll(() => { try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {} });

describe("razón de descalificación", () => {
  it("guarda razón válida + descarta", async () => {
    const r = await request(app).post("/api/setters/leads/l1/call-disposition").set("Cookie", cookie).send({ outcome: "answered_not_interested", disqualifyReason: "no_es_icp" });
    expect(r.status).toBe(200);
    expect(r.body.lead.disqualifyReason).toBe("no_es_icp");
    expect(r.body.lead.estado).toBe("descartado");
    expect(r.body.lead.doNotCall).toBe(false);
  });
  it("ignora razón fuera de la whitelist", async () => {
    const r = await request(app).post("/api/setters/leads/l1/call-disposition").set("Cookie", cookie).send({ outcome: "answered_not_interested", disqualifyReason: "hax0r" });
    expect(r.body.lead.disqualifyReason).toBe("");
  });
});

describe("DNC", () => {
  it("razón 'no_contactar' auto-marca DNC", async () => {
    const r = await request(app).post("/api/setters/leads/l2/call-disposition").set("Cookie", cookie).send({ outcome: "answered_not_interested", disqualifyReason: "no_contactar" });
    expect(r.body.lead.doNotCall).toBe(true);
    expect(r.body.lead.doNotCallReason).toBe("no_contactar");
  });
  it("bulk mark_dnc + clear_dnc, y la cola callable respeta el flag", async () => {
    // l3 está callable (conexion sin_wsp). Lo marco DNC vía bulk.
    const mk = await request(app).post("/api/setters/leads/bulk").set("Cookie", cookie).send({ leadIds: ["l3"], action: "mark_dnc" });
    expect(mk.body.affected).toBe(1);
    // No aparece en callable...
    let callable = (await request(app).get("/api/setters/leads/sin-wsp?include=callable").set("Cookie", cookie)).body.leads.map(l => l.id);
    expect(callable).not.toContain("l3");
    expect(callable).not.toContain("l2"); // l2 quedó DNC por no_contactar
    // ...pero sí en la vista dnc=1
    const dncList = (await request(app).get("/api/setters/leads/sin-wsp?dnc=1").set("Cookie", cookie)).body.leads.map(l => l.id);
    expect(dncList).toContain("l3");
    expect(dncList).toContain("l2");
    // clear_dnc lo devuelve a la cola
    await request(app).post("/api/setters/leads/bulk").set("Cookie", cookie).send({ leadIds: ["l3"], action: "clear_dnc" });
    callable = (await request(app).get("/api/setters/leads/sin-wsp?include=callable").set("Cookie", cookie)).body.leads.map(l => l.id);
    expect(callable).toContain("l3");
  });
  it("pool-summary cuenta los DNC aparte (no en el pool distribuible)", async () => {
    const r = await request(app).get("/api/setters/pool-summary").set("Cookie", cookie);
    expect(r.body.dnc).toBeGreaterThanOrEqual(1); // l2 sigue DNC
  });
});

describe("cold-call-metrics byReason", () => {
  it("agrega las razones de no-interesado del período", async () => {
    const r = await request(app).get("/api/setters/cold-call-metrics?period=all").set("Cookie", cookie);
    expect(r.status).toBe(200);
    expect(r.body.byReason.no_es_icp).toBeGreaterThanOrEqual(1);
    expect(r.body.byReason.no_contactar).toBeGreaterThanOrEqual(1);
  });
});

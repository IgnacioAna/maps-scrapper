// Test del pool de distribución (Phase 14): pool-summary + reassign desde sin-asignar.

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `pool-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-pl@local.test";
process.env.ADMIN_PASSWORD = "plpass1234";
process.env.ADMIN_NAME = "AdminPL";
process.env.JWT_SECRET = "test-secret-pl";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}

fs.writeFileSync(
  path.join(tmpData, "auth.json"),
  JSON.stringify({
    users: [{ id: "user_admin_pl", email: "admin-pl@local.test", name: "AdminPL", role: "admin", status: "active", setterId: "", password: pwd("plpass1234"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
    invites: [], sessions: [],
  }, null, 2)
);

fs.writeFileSync(
  path.join(tmpData, "setters.json"),
  JSON.stringify({
    setters: [{ id: "s_a", name: "Ana" }, { id: "s_b", name: "Beto" }],
    variants: [],
    leads: {
      // 3 huérfanos untouched
      o1: { num: 1, name: "O1", phone: "+5491", assignedTo: "", estado: "sin_contactar", country: "México" },
      o2: { num: 2, name: "O2", phone: "+5492", assignedTo: "", estado: "sin_contactar", country: "México" },
      o3: { num: 3, name: "O3", phone: "+5493", assignedTo: "", estado: "sin_contactar", country: "Colombia" },
      // 1 huérfano TOCADO (no debe moverse con untouchedOnly)
      o4: { num: 4, name: "O4", phone: "+5494", assignedTo: "", estado: "contactado", country: "México", lastContactAt: new Date().toISOString() },
      // asignados a Ana
      a1: { num: 5, name: "A1", phone: "+5495", assignedTo: "s_a", estado: "sin_contactar", country: "Chile" },
    },
    calendar: [], sessions: [],
  }, null, 2)
);

const { app } = await import("../index.js");
let adminCookie = "";

beforeAll(async () => {
  const r = await request(app).post("/api/auth/login").send({ email: "admin-pl@local.test", password: "plpass1234" });
  expect(r.status).toBe(200);
  adminCookie = (r.headers["set-cookie"] || []).find((c) => c.startsWith("gs_session=")).split(";")[0];
});

afterAll(() => { try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {} });

describe("Pool de distribución", () => {
  it("pool-summary: total, sin asignar, por setter, por país", async () => {
    const r = await request(app).get("/api/setters/pool-summary").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(5);
    expect(r.body.unassigned.total).toBe(4);   // o1-o4
    expect(r.body.unassigned.untouched).toBe(3); // o4 está tocado
    const ana = r.body.bySetter.find((s) => s.id === "s_a");
    expect(ana.total).toBe(1);
    const mx = r.body.byCountry.find((c) => c.country === "México");
    expect(mx.count).toBe(3);
  });

  it("distribuye desde sin-asignar a un setter (solo untouched)", async () => {
    const r = await request(app).post("/api/setters/reassign-bulk").set("Cookie", adminCookie)
      .send({ fromSetterId: "__unassigned__", toSetterId: "s_b", count: 10 });
    expect(r.status).toBe(200);
    expect(r.body.moved).toBe(3); // o1,o2,o3 (no o4 tocado)
    expect(r.body.fromSetter.remaining).toBe(1); // queda o4 sin asignar
    expect(r.body.toSetter.total).toBe(3);
  });

  it("respeta filtro de país al distribuir desde sin-asignar", async () => {
    // reset: volver a poner un huérfano de México untouched
    const r = await request(app).post("/api/setters/reassign-bulk").set("Cookie", adminCookie)
      .send({ fromSetterId: "__unassigned__", toSetterId: "s_a", country: "México" });
    // ya no quedan huérfanos México untouched (se movieron a Beto) → 0
    expect(r.status).toBe(200);
    expect(r.body.moved).toBe(0);
  });
});

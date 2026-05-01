import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `reassign-bulk-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-rb@local.test";
process.env.ADMIN_PASSWORD = "rbpass1234";
process.env.ADMIN_NAME = "AdminRB";
process.env.JWT_SECRET = "test-secret-rb";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}

fs.writeFileSync(
  path.join(tmpData, "auth.json"),
  JSON.stringify({
    users: [
      { id: "user_admin_rb", email: "admin-rb@local.test", name: "AdminRB", role: "admin", status: "active", setterId: "", password: pwd("rbpass1234"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ],
    invites: [],
    sessions: [],
  }, null, 2)
);

fs.writeFileSync(
  path.join(tmpData, "setters.json"),
  JSON.stringify({
    setters: [
      { id: "setter_from", name: "Origen" },
      { id: "setter_to", name: "Destino" },
    ],
    variants: [],
    calendar: [],
    sessions: [],
    leads: {
      lead_1: { id: "lead_1", num: 1, assignedTo: "setter_from", country: "Bolivia", city: "La Paz", estado: "sin_contactar", interactions: [], lastContactAt: null, conexion: "" },
      lead_2: { id: "lead_2", num: 2, assignedTo: "setter_from", country: "Bolivia", city: "La Paz", estado: "sin_contactar", interactions: [], lastContactAt: null, conexion: "" },
      lead_3: { id: "lead_3", num: 3, assignedTo: "setter_from", country: "Bolivia", city: "Santa Cruz", estado: "sin_contactar", interactions: [], lastContactAt: null, conexion: "" },
      lead_4: { id: "lead_4", num: 4, assignedTo: "setter_from", country: "Argentina", city: "Cordoba", estado: "sin_contactar", interactions: [], lastContactAt: null, conexion: "" },
      lead_5: { id: "lead_5", num: 5, assignedTo: "setter_from", country: "Bolivia", city: "La Paz", estado: "contactado", interactions: [{ action: "open" }], lastContactAt: new Date().toISOString(), conexion: "enviada" },
    },
  }, null, 2)
);

const { app } = await import("../index.js");

let cookie = "";

beforeAll(async () => {
  const r = await request(app).post("/api/auth/login").send({ email: "admin-rb@local.test", password: "rbpass1234" });
  expect(r.status).toBe(200);
  cookie = r.headers["set-cookie"][0].split(";")[0];
});

afterAll(() => {
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
});

describe("POST /api/setters/reassign-bulk/preview", () => {
  it("protege endpoints de setters/leads sin sesion", async () => {
    const setters = await request(app).get("/api/setters");
    const variants = await request(app).get("/api/setters/variants");
    const leads = await request(app).get("/api/setters/leads");

    expect(setters.status).toBe(401);
    expect(variants.status).toBe(401);
    expect(leads.status).toBe(401);
  });

  it("cuenta los candidatos con los mismos filtros que la reasignacion", async () => {
    const r = await request(app)
      .post("/api/setters/reassign-bulk/preview")
      .set("Cookie", cookie)
      .send({ fromSetterId: "setter_from", country: "Bolivia", city: "La Paz", untouchedOnly: true });

    expect(r.status).toBe(200);
    expect(r.body.count).toBe(2);
    expect(r.body.totalAssigned).toBe(5);
  });
});

describe("POST /api/setters/reassign-bulk", () => {
  it("mueve solo la cantidad pedida dentro del conjunto filtrado", async () => {
    const r = await request(app)
      .post("/api/setters/reassign-bulk")
      .set("Cookie", cookie)
      .send({ fromSetterId: "setter_from", toSetterId: "setter_to", country: "Bolivia", city: "La Paz", untouchedOnly: true, count: 1 });

    expect(r.status).toBe(200);
    expect(r.body.moved).toBe(1);

    const data = JSON.parse(fs.readFileSync(path.join(tmpData, "setters.json"), "utf8"));
    expect(data.leads.lead_1.assignedTo).toBe("setter_to");
    expect(data.leads.lead_2.assignedTo).toBe("setter_from");
    expect(data.leads.lead_5.assignedTo).toBe("setter_from");
  });
});

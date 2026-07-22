// "Ver como Supervisor · X" (2026-07-22): un admin que pasa
// ?viewAs=supervisor&asUserId=<userId de un supervisor> debe recibir la data
// filtrada con los visibleSetterIds de ESE supervisor (attachAuth adopta el
// scoping en una copia de req.auth.user). Sin asUserId, o con un asUserId que
// no es supervisor, el comportamiento previo queda intacto. Y NUNCA eleva
// privilegios: solo aplica si el user real es admin.
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `viewas-supervisor-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-vas@local.test";
process.env.ADMIN_PASSWORD = "adminpass1";
process.env.ADMIN_NAME = "AdminVAS";
process.env.JWT_SECRET = "test-secret-vas";
// String vacio, NUNCA delete — index.js corre dotenv.config() que re-carga
// el .env local, pero dotenv no pisa vars ya definidas (aunque esten vacias).
process.env.OPENAI_API_KEY = "";
process.env.MERCURY_API_KEY = "";
process.env.QWEN_API_KEY = "";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}

const now = new Date().toISOString();

fs.writeFileSync(
  path.join(tmpData, "auth.json"),
  JSON.stringify({
    users: [
      { id: "user_admin", email: "admin-vas@local.test", name: "AdminVAS", role: "admin", status: "active", setterId: "", password: pwd("adminpass1"), createdAt: now, updatedAt: now },
      { id: "user_sup_scoped", email: "sup-scoped@local.test", name: "SupScoped", role: "supervisor", status: "active", setterId: "", visibleSetterIds: ["setter_a"], password: pwd("suppass1"), createdAt: now, updatedAt: now },
      { id: "user_sup_all", email: "sup-all@local.test", name: "SupAll", role: "supervisor", status: "active", setterId: "", password: pwd("suppass2"), createdAt: now, updatedAt: now },
      { id: "user_setter_b", email: "setter-b@local.test", name: "SetterB", role: "setter", status: "active", setterId: "setter_b", password: pwd("setterbpass"), createdAt: now, updatedAt: now },
    ],
    invites: [],
    sessions: [],
  }, null, 2)
);

fs.writeFileSync(
  path.join(tmpData, "setters.json"),
  JSON.stringify({
    setters: [
      { id: "setter_a", name: "SetterA" },
      { id: "setter_b", name: "SetterB" },
    ],
    variants: [],
    leads: {
      lead_a1: { id: "lead_a1", num: 1, name: "Clinica A1", phone: "+5215500000001", country: "México", assignedTo: "setter_a", estado: "sin_contactar", callLog: [] },
      lead_b1: { id: "lead_b1", num: 2, name: "Clinica B1", phone: "+5215500000002", country: "México", assignedTo: "setter_b", estado: "sin_contactar", callLog: [] },
    },
    calendar: [],
    sessions: [],
  }, null, 2)
);

const { app } = await import("../index.js");

async function login(email, password) {
  const r = await request(app).post("/api/auth/login").send({ email, password });
  expect(r.status).toBe(200);
  const cookies = r.headers["set-cookie"] || [];
  const sess = cookies.find((c) => c.startsWith("gs_session=")) || "";
  return sess.split(";")[0];
}

let adminCookie = "", supScopedCookie = "", setterBCookie = "";

beforeAll(async () => {
  adminCookie = await login("admin-vas@local.test", "adminpass1");
  supScopedCookie = await login("sup-scoped@local.test", "suppass1");
  setterBCookie = await login("setter-b@local.test", "setterbpass");
});

afterAll(() => {
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
});

describe("viewAs=supervisor&asUserId — admin adopta el scoping del supervisor", () => {
  it("GET /api/setters filtrado a los visibleSetterIds del supervisor impersonado", async () => {
    const r = await request(app)
      .get("/api/setters?viewAs=supervisor&asUserId=user_sup_scoped")
      .set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.setters.map((s) => s.id)).toEqual(["setter_a"]);
  });

  it("GET /api/setters/team-performance solo incluye setters visibles del supervisor", async () => {
    const r = await request(app)
      .get("/api/setters/team-performance?viewAs=supervisor&asUserId=user_sup_scoped")
      .set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.perSetter.map((s) => s.id)).toEqual(["setter_a"]);
  });

  it("impersonar un supervisor SIN restricción = ve todo (igual que el real)", async () => {
    const r = await request(app)
      .get("/api/setters?viewAs=supervisor&asUserId=user_sup_all")
      .set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.setters.map((s) => s.id).sort()).toEqual(["setter_a", "setter_b"]);
  });

  it("viewAs=supervisor sin asUserId mantiene el comportamiento previo (ve todo)", async () => {
    const r = await request(app)
      .get("/api/setters?viewAs=supervisor")
      .set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.setters.map((s) => s.id).sort()).toEqual(["setter_a", "setter_b"]);
  });

  it("asUserId que NO es supervisor (un setter) se ignora", async () => {
    const r = await request(app)
      .get("/api/setters?viewAs=supervisor&asUserId=user_setter_b")
      .set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.setters.map((s) => s.id).sort()).toEqual(["setter_a", "setter_b"]);
  });
});

describe("viewAs=supervisor&asUserId — no eleva privilegios de no-admins", () => {
  it("un supervisor scoped NO puede ampliar su visibilidad impersonando al sin-restricción", async () => {
    const r = await request(app)
      .get("/api/setters?viewAs=supervisor&asUserId=user_sup_all")
      .set("Cookie", supScopedCookie);
    expect(r.status).toBe(200);
    expect(r.body.setters.map((s) => s.id)).toEqual(["setter_a"]);
  });

  it("un setter con viewAs=supervisor&asUserId sigue siendo setter (sin acceso a users)", async () => {
    const r = await request(app)
      .get("/api/auth/users?viewAs=supervisor&asUserId=user_sup_all")
      .set("Cookie", setterBCookie);
    expect(r.status).toBe(403);
  });
});

// Setters admin-only (2026-07-22): setter_ignacio y setter_paula_kroff son
// visibles SOLO para el admin. Ningún supervisor los ve — ni el scoped (se
// strippean de su lista aunque estén guardados), ni el sin-lista (que ahora
// recibe un set de exclusión "todo menos admin-only"), ni el admin en modo
// "Ver como Supervisor". Efecto colateral intencional: TODO supervisor es
// scoped ahora → los endpoints globales (pool, etc.) devuelven 403 para
// cualquier supervisor.
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `admin-only-setters-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-aos@local.test";
process.env.ADMIN_PASSWORD = "adminpass1";
process.env.ADMIN_NAME = "AdminAOS";
process.env.JWT_SECRET = "test-secret-aos";
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
      { id: "user_admin", email: "admin-aos@local.test", name: "AdminAOS", role: "admin", status: "active", setterId: "setter_ignacio", password: pwd("adminpass1"), createdAt: now, updatedAt: now },
      // Scoped con setter_ignacio metido a mano en la lista → debe strippearse.
      { id: "user_sup_scoped", email: "sup-scoped@local.test", name: "SupScoped", role: "supervisor", status: "active", setterId: "", visibleSetterIds: ["setter_x", "setter_ignacio"], password: pwd("suppass1"), createdAt: now, updatedAt: now },
      { id: "user_sup_all", email: "sup-all@local.test", name: "SupAll", role: "supervisor", status: "active", setterId: "", visibleSetterIds: [], password: pwd("suppass2"), createdAt: now, updatedAt: now },
    ],
    invites: [],
    sessions: [],
  }, null, 2)
);

fs.writeFileSync(
  path.join(tmpData, "setters.json"),
  JSON.stringify({
    setters: [
      { id: "setter_ignacio", name: "Ignacio" },
      { id: "setter_paula_kroff", name: "Paula Kroff" },
      { id: "setter_x", name: "SetterX" },
    ],
    variants: [],
    leads: {
      lead_ig1: { id: "lead_ig1", num: 1, name: "Lead de Ignacio", phone: "+5215500000001", country: "México", assignedTo: "setter_ignacio", estado: "sin_contactar", callLog: [] },
      lead_x1: { id: "lead_x1", num: 2, name: "Lead de X", phone: "+5215500000002", country: "México", assignedTo: "setter_x", estado: "sin_contactar", callLog: [] },
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
  return (cookies.find((c) => c.startsWith("gs_session=")) || "").split(";")[0];
}

let adminCookie = "", supScopedCookie = "", supAllCookie = "";

beforeAll(async () => {
  adminCookie = await login("admin-aos@local.test", "adminpass1");
  supScopedCookie = await login("sup-scoped@local.test", "suppass1");
  supAllCookie = await login("sup-all@local.test", "suppass2");
});

afterAll(() => {
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
});

describe("supervisor sin lista — ve todo MENOS los admin-only", () => {
  it("GET /api/setters excluye setter_ignacio y setter_paula_kroff", async () => {
    const r = await request(app).get("/api/setters").set("Cookie", supAllCookie);
    expect(r.status).toBe(200);
    expect(r.body.setters.map((s) => s.id)).toEqual(["setter_x"]);
  });

  it("team-performance excluye los admin-only", async () => {
    const r = await request(app).get("/api/setters/team-performance").set("Cookie", supAllCookie);
    expect(r.status).toBe(200);
    expect(r.body.perSetter.map((s) => s.id)).toEqual(["setter_x"]);
  });

  it("no puede tocar un lead de setter_ignacio (403)", async () => {
    const r = await request(app).patch("/api/setters/leads/lead_ig1").set("Cookie", supAllCookie).send({ interes: "si" });
    expect(r.status).toBe(403);
  });

  it("los endpoints globales (pool-summary) ahora dan 403 para TODO supervisor", async () => {
    const r = await request(app).get("/api/setters/pool-summary").set("Cookie", supAllCookie);
    expect(r.status).toBe(403);
  });

  it("/api/auth/users no incluye al user admin (linkeado a setter_ignacio)", async () => {
    const r = await request(app).get("/api/auth/users").set("Cookie", supAllCookie);
    expect(r.status).toBe(200);
    const ids = r.body.users.map((u) => u.id);
    expect(ids).not.toContain("user_admin");
    expect(ids).toContain("user_sup_all");
  });

  it("/api/auth/online (Equipo online) SÍ responde pero sin el user admin", async () => {
    const r = await request(app).get("/api/auth/online").set("Cookie", supAllCookie);
    expect(r.status).toBe(200);
    const ids = r.body.users.map((u) => u.id);
    expect(ids).not.toContain("user_admin");
  });

  it("/api/setters/calendar (Reuniones) excluye entradas de los admin-only", async () => {
    // Crear 2 citas como admin: una de setter_ignacio, una de setter_x.
    const c1 = await request(app).post("/api/setters/calendar").set("Cookie", adminCookie)
      .send({ leadId: "lead_ig1", nombre: "Cita Ignacio", fecha: new Date().toISOString(), setterId: "setter_ignacio" });
    expect(c1.status).toBe(200);
    const c2 = await request(app).post("/api/setters/calendar").set("Cookie", adminCookie)
      .send({ leadId: "lead_x1", nombre: "Cita X", fecha: new Date().toISOString(), setterId: "setter_x" });
    expect(c2.status).toBe(200);

    const sup = await request(app).get("/api/setters/calendar").set("Cookie", supAllCookie);
    expect(sup.status).toBe(200);
    const names = sup.body.calendar.map((e) => e.nombre);
    expect(names).toContain("Cita X");
    expect(names).not.toContain("Cita Ignacio");

    const adm = await request(app).get("/api/setters/calendar").set("Cookie", adminCookie);
    expect(adm.body.calendar.map((e) => e.nombre)).toEqual(expect.arrayContaining(["Cita Ignacio", "Cita X"]));
  });
});

describe("supervisor scoped — los admin-only se strippean de su lista", () => {
  it("GET /api/setters devuelve solo setter_x aunque la lista guardada tenga setter_ignacio", async () => {
    const r = await request(app).get("/api/setters").set("Cookie", supScopedCookie);
    expect(r.status).toBe(200);
    expect(r.body.setters.map((s) => s.id)).toEqual(["setter_x"]);
  });
});

describe("admin — sin cambios, y viewAs supervisor también excluye", () => {
  it("admin ve los 3 setters", async () => {
    const r = await request(app).get("/api/setters").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.setters.map((s) => s.id).sort()).toEqual(["setter_ignacio", "setter_paula_kroff", "setter_x"]);
  });

  it("admin con viewAs=supervisor genérico (sin asUserId) NO ve los admin-only", async () => {
    const r = await request(app).get("/api/setters?viewAs=supervisor").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.setters.map((s) => s.id)).toEqual(["setter_x"]);
  });

  it("selector de SDRs de Mi rendimiento (performance.setters) filtrado en viewAs y para supervisor real", async () => {
    const rv = await request(app).get("/api/setters/performance?viewAs=supervisor").set("Cookie", adminCookie);
    expect(rv.status).toBe(200);
    expect(rv.body.setters.map((s) => s.id)).toEqual(["setter_x"]);
    const rs = await request(app).get("/api/setters/performance").set("Cookie", supAllCookie);
    expect(rs.status).toBe(200);
    expect(rs.body.setters.map((s) => s.id)).toEqual(["setter_x"]);
  });

  it("PATCH visibleSetterIds filtra los admin-only al guardar", async () => {
    const r = await request(app).patch("/api/auth/users/user_sup_scoped").set("Cookie", adminCookie)
      .send({ visibleSetterIds: ["setter_x", "setter_ignacio", "setter_paula_kroff"] });
    expect(r.status).toBe(200);
    expect(r.body.user.visibleSetterIds).toEqual(["setter_x"]);
  });
});

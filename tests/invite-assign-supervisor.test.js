// Asignar SDR nuevo a supervisor al invitarlo (2026-07-22): POST
// /api/auth/invites con role=setter acepta `supervisorUserIds[]` — el setterId
// recién creado se agrega a los visibleSetterIds de cada supervisor SCOPED.
// Un supervisor sin lista (ve todos) se saltea (agregarle un id lo
// restringiría). Al revocar el invite (DELETE), si el setter huérfano se
// elimina, también se limpia de los visibleSetterIds.
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `invite-assign-sup-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-ias@local.test";
process.env.ADMIN_PASSWORD = "adminpass1";
process.env.ADMIN_NAME = "AdminIAS";
process.env.JWT_SECRET = "test-secret-ias";
// String vacio, NUNCA delete — index.js corre dotenv.config() que re-carga
// el .env local, pero dotenv no pisa vars ya definidas (aunque esten vacias).
process.env.OPENAI_API_KEY = "";
process.env.MERCURY_API_KEY = "";
process.env.QWEN_API_KEY = "";
process.env.RESEND_API_KEY = "";

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
      { id: "user_admin", email: "admin-ias@local.test", name: "AdminIAS", role: "admin", status: "active", setterId: "", password: pwd("adminpass1"), createdAt: now, updatedAt: now },
      { id: "user_sup_scoped", email: "sup-scoped@local.test", name: "SupScoped", role: "supervisor", status: "active", setterId: "", visibleSetterIds: ["setter_a"], password: pwd("suppass1"), createdAt: now, updatedAt: now },
      { id: "user_sup_all", email: "sup-all@local.test", name: "SupAll", role: "supervisor", status: "active", setterId: "", visibleSetterIds: [], password: pwd("suppass2"), createdAt: now, updatedAt: now },
    ],
    invites: [],
    sessions: [],
  }, null, 2)
);

fs.writeFileSync(
  path.join(tmpData, "setters.json"),
  JSON.stringify({
    setters: [{ id: "setter_a", name: "SetterA" }],
    variants: [],
    leads: {},
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

function readAuth() {
  return JSON.parse(fs.readFileSync(path.join(tmpData, "auth.json"), "utf8"));
}

let adminCookie = "";

beforeAll(async () => {
  adminCookie = await login("admin-ias@local.test", "adminpass1");
});

afterAll(() => {
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
});

describe("POST /api/auth/invites con supervisorUserIds", () => {
  it("invitar SDR asignado a supervisor scoped agrega su setterId a visibleSetterIds", async () => {
    const r = await request(app).post("/api/auth/invites").set("Cookie", adminCookie).send({
      name: "Nuevo Vendedor", email: "nuevo@local.test", role: "setter",
      sendEmail: false, supervisorUserIds: ["user_sup_scoped"],
    });
    expect(r.status).toBe(200);
    expect(r.body.invite.setterId).toBe("setter_nuevo_vendedor");
    expect(r.body.invite.assignedSupervisorIds).toEqual(["user_sup_scoped"]);
    const sup = readAuth().users.find((u) => u.id === "user_sup_scoped");
    expect(sup.visibleSetterIds).toEqual(["setter_a", "setter_nuevo_vendedor"]);
  });

  it("supervisor SIN lista (ve todos) se saltea — no se lo restringe", async () => {
    const r = await request(app).post("/api/auth/invites").set("Cookie", adminCookie).send({
      name: "Otro Vendedor", email: "otro@local.test", role: "setter",
      sendEmail: false, supervisorUserIds: ["user_sup_all"],
    });
    expect(r.status).toBe(200);
    expect(r.body.invite.assignedSupervisorIds).toEqual([]);
    const sup = readAuth().users.find((u) => u.id === "user_sup_all");
    expect(sup.visibleSetterIds).toEqual([]);
  });

  it("ids inválidos o de no-supervisores se ignoran", async () => {
    const r = await request(app).post("/api/auth/invites").set("Cookie", adminCookie).send({
      name: "Tercer Vendedor", email: "tercero@local.test", role: "setter",
      sendEmail: false, supervisorUserIds: ["user_admin", "user_inexistente", 42],
    });
    expect(r.status).toBe(200);
    expect(r.body.invite.assignedSupervisorIds).toEqual([]);
  });
});

describe("DELETE /api/auth/invites/:id limpia visibleSetterIds del supervisor", () => {
  it("revocar el invite del SDR asignado quita su setterId de la lista del supervisor", async () => {
    const inv = await request(app).post("/api/auth/invites").set("Cookie", adminCookie).send({
      name: "Vendedor Revocado", email: "revocado@local.test", role: "setter",
      sendEmail: false, supervisorUserIds: ["user_sup_scoped"],
    });
    expect(inv.status).toBe(200);
    let sup = readAuth().users.find((u) => u.id === "user_sup_scoped");
    expect(sup.visibleSetterIds).toContain("setter_vendedor_revocado");

    const del = await request(app).delete(`/api/auth/invites/${inv.body.invite.id}`).set("Cookie", adminCookie);
    expect(del.status).toBe(200);
    expect(del.body.orphanSetterRemoved).toBe("setter_vendedor_revocado");
    sup = readAuth().users.find((u) => u.id === "user_sup_scoped");
    expect(sup.visibleSetterIds).not.toContain("setter_vendedor_revocado");
    expect(sup.visibleSetterIds).toContain("setter_a");
  });
});

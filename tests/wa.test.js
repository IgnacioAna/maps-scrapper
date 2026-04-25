// Tests del módulo WA en GoogleSrapper.
// Setup: NODE_ENV=test + DATA_DIR a un tmp + ADMIN_* mocks.
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `wa-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admintest@local.test";
process.env.ADMIN_PASSWORD = "testpass1234";
process.env.ADMIN_NAME = "AdminTest";
process.env.JWT_SECRET = "test-secret-please-change";

// Pre-popular auth.json en tmpData con admin + setter ANTES de importar la app,
// para que seedVolumeFromRepo no traiga el auth.json del repo (Ignacio).
import crypto from "node:crypto";
function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}
fs.writeFileSync(
  path.join(tmpData, "auth.json"),
  JSON.stringify({
    users: [
      { id: "user_admin_test", email: "admintest@local.test", name: "AdminTest", role: "admin", status: "active", setterId: "", password: pwd("testpass1234"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: "user_setter_test", email: "setter@local.test", name: "Setter Test", role: "setter", status: "active", setterId: "setter_test", password: pwd("setterpass"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ],
    invites: [],
    sessions: [],
  }, null, 2)
);

// Importar app DESPUÉS de setear env y crear auth.json
const { app } = await import("../index.js");

// Helpers
let token = "";
let setterToken = "";

async function api(method, path, body, tok = token) {
  const r = request(app)[method.toLowerCase()](path);
  if (tok) r.set("Authorization", `Bearer ${tok}`);
  if (body) r.send(body);
  return r;
}

async function loginDesktop(email, password) {
  const r = await request(app).post("/api/auth/desktop-login").send({ email, password });
  return r.body;
}

beforeAll(async () => {
  const ad = await loginDesktop("admintest@local.test", "testpass1234");
  expect(ad.token).toBeTruthy();
  token = ad.token;
  const sd = await loginDesktop("setter@local.test", "setterpass");
  expect(sd.token).toBeTruthy();
  setterToken = sd.token;
});

afterAll(() => {
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
});

describe("auth", () => {
  it("desktop-login con creds correctas devuelve token", async () => {
    const r = await loginDesktop("admintest@local.test", "testpass1234");
    expect(r.token).toBeTruthy();
    expect(r.user.role).toBe("admin");
  });

  it("desktop-login con creds incorrectas → 401", async () => {
    const r = await request(app).post("/api/auth/desktop-login").send({ email: "admintest@local.test", password: "wrong" });
    expect(r.status).toBe(401);
  });

  it("desktop-login sin body → 400", async () => {
    const r = await request(app).post("/api/auth/desktop-login").send({});
    expect(r.status).toBe(400);
  });
});

describe("rbac", () => {
  it("admin puede listar accounts", async () => {
    const r = await api("GET", "/api/wa/accounts");
    expect(r.status).toBe(200);
  });

  it("setter puede listar SUS accounts (filtradas)", async () => {
    const r = await api("GET", "/api/wa/accounts", null, setterToken);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
  });

  it("setter NO puede crear accounts", async () => {
    const r = await api("POST", "/api/wa/accounts", { label: "should fail" }, setterToken);
    expect(r.status).toBe(403);
  });

  it("setter NO puede ver routines", async () => {
    const r = await api("GET", "/api/wa/routines", null, setterToken);
    expect(r.status).toBe(403);
  });

  it("requests sin token → 401", async () => {
    const r = await request(app).get("/api/wa/accounts");
    expect(r.status).toBe(401);
  });
});

describe("accounts CRUD", () => {
  let accountId = "";
  it("crear account", async () => {
    const r = await api("POST", "/api/wa/accounts", { label: "Test 1" });
    expect(r.status).toBe(200);
    expect(r.body.id).toBeTruthy();
    expect(r.body.label).toBe("Test 1");
    expect(r.body.status).toBe("DISCONNECTED");
    accountId = r.body.id;
  });

  it("listar incluye la nueva", async () => {
    const r = await api("GET", "/api/wa/accounts");
    expect(r.body.find((a) => a.id === accountId)).toBeTruthy();
  });

  it("patch label", async () => {
    const r = await api("PATCH", `/api/wa/accounts/${accountId}`, { label: "Renombrada" });
    expect(r.body.label).toBe("Renombrada");
  });

  it("assign setter", async () => {
    const r = await api("POST", `/api/wa/accounts/${accountId}/assign`, { kind: "setter", refId: "setter_test" });
    expect(r.status).toBe(200);
    expect(r.body.assignment.kind).toBe("setter");
    expect(r.body.assignment.refId).toBe("setter_test");
  });

  it("setter ahora la ve en su lista", async () => {
    const r = await api("GET", "/api/wa/accounts", null, setterToken);
    expect(r.body.find((a) => a.id === accountId)).toBeTruthy();
  });

  it("delete", async () => {
    const r = await api("DELETE", `/api/wa/accounts/${accountId}`);
    expect(r.status).toBe(200);
    const r2 = await api("GET", "/api/wa/accounts");
    expect(r2.body.find((a) => a.id === accountId)).toBeFalsy();
  });
});

describe("routines CRUD", () => {
  let routineId = "";
  it("crear routine con messages y targets", async () => {
    const r = await api("POST", "/api/wa/routines", {
      name: "R1",
      dailyMessages: 5,
      messages: ["hola", "que tal"],
      targets: ["549111"],
      autoReply: true,
      autoReplies: ["si"],
    });
    expect(r.status).toBe(200);
    expect(r.body.messages).toEqual(["hola", "que tal"]);
    expect(r.body.targets).toEqual(["549111"]);
    expect(r.body.autoReply).toBe(true);
    routineId = r.body.id;
  });

  it("update routine", async () => {
    const r = await api("PUT", `/api/wa/routines/${routineId}`, { name: "R1 v2", dailyMessages: 10 });
    expect(r.body.name).toBe("R1 v2");
    expect(r.body.dailyMessages).toBe(10);
  });

  it("attach a un account creado al vuelo", async () => {
    const acc = (await api("POST", "/api/wa/accounts", { label: "Para attach" })).body;
    const r = await api("POST", "/api/wa/routines/attach", { accountId: acc.id, routineId });
    expect(r.status).toBe(200);
    expect(r.body.routineId).toBe(routineId);
  });

  it("delete routine", async () => {
    const r = await api("DELETE", `/api/wa/routines/${routineId}`);
    expect(r.status).toBe(200);
  });
});

describe("commands", () => {
  it("bulk con array vacio → 400", async () => {
    const r = await api("POST", "/api/wa/commands/bulk", { accountIds: [], action: "open" });
    expect(r.status).toBe(400);
  });

  it("bulk con accion invalida → 400", async () => {
    const r = await api("POST", "/api/wa/commands/bulk", { accountIds: ["x"], action: "destroy-everything" });
    expect(r.status).toBe(400);
  });

  it("bulk con cuenta valida pero sin asignar → reporta error", async () => {
    const acc = (await api("POST", "/api/wa/accounts", { label: "Sin asignar" })).body;
    const r = await api("POST", "/api/wa/commands/bulk", { accountIds: [acc.id], action: "open" });
    expect(r.status).toBe(200);
    expect(r.body.errors).toHaveLength(1);
  });

  it("send-message sin params → 400", async () => {
    const r = await api("POST", "/api/wa/commands/send-message", { accountId: "x" });
    expect(r.status).toBe(400);
  });
});

describe("stats", () => {
  it("summary devuelve estructura correcta", async () => {
    const r = await api("GET", "/api/wa/stats/summary");
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("totalAccounts");
    expect(r.body).toHaveProperty("byStatus");
    expect(r.body).toHaveProperty("eventsLast24h");
  });

  it("events-by-hour devuelve buckets", async () => {
    const r = await api("GET", "/api/wa/stats/events-by-hour?hours=12");
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(12);
  });

  it("setter no accede a stats", async () => {
    const r = await api("GET", "/api/wa/stats/summary", null, setterToken);
    expect(r.status).toBe(403);
  });
});

describe("events", () => {
  it("setter solo ve sus eventos", async () => {
    // post via HTTP fallback
    await api("POST", "/api/wa/events", { type: "smoke", payload: { x: 1 } });
    const r = await api("GET", "/api/wa/events", null, setterToken);
    expect(r.status).toBe(200);
    // events viejo del admin no deberian estar en lista del setter
    expect(r.body.every((e) => e.userId === "user_setter_test")).toBe(true);
  });
});

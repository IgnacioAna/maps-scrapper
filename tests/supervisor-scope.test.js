// Tests de scoping server-side del rol supervisor (Phase 18, plan 18-02).
// Un supervisor con `visibleSetterIds` configurado ("scoped") solo debe ver
// data de esos setters en TODOS los endpoints agregados/listas/leads; uno SIN
// la lista (o admin) debe seguir viendo todo (cero regresion). Sigue el
// patron de setup de tests/training-privacy.test.js.
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `supervisor-scope-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-ss@local.test";
process.env.ADMIN_PASSWORD = "adminpass1";
process.env.ADMIN_NAME = "AdminSS";
process.env.JWT_SECRET = "test-secret-ss";
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
const NOW = Date.now();
const tHours = (offsetHours) => new Date(NOW - offsetHours * 60 * 60 * 1000).toISOString();

fs.writeFileSync(
  path.join(tmpData, "auth.json"),
  JSON.stringify({
    users: [
      { id: "user_admin", email: "admin-ss@local.test", name: "AdminSS", role: "admin", status: "active", setterId: "", password: pwd("adminpass1"), createdAt: now, updatedAt: now },
      { id: "user_sup_scoped", email: "sup-scoped@local.test", name: "SupScoped", role: "supervisor", status: "active", setterId: "", visibleSetterIds: ["setter_a", "setter_b"], password: pwd("suppass1"), createdAt: now, updatedAt: now },
      { id: "user_sup_all", email: "sup-all@local.test", name: "SupAll", role: "supervisor", status: "active", setterId: "", password: pwd("suppass2"), createdAt: now, updatedAt: now },
      { id: "user_link_a", email: "link-a@local.test", name: "LinkA", role: "setter", status: "active", setterId: "setter_a", password: pwd("linkapass"), createdAt: now, updatedAt: now },
      { id: "user_link_c", email: "link-c@local.test", name: "LinkC", role: "setter", status: "active", setterId: "setter_c", password: pwd("linkcpass"), createdAt: now, updatedAt: now },
    ],
    invites: [],
    sessions: [],
  }, null, 2)
);

// callLog: setter_a = 2 dials (1 connect+conversation), setter_b = 4 dials
// (1 connect+conversation), setter_c (OCULTO para el supervisor scoped) = 10
// dials (1 connect+conversation). Todas con channel telnyx_webrtc + algunas
// con scriptIdsUsed para probar script-effectiveness.
const leads = {
  lead_a1: {
    id: "lead_a1", num: 1, name: "Clinica A1", phone: "+5215500000001", country: "México",
    assignedTo: "setter_a", estado: "sin_contactar",
    callLog: [{ ts: tHours(2), outcome: "answered_interested", duration: 40, channel: "telnyx_webrtc", scriptIdsUsed: ["script_1"] }],
  },
  lead_a2: {
    id: "lead_a2", num: 2, name: "Clinica A2", phone: "+5215500000002", country: "México",
    assignedTo: "setter_a", estado: "sin_contactar",
    callLog: [{ ts: tHours(4), outcome: "no_answer", duration: 0, channel: "telnyx_webrtc" }],
  },
  lead_b1: {
    id: "lead_b1", num: 3, name: "Clinica B1", phone: "+5215500000003", country: "México",
    assignedTo: "setter_b", estado: "sin_contactar",
    callLog: [
      { ts: tHours(1), outcome: "answered_interested", duration: 35, channel: "telnyx_webrtc", scriptIdsUsed: ["script_1"] },
      { ts: tHours(3), outcome: "no_answer", duration: 0, channel: "telnyx_webrtc" },
      { ts: tHours(5), outcome: "voicemail", duration: 0, channel: "telnyx_webrtc" },
      { ts: tHours(7), outcome: "no_answer", duration: 0, channel: "telnyx_webrtc" },
    ],
  },
  lead_c1: {
    id: "lead_c1", num: 4, name: "Clinica C1 oculta", phone: "+5215500000004", country: "México",
    assignedTo: "setter_c", estado: "sin_contactar",
    callLog: [
      { ts: tHours(1), outcome: "answered_interested", duration: 50, channel: "telnyx_webrtc", scriptIdsUsed: ["script_1"] },
      { ts: tHours(2), outcome: "no_answer", duration: 0, channel: "telnyx_webrtc" },
      { ts: tHours(3), outcome: "no_answer", duration: 0, channel: "telnyx_webrtc" },
      { ts: tHours(4), outcome: "no_answer", duration: 0, channel: "telnyx_webrtc" },
      { ts: tHours(5), outcome: "no_answer", duration: 0, channel: "telnyx_webrtc" },
      { ts: tHours(6), outcome: "no_answer", duration: 0, channel: "telnyx_webrtc" },
      { ts: tHours(7), outcome: "no_answer", duration: 0, channel: "telnyx_webrtc" },
      { ts: tHours(8), outcome: "no_answer", duration: 0, channel: "telnyx_webrtc" },
      { ts: tHours(9), outcome: "no_answer", duration: 0, channel: "telnyx_webrtc" },
      { ts: tHours(10), outcome: "no_answer", duration: 0, channel: "telnyx_webrtc" },
    ],
  },
  // Solo para el caso de speed-to-lead (recent-responses), sin callLog.
  lead_resp_a: { id: "lead_resp_a", num: 5, name: "RespA", phone: "+5215500000005", country: "México", assignedTo: "setter_a", estado: "sin_contactar" },
  lead_resp_c: { id: "lead_resp_c", num: 6, name: "RespC", phone: "+5215500000006", country: "México", assignedTo: "setter_c", estado: "sin_contactar" },
};

fs.writeFileSync(
  path.join(tmpData, "setters.json"),
  JSON.stringify({
    setters: [
      { id: "setter_a", name: "SetterA" },
      { id: "setter_b", name: "SetterB" },
      { id: "setter_c", name: "SetterC" },
    ],
    variants: [],
    leads,
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

let adminCookie = "", supScopedCookie = "", supAllCookie = "";

beforeAll(async () => {
  adminCookie = await login("admin-ss@local.test", "adminpass1");
  supScopedCookie = await login("sup-scoped@local.test", "suppass1");
  supAllCookie = await login("sup-all@local.test", "suppass2");
});

afterAll(() => {
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
});

describe("team-performance — scoping", () => {
  it("supervisor scoped ve solo setter_a y setter_b (no setter_c)", async () => {
    const r = await request(app).get("/api/setters/team-performance").set("Cookie", supScopedCookie);
    expect(r.status).toBe(200);
    const ids = r.body.perSetter.map((s) => s.id).sort();
    expect(ids).toEqual(["setter_a", "setter_b"]);
  });

  it("teamAverages.total computado solo sobre setter_a (2 dials) + setter_b (4 dials) = avg 3", async () => {
    const r = await request(app).get("/api/setters/team-performance").set("Cookie", supScopedCookie);
    expect(r.status).toBe(200);
    expect(r.body.teamAverages.total).toBe(3);
  });

  it("panel pro — teamTotals y callsByDay.perSetter del supervisor scoped solo incluyen setter_a/setter_b", async () => {
    const r = await request(app).get("/api/setters/team-performance").set("Cookie", supScopedCookie);
    expect(r.status).toBe(200);
    // teamTotals: suma de dials del período (setter_a=2 + setter_b=4 = 6).
    expect(r.body.teamTotals).toBeTruthy();
    expect(r.body.teamTotals.dials).toBe(6);
    // callsByDay: ventana fija de 14 días, solo setters visibles.
    expect(r.body.callsByDay).toBeTruthy();
    expect(Array.isArray(r.body.callsByDay.days)).toBe(true);
    expect(r.body.callsByDay.days.length).toBe(14);
    const cbdIds = r.body.callsByDay.perSetter.map((s) => s.setterId).sort();
    expect(cbdIds).toEqual(["setter_a", "setter_b"]);
  });

  it("panel pro — admin recibe callsByDay con los 3 setters", async () => {
    const r = await request(app).get("/api/setters/team-performance").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    const cbdIds = r.body.callsByDay.perSetter.map((s) => s.setterId).sort();
    expect(cbdIds).toEqual(["setter_a", "setter_b", "setter_c"]);
    // teamTotals admin suma los 3 (2+4+10=16).
    expect(r.body.teamTotals.dials).toBe(16);
  });
});

describe("cold-call-metrics — scoping", () => {
  it("supervisor scoped sin ?setter agrega solo setter_a (2) + setter_b (4) = 6 dials", async () => {
    const r = await request(app).get("/api/setters/cold-call-metrics").set("Cookie", supScopedCookie);
    expect(r.status).toBe(200);
    expect(r.body.metrics.dials).toBe(6);
  });

  it("supervisor scoped ?setter=setter_c (oculto) -> 403", async () => {
    const r = await request(app).get("/api/setters/cold-call-metrics?setter=setter_c").set("Cookie", supScopedCookie);
    expect(r.status).toBe(403);
  });

  it("admin sin ?setter agrega los 3 setters (2+4+10=16 dials)", async () => {
    const r = await request(app).get("/api/setters/cold-call-metrics").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.metrics.dials).toBe(16);
  });
});

describe("/api/setters y /api/setters/stats — setters[] filtrado", () => {
  it("GET /api/setters no incluye setter_c para el supervisor scoped", async () => {
    const r = await request(app).get("/api/setters").set("Cookie", supScopedCookie);
    expect(r.status).toBe(200);
    const ids = r.body.setters.map((s) => s.id).sort();
    expect(ids).toEqual(["setter_a", "setter_b"]);
  });

  it("GET /api/setters/stats no incluye setter_c para el supervisor scoped", async () => {
    const r = await request(app).get("/api/setters/stats").set("Cookie", supScopedCookie);
    expect(r.status).toBe(200);
    const ids = r.body.setters.map((s) => s.id).sort();
    expect(ids).toEqual(["setter_a", "setter_b"]);
  });

  it("GET /api/setters admin ve los 3 setters", async () => {
    const r = await request(app).get("/api/setters").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.setters.map((s) => s.id).sort()).toEqual(["setter_a", "setter_b", "setter_c"]);
  });
});

describe("PATCH lead de setter oculto -> 403", () => {
  it("supervisor scoped no puede tocar un lead de setter_c", async () => {
    const r = await request(app).patch("/api/setters/leads/lead_c1").set("Cookie", supScopedCookie).send({ interes: "si" });
    expect(r.status).toBe(403);
  });
});

describe("Endpoints financieros/pool bloqueados para supervisor scoped", () => {
  it("GET /api/telnyx/balance -> 403", async () => {
    const r = await request(app).get("/api/telnyx/balance").set("Cookie", supScopedCookie);
    expect(r.status).toBe(403);
  });
});

describe("/api/auth/online — scoping", () => {
  it("supervisor scoped no incluye al user linkeado a setter_c", async () => {
    const r = await request(app).get("/api/auth/online").set("Cookie", supScopedCookie);
    expect(r.status).toBe(200);
    const ids = r.body.users.map((u) => u.id);
    expect(ids).not.toContain("user_link_c");
    expect(ids).toContain("user_link_a");
  });
});

describe("/api/auth/users — scoping", () => {
  it("supervisor scoped ve su propio user + users con setterId visible, no el de setter_c", async () => {
    const r = await request(app).get("/api/auth/users").set("Cookie", supScopedCookie);
    expect(r.status).toBe(200);
    const ids = r.body.users.map((u) => u.id).sort();
    expect(ids).toEqual(["user_link_a", "user_sup_scoped"]);
  });

  it("admin ve a todos los users", async () => {
    const r = await request(app).get("/api/auth/users").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.users.length).toBe(5);
  });
});

describe("/api/telnyx/script-effectiveness — scoping", () => {
  it("supervisor scoped cuenta solo llamadas de setter_a/setter_b (used=2)", async () => {
    const r = await request(app).get("/api/telnyx/script-effectiveness?range=all").set("Cookie", supScopedCookie);
    expect(r.status).toBe(200);
    const s1 = r.body.scripts.find((s) => s.scriptId === "script_1");
    expect(s1).toBeTruthy();
    expect(s1.used).toBe(2);
  });

  it("admin ve el total completo (used=3, incluye setter_c)", async () => {
    const r = await request(app).get("/api/telnyx/script-effectiveness?range=all").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    const s1 = r.body.scripts.find((s) => s.scriptId === "script_1");
    expect(s1).toBeTruthy();
    expect(s1.used).toBe(3);
  });
});

describe("/api/setters/recent-responses — speed-to-lead scoping", () => {
  it("supervisor scoped solo ve la respuesta de setter_a, admin ve ambas", async () => {
    const sinceIso = new Date(Date.now() - 5000).toISOString();
    const rc = await request(app).patch("/api/setters/leads/lead_resp_c").set("Cookie", adminCookie).send({ respondio: true });
    expect(rc.status).toBe(200);
    const ra = await request(app).patch("/api/setters/leads/lead_resp_a").set("Cookie", adminCookie).send({ respondio: true });
    expect(ra.status).toBe(200);

    const scoped = await request(app).get(`/api/setters/recent-responses?since=${encodeURIComponent(sinceIso)}`).set("Cookie", supScopedCookie);
    expect(scoped.status).toBe(200);
    const scopedSetterIds = scoped.body.responses.map((x) => x.setterId).sort();
    expect(scopedSetterIds).toEqual(["setter_a"]);

    const admin = await request(app).get(`/api/setters/recent-responses?since=${encodeURIComponent(sinceIso)}`).set("Cookie", adminCookie);
    expect(admin.status).toBe(200);
    const adminSetterIds = admin.body.responses.map((x) => x.setterId).sort();
    expect(adminSetterIds).toEqual(["setter_a", "setter_c"]);
  });
});

describe("Regresion — supervisor SIN visibleSetterIds y admin ven todo", () => {
  it("supervisor sin lista ve los 3 setters en team-performance", async () => {
    const r = await request(app).get("/api/setters/team-performance").set("Cookie", supAllCookie);
    expect(r.status).toBe(200);
    expect(r.body.perSetter.map((s) => s.id).sort()).toEqual(["setter_a", "setter_b", "setter_c"]);
  });

  it("admin ve los 3 setters en team-performance", async () => {
    const r = await request(app).get("/api/setters/team-performance").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.perSetter.map((s) => s.id).sort()).toEqual(["setter_a", "setter_b", "setter_c"]);
  });
});

// IMPORTANTE: estos casos MUTAN visibleSetterIds del user_sup_scoped — van al
// final para no afectar las aserciones de scoping de arriba.
describe("Gestion admin-only de visibleSetterIds", () => {
  it("admin PATCH visibleSetterIds persiste", async () => {
    const r = await request(app).patch("/api/auth/users/user_sup_scoped").set("Cookie", adminCookie).send({ visibleSetterIds: ["setter_a"] });
    expect(r.status).toBe(200);
    expect(r.body.user.visibleSetterIds).toEqual(["setter_a"]);
  });

  it("admin PATCH con id inexistente se filtra (no persiste el invalido)", async () => {
    const r = await request(app).patch("/api/auth/users/user_sup_scoped").set("Cookie", adminCookie).send({ visibleSetterIds: ["setter_zzz"] });
    expect(r.status).toBe(200);
    expect(r.body.user.visibleSetterIds).toEqual([]);
  });

  it("supervisor scoped no puede editar sus propios visibleSetterIds (admin-only)", async () => {
    const r = await request(app).patch("/api/auth/users/user_sup_scoped").set("Cookie", supScopedCookie).send({ visibleSetterIds: ["setter_a"] });
    expect(r.status).toBe(403);
  });
});

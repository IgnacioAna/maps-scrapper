// Phase 7 — Tests del data layer del motor de campañas (Wave 1).
// Mayormente unitarios sobre helpers puros + CRUD del file. No requieren la app
// HTTP (eso son las waves siguientes), pero seteamos DATA_DIR para el file.
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `wa-camp-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });

// Pre-popular auth + setters (con leads + variantes) ANTES de importar la app.
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admintest@local.test";
process.env.ADMIN_PASSWORD = "testpass1234";
process.env.ADMIN_NAME = "AdminTest";
process.env.JWT_SECRET = "test-secret-please-change";
function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}
fs.writeFileSync(path.join(tmpData, "auth.json"), JSON.stringify({
  users: [
    { id: "user_admin_test", email: "admintest@local.test", name: "AdminTest", role: "admin", status: "active", setterId: "", password: pwd("testpass1234"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: "user_setter_a", email: "settera@local.test", name: "Setter A", role: "setter", status: "active", setterId: "setter_a", password: pwd("passa"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  ], invites: [], sessions: [],
}, null, 2));
fs.writeFileSync(path.join(tmpData, "setters.json"), JSON.stringify({
  setters: [{ id: "setter_a", name: "Setter A" }],
  variants: [{ id: "var_a", name: "V1", blocks: [{ label: "Apertura", text: "Hola {{nombre}}" }] }],
  leads: {
    L1: { id: "L1", phone: "5215551111", country: "MX", estado: "sin_contactar", assignedTo: "setter_a" },
    L2: { id: "L2", phone: "5215552222", country: "MX", estado: "sin_contactar", assignedTo: "setter_a" },
    L3: { id: "L3", phone: "5491133333", country: "AR", estado: "sin_contactar", assignedTo: "setter_a" },
  },
  calendar: [], sessions: [],
}, null, 2));

const camp = await import("../src/wa/campaigns.js");
const { app } = await import("../index.js");

let adminTok = "", setterTok = "";
async function login(email, password) {
  const r = await request(app).post("/api/auth/desktop-login").send({ email, password });
  return r.body.token;
}
async function api(method, p, body, tok) {
  const r = request(app)[method.toLowerCase()](p);
  if (tok) r.set("Authorization", `Bearer ${tok}`);
  if (body) r.send(body);
  return r;
}

beforeAll(async () => {
  camp.initCampaignsData(tmpData);
  adminTok = await login("admintest@local.test", "testpass1234");
  setterTok = await login("settera@local.test", "passa");
});
afterAll(() => {
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
});

describe("sanitizeCampaign", () => {
  const valid = {
    name: "México lote 1",
    accountIds: ["wa_1"],
    variantSplit: [{ variantId: "var_a", weight: 1 }],
    drip: { batchSize: 1, intervalMinutes: 5 },
    window: { hourStart: 10, hourEnd: 19, days: [1, 2, 3], timezone: "America/Mexico_City" },
    blockDelay: { minMs: 60000, maxMs: 180000 },
    bumps: [{ afterHours: 24, text: "hola?" }],
    qualifyMessage: "te interesa?",
  };

  it("acepta una campaña válida y normaliza", () => {
    const [err, out] = camp.sanitizeCampaign(valid);
    expect(err).toBe(null);
    expect(out.name).toBe("México lote 1");
    expect(out.drip.intervalMinutes).toBe(5);
    expect(out.window.timezone).toBe("America/Mexico_City");
  });

  it("rechaza sin accountIds", () => {
    const [err] = camp.sanitizeCampaign({ ...valid, accountIds: [] });
    expect(err).toMatch(/cuenta/i);
  });

  it("rechaza sin variantSplit", () => {
    const [err] = camp.sanitizeCampaign({ ...valid, variantSplit: [] });
    expect(err).toMatch(/variante/i);
  });

  it("rechaza bump sin texto", () => {
    const [err] = camp.sanitizeCampaign({ ...valid, bumps: [{ afterHours: 24, text: "" }] });
    expect(err).toMatch(/texto/i);
  });

  it("clampa blockDelay al mínimo de seguridad (3s)", () => {
    const [, out] = camp.sanitizeCampaign({ ...valid, blockDelay: { minMs: 100, maxMs: 200 } });
    expect(out.blockDelay.minMs).toBeGreaterThanOrEqual(3000);
    expect(out.blockDelay.maxMs).toBeGreaterThanOrEqual(out.blockDelay.minMs);
  });

  it("clampa drip.batchSize a [1,50]", () => {
    const [, out] = camp.sanitizeCampaign({ ...valid, drip: { batchSize: 999, intervalMinutes: 5 } });
    expect(out.drip.batchSize).toBe(50);
  });
});

describe("CRUD campañas", () => {
  let id;
  it("create devuelve campaña en draft", () => {
    const [err, c] = camp.createCampaign({
      name: "Test",
      accountIds: ["wa_1"],
      variantSplit: [{ variantId: "var_a", weight: 1 }],
    }, "setter_x");
    expect(err).toBe(null);
    expect(c.status).toBe("draft");
    expect(c.setterId).toBe("setter_x");
    expect(c.stats.queued).toBe(0);
    id = c.id;
  });

  it("list y get", () => {
    expect(camp.listCampaigns().some((c) => c.id === id)).toBe(true);
    expect(camp.getCampaign(id).name).toBe("Test");
  });

  it("update cambia status", () => {
    const u = camp.updateCampaign(id, { status: "running" });
    expect(u.status).toBe("running");
  });

  it("delete elimina campaña y sus leadStates", () => {
    camp.bulkInitLeadStates(id, [{ leadId: "L1", variantId: "var_a", accountId: "wa_1" }]);
    expect(Object.keys(camp.listLeadStates(id)).length).toBe(1);
    expect(camp.deleteCampaign(id)).toBe(true);
    expect(camp.getCampaign(id)).toBe(null);
    expect(Object.keys(camp.listLeadStates(id)).length).toBe(0);
  });
});

describe("leadStates", () => {
  let id;
  beforeAll(() => {
    const [, c] = camp.createCampaign({ name: "LS", accountIds: ["wa_1"], variantSplit: [{ variantId: "v", weight: 1 }] });
    id = c.id;
  });

  it("bulkInit crea estados en queued", () => {
    const n = camp.bulkInitLeadStates(id, [
      { leadId: "L1", variantId: "vA", accountId: "wa_1" },
      { leadId: "L2", variantId: "vB", accountId: "wa_1" },
    ]);
    expect(n).toBe(2);
    expect(camp.getLeadState(id, "L1").state).toBe("queued");
    expect(camp.getLeadState(id, "L1").blockIdx).toBe(0);
  });

  it("setLeadState hace merge", () => {
    camp.setLeadState(id, "L1", { state: "opener_sending", blockIdx: 1 });
    const ls = camp.getLeadState(id, "L1");
    expect(ls.state).toBe("opener_sending");
    expect(ls.blockIdx).toBe(1);
    expect(ls.variantId).toBe("vA"); // preservado
  });

  it("leadStateSummary cuenta por estado", () => {
    const s = camp.leadStateSummary(id);
    expect(s.opener_sending).toBe(1);
    expect(s.queued).toBe(1);
  });
});

describe("buildVariantAssignments (split ponderado)", () => {
  it("split parejo reparte ~50/50", () => {
    const a = camp.buildVariantAssignments([{ variantId: "A", weight: 1 }, { variantId: "B", weight: 1 }], 100);
    const countA = a.filter((x) => x === "A").length;
    expect(countA).toBe(50);
  });

  it("pesos 3:1 reparten ~75/25", () => {
    const a = camp.buildVariantAssignments([{ variantId: "A", weight: 3 }, { variantId: "B", weight: 1 }], 100);
    const countA = a.filter((x) => x === "A").length;
    expect(countA).toBe(75);
  });

  it("split vacío devuelve []", () => {
    expect(camp.buildVariantAssignments([], 10)).toEqual([]);
  });
});

describe("buildAccountAssignments (distribución multi-número)", () => {
  it("sin distribución → round-robin sobre accountIds", () => {
    const a = camp.buildAccountAssignments(["wa1", "wa2"], [], 10);
    expect(a.filter((x) => x === "wa1").length).toBe(5);
    expect(a.filter((x) => x === "wa2").length).toBe(5);
  });
  it("con pesos 2:1 reparte ~66/33", () => {
    const a = camp.buildAccountAssignments(["wa1", "wa2"], [{ accountId: "wa1", weight: 2 }, { accountId: "wa2", weight: 1 }], 99);
    expect(a.filter((x) => x === "wa1").length).toBe(66);
    expect(a.filter((x) => x === "wa2").length).toBe(33);
  });
  it("sin cuentas → []", () => expect(camp.buildAccountAssignments([], [], 5)).toEqual([]));
});

describe("selectLeadsFromMap", () => {
  const leads = {
    L1: { phone: "521111", country: "MX", estado: "sin_contactar", assignedTo: "s1" },
    L2: { phone: "549222", country: "AR", estado: "sin_contactar", assignedTo: "s1" },
    L3: { country: "MX", estado: "sin_contactar" },          // sin teléfono → excluido
    L4: { phone: "521333", country: "MX", estado: "descartado" }, // descartado → excluido
    L5: { phone: "521444", country: "MX", estado: "agendado" },   // agendado → excluido
    L6: { phone: "521555", country: "MX", estado: "sin_contactar", assignedTo: "s2" },
  };

  it("filtra por país", () => {
    const r = camp.selectLeadsFromMap(leads, { country: "MX" });
    expect(r.sort()).toEqual(["L1", "L6"]);
  });

  it("filtra por setter", () => {
    const r = camp.selectLeadsFromMap(leads, { setterId: "s1" });
    expect(r.sort()).toEqual(["L1", "L2"]);
  });

  it("respeta el límite", () => {
    const r = camp.selectLeadsFromMap(leads, { limit: 1 });
    expect(r.length).toBe(1);
  });

  it("excluye sin-teléfono, descartados y agendados", () => {
    const r = camp.selectLeadsFromMap(leads, {});
    expect(r).not.toContain("L3");
    expect(r).not.toContain("L4");
    expect(r).not.toContain("L5");
  });

  it("países por nombre español (como guardan los leads reales)", () => {
    const real = {
      A: { phone: "521", country: "México", estado: "sin_contactar" },
      B: { phone: "549", country: "Uruguay", estado: "sin_contactar" },
    };
    expect(camp.selectLeadsFromMap(real, { country: "MX" })).toEqual(["A"]);      // ISO matchea nombre
    expect(camp.selectLeadsFromMap(real, { country: "méxico" })).toEqual(["A"]);  // nombre con acento
    expect(camp.selectLeadsFromMap(real, { country: "mexico" })).toEqual(["A"]);  // nombre sin acento
    expect(camp.selectLeadsFromMap(real, { country: "uruguay" })).toEqual(["B"]);
  });
});

describe("countryMatches", () => {
  it("ISO ↔ nombre, con/sin acento", () => {
    expect(camp.countryMatches("México", "MX")).toBe(true);
    expect(camp.countryMatches("México", "mexico")).toBe(true);
    expect(camp.countryMatches("Uruguay", "UY")).toBe(true);
    expect(camp.countryMatches("España", "ES")).toBe(true);
    expect(camp.countryMatches("Argentina", "MX")).toBe(false);
    expect(camp.countryMatches("", "MX")).toBe(false);
    expect(camp.countryMatches("México", "")).toBe(true); // sin filtro → todos
  });
});

describe("randomBlockDelay", () => {
  it("queda dentro del rango", () => {
    for (let i = 0; i < 20; i++) {
      const d = camp.randomBlockDelay({ minMs: 60000, maxMs: 180000 });
      expect(d).toBeGreaterThanOrEqual(60000);
      expect(d).toBeLessThanOrEqual(180000);
    }
  });
});

describe("endpoints REST (Wave 2)", () => {
  let campId;
  const draft = {
    name: "MX lote",
    accountIds: ["wa_x"],
    variantSplit: [{ variantId: "var_a", weight: 1 }],
    drip: { batchSize: 1, intervalMinutes: 5 },
    leadFilter: { country: "MX", limit: 100 },
  };

  it("setter crea campaña (queda a su nombre)", async () => {
    const r = await api("POST", "/api/wa/campaigns", draft, setterTok);
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("draft");
    expect(r.body.setterId).toBe("setter_a");
    campId = r.body.id;
  });

  it("crear sin variantes → 400", async () => {
    const r = await api("POST", "/api/wa/campaigns", { ...draft, variantSplit: [] }, setterTok);
    expect(r.status).toBe(400);
  });

  it("lanzar snapshotea leads MX (2) y pasa a running", async () => {
    const r = await api("POST", `/api/wa/campaigns/${campId}/launch`, {}, setterTok);
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("running");
    expect(r.body.launched).toBe(2); // L1, L2 (MX); L3 es AR
    expect(r.body.leadSummary.queued).toBe(2);
  });

  it("no se puede editar una campaña running → 409", async () => {
    const r = await api("PATCH", `/api/wa/campaigns/${campId}`, { name: "nuevo" }, setterTok);
    expect(r.status).toBe(409);
  });

  it("pausar y reanudar", async () => {
    let r = await api("POST", `/api/wa/campaigns/${campId}/pause`, {}, setterTok);
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("paused");
    r = await api("POST", `/api/wa/campaigns/${campId}/resume`, {}, setterTok);
    expect(r.body.status).toBe("running");
  });

  it("relanzar una campaña ya running → 409", async () => {
    const r = await api("POST", `/api/wa/campaigns/${campId}/launch`, {}, setterTok);
    expect(r.status).toBe(409);
  });

  it("admin ve la campaña del setter; otro contexto respeta RBAC", async () => {
    const r = await api("GET", "/api/wa/campaigns", null, adminTok);
    expect(r.status).toBe(200);
    expect(r.body.some((c) => c.id === campId)).toBe(true);
  });

  it("lanzar con filtro que no matchea → 400", async () => {
    const cr = await api("POST", "/api/wa/campaigns", { ...draft, leadFilter: { country: "ZZ", limit: 10 } }, setterTok);
    const r = await api("POST", `/api/wa/campaigns/${cr.body.id}/launch`, {}, setterTok);
    expect(r.status).toBe(400);
  });

  it("cancelar", async () => {
    const r = await api("POST", `/api/wa/campaigns/${campId}/cancel`, {}, setterTok);
    expect(r.body.status).toBe("cancelled");
  });

  it("GET /:id/leads lista los leads con nombre/teléfono/estado", async () => {
    // crear + lanzar una campaña fresca para tener leadStates
    const cr = await api("POST", "/api/wa/campaigns", { ...draft, name: "ConLeads" }, setterTok);
    await api("POST", `/api/wa/campaigns/${cr.body.id}/launch`, {}, setterTok);
    const r = await api("GET", `/api/wa/campaigns/${cr.body.id}/leads`, null, setterTok);
    expect(r.status).toBe(200);
    expect(r.body.total).toBeGreaterThan(0);
    expect(r.body.leads[0]).toHaveProperty("name");
    expect(r.body.leads[0]).toHaveProperty("phone");
    expect(r.body.leads[0]).toHaveProperty("state");
  });

  it("el export del módulo WA incluye campaigns (sobrevive redeploy)", async () => {
    const r = await api("GET", "/api/wa/admin/export", null, adminTok);
    expect(r.status).toBe(200);
    expect(r.body.campaigns).toBeTruthy();
    expect(Array.isArray(r.body.campaigns.campaigns)).toBe(true);
    expect(r.body.campaigns.leadStates).toBeTruthy();
  });
});

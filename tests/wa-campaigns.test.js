// Phase 7 — Tests del data layer del motor de campañas (Wave 1).
// Mayormente unitarios sobre helpers puros + CRUD del file. No requieren la app
// HTTP (eso son las waves siguientes), pero seteamos DATA_DIR para el file.
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const tmpData = path.join(os.tmpdir(), `wa-camp-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });

const camp = await import("../src/wa/campaigns.js");

beforeAll(() => {
  camp.initCampaignsData(tmpData);
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

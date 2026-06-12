// Phase 7 v2 — Tests del motor de campañas con el flujo NUEVO:
// opener → esperar respuesta → (si responde) pitch en bloques con delays →
// esperar → (si responde) Mercury conversa. A los que NO responden el opener
// NO se les manda nada (sin bumps).
import { describe, it, beforeEach, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const tmpData = path.join(os.tmpdir(), `wa-engine-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.DATA_DIR = tmpData;

const camp = await import("../src/wa/campaigns.js");
const eng = await import("../src/wa/campaign-engine.js");

beforeAll(() => camp.initCampaignsData(tmpData));
afterAll(() => { try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {} });

// ── Helpers puros ────────────────────────────────────────────────────────────
describe("isWithinWindow", () => {
  const utcNoon = new Date("2026-06-10T18:00:00Z"); // miércoles, 12:00 MX
  it("dentro de 10-19h MX miércoles → true", () => {
    expect(eng.isWithinWindow({ hourStart: 10, hourEnd: 19, days: [1,2,3,4,5], timezone: "America/Mexico_City" }, utcNoon)).toBe(true);
  });
  it("día no permitido → false", () => {
    expect(eng.isWithinWindow({ hourStart: 10, hourEnd: 19, days: [0], timezone: "America/Mexico_City" }, utcNoon)).toBe(false);
  });
  it("fuera de hora → false", () => {
    expect(eng.isWithinWindow({ hourStart: 0, hourEnd: 6, days: [1,2,3,4,5], timezone: "America/Mexico_City" }, utcNoon)).toBe(false);
  });
});

describe("warmingCapByDay", () => {
  const mk = (d) => ({ routineStartedAt: new Date(Date.now() - d * 86400000).toISOString() });
  it("día 1 → 12", () => expect(eng.warmingCapByDay(mk(0))).toBe(12));
  it("día 8 → 80", () => expect(eng.warmingCapByDay(mk(7))).toBe(80));
  it("día 20 → 400", () => expect(eng.warmingCapByDay(mk(19))).toBe(400));
  it("sin warming → 80", () => expect(eng.warmingCapByDay({})).toBe(80));
});

describe("sendGapMs (ritmo por cuenta)", () => {
  const mk = (d) => ({ routineStartedAt: new Date(Date.now() - d * 86400000).toISOString() });
  it("override explícito manda", () => expect(eng.sendGapMs({ minSendGapMinutes: 15 })).toBe(15 * 60000));
  it("override bajo el piso → 1 min", () => expect(eng.sendGapMs({ minSendGapMinutes: 0 })).toBe(60000));
  it("sin warming → 8 min", () => expect(eng.sendGapMs({})).toBe(8 * 60000));
  it("curva: nueva lenta, madura rápida", () => {
    expect(eng.sendGapMs(mk(0))).toBe(8 * 60000);
    expect(eng.sendGapMs(mk(4))).toBe(5 * 60000);
    expect(eng.sendGapMs(mk(8))).toBe(3 * 60000);
    expect(eng.sendGapMs(mk(20))).toBe(90 * 1000);
  });
});

describe("pickOpener", () => {
  it("elige uno e interpola {{nombre}}", () => {
    const t = eng.pickOpener({ openers: ["Hola {{nombre}}"] }, { name: "Ana" });
    expect(t).toBe("Hola Ana");
  });
  it("sin openers → null", () => expect(eng.pickOpener({ openers: [] }, {})).toBe(null));
});

describe("variantBlockTexts", () => {
  it("interpola {{nombre}} y filtra vacíos", () => {
    const v = { blocks: [{ text: "Hola {{nombre}}" }, { text: "" }, { text: "Sos de la clínica?" }] };
    expect(eng.variantBlockTexts(v, { name: "Dr. Pérez" })).toEqual(["Hola Dr. Pérez", "Sos de la clínica?"]);
  });
});

describe("phoneMatches", () => {
  it("igual exacto", () => expect(eng.phoneMatches("5215550000", "5215550000")).toBe(true));
  it("últimos 8 dígitos", () => expect(eng.phoneMatches("5255001234", "055001234")).toBe(true));
  it("distintos", () => expect(eng.phoneMatches("5215550000", "5491199999")).toBe(false));
});

// ── Flujo nuevo: opener → espera → pitch → espera → Mercury ───────────────────
describe("flujo nuevo end-to-end", () => {
  const sent = [];
  const variant = { id: "v1", blocks: [{ text: "Pitch1 {{nombre}}" }, { text: "Pitch2" }] };
  const lead = { id: "L1", name: "Ana", phone: "5215550000", country: "MX", estado: "sin_contactar" };
  const account = { id: "wa1", status: "CONNECTED", minSendGapMinutes: 1, assignment: { kind: "setter", refId: "s1" } };
  const win = { hourStart: 0, hourEnd: 24, days: [0,1,2,3,4,5,6], timezone: "UTC" };
  const mercuryReplies = [];

  const makeDeps = (nowMs) => ({
    now: () => nowMs,
    getSettersData: () => ({ leads: { L1: lead }, variants: [variant] }),
    listAccounts: () => [account],
    userIdFromSetterId: (sid) => (sid === "s1" ? "user1" : null),
    isUserOnline: () => true,
    sendToUser: (uid, evt, payload) => sent.push(payload),
    markLeadReplied: async () => {},
    generateMercuryReply: async ({ message }) => { mercuryReplies.push(message); return { text: "Respuesta Mercury", handoff: false }; },
  });

  beforeEach(() => { sent.length = 0; mercuryReplies.length = 0; eng.__resetThrottleForTests(); for (const c of camp.listCampaigns()) camp.deleteCampaign(c.id); });

  it("drip → manda opener → espera (NO manda nada si no responde)", async () => {
    const [, c] = camp.createCampaign({
      name: "Flow", accountIds: ["wa1"], openers: ["Hola {{nombre}}, cómo va?"],
      variantSplit: [{ variantId: "v1", weight: 1 }],
      drip: { batchSize: 1, intervalMinutes: 5 }, window: win,
      blockDelay: { minMs: 60000, maxMs: 60000 }, useMercury: true,
    }, "");
    camp.updateCampaign(c.id, { status: "running" });
    camp.bulkInitLeadStates(c.id, [{ leadId: "L1", variantId: "v1", accountId: "wa1" }]);
    const T0 = Date.UTC(2026, 5, 11, 12, 0, 0);

    // Tick 1: drip + manda el opener → awaiting_opener_reply.
    await eng.campaignEngineTick(makeDeps(T0));
    expect(sent.length).toBe(1);
    expect(sent[0].text).toBe("Hola Ana, cómo va?");
    expect(sent[0].blockKind).toBe("opener");
    expect(camp.getLeadState(c.id, "L1").state).toBe("awaiting_opener_reply");

    // Tick 2 (mucho después): NO responde → NO se manda nada (sin bumps).
    sent.length = 0;
    await eng.campaignEngineTick(makeDeps(T0 + 100 * 3600000)); // +100h
    expect(sent.length).toBe(0);
    expect(camp.getLeadState(c.id, "L1").state).toBe("awaiting_opener_reply");

    // El lead RESPONDE el opener → pitch_sending.
    await eng.handleCampaignInbound(makeDeps(T0 + 100 * 3600000), { contactPhone: "5215550000", intent: "interesado_quiere_info", message: "hola" });
    expect(camp.getLeadState(c.id, "L1").state).toBe("pitch_sending");

    // Tick 3: manda Pitch1 → blockIdx 1.
    sent.length = 0;
    const T1 = T0 + 101 * 3600000;
    await eng.campaignEngineTick(makeDeps(T1));
    expect(sent.length).toBe(1);
    expect(sent[0].text).toBe("Pitch1 Ana");
    expect(sent[0].blockKind).toBe("pitch_block");

    // Tick 4 (+gap): manda Pitch2 → awaiting_pitch_reply.
    sent.length = 0;
    await eng.campaignEngineTick(makeDeps(T1 + 70000));
    expect(sent.length).toBe(1);
    expect(sent[0].text).toBe("Pitch2");
    expect(camp.getLeadState(c.id, "L1").state).toBe("awaiting_pitch_reply");

    // El lead RESPONDE el pitch → Mercury entra y responde.
    sent.length = 0;
    await eng.handleCampaignInbound(makeDeps(T1 + 80000), { contactPhone: "5215550000", intent: "interesado_quiere_info", message: "me interesa" });
    expect(camp.getLeadState(c.id, "L1").state).toBe("mercury_active");
    expect(mercuryReplies).toContain("me interesa");
    expect(sent.some((p) => p.text === "Respuesta Mercury")).toBe(true);
  });

  it("descalificado en el opener → disqualified, no manda pitch", async () => {
    const [, c] = camp.createCampaign({
      name: "Disq", accountIds: ["wa1"], openers: ["Hola"], variantSplit: [{ variantId: "v1", weight: 1 }],
      window: win, useMercury: true,
    }, "");
    camp.updateCampaign(c.id, { status: "running" });
    camp.bulkInitLeadStates(c.id, [{ leadId: "L1", variantId: "v1", accountId: "wa1" }]);
    camp.setLeadState(c.id, "L1", { state: "awaiting_opener_reply" });
    const r = await eng.handleCampaignInbound(makeDeps(Date.now()), { contactPhone: "5215550000", intent: "descalificado", message: "no me interesa" });
    expect(r.state).toBe("disqualified");
    expect(camp.getLeadState(c.id, "L1").state).toBe("disqualified");
  });

  it("Mercury con handoff → replied_for_setter", async () => {
    const [, c] = camp.createCampaign({
      name: "Handoff", accountIds: ["wa1"], openers: ["Hola"], variantSplit: [{ variantId: "v1", weight: 1 }],
      window: win, useMercury: true,
    }, "");
    camp.updateCampaign(c.id, { status: "running" });
    camp.bulkInitLeadStates(c.id, [{ leadId: "L1", variantId: "v1", accountId: "wa1" }]);
    camp.setLeadState(c.id, "L1", { state: "awaiting_pitch_reply" });
    const deps = { ...makeDeps(Date.now()), generateMercuryReply: async () => ({ text: "Te paso con un asesor", handoff: true }) };
    await eng.handleCampaignInbound(deps, { contactPhone: "5215550000", intent: "interesado_quiere_agendar", message: "quiero agendar" });
    expect(camp.getLeadState(c.id, "L1").state).toBe("replied_for_setter");
  });

  it("fuera de ventana → no manda opener", async () => {
    const [, c] = camp.createCampaign({
      name: "Win", accountIds: ["wa1"], openers: ["Hola"], variantSplit: [{ variantId: "v1", weight: 1 }],
      window: { hourStart: 0, hourEnd: 6, days: [0,1,2,3,4,5,6], timezone: "UTC" },
    }, "");
    camp.updateCampaign(c.id, { status: "running" });
    camp.bulkInitLeadStates(c.id, [{ leadId: "L1", variantId: "v1", accountId: "wa1" }]);
    await eng.campaignEngineTick(makeDeps(Date.UTC(2026, 5, 11, 12, 0, 0)));
    expect(sent.length).toBe(0);
    expect(camp.getLeadState(c.id, "L1").state).toBe("queued");
  });

  it("teléfono que no matchea → null", async () => {
    const r = await eng.handleCampaignInbound(makeDeps(Date.now()), { contactPhone: "0000", intent: "saludo" });
    expect(r).toBe(null);
  });
});

describe("anti-ráfaga + routing", () => {
  const sent = [];
  const variant = { id: "v1", blocks: [{ text: "Pitch" }] };
  const leads = { A: { id: "A", phone: "5215550001", name: "A" }, B: { id: "B", phone: "5215550002", name: "B" }, C: { id: "C", phone: "5215550003", name: "C" } };
  const win = { hourStart: 0, hourEnd: 24, days: [0,1,2,3,4,5,6], timezone: "UTC" };
  beforeEach(() => { sent.length = 0; eng.__resetThrottleForTests(); for (const c of camp.listCampaigns()) camp.deleteCampaign(c.id); });

  it("3 openers acumulados → solo 1 sale por tick (gap)", async () => {
    const [, c] = camp.createCampaign({
      name: "Backlog", accountIds: ["wa1"], openers: ["Hola {{nombre}}"], variantSplit: [{ variantId: "v1", weight: 1 }],
      drip: { batchSize: 3, intervalMinutes: 1 }, window: win,
    }, "setter_a");
    camp.updateCampaign(c.id, { status: "running" });
    camp.bulkInitLeadStates(c.id, Object.keys(leads).map((id) => ({ leadId: id, variantId: "v1", accountId: "wa1" })));
    const past = new Date(Date.now() - 60000).toISOString();
    for (const id of Object.keys(leads)) camp.setLeadState(c.id, id, { state: "opener_sending", nextActionAt: past });
    const deps = {
      now: () => Date.now(),
      getSettersData: () => ({ leads, variants: [variant] }),
      listAccounts: () => [{ id: "wa1", status: "CONNECTED" }], // sin warming → gap 8min
      userIdFromSetterId: () => "user1", isUserOnline: () => true,
      sendToUser: (uid, evt, payload) => sent.push(payload.leadId),
    };
    await eng.campaignEngineTick(deps);
    expect(sent.length).toBe(1); // gap impide ráfaga
  });

  it("campaña setterId='' rutea al dueño de la cuenta", async () => {
    const [, c] = camp.createCampaign({
      name: "Route", accountIds: ["wa1"], openers: ["Hola"], variantSplit: [{ variantId: "v1", weight: 1 }],
      drip: { batchSize: 1, intervalMinutes: 1 }, window: win,
    }, "");
    camp.updateCampaign(c.id, { status: "running" });
    camp.bulkInitLeadStates(c.id, [{ leadId: "A", variantId: "v1", accountId: "wa1" }]);
    const deps = {
      now: () => Date.now(),
      getSettersData: () => ({ leads, variants: [variant] }),
      listAccounts: () => [{ id: "wa1", status: "CONNECTED", minSendGapMinutes: 1, assignment: { kind: "setter", refId: "dueño" } }],
      userIdFromSetterId: (sid) => (sid === "dueño" ? "user_dueño" : null),
      isUserOnline: () => true,
      sendToUser: (uid, evt, payload) => sent.push({ uid }),
    };
    await eng.campaignEngineTick(deps);
    expect(sent.length).toBe(1);
    expect(sent[0].uid).toBe("user_dueño");
  });

  it("dueño offline → fallback admin online", async () => {
    const [, c] = camp.createCampaign({
      name: "Route2", accountIds: ["wa1"], openers: ["Hola"], variantSplit: [{ variantId: "v1", weight: 1 }],
      drip: { batchSize: 1, intervalMinutes: 1 }, window: win,
    }, "");
    camp.updateCampaign(c.id, { status: "running" });
    camp.bulkInitLeadStates(c.id, [{ leadId: "A", variantId: "v1", accountId: "wa1" }]);
    const deps = {
      now: () => Date.now(),
      getSettersData: () => ({ leads, variants: [variant] }),
      listAccounts: () => [{ id: "wa1", status: "CONNECTED", minSendGapMinutes: 1, assignment: { kind: "setter", refId: "off" } }],
      userIdFromSetterId: (sid) => (sid === "off" ? "user_off" : null),
      isUserOnline: (uid) => uid === "user_admin",
      getPresenceList: () => [{ userId: "user_admin", online: true, role: "admin" }],
      sendToUser: (uid, evt, payload) => sent.push({ uid }),
    };
    await eng.campaignEngineTick(deps);
    expect(sent.length).toBe(1);
    expect(sent[0].uid).toBe("user_admin");
  });
});

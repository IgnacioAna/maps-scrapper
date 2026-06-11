// Phase 7 — Tests del motor/tick de campañas (Wave 3).
// Helpers puros + un tick end-to-end con `now` inyectado (sin timers reales)
// y un sendToUser fake que captura los envíos.
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

describe("isWithinWindow", () => {
  // 2026-06-10 es miércoles (day 3). 18:00 UTC.
  const utcNoon = new Date("2026-06-10T18:00:00Z");
  it("dentro de 10-19h America/Mexico_City (12:00 local) miércoles → true", () => {
    expect(eng.isWithinWindow({ hourStart: 10, hourEnd: 19, days: [1,2,3,4,5], timezone: "America/Mexico_City" }, utcNoon)).toBe(true);
  });
  it("mismo horario pero día no permitido (solo domingo) → false", () => {
    expect(eng.isWithinWindow({ hourStart: 10, hourEnd: 19, days: [0], timezone: "America/Mexico_City" }, utcNoon)).toBe(false);
  });
  it("fuera de hora (ventana 0-6h) → false", () => {
    expect(eng.isWithinWindow({ hourStart: 0, hourEnd: 6, days: [1,2,3,4,5], timezone: "America/Mexico_City" }, utcNoon)).toBe(false);
  });
});

describe("warmingCapByDay", () => {
  const mk = (daysAgo) => ({ routineStartedAt: new Date(Date.now() - daysAgo * 86400000).toISOString() });
  it("día 1 → 12", () => expect(eng.warmingCapByDay(mk(0))).toBe(12));
  it("día 4 → 30", () => expect(eng.warmingCapByDay(mk(3))).toBe(30));
  it("día 8 → 80", () => expect(eng.warmingCapByDay(mk(7))).toBe(80));
  it("día 20 → 400", () => expect(eng.warmingCapByDay(mk(19))).toBe(400));
  it("sin warming → 80", () => expect(eng.warmingCapByDay({})).toBe(80));
});

describe("variantBlockTexts", () => {
  it("interpola {{nombre}} y filtra vacíos", () => {
    const v = { blocks: [{ text: "Hola {{nombre}}" }, { text: "" }, { text: "Sos de la clínica?" }] };
    expect(eng.variantBlockTexts(v, { name: "Dr. Pérez" })).toEqual(["Hola Dr. Pérez", "Sos de la clínica?"]);
  });
});

describe("tick end-to-end (now inyectado)", () => {
  let campId;
  const sent = [];
  const variant = { id: "v1", blocks: [{ text: "Bloque1 {{nombre}}" }, { text: "Bloque2" }] };
  const lead = { id: "L1", name: "Ana", phone: "5215550000", country: "MX", estado: "sin_contactar" };
  const account = { id: "wa1", status: "CONNECTED" };
  // ventana 24h todos los días para no bloquear por horario
  const win = { hourStart: 0, hourEnd: 24, days: [0,1,2,3,4,5,6], timezone: "UTC" };

  const makeDeps = (nowMs) => ({
    now: () => nowMs,
    getSettersData: () => ({ leads: { L1: lead }, variants: [variant] }),
    listAccounts: () => [account],
    userIdFromSetterId: () => "user1",
    sendToUser: (uid, evt, payload) => sent.push({ uid, evt, payload }),
  });

  beforeEach(() => { sent.length = 0; });

  it("flujo completo: drip → 2 bloques con delay → bump → no_reply", async () => {
    const [, c] = camp.createCampaign({
      name: "E2E", accountIds: ["wa1"], variantSplit: [{ variantId: "v1", weight: 1 }],
      drip: { batchSize: 1, intervalMinutes: 5 },
      window: win, blockDelay: { minMs: 3000, maxMs: 3000 },
      bumps: [{ afterHours: 24, text: "Bump {{nombre}}" }],
    }, "setter_a");
    campId = c.id;
    camp.updateCampaign(campId, { status: "running" });
    camp.bulkInitLeadStates(campId, [{ leadId: "L1", variantId: "v1", accountId: "wa1" }]);

    const T0 = Date.UTC(2026, 5, 10, 12, 0, 0);

    // Tick 1: drip libera el lead → opener_sending, manda bloque 1.
    sent.length = 0;
    await eng.campaignEngineTick(makeDeps(T0));
    expect(sent.length).toBe(1);
    expect(sent[0].payload.text).toBe("Bloque1 Ana");
    let ls = camp.getLeadState(campId, "L1");
    expect(ls.state).toBe("opener_sending");
    expect(ls.blockIdx).toBe(1);

    // Tick 2: nextActionAt aún no venció (delay 3s) → no manda nada.
    sent.length = 0;
    await eng.campaignEngineTick(makeDeps(T0 + 1000));
    expect(sent.length).toBe(0);

    // Tick 3: pasaron los 3s → manda bloque 2 → opener completo → awaiting_reply.
    sent.length = 0;
    await eng.campaignEngineTick(makeDeps(T0 + 4000));
    expect(sent.length).toBe(1);
    expect(sent[0].payload.text).toBe("Bloque2");
    ls = camp.getLeadState(campId, "L1");
    expect(ls.state).toBe("awaiting_reply");

    // Tick 4: antes de las 24h del bump → nada.
    sent.length = 0;
    await eng.campaignEngineTick(makeDeps(T0 + 4000 + 3600000)); // +1h
    expect(sent.length).toBe(0);

    // Tick 5: pasadas 24h → manda el bump → no quedan bumps → no_reply.
    sent.length = 0;
    await eng.campaignEngineTick(makeDeps(T0 + 4000 + 25 * 3600000));
    expect(sent.length).toBe(1);
    expect(sent[0].payload.text).toBe("Bump Ana");
    ls = camp.getLeadState(campId, "L1");
    expect(ls.state).toBe("no_reply");
  });

  it("fuera de ventana horaria → no envía", async () => {
    const [, c] = camp.createCampaign({
      name: "Win", accountIds: ["wa1"], variantSplit: [{ variantId: "v1", weight: 1 }],
      drip: { batchSize: 1, intervalMinutes: 5 },
      window: { hourStart: 0, hourEnd: 6, days: [0,1,2,3,4,5,6], timezone: "UTC" }, // madrugada
      blockDelay: { minMs: 3000, maxMs: 3000 }, bumps: [],
    }, "setter_a");
    camp.updateCampaign(c.id, { status: "running" });
    camp.bulkInitLeadStates(c.id, [{ leadId: "L1", variantId: "v1", accountId: "wa1" }]);
    const noon = Date.UTC(2026, 5, 10, 12, 0, 0); // 12:00 UTC fuera de 0-6h
    await eng.campaignEngineTick(makeDeps(noon));
    expect(sent.length).toBe(0);
    expect(camp.getLeadState(c.id, "L1").state).toBe("queued"); // sigue en cola
  });

  it("cuenta no CONNECTED → no envía (requeue)", async () => {
    const [, c] = camp.createCampaign({
      name: "Off", accountIds: ["wa1"], variantSplit: [{ variantId: "v1", weight: 1 }],
      drip: { batchSize: 1, intervalMinutes: 5 }, window: win,
      blockDelay: { minMs: 3000, maxMs: 3000 }, bumps: [],
    }, "setter_a");
    camp.updateCampaign(c.id, { status: "running" });
    camp.bulkInitLeadStates(c.id, [{ leadId: "L1", variantId: "v1", accountId: "wa1" }]);
    const deps = {
      now: () => Date.UTC(2026, 5, 10, 12, 0, 0),
      getSettersData: () => ({ leads: { L1: lead }, variants: [variant] }),
      listAccounts: () => [{ id: "wa1", status: "BANNED" }], // no conectada
      userIdFromSetterId: () => "user1",
      sendToUser: (uid, evt, payload) => sent.push({ uid, evt, payload }),
    };
    await eng.campaignEngineTick(deps);
    expect(sent.length).toBe(0); // dripeó pero no mandó por cuenta no lista
  });
});

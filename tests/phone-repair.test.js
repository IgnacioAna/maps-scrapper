// Reparación de teléfonos colombianos rotos (2026-07-28).
//
// Origen: Teresa reportó llamadas de 2-3 segundos. El análisis de producción
// mostró 131 leads de Colombia con 10 dígitos en vez de 12, y de los 61 que se
// llegaron a discar fallaron TODOS (30 invalid_number + 31 no_answer).
//
// Dos patrones distintos, los dos del scraping:
//   57 + área(1) + 7 díg  → fijo con la numeración VIEJA (Colombia migró a 60A
//                           en 2022). "5723125248" no marca a ningún lado.
//   3XXXXXXXXX            → celular sin el +57. Tal cual, "+3186944802" sale
//                           hacia Holanda (+31).
//
// La regla NO inventa números: si el patrón no matchea, devuelve null.

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `phone-repair-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-pr@local.test";
process.env.ADMIN_PASSWORD = "prpass1234";
process.env.JWT_SECRET = "test-secret-pr";
process.env.OPENAI_API_KEY = "";   // regla #121: definida-VACÍA, jamás delete
process.env.MERCURY_API_KEY = "";
process.env.QWEN_API_KEY = "";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}
fs.writeFileSync(path.join(tmpData, "auth.json"), JSON.stringify({
  users: [
    { id: "u_admin", email: "admin-pr@local.test", name: "AdminPR", role: "admin", status: "active", setterId: "", password: pwd("prpass1234") },
    { id: "u_set", email: "set-pr@local.test", name: "Vendedora", role: "setter", status: "active", setterId: "s_1", password: pwd("setpass1234") },
  ], invites: [], sessions: [],
}, null, 2));
fs.writeFileSync(path.join(tmpData, "setters.json"), JSON.stringify({
  setters: [{ id: "s_1", name: "Vendedora" }], variants: [], leads: {}, calendar: [], sessions: [],
}, null, 2));

const { app } = await import("../index.js");
const { _repairColombianPhone: rep } = globalThis.__phoneRepair;

const lead = (id, phone, extra = {}) => ({
  [id]: {
    num: 1, name: `L-${id}`, phone, country: "Colombia", assignedTo: "s_1",
    conexion: "sin_wsp", estado: "sin_contactar", callLog: [], ...extra,
  },
});
function writeLeads(leads) {
  fs.writeFileSync(path.join(tmpData, "setters.json"), JSON.stringify({
    setters: [{ id: "s_1", name: "Vendedora" }], variants: [], leads, calendar: [], sessions: [],
  }, null, 2));
}
const read = () => JSON.parse(fs.readFileSync(path.join(tmpData, "setters.json"), "utf8"));

let adminCookie = "";
beforeAll(async () => {
  const a = await request(app).post("/api/auth/login").send({ email: "admin-pr@local.test", password: "prpass1234" });
  adminCookie = (a.headers["set-cookie"] || []).find((c) => c.startsWith("gs_session=")).split(";")[0];
});
afterAll(() => { try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {} });

describe("_repairColombianPhone — la regla, sin inventar números", () => {
  it("fijo viejo: inserta el 60 de la migración de 2022", () => {
    // Casos REALES sacados de la base de producción.
    expect(rep("+5723125248")).toBe("+576023125248");
    expect(rep("+5723827784")).toBe("+576023827784");
    expect(rep("+5725143333")).toBe("+576025143333");
    // La forma resultante es la MISMA que la de los que ya funcionan hoy
    // (+576023928902 y compañía).
    expect(rep("+5723125248")).toMatch(/^\+5760[1-8]\d{7}$/);
  });

  it("celular sin código de país: le prepone +57", () => {
    expect(rep("+3186944802")).toBe("+573186944802");
    expect(rep("3186944802")).toBe("+573186944802");
  });

  it("fijo con la numeración NUEVA sin código de país: queda en Colombia, no en EE.UU.", () => {
    // Caso real (Cali): +6023800805. Sin esta regla lo agarraba
    // _repairGenericPhone, que lee 602 como área NANP (Phoenix) y devolvía
    // +16023800805 — un número de Arizona en una clínica de Cali.
    expect(rep("+6023800805")).toBe("+576023800805");
    expect(rep("+6011234567")).toBe("+576011234567");   // Bogotá
    expect(rep("+6049876543")).toBe("+576049876543");   // Medellín
    expect(rep("+6071112223")).toBe("+576071112223");   // Bucaramanga
    // El resultado tiene la misma forma que los fijos que ya funcionan.
    expect(rep("+6023800805")).toMatch(/^\+5760[1-8]\d{7}$/);
    // 609/600 no son indicativos colombianos: no se tocan.
    expect(rep("+6091234567")).toBe(null);
    expect(rep("+6001234567")).toBe(null);
  });

  it("el fijo nuevo también se resuelve entrando por _repairLeadPhone (el que usa el endpoint)", () => {
    const { _repairLeadPhone } = globalThis.__phoneRepair;
    expect(_repairLeadPhone({ phone: "+6023800805", country: "Colombia", city: "Cali" })).toBe("+576023800805");
  });

  it("un número YA correcto no se toca", () => {
    expect(rep("+576023928902")).toBe(null);   // 12 dígitos: está bien
    expect(rep("+573222561204")).toBe(null);
  });

  it("no repara lo que no entiende", () => {
    expect(rep("5985511989395459")).toBe(null);   // 16 díg: imposible por E.164
    expect(rep("+34914268071")).toBe(null);       // España
    expect(rep("12345")).toBe(null);
    expect(rep("")).toBe(null);
    expect(rep(null)).toBe(null);
    expect(rep(undefined)).toBe(null);
    // 10 dígitos que empiezan con 57 pero con área inválida (Colombia usa 1-8).
    expect(rep("5790123456")).toBe(null);
    expect(rep("5700123456")).toBe(null);
  });
});

describe("POST /api/admin/repair-co-phones", () => {
  it("dryRun por DEFECTO: informa pero no toca la base", async () => {
    writeLeads({ ...lead("l1", "+5723125248"), ...lead("l2", "+3186944802") });
    const r = await request(app).post("/api/admin/repair-co-phones").set("Cookie", adminCookie).send({});
    expect(r.status).toBe(200);
    expect(r.body.dryRun).toBe(true);
    expect(r.body.repaired).toBe(2);
    expect(read().leads.l1.phone).toBe("+5723125248");   // intacto
    expect(r.body.sample[0]).toMatchObject({ antes: "+5723125248", despues: "+576023125248" });
  });

  it("aplicado: repara, guarda el número viejo y resetea el lookup", async () => {
    writeLeads({
      ...lead("l1", "+5723125248", {
        lookupAt: "2026-06-25T11:34:00.000Z", phoneType: "", lookupCarrier: "Claro Colombia",
      }),
      ...lead("ok", "+576023928902"),          // ya correcto → no se toca
      ...lead("raro", "5985511989395459"),     // sin regla → no se toca
    });
    const r = await request(app).post("/api/admin/repair-co-phones").set("Cookie", adminCookie).send({ dryRun: false });
    expect(r.body.repaired).toBe(1);
    expect(r.body.skipped).toBe(2);
    const d = read().leads;
    expect(d.l1.phone).toBe("+576023125248");
    expect(d.l1.phoneBroken).toBe("+5723125248");     // rollback posible
    expect(d.l1.phoneRepairedAt).toBeTruthy();
    // El número cambió: lo que sabíamos del viejo NO aplica al nuevo.
    expect(d.l1.lookupAt).toBe("");
    expect(d.l1.lookupCarrier).toBe("");
    expect(d.ok.phone).toBe("+576023928902");
    expect(d.raro.phone).toBe("5985511989395459");
  });

  it("no crea duplicados: si el reparado ya existe, lo saltea", async () => {
    writeLeads({
      ...lead("roto", "+5723125248"),
      ...lead("existente", "+576023125248"),   // el MISMO teléfono, ya bien cargado
    });
    const r = await request(app).post("/api/admin/repair-co-phones").set("Cookie", adminCookie).send({ dryRun: false });
    expect(r.body.repaired).toBe(0);
    expect(r.body.collided).toBe(1);
    expect(read().leads.roto.phone).toBe("+5723125248");
  });

  it("solo admin", async () => {
    const s = await request(app).post("/api/auth/login").send({ email: "set-pr@local.test", password: "setpass1234" });
    const c = (s.headers["set-cookie"] || []).find((x) => x.startsWith("gs_session=")).split(";")[0];
    expect((await request(app).post("/api/admin/repair-co-phones").set("Cookie", c)).status).toBe(403);
    expect((await request(app).post("/api/admin/repair-co-phones")).status).toBe(401);
  });
});

// POST /api/admin/repair-phones — el reparador de TODA la base y el rescate de
// los leads que la cadencia descartó sola por marcar un número que no existía.
describe("POST /api/admin/repair-phones", () => {
  const mx = (id, phone, extra = {}) => ({
    [id]: {
      num: 1, name: `MX-${id}`, phone, country: "México", city: "Tijuana",
      assignedTo: "s_1", conexion: "sin_wsp", estado: "sin_contactar", callLog: [], ...extra,
    },
  });
  const noAtendio = (n) => Array.from({ length: n }, () => ({ outcome: "no_answer", ts: "2026-08-01T10:00:00.000Z", by: "u_set" }));

  it("un 619 de Tijuana se repara a +1 (San Diego), no a +52", async () => {
    writeLeads({ ...mx("t1", "+6195029242"), ...mx("t2", "+6198157846") });
    const r = await request(app).post("/api/admin/repair-phones")
      .set("Cookie", adminCookie).send({ dryRun: false });
    expect(r.status).toBe(200);
    expect(r.body.repaired).toBe(2);
    const after = read().leads;
    expect(after.t1.phone).toBe("+16195029242");
    expect(after.t1.phoneBroken).toBe("+6195029242");   // rollback disponible
    expect(after.t1.lookupAt).toBe("");                  // el número cambió: lo que sabíamos no aplica
  });

  it("sin el flag NO toca los descartados y no reactiva nada", async () => {
    writeLeads({ ...mx("d1", "+6195029242", { estado: "descartado", callLog: noAtendio(2) }) });
    const r = await request(app).post("/api/admin/repair-phones")
      .set("Cookie", adminCookie).send({ dryRun: false });
    expect(r.body.repaired).toBe(0);
    expect(r.body.reactivated).toBe(0);
    expect(read().leads.d1.phone).toBe("+6195029242");
  });

  it("con reactivateDiscarded rescata al que se quemó contra el número roto", async () => {
    writeLeads({
      ...mx("d1", "+6195029242", {
        estado: "descartado", interes: "no", cadenceStep: 2, cadenceExhausted: true,
        autoDiscardReason: "sin_contacto_2x", callbackAt: "2026-08-02T10:00:00.000Z",
        callLog: noAtendio(2), notes: [{ text: "histórico" }],
      }),
    });
    const r = await request(app).post("/api/admin/repair-phones")
      .set("Cookie", adminCookie).send({ dryRun: false, reactivateDiscarded: true });
    expect(r.body.repaired).toBe(1);
    expect(r.body.reactivated).toBe(1);
    const l = read().leads.d1;
    expect(l.phone).toBe("+16195029242");
    expect(l.estado).toBe("sin_contactar");             // vuelve a la cola
    expect(l.interes).toBe(null);
    expect(l.cadenceStep).toBe(0);
    expect(l.cadenceExhausted).toBe(false);
    expect(l.autoDiscardReason).toBe("");
    expect(l.callbackAt).toBe("");                      // el reloj viejo se consume
    expect(l.conexion).toBe("sin_wsp");
    expect(l.callLog).toHaveLength(2);                  // el histórico NO se borra
    expect(l.notes).toHaveLength(1);
    expect(l.interactions.at(-1)).toMatchObject({ action: "reactivated", reason: "phone_repaired" });
  });

  it("respeta el descarte cuando alguien SÍ atendió, y el descarte hecho a mano", async () => {
    writeLeads({
      // Atendieron y dijeron que no: el número llegaba a destino.
      ...mx("hablo", "+6195029242", {
        estado: "descartado",
        callLog: [...noAtendio(1), { outcome: "answered_not_interested", ts: "2026-08-01T11:00:00.000Z" }],
      }),
      // Descartado a mano, sin una sola llamada.
      ...mx("mano", "+6198157846", { estado: "descartado", callLog: [] }),
    });
    const r = await request(app).post("/api/admin/repair-phones")
      .set("Cookie", adminCookie).send({ dryRun: false, reactivateDiscarded: true });
    expect(r.body.reactivated).toBe(0);
    const after = read().leads;
    expect(after.hablo.estado).toBe("descartado");
    expect(after.mano.estado).toBe("descartado");
  });

  it("dryRun cuenta el rescate pero no escribe", async () => {
    writeLeads({ ...mx("d1", "+6195029242", { estado: "descartado", callLog: noAtendio(2) }) });
    const r = await request(app).post("/api/admin/repair-phones")
      .set("Cookie", adminCookie).send({ dryRun: true, reactivateDiscarded: true });
    expect(r.body.repaired).toBe(1);
    expect(r.body.reactivated).toBe(1);
    const l = read().leads.d1;
    expect(l.phone).toBe("+6195029242");
    expect(l.estado).toBe("descartado");
  });

  it("es idempotente: correrlo dos veces no vuelve a tocar nada", async () => {
    writeLeads({ ...mx("d1", "+6195029242", { estado: "descartado", callLog: noAtendio(2) }) });
    const body = { dryRun: false, reactivateDiscarded: true };
    await request(app).post("/api/admin/repair-phones").set("Cookie", adminCookie).send(body);
    const r2 = await request(app).post("/api/admin/repair-phones").set("Cookie", adminCookie).send(body);
    expect(r2.body.repaired).toBe(0);
    expect(r2.body.reactivated).toBe(0);
  });

  it("solo admin", async () => {
    const s = await request(app).post("/api/auth/login").send({ email: "set-pr@local.test", password: "setpass1234" });
    const c = (s.headers["set-cookie"] || []).find((x) => x.startsWith("gs_session=")).split(";")[0];
    expect((await request(app).post("/api/admin/repair-phones").set("Cookie", c)).status).toBe(403);
    expect((await request(app).post("/api/admin/repair-phones")).status).toBe(401);
  });
});

describe("validate-numbers acotado a los reparados (onlyRepaired)", () => {
  // El dryRun cuenta elegibles y devuelve ANTES de tocar la red: se puede
  // testear sin gastar un centavo (y sin API key real).
  beforeAll(() => {
    fs.writeFileSync(path.join(tmpData, "telnyx_config.json"), JSON.stringify({
      apiKey: "KEY_FALSA_PARA_TEST", sipUsername: "", sipPassword: "",
      sipConnectionId: "", signaturePublicKey: "", numbers: [], countryRouting: {},
    }, null, 2));
  });

  it("sin el flag cuenta TODA la base; con el flag, solo los reparados", async () => {
    writeLeads({
      // Reparado por repair-co-phones (lookup en blanco tras el cambio de número).
      ...lead("rep1", "+576023125248", { phoneRepairedAt: "2026-07-28T20:00:00.000Z", lookupAt: "" }),
      ...lead("rep2", "+573186944802", { phoneRepairedAt: "2026-07-28T20:00:00.000Z", lookupAt: "" }),
      // Nunca validados, pero NO reparados: no deben entrar cuando se acota.
      ...lead("otro1", "+576023928902"),
      ...lead("otro2", "+573222561204"),
      // Ya validado: fuera en los dos casos.
      ...lead("listo", "+573115634949", { lookupAt: "2026-07-01T00:00:00.000Z", phoneType: "mobile" }),
    });
    const todos = await request(app).post("/api/admin/validate-numbers")
      .set("Cookie", adminCookie).send({ dryRun: true });
    expect(todos.body.pending).toBe(4);          // los 2 reparados + los 2 sin validar

    const soloRep = await request(app).post("/api/admin/validate-numbers")
      .set("Cookie", adminCookie).send({ dryRun: true, onlyRepaired: true });
    expect(soloRep.body.pending).toBe(2);        // exactamente los reparados
  });

  it("un reparado que YA se validó después no se re-cobra", async () => {
    writeLeads({
      ...lead("rep1", "+576023125248", {
        phoneRepairedAt: "2026-07-28T20:00:00.000Z",
        lookupAt: "2026-07-28T21:00:00.000Z", phoneType: "landline",
      }),
      ...lead("rep2", "+573186944802", { phoneRepairedAt: "2026-07-28T20:00:00.000Z", lookupAt: "" }),
    });
    const r = await request(app).post("/api/admin/validate-numbers")
      .set("Cookie", adminCookie).send({ dryRun: true, onlyRepaired: true });
    expect(r.body.pending).toBe(1);
  });
});

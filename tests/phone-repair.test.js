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

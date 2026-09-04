// 2026-07-23 — el modal "Contacto secundario" también carga el email del lead.
// PUT /api/setters/leads/:id/alt-contact acepta {email}: se guarda en lead.email,
// omitido = no tocar, inválido = 400. RBAC: setter solo en sus leads.

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `altcontact-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-alt@local.test";
process.env.ADMIN_PASSWORD = "altpass1234";
process.env.JWT_SECRET = "test-secret-alt";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}
fs.writeFileSync(path.join(tmpData, "auth.json"), JSON.stringify({
  users: [
    { id: "u_admin", email: "admin-alt@local.test", name: "Admin", role: "admin", status: "active", setterId: "", password: pwd("altpass1234") },
    { id: "u_a", email: "a@local.test", name: "A", role: "setter", status: "active", setterId: "s_a", password: pwd("setterpass1") },
  ], invites: [], sessions: [],
}, null, 2));

fs.writeFileSync(path.join(tmpData, "setters.json"), JSON.stringify({
  setters: [{ id: "s_a", name: "A" }, { id: "s_b", name: "B" }],
  variants: [],
  leads: {
    l_mine: { num: 1, name: "Mío", phone: "+5215550000001", assignedTo: "s_a", conexion: "sin_wsp", estado: "sin_contactar", email: "viejo@x.com" },
    l_ajeno: { num: 2, name: "Ajeno", phone: "+5215550000002", assignedTo: "s_b", conexion: "sin_wsp", estado: "sin_contactar" },
  },
  calendar: [], sessions: [],
}, null, 2));

const { app } = await import("../index.js");
async function login(email, password) {
  const r = await request(app).post("/api/auth/login").send({ email, password });
  return (r.headers["set-cookie"] || []).find((c) => c.startsWith("gs_session=")).split(";")[0];
}
let aCookie = "";
beforeAll(async () => { aCookie = await login("a@local.test", "setterpass1"); });
afterAll(() => { try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {} });

describe("alt-contact con email", () => {
  it("guarda teléfono + email juntos", async () => {
    const r = await request(app).put("/api/setters/leads/l_mine/alt-contact").set("Cookie", aCookie)
      .send({ phone: "+5491133334444", label: "Encargada", email: "encargada@clinica.com" });
    expect(r.status).toBe(200);
    expect(r.body.altPhone).toBe("+5491133334444");
    expect(r.body.email).toBe("encargada@clinica.com");
  });
  it("email omitido en el body NO pisa el existente", async () => {
    const r = await request(app).put("/api/setters/leads/l_mine/alt-contact").set("Cookie", aCookie)
      .send({ phone: "+5491133334444", label: "Encargada" });
    expect(r.status).toBe(200);
    expect(r.body.email).toBe("encargada@clinica.com");
  });
  it("email vacío explícito lo borra", async () => {
    const r = await request(app).put("/api/setters/leads/l_mine/alt-contact").set("Cookie", aCookie)
      .send({ phone: "+5491133334444", label: "Encargada", email: "" });
    expect(r.status).toBe(200);
    expect(r.body.email).toBe("");
  });
  it("email inválido → 400 y no persiste", async () => {
    const r = await request(app).put("/api/setters/leads/l_mine/alt-contact").set("Cookie", aCookie)
      .send({ phone: "+5491133334444", email: "no-es-un-email" });
    expect(r.status).toBe(400);
    const saved = JSON.parse(fs.readFileSync(path.join(tmpData, "setters.json"), "utf8"));
    expect(saved.leads.l_mine.email || "").toBe("");
  });
  it("setter NO puede tocar un lead ajeno (403)", async () => {
    const r = await request(app).put("/api/setters/leads/l_ajeno/alt-contact").set("Cookie", aCookie)
      .send({ email: "x@y.com" });
    expect(r.status).toBe(403);
  });
});

// Milestone v5.0 (MAIL-04c): "quién atendió" editable a mano por el mismo endpoint.
describe("alt-contact con gatekeeperName", () => {
  it("guarda gatekeeperName y lo devuelve", async () => {
    const r = await request(app).put("/api/setters/leads/l_mine/alt-contact").set("Cookie", aCookie)
      .send({ gatekeeperName: "Sandra" });
    expect(r.status).toBe(200);
    expect(r.body.gatekeeperName).toBe("Sandra");
    const saved = JSON.parse(fs.readFileSync(path.join(tmpData, "setters.json"), "utf8"));
    expect(saved.leads.l_mine.gatekeeperName).toBe("Sandra");
  });
  it("gatekeeperName omitido en el body NO pisa el existente", async () => {
    const r = await request(app).put("/api/setters/leads/l_mine/alt-contact").set("Cookie", aCookie)
      .send({ email: "otro@clinica.com" });
    expect(r.status).toBe(200);
    expect(r.body.gatekeeperName).toBe("Sandra");
  });
  it("gatekeeperName vacío explícito lo borra", async () => {
    const r = await request(app).put("/api/setters/leads/l_mine/alt-contact").set("Cookie", aCookie)
      .send({ gatekeeperName: "" });
    expect(r.status).toBe(200);
    expect(r.body.gatekeeperName).toBe("");
  });
  it("default: un lead recién tocado tiene gatekeeperName '' (ensureLeadDefaults)", async () => {
    const r = await request(app).put("/api/setters/leads/l_mine/alt-contact").set("Cookie", aCookie).send({ label: "x" });
    expect(r.status).toBe(200);
    expect(typeof r.body.gatekeeperName).toBe("string");
  });
});

// Auditoría 2026-09-03 (DATA-01) — el hallazgo alto: `phone` y `label` se
// reasignaban SIEMPRE, mientras email y gatekeeperName respetaban el merge.
// Un body parcial (el que manda _saveBridgeFields al mandar el correo del
// puente o al guardar un callback) borraba lead.altPhone en disco sin aviso.
// Los tests de arriba hacen ese mismo PUT parcial y no miran altPhone: la
// suite pasaba verde con el bug adentro. Estos cierran el hueco — todos
// assertan contra el JSON en DISCO, que es donde se perdía el dato.
describe("alt-contact: merge de phone (DATA-01)", () => {
  const disco = () => JSON.parse(fs.readFileSync(path.join(tmpData, "setters.json"), "utf8")).leads.l_mine;
  const cargarTelefono = async () => {
    const r = await request(app).put("/api/setters/leads/l_mine/alt-contact").set("Cookie", aCookie)
      .send({ phone: "+5491199998888", label: "Encargado", email: "doc@clinica.com", gatekeeperName: "Sandra" });
    expect(r.status).toBe(200);
    expect(r.body.altPhone).toBe("+5491199998888");
  };

  it("guardar SOLO el email no borra el altPhone (el caso del correo del puente)", async () => {
    await cargarTelefono();
    const r = await request(app).put("/api/setters/leads/l_mine/alt-contact").set("Cookie", aCookie)
      .send({ email: "nuevo@clinica.com" });
    expect(r.status).toBe(200);
    expect(r.body.email).toBe("nuevo@clinica.com");
    expect(r.body.altPhone).toBe("+5491199998888");
    expect(r.body.altPhoneLabel).toBe("Encargado");
    expect(disco().altPhone).toBe("+5491199998888");
    expect(disco().altPhoneLabel).toBe("Encargado");
  });

  it("guardar SOLO quién atendió no borra el altPhone (el caso del modal de callback)", async () => {
    await cargarTelefono();
    const r = await request(app).put("/api/setters/leads/l_mine/alt-contact").set("Cookie", aCookie)
      .send({ gatekeeperName: "Vanesa" });
    expect(r.status).toBe(200);
    expect(r.body.gatekeeperName).toBe("Vanesa");
    expect(r.body.altPhone).toBe("+5491199998888");
    expect(disco().altPhone).toBe("+5491199998888");
  });

  it("phone: '' explícito SÍ borra teléfono y label (botón \"Borrar\" del modal)", async () => {
    await cargarTelefono();
    const r = await request(app).put("/api/setters/leads/l_mine/alt-contact").set("Cookie", aCookie)
      .send({ phone: "", label: "", email: "doc@clinica.com", gatekeeperName: "Sandra" });
    expect(r.status).toBe(200);
    expect(r.body.altPhone).toBe("");
    expect(r.body.altPhoneLabel).toBe("");
    expect(disco().altPhone).toBe("");
    // Borrar el teléfono no toca el email ni quién atendió.
    expect(disco().email).toBe("doc@clinica.com");
    expect(disco().gatekeeperName).toBe("Sandra");
  });

  it("phone nuevo pisa al viejo (reemplazo total desde el modal)", async () => {
    await cargarTelefono();
    const r = await request(app).put("/api/setters/leads/l_mine/alt-contact").set("Cookie", aCookie)
      .send({ phone: "+5491177776666", label: "Dra. Pérez", email: "doc@clinica.com", gatekeeperName: "Sandra" });
    expect(r.status).toBe(200);
    expect(r.body.altPhone).toBe("+5491177776666");
    expect(r.body.altPhoneLabel).toBe("Dra. Pérez");
    expect(disco().altPhone).toBe("+5491177776666");
  });

  it("un phone inválido sigue siendo 400 y no toca lo guardado", async () => {
    await cargarTelefono();
    const r = await request(app).put("/api/setters/leads/l_mine/alt-contact").set("Cookie", aCookie)
      .send({ phone: "123" });
    expect(r.status).toBe(400);
    expect(disco().altPhone).toBe("+5491199998888");
  });

  it("un body sin ninguno de los cuatro campos no borra nada", async () => {
    await cargarTelefono();
    const r = await request(app).put("/api/setters/leads/l_mine/alt-contact").set("Cookie", aCookie).send({});
    expect(r.status).toBe(200);
    expect(r.body.altPhone).toBe("+5491199998888");
    expect(r.body.email).toBe("doc@clinica.com");
    expect(r.body.gatekeeperName).toBe("Sandra");
    expect(disco().altPhone).toBe("+5491199998888");
  });
});

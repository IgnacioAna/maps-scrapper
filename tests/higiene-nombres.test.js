// Higiene de nombres (2026-08-16). Endpoint que porta 1:1 la lógica ya validada
// en scripts/one-shot-higiene-2026-08-16.mjs (corrida contra 6413 leads reales,
// solo local hasta ahora — producción sigue sucia). Toca SOLO: lead.name en
// MAYÚSCULAS → Title Case, emoji en lead.name, lead.doctor en MAYÚSCULAS →
// Title Case, prefijo Dr/a. + basura al final de lead.doctor, placeholders de
// lead.doctor → vaciado, y espacios dobles/bordes en ambos campos.
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `higiene-nombres-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-hig@local.test";
process.env.ADMIN_PASSWORD = "higpass1234";
process.env.ADMIN_NAME = "AdminHig";
process.env.JWT_SECRET = "test-secret-higiene-nombres-1234567890";
process.env.OPENAI_API_KEY = "";
process.env.MERCURY_API_KEY = "";
process.env.QWEN_API_KEY = "";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}

fs.writeFileSync(
  path.join(tmpData, "auth.json"),
  JSON.stringify({
    users: [
      { id: "u_admin", email: "admin-hig@local.test", name: "AdminHig", role: "admin", status: "active", setterId: "", password: pwd("higpass1234"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: "u_setter_x", email: "setterx-hig@local.test", name: "SetterX", role: "setter", status: "active", setterId: "setter_x", password: pwd("setterxpass1"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ],
    invites: [], sessions: [],
  }, null, 2)
);

function baseLead(overrides) {
  return { assignedTo: "setter_x", conexion: "sin_wsp", estado: "sin_contactar", ...overrides };
}

fs.writeFileSync(
  path.join(tmpData, "setters.json"),
  JSON.stringify({
    setters: [{ id: "setter_x", name: "SetterX" }],
    variants: [],
    leads: {
      // name TODO MAYÚSCULAS con conector -> Title Case, conector en minúscula salvo 1ra palabra.
      lead_mayus: baseLead({ num: 1, name: "CLINICA DENTAL DE LA COSTA", phone: "+5215550000001", doctor: "" }),
      // name con sigla del rubro -> se preserva en mayúsculas.
      lead_sigla: baseLead({ num: 2, name: "CLINICA IPS SALUD ORAL", phone: "+5215550000002", doctor: "" }),
      // name con token con dígitos -> se preserva intacto (no se titlecasea "360").
      lead_digitos: baseLead({ num: 3, name: "ODONTOLOGIA 360 GRADOS", phone: "+5215550000003", doctor: "" }),
      // name con emoji -> se le saca el emoji.
      lead_emoji: baseLead({ num: 4, name: "Sonrisa Feliz 😁✨", phone: "+5215550000004", doctor: "" }),
      // name ya normal -> no se toca.
      lead_normal: baseLead({ num: 5, name: "Clínica Sonrisa Feliz", phone: "+5215550000005", doctor: "" }),
      // doctor con prefijo Dr/a. -> nombre pelado.
      lead_doc_prefijo: baseLead({ num: 6, name: "Consultorio X", phone: "+5215550000006", doctor: "Dra. Valeria Fernandez" }),
      // doctor TODO MAYÚSCULAS -> Title Case.
      lead_doc_mayus: baseLead({ num: 7, name: "Consultorio Y", phone: "+5215550000007", doctor: "RICARDO PAREDES GOMEZ" }),
      // doctor placeholder basura -> vaciado.
      lead_doc_placeholder: baseLead({ num: 8, name: "Consultorio Z", phone: "+5215550000008", doctor: "No se menciona" }),
      // doctor ya limpio -> no se toca.
      lead_doc_ok: baseLead({ num: 9, name: "Consultorio W", phone: "+5215550000009", doctor: "Sofía Campanella" }),
      // name y doctor con espacios dobles/bordes -> se compactan (sin mayúsculas de por medio).
      lead_espacios: baseLead({ num: 10, name: "  Clínica  Del   Sur  ", phone: "+5215550000010", doctor: "  Juan   Perez  " }),
    },
    calendar: [], sessions: [],
  }, null, 2)
);

const { app } = await import("../index.js");
let adminCookie = "";
let setterCookie = "";

beforeAll(async () => {
  const ra = await request(app).post("/api/auth/login").send({ email: "admin-hig@local.test", password: "higpass1234" });
  expect(ra.status).toBe(200);
  adminCookie = (ra.headers["set-cookie"] || []).find((c) => c.startsWith("gs_session=")).split(";")[0];

  const rs = await request(app).post("/api/auth/login").send({ email: "setterx-hig@local.test", password: "setterxpass1" });
  expect(rs.status).toBe(200);
  setterCookie = (rs.headers["set-cookie"] || []).find((c) => c.startsWith("gs_session=")).split(";")[0];
});

afterAll(() => { try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {} });

describe("helpers puros de higiene (globalThis.__phase16)", () => {
  it("_higTitleCase: conectores en minúscula salvo la primera palabra", () => {
    const f = globalThis.__phase16._higTitleCase;
    expect(f("CLINICA DENTAL DE LA COSTA")).toBe("Clinica Dental de la Costa");
  });

  it("_higTitleCase: siglas conocidas se preservan en mayúsculas", () => {
    const f = globalThis.__phase16._higTitleCase;
    expect(f("CLINICA IPS SALUD ORAL")).toBe("Clinica IPS Salud Oral");
  });

  it("_higTitleCase: tokens con dígitos quedan intactos", () => {
    const f = globalThis.__phase16._higTitleCase;
    expect(f("ODONTOLOGIA 360 GRADOS")).toBe("Odontologia 360 Grados");
  });

  it("_higSacarEmoji: saca emoji y compacta espacios", () => {
    const f = globalThis.__phase16._higSacarEmoji;
    expect(f("Sonrisa Feliz 😁✨")).toBe("Sonrisa Feliz");
  });

  it("_higLimpiarDoctor: prefijo Dr/a. se pela", () => {
    const f = globalThis.__phase16._higLimpiarDoctor;
    expect(f("Dra. Valeria Fernandez")).toBe("Valeria Fernandez");
  });

  it("_higLimpiarDoctor: placeholders basura se vacían", () => {
    const f = globalThis.__phase16._higLimpiarDoctor;
    expect(f("No se menciona")).toBe("");
    expect(f("N/A")).toBe("");
    expect(f("-")).toBe("");
  });

  it("_higLimpiarDoctor: TODO MAYÚSCULAS -> Title Case", () => {
    const f = globalThis.__phase16._higLimpiarDoctor;
    expect(f("RICARDO PAREDES GOMEZ")).toBe("Ricardo Paredes Gomez");
  });

  it("_higLimpiarEspacios: compacta dobles y bordes", () => {
    const f = globalThis.__phase16._higLimpiarEspacios;
    expect(f("  Clínica  Del   Sur  ")).toBe("Clínica Del Sur");
  });
});

describe("POST /api/admin/higiene-nombres", () => {
  it("RBAC: setter no puede correrlo", async () => {
    const r = await request(app).post("/api/admin/higiene-nombres").set("Cookie", setterCookie).send({ dryRun: true });
    expect(r.status).toBe(403);
  });

  it("dryRun reporta conteos sin escribir", async () => {
    const r = await request(app).post("/api/admin/higiene-nombres").set("Cookie", adminCookie).send({ dryRun: true });
    expect(r.status).toBe(200);
    expect(r.body.dryRun).toBe(true);
    expect(r.body.scanned).toBe(10);
    expect(r.body.nameMayus).toBe(3); // mayus, sigla, digitos
    expect(r.body.nameEmoji).toBe(1); // emoji
    expect(r.body.nameEspacios).toBe(1); // espacios (name)
    // doctorPrefijo es el catch-all del script original (ni vaciado ni mayus):
    // cubre tanto el prefijo Dr/a. como el simple recorte de espacios del doctor.
    expect(r.body.doctorPrefijo).toBe(2); // doc_prefijo + espacios (doctor)
    expect(r.body.doctorMayus).toBe(1); // doc_mayus
    expect(r.body.doctorVaciado).toBe(1); // doc_placeholder

    // No escribió nada.
    const after = JSON.parse(fs.readFileSync(path.join(tmpData, "setters.json"), "utf8"));
    expect(after.leads.lead_mayus.name).toBe("CLINICA DENTAL DE LA COSTA");
    expect(after.leads.lead_doc_prefijo.doctor).toBe("Dra. Valeria Fernandez");
  });

  it("aplica: transforma cada caso, deja intacto lo ya limpio", async () => {
    const r = await request(app).post("/api/admin/higiene-nombres").set("Cookie", adminCookie).send({});
    expect(r.status).toBe(200);
    expect(r.body.dryRun).toBe(false);
    expect(r.body.updated).toBeGreaterThan(0);

    const after = JSON.parse(fs.readFileSync(path.join(tmpData, "setters.json"), "utf8"));
    expect(after.leads.lead_mayus.name).toBe("Clinica Dental de la Costa");
    expect(after.leads.lead_sigla.name).toBe("Clinica IPS Salud Oral");
    expect(after.leads.lead_digitos.name).toBe("Odontologia 360 Grados");
    expect(after.leads.lead_emoji.name).toBe("Sonrisa Feliz");
    expect(after.leads.lead_normal.name).toBe("Clínica Sonrisa Feliz"); // sin tocar

    expect(after.leads.lead_doc_prefijo.doctor).toBe("Valeria Fernandez");
    expect(after.leads.lead_doc_mayus.doctor).toBe("Ricardo Paredes Gomez");
    expect(after.leads.lead_doc_placeholder.doctor).toBe(""); // vaciado
    expect(after.leads.lead_doc_ok.doctor).toBe("Sofía Campanella"); // sin tocar

    expect(after.leads.lead_espacios.name).toBe("Clínica Del Sur");
    expect(after.leads.lead_espacios.doctor).toBe("Juan Perez");

    // No perdió ningún lead ni tocó otros campos.
    expect(Object.keys(after.leads).length).toBe(10);
    expect(after.leads.lead_mayus.phone).toBe("+5215550000001");
    expect(after.leads.lead_mayus.estado).toBe("sin_contactar");
  });

  it("es idempotente: correrlo de nuevo no encuentra nada más", async () => {
    const before = JSON.parse(fs.readFileSync(path.join(tmpData, "setters.json"), "utf8"));
    const r = await request(app).post("/api/admin/higiene-nombres").set("Cookie", adminCookie).send({});
    expect(r.body.updated).toBe(0);
    expect(r.body.nameMayus).toBe(0);
    expect(r.body.nameEmoji).toBe(0);
    expect(r.body.nameEspacios).toBe(0);
    expect(r.body.doctorMayus).toBe(0);
    expect(r.body.doctorPrefijo).toBe(0);
    expect(r.body.doctorVaciado).toBe(0);
    const after = JSON.parse(fs.readFileSync(path.join(tmpData, "setters.json"), "utf8"));
    expect(after).toEqual(before);
  });

  it("dryRun de nuevo tampoco encuentra nada (misma lógica que la escritura)", async () => {
    const r = await request(app).post("/api/admin/higiene-nombres").set("Cookie", adminCookie).send({ dryRun: true });
    expect(r.body.matched).toBe(0);
  });
});

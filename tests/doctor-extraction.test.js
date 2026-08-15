// Parser del nombre del titular (lead.name → lead.doctor) + backfill-doctor +
// doctorSource + botón "Buscar Instagram del Dr." (endpoint de guardado
// manual). Objetivo del feature: que el operador pueda saltear la recepción y
// llegar al doctor directamente.
//
// El parser está portado 1:1 del script de referencia medido contra la base
// real (scratchpad medir-doctor.mjs, 6413 leads): 85 nuevos, 153 recuperados,
// usables 1704 → 1942, por patrón {dr:176, pre:60, by:2} — ver verificación
// en index.js (globalThis.__phase16._scanDoctorBackfill) antes de este test.

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `doctor-extraction-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-doc@local.test";
process.env.ADMIN_PASSWORD = "docpass1234";
process.env.ADMIN_NAME = "AdminDoc";
process.env.JWT_SECRET = "test-secret-doctor-extraction-1234567890";
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
      { id: "u_admin", email: "admin-doc@local.test", name: "AdminDoc", role: "admin", status: "active", setterId: "", password: pwd("docpass1234"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: "u_setter_x", email: "setterx-doc@local.test", name: "SetterX", role: "setter", status: "active", setterId: "setter_x", password: pwd("setterxpass1"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ],
    invites: [], sessions: [],
  }, null, 2)
);

fs.writeFileSync(
  path.join(tmpData, "setters.json"),
  JSON.stringify({
    setters: [{ id: "setter_x", name: "SetterX" }],
    variants: [],
    leads: {
      // doctor YA válido → no se toca ni se re-marca la fuente.
      lead_ya_valido: { num: 1, name: "Clínica Sonrisa Feliz", phone: "+5215550000001", assignedTo: "setter_x", conexion: "sin_wsp", estado: "sin_contactar", doctor: "Sofía Campanella" },
      // doctor = basura de una sola palabra (inválido) + name con patrón 'dr' → recuperado.
      lead_basura: { num: 2, name: "Clínica Dra. Valeria Fernandez", phone: "+5215550000002", assignedTo: "setter_x", conexion: "sin_wsp", estado: "sin_contactar", doctor: "Dermonova" },
      // sin doctor + name con patrón 'pre' (débil) → nuevo.
      lead_pre: { num: 3, name: "Claudia Bustos Odontología Estética", phone: "+5215550000003", assignedTo: "setter_x", conexion: "sin_wsp", estado: "sin_contactar", doctor: "" },
      // sin doctor + name con patrón 'by' → nuevo, fuente fuerte.
      lead_by: { num: 4, name: "Dental Studio by Viviana Navarro", phone: "+5215550000004", assignedTo: "setter_x", conexion: "sin_wsp", estado: "sin_contactar", doctor: "" },
      // sin nada extraíble → sin tocar.
      lead_sin_nada: { num: 5, name: "Clínica Central", phone: "+5215550000005", assignedTo: "setter_x", conexion: "sin_wsp", estado: "sin_contactar", doctor: "" },
      // doctor="No se menciona" (basura textual, no vacío) + nombre extraíble → recuperado.
      lead_no_se_menciona: { num: 6, name: "Odontólogo Ricardo Paredes", phone: "+5215550000006", assignedTo: "setter_x", conexion: "sin_wsp", estado: "sin_contactar", doctor: "No se menciona" },
      // lead de otro setter, para el 403 del endpoint de instagram.
      lead_ajeno: { num: 7, name: "Ajeno", phone: "+5215550000007", assignedTo: "setter_y", conexion: "sin_wsp", estado: "sin_contactar", doctor: "Pedro Alvarez" },
    },
    calendar: [], sessions: [],
  }, null, 2)
);

const { app } = await import("../index.js");
let adminCookie = "";
let setterCookie = "";

beforeAll(async () => {
  const ra = await request(app).post("/api/auth/login").send({ email: "admin-doc@local.test", password: "docpass1234" });
  expect(ra.status).toBe(200);
  adminCookie = (ra.headers["set-cookie"] || []).find((c) => c.startsWith("gs_session=")).split(";")[0];

  const rs = await request(app).post("/api/auth/login").send({ email: "setterx-doc@local.test", password: "setterxpass1" });
  expect(rs.status).toBe(200);
  setterCookie = (rs.headers["set-cookie"] || []).find((c) => c.startsWith("gs_session=")).split(";")[0];
});

afterAll(() => { try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {} });

describe("_extractDoctorFromName — pure, portado del script medido", () => {
  const extraer = () => globalThis.__phase16._extractDoctorFromName;

  it("los 4 casos del user (autotest del script de referencia)", () => {
    const casos = [
      ["Clínica Dra. Sofía Campanella", "Sofía Campanella", "dr"],
      ["Carlos Acevedo Odontología", "Carlos Acevedo", "pre"],
      ["CLINICA ODONTOLOGICA - ORAL LINE By Luis Fernando Londoño", "Luis Fernando Londoño", "by"],
      ["Consultorio Odontológico Dra. Agustina Alvarez", "Agustina Alvarez", "dr"],
    ];
    for (const [entrada, esperado, patron] of casos) {
      const r = extraer()(entrada);
      expect(r, `caso: ${entrada}`).toBeTruthy();
      expect(r.nombre).toBe(esperado);
      expect(r.patron).toBe(patron);
    }
  });

  it("nombre glotón se frena antes del rubro (freno STOP)", () => {
    const r = extraer()("Dr Nelson Serrano Odontologia Premium");
    expect(r).toBeTruthy();
    expect(r.nombre).toBe("Nelson Serrano");
    expect(r.patron).toBe("dr");
  });

  it("sin nombre extraíble devuelve null", () => {
    expect(extraer()("Clínica Central")).toBeNull();
    expect(extraer()("")).toBeNull();
    expect(extraer()(null)).toBeNull();
    expect(extraer()(undefined)).toBeNull();
  });

  it("una sola palabra capitalizada no es un nombre válido (mínimo 2)", () => {
    expect(extraer()("Dra. Solamente")).toBeNull();
  });

  it("nombre con palabra genérica del rubro se rechaza (esValido)", () => {
    // "Estudio Dental" no es persona — ambas palabras genéricas.
    expect(extraer()("Dr. Estudio Dental")).toBeNull();
  });

  it("'post' (rubro primero, nombre después) NO está implementado — no debe matchear basura de ciudad/barrio", () => {
    // Si alguien reintrodujera 'post' sin medir, este caso empezaría a
    // devolver "Pedro Montt" como si fuera un doctor (es una calle chilena).
    const r = extraer()("Clínica Dental Pedro Montt");
    // No hay patrón 'post': o no matchea nada, o matchea 'pre' con otra cosa —
    // en cualquier caso NUNCA debe reportar patron:'post'.
    expect(r?.patron).not.toBe("post");
  });
});

describe("_sanitizeDoctorSource — whitelist estricta", () => {
  it("acepta los 5 valores documentados y rechaza el resto", () => {
    const f = globalThis.__phase16._sanitizeDoctorSource;
    expect(f("parser")).toBe("parser");
    expect(f("parser-debil")).toBe("parser-debil");
    expect(f("web-ai")).toBe("web-ai");
    expect(f("npi")).toBe("npi");
    expect(f("manual")).toBe("manual");
    expect(f("otra-cosa")).toBe("");
    expect(f(undefined)).toBe("");
    expect(f("")).toBe("");
  });
});

describe("POST /api/admin/backfill-doctor", () => {
  it("RBAC: setter no puede correrlo", async () => {
    const r = await request(app).post("/api/admin/backfill-doctor").set("Cookie", setterCookie).send({ dryRun: true });
    expect(r.status).toBe(403);
  });

  it("dryRun reporta nuevos/recuperados/sinNada sin escribir, y no toca el ya-válido", async () => {
    const r = await request(app).post("/api/admin/backfill-doctor").set("Cookie", adminCookie).send({ dryRun: true });
    expect(r.status).toBe(200);
    expect(r.body.dryRun).toBe(true);
    expect(r.body.scanned).toBe(7);
    expect(r.body.yaUsable).toBe(2); // lead_ya_valido + lead_ajeno (su doctor ya es válido)
    expect(r.body.nuevos).toBe(2);   // lead_pre + lead_by
    expect(r.body.recuperados).toBe(2); // lead_basura + lead_no_se_menciona
    expect(r.body.sinNada).toBe(1);  // lead_sin_nada (name "Clínica Central", nada extraíble)
    expect(r.body.byPatron).toEqual({ dr: 2, pre: 1, by: 1 });

    // No escribió nada.
    const after = JSON.parse(fs.readFileSync(path.join(tmpData, "setters.json"), "utf8"));
    expect(after.leads.lead_basura.doctor).toBe("Dermonova");
    expect(after.leads.lead_pre.doctor).toBe("");
  });

  it("aplica: reemplaza basura, escribe nuevos, deja intacto lo válido", async () => {
    const r = await request(app).post("/api/admin/backfill-doctor").set("Cookie", adminCookie).send({});
    expect(r.status).toBe(200);
    expect(r.body.dryRun).toBe(false);
    expect(r.body.updated).toBe(4);

    const after = JSON.parse(fs.readFileSync(path.join(tmpData, "setters.json"), "utf8"));
    // Ya válido: sin tocar, sin fuente asignada por el backfill.
    expect(after.leads.lead_ya_valido.doctor).toBe("Sofía Campanella");
    expect(after.leads.lead_ya_valido.doctorSource || "").not.toBe("parser");

    // Recuperado por patrón fuerte 'dr' → doctorSource='parser'.
    expect(after.leads.lead_basura.doctor).toBe("Valeria Fernandez");
    expect(after.leads.lead_basura.doctorSource).toBe("parser");
    expect(after.leads.lead_no_se_menciona.doctor).toBe("Ricardo Paredes");
    expect(after.leads.lead_no_se_menciona.doctorSource).toBe("parser");

    // Nuevo por patrón débil 'pre' → doctorSource='parser-debil'.
    expect(after.leads.lead_pre.doctor).toBe("Claudia Bustos");
    expect(after.leads.lead_pre.doctorSource).toBe("parser-debil");

    // Nuevo por patrón fuerte 'by' → doctorSource='parser'.
    expect(after.leads.lead_by.doctor).toBe("Viviana Navarro");
    expect(after.leads.lead_by.doctorSource).toBe("parser");

    // Sin nada extraíble: sin tocar.
    expect(after.leads.lead_sin_nada.doctor).toBe("");
  });

  it("es idempotente: correrlo de nuevo no encuentra nada más", async () => {
    const r = await request(app).post("/api/admin/backfill-doctor").set("Cookie", adminCookie).send({});
    expect(r.body.updated).toBe(0);
    expect(r.body.nuevos).toBe(0);
    expect(r.body.recuperados).toBe(0);
    // Ahora los 6 con nombre extraíble + el ya-válido son "usables".
    expect(r.body.yaUsable).toBe(6);
  });
});

describe("PATCH /api/setters/leads/:id — doctorSource='manual' al editar a mano", () => {
  it("editar doctor desde el panel marca la fuente como manual", async () => {
    const r = await request(app)
      .patch("/api/setters/leads/lead_sin_nada")
      .set("Cookie", adminCookie)
      .send({ doctor: "Nombre Cargado A Mano" });
    expect(r.status).toBe(200);
    expect(r.body.lead.doctor).toBe("Nombre Cargado A Mano");
    expect(r.body.lead.doctorSource).toBe("manual");
  });

  it("vaciar el campo doctor vacía también la fuente", async () => {
    const r = await request(app)
      .patch("/api/setters/leads/lead_sin_nada")
      .set("Cookie", adminCookie)
      .send({ doctor: "" });
    expect(r.status).toBe(200);
    expect(r.body.lead.doctor).toBe("");
    expect(r.body.lead.doctorSource).toBe("");
  });
});

describe("PUT /api/setters/leads/:id/instagram — pegar el perfil encontrado", () => {
  it("RBAC: setter no puede tocar un lead ajeno", async () => {
    const r = await request(app)
      .put("/api/setters/leads/lead_ajeno/instagram")
      .set("Cookie", setterCookie)
      .send({ instagram: "@perfil_ajeno" });
    expect(r.status).toBe(403);
  });

  it("setter guarda el instagram en SU lead → instagramSource='manual'", async () => {
    const r = await request(app)
      .put("/api/setters/leads/lead_basura/instagram")
      .set("Cookie", setterCookie)
      .send({ instagram: "@dra.valeria" });
    expect(r.status).toBe(200);
    expect(r.body.instagram).toBe("@dra.valeria");
    expect(r.body.instagramSource).toBe("manual");

    const after = JSON.parse(fs.readFileSync(path.join(tmpData, "setters.json"), "utf8"));
    expect(after.leads.lead_basura.instagram).toBe("@dra.valeria");
    expect(after.leads.lead_basura.instagramSource).toBe("manual");
  });

  it("guardar vacío borra instagram + su fuente", async () => {
    const r = await request(app)
      .put("/api/setters/leads/lead_basura/instagram")
      .set("Cookie", adminCookie)
      .send({ instagram: "" });
    expect(r.status).toBe(200);
    expect(r.body.instagram).toBe("");
    expect(r.body.instagramSource).toBe("");
  });

  it("404 en lead inexistente", async () => {
    const r = await request(app)
      .put("/api/setters/leads/no_existe/instagram")
      .set("Cookie", adminCookie)
      .send({ instagram: "@x" });
    expect(r.status).toBe(404);
  });
});

describe("enrich-leads (NPI) marca doctorSource='npi'", () => {
  it("un match de NPI persiste doctor + doctorSource='npi'", async () => {
    fs.writeFileSync(
      path.join(tmpData, "setters.json"),
      JSON.stringify({
        setters: [{ id: "setter_x", name: "SetterX" }],
        variants: [],
        leads: {
          lead_npi: { id: "lead_npi", num: 1, name: "Smile Dental Group", phone: "+13055550099", country: "Estados Unidos", assignedTo: "setter_x", conexion: "sin_wsp", estado: "sin_contactar", doctor: "" },
        },
        calendar: [], sessions: [],
      }, null, 2)
    );
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        result_count: 1,
        results: [{ number: "1234567890", basic: { first_name: "John", last_name: "Smith", credential: "DDS" }, taxonomies: [], addresses: [] }],
      }),
      json: async () => ({}),
    });
    try {
      const r = await request(app).post("/api/admin/enrich-leads").set("Cookie", adminCookie).send({ source: "npi", limit: 10 });
      expect(r.status).toBe(200);
      expect(r.body.npiMatched).toBe(1);
    } finally {
      globalThis.fetch = realFetch;
    }
    const after = JSON.parse(fs.readFileSync(path.join(tmpData, "setters.json"), "utf8"));
    expect(after.leads.lead_npi.doctor).toBe("John Smith, DDS");
    expect(after.leads.lead_npi.doctorSource).toBe("npi");
  });
});

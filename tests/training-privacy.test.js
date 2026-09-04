// Tests de privacidad de la biblioteca de Entrenamiento IA (2026-07-10):
// - Setter ve SOLO sus llamadas (por c.by → setterId, fallback lead.assignedTo).
// - Admin ve todas.
// - Detalle: setter recibe 403 al pedir una llamada ajena.
// Y del anti-marca (_stripBrandMentions vía sanitizeMercuryStyle):
// - "SCM"/"SCM Dental" se reemplazan en outputs de IA.
// - Las URLs con "scm-" no se rompen.
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `training-priv-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-tp@local.test";
process.env.ADMIN_PASSWORD = "adminpass1";
process.env.ADMIN_NAME = "AdminTP";
process.env.JWT_SECRET = "test-secret-tp";
// Sin IA: el detalle de la biblioteca genera el resumen LLM lazy si hay key —
// acá probamos privacidad, no la IA (y con key real el test se cuelga 20s).
// OJO: string vacío, NO delete — index.js corre dotenv.config() que re-carga
// el .env local, pero dotenv no pisa vars ya definidas (aunque estén vacías).
process.env.OPENAI_API_KEY = "";
process.env.MERCURY_API_KEY = "";
process.env.QWEN_API_KEY = "";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}

const now = new Date().toISOString();
const transcript = { segments: [{ speaker: "setter", text: "Hola, le hablo por la clinica", start: 0 }, { speaker: "lead", text: "Si, digame", start: 2 }], transcribedAt: now };

fs.writeFileSync(
  path.join(tmpData, "auth.json"),
  JSON.stringify({
    users: [
      { id: "user_admin_tp", email: "admin-tp@local.test", name: "AdminTP", role: "admin", status: "active", setterId: "", password: pwd("adminpass1"), createdAt: now, updatedAt: now },
      { id: "user_ana", email: "ana@local.test", name: "Ana", role: "setter", status: "active", setterId: "setter_ana", password: pwd("anapass123"), createdAt: now, updatedAt: now },
      { id: "user_beto", email: "beto@local.test", name: "Beto", role: "setter", status: "active", setterId: "setter_beto", password: pwd("betopass123"), createdAt: now, updatedAt: now },
    ],
    invites: [],
    sessions: [],
  }, null, 2)
);
fs.writeFileSync(
  path.join(tmpData, "setters.json"),
  JSON.stringify({
    setters: [
      { id: "setter_ana", name: "Ana" },
      { id: "setter_beto", name: "Beto" },
    ],
    leads: {
      lead_de_ana: {
        id: "lead_de_ana", num: 1, name: "Clinica Ana", phone: "+5215512345678", country: "México",
        assignedTo: "setter_ana", estado: "sin_contactar",
        callLog: [{ ts: now, outcome: "answered_interested", by: "user_ana", duration: 60, transcript }],
      },
      lead_de_beto: {
        id: "lead_de_beto", num: 2, name: "Clinica Beto", phone: "+5215587654321", country: "México",
        assignedTo: "setter_beto", estado: "sin_contactar",
        callLog: [{ ts: now, outcome: "callback_later", by: "user_beto", duration: 45, transcript }],
      },
      // Auditoría 2026-09-03 (EXPORT-02): para probar ?raw=1 hace falta un
      // transcript que CONTENGA los datos que la anonimización se come — con
      // el `transcript` genérico de arriba, anonimizado y crudo salen iguales
      // y el test no probaría nada.
      lead_con_datos: {
        id: "lead_con_datos", num: 3, name: "Sonrisa Perfecta", phone: "+5215599990000", country: "México",
        doctor: "Dr. Rivas", gatekeeperName: "Sandra", city: "CDMX",
        assignedTo: "setter_ana", estado: "sin_contactar",
        callLog: [{
          ts: now, outcome: "answered_interested", by: "user_ana", duration: 90,
          trainingSummary: "Resumen viejo, generado del texto anonimizado.",
          transcript: {
            segments: [
              { speaker: "setter", text: "Hablo con Sonrisa Perfecta? Mi telefono es +5215599990000", start: 0 },
              // El dominio del email NO lleva el nombre de la clínica a propósito:
              // el anonimizador reemplaza las palabras del nombre ANTES de correr
              // el regex de email, así que "contacto@sonrisa.test" quedaría como
              // "contacto@[nombre].test" y nunca llegaría a marcarse [email].
              { speaker: "lead", text: "Si, escribime a contacto@correo.test", start: 3 },
            ],
            transcribedAt: now,
          },
        }],
      },
    },
    variants: [], calendar: [], sessions: []
  }, null, 2)
);

const { app } = await import("../index.js");

async function login(email, password) {
  const r = await request(app).post("/api/auth/login").send({ email, password });
  expect(r.status).toBe(200);
  return r.headers["set-cookie"][0].split(";")[0];
}

let adminCookie = "", anaCookie = "", betoCookie = "";

beforeAll(async () => {
  adminCookie = await login("admin-tp@local.test", "adminpass1");
  anaCookie = await login("ana@local.test", "anapass123");
  betoCookie = await login("beto@local.test", "betopass123");
});

afterAll(() => {
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
});

describe("GET /api/training/calls — privacidad por setter", () => {
  it("admin ve las llamadas de todos", async () => {
    const r = await request(app).get("/api/training/calls").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    const leadIds = r.body.calls.map((c) => c.leadId).sort();
    // lead_con_datos se sumó al fixture en 2026-09-03 para EXPORT-02 y también
    // es de Ana — por eso Ana ve dos y el admin tres.
    expect(leadIds).toEqual(["lead_con_datos", "lead_de_ana", "lead_de_beto"]);
  });

  it("un setter ve SOLO sus llamadas", async () => {
    const r = await request(app).get("/api/training/calls").set("Cookie", anaCookie);
    expect(r.status).toBe(200);
    const leadIds = r.body.calls.map((c) => c.leadId).sort();
    expect(leadIds).toEqual(["lead_con_datos", "lead_de_ana"]);
    // Lo que este test protege: NO ve la de Beto.
    expect(leadIds).not.toContain("lead_de_beto");
  });

  it("el otro setter ve solo las suyas (no las de Ana)", async () => {
    const r = await request(app).get("/api/training/calls").set("Cookie", betoCookie);
    expect(r.status).toBe(200);
    expect(r.body.calls.length).toBe(1);
    expect(r.body.calls[0].leadId).toBe("lead_de_beto");
  });
});

describe("GET /api/training/calls/:leadId/:callIdx — detalle", () => {
  it("setter accede a su propia llamada", async () => {
    const r = await request(app).get("/api/training/calls/lead_de_ana/0").set("Cookie", anaCookie);
    expect(r.status).toBe(200);
    expect(r.body.segments.length).toBeGreaterThan(0);
  });

  it("setter recibe 403 al pedir la llamada de otro", async () => {
    const r = await request(app).get("/api/training/calls/lead_de_ana/0").set("Cookie", betoCookie);
    expect(r.status).toBe(403);
  });

  it("admin accede a cualquiera", async () => {
    const r = await request(app).get("/api/training/calls/lead_de_beto/0").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
  });
});

describe("anti-marca en outputs de IA (sanitizeMercuryStyle)", () => {
  it("reemplaza 'SCM Dental' y 'SCM' sueltos", () => {
    const { sanitizeMercuryStyle } = globalThis.__mercury;
    const out = sanitizeMercuryStyle("Trabajamos en SCM Dental y el equipo de SCM te contacta.");
    expect(out.text).not.toMatch(/\bSCM\b/);
    expect(out.text).toContain("la empresa");
  });

  it("no rompe URLs con scm- (lowercase con guión)", () => {
    const { sanitizeMercuryStyle } = globalThis.__mercury;
    const out = sanitizeMercuryStyle("Te paso la web: https://scm-dental.vercel.app/");
    expect(out.text).toContain("https://scm-dental.vercel.app/");
  });
});

// ── Auditoría 2026-09-03 · Fase A-bis (EXPORT-02) ────────────────────────
// El dueño necesita los nombres para cruzar una llamada con un prospecto (el
// proyecto vincca-ventas analiza estas llamadas), y la anonimización se come
// justo ese dato. ?raw=1 los devuelve, con tres candados: solo admin por rol
// REAL, opt-in puro (sin el flag no cambia nada), y sin escribir al callLog.
//
// ⚠️ La capa anonimizada de la biblioteca NO se toca: existe para que los
// vendedores nuevos no vean datos de clientes. Los tests de abajo verifican
// que el default siga anonimizando para TODOS, admin incluido.
describe("GET /api/training/calls/:leadId/:callIdx?raw=1 (EXPORT-02)", () => {
  const leerCallLog = () => JSON.parse(fs.readFileSync(path.join(tmpData, "setters.json"), "utf8")).leads.lead_con_datos.callLog[0];

  it("sin el flag, el admin sigue viendo TODO anonimizado (la biblioteca no cambió)", async () => {
    const r = await request(app).get("/api/training/calls/lead_con_datos/0").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    const texto = r.body.segments.map((s) => s.text).join(" ");
    expect(texto).not.toContain("Sonrisa Perfecta");
    expect(texto).not.toContain("+5215599990000");
    expect(texto).not.toContain("contacto@correo.test");
    expect(texto).toContain("[cliente]");
    expect(texto).toContain("[teléfono]");
    expect(texto).toContain("[email]");
    expect(r.body.raw).toBeUndefined();
  });

  it("con ?raw=1 el admin recibe los nombres, el teléfono y el email reales", async () => {
    const r = await request(app).get("/api/training/calls/lead_con_datos/0?raw=1").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.raw).toBe(true);
    const texto = r.body.segments.map((s) => s.text).join(" ");
    expect(texto).toContain("Sonrisa Perfecta");
    expect(texto).toContain("+5215599990000");
    expect(texto).toContain("contacto@correo.test");
    expect(texto).not.toContain("[cliente]");
    expect(texto).not.toContain("[teléfono]");
  });

  it("con ?raw=1 vienen los datos del lead para cruzarlo con el prospecto", async () => {
    const r = await request(app).get("/api/training/calls/lead_con_datos/0?raw=1").set("Cookie", adminCookie);
    expect(r.body.lead).toMatchObject({
      id: "lead_con_datos", name: "Sonrisa Perfecta", phone: "+5215599990000",
      doctor: "Dr. Rivas", gatekeeperName: "Sandra",
    });
  });

  it("un setter NO puede usar el flag ni sobre su propia llamada → 403", async () => {
    // lead_con_datos es de Ana: sin el flag lo ve (test de arriba), con el flag no.
    const sinFlag = await request(app).get("/api/training/calls/lead_con_datos/0").set("Cookie", anaCookie);
    expect(sinFlag.status).toBe(200);
    const conFlag = await request(app).get("/api/training/calls/lead_con_datos/0?raw=1").set("Cookie", anaCookie);
    expect(conFlag.status).toBe(403);
  });

  it("los turnos crudos son los MISMOS que los anonimizados, solo que sin tapar (misma cantidad y hablantes)", async () => {
    const anon = await request(app).get("/api/training/calls/lead_con_datos/0").set("Cookie", adminCookie);
    const raw = await request(app).get("/api/training/calls/lead_con_datos/0?raw=1").set("Cookie", adminCookie);
    expect(raw.body.segments.length).toBe(anon.body.segments.length);
    expect(raw.body.segments.map((s) => s.speaker)).toEqual(anon.body.segments.map((s) => s.speaker));
    expect(raw.body.outcome).toBe(anon.body.outcome);
    expect(raw.body.duration).toBe(anon.body.duration);
  });

  it("?raw=1 NO escribe nada en el callLog — no puede contaminar la biblioteca con un resumen sin anonimizar", async () => {
    // Se anclan al valor LITERAL del fixture, no a un before/after de esta
    // misma llamada: los tests de arriba ya pegaron con raw=1, así que si la
    // rama escribiera, "antes" ya vendría contaminado y un before/after daría
    // igual. (Verificado: con la comparación relativa, la mutación que hace
    // escribir a la rama raw pasaba el test sin despeinarse.)
    const SEMILLA = "Resumen viejo, generado del texto anonimizado.";
    const antes = leerCallLog();
    expect(antes.trainingSummary).toBe(SEMILLA);

    const r = await request(app).get("/api/training/calls/lead_con_datos/0?raw=1").set("Cookie", adminCookie);
    expect(r.status).toBe(200);

    const despues = leerCallLog();
    // El resumen cacheado se generó del texto ANONIMIZADO. Si esta rama lo
    // regenerara desde el crudo, escribiría nombres de clientes en disco y
    // todos los vendedores los verían en la biblioteca, para siempre.
    expect(despues.trainingSummary).toBe(SEMILLA);
    expect(r.body.summary).toBe(SEMILLA);
    expect(despues.trainingSummary).not.toContain("Sonrisa Perfecta");
    expect(JSON.stringify(despues)).toBe(JSON.stringify(antes));
  });

  it("un valor distinto de 1 en raw no activa nada (whitelist estricta)", async () => {
    for (const v of ["0", "true", "si", ""]) {
      const r = await request(app).get(`/api/training/calls/lead_con_datos/0?raw=${v}`).set("Cookie", adminCookie);
      expect(r.status).toBe(200);
      expect(r.body.raw).toBeUndefined();
      expect(r.body.segments.map((s) => s.text).join(" ")).toContain("[cliente]");
    }
  });
});

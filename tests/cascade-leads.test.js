// Tests de la cascada bidireccional del lead (forward + reverse).
// Forward: marcar "interesado=si" debe activar respondio=true, calificado=true,
// conexion='enviada', estado='interesado'.
// Reverse: quitar conexion (=='' o null) debe resetear todos los posteriores.
//
// Sin estos tests, refactors a la lógica de cascade en PATCH /api/setters/leads/:id
// (index.js ~4850) pueden romper el pipeline sin ser detectados.

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `cascade-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-cas@local.test";
process.env.ADMIN_PASSWORD = "caspass1234";
process.env.ADMIN_NAME = "AdminCAS";
process.env.JWT_SECRET = "test-secret-cas";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}

fs.writeFileSync(
  path.join(tmpData, "auth.json"),
  JSON.stringify({
    users: [
      { id: "user_admin_cas", email: "admin-cas@local.test", name: "AdminCAS", role: "admin", status: "active", setterId: "", password: pwd("caspass1234"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ],
    invites: [],
    sessions: [],
  }, null, 2)
);

// Pre-sembrar varios leads en estados iniciales distintos.
fs.writeFileSync(
  path.join(tmpData, "setters.json"),
  JSON.stringify({
    setters: [{ id: "setter_cas", name: "SetterCAS" }],
    variants: [],
    leads: {
      // Lead "limpio" para forward
      lead_fresh_1: { id: "lead_fresh_1", num: 1, name: "Fresh1", phone: "+1", country: "Argentina", estado: "sin_contactar" },
      lead_fresh_2: { id: "lead_fresh_2", num: 2, name: "Fresh2", phone: "+2", country: "Argentina", estado: "sin_contactar" },
      lead_fresh_3: { id: "lead_fresh_3", num: 3, name: "Fresh3", phone: "+3", country: "Argentina", estado: "sin_contactar" },
      lead_fresh_4: { id: "lead_fresh_4", num: 4, name: "Fresh4", phone: "+4", country: "Argentina", estado: "sin_contactar" },
      // Leads completos para reverse
      lead_full_1: { id: "lead_full_1", num: 5, name: "Full1", phone: "+5", country: "Argentina", conexion: "enviada", respondio: true, calificado: true, interes: "si", estado: "interesado" },
      lead_full_2: { id: "lead_full_2", num: 6, name: "Full2", phone: "+6", country: "Argentina", conexion: "enviada", respondio: true, calificado: true, interes: "si", estado: "interesado" },
      lead_full_3: { id: "lead_full_3", num: 7, name: "Full3", phone: "+7", country: "Argentina", conexion: "enviada", respondio: true, calificado: true, interes: "si", estado: "interesado" },
      lead_full_4: { id: "lead_full_4", num: 8, name: "Full4", phone: "+8", country: "Argentina", conexion: "enviada", respondio: true, calificado: true, interes: "si", estado: "interesado" },
    },
    calendar: [],
    sessions: [],
  }, null, 2)
);

const { app } = await import("../index.js");

let cookie = "";

beforeAll(async () => {
  const r = await request(app).post("/api/auth/login").send({ email: "admin-cas@local.test", password: "caspass1234" });
  expect(r.status).toBe(200);
  cookie = r.headers["set-cookie"][0].split(";")[0];
});

afterAll(() => {
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
});

describe("Cascada forward — poner un campo activa los anteriores", () => {
  it("conexion=enviada → estado=contactado y lastContactAt seteado", async () => {
    const r = await request(app).patch("/api/setters/leads/lead_fresh_1").set("Cookie", cookie).send({ conexion: "enviada" });
    expect(r.status).toBe(200);
    expect(r.body.lead.conexion).toBe("enviada");
    expect(r.body.lead.estado).toBe("contactado");
    expect(r.body.lead.lastContactAt).toBeTruthy();
    expect(r.body.lead.fechaContacto).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("respondio=true → conexion=enviada, estado=respondio", async () => {
    const r = await request(app).patch("/api/setters/leads/lead_fresh_2").set("Cookie", cookie).send({ respondio: true });
    expect(r.status).toBe(200);
    expect(r.body.lead.respondio).toBe(true);
    expect(r.body.lead.conexion).toBe("enviada");
    expect(r.body.lead.estado).toBe("respondio");
  });

  it("WR-01: pasar de no-respondió → respondió registra la speed-to-lead alert", async () => {
    // lead_fresh_1 arranca sin respondio. Al marcarlo respondió, debe aparecer en
    // recent-responses (antes wasAlreadyResponded salía true por el orden del
    // mass-assign y _registerLeadResponse nunca disparaba).
    const since = new Date(Date.now() - 1000).toISOString();
    const p = await request(app).patch("/api/setters/leads/lead_fresh_1").set("Cookie", cookie).send({ respondio: true });
    expect(p.status).toBe(200);
    const r = await request(app).get(`/api/setters/recent-responses?since=${encodeURIComponent(since)}`).set("Cookie", cookie);
    expect(r.status).toBe(200);
    expect(r.body.responses.some((x) => x.leadId === "lead_fresh_1")).toBe(true);
  });

  it("WR-01: marcar respondió en un lead que YA respondió NO re-registra", async () => {
    // lead_full_1 ya tiene respondio:true. Re-marcarlo no debe generar una alerta nueva.
    const since = new Date(Date.now() - 1000).toISOString();
    await request(app).patch("/api/setters/leads/lead_full_1").set("Cookie", cookie).send({ respondio: true });
    const r = await request(app).get(`/api/setters/recent-responses?since=${encodeURIComponent(since)}`).set("Cookie", cookie);
    expect(r.body.responses.some((x) => x.leadId === "lead_full_1")).toBe(false);
  });

  it("calificado=true → conexion=enviada, respondio=true, estado=calificado", async () => {
    const r = await request(app).patch("/api/setters/leads/lead_fresh_3").set("Cookie", cookie).send({ calificado: true });
    expect(r.status).toBe(200);
    expect(r.body.lead.calificado).toBe(true);
    expect(r.body.lead.conexion).toBe("enviada");
    expect(r.body.lead.respondio).toBe(true);
    expect(r.body.lead.estado).toBe("calificado");
  });

  it("interes=si → cascada completa: conexion+respondio+calificado=true, estado=interesado", async () => {
    const r = await request(app).patch("/api/setters/leads/lead_fresh_4").set("Cookie", cookie).send({ interes: "si" });
    expect(r.status).toBe(200);
    expect(r.body.lead.interes).toBe("si");
    expect(r.body.lead.conexion).toBe("enviada");
    expect(r.body.lead.respondio).toBe(true);
    expect(r.body.lead.calificado).toBe(true);
    expect(r.body.lead.estado).toBe("interesado");
  });
});

describe("Cascada reverse — quitar un campo resetea los siguientes", () => {
  it("conexion='' resetea TODO: respondio=false, calificado=false, interes=null, estado=sin_contactar", async () => {
    const r = await request(app).patch("/api/setters/leads/lead_full_1").set("Cookie", cookie).send({ conexion: "" });
    expect(r.status).toBe(200);
    expect(r.body.lead.conexion).toBe("");
    expect(r.body.lead.respondio).toBe(false);
    expect(r.body.lead.calificado).toBe(false);
    expect(r.body.lead.interes).toBeNull();
    expect(r.body.lead.estado).toBe("sin_contactar");
    expect(r.body.lead.fechaContacto).toBeNull();
  });

  it("respondio=false (con conexion ya enviada) resetea calificado+interes pero deja estado=contactado", async () => {
    const r = await request(app).patch("/api/setters/leads/lead_full_2").set("Cookie", cookie).send({ respondio: false });
    expect(r.status).toBe(200);
    expect(r.body.lead.respondio).toBe(false);
    expect(r.body.lead.calificado).toBe(false);
    expect(r.body.lead.interes).toBeNull();
    expect(r.body.lead.estado).toBe("contactado"); // conexion sigue siendo 'enviada'
  });

  it("calificado=false (con respondio=true) resetea interes pero deja estado=respondio", async () => {
    const r = await request(app).patch("/api/setters/leads/lead_full_3").set("Cookie", cookie).send({ calificado: false });
    expect(r.status).toBe(200);
    expect(r.body.lead.calificado).toBe(false);
    expect(r.body.lead.interes).toBeNull();
    expect(r.body.lead.estado).toBe("respondio");
  });

  it("interes=null (con calificado=true) deja estado=calificado", async () => {
    const r = await request(app).patch("/api/setters/leads/lead_full_4").set("Cookie", cookie).send({ interes: null });
    expect(r.status).toBe(200);
    expect(r.body.lead.interes).toBeNull();
    expect(r.body.lead.estado).toBe("calificado");
  });
});

describe("Cascada · sin_wsp (caso especial — mueve a Llamadas)", () => {
  it("conexion=sin_wsp → estado=sin_wsp y resetea respondio/calificado/interes", async () => {
    // Seed un lead nuevo
    const settersFile = path.join(tmpData, "setters.json");
    const sd = JSON.parse(fs.readFileSync(settersFile, "utf8"));
    sd.leads.lead_sin_wsp = { id: "lead_sin_wsp", num: 9, name: "SW", phone: "+9", country: "X", conexion: "enviada", respondio: true, calificado: true, interes: "si", estado: "interesado" };
    fs.writeFileSync(settersFile, JSON.stringify(sd, null, 2));

    const r = await request(app).patch("/api/setters/leads/lead_sin_wsp").set("Cookie", cookie).send({ conexion: "sin_wsp" });
    expect(r.status).toBe(200);
    expect(r.body.lead.conexion).toBe("sin_wsp");
    expect(r.body.lead.estado).toBe("sin_wsp");
    expect(r.body.lead.respondio).toBe(false);
    expect(r.body.lead.calificado).toBe(false);
    expect(r.body.lead.interes).toBeNull();
  });
});

describe("Cascada · calificado='no' (descalifica explícitamente)", () => {
  it("calificado='no' resetea interes pero NO toca respondio/conexion", async () => {
    const settersFile = path.join(tmpData, "setters.json");
    const sd = JSON.parse(fs.readFileSync(settersFile, "utf8"));
    sd.leads.lead_no_calif = { id: "lead_no_calif", num: 10, name: "NC", phone: "+10", country: "X", conexion: "enviada", respondio: true, calificado: true, interes: "si", estado: "interesado" };
    fs.writeFileSync(settersFile, JSON.stringify(sd, null, 2));

    const r = await request(app).patch("/api/setters/leads/lead_no_calif").set("Cookie", cookie).send({ calificado: "no" });
    expect(r.status).toBe(200);
    expect(r.body.lead.calificado).toBe("no");
    expect(r.body.lead.interes).toBeNull();
    expect(r.body.lead.respondio).toBe(true); // no se toca
    expect(r.body.lead.conexion).toBe("enviada"); // no se toca
    expect(r.body.lead.estado).toBe("respondio"); // baja a respondio porque respondio=true
  });
});

describe("Idempotencia de cascada (mismo PATCH dos veces no cambia nada)", () => {
  it("PATCH interes=si dos veces deja el lead igual", async () => {
    const settersFile = path.join(tmpData, "setters.json");
    const sd = JSON.parse(fs.readFileSync(settersFile, "utf8"));
    sd.leads.lead_idemp = { id: "lead_idemp", num: 11, name: "ID", phone: "+11", country: "X", estado: "sin_contactar" };
    fs.writeFileSync(settersFile, JSON.stringify(sd, null, 2));

    const r1 = await request(app).patch("/api/setters/leads/lead_idemp").set("Cookie", cookie).send({ interes: "si" });
    expect(r1.status).toBe(200);
    const snap1 = { ...r1.body.lead };
    // Esperamos un tick para que lastContactAt se vea distinto si la cascada se reactiva (no debería)
    await new Promise((r) => setTimeout(r, 50));
    const r2 = await request(app).patch("/api/setters/leads/lead_idemp").set("Cookie", cookie).send({ interes: "si" });
    expect(r2.status).toBe(200);
    expect(r2.body.lead.estado).toBe(snap1.estado);
    expect(r2.body.lead.calificado).toBe(snap1.calificado);
    expect(r2.body.lead.respondio).toBe(snap1.respondio);
    expect(r2.body.lead.conexion).toBe(snap1.conexion);
  });
});

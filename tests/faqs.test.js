// Tests del Banco de Respuestas: CRUD, retrieval (sort=top), check-duplicate.
// Setup paralelo a onboarding.test.js: tmp DATA_DIR + admin/setter mock + supertest.
// IMPORTANT: no testeamos /suggest ni /suggest-tags porque dependen de la API IA real.

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `faq-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-faq@local.test";
process.env.ADMIN_PASSWORD = "faqpass1234";
process.env.ADMIN_NAME = "AdminFaq";
process.env.JWT_SECRET = "test-secret-faq";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}

fs.writeFileSync(
  path.join(tmpData, "auth.json"),
  JSON.stringify({
    users: [
      { id: "user_admin_faq", email: "admin-faq@local.test", name: "AdminFaq", role: "admin", status: "active", setterId: "", password: pwd("faqpass1234"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ],
    invites: [],
    sessions: [],
  }, null, 2)
);

// Forzar banco de FAQs vacío para que seedVolumeFromRepo no traiga el seed real del repo.
fs.writeFileSync(path.join(tmpData, "faqs.json"), JSON.stringify({ entries: [] }, null, 2));

const { app } = await import("../index.js");

let cookie = "";

beforeAll(async () => {
  const r = await request(app)
    .post("/api/auth/login")
    .send({ email: "admin-faq@local.test", password: "faqpass1234" });
  expect(r.status).toBe(200);
  const setCookie = r.headers["set-cookie"]?.[0];
  expect(setCookie).toBeTruthy();
  cookie = setCookie.split(";")[0];

  // Sembrar 4 FAQs con métricas variadas para los tests de orden y duplicados
  const seed = [
    { pregunta: "¿Cuánto cuesta el servicio?", respuesta: "Depende del plan, te paso info detallada", categoria: "precio", tags: ["precio","costo"] },
    { pregunta: "Es muy caro para mí ahora", respuesta: "Entiendo, hablemos del ROI primero", categoria: "objecion", tags: ["caro","presupuesto"] },
    { pregunta: "¿Trabajan con ortodoncia?", respuesta: "Sí, tenemos clínicas de ortodoncia activas", categoria: "calificacion", tags: ["nicho","ortodoncia"] },
    { pregunta: "¿Cuándo podemos hablar?", respuesta: "Te propongo mañana a las 10", categoria: "seguimiento", tags: ["agenda"] },
  ];
  for (const e of seed) {
    const r = await request(app).post("/api/faqs").set("Cookie", cookie).send(e);
    expect(r.status).toBe(200);
  }
});

afterAll(() => {
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
});

describe("faqs · CRUD básico", () => {
  it("GET /api/faqs lista las 4 entradas sembradas", async () => {
    const r = await request(app).get("/api/faqs").set("Cookie", cookie);
    expect(r.status).toBe(200);
    expect(r.body.entries).toHaveLength(4);
  });

  it("filtro categoria=precio devuelve solo la de precio", async () => {
    const r = await request(app).get("/api/faqs?categoria=precio").set("Cookie", cookie);
    expect(r.status).toBe(200);
    expect(r.body.entries.every(e => e.categoria === "precio")).toBe(true);
  });
});

describe("faqs · sort", () => {
  it("sort=usos ordena por usos desc (default)", async () => {
    // Subir usos de la 2da entrada
    const list = await request(app).get("/api/faqs").set("Cookie", cookie);
    const idCaro = list.body.entries.find(e => e.pregunta.includes("caro")).id;
    for (let i = 0; i < 5; i++) {
      await request(app).patch(`/api/faqs/${idCaro}/uso`).set("Cookie", cookie).send({});
    }
    const r = await request(app).get("/api/faqs?sort=usos").set("Cookie", cookie);
    expect(r.body.entries[0].id).toBe(idCaro);
  });

  it("sort=top prioriza ratio funcionaron/usos (con usos>=2)", async () => {
    const list = await request(app).get("/api/faqs").set("Cookie", cookie);
    const idOrto = list.body.entries.find(e => e.pregunta.includes("ortodoncia")).id;
    // 3 usos / 3 funcionaron = 100%
    for (let i = 0; i < 3; i++) {
      await request(app).patch(`/api/faqs/${idOrto}/uso`).set("Cookie", cookie).send({ "funcionó": true });
    }
    const r = await request(app).get("/api/faqs?sort=top").set("Cookie", cookie);
    expect(r.body.entries[0].id).toBe(idOrto);
  });

  it("sort=recientes ordena por updatedAt desc", async () => {
    const r = await request(app).get("/api/faqs?sort=recientes").set("Cookie", cookie);
    expect(r.status).toBe(200);
    const dates = r.body.entries.map(e => e.updatedAt);
    const sorted = [...dates].sort().reverse();
    expect(dates).toEqual(sorted);
  });
});

describe("faqs · variantes (retrieval-friendly)", () => {
  it("POST /api/faqs acepta variantes y las guarda normalizadas", async () => {
    const r = await request(app).post("/api/faqs").set("Cookie", cookie).send({
      pregunta: "¿Quién sos?",
      respuesta: "Soy del equipo, te quería preguntar algo",
      categoria: "calificacion",
      variantes: ["¿De parte de quién?", "Y a vos quién te conoce?", "  ", "¿De parte de quién?"]
    });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.entry.variantes)).toBe(true);
    // dedup case-insensitive + filtra vacíos: dos únicas
    expect(r.body.entry.variantes.length).toBe(2);
  });

  it("PUT /api/faqs/:id puede modificar variantes (acepta string con saltos)", async () => {
    const created = await request(app).post("/api/faqs").set("Cookie", cookie).send({
      pregunta: "¿Tienen oficina?", respuesta: "Trabajamos remoto"
    });
    const r = await request(app).put("/api/faqs/" + created.body.entry.id).set("Cookie", cookie).send({
      variantes: "¿Dónde están?\n¿Tienen sede?\n"
    });
    expect(r.status).toBe(200);
    expect(r.body.entry.variantes).toEqual(["¿Dónde están?", "¿Tienen sede?"]);
  });
});

describe("faqs · import bulk", () => {
  it("POST /api/faqs/import (entries) crea las nuevas y omite duplicadas por pregunta", async () => {
    const r = await request(app).post("/api/faqs/import").set("Cookie", cookie).send({
      entries: [
        { pregunta: "¿Cuánto cuesta el servicio?", respuesta: "duplicado", categoria: "precio" },
        { pregunta: "¿Hacen demo?", respuesta: "Sí, agendamos una llamada", categoria: "general" },
        { pregunta: "  ", respuesta: "vacía" }
      ]
    });
    expect(r.status).toBe(200);
    expect(r.body.creadas).toBe(1);
    expect(r.body.omitidas).toBe(1);
    expect(r.body.errores).toBe(1);
  });

  it("POST /api/faqs/import (text) parsea bloques con prefijos P/R/C/T/V", async () => {
    const text = `P: ¿Trabajan los fines de semana?
R: De lunes a viernes únicamente
C: general
T: horarios, agenda
V: ¿Atienden sábados? | ¿Atienden domingos?

P: ¿Hacen factura?
R: Sí, A o B según corresponda`;
    const r = await request(app).post("/api/faqs/import").set("Cookie", cookie).send({ text });
    expect(r.status).toBe(200);
    expect(r.body.creadas).toBe(2);
    const list = await request(app).get("/api/faqs?q=fines de semana").set("Cookie", cookie);
    const e = list.body.entries.find(x => x.pregunta.includes("fines de semana"));
    expect(e.variantes).toEqual(["¿Atienden sábados?", "¿Atienden domingos?"]);
    expect(e.tags).toEqual(["horarios", "agenda"]);
  });

  it("POST /api/faqs/import (csv) parsea headers y separadores ;", async () => {
    const csv = `pregunta,respuesta,categoria,tags,variantes
"¿Aceptan tarjeta?","Sí, todas las tarjetas","general","pago;medios","¿Cobran con tarjeta?;¿Aceptan VISA?"`;
    const r = await request(app).post("/api/faqs/import").set("Cookie", cookie).send({ csv });
    expect(r.status).toBe(200);
    expect(r.body.creadas).toBe(1);
    const list = await request(app).get("/api/faqs?q=tarjeta").set("Cookie", cookie);
    const e = list.body.entries.find(x => x.pregunta.includes("tarjeta"));
    expect(e.tags).toEqual(["pago", "medios"]);
    expect(e.variantes).toEqual(["¿Cobran con tarjeta?", "¿Aceptan VISA?"]);
  });

  it("rechaza body vacío", async () => {
    const r = await request(app).post("/api/faqs/import").set("Cookie", cookie).send({});
    expect(r.status).toBe(400);
  });
});

describe("faqs · admin export-data incluye faqs y training", () => {
  it("GET /api/admin/export-data trae faqs.entries y training.materials", async () => {
    const r = await request(app).get("/api/admin/export-data").set("Cookie", cookie);
    expect(r.status).toBe(200);
    expect(r.body.faqs).toBeTruthy();
    expect(Array.isArray(r.body.faqs.entries)).toBe(true);
    expect(r.body.training).toBeTruthy();
    expect(Array.isArray(r.body.training.materials)).toBe(true);
  });
});

describe("faqs · check-duplicate", () => {
  it("detecta una pregunta casi idéntica como duplicado", async () => {
    const r = await request(app).post("/api/faqs/check-duplicate").set("Cookie", cookie).send({
      pregunta: "Cuánto cuesta el servicio mensual",
      respuesta: "Depende del plan que elijas",
      categoria: "precio"
    });
    expect(r.status).toBe(200);
    expect(r.body.duplicates.length).toBeGreaterThanOrEqual(1);
    expect(r.body.duplicates[0].pregunta).toMatch(/cuesta/i);
    expect(r.body.duplicates[0].score).toBeGreaterThanOrEqual(r.body.threshold);
  });

  it("no marca duplicado si el contenido es totalmente distinto", async () => {
    const r = await request(app).post("/api/faqs/check-duplicate").set("Cookie", cookie).send({
      pregunta: "Dónde están ubicados físicamente",
      respuesta: "Tenemos oficinas en Buenos Aires y Madrid"
    });
    expect(r.status).toBe(200);
    expect(r.body.duplicates).toHaveLength(0);
  });

  it("excludeId omite la propia entrada al editar", async () => {
    const list = await request(app).get("/api/faqs").set("Cookie", cookie);
    const own = list.body.entries.find(e => e.pregunta.includes("cuesta"));
    const r = await request(app).post("/api/faqs/check-duplicate").set("Cookie", cookie).send({
      pregunta: own.pregunta,
      respuesta: own.respuesta,
      excludeId: own.id
    });
    expect(r.body.duplicates.find(d => d.id === own.id)).toBeUndefined();
  });
});

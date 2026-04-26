// Tests del sistema de onboarding (índice + wrapper + inyección de quiz + presencia)
// Setup paralelo a wa.test.js: tmp DATA_DIR + ADMIN mocks + supertest.

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `onb-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-onb@local.test";
process.env.ADMIN_PASSWORD = "onbpass1234";
process.env.ADMIN_NAME = "AdminOnb";
process.env.JWT_SECRET = "test-secret-onb";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}

// Pre-popular auth.json con admin + setter para que seedVolumeFromRepo no traiga el del repo.
fs.writeFileSync(
  path.join(tmpData, "auth.json"),
  JSON.stringify({
    users: [
      { id: "user_admin_onb", email: "admin-onb@local.test", name: "AdminOnb", role: "admin", status: "active", setterId: "", password: pwd("onbpass1234"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: "user_setter_onb", email: "setter-onb@local.test", name: "SetterOnb", role: "setter", status: "active", setterId: "setter_onb", password: pwd("setterpass"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ],
    invites: [],
    sessions: [],
  }, null, 2)
);

const { app } = await import("../index.js");

let adminToken = "";
let setterToken = "";

async function loginDesktop(email, password) {
  const r = await request(app).post("/api/auth/desktop-login").send({ email, password });
  return r.body;
}

beforeAll(async () => {
  const a = await loginDesktop("admin-onb@local.test", "onbpass1234");
  expect(a.token).toBeTruthy();
  adminToken = a.token;
  const s = await loginDesktop("setter-onb@local.test", "setterpass");
  expect(s.token).toBeTruthy();
  setterToken = s.token;
});

afterAll(() => {
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
});

describe("onboarding · metadata pública", () => {
  it("GET /api/onboarding/modules devuelve los 8 módulos sin requerir auth", async () => {
    const r = await request(app).get("/api/onboarding/modules");
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(8);
    expect(Array.isArray(r.body.modules)).toBe(true);
    expect(r.body.modules).toHaveLength(8);
  });

  it("cada módulo trae num/slug/title/subtitle/minutes con tipos correctos", async () => {
    const r = await request(app).get("/api/onboarding/modules");
    const m = r.body.modules[0];
    expect(typeof m.num).toBe("number");
    expect(typeof m.slug).toBe("string");
    expect(typeof m.title).toBe("string");
    expect(typeof m.subtitle).toBe("string");
    expect(typeof m.minutes).toBe("number");
    expect(m.minutes).toBeGreaterThan(0);
  });

  it("módulos van de 1 a 8 secuencialmente", async () => {
    const r = await request(app).get("/api/onboarding/modules");
    const nums = r.body.modules.map(m => m.num);
    expect(nums).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe("onboarding · wrapper /onboarding/N", () => {
  it("GET /onboarding/3 devuelve HTML 200 con topbar y referencia al módulo", async () => {
    const r = await request(app).get("/onboarding/3");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/text\/html/);
    expect(r.text).toContain("Volver al Centro de Entrenamiento");
    // El iframe se crea dinámicamente desde el script (post-gate). El src se arma con concat.
    expect(r.text).toContain("scm-mod-iframe");
    expect(r.text).toContain("/onboarding/files/scm-onboarding-modulo");
  });

  it("wrapper inyecta el status pill que escucha postMessage del quiz", async () => {
    const r = await request(app).get("/onboarding/1");
    expect(r.text).toContain("scm-status-pill");
    expect(r.text).toContain("scm_quiz_passed"); // listener
  });

  it("wrapper trae logica de gate progresivo (locked screen para módulo > 1 sin aprobar el anterior)", async () => {
    const r = await request(app).get("/onboarding/4");
    // El gate vive en el script inline — debe referenciar el módulo anterior
    expect(r.text).toContain("locked-screen");
    expect(r.text).toContain("locked-card");
    expect(r.text).toMatch(/N\s*>\s*1\s*&&\s*!progress\[N\s*-\s*1\]/);
  });

  it("módulo 1 nunca debe estar bloqueado por gate (es el punto de entrada)", async () => {
    const r = await request(app).get("/onboarding/1");
    // El gate condiciona `N > 1` — módulo 1 siempre pasa
    expect(r.text).toContain("N > 1");
  });

  it("wrapper sin auth tiene IS_ADMIN=false (gate activo)", async () => {
    const r = await request(app).get("/onboarding/4");
    expect(r.text).toContain("var IS_ADMIN = false");
  });

  it("wrapper con sesión admin tiene IS_ADMIN=true (gate bypasseado)", async () => {
    const agent = request.agent(app);
    const login = await agent.post("/api/auth/login").send({ email: "admin-onb@local.test", password: "onbpass1234" });
    expect(login.status).toBe(200);
    const r = await agent.get("/onboarding/4");
    expect(r.text).toContain("var IS_ADMIN = true");
  });

  it("wrapper con sesión setter tiene IS_ADMIN=false (gate activo para setters)", async () => {
    const agent = request.agent(app);
    const login = await agent.post("/api/auth/login").send({ email: "setter-onb@local.test", password: "setterpass" });
    expect(login.status).toBe(200);
    const r = await agent.get("/onboarding/4");
    expect(r.text).toContain("var IS_ADMIN = false");
  });

  it("GET /onboarding/99 (módulo inexistente) devuelve 404", async () => {
    const r = await request(app).get("/onboarding/99");
    expect(r.status).toBe(404);
  });

  it("GET /onboarding/abc no matchea wrapper (cae a static / 404)", async () => {
    // El regex del middleware sólo matchea dígitos. /onboarding/abc no debe activar el wrapper.
    const r = await request(app).get("/onboarding/abc");
    expect([404, 200]).toContain(r.status); // 404 si no hay archivo, nunca "Módulo no encontrado"
    expect(r.text).not.toContain("Módulo no encontrado");
  });
});

describe("onboarding · servir HTML de módulo con quiz inyectado", () => {
  it("GET /onboarding/files/scm-onboarding-modulo1.html inyecta el script del quiz antes de </body>", async () => {
    const r = await request(app).get("/onboarding/files/scm-onboarding-modulo1.html");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/text\/html/);
    expect(r.text).toContain('id="scm-quiz-root"');
    expect(r.text).toContain("/onboarding/quiz.js");
    // El módulo original sigue presente
    expect(r.text).toMatch(/SCM\s*[·.\-]\s*Onboarding/i);
  });

  it("la inyección queda dentro del body original (no rompe el HTML)", async () => {
    const r = await request(app).get("/onboarding/files/scm-onboarding-modulo2.html");
    const bodyEnd = r.text.lastIndexOf("</body>");
    const quizRoot = r.text.indexOf('id="scm-quiz-root"');
    expect(quizRoot).toBeGreaterThan(0);
    expect(quizRoot).toBeLessThan(bodyEnd);
  });

  it("módulos del 1 al 8 todos sirven HTML con quiz inyectado", async () => {
    for (let n = 1; n <= 8; n++) {
      const r = await request(app).get(`/onboarding/files/scm-onboarding-modulo${n}.html`);
      expect(r.status, `módulo ${n}`).toBe(200);
      expect(r.text, `módulo ${n}`).toContain("scm-quiz-root");
    }
  });
});

describe("onboarding · assets estáticos NO interceptados", () => {
  it("GET /onboarding/quiz.js devuelve JavaScript real (no atrapado por el wrapper)", async () => {
    const r = await request(app).get("/onboarding/quiz.js");
    expect(r.status).toBe(200);
    expect(r.text).toContain("scm_onboarding_progress");
    expect(r.text).not.toContain("Módulo no encontrado");
  });

  it("GET /onboarding/quiz-data.json devuelve JSON con los 8 módulos", async () => {
    const r = await request(app).get("/onboarding/quiz-data.json");
    expect(r.status).toBe(200);
    const data = JSON.parse(r.text);
    expect(data.modulo1).toBeDefined();
    expect(data.modulo8).toBeDefined();
    expect(Array.isArray(data.modulo1.preguntas)).toBe(true);
  });

  it("quiz-data.json: cada módulo tiene 5 preguntas con shape correcto", async () => {
    const r = await request(app).get("/onboarding/quiz-data.json");
    const data = JSON.parse(r.text);
    for (let n = 1; n <= 8; n++) {
      const mod = data[`modulo${n}`];
      expect(mod, `modulo${n}`).toBeDefined();
      expect(mod.preguntas, `modulo${n}.preguntas`).toHaveLength(5);
      for (const q of mod.preguntas) {
        expect(typeof q.pregunta).toBe("string");
        expect(Array.isArray(q.opciones)).toBe(true);
        expect(q.opciones.length).toBe(3);
        expect(typeof q.correcta).toBe("number");
        expect(q.correcta).toBeGreaterThanOrEqual(0);
        expect(q.correcta).toBeLessThanOrEqual(2);
        expect(typeof q.explicacion).toBe("string");
      }
    }
  });

  it("quiz-data.json: bancoExtra (si existe) tiene el mismo shape que preguntas", async () => {
    const r = await request(app).get("/onboarding/quiz-data.json");
    const data = JSON.parse(r.text);
    for (let n = 1; n <= 8; n++) {
      const mod = data[`modulo${n}`];
      if (!mod.bancoExtra) continue; // bancoExtra es opcional
      expect(Array.isArray(mod.bancoExtra), `modulo${n}.bancoExtra`).toBe(true);
      for (const q of mod.bancoExtra) {
        expect(Array.isArray(q.opciones)).toBe(true);
        expect(q.opciones.length).toBe(3);
        expect(q.correcta).toBeGreaterThanOrEqual(0);
        expect(q.correcta).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe("calls · disposition endpoint", () => {
  // Necesitamos un lead para testear. Lo importamos via /api/setters/import como admin.
  let testLeadId = null;

  it("setup: crear lead de prueba en Llamadas", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: "admin-onb@local.test", password: "onbpass1234" });
    const r = await agent.post("/api/setters/import").send({
      leads: [{ name: "Test Llamada", phone: "+57 300 1234567", country: "Colombia", city: "Bogotá", website: "" }],
      assignTo: ""
    });
    expect(r.status).toBe(200);
    expect(r.body.imported).toBeGreaterThan(0);
    // Recuperar el id del lead creado
    const list = await agent.get("/api/setters/leads/sin-wsp");
    // El lead recién importado no tiene conexion sin_wsp (la heurística no auto-rutea)
    // → marcarlo manualmente sin_wsp para que aparezca en la vista de llamadas
    const all = await agent.get("/api/setters/leads");
    const lead = all.body.leads.find(l => l.name === "Test Llamada");
    expect(lead).toBeDefined();
    testLeadId = lead.id;
    const patch = await agent.patch("/api/setters/leads/" + testLeadId).send({ conexion: "sin_wsp" });
    expect(patch.status).toBe(200);
  });

  it("POST /call-disposition rechaza outcome inválido (400)", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: "admin-onb@local.test", password: "onbpass1234" });
    const r = await agent.post("/api/setters/leads/" + testLeadId + "/call-disposition").send({ outcome: "invalid_outcome" });
    expect(r.status).toBe(400);
  });

  it("POST /call-disposition con 'no_answer' incrementa callAttempts y agrega al log", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: "admin-onb@local.test", password: "onbpass1234" });
    const r = await agent.post("/api/setters/leads/" + testLeadId + "/call-disposition").send({ outcome: "no_answer" });
    expect(r.status).toBe(200);
    expect(r.body.lead.callAttempts).toBe(1);
    expect(r.body.lead.callLog).toHaveLength(1);
    expect(r.body.lead.callLog[0].outcome).toBe("no_answer");
  });

  it("POST /call-disposition con 'answered_interested' marca calificado=true e interes=si", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: "admin-onb@local.test", password: "onbpass1234" });
    const r = await agent.post("/api/setters/leads/" + testLeadId + "/call-disposition").send({ outcome: "answered_interested" });
    expect(r.status).toBe(200);
    expect(r.body.lead.calificado).toBe(true);
    expect(r.body.lead.interes).toBe("si");
    expect(r.body.lead.estado).toBe("interesado");
    // El lead se queda en Llamadas (conexion sin_wsp)
    expect(r.body.lead.conexion).toBe("sin_wsp");
  });

  it("POST /call-disposition con 'scheduled_with_admin' crea entry en calendar y marca agendado", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: "admin-onb@local.test", password: "onbpass1234" });
    const fecha = new Date(Date.now() + 24*60*60*1000).toISOString();
    const r = await agent.post("/api/setters/leads/" + testLeadId + "/call-disposition").send({
      outcome: "scheduled_with_admin",
      scheduled: { fecha, nombre: "Test Llamada" }
    });
    expect(r.status).toBe(200);
    expect(r.body.lead.estado).toBe("agendado");
    expect(r.body.calendarEntry).toBeTruthy();
    expect(r.body.calendarEntry.leadId).toBe(testLeadId);
    expect(r.body.calendarEntry.fecha).toBe(fecha);
  });

  it("POST /call-disposition con 'wrong_number' setea phoneStatus y descarta", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: "admin-onb@local.test", password: "onbpass1234" });
    // Crear otro lead para no contaminar
    const imp = await agent.post("/api/setters/import").send({
      leads: [{ name: "Test Wrong", phone: "+57 300 9999999", country: "Colombia" }],
      assignTo: ""
    });
    const all = await agent.get("/api/setters/leads");
    const lead = all.body.leads.find(l => l.name === "Test Wrong");
    await agent.patch("/api/setters/leads/" + lead.id).send({ conexion: "sin_wsp" });
    const r = await agent.post("/api/setters/leads/" + lead.id + "/call-disposition").send({ outcome: "wrong_number" });
    expect(r.status).toBe(200);
    expect(r.body.lead.phoneStatus).toBe("wrong");
    expect(r.body.lead.estado).toBe("descartado");
  });

  it("POST /call-disposition con 'callback_later' setea callbackAt", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: "admin-onb@local.test", password: "onbpass1234" });
    const imp = await agent.post("/api/setters/import").send({
      leads: [{ name: "Test Callback", phone: "+57 300 5555555", country: "Colombia" }],
      assignTo: ""
    });
    const all = await agent.get("/api/setters/leads");
    const lead = all.body.leads.find(l => l.name === "Test Callback");
    await agent.patch("/api/setters/leads/" + lead.id).send({ conexion: "sin_wsp" });
    const futureDate = new Date(Date.now() + 48*60*60*1000).toISOString();
    const r = await agent.post("/api/setters/leads/" + lead.id + "/call-disposition").send({
      outcome: "callback_later",
      callbackAt: futureDate
    });
    expect(r.status).toBe(200);
    expect(r.body.lead.callbackAt).toBe(futureDate);
  });

  it("POST /call-disposition con 'voicemail' setea phoneStatus pero no descarta", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: "admin-onb@local.test", password: "onbpass1234" });
    const imp = await agent.post("/api/setters/import").send({
      leads: [{ name: "Test Voicemail", phone: "+57 300 7777777", country: "Colombia" }],
      assignTo: ""
    });
    const all = await agent.get("/api/setters/leads");
    const lead = all.body.leads.find(l => l.name === "Test Voicemail");
    await agent.patch("/api/setters/leads/" + lead.id).send({ conexion: "sin_wsp" });
    const r = await agent.post("/api/setters/leads/" + lead.id + "/call-disposition").send({ outcome: "voicemail" });
    expect(r.status).toBe(200);
    expect(r.body.lead.phoneStatus).toBe("voicemail");
    expect(r.body.lead.estado).not.toBe("descartado");
  });

  it("POST /call-disposition lead inexistente → 404", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: "admin-onb@local.test", password: "onbpass1234" });
    const r = await agent.post("/api/setters/leads/lead_xyz_no_existe/call-disposition").send({ outcome: "no_answer" });
    expect(r.status).toBe(404);
  });

  it("POST /call-disposition guarda notas en el callLog", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: "admin-onb@local.test", password: "onbpass1234" });
    const imp = await agent.post("/api/setters/import").send({
      leads: [{ name: "Test Notes", phone: "+57 300 6666666", country: "Colombia" }],
      assignTo: ""
    });
    const all = await agent.get("/api/setters/leads");
    const lead = all.body.leads.find(l => l.name === "Test Notes");
    await agent.patch("/api/setters/leads/" + lead.id).send({ conexion: "sin_wsp" });
    const r = await agent.post("/api/setters/leads/" + lead.id + "/call-disposition").send({
      outcome: "answered_interested",
      notes: "Le interesa pero quiere pensarlo"
    });
    expect(r.status).toBe(200);
    expect(r.body.lead.callLog[0].notes).toBe("Le interesa pero quiere pensarlo");
  });

  it("POST /call-disposition trunca notas largas a 500 chars", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: "admin-onb@local.test", password: "onbpass1234" });
    const imp = await agent.post("/api/setters/import").send({
      leads: [{ name: "Test LongNotes", phone: "+57 300 4444444", country: "Colombia" }],
      assignTo: ""
    });
    const all = await agent.get("/api/setters/leads");
    const lead = all.body.leads.find(l => l.name === "Test LongNotes");
    await agent.patch("/api/setters/leads/" + lead.id).send({ conexion: "sin_wsp" });
    const longNote = "a".repeat(1000);
    const r = await agent.post("/api/setters/leads/" + lead.id + "/call-disposition").send({
      outcome: "no_answer",
      notes: longNote
    });
    expect(r.status).toBe(200);
    expect(r.body.lead.callLog[0].notes.length).toBe(500);
  });
});

describe("calls · scheduled calendar (admin)", () => {
  it("GET /api/setters/calendar/enriched devuelve entries con info del lead", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: "admin-onb@local.test", password: "onbpass1234" });
    const r = await agent.get("/api/setters/calendar/enriched");
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.calendar)).toBe(true);
    const fromCall = r.body.calendar.find(e => e.sourceCall === true);
    expect(fromCall).toBeDefined();
    expect(fromCall.lead).toBeDefined();
    expect(fromCall.lead.phone).toBeTruthy();
  });

  it("PATCH /api/setters/calendar/:id actualiza calendarioEstado", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: "admin-onb@local.test", password: "onbpass1234" });
    const list = await agent.get("/api/setters/calendar/enriched");
    const entry = list.body.calendar.find(e => e.sourceCall === true);
    expect(entry).toBeDefined();
    const r = await agent.patch("/api/setters/calendar/" + entry.id).send({ calendarioEstado: "realizada" });
    expect(r.status).toBe(200);
    expect(r.body.entry.calendarioEstado).toBe("realizada");
  });

  it("PATCH /api/setters/calendar/:id rechaza estado inválido (400)", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: "admin-onb@local.test", password: "onbpass1234" });
    const list = await agent.get("/api/setters/calendar/enriched");
    const entry = list.body.calendar[0];
    if (!entry) return;
    const r = await agent.patch("/api/setters/calendar/" + entry.id).send({ calendarioEstado: "borracho" });
    expect(r.status).toBe(400);
  });

  it("PATCH /api/setters/calendar/:id en entry inexistente → 404", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: "admin-onb@local.test", password: "onbpass1234" });
    const r = await agent.patch("/api/setters/calendar/cal_no_existe").send({ calendarioEstado: "realizada" });
    expect(r.status).toBe(404);
  });

  it("DELETE /api/setters/calendar/:id requiere admin (403 para setter)", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: "setter-onb@local.test", password: "setterpass" });
    const r = await agent.delete("/api/setters/calendar/cal_anything");
    expect(r.status).toBe(403);
  });
});

describe("calls · centro de comando metrics", () => {
  it("GET /api/setters/command incluye callTotals con métricas de llamadas", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: "admin-onb@local.test", password: "onbpass1234" });
    const r = await agent.get("/api/setters/command");
    expect(r.status).toBe(200);
    expect(r.body.callTotals).toBeDefined();
    const ct = r.body.callTotals;
    expect(typeof ct.leadsEnLlamadas).toBe("number");
    expect(typeof ct.totalLlamadas).toBe("number");
    expect(typeof ct.llamadasHoy).toBe("number");
    expect(typeof ct.atendidasHistorico).toBe("number");
    expect(typeof ct.interesadosHistorico).toBe("number");
    expect(typeof ct.agendadosConAdmin).toBe("number");
    expect(typeof ct.numerosMuertos).toBe("number");
    expect(typeof ct.agendamientoPendientes).toBe("number");
    expect(typeof ct.pctConversion).toBe("string");
    expect(typeof ct.pctNumerosMuertos).toBe("string");
  });

  it("GET /api/setters/command incluye callsPerSetter con conversion", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: "admin-onb@local.test", password: "onbpass1234" });
    const r = await agent.get("/api/setters/command");
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.callsPerSetter)).toBe(true);
    if (r.body.callsPerSetter.length > 0) {
      const s = r.body.callsPerSetter[0];
      expect(typeof s.id).toBe("string");
      expect(typeof s.name).toBe("string");
      expect(typeof s.totalLlamadas).toBe("number");
      expect(typeof s.agendados).toBe("number");
      expect(typeof s.pctConversion).toBe("string");
    }
  });

  it("callTotals.numerosMuertos cuenta phoneStatus wrong/invalid", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: "admin-onb@local.test", password: "onbpass1234" });
    // De los tests anteriores, "Test Wrong" debería estar marcado phoneStatus='wrong'
    const r = await agent.get("/api/setters/command");
    expect(r.body.callTotals.numerosMuertos).toBeGreaterThanOrEqual(1);
  });

  it("callTotals.agendadosConAdmin > 0 si hubo scheduled_with_admin", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: "admin-onb@local.test", password: "onbpass1234" });
    const r = await agent.get("/api/setters/command");
    // El test 'POST /call-disposition con scheduled_with_admin' creó al menos 1
    expect(r.body.callTotals.agendadosConAdmin).toBeGreaterThanOrEqual(1);
  });
});

describe("admin · backups", () => {
  it("GET /api/admin/backups requiere admin (403 setter)", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: "setter-onb@local.test", password: "setterpass" });
    const r = await agent.get("/api/admin/backups");
    expect(r.status).toBe(403);
  });

  it("GET /api/admin/backups devuelve array", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: "admin-onb@local.test", password: "onbpass1234" });
    const r = await agent.get("/api/admin/backups");
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.backups)).toBe(true);
  });

  it("POST /api/admin/backups/now crea un backup manual", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: "admin-onb@local.test", password: "onbpass1234" });
    const r = await agent.post("/api/admin/backups/now");
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.copied).toBeGreaterThan(0);
  });

  it("POST /api/admin/backups/now requiere admin (403 setter)", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: "setter-onb@local.test", password: "setterpass" });
    const r = await agent.post("/api/admin/backups/now");
    expect(r.status).toBe(403);
  });
});

describe("admin · error log", () => {
  it("GET /api/admin/errors/recent requiere admin (403 setter)", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: "setter-onb@local.test", password: "setterpass" });
    const r = await agent.get("/api/admin/errors/recent");
    expect(r.status).toBe(403);
  });

  it("GET /api/admin/errors/recent devuelve estructura esperada", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: "admin-onb@local.test", password: "onbpass1234" });
    const r = await agent.get("/api/admin/errors/recent");
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.errors)).toBe(true);
    expect(typeof r.body.total).toBe("number");
  });
});

describe("imports · validación de leads", () => {
  it("POST /api/setters/import rechaza array vacío (400)", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: "admin-onb@local.test", password: "onbpass1234" });
    const r = await agent.post("/api/setters/import").send({ leads: [], assignTo: "" });
    expect(r.status).toBe(400);
  });

  it("POST /api/setters/import rechaza más de 10000 leads (413)", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: "admin-onb@local.test", password: "onbpass1234" });
    const tooMany = Array.from({ length: 10001 }, (_, i) => ({ name: `Lead ${i}`, phone: `+5491111${i}` }));
    const r = await agent.post("/api/setters/import").send({ leads: tooMany, assignTo: "" });
    expect(r.status).toBe(413);
  });

  it("POST /api/setters/import rechaza lead sin name ni phone (400)", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: "admin-onb@local.test", password: "onbpass1234" });
    const r = await agent.post("/api/setters/import").send({
      leads: [
        { name: "Valid", phone: "+5491111111" },
        { website: "http://nada.com" } // sin name ni phone
      ],
      assignTo: ""
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Lead #2/);
  });
});

describe("auth · presencia online (admin only)", () => {
  // /api/auth/online usa sesión por cookie (no Bearer JWT). Usamos agent para persistirla.
  it("GET /api/auth/online sin auth → 401", async () => {
    const r = await request(app).get("/api/auth/online");
    expect(r.status).toBe(401);
  });

  it("GET /api/auth/online como setter → 403", async () => {
    const agent = request.agent(app);
    const login = await agent.post("/api/auth/login").send({ email: "setter-onb@local.test", password: "setterpass" });
    expect(login.status).toBe(200);
    const r = await agent.get("/api/auth/online");
    expect(r.status).toBe(403);
  });

  it("GET /api/auth/online como admin devuelve lista de usuarios con status", async () => {
    const agent = request.agent(app);
    const login = await agent.post("/api/auth/login").send({ email: "admin-onb@local.test", password: "onbpass1234" });
    expect(login.status).toBe(200);
    const r = await agent.get("/api/auth/online");
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.users)).toBe(true);
    expect(r.body.users.length).toBeGreaterThan(0);
    const admin = r.body.users.find(u => u.email === "admin-onb@local.test");
    expect(admin).toBeDefined();
    expect(["online", "recent", "offline"]).toContain(admin.status);
  });
});

describe("admin · healthcheck", () => {
  it("GET /api/admin/health requiere admin (403 setter)", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: "setter-onb@local.test", password: "setterpass" });
    const r = await agent.get("/api/admin/health");
    expect(r.status).toBe(403);
  });

  it("GET /api/admin/health devuelve estructura completa", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: "admin-onb@local.test", password: "onbpass1234" });
    const r = await agent.get("/api/admin/health");
    expect(r.status).toBe(200);
    expect(["healthy", "degraded", "unhealthy"]).toContain(r.body.status);
    expect(r.body.checks).toBeDefined();
    expect(r.body.checks.server.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(r.body.checks.data).toBeDefined();
    expect(r.body.checks.data.dir).toBeTruthy();
    expect(r.body.checks.counts).toBeDefined();
    expect(typeof r.body.checks.counts.leads).toBe("number");
    expect(r.body.checks.ai).toBeDefined();
    expect(r.body.checks.backups).toBeDefined();
    expect(r.body.checks.errors).toBeDefined();
    expect(typeof r.body.checks.errors.last24hCount).toBe("number");
  });
});

describe("admin · weekly report", () => {
  it("GET /api/admin/weekly-report/preview requiere admin (403 setter)", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: "setter-onb@local.test", password: "setterpass" });
    const r = await agent.get("/api/admin/weekly-report/preview");
    expect(r.status).toBe(403);
  });

  it("GET /api/admin/weekly-report/preview devuelve data + html", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: "admin-onb@local.test", password: "onbpass1234" });
    const r = await agent.get("/api/admin/weekly-report/preview");
    expect(r.status).toBe(200);
    expect(r.body.data).toBeDefined();
    expect(r.body.data.period).toBeDefined();
    expect(r.body.data.period.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.body.data.period.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.body.data.wsp).toBeDefined();
    expect(r.body.data.calls).toBeDefined();
    expect(r.body.data.calendar).toBeDefined();
    expect(Array.isArray(r.body.data.perSetter)).toBe(true);
    expect(typeof r.body.html).toBe("string");
    expect(r.body.html).toContain("Reporte semanal SCM");
  });

  it("POST /api/admin/weekly-report/send sin RESEND_API_KEY → 500 con reason", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: "admin-onb@local.test", password: "onbpass1234" });
    const r = await agent.post("/api/admin/weekly-report/send").send({ to: "test@test.com" });
    expect(r.status).toBe(500);
    expect(r.body.reason).toMatch(/RESEND/i);
  });

  it("POST /api/admin/weekly-report/send requiere admin (403 setter)", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: "setter-onb@local.test", password: "setterpass" });
    const r = await agent.post("/api/admin/weekly-report/send").send({ to: "test@test.com" });
    expect(r.status).toBe(403);
  });
});

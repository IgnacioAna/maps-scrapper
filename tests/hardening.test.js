// Tests de hardening pre-deploy: cobertura de los 4 fixes criticos aplicados
// antes del onboarding de 8 setters.
//
// Cubre:
//  - C-1: PATCH concurrentes mantienen integridad (handler sync = serializado por Node)
//  - C-2: rate limiter scrape/enrich + clamp anti-quema-creditos en /api/scrape
//  - H-4: validacion de shape + auto-backup en /api/admin/import-data
//
// C-3 (gc de sesiones en setInterval) no se testea directamente porque esta
// gateado por NODE_ENV !== 'test'. Lo verificamos por observacion: el
// loadAuthData ya no escribe disk al expirar sesiones.
//
// IMPORTANTE: el orden de los describes importa. C-1 corre PRIMERO porque
// H-4 termina haciendo POST /import-data con setters vacios, lo que borra el
// lead sembrado.

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `hardening-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-h@local.test";
process.env.ADMIN_PASSWORD = "hpass1234";
process.env.ADMIN_NAME = "AdminH";
process.env.JWT_SECRET = "test-secret-h";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}

fs.writeFileSync(
  path.join(tmpData, "auth.json"),
  JSON.stringify({
    users: [
      { id: "user_admin_h", email: "admin-h@local.test", name: "AdminH", role: "admin", status: "active", setterId: "", password: pwd("hpass1234"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ],
    invites: [],
    sessions: [],
  }, null, 2)
);

// Seed setters.json con un lead listo para que los PATCH no necesiten endpoint de import.
fs.writeFileSync(
  path.join(tmpData, "setters.json"),
  JSON.stringify({
    setters: [],
    leads: {
      "lead_concurrencia": {
        id: "lead_concurrencia",
        num: 1,
        name: "Lead Concurrencia",
        phone: "+5491100000000",
        country: "Argentina",
        assignedTo: "",
        decisor: "",
        estado: "sin_contactar"
      }
    },
    variants: [],
    calendar: [],
    sessions: []
  }, null, 2)
);

const { app } = await import("../index.js");

let cookie = "";

beforeAll(async () => {
  const r = await request(app).post("/api/auth/login").send({ email: "admin-h@local.test", password: "hpass1234" });
  expect(r.status).toBe(200);
  cookie = r.headers["set-cookie"][0].split(";")[0];
});

afterAll(() => {
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
});

describe("C-1: PATCH concurrentes mantienen integridad del lead", () => {
  it("PATCH simple funciona (sanity check)", async () => {
    const r = await request(app).patch(`/api/setters/leads/lead_concurrencia`).set("Cookie", cookie).send({ decisor: "single" });
    expect(r.status).toBe(200);
    expect(r.body.lead.decisor).toBe("single");
  });

  it("100 PATCH concurrentes a un lead NO lo borran ni causan errores", async () => {
    const patches = [];
    for (let i = 0; i < 100; i++) {
      patches.push(request(app).patch(`/api/setters/leads/lead_concurrencia`).set("Cookie", cookie).send({ decisor: `c-${i}` }));
    }
    const results = await Promise.all(patches);
    const failures = results.filter(r => r.status !== 200);
    expect(failures.length).toBe(0);

    const list = await request(app).get("/api/setters/leads").set("Cookie", cookie);
    const leads = list.body.leads || []; // este endpoint devuelve un array, no map
    const lead = leads.find(l => l.id === "lead_concurrencia");
    expect(lead).toBeTruthy();
    expect(lead.decisor).toMatch(/^c-\d+$/); // alguno de los 100 valores
  });
});

describe("C-2: rate limit y clamp en endpoints externos", () => {
  it("/api/scrape rechaza payloads que excedan 50 calls totales", async () => {
    // 6 keywords x 6 ubicaciones x 2 paginas = 72 > 50
    const r = await request(app).post("/api/scrape").set("Cookie", cookie).send({
      query: "k1\nk2\nk3\nk4\nk5\nk6",
      location: "Bogota; Lima; Madrid; Mexico DF; Buenos Aires; Quito",
      maxPages: 2
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Demasiado trabajo|llamadas/i);
  });

  it("/api/scrape acepta payloads dentro del limite (no rechaza con 400 por clamp)", async () => {
    // 1 keyword x 1 ubicacion x 1 pagina = 1 (OK)
    const r = await request(app).post("/api/scrape").set("Cookie", cookie).send({
      query: "test query",
      location: "Bogota",
      maxPages: 1
    });
    // Si no hay SerpAPI key fallara con 500, pero NO con 400 del clamp
    expect(r.status).not.toBe(400);
  });
});

describe("POST /api/admin/regen-openings — limpia openMessages rotos", () => {
  it("dryRun: cuenta cuantos cambiaria sin tocar nada", async () => {
    // Sembrar leads con varios estados de openMessage
    const settersFile = path.join(tmpData, "setters.json");
    const sd = JSON.parse(fs.readFileSync(settersFile, "utf8"));
    sd.leads.lead_regen_1 = { id: "lead_regen_1", num: 50, name: "L1", phone: "+57300", country: "Colombia", openMessage: "Hola, me gustaría saber más sobre sus servicios" }; // ROL INVERTIDO
    sd.leads.lead_regen_2 = { id: "lead_regen_2", num: 51, name: "L2", phone: "+57301", country: "Colombia", openMessage: "Hola, buenas tardes" }; // OK
    sd.leads.lead_regen_3 = { id: "lead_regen_3", num: 52, name: "L3", phone: "+57302", country: "Colombia", openMessage: "" }; // VACIO
    sd.leads.lead_regen_4 = { id: "lead_regen_4", num: 53, name: "L4", phone: "+57303", country: "Colombia", openMessage: "Visitanos en https://x.com" }; // URL
    fs.writeFileSync(settersFile, JSON.stringify(sd, null, 2));

    const r = await request(app).post("/api/admin/regen-openings").set("Cookie", cookie).send({ dryRun: true });
    expect(r.status).toBe(200);
    expect(r.body.scanned).toBeGreaterThanOrEqual(4);
    expect(r.body.changed).toBeGreaterThanOrEqual(3); // 1, 3 y 4 deberian cambiar; 2 no
    expect(r.body.dryRun).toBe(true);

    // Verificar que NO toco el archivo (dryRun)
    const sdAfter = JSON.parse(fs.readFileSync(settersFile, "utf8"));
    expect(sdAfter.leads.lead_regen_1.openMessage).toBe("Hola, me gustaría saber más sobre sus servicios");
  });

  it("sin dryRun: regenera de verdad y los nuevos pasan el sanitizer", async () => {
    const r = await request(app).post("/api/admin/regen-openings").set("Cookie", cookie).send({});
    expect(r.status).toBe(200);
    expect(r.body.changed).toBeGreaterThan(0);
    const settersFile = path.join(tmpData, "setters.json");
    const sd = JSON.parse(fs.readFileSync(settersFile, "utf8"));
    // El "rol invertido" ya fue regenerado a algo neutro
    expect(sd.leads.lead_regen_1.openMessage).not.toMatch(/me gustar[ií]a/i);
    // El que estaba bien sigue igual
    expect(sd.leads.lead_regen_2.openMessage).toBe("Hola, buenas tardes");
    // El vacio ya tiene mensaje
    expect(sd.leads.lead_regen_3.openMessage.length).toBeGreaterThan(5);
    // El URL fue reemplazado
    expect(sd.leads.lead_regen_4.openMessage).not.toMatch(/https?:|www\./);
  });

  it("setterId filtra solo a un setter", async () => {
    // Sembrar lead asignado a un setterId distinto
    const settersFile = path.join(tmpData, "setters.json");
    const sd = JSON.parse(fs.readFileSync(settersFile, "utf8"));
    sd.leads.lead_regen_otro_setter = { id: "lead_regen_otro_setter", num: 99, name: "Otro", country: "Colombia", openMessage: "Hola, estoy interesado", assignedTo: "setter_otro_xxx" };
    sd.leads.lead_regen_solo = { id: "lead_regen_solo", num: 100, name: "Solo", country: "Colombia", openMessage: "Hola, me gustaría saber", assignedTo: "setter_target_xxx" };
    fs.writeFileSync(settersFile, JSON.stringify(sd, null, 2));

    const r = await request(app).post("/api/admin/regen-openings").set("Cookie", cookie).send({ setterId: "setter_target_xxx" });
    expect(r.status).toBe(200);
    expect(r.body.scanned).toBe(1); // solo el del target
    expect(r.body.changed).toBe(1);
  });
});

describe("POST /api/auth/accept-invite — auto-login con cookie de sesion", () => {
  it("crea el usuario, marca el invite aceptado, devuelve cookie de sesion y la sesion es valida", async () => {
    // 1) Como admin, creamos un invite para un nuevo setter
    const invRes = await request(app).post("/api/auth/invites").set("Cookie", cookie).send({
      name: "Setter NuevoInv", email: "nuevoinv@local.test", role: "setter", sendEmail: false
    });
    expect(invRes.status).toBe(200);
    const token = invRes.body.invite.token;
    expect(token).toBeTruthy();

    // 2) Aceptamos el invite (sin auth — es flow publico)
    const accept = await request(app).post("/api/auth/accept-invite").send({
      token, password: "miclavesegura123"
    });
    expect(accept.status).toBe(200);
    expect(accept.body.authenticated).toBe(true);
    expect(accept.body.user.email).toBe("nuevoinv@local.test");
    // 3) Debe venir con Set-Cookie de sesion
    const setCookies = accept.headers["set-cookie"] || [];
    const sessionCookie = setCookies.find(c => /^gs_session=/.test(c));
    expect(sessionCookie).toBeTruthy();

    // 4) Esa cookie debe permitir hacer GET /api/auth/me sin re-loguear
    const cookieValue = sessionCookie.split(";")[0];
    const meRes = await request(app).get("/api/auth/me").set("Cookie", cookieValue);
    expect(meRes.status).toBe(200);
    expect(meRes.body.authenticated).toBe(true);
    expect(meRes.body.user.email).toBe("nuevoinv@local.test");
  });

  it("rechaza token invalido con 404 y mensaje claro", async () => {
    const r = await request(app).post("/api/auth/accept-invite").send({
      token: "tok-que-no-existe-12345", password: "xxxxxx123"
    });
    expect(r.status).toBe(404);
    expect(r.body.error).toMatch(/invalida|invalid|usada/i);
  });

  it("rechaza password muy corta (<6) con 400", async () => {
    const r = await request(app).post("/api/auth/accept-invite").send({
      token: "tok-x", password: "abc"
    });
    expect(r.status).toBe(400);
  });
});

describe("PATCH /api/auth/users/:id — cambiar rol/nombre con guards", () => {
  it("promueve un setter a supervisor: libera leads y limpia setterId", async () => {
    // Crear setter base
    const create = await request(app).post("/api/setters/team").set("Cookie", cookie).send({ name: "ToPromote" });
    const sid = create.body.setters.find(s => s.name === "ToPromote").id;
    // Crear user setter via invite + accept
    const inv = await request(app).post("/api/auth/invites").set("Cookie", cookie).send({
      name: "ToPromote", email: "topromote@local.test", role: "setter", sendEmail: false
    });
    const accept = await request(app).post("/api/auth/accept-invite").send({ token: inv.body.invite.token, password: "topromote123" });
    const userId = accept.body.user.id;
    // Sembrar 2 leads asignados a este setter
    const settersFile = path.join(tmpData, "setters.json");
    const sd = JSON.parse(fs.readFileSync(settersFile, "utf8"));
    sd.leads.lead_promote_1 = { id: "lead_promote_1", num: 200, name: "L1", country: "Argentina", assignedTo: accept.body.user.setterId, openMessage: "Hola" };
    sd.leads.lead_promote_2 = { id: "lead_promote_2", num: 201, name: "L2", country: "Argentina", assignedTo: accept.body.user.setterId, openMessage: "Hola" };
    fs.writeFileSync(settersFile, JSON.stringify(sd, null, 2));

    // PROMOVER a supervisor
    const r = await request(app).patch("/api/auth/users/" + userId).set("Cookie", cookie).send({ role: "supervisor" });
    expect(r.status).toBe(200);
    expect(r.body.oldRole).toBe("setter");
    expect(r.body.newRole).toBe("supervisor");
    expect(r.body.leadsFreed).toBe(2);
    expect(r.body.user.role).toBe("supervisor");
    expect(r.body.user.setterId).toBe("");

    // Verificar: leads liberados
    const sdAfter = JSON.parse(fs.readFileSync(settersFile, "utf8"));
    expect(sdAfter.leads.lead_promote_1.assignedTo).toBe("");
    expect(sdAfter.leads.lead_promote_2.assignedTo).toBe("");
  });

  it("rechaza cambiar el propio rol (auto-degradacion)", async () => {
    const r = await request(app).patch("/api/auth/users/user_admin_h").set("Cookie", cookie).send({ role: "setter" });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/propio rol/i);
  });

  it("rechaza rol invalido", async () => {
    const r = await request(app).patch("/api/auth/users/user_admin_h").set("Cookie", cookie).send({ role: "rey" });
    expect(r.status).toBe(400);
  });

  it("404 si user no existe", async () => {
    const r = await request(app).patch("/api/auth/users/nope").set("Cookie", cookie).send({ role: "setter" });
    expect(r.status).toBe(404);
  });
});

describe("Rol 'supervisor': lectura del Centro de Comando + bloqueo de admin-only", () => {
  let supervisorCookie = "";
  beforeAll(async () => {
    // Crear invite de supervisor (admin-only, asi que usamos cookie de admin)
    const inv = await request(app).post("/api/auth/invites").set("Cookie", cookie).send({
      name: "Sup Paula", email: "supervisor-test@local.test", role: "supervisor", sendEmail: false
    });
    expect(inv.status).toBe(200);
    expect(inv.body.invite.role).toBe("supervisor");
    // Aceptar invite con auto-login
    const accept = await request(app).post("/api/auth/accept-invite").send({
      token: inv.body.invite.token, password: "supervisor123"
    });
    expect(accept.status).toBe(200);
    expect(accept.body.user.role).toBe("supervisor");
    const setCookies = accept.headers["set-cookie"] || [];
    const sessionCookie = setCookies.find(c => /^gs_session=/.test(c));
    supervisorCookie = sessionCookie.split(";")[0];
  });

  it("supervisor PUEDE leer /api/setters/command", async () => {
    const r = await request(app).get("/api/setters/command").set("Cookie", supervisorCookie);
    expect(r.status).toBe(200);
    expect(r.body.totals).toBeTruthy();
  });

  it("supervisor PUEDE leer /api/auth/users (ver el equipo)", async () => {
    const r = await request(app).get("/api/auth/users").set("Cookie", supervisorCookie);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.users)).toBe(true);
  });

  it("supervisor PUEDE leer /api/auth/online (quien esta conectado)", async () => {
    const r = await request(app).get("/api/auth/online").set("Cookie", supervisorCookie);
    expect(r.status).toBe(200);
  });

  it("supervisor NO PUEDE crear invitaciones (admin only)", async () => {
    const r = await request(app).post("/api/auth/invites").set("Cookie", supervisorCookie).send({
      name: "Otro", email: "otro@local.test", role: "setter"
    });
    expect(r.status).toBe(403);
  });

  it("supervisor NO PUEDE eliminar setters (admin only)", async () => {
    const r = await request(app).delete("/api/setters/team/cualquier-id").set("Cookie", supervisorCookie);
    expect(r.status).toBe(403);
  });

  it("supervisor NO PUEDE scrapear (admin only)", async () => {
    const r = await request(app).post("/api/scrape").set("Cookie", supervisorCookie).send({
      query: "test", location: "Buenos Aires", maxPages: 1
    });
    expect(r.status).toBe(403);
  });

  it("supervisor NO PUEDE importar data (admin only)", async () => {
    const r = await request(app).post("/api/admin/import-data").set("Cookie", supervisorCookie).send({});
    expect(r.status).toBe(403);
  });
});

describe("DELETE /api/setters/team/:id — cascada completa (user borrado + leads liberados + sesiones e invites revocadas)", () => {
  it("borra setter + libera leads asignados + BORRA user asociado + revoca sesiones e invites", async () => {
    // 1) Crear setter (el endpoint devuelve { setters: [...] })
    const createRes = await request(app).post("/api/setters/team").set("Cookie", cookie).send({ name: "Setter Cascada" });
    expect(createRes.status).toBe(200);
    const created = createRes.body.setters.find(s => s.name === "Setter Cascada");
    expect(created).toBeTruthy();
    const setterId = created.id;

    // 2) Sembrar un lead asignado a ese setter, y un user setter con ese setterId + sesion activa
    const settersFile = path.join(tmpData, "setters.json");
    const settersData = JSON.parse(fs.readFileSync(settersFile, "utf8"));
    settersData.leads["lead_cascada_test"] = {
      id: "lead_cascada_test",
      num: 99,
      name: "Lead Cascada",
      phone: "+5491100000111",
      country: "Argentina",
      assignedTo: setterId,
      decisor: "",
      estado: "sin_contactar"
    };
    fs.writeFileSync(settersFile, JSON.stringify(settersData, null, 2));

    const authFile = path.join(tmpData, "auth.json");
    const authData = JSON.parse(fs.readFileSync(authFile, "utf8"));
    authData.users.push({
      id: "user_setter_cascada", email: "setter-cascada@local.test", name: "SetterCascada",
      role: "setter", status: "active", setterId, password: pwd("xxx"),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    });
    authData.sessions = authData.sessions || [];
    authData.sessions.push({ id: "sess_cascada_xxx", userId: "user_setter_cascada", expiresAt: new Date(Date.now() + 86400000).toISOString() });
    authData.invites = authData.invites || [];
    authData.invites.push({ token: "tok_cascada", email: "setter-cascada@local.test", setterId, role: "setter", expiresAt: new Date(Date.now() + 86400000).toISOString() });
    fs.writeFileSync(authFile, JSON.stringify(authData, null, 2));

    // 3) DELETE
    const r = await request(app).delete("/api/setters/team/" + setterId).set("Cookie", cookie);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.setterName).toBe("Setter Cascada");
    expect(r.body.leadsFreed).toBe(1);
    expect(r.body.userDeleted).toBe(true);
    expect(r.body.userEmail).toBe("setter-cascada@local.test");
    expect(r.body.sessionsRevoked).toBe(1);
    expect(r.body.invitesRevoked).toBe(1);

    // 4) Verificar estado final: setter, lead, user, sesion e invite TODOS borrados/limpios
    const settersAfter = JSON.parse(fs.readFileSync(settersFile, "utf8"));
    expect(settersAfter.setters.find(s => s.id === setterId)).toBeUndefined();
    expect(settersAfter.leads.lead_cascada_test.assignedTo).toBe("");

    const authAfter = JSON.parse(fs.readFileSync(authFile, "utf8"));
    expect(authAfter.users.find(u => u.id === "user_setter_cascada")).toBeUndefined();
    expect(authAfter.sessions.find(s => s.id === "sess_cascada_xxx")).toBeUndefined();
    expect(authAfter.invites.find(i => i.token === "tok_cascada")).toBeUndefined();
  });

  it("404 si el setter no existe Y no hay user/invite huerfano con ese ID", async () => {
    const r = await request(app).delete("/api/setters/team/no-existe-y-sin-huerfano").set("Cookie", cookie);
    expect(r.status).toBe(404);
  });

  it("tolerante: si setter NO existe pero hay user huerfano con ese setterId, limpia el user igual", async () => {
    // Sembrar user huerfano (sin setter en data.setters pero con setterId apuntando a uno inexistente)
    const authFile = path.join(tmpData, "auth.json");
    const authData = JSON.parse(fs.readFileSync(authFile, "utf8"));
    authData.users.push({
      id: "user_huerfano_1", email: "huerfano@local.test", name: "Huerfano1",
      role: "setter", status: "active", setterId: "setter_que_no_existe", password: pwd("xxx"),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    });
    fs.writeFileSync(authFile, JSON.stringify(authData, null, 2));

    const r = await request(app).delete("/api/setters/team/setter_que_no_existe").set("Cookie", cookie);
    expect(r.status).toBe(200);
    expect(r.body.setterExisted).toBe(false);
    expect(r.body.userDeleted).toBe(true);
    expect(r.body.userEmail).toBe("huerfano@local.test");

    const authAfter = JSON.parse(fs.readFileSync(authFile, "utf8"));
    expect(authAfter.users.find(u => u.id === "user_huerfano_1")).toBeUndefined();
  });
});

describe("DELETE /api/auth/users/:id — borrar user huerfano directo", () => {
  it("borra un user huerfano (sin setterId) y revoca sus sesiones", async () => {
    const authFile = path.join(tmpData, "auth.json");
    const authData = JSON.parse(fs.readFileSync(authFile, "utf8"));
    authData.users.push({
      id: "user_huerfano_2", email: "huerfano2@local.test", name: "Huerfano2",
      role: "setter", status: "inactive", setterId: "", password: pwd("xxx"),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    });
    authData.sessions = authData.sessions || [];
    authData.sessions.push({ id: "sess_h2", userId: "user_huerfano_2", expiresAt: new Date(Date.now() + 86400000).toISOString() });
    fs.writeFileSync(authFile, JSON.stringify(authData, null, 2));

    const r = await request(app).delete("/api/auth/users/user_huerfano_2").set("Cookie", cookie);
    expect(r.status).toBe(200);
    expect(r.body.email).toBe("huerfano2@local.test");
    expect(r.body.sessionsRevoked).toBe(1);
    const authAfter = JSON.parse(fs.readFileSync(authFile, "utf8"));
    expect(authAfter.users.find(u => u.id === "user_huerfano_2")).toBeUndefined();
    expect(authAfter.sessions.find(s => s.id === "sess_h2")).toBeUndefined();
  });

  it("rechaza si el user tiene setterId que SI existe en data.setters (debe usar cascada de setter)", async () => {
    // Crear setter real primero
    const create = await request(app).post("/api/setters/team").set("Cookie", cookie).send({ name: "Setter Activo No Borrar" });
    const sid = create.body.setters.find(s => s.name === "Setter Activo No Borrar").id;
    // Sembrar user con ese setterId
    const authFile = path.join(tmpData, "auth.json");
    const authData = JSON.parse(fs.readFileSync(authFile, "utf8"));
    authData.users.push({
      id: "user_con_setter_activo", email: "tiene-setter@local.test", name: "TieneSetter",
      role: "setter", status: "active", setterId: sid, password: pwd("xxx"),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    });
    fs.writeFileSync(authFile, JSON.stringify(authData, null, 2));

    const r = await request(app).delete("/api/auth/users/user_con_setter_activo").set("Cookie", cookie);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/setter activo|cascada/i);
  });

  it("rechaza borrarse a vos mismo", async () => {
    const r = await request(app).delete("/api/auth/users/user_admin_h").set("Cookie", cookie);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/a vos mismo/i);
  });

  it("404 si el user no existe", async () => {
    const r = await request(app).delete("/api/auth/users/nope-no-existe").set("Cookie", cookie);
    expect(r.status).toBe(404);
  });
});

describe("H-4: validacion de shape en /api/admin/import-data", () => {
  it("rechaza payload vacio (400)", async () => {
    const r = await request(app).post("/api/admin/import-data").set("Cookie", cookie).send({});
    expect(r.status).toBe(400);
    expect(r.body.detalles).toContain("payload vacio: incluir al menos uno de history/auth/setters/faqs/training");
  });

  it("rechaza auth sin users array (400)", async () => {
    const r = await request(app).post("/api/admin/import-data").set("Cookie", cookie).send({
      auth: { sessions: [] } // falta users
    });
    expect(r.status).toBe(400);
    expect(r.body.detalles.some(e => /users debe ser array/i.test(e))).toBe(true);
  });

  it("rechaza setters sin setters[] array (400)", async () => {
    const r = await request(app).post("/api/admin/import-data").set("Cookie", cookie).send({
      setters: { leads: {} } // falta setters[]
    });
    expect(r.status).toBe(400);
    expect(r.body.detalles.some(e => /setters\.setters debe ser array/i.test(e))).toBe(true);
  });

  it("rechaza setters.leads como array (debe ser map)", async () => {
    const r = await request(app).post("/api/admin/import-data").set("Cookie", cookie).send({
      setters: { setters: [], leads: [] } // leads como array (mal)
    });
    expect(r.status).toBe(400);
    expect(r.body.detalles.some(e => /leads debe ser un map/i.test(e))).toBe(true);
  });

  it("rechaza history.entries como array (debe ser map)", async () => {
    const r = await request(app).post("/api/admin/import-data").set("Cookie", cookie).send({
      history: { entries: [] }
    });
    expect(r.status).toBe(400);
    expect(r.body.detalles.some(e => /entries debe ser un map/i.test(e))).toBe(true);
  });

  it("rechaza faqs.entries que no es array", async () => {
    const r = await request(app).post("/api/admin/import-data").set("Cookie", cookie).send({
      faqs: { entries: "not-an-array" }
    });
    expect(r.status).toBe(400);
    expect(r.body.detalles.some(e => /faqs\.entries debe ser array/i.test(e))).toBe(true);
  });

  it("acepta payload valido con setters + faqs y devuelve ok (no toca auth para no borrar al admin del test)", async () => {
    const r = await request(app).post("/api/admin/import-data").set("Cookie", cookie).send({
      setters: { setters: [], leads: {}, variants: [], calendar: [], sessions: [] },
      faqs: { entries: [] }
    });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });
});

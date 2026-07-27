// Tests de /api/setters/team-performance + /api/setters/alert-config.
// RBAC, alertas (drop/inactivity/low_connect), promedios, edicion umbrales.
// El panel Equipo mide el FUNNEL DE LLAMADAS (callLog): dials/connects/conversations/
// appointments — no el viejo embudo de WhatsApp (conexion/respondio/calificado).

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `team-perf-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-tp@local.test";
process.env.ADMIN_PASSWORD = "tppass1234";
process.env.ADMIN_NAME = "AdminTP";
process.env.JWT_SECRET = "test-secret-tp";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}

fs.writeFileSync(
  path.join(tmpData, "auth.json"),
  JSON.stringify({
    users: [
      { id: "user_admin_tp", email: "admin-tp@local.test", name: "AdminTP", role: "admin", status: "active", setterId: "", password: pwd("tppass1234"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: "user_super_tp", email: "super-tp@local.test", name: "SuperTP", role: "supervisor", status: "active", setterId: "", password: pwd("superpass"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: "user_setter_tp", email: "setter-tp@local.test", name: "SetterTP", role: "setter", status: "active", setterId: "setter_tp1", password: pwd("setterpass"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ],
    invites: [],
    sessions: [],
  }, null, 2)
);

const NOW = Date.now();
const ONE_DAY = 24 * 60 * 60 * 1000;
const t = (offsetDays) => new Date(NOW - offsetDays * ONE_DAY).toISOString();
// Helper para ofsets sub-dia (en horas).
const tHours = (offsetHours) => new Date(NOW - offsetHours * 60 * 60 * 1000).toISOString();
// Audit 2026-07-08: period=day default ahora es "HOY desde la medianoche" (TZ
// de negocio) → depende de la hora a la que corra el test. Para los asserts de
// CONTEOS usamos from/to explícitos (ventana fija de 24h, como el fixture).
const DAY_RANGE = `period=day&from=${encodeURIComponent(new Date(NOW - ONE_DAY).toISOString())}&to=${encodeURIComponent(new Date(NOW).toISOString())}`;

// callLog helper: el panel Equipo ahora mide desde el callLog (funnel de llamadas),
// no desde los flags de setteo. Cada entry = 1 llamada (dial); outcome de connect +
// duration>=30 = conversación.
const cl = (tsIso, outcome = "answered_interested", duration = 40) => [{ ts: tsIso, outcome, duration, channel: "telnyx_webrtc" }];

// 3 setters: uno activo, uno con drop, uno inactivo
const leads = {
  // setter_a: 5 llamadas HOY (ultimas 24h, todas atendidas) + 2 en periodo previo → activo, sin drop
  l_a1: { num: 1, name: "A1", phone: "+1", assignedTo: "setter_a", importedAt: t(20), lastContactAt: tHours(2), callLog: cl(tHours(2)) },
  l_a2: { num: 2, name: "A2", phone: "+2", assignedTo: "setter_a", importedAt: t(20), lastContactAt: tHours(4), callLog: cl(tHours(4), "scheduled_with_admin") },
  l_a3: { num: 3, name: "A3", phone: "+3", assignedTo: "setter_a", importedAt: t(20), lastContactAt: tHours(6), callLog: cl(tHours(6)) },
  l_a4: { num: 4, name: "A4", phone: "+4", assignedTo: "setter_a", importedAt: t(20), lastContactAt: tHours(8), callLog: cl(tHours(8)) },
  l_a5: { num: 5, name: "A5", phone: "+5", assignedTo: "setter_a", importedAt: t(20), lastContactAt: tHours(10), callLog: cl(tHours(10)) },
  // periodo previo (24-48h atras)
  l_a_prev1: { num: 6, name: "Aprev1", phone: "+6", assignedTo: "setter_a", importedAt: t(30), lastContactAt: tHours(30), callLog: cl(tHours(30)) },
  l_a_prev2: { num: 7, name: "Aprev2", phone: "+7", assignedTo: "setter_a", importedAt: t(30), lastContactAt: tHours(40), callLog: cl(tHours(40)) },

  // setter_b: 1 llamada actual (ultimas 24h) + 5 en anterior (24-48h) → drop pesado
  l_b1: { num: 8, name: "B1", phone: "+8", assignedTo: "setter_b", importedAt: t(30), lastContactAt: tHours(2), callLog: cl(tHours(2)) },
  l_b_prev1: { num: 9, name: "Bp1", phone: "+9", assignedTo: "setter_b", importedAt: t(30), lastContactAt: tHours(26), callLog: cl(tHours(26)) },
  l_b_prev2: { num: 10, name: "Bp2", phone: "+10", assignedTo: "setter_b", importedAt: t(30), lastContactAt: tHours(28), callLog: cl(tHours(28)) },
  l_b_prev3: { num: 11, name: "Bp3", phone: "+11", assignedTo: "setter_b", importedAt: t(30), lastContactAt: tHours(32), callLog: cl(tHours(32)) },
  l_b_prev4: { num: 12, name: "Bp4", phone: "+12", assignedTo: "setter_b", importedAt: t(30), lastContactAt: tHours(36), callLog: cl(tHours(36)) },
  l_b_prev5: { num: 13, name: "Bp5", phone: "+13", assignedTo: "setter_b", importedAt: t(30), lastContactAt: tHours(44), callLog: cl(tHours(44)) },

  // setter_c: ninguna llamada reciente, ultima hace 30 dias → inactivo
  l_c_old: { num: 14, name: "Cold", phone: "+14", assignedTo: "setter_c", importedAt: t(45), lastContactAt: t(30), callLog: cl(t(30), "no_answer", 0) },
};

fs.writeFileSync(
  path.join(tmpData, "setters.json"),
  JSON.stringify({
    setters: [
      { id: "setter_a", name: "SetterA" },
      { id: "setter_b", name: "SetterB" },
      { id: "setter_c", name: "SetterC" },
    ],
    variants: [],
    leads,
    calendar: [],
    sessions: [],
  }, null, 2)
);

const { app } = await import("../index.js");

let adminCookie = "";
let superCookie = "";
let setterCookie = "";

async function loginCookie(email, password) {
  const r = await request(app).post("/api/auth/login").send({ email, password });
  expect(r.status).toBe(200);
  const cookies = r.headers["set-cookie"] || [];
  const sess = cookies.find((c) => c.startsWith("gs_session=")) || "";
  return sess.split(";")[0];
}

beforeAll(async () => {
  adminCookie = await loginCookie("admin-tp@local.test", "tppass1234");
  superCookie = await loginCookie("super-tp@local.test", "superpass");
  setterCookie = await loginCookie("setter-tp@local.test", "setterpass");
});

afterAll(() => {
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
});

describe("RBAC", () => {
  it("setter no accede a /team-performance (403)", async () => {
    const r = await request(app).get("/api/setters/team-performance").set("Cookie", setterCookie);
    expect(r.status).toBe(403);
  });
  it("supervisor accede", async () => {
    const r = await request(app).get("/api/setters/team-performance").set("Cookie", superCookie);
    expect(r.status).toBe(200);
  });
  it("admin accede", async () => {
    const r = await request(app).get("/api/setters/team-performance").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
  });
});

describe("Shape y agregaciones", () => {
  it("perSetter tiene los 3 setters con current/previous/deltas/alerts", async () => {
    const r = await request(app).get("/api/setters/team-performance?period=day").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.perSetter.length).toBe(3);
    for (const s of r.body.perSetter) {
      expect(s).toHaveProperty("current");
      expect(s).toHaveProperty("previous");
      expect(s).toHaveProperty("deltas");
      expect(Array.isArray(s.alerts)).toBe(true);
    }
  });

  it("teamAverages calcula promedios solo de setters activos (total > 0)", async () => {
    const r = await request(app).get(`/api/setters/team-performance?${DAY_RANGE}`).set("Cookie", adminCookie);
    expect(r.body.teamAverages).toHaveProperty("total");
    // setter_a (5) + setter_b (1) = 6 / 2 setters activos = 3
    expect(r.body.teamAverages.total).toBe(3);
  });

  it("perSetter incluye followupsToday y followupsOverdue (numeros)", async () => {
    const r = await request(app).get("/api/setters/team-performance?period=day").set("Cookie", adminCookie);
    for (const s of r.body.perSetter) {
      expect(typeof s.followupsToday).toBe("number");
      expect(typeof s.followupsOverdue).toBe("number");
      expect(s.followupsToday).toBeGreaterThanOrEqual(0);
      expect(s.followupsOverdue).toBeGreaterThanOrEqual(0);
    }
  });

  it("alertConfig devuelve followupsTodayThreshold con default 15", async () => {
    const r = await request(app).get("/api/setters/team-performance?period=day").set("Cookie", adminCookie);
    expect(r.body.alertConfig).toHaveProperty("followupsTodayThreshold");
    expect(r.body.alertConfig.followupsTodayThreshold).toBe(15);
  });
});

describe("Alertas automáticas", () => {
  it("setter_b genera alerta drop (1 vs 5 = -80%, umbral default 30%)", async () => {
    const r = await request(app).get(`/api/setters/team-performance?${DAY_RANGE}`).set("Cookie", adminCookie);
    const alerts = r.body.alerts.filter((a) => a.setterId === "setter_b");
    const drop = alerts.find((a) => a.type === "drop");
    expect(drop).toBeTruthy();
    expect(drop.severity).toBe("high");
  });

  it("setter_c genera alerta inactivity (sin contacto > 7 días)", async () => {
    const r = await request(app).get("/api/setters/team-performance?period=day").set("Cookie", adminCookie);
    const alerts = r.body.alerts.filter((a) => a.setterId === "setter_c");
    const inact = alerts.find((a) => a.type === "inactivity");
    expect(inact).toBeTruthy();
  });

  it("setter_a sin alertas (total estable, actividad reciente)", async () => {
    const r = await request(app).get(`/api/setters/team-performance?${DAY_RANGE}`).set("Cookie", adminCookie);
    const alerts = r.body.alerts.filter((a) => a.setterId === "setter_a");
    expect(alerts.length).toBe(0);
  });

  it("alertas ordenadas por severity (high → medium → low)", async () => {
    const r = await request(app).get("/api/setters/team-performance?period=day").set("Cookie", adminCookie);
    const sevOrder = { high: 0, medium: 1, low: 2 };
    for (let i = 1; i < r.body.alerts.length; i++) {
      expect(sevOrder[r.body.alerts[i - 1].severity]).toBeLessThanOrEqual(sevOrder[r.body.alerts[i].severity]);
    }
  });
});

describe("Alert config", () => {
  it("GET admin/supervisor lee config", async () => {
    const r1 = await request(app).get("/api/setters/alert-config").set("Cookie", adminCookie);
    expect(r1.status).toBe(200);
    expect(r1.body.dropPctThreshold).toBe(30);
    const r2 = await request(app).get("/api/setters/alert-config").set("Cookie", superCookie);
    expect(r2.status).toBe(200);
  });

  it("PUT solo admin puede editar (supervisor 403)", async () => {
    const r = await request(app).put("/api/setters/alert-config").set("Cookie", superCookie).send({ dropPctThreshold: 50 });
    expect(r.status).toBe(403);
  });

  it("PUT admin actualiza umbrales válidos", async () => {
    const r = await request(app).put("/api/setters/alert-config").set("Cookie", adminCookie).send({ dropPctThreshold: 50, inactivityDays: 14 });
    expect(r.status).toBe(200);
    expect(r.body.dropPctThreshold).toBe(50);
    expect(r.body.inactivityDays).toBe(14);
  });

  it("PUT con valores fuera de rango ignora pero acepta los válidos", async () => {
    const r = await request(app).put("/api/setters/alert-config").set("Cookie", adminCookie).send({ dropPctThreshold: 999, aperturaPctMin: 25 });
    // 999 fuera de rango -> no aplica, pero aperturaPctMin sí
    expect(r.status).toBe(200);
    expect(r.body.aperturaPctMin).toBe(25);
  });

  it("subir umbral drop a 90% → setter_b ya no genera alerta drop", async () => {
    await request(app).put("/api/setters/alert-config").set("Cookie", adminCookie).send({ dropPctThreshold: 90 });
    const r = await request(app).get(`/api/setters/team-performance?${DAY_RANGE}`).set("Cookie", adminCookie);
    const dropB = r.body.alerts.find((a) => a.setterId === "setter_b" && a.type === "drop");
    // 1 vs 5 = -80%, ahora umbral 90% → ya NO alerta
    expect(dropB).toBeUndefined();
  });

  it("PUT followupsTodayThreshold actualiza el config", async () => {
    const r = await request(app).put("/api/setters/alert-config").set("Cookie", adminCookie).send({ followupsTodayThreshold: 30 });
    expect(r.status).toBe(200);
    expect(r.body.followupsTodayThreshold).toBe(30);
    const team = await request(app).get("/api/setters/team-performance?period=day").set("Cookie", adminCookie);
    expect(team.body.alertConfig.followupsTodayThreshold).toBe(30);
  });
});

// WR-15 (21-REVIEW): la vigencia de la licencia (D-18) la resolvía el FRONTEND
// comparando contra el día del NAVEGADOR (`new Date().getTimezoneOffset()`), mientras
// el reporte usa BUSINESS_TZ (`_reportOnLeave`). Para un admin con la máquina en otro
// huso el badge aparecía/desaparecía un día antes o después que el criterio del
// reporte. Ahora el backend manda el booleano ya resuelto.
describe("D-18 licencia — onLeave resuelto en el backend (WR-15)", () => {
  const M = globalThis.__metricsAudit;
  const ONE = 24 * 60 * 60 * 1000;
  const bizDay = (ts) => M._bizDayStr(ts);
  const perSetter = async (id) => {
    const r = await request(app).get("/api/setters/team-performance?period=day").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    return r.body.perSetter.find((s) => s.id === id);
  };

  it("licencia futura → onLeave true; vencida → false; el último día INCLUSIVE → true", async () => {
    const set = (v) => request(app).patch("/api/setters/team/setter_a").set("Cookie", adminCookie).send({ leaveUntil: v });

    await set(bizDay(Date.now() + 3 * ONE));
    let s = await perSetter("setter_a");
    expect(s.onLeave).toBe(true);
    expect(s.leaveUntil).toBe(bizDay(Date.now() + 3 * ONE));

    // Hoy en TZ de negocio: `leaveUntil` es inclusive, así que sigue de licencia.
    await set(bizDay(Date.now()));
    s = await perSetter("setter_a");
    expect(s.onLeave).toBe(true);

    await set(bizDay(Date.now() - ONE));
    s = await perSetter("setter_a");
    expect(s.onLeave).toBe(false);
    expect(s.leaveUntil).toBe(bizDay(Date.now() - ONE));   // el dato sigue viajando

    await set(null);
    s = await perSetter("setter_a");
    expect(s.onLeave).toBe(false);
    expect(s.leaveUntil).toBe(null);
  });

  it("un setter sin licencia trae onLeave false (no undefined)", async () => {
    const s = await perSetter("setter_c");
    expect(s.onLeave).toBe(false);
  });
});

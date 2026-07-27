// Phase 19 (REP-01/02/03) + Phase 21 (D-13/D-20/WR-01/WR-02) — Regresión del
// reporte semanal.
//
// ⚠️ VENTANA CAMBIADA EN PHASE 21 (D-13, 2026-07-26): el semanal pasó de salir los
// LUNES 8am cubriendo "la semana pasada completa" a salir el DOMINGO 23:00
// cubriendo "la semana que termina ese día" (lunes → ahora). Motivo: sale en el
// mismo momento que el último diario de la semana, un solo momento y un solo
// reporte por las dos vías (mail HTML detallado + versión corta al grupo de
// WhatsApp). Los fixtures de fechas y de llamadas de este archivo se movieron a la
// ventana nueva; si algún test de acá falla por fechas, NO se revierte la feature.
//
// Cubre además el bug histórico de los 16 mails del lunes: el cron corría cada hora
// y un ReferenceError (`now` fantasma) hacía que el anti-duplicado nunca persistiera
// → cada tick horario re-mandaba el mail. Ahora el anti-duplicado es el guard por
// PERÍODO CUBIERTO (D-28, `weeklyState.lastWeeklyPeriodKey`) más un guard gemelo en
// memoria (WR-03). WR-01: un envío manual de prueba ya NO suprime el automático.
//
// Los tests del cron usan sendFn FAKE inyectado (patrón campaignEngineTick,
// regla #72) — ningún test pega a Resend (RESEND_API_KEY="" definida-vacía,
// regla #121: NUNCA delete, dotenv repone las borradas).

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `weekly-report-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-wr@local.test";
process.env.ADMIN_PASSWORD = "wrpass1234";
process.env.JWT_SECRET = "test-secret-wr";
process.env.BUSINESS_TZ = "America/Argentina/Buenos_Aires"; // -03, sin DST
process.env.RESEND_API_KEY = ""; // regla #121: definida-VACÍA, jamás delete
process.env.REPORT_EMAILS = "";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}
fs.writeFileSync(path.join(tmpData, "auth.json"), JSON.stringify({
  users: [
    { id: "u_admin", email: "admin-wr@local.test", name: "AdminWR", role: "admin", status: "active", setterId: "", password: pwd("wrpass1234") },
    { id: "u_v", email: "v-wr@local.test", name: "Vendedora", role: "setter", status: "active", setterId: "s_v", password: pwd("vpass123456") },
    { id: "u_ign", email: "ign-wr@local.test", name: "Ignacio", role: "setter", status: "active", setterId: "setter_ignacio", password: pwd("ipass123456") },
  ], invites: [], sessions: [],
}, null, 2));
fs.writeFileSync(path.join(tmpData, "setters.json"), JSON.stringify({
  setters: [{ id: "s_v", name: "Vendedora" }, { id: "setter_ignacio", name: "Ignacio" }],
  variants: [], leads: {}, calendar: [], sessions: [],
}, null, 2));

const { app } = await import("../index.js");
const W = globalThis.__weeklyReport;
const M = globalThis.__metricsAudit;
const iso = (t) => new Date(t).toISOString();

// ── Fechas fijas determinísticas ──
// 2026-07-19, 2026-07-26 y 2026-08-02 son DOMINGOS reales. Ojo: las 23:00 AR de un
// domingo son las 02:00 UTC del lunes siguiente (-03) — por eso todos los Date.UTC
// de abajo caen en un lunes: ese ES el caso TZ que el cron tiene que resolver bien.
const SUN23 = Date.UTC(2026, 6, 27, 2, 0, 0);    // dom 26/07 23:00 AR (dentro de ventana)
const SUN22 = Date.UTC(2026, 6, 27, 1, 0, 0);    // dom 26/07 22:00 AR (antes de las 23)
const MON12 = Date.UTC(2026, 6, 27, 15, 0, 0);   // lun 27/07 12:00 AR (fuera: ya no es lunes)
const PREVSUN = Date.UTC(2026, 6, 20, 2, 0, 0);  // dom 19/07 23:00 AR
const NEXTSUN = Date.UTC(2026, 7, 3, 2, 0, 0);   // dom 02/08 23:00 AR
const HOUR = 3600 * 1000;
const HALFHOUR = 30 * 60 * 1000;

function resetReportsState() {
  fs.rmSync(path.join(tmpData, "reports.json"), { force: true });
  W._resetPeriodMem();   // WR-03: el guard en memoria sobrevive a borrar el archivo
}
// Fake sender: cuenta invocaciones y captura los destinatarios recibidos.
const mkSend = (result = { sent: true }) => {
  const calls = [];
  const fn = async (to) => { calls.push(to); return result; };
  fn.calls = calls;
  return fn;
};
const queued = (kind = "weekly") => (W.loadReportsState().queue || []).filter((i) => i.kind === kind);

let adminCookie = "";
// ── Relojes del fixture, a nivel módulo ──
// Todo lo que se inyecta sale de acá, así el dato y el reloj no se pueden separar
// (ver el comentario largo de WR-12).
const FIXTURE_NOW = Date.now();
// Lunes 00:00 de la semana en curso, en TZ de negocio.
const FIXTURE_MONDAY = (() => {
  const todayStart = M._bizStartOfDay(FIXTURE_NOW);
  return todayStart - ((M._bizDayOfWeek(todayStart) || 7) - 1) * 86400000;
})();
// Llamada "de esta semana". `now - 60s` cae en la semana ANTERIOR si la suite
// corre en el primer minuto del lunes — ahí se usa un instante apenas posterior
// a la medianoche. Sin esto el archivo entero falla ~60 segundos por semana.
const FIXTURE_THIS_WEEK = Math.max(FIXTURE_MONDAY + 3000, FIXTURE_NOW - 60000);
// Último instante de la semana ANTERIOR (domingo 23:59). NO sirve `now - 7d`:
// buildWeeklyReportData capa la ventana en el reloj que recibe, así que un reloj
// del lunes a la madrugada devuelve una "semana" de minutos.
const FIXTURE_PREV_WEEK_END = FIXTURE_MONDAY - 60000;

beforeAll(async () => {
  const a = await request(app).post("/api/auth/login").send({ email: "admin-wr@local.test", password: "wrpass1234" });
  adminCookie = (a.headers["set-cookie"] || []).find((c) => c.startsWith("gs_session=")).split(";")[0];

  // Fixture de llamadas DENTRO de la semana que termina hoy (D-13: [este lunes,
  // ahora]) + una de la semana anterior para que `previous` no quede vacío.
  // Se usan offsets NEGATIVOS desde `now`: cualquier hora futura del día quedaría
  // fuera de la ventana (toTs está capado a `now`).
  const thisMonday = FIXTURE_MONDAY;
  const thisWeekTs = FIXTURE_THIS_WEEK;           // dentro de la semana en curso, siempre
  const lastWeekTs = thisMonday - 3 * 86400000;   // viernes pasado

  // Reescritura post-import: los loaders leen de disco en cada llamada (patrón
  // establecido en metrics-timezone-attribution.test.js).
  fs.writeFileSync(path.join(tmpData, "setters.json"), JSON.stringify({
    setters: [{ id: "s_v", name: "Vendedora" }, { id: "setter_ignacio", name: "Ignacio" }, { id: "s_nueva", name: "Nueva" }],
    variants: [],
    leads: {
      l1: {
        num: 1, name: "L1", phone: "+5215550000001", assignedTo: "s_v",
        conexion: "sin_wsp", estado: "sin_contactar",
        callLog: [
          { ts: iso(thisWeekTs), outcome: "answered_interested", by: "u_v", channel: "telnyx_webrtc", duration: 60 },
          { ts: iso(thisWeekTs - 1000), outcome: "hung_up", by: "u_v", channel: "telnyx_webrtc", duration: 5 },
          { ts: iso(thisWeekTs - 2000), outcome: "no_answer", by: "u_v", channel: "telnyx_webrtc" },
          // Semana anterior → alimenta `previous`, NO la semana actual.
          { ts: iso(lastWeekTs), outcome: "answered_interested", by: "u_v", channel: "telnyx_webrtc", duration: 120 },
        ],
      },
      l2: {
        num: 2, name: "L2", phone: "+5215550000002", assignedTo: "setter_ignacio",
        conexion: "sin_wsp", estado: "sin_contactar",
        callLog: [
          // Llamada de Ignacio (admin-only) — NO debe contar en el reporte.
          { ts: iso(thisWeekTs), outcome: "answered_interested", by: "u_ign", channel: "telnyx_webrtc", duration: 120 },
        ],
      },
    },
    calendar: [], sessions: [],
  }, null, 2));
});
afterAll(() => { try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {} });

describe("cron semanal — ventana domingo 23:00 en TZ de negocio (REP-01 + D-13)", () => {
  it("lunes 12:00 AR → fuera_de_ventana, sendFn no llamado", async () => {
    resetReportsState();
    const send = mkSend();
    const r = await W.maybeRunWeeklyReportCron(MON12, send);
    expect(r).toEqual({ ran: false, reason: "fuera_de_ventana" });
    expect(send.calls.length).toBe(0);
  });

  it("domingo 22:00 AR (antes de las 23) → fuera_de_ventana", async () => {
    resetReportsState();
    const send = mkSend();
    const r = await W.maybeRunWeeklyReportCron(SUN22, send);
    expect(r).toEqual({ ran: false, reason: "fuera_de_ventana" });
    expect(send.calls.length).toBe(0);
  });

  it("TZ: lunes 02:00 UTC = domingo 23:00 AR → dentro de ventana", async () => {
    resetReportsState();
    const send = mkSend();
    const r = await W.maybeRunWeeklyReportCron(PREVSUN, send);
    expect(r.ran).toBe(true);
    expect(r.sent).toBe(true);
    expect(send.calls.length).toBe(1);
  });

  it("el bug de los 16 mails: primer tick del domingo manda, el segundo da ya_enviado", async () => {
    resetReportsState();
    const send = mkSend();
    const r1 = await W.maybeRunWeeklyReportCron(SUN23, send);
    expect(r1.ran).toBe(true);
    expect(r1.sent).toBe(true);
    // Anti-duplicado por PERÍODO CUBIERTO (D-28), no por ventana de 6 días (WR-01).
    expect(W.loadReportsState().weeklyState.lastWeeklyPeriodKey).toBe("2026-07-26");
    expect(W.loadReportsState().lastWeeklyReportAt).toBe(new Date(SUN23).toISOString());
    // Otro tick del MISMO domingo (23:30): guard persistido.
    const r2 = await W.maybeRunWeeklyReportCron(SUN23 + HALFHOUR, send);
    expect(r2).toEqual({ ran: false, reason: "ya_enviado" });
    expect(send.calls.length).toBe(1);           // exactamente UN mail, no 16
    expect(queued("weekly").length).toBe(1);     // y UN solo mensaje al grupo
  });

  it("el domingo SIGUIENTE (+7 días) vuelve a mandar", async () => {
    resetReportsState();
    W.saveReportsState({ weeklyState: { lastWeeklyPeriodKey: "2026-07-26" } });
    const send = mkSend();
    const r = await W.maybeRunWeeklyReportCron(NEXTSUN, send);
    expect(r.ran).toBe(true);
    expect(r.sent).toBe(true);
    expect(send.calls.length).toBe(1);
  });

  it("fallo de envío NO consume el período → el próximo tick reintenta el mail", async () => {
    resetReportsState();
    const failSend = mkSend({ sent: false, reason: "x" });
    const r1 = await W.maybeRunWeeklyReportCron(SUN23, failSend);
    expect(r1.ran).toBe(true);
    expect(r1.sent).toBe(false);
    expect(W.loadReportsState().lastWeeklyReportAt).toBeUndefined();
    expect(W.loadReportsState().weeklyState.lastWeeklyPeriodKey).toBe("");
    // D-04: el grupo NO depende del email — el corto ya se encoló igual.
    expect(queued("weekly").length).toBe(1);
    // Reintento media hora después con el envío sano → el mail sale...
    const okSend = mkSend();
    const r2 = await W.maybeRunWeeklyReportCron(SUN23 + HALFHOUR, okSend);
    expect(r2.sent).toBe(true);
    expect(okSend.calls.length).toBe(1);
    // ...y el grupo NO recibe un segundo mensaje del mismo período (D-28).
    expect(queued("weekly").length).toBe(1);
  });

  it("con config.paused el cron no manda ni encola", async () => {
    resetReportsState();
    W.saveReportsState({ config: { paused: true } });
    const send = mkSend();
    const r = await W.maybeRunWeeklyReportCron(SUN23, send);
    expect(r).toEqual({ ran: false, reason: "pausado" });
    expect(send.calls.length).toBe(0);
    expect(queued("weekly").length).toBe(0);
  });
});

describe("WR-01 — un envío manual de prueba NO suprime el automático", () => {
  it("el endpoint manual escribe lastManualWeeklySendAt, no el guard del cron", async () => {
    resetReportsState();
    // Stub acotado de Resend: el endpoint manual solo persiste si el mail SALE.
    const realFetch = globalThis.fetch;
    process.env.RESEND_API_KEY = "test-key-wr";
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ id: "email_fake" }) });
    try {
      const r = await request(app).post("/api/admin/weekly-report/send")
        .set("Cookie", adminCookie).send({ to: "socio@x.com" });
      expect(r.status).toBe(200);
      const s = W.loadReportsState();
      expect(s.lastManualWeeklySendAt).toBeTruthy();
      expect(s.lastWeeklyReportAt).toBeUndefined();             // ya no es el guard
      expect(s.weeklyState.lastWeeklyPeriodKey).toBe("");       // período intacto
    } finally {
      globalThis.fetch = realFetch;
      process.env.RESEND_API_KEY = "";
    }
    // ...y el cron del domingo siguiente manda igual.
    const send = mkSend();
    const r2 = await W.maybeRunWeeklyReportCron(SUN23, send);
    expect(r2.sent).toBe(true);
    expect(send.calls.length).toBe(1);
  });

  it("un lastWeeklyReportAt reciente (el guard viejo) ya no bloquea el cron", async () => {
    resetReportsState();
    // Exactamente el estado que dejaba el endpoint manual antes de WR-01: un envío
    // de hace 2 días. Con la ventana de 6 días esto suprimía el automático.
    W.saveReportsState({ lastWeeklyReportAt: new Date(SUN23 - 2 * 24 * HOUR).toISOString() });
    const send = mkSend();
    const r = await W.maybeRunWeeklyReportCron(SUN23, send);
    expect(r.ran).toBe(true);
    expect(r.sent).toBe(true);
  });
});

describe("destinatarios — REPORT_EMAILS CSV con fallback (REP-02 + WR-02)", () => {
  it("_reportRecipients parsea el CSV con espacios y cae a ADMIN_EMAIL si está vacío", () => {
    process.env.REPORT_EMAILS = " a@x.com , b@x.com ";
    expect(W._reportRecipients()).toEqual(["a@x.com", "b@x.com"]);
    process.env.REPORT_EMAILS = "";
    expect(W._reportRecipients()).toEqual(["admin-wr@local.test"]);
  });

  it("WR-02: deduplica repetidos y cae a ADMIN_EMAIL si el CSV no trae emails válidos", () => {
    try {
      process.env.REPORT_EMAILS = "a@x.com, a@x.com , b@x.com";
      expect(W._reportRecipients()).toEqual(["a@x.com", "b@x.com"]);
      // El error típico: separar con `;` → un solo token inválido.
      process.env.REPORT_EMAILS = "a@x.com;b@x.com";
      expect(W._reportRecipients()).toEqual(["admin-wr@local.test"]);
    } finally {
      process.env.REPORT_EMAILS = "";
    }
  });

  it("el cron entrega el array de REPORT_EMAILS al sender", async () => {
    resetReportsState();
    process.env.REPORT_EMAILS = "a@x.com,b@x.com";
    try {
      const send = mkSend();
      const r = await W.maybeRunWeeklyReportCron(SUN23, send);
      expect(r.sent).toBe(true);
      expect(send.calls[0]).toEqual(["a@x.com", "b@x.com"]);
      expect(r.to).toEqual(["a@x.com", "b@x.com"]);
    } finally {
      process.env.REPORT_EMAILS = "";
    }
  });
});

describe("shape del reporte — ventana nueva, sin WSP, sin admin-only (REP-03 + D-13/D-20)", () => {
  it("buildWeeklyReportData: la semana que termina hoy, la anterior en `previous`", () => {
    const d = W.buildWeeklyReportData();
    expect("wsp" in d).toBe(false);
    // 3 llamadas de la Vendedora ESTA semana; la de Ignacio (admin-only) NO cuenta,
    // y la del viernes pasado tampoco (está en `previous`).
    expect(d.calls.totalWeek).toBe(3);
    // Connects canónicos: answered_interested + hung_up (no_answer no es connect).
    expect(d.calls.answeredWeek).toBe(2);
    expect(d.previous.dials).toBe(1);
    expect(d.previous.connects).toBe(1);
    expect(d.previous.interested).toBe(1);
    expect(d.perSetter.length).toBe(1);
    expect(d.perSetter[0].name).toBe("Vendedora");
    expect(d.perSetter[0].llamadas).toBe(3);
    expect(d.perSetter[0].atendidas).toBe(2);
    expect(d.perSetter.some((s) => s.name === "Ignacio")).toBe(false);
  });

  // WR-12 (21-REVIEW): `maybeRunWeeklyReportCron(nowTs)` usaba el reloj inyectado para
  // la ventana y el `periodKey`, pero `buildWeeklyReportData()` resolvía la semana con
  // `Date.now()` — el periodKey y el contenido podían describir semanas distintas.
  //
  // ⚠️ Este test usaba los relojes ABSOLUTOS SUN23/PREVSUN (dom 26/07 23:00 y dom
  // 19/07 23:00) contra un fixture cuyos timestamps son RELATIVOS a `Date.now()`.
  // Los dos relojes solo coinciden mientras la corrida caiga dentro de la semana
  // 20–26/07 y antes de las 23:00 del domingo: pasado ese borde, las llamadas del
  // fixture quedan en el FUTURO respecto del reloj inyectado y el test falla para
  // siempre (no era flaky — se rompió el 26/07 a las 23:00). Ahora los dos relojes
  // salen de la misma base relativa, así que el test es determinístico cualquier
  // día y a cualquier hora. Sigue probando lo mismo: que los datos se muevan con
  // el reloj inyectado y no con el real.
  it("WR-12: buildWeeklyReportData acepta nowTs y los datos se mueven con él", () => {
    const semanaAnteriorTs = FIXTURE_PREV_WEEK_END;

    const actual = W.buildWeeklyReportData(FIXTURE_NOW);
    expect(actual.period.to).toBe(M._bizDayStr(FIXTURE_NOW));
    expect(actual.calls.totalWeek).toBe(3);
    expect(actual.previous.dials).toBe(1);                   // la del viernes anterior

    // Con el reloj de la semana ANTERIOR, la llamada del viernes pasado pasa a ser la
    // semana ACTUAL y las 3 de esta semana quedan en el futuro (fuera de la ventana).
    const anterior = W.buildWeeklyReportData(semanaAnteriorTs);
    expect(anterior.period.to).toBe(M._bizDayStr(semanaAnteriorTs));
    expect(anterior.period.to < actual.period.to).toBe(true);
    expect(anterior.calls.totalWeek).toBe(1);
    expect(anterior.calls.interested).toBe(1);
    // Y el corto describe ESA semana, no la del reloj real. Se afirma sobre el día
    // de CIERRE y no sobre el encabezado entero a propósito: el formato comprime el
    // mes cuando la semana no lo cruza ("Semana 13–19/07") y lo repite cuando sí
    // ("Semana 27/07–02/08"), así que reimplementar el formato acá solo agrega una
    // segunda fuente de verdad que se desincroniza.
    const dd = (s) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
    const short = W.buildWeeklyReportTextShort(anterior);
    expect(short.startsWith("*Semana ")).toBe(true);
    expect(short).toContain(dd(anterior.period.to));
    expect(short).not.toContain(dd(actual.period.to));
  });

  it("extensión aditiva D-20: minutos, interesados y sin arrancar", () => {
    const d = W.buildWeeklyReportData();
    expect(d.calls.minutes).toBe(1);                 // 60s + 5s atendidos → 1 min
    expect(d.calls.interested).toBe(1);
    expect(d.perSetter[0].minutos).toBe(1);
    expect(d.perSetter[0].interesados).toBe(1);
    // "Nueva" nunca llamó; Ignacio es admin-only y no aparece.
    expect(d.neverStarted).toContain("Nueva");
    expect(d.neverStarted).not.toContain("Ignacio");
    expect(d.neverStarted).not.toContain("Vendedora");
    // Claves de Phase 19 intactas (buildWeeklyReportHtml las usa).
    expect(d.calls.scheduledWeek).toBe(0);
    expect(d.calls.deadWeek).toBe(0);
    expect(d.calls.pctAtendidas).toBe("66.7");
    expect(d.perSetter[0].leadsAsignados).toBe(1);
    expect(d.perSetter[0].agendadosLlamada).toBe(0);
  });

  it("buildWeeklyReportHtml: sin sección WhatsApp y sin Ignacio", () => {
    const d = W.buildWeeklyReportData();
    const html = W.buildWeeklyReportHtml(d);
    expect(html).not.toMatch(/WhatsApp/);
    expect(html).not.toMatch(/Conexiones/);
    expect(html).not.toContain("Ignacio");
    expect(html).toContain("Vendedora");
  });

  it("D-23 bajó del diario al semanal: sin marcar acumulado de la semana", () => {
    // El fixture de pending_calls se escribe al vuelo: el loader lee de disco.
    fs.writeFileSync(path.join(tmpData, "pending_calls.json"), JSON.stringify({ pending: [
      { id: "p1", leadId: "l1", setterId: "s_v", startedAt: iso(FIXTURE_THIS_WEEK), endedAt: null },
      { id: "p2", leadId: "l2", setterId: "s_v", startedAt: iso(FIXTURE_THIS_WEEK - 1000), endedAt: null },
      // De la semana ANTERIOR → fuera de la ventana.
      { id: "p3", leadId: "l3", setterId: "s_v", startedAt: iso(FIXTURE_PREV_WEEK_END), endedAt: null },
      // Setter admin-only → jamás en el reporte (REP-09).
      { id: "p4", leadId: "l4", setterId: "setter_ignacio", startedAt: iso(FIXTURE_THIS_WEEK), endedAt: null },
    ] }, null, 2));
    const d = W.buildWeeklyReportData(FIXTURE_NOW);
    expect(d.unmarked).toEqual([{ name: "Vendedora", count: 2 }]);
    expect(W.buildWeeklyReportTextShort(d)).toContain("_Sin marcar en la semana: Vendedora 2_");
    // Sin pendientes, la línea no aparece (regla de cero métricas en cero).
    fs.writeFileSync(path.join(tmpData, "pending_calls.json"), JSON.stringify({ pending: [] }, null, 2));
    const limpio = W.buildWeeklyReportData(FIXTURE_NOW);
    expect(limpio.unmarked).toEqual([]);
    expect(W.buildWeeklyReportTextShort(limpio)).not.toContain("Sin marcar");
  });

  it("buildWeeklyReportTextShort: molde D-20 con datos reales del fixture", () => {
    const d = W.buildWeeklyReportData();
    const t = W.buildWeeklyReportTextShort(d, { emailSent: true });
    expect(t.startsWith("*Semana ")).toBe(true);
    expect(t).toContain("Equipo 3 llam · 2 at (67%)");
    // D-20: el cero de reuniones SE MUESTRA (es la noticia).
    expect(t).toContain("0 reuniones agendadas");
    // El segmento "activa" (tiempo de trabajo telefónico, bloques de 15 min con
    // al menos una llamada) se sumó el 2026-07-26 a pedido del user, en el diario
    // y en el semanal con el MISMO criterio. Las 3 llamadas del fixture caen en 2
    // bloques distintos → 30min.
    // 2026-07-27: los interesados salieron de la fila (wrappeaba en el celular) y
    // van en su propia línea del pie, igual que en el diario.
    expect(t).toContain(`*Vendedora* 3 llam · 2 at · 1 min · ${W._reportDuration(d.perSetter[0].activeMinutes)} activa`);
    expect(t).toContain("_Interesados: Vendedora 1_");
    // La semana previa se nombra con FECHAS, no como "Semana anterior" (ambiguo
    // cuando el reporte sale con atraso).
    expect(t).not.toContain("Semana anterior");
    expect(t).toMatch(/_Semana \d{2}[–-]\d{2}\/\d{2}: 1 llam/);
    expect(t).toContain(" activa");   // también en la línea del equipo
    expect(t).toMatch(/_Semana [\d–\-/]+: 1 llam · 1 at \(100%\) · 1 int_/);
    expect(t).toContain("_Sin arrancar: Nueva_");
    expect(t).toContain("_Detalle completo en el mail._");
    expect(t).not.toContain("Ignacio");
    // Sin mail entregado, la línea del mail NO puede aparecer (D-04).
    expect(W.buildWeeklyReportTextShort(d)).not.toContain("Detalle completo en el mail");
  });
});

describe("persistencia — round-trip export/import de reports.json", () => {
  it("export-data incluye el bloque reports con el estado guardado", async () => {
    W.saveReportsState({ lastWeeklyReportAt: "2026-07-27T12:00:00.000Z" });
    const r = await request(app).get("/api/admin/export-data").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.reports.lastWeeklyReportAt).toBe("2026-07-27T12:00:00.000Z");
  });

  it("import-data restaura reports.json borrado", async () => {
    resetReportsState();
    const r = await request(app)
      .post("/api/admin/import-data")
      .set("Cookie", adminCookie)
      .send({ reports: { lastWeeklyReportAt: "2026-07-27T12:00:00.000Z" } });
    expect(r.status).toBe(200);
    expect(r.body.restored).toContain("reports");
    expect(W.loadReportsState().lastWeeklyReportAt).toBe("2026-07-27T12:00:00.000Z");
  });
});

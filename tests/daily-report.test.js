// Phase 21 (REP-04/05/09/10) — Regresión del reporte DIARIO y del molde D-19.
//
// Cubre: el corte del día en TZ de negocio (23:30 AR del 22/07 no arrastra
// llamadas del 23/07 UTC), la exclusión de los setters admin-only y ocultos
// (REP-09), los cuatro estados de vendedora (nunca arrancó / sin actividad hoy /
// escalada a 5 hábiles / de licencia con vencimiento), las señales del día
// (interesados, canal manual, discadas sin marcar, llamadas sin atribuir) y el
// molde de texto plano validado por el user — incluido el invariante "cero
// métricas en cero".
//
// Los builders reciben `nowTs` por parámetro (por eso `_ccResolveRange` acepta
// `now` inyectable): NO se usan fake timers. Las API keys van definidas-VACÍAS,
// nunca `delete` (regla #121 — dotenv repone las borradas en cada import).

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `daily-report-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-dr@local.test";
process.env.ADMIN_PASSWORD = "drpass1234";
process.env.JWT_SECRET = "test-secret-dr";
process.env.BUSINESS_TZ = "America/Argentina/Buenos_Aires"; // -03, sin DST
process.env.RESEND_API_KEY = ""; // regla #121: definida-VACÍA, jamás delete
process.env.REPORT_EMAILS = "";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}

const AUTH = {
  users: [
    { id: "u_admin", email: "admin-dr@local.test", name: "AdminDR", role: "admin", status: "active", setterId: "", password: pwd("drpass1234") },
    { id: "u_bren", email: "bren-dr@local.test", name: "Brenda", role: "setter", status: "active", setterId: "s_bren", password: pwd("brenpass1234") },
    { id: "u_jud", email: "jud-dr@local.test", name: "Judith", role: "setter", status: "active", setterId: "s_jud", password: pwd("judpass1234") },
    { id: "u_ter", email: "ter-dr@local.test", name: "Teresa", role: "setter", status: "active", setterId: "s_ter", password: pwd("terpass1234") },
    { id: "u_hid", email: "hid-dr@local.test", name: "Oculta", role: "setter", status: "active", setterId: "s_hid", password: pwd("hidpass1234") },
    { id: "u_ign", email: "ign-dr@local.test", name: "Ignacio", role: "setter", status: "active", setterId: "setter_ignacio", password: pwd("ignpass1234") },
  ],
  invites: [], sessions: [],
};
fs.writeFileSync(path.join(tmpData, "auth.json"), JSON.stringify(AUTH, null, 2));

// Setters base. Dalia nunca llamó (no tiene user: nunca discó). `s_hid` está
// oculta (fuera del sistema operativo) y `setter_ignacio` es admin-only.
const SETTERS = [
  { id: "s_bren", name: "Brenda" },
  { id: "s_jud", name: "Judith" },
  { id: "s_ter", name: "Teresa" },
  { id: "s_dal", name: "Dalia" },
  { id: "s_hid", name: "Oculta", hidden: true },
  { id: "setter_ignacio", name: "Ignacio" },
];
fs.writeFileSync(path.join(tmpData, "setters.json"), JSON.stringify({
  setters: SETTERS, variants: [], leads: {}, calendar: [], sessions: [],
}, null, 2));

const { app } = await import("../index.js");
const D = globalThis.__dailyReport;
const C = globalThis.__callCore;
const M = globalThis.__metricsAudit;
const P18 = globalThis.__phase18;

const iso = (t) => new Date(t).toISOString();
const HOUR = 3600 * 1000;
const DAY = 86400000;

// ── Fechas fijas determinísticas ──
// 2026-07-27 es lunes real → 2026-07-22 es MIÉRCOLES ("mié 22/07" del molde D-19).
const NOW23 = Date.UTC(2026, 6, 23, 2, 30, 0);   // mié 22/07 23:30 AR (= 23/07 02:30 UTC)
const TODAY = M._bizStartOfDay(NOW23);           // medianoche AR del 22/07
const YEST = TODAY - DAY;                        // mar 21/07 00:00 AR

// Los loaders leen de disco en CADA llamada → cada test declara su mundo entero
// (patrón de metrics-timezone-attribution.test.js / weekly-report.test.js).
function writeFixture({ setters = SETTERS, leads = {}, pending = [], calendar = [] } = {}) {
  fs.writeFileSync(path.join(tmpData, "setters.json"), JSON.stringify({
    setters, variants: [], leads, calendar, sessions: [],
  }, null, 2));
  fs.writeFileSync(path.join(tmpData, "pending_calls.json"), JSON.stringify({ pending }, null, 2));
}
// Lead sintético con un callLog. `by` mapea al user → setter (atribución por
// quién llamó, jamás por assignedTo).
function lead(id, callLog, extra = {}) {
  return {
    [id]: {
      num: 1, name: `L-${id}`, phone: "+5215550000001", assignedTo: "s_bren",
      conexion: "sin_wsp", estado: "sin_contactar", callLog, ...extra,
    },
  };
}
const call = (ts, outcome, by, duration = 0, channel = "telnyx_webrtc") =>
  ({ ts: iso(ts), outcome, by, duration, channel });

// Fixture "canónico" del día: Brenda trabajó, Judith paró hoy, Teresa hace 10
// días, Dalia nunca arrancó, la oculta y Ignacio no existen para el reporte.
const BRENDA_TODAY = [
  call(TODAY + 10 * HOUR, "answered_interested", "u_bren", 600),
  call(TODAY + 11 * HOUR, "hung_up", "u_bren", 20),
  call(TODAY + 12 * HOUR, "no_answer", "u_bren", 0),
  call(TODAY + 13 * HOUR, "answered_not_interested", "u_bren", 700),
];
const JUDITH_YEST = [
  call(YEST + 10 * HOUR, "no_answer", "u_jud", 0),
  call(YEST + 11 * HOUR, "answered_interested", "u_jud", 120),
];
const TERESA_OLD = [call(TODAY - 10 * DAY + 10 * HOUR, "no_answer", "u_ter", 0)];

function canonicalFixture(extra = {}) {
  const { leads: extraLeads = {}, ...rest } = extra;
  writeFixture({
    ...rest,
    leads: {
      ...lead("l_bren", BRENDA_TODAY),
      ...lead("l_jud", JUDITH_YEST),
      ...lead("l_ter", TERESA_OLD),
      ...extraLeads,
    },
  });
}

let adminCookie = "";
beforeAll(async () => {
  const a = await request(app).post("/api/auth/login").send({ email: "admin-dr@local.test", password: "drpass1234" });
  adminCookie = (a.headers["set-cookie"] || []).find((c) => c.startsWith("gs_session=")).split(";")[0];
});
afterAll(() => { try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {} });

describe("rango del día en TZ de negocio (regla #113)", () => {
  it("a las 23:30 AR del 22/07 el día es [medianoche AR, ahora] — la fecha UTC no manda", () => {
    writeFixture({
      leads: lead("l1", [
        // 23/07 01:00 UTC = 22/07 22:00 AR → ES de hoy pese a la fecha UTC.
        call(Date.UTC(2026, 6, 23, 1, 0, 0), "answered_interested", "u_bren", 60),
        // 22/07 02:00 UTC = 21/07 23:00 AR → es de AYER pese a la fecha UTC.
        call(Date.UTC(2026, 6, 22, 2, 0, 0), "answered_interested", "u_bren", 60),
      ]),
    });
    const d = D.buildDailyReportData(NOW23);
    expect(d.dayStr).toBe("2026-07-22");
    expect(d.team.dials).toBe(1);
    expect(d.yesterday.dials).toBe(1);
    expect(d.period.fromTs).toBe(TODAY);
    expect(d.period.toTs).toBe(NOW23);
  });

  it("dayLabel en español y sin punto final: 'mié 22/07'", () => {
    canonicalFixture();
    expect(D.buildDailyReportData(NOW23).dayLabel).toBe("mié 22/07");
    expect(D._reportDayLabel(TODAY)).toBe("mié 22/07");
  });

  it("un día PASADO se agrega entero (no se capa a `now`)", () => {
    canonicalFixture();
    const d = D.buildDailyReportData(NOW23, YEST + 12 * HOUR);
    expect(d.dayStr).toBe("2026-07-21");
    expect(d.team.dials).toBe(2);            // las 2 de Judith de ayer
    expect(d.period.toTs).toBe(TODAY);       // el día entero, no `now`
  });
});

describe("alcance — REP-09 (admin-only) y setters ocultos", () => {
  it("las llamadas de Ignacio/Paula no entran ni en team ni en perSetter", () => {
    canonicalFixture({
      leads: lead("l_ign", [
        call(TODAY + 9 * HOUR, "answered_interested", "u_ign", 900),
        call(TODAY + 9.5 * HOUR, "no_answer", "u_ign", 0),
      ], { assignedTo: "setter_ignacio" }),
    });
    const d = D.buildDailyReportData(NOW23);
    expect(d.team.dials).toBe(4);            // solo las de Brenda
    expect(d.perSetter.map((s) => s.name)).toEqual(["Brenda"]);
    const txt = D.buildDailyReportText(d);
    expect(txt).not.toContain("Ignacio");
    expect(txt).not.toContain("Paula");
  });

  it("un setter con hidden:true no aparece en ninguna lista (tampoco en 'Sin arrancar')", () => {
    canonicalFixture();
    const d = D.buildDailyReportData(NOW23);
    const todos = [
      ...d.perSetter.map((s) => s.name), ...d.neverStarted, ...d.idleToday,
      ...d.escalated.map((e) => e.name), ...d.onLeave, ...d.interested.map((i) => i.name),
    ];
    expect(todos).not.toContain("Oculta");
    expect(todos).not.toContain("Ignacio");
    expect(d.neverStarted).toEqual(["Dalia"]);
  });
});

describe("estados de vendedora — D-14/D-15/D-16/D-18", () => {
  it("D-15: sin ninguna llamada histórica → 'Sin arrancar', nunca 'sin actividad hoy'", () => {
    canonicalFixture();
    const d = D.buildDailyReportData(NOW23);
    expect(d.neverStarted).toContain("Dalia");
    expect(d.idleToday).not.toContain("Dalia");
    expect(d.escalated.map((e) => e.name)).not.toContain("Dalia");
  });

  it("D-14: llamó ayer y hoy no → 'sin actividad hoy'", () => {
    canonicalFixture();
    const d = D.buildDailyReportData(NOW23);
    expect(d.idleToday).toEqual(["Judith"]);
  });

  it("D-16: 5+ días hábiles sin llamar → escala a línea propia con el conteo", () => {
    canonicalFixture();
    const d = D.buildDailyReportData(NOW23);
    expect(d.escalated).toEqual([{ name: "Teresa", days: 10 }]);
    expect(d.idleToday).not.toContain("Teresa");
    expect(D.buildDailyReportText(d)).toContain("_Teresa: 10 días sin llamar_");
  });

  it("_reportWeekdaysSince cuenta solo lun-vie, sin el día de la llamada ni hoy", () => {
    expect(D._reportWeekdaysSince(0, NOW23)).toBe(0);
    expect(D._reportWeekdaysSince(YEST + 10 * HOUR, NOW23)).toBe(0);   // ayer → 0
    expect(D._reportWeekdaysSince(TODAY - 10 * DAY, NOW23)).toBe(7);   // 9 días → 7 hábiles
  });

  // WR-01 (21-REVIEW): el helper cuenta los hábiles ESTRICTAMENTE entre la última
  // llamada y hoy, pero HOY también es un día sin llamar. Sin sumarlo, D-16 ("5 días
  // hábiles seguidos") disparaba al 6to. Hoy es MIÉRCOLES 22/07 en este fixture, así
  // que los 5 hábiles sin llamar son 16, 17, 20, 21 y 22.
  it("WR-01: escala en el 5to día hábil sin llamar, no en el 6to", () => {
    const mkSetters = (lastCallDay) => ({
      setters: [{ id: "s_bren", name: "Brenda" }, { id: "s_ter", name: "Teresa" }],
      leads: {
        ...lead("l_bren", BRENDA_TODAY),
        ...lead("l_ter", [call(lastCallDay + 10 * HOUR, "no_answer", "u_ter", 0)]),
      },
    });
    // Última llamada MIÉ 15/07 → 16, 17, 20, 21 + hoy 22 = 5to hábil → ESCALA.
    writeFixture(mkSetters(TODAY - 7 * DAY));
    const quinto = D.buildDailyReportData(NOW23);
    expect(quinto.escalated).toEqual([{ name: "Teresa", days: 7 }]);
    expect(quinto.idleToday).not.toContain("Teresa");
    // Última llamada JUE 16/07 → 17, 20, 21 + hoy 22 = 4to hábil → todavía NO.
    writeFixture(mkSetters(TODAY - 6 * DAY));
    const cuarto = D.buildDailyReportData(NOW23);
    expect(cuarto.escalated).toEqual([]);
    expect(cuarto.idleToday).toEqual(["Teresa"]);
  });

  it("WR-01: el fin de semana no suma día hábil (sábado no adelanta la escalada)", () => {
    // sáb 25/07 23:30 AR. Última llamada vie 17/07 → hábiles entre: 20,21,22,23,24 = 5
    // y el sábado NO suma. La escalada ya venía dada por esos 5.
    const SAT23 = Date.UTC(2026, 6, 26, 2, 30, 0);
    const satStart = M._bizStartOfDay(SAT23);
    expect(M._bizDayOfWeek(satStart)).toBe(6);
    writeFixture({
      setters: [{ id: "s_ter", name: "Teresa" }],
      leads: lead("l_ter", [call(satStart - 8 * DAY + 10 * HOUR, "no_answer", "u_ter", 0)]),
    });
    const d = D.buildDailyReportData(SAT23);
    expect(d.escalated).toEqual([{ name: "Teresa", days: 8 }]);
  });

  it("D-18: licencia vigente saca de la alerta; vencida la devuelve sola", () => {
    const setters = SETTERS.map((s) => (s.id === "s_jud" ? { ...s, leaveUntil: "2026-07-25" } : s));
    writeFixture({ setters, leads: { ...lead("l_bren", BRENDA_TODAY), ...lead("l_jud", JUDITH_YEST), ...lead("l_ter", TERESA_OLD) } });
    const vigente = D.buildDailyReportData(NOW23);
    expect(vigente.onLeave).toEqual(["Judith"]);
    expect(vigente.idleToday).not.toContain("Judith");
    expect(D.buildDailyReportText(vigente)).toContain("_Judith: de licencia_");

    const vencidos = SETTERS.map((s) => (s.id === "s_jud" ? { ...s, leaveUntil: "2026-07-20" } : s));
    writeFixture({ setters: vencidos, leads: { ...lead("l_bren", BRENDA_TODAY), ...lead("l_jud", JUDITH_YEST), ...lead("l_ter", TERESA_OLD) } });
    const vencida = D.buildDailyReportData(NOW23);
    expect(vencida.onLeave).toEqual([]);
    expect(vencida.idleToday).toEqual(["Judith"]);
  });

  it("_reportOnLeave compara días en TZ de negocio y tolera basura", () => {
    expect(D._reportOnLeave({ leaveUntil: "2026-07-22" }, NOW23)).toBe(true);  // inclusive
    expect(D._reportOnLeave({ leaveUntil: "2026-07-21" }, NOW23)).toBe(false);
    expect(D._reportOnLeave({ leaveUntil: "mañana" }, NOW23)).toBe(false);
    expect(D._reportOnLeave({}, NOW23)).toBe(false);
  });
});

describe("señales del día — D-21/D-22/D-23 y REP-10", () => {
  it("D-21: interesados solo lista a quien marcó al menos uno hoy", () => {
    canonicalFixture();
    const d = D.buildDailyReportData(NOW23);
    expect(d.interested).toEqual([{ name: "Brenda", count: 1 }]);
    expect(D.buildDailyReportText(d)).toContain("_Interesados: Brenda 1_");
  });

  it("D-22: el canal manual se cuenta aparte y prende la bandera con 5+ o >10%", () => {
    // 4 telnyx de Brenda + 1 manual → 20% del día.
    writeFixture({
      leads: {
        ...lead("l_bren", BRENDA_TODAY),
        ...lead("l_man", [{ ts: iso(TODAY + 14 * HOUR), outcome: "answered_interested", by: "u_bren", duration: 0 }]),
      },
    });
    const d = D.buildDailyReportData(NOW23);
    expect(d.manualCalls).toBe(1);
    expect(d.manualFlag).toBe(true);
    expect(D.buildDailyReportText(d)).toContain("_1 llamadas cargadas a mano — sin minutos_");

    // Un día todo por Telnyx: sin bandera y sin línea.
    canonicalFixture();
    const limpio = D.buildDailyReportData(NOW23);
    expect(limpio.manualCalls).toBe(0);
    expect(limpio.manualFlag).toBe(false);
    expect(D.buildDailyReportText(limpio)).not.toContain("cargadas a mano");
  });

  it("D-23: las discadas sin marcar salen por nombre y NO suman a las llamadas", () => {
    canonicalFixture({
      pending: [
        { id: "pc_1", leadId: "l1", setterId: "s_ter", startedAt: iso(TODAY + 10 * HOUR), endedAt: null, createdAt: iso(TODAY + 10 * HOUR) },
        { id: "pc_2", leadId: "l2", setterId: "s_ter", startedAt: iso(TODAY + 11 * HOUR), endedAt: null, createdAt: iso(TODAY + 11 * HOUR) },
        { id: "pc_3", leadId: "l3", setterId: "s_jud", startedAt: iso(TODAY + 12 * HOUR), endedAt: null, createdAt: iso(TODAY + 12 * HOUR) },
        // De AYER → fuera del día.
        { id: "pc_4", leadId: "l4", setterId: "s_jud", startedAt: iso(YEST + 12 * HOUR), endedAt: null, createdAt: iso(YEST + 12 * HOUR) },
        // De un setter admin-only → jamás en el reporte.
        { id: "pc_5", leadId: "l5", setterId: "setter_ignacio", startedAt: iso(TODAY + 13 * HOUR), endedAt: null, createdAt: iso(TODAY + 13 * HOUR) },
      ],
    });
    const d = D.buildDailyReportData(NOW23);
    expect(d.unmarked).toEqual([{ name: "Teresa", count: 2 }, { name: "Judith", count: 1 }]);
    expect(d.team.dials).toBe(4); // el conteo canónico NO se toca
    expect(D.buildDailyReportText(d)).toContain("_Sin marcar hoy: Teresa 2, Judith 1_");

    canonicalFixture();
    const sinPendientes = D.buildDailyReportData(NOW23);
    expect(sinPendientes.unmarked).toEqual([]);
    expect(D.buildDailyReportText(sinPendientes)).not.toContain("Sin marcar hoy");
  });

  it("REP-10: llamadas de un user borrado suman al equipo pero no caen en ninguna fila", () => {
    canonicalFixture({
      leads: lead("l_orph", [call(TODAY + 15 * HOUR, "no_answer", "u_borrado", 0)]),
    });
    const d = D.buildDailyReportData(NOW23);
    expect(d.unattributed).toBe(1);
    expect(d.team.dials).toBe(5);
    expect(d.perSetter.reduce((a, s) => a + s.dials, 0)).toBe(4); // la huérfana no está en ninguna fila
    expect(D.buildDailyReportText(d)).toContain("_1 llamadas sin atribuir_");
  });
});

describe("texto del reporte — molde D-19", () => {
  it("la primera línea es la excepción y el título va después", () => {
    canonicalFixture();
    const d = D.buildDailyReportData(NOW23);
    const lines = D.buildDailyReportText(d).split("\n");
    expect(lines[0]).toBe("*Sin actividad hoy: Judith*");
    expect(lines[1]).toBe("Reporte diario · mié 22/07");
    expect(lines[2]).toBe("");
    // El segmento "activa" se sumó el 2026-07-26 a pedido del user (tiempo de
    // trabajo telefónico, distinto de los minutos hablados). El resto del molde
    // D-19 —excepción arriba, título después, sin segmentos en cero— no cambió.
    expect(lines[3]).toBe("*Brenda* 4 llam · 3 at · 22 min · 2h activa");
    expect(lines).toContain("_Equipo 4 llam · 3 at (75%) · 22 min · 2h activa_");
    expect(lines).toContain("_Ayer 2 llam · 1 at (50%)_");
    expect(lines).toContain("_Sin arrancar: Dalia_");
  });

  it("el % del mensaje va ENTERO (el dato conserva el decimal del CORE)", () => {
    // 8 de 13 = 61.5% → el molde validado por el user muestra "62%".
    const log = [];
    for (let i = 0; i < 8; i++) log.push(call(TODAY + (8 + i) * HOUR, "hung_up", "u_bren", 10));
    for (let i = 0; i < 5; i++) log.push(call(TODAY + (16 + i * 0.1) * HOUR, "no_answer", "u_bren", 0));
    writeFixture({ setters: [{ id: "s_bren", name: "Brenda" }], leads: lead("l_bren", log) });
    const d = D.buildDailyReportData(NOW23);
    expect(d.team.connectRate).toBe(61.5);          // precisión del CORE intacta
    expect(D.buildDailyReportText(d)).toContain("_Equipo 13 llam · 8 at (62%)");
    expect(D.buildDailyReportText(d)).not.toContain("61.5%");
  });

  it("con todas trabajando dice 'Todas trabajaron hoy'", () => {
    writeFixture({ setters: [{ id: "s_bren", name: "Brenda" }], leads: lead("l_bren", BRENDA_TODAY) });
    const d = D.buildDailyReportData(NOW23);
    expect(d.idleToday).toEqual([]);
    expect(D.buildDailyReportText(d).split("\n")[0]).toBe("*Todas trabajaron hoy*");
  });

  it("D-11: un día hábil entero en cero dice 'Hoy no llamó nadie', sin listar ceros", () => {
    writeFixture({
      setters: [{ id: "s_bren", name: "Brenda" }, { id: "s_jud", name: "Judith" }],
      leads: { ...lead("l_jud", JUDITH_YEST), ...lead("l_bren", [call(YEST + 9 * HOUR, "no_answer", "u_bren", 0)]) },
    });
    const d = D.buildDailyReportData(NOW23);
    const txt = D.buildDailyReportText(d);
    expect(txt.split("\n")[0]).toBe("*Hoy no llamó nadie*");
    expect(d.perSetter).toEqual([]);
    expect(txt).not.toContain("_Equipo ");      // sin "Equipo 0 llam"
    expect(txt).not.toMatch(/\b0 llam\b/);
  });

  it("cero métricas en cero: sin '0 min', sin 'Ayer 0 llam', sin filas vacías", () => {
    // Solo llamadas de HOY sin minutos (no_answer no suma duración) y nada ayer.
    writeFixture({
      setters: [{ id: "s_bren", name: "Brenda" }],
      leads: lead("l_bren", [
        call(TODAY + 10 * HOUR, "no_answer", "u_bren", 0),
        call(TODAY + 11 * HOUR, "voicemail", "u_bren", 0),
      ]),
    });
    const d = D.buildDailyReportData(NOW23);
    expect(d.team.minutes).toBe(0);
    expect(d.yesterday.dials).toBe(0);
    const txt = D.buildDailyReportText(d);
    expect(txt).not.toMatch(/\b0 min\b/);
    expect(txt).not.toContain("Ayer");
    expect(txt).toContain("*Brenda* 2 llam · 0 at");
  });

  // WR-02 (21-REVIEW): el texto se congela al encolar y la cola existe para
  // entregarlo tarde. Con "hoy" fijo, un diario de jue 24/07 entregado el sábado
  // decía "Sin actividad hoy: Judith" arriba de "Reporte diario · jue 24/07".
  it("WR-02: delayed reemplaza 'hoy' por el día del reporte", () => {
    canonicalFixture();
    const d = D.buildDailyReportData(NOW23);
    const hoy = D.buildDailyReportText(d);
    const tarde = D.buildDailyReportText(d, { delayed: true });
    expect(hoy.split("\n")[0]).toBe("*Sin actividad hoy: Judith*");
    expect(tarde.split("\n")[0]).toBe("*Sin actividad mié 22/07: Judith*");
    expect(tarde).not.toContain("hoy");                 // ninguna línea miente
    expect(tarde.split("\n")[1]).toBe("Reporte diario · mié 22/07");
    // El resto del cuerpo es idéntico (solo cambia el encabezado).
    expect(tarde.split("\n").slice(2).join("\n")).toBe(hoy.split("\n").slice(2).join("\n"));
  });

  it("WR-02: los otros dos encabezados también dejan de decir 'hoy'", () => {
    // Equipo entero en cero (D-11).
    writeFixture({ setters: [{ id: "s_bren", name: "Brenda" }], leads: lead("l_bren", [call(TODAY - 30 * DAY, "no_answer", "u_bren", 0)]) });
    const cero = D.buildDailyReportData(NOW23);
    expect(D.buildDailyReportText(cero).split("\n")[0]).toBe("*Hoy no llamó nadie*");
    expect(D.buildDailyReportText(cero, { delayed: true }).split("\n")[0]).toBe("*mié 22/07: no llamó nadie*");
    // Todas trabajaron.
    writeFixture({ setters: [{ id: "s_bren", name: "Brenda" }], leads: lead("l_bren", BRENDA_TODAY) });
    const todas = D.buildDailyReportData(NOW23);
    expect(D.buildDailyReportText(todas).split("\n")[0]).toBe("*Todas trabajaron hoy*");
    expect(D.buildDailyReportText(todas, { delayed: true }).split("\n")[0]).toBe("*Todas trabajaron · mié 22/07*");
  });

  it("D-05: la nota de baches va arriba de todo", () => {
    canonicalFixture();
    const d = D.buildDailyReportData(NOW23);
    const txt = D.buildDailyReportText(d, { gapNote: "_No pude enviar el reporte del jueves y el viernes._" });
    expect(txt.split("\n")[0]).toBe("_No pude enviar el reporte del jueves y el viernes._");
    expect(txt.split("\n")[2]).toBe("*Sin actividad hoy: Judith*");
  });

  it("T-21-01: un nombre con salto de línea no fabrica líneas falsas en el mensaje", () => {
    expect(D._reportSafeName("Ju\ndith")).toBe("Ju dith");
    expect(D._reportSafeName("x".repeat(80)).length).toBe(40);
    writeFixture({
      setters: [{ id: "s_bren", name: "Brenda" }, { id: "s_jud", name: "Judith\n_Equipo 999 llam_" }],
      leads: { ...lead("l_bren", BRENDA_TODAY), ...lead("l_jud", JUDITH_YEST) },
    });
    // El salto se neutraliza: el texto inyectado queda DENTRO de la línea de la
    // excepción, no puede fabricar una línea propia que se lea como métrica.
    const lines = D.buildDailyReportText(D.buildDailyReportData(NOW23)).split("\n");
    expect(lines.filter((l) => l.startsWith("_Equipo")).length).toBe(1);
    expect(lines).not.toContain("_Equipo 999 llam_");
    expect(lines[0]).toBe("*Sin actividad hoy: Judith _Equipo 999 llam_*");
  });

  // WR-08 (21-REVIEW): el texto termina en `sendInputEvent({type:'char'})` por
  // carácter. Un TAB en el nombre de una SDR se tipeaba como char de tabulación y
  // Chromium puede moverle el FOCO fuera del composer: el resto del mensaje se
  // escribe en otro elemento y el click al botón de enviar manda un truncado.
  // U+2028/U+2029 tampoco los separa `split(/\r?\n/)`. El nombre del setter es texto
  // libre sin validación (PATCH /api/setters/team/:id no limita charset).
  it("WR-08: TAB, U+2028/U+2029 y otros controles no llegan al tipeo OS-level", () => {
    const TAB = String.fromCharCode(9);
    const LS = String.fromCharCode(0x2028);
    const PS = String.fromCharCode(0x2029);
    const VT = String.fromCharCode(11);
    const NEL = String.fromCharCode(0x85);
    expect(D._reportSafeName(`Ju${TAB}dith`)).toBe("Ju dith");
    expect(D._reportSafeName(`Ju${LS}dith`)).toBe("Ju dith");
    expect(D._reportSafeName(`Ju${PS}dith`)).toBe("Ju dith");
    expect(D._reportSafeName(`Ju${VT}dith`)).toBe("Ju dith");
    expect(D._reportSafeName(`Ju${NEL}dith`)).toBe("Ju dith");
    expect(D._reportSafeName("Ju\r\ndith")).toBe("Ju dith");     // no deja doble espacio
    expect(D._reportSafeName("  Brenda  ")).toBe("Brenda");
    // Y por el mensaje completo: ningún carácter de control sobrevive.
    writeFixture({
      setters: [{ id: "s_bren", name: `Bren${TAB}da` }, { id: "s_jud", name: `Judith${LS}x` }],
      leads: { ...lead("l_bren", BRENDA_TODAY), ...lead("l_jud", JUDITH_YEST) },
    });
    const txt = D.buildDailyReportText(D.buildDailyReportData(NOW23));
    expect(txt).toContain("Bren da");
    expect(txt).toContain("Judith x");
    // Solo quedan los \n que pone el molde: cero controles, cero separadores Unicode.
    expect(new RegExp("[\\u0000-\\u0009\\u000b-\\u001f\\u007f-\\u009f\\u2028\\u2029]").test(txt)).toBe(false);
  });
});

describe("consolidado — D-26", () => {
  it("N días → UN mensaje con una línea por día", () => {
    canonicalFixture();
    const hoy = D.buildDailyReportData(NOW23);
    const ayer = D.buildDailyReportData(NOW23, YEST + 12 * HOUR);
    const anteayer = D.buildDailyReportData(NOW23, YEST - DAY + 12 * HOUR);
    const lines = [anteayer, ayer, hoy].map(D.buildDailyReportLine);
    const txt = D.buildConsolidatedReportText(lines, { neverStarted: hoy.neverStarted });
    expect(lines[2]).toBe("*mié 22/07* 4 llam · 3 at · 22 min · 2h activa · sin actividad: Judith");
    expect(lines[0]).toBe("*lun 20/07* sin llamadas");
    expect(txt).toContain("_Sin arrancar: Dalia_");
    expect(txt.split("\n").filter((l) => l.startsWith("*")).length).toBe(4); // encabezado + 3 días
  });

  it("la nota de baches también encabeza el consolidado", () => {
    const txt = D.buildConsolidatedReportText(["*mié 22/07* sin llamadas"], { gapNote: "_Estuve 3 días sin poder enviar._" });
    expect(txt.split("\n")[0]).toBe("_Estuve 3 días sin poder enviar._");
    expect(txt).toContain("*Reporte acumulado · 1 días*");
  });
});

describe("consistencia con el CALL METRICS CORE (regla #157)", () => {
  it("team.dials/connects salen exactamente de _ccFunnelAggregate", () => {
    canonicalFixture({ leads: lead("l_orph", [call(TODAY + 15 * HOUR, "hung_up", "u_borrado", 45)]) });
    const d = D.buildDailyReportData(NOW23);
    const raw = JSON.parse(fs.readFileSync(path.join(tmpData, "setters.json"), "utf8"));
    const visibleSet = P18._visibleSetterIds({ role: "supervisor" });
    const { fromTs, toTs } = C._ccResolveRange("custom", { from: "2026-07-22", to: "2026-07-22", now: NOW23 });
    const agg = C._ccFunnelAggregate(C._ccCollectCalls(raw, { visibleSet }), [], fromTs, toTs, { visibleSet });
    expect(d.team.dials).toBe(agg.dials);
    expect(d.team.connects).toBe(agg.connects);
    expect(d.team.connectRate).toBe(agg.rates.connectRate);
    expect(d.team.minutes).toBe(Math.round(agg.totalDurationS / 60));
  });

  it("_ccResolveRange sin `now` sigue usando el reloj real (retro-compatible)", () => {
    const r = C._ccResolveRange("today");
    expect(r.fromTs).toBe(M._bizStartOfDay(Date.now()));
    expect(Math.abs(r.toTs - Date.now())).toBeLessThan(5000);
  });
});

describe("licencia — PATCH /api/setters/team/:id (D-18)", () => {
  it("acepta YYYY-MM-DD, rechaza basura y limpia con null", async () => {
    writeFixture();
    const ok = await request(app).patch("/api/setters/team/s_jud").set("Cookie", adminCookie).send({ leaveUntil: "2026-08-05" });
    expect(ok.status).toBe(200);
    expect(ok.body.setter.leaveUntil).toBe("2026-08-05");

    const bad = await request(app).patch("/api/setters/team/s_jud").set("Cookie", adminCookie).send({ leaveUntil: "05/08/2026" });
    expect(bad.status).toBe(400);

    const clear = await request(app).patch("/api/setters/team/s_jud").set("Cookie", adminCookie).send({ leaveUntil: null });
    expect(clear.status).toBe(200);
    expect(clear.body.setter.leaveUntil).toBe(null);
  });

  it("un PATCH sin leaveUntil no toca el valor guardado", async () => {
    writeFixture({ setters: SETTERS.map((s) => (s.id === "s_jud" ? { ...s, leaveUntil: "2026-08-05" } : s)) });
    const r = await request(app).patch("/api/setters/team/s_jud").set("Cookie", adminCookie).send({ name: "Judith" });
    expect(r.status).toBe(200);
    expect(r.body.setter.leaveUntil).toBe("2026-08-05");
  });
});

// ── Tiempo ACTIVA + stock "por llamar" ──
// Pedido del user (2026-07-26): "cuánto tiempo estuvieron activas" además de los
// minutos hablados, y "le quedan por llamar" para reponerles leads sin entrar al
// panel. NO se usa presencia del panel: `lastSeen` en auth.json es un timestamp
// que se pisa, sin historial de sesiones — no hay data para eso.
//
// El tamaño del bloque se DERIVA del helper (una llamada sola = un bloque), así
// que estos tests sobreviven al próximo cambio de criterio. El user ya lo movió
// de 15 a 30 minutos el mismo día que se construyó.
describe("tiempo activa — bloques con actividad (callLog)", () => {
  const BUCKET = D._reportActiveMinutes([{ ts: 0 }]);   // minutos por bloque

  it("el bloque es de 30 minutos (criterio vigente)", () => {
    expect(BUCKET).toBe(30);
  });

  it("_reportActiveMinutes: cuenta bloques distintos, no llamadas", () => {
    const t0 = TODAY + 10 * HOUR;
    const bucketMs = BUCKET * 60000;
    // Varias llamadas dentro del MISMO bloque → un bloque, no una por llamada.
    expect(D._reportActiveMinutes([
      { ts: t0 }, { ts: t0 + 60000 }, { ts: t0 + bucketMs - 60000 },
    ])).toBe(BUCKET);
    // Dos bloques distintos → el doble.
    expect(D._reportActiveMinutes([{ ts: t0 }, { ts: t0 + bucketMs + 60000 }])).toBe(BUCKET * 2);
    // Una llamada suelta vale un bloque entero (decisión documentada).
    expect(D._reportActiveMinutes([{ ts: t0 }])).toBe(BUCKET);
    expect(D._reportActiveMinutes([])).toBe(0);
    expect(D._reportActiveMinutes(null)).toBe(0);
    // Basura no rompe ni suma.
    expect(D._reportActiveMinutes([{ ts: NaN }, { ts: "x" }, {}, null])).toBe(0);
  });

  it("_reportDuration: compacto y sin decimales", () => {
    expect(D._reportDuration(0)).toBe("0min");
    expect(D._reportDuration(45)).toBe("45min");
    expect(D._reportDuration(60)).toBe("1h");
    expect(D._reportDuration(135)).toBe("2h15");
    expect(D._reportDuration(125)).toBe("2h05");   // padding: 2h05, no 2h5
    expect(D._reportDuration(-10)).toBe("0min");
  });

  it("perSetter y team traen activeMinutes; el equipo SUMA (horas-persona)", () => {
    canonicalFixture();
    const d = D.buildDailyReportData(NOW23);
    const bren = d.perSetter.find((s) => s.name.startsWith("Brenda"));
    // Las 4 llamadas del fixture caen en 4 horas distintas → 4 bloques.
    expect(bren.activeMinutes).toBe(BUCKET * 4);
    expect(d.team.activeMinutes).toBe(d.perSetter.reduce((t, s) => t + s.activeMinutes, 0));
  });

  it("el texto muestra 'activa' en la fila y en el pie, y NUNCA en cero", () => {
    canonicalFixture();
    const d = D.buildDailyReportData(NOW23);
    const txt = D.buildDailyReportText(d);
    expect(txt).toContain(`${D._reportDuration(BUCKET * 4)} activa`);
    // Regla del molde: ningún segmento en cero (D-19).
    expect(txt).not.toContain("0min activa");
    expect(txt).not.toContain("0h activa");

    // Día sin llamadas: no aparece el segmento en absoluto.
    writeFixture({ leads: {} });
    const vacio = D.buildDailyReportData(NOW23);
    expect(vacio.team.activeMinutes).toBe(0);
    expect(D.buildDailyReportText(vacio)).not.toContain("activa");
  });

  it("la línea del consolidado también lo lleva", () => {
    canonicalFixture();
    const d = D.buildDailyReportData(NOW23);
    expect(D.buildDailyReportLine(d)).toContain("activa");
    writeFixture({ leads: {} });
    expect(D.buildDailyReportLine(D.buildDailyReportData(NOW23))).not.toContain("activa");
  });

  it("activa es INDEPENDIENTE de los minutos hablados (el caso que motivó la métrica)", () => {
    // 20 llamadas espaciadas un bloque entero, NINGUNA atendida: 0 minutos
    // hablados pero 20 bloques de actividad. Antes esto se veía como día vacío.
    const calls = [];
    for (let i = 0; i < 20; i++) calls.push(call(TODAY + 8 * HOUR + i * BUCKET * 60000, "no_answer", "u_bren", 0));
    writeFixture({ leads: lead("l_bren", calls) });
    const d = D.buildDailyReportData(NOW23);
    const bren = d.perSetter.find((s) => s.name.startsWith("Brenda"));
    expect(bren.minutes).toBe(0);
    expect(bren.activeMinutes).toBe(BUCKET * 20);
    expect(D.buildDailyReportText(d)).not.toContain("0 min");
  });
});

describe("stock 'por llamar' por vendedora", () => {
  // Lead llamable: teléfono válido, sin DNC, sin tarifa roja, no terminal.
  const stock = (id, sid, extra = {}) => ({
    [id]: {
      num: 1, name: `S-${id}`, phone: "+525550001122", assignedTo: sid,
      conexion: "sin_wsp", estado: "sin_contactar", callLog: [], ...extra,
    },
  });

  it("cuenta llamables NO discados por el dueño actual, y ordena de menos a más", () => {
    writeFixture({
      leads: {
        // Las tres YA arrancaron (una llamada vieja cada una): la línea de stock
        // excluye a las que nunca llamaron, que tienen su propia línea.
        // `lead()` asigna a s_bren por default: acá cada una tiene que ser dueña
        // de la suya, si no las de las otras le cuentan como stock a Brenda.
        ...lead("hist_b", [call(TODAY - 20 * DAY, "no_answer", "u_bren", 0)], { assignedTo: "s_bren" }),
        ...lead("hist_j", [call(TODAY - 20 * DAY, "no_answer", "u_jud", 0)], { assignedTo: "s_jud" }),
        ...lead("hist_t", [call(TODAY - 20 * DAY, "no_answer", "u_ter", 0)], { assignedTo: "s_ter" }),
        ...stock("a1", "s_bren"), ...stock("a2", "s_bren"), ...stock("a3", "s_bren"),
        ...stock("b1", "s_jud"),
        // Ya discado por su dueña → NO cuenta como pendiente.
        ...stock("b2", "s_jud", { callLog: [call(TODAY - 3 * DAY, "no_answer", "u_jud", 0)] }),
        // DNC y número muerto → nunca se van a llamar, fuera del stock.
        ...stock("c1", "s_ter", { doNotCall: true }),
        ...stock("c2", "s_ter", { lookupAt: "2026-07-01T00:00:00.000Z", phoneType: "" }),
      },
    });
    const d = D.buildDailyReportData(NOW23);
    const by = Object.fromEntries(d.pending.map((p) => [p.name, p.count]));
    expect(by.Brenda).toBe(3);
    expect(by.Judith).toBe(1);       // b2 ya lo llamó ella
    expect(by.Teresa).toBe(0);       // DNC + número muerto
    // Orden: la que menos stock tiene va primero (es la que hay que reponer).
    expect(d.pending[0].count).toBeLessThanOrEqual(d.pending[d.pending.length - 1].count);
    // Ignacio (admin-only) y la oculta nunca aparecen.
    expect(d.pending.some((p) => p.name === "Ignacio")).toBe(false);
    expect(d.pending.some((p) => p.name === "Oculta")).toBe(false);
  });

  it("incluye a las que hoy NO llamaron (son las que hay que mirar)", () => {
    canonicalFixture({ leads: stock("z1", "s_jud") });
    const d = D.buildDailyReportData(NOW23);
    // Judith no llamó hoy → no tiene fila, pero sí línea de stock.
    expect(d.perSetter.some((s) => s.name.startsWith("Judith"))).toBe(false);
    expect(d.pending.some((p) => p.name === "Judith")).toBe(true);
    expect(D.buildDailyReportText(d)).toContain("_Por llamar:");
  });
});

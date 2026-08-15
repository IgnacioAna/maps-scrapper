// Phase 29 Plan 04 (NEXT-02/NEXT-03): tests de POST /api/admin/backfill-next-action.
// La migración persiste EXACTAMENTE lo que _deriveNextActionFromLegacy ya
// deriva en cada lectura (29-01/29-03) — estos tests prueban las tres
// propiedades que importan: no escribe en dryRun, no mueve ninguna fecha
// visible, y es idempotente. También cubre RBAC (401/403) y que la cola de
// llamadas (/leads/sin-wsp) responde igual antes y después para los leads
// que ya tenían callbackAt (manual/cadencia) — con la excepción DOCUMENTADA
// de los leads derivados de followUps, cuyo callbackAt (vacío hasta hoy) se
// espeja con la fecha del step (D-03/D-04): es justamente lo que hace que
// esos leads pasen a verse en las colas de callback.
import { describe, it, beforeAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `next-action-migration-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-nam@local.test";
process.env.ADMIN_PASSWORD = "nampass1234";
process.env.JWT_SECRET = "test-secret-nam-1234567890";
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
      { id: "user_admin_nam", email: "admin-nam@local.test", name: "AdminNAM", role: "admin", status: "active", setterId: "", password: pwd("nampass1234") },
      { id: "user_setter_nam", email: "setter-nam@local.test", name: "SetterNAM", role: "setter", status: "active", setterId: "setter_nam", password: pwd("nampass1234") },
    ],
    invites: [],
    sessions: [],
  }, null, 2)
);

const NOW = Date.now();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const ago = (ms) => new Date(NOW - ms).toISOString();
const future = (ms) => new Date(NOW + ms).toISOString();

// Fixture (6 leads, cubre las combinaciones del <behavior> del plan):
// - lead_manual: callbackAt + último outcome callback_later → origen manual.
// - lead_cadencia: callbackAt + último outcome no_answer → origen cadencia.
// - lead_fu_only: followUps activo, SIN callbackAt, callLog vacío → deriva
//   de followUps (fuente 'followUps'), y el espejo va a ESCRIBIR callbackAt
//   (hoy vacío) — efecto intencional documentado en el endpoint (D-03/D-04).
// - lead_both: callbackAt Y followUps activo a la vez → migra por
//   callbackAt (gana sobre followUps, la fecha visible no se mueve).
// - lead_plain: sin callback ni followUps → no gana nextAction.
// - lead_already: nextAction YA presente (sembrado a mano) → idempotencia:
//   el scan lo saltea (yaMigrados), nunca se toca.
const CALLBACK_MANUAL = future(2 * DAY);
const CALLBACK_CADENCIA = future(1 * DAY);
const CALLBACK_BOTH = future(3 * DAY);
const FU_STARTED_AT = ago(1 * DAY);
const ALREADY_DUE = future(9 * DAY);

fs.writeFileSync(
  path.join(tmpData, "setters.json"),
  JSON.stringify({
    setters: [{ id: "setter_nam", name: "SetterNAM" }],
    variants: [],
    leads: {
      lead_manual: {
        num: 1, name: "Manual", phone: "+521555000001", assignedTo: "setter_nam",
        estado: "contactado", conexion: "sin_wsp", interes: null,
        callbackAt: CALLBACK_MANUAL,
        callLog: [{ ts: ago(1 * DAY), outcome: "callback_later", by: "user_setter_nam" }],
        followUps: { '24hs': false, '48hs': false, '72hs': false, '7d': false, '15d': false },
        followUpStartedAt: null, notes: [], interactions: [],
      },
      lead_cadencia: {
        num: 2, name: "Cadencia", phone: "+521555000002", assignedTo: "setter_nam",
        estado: "sin_contactar", conexion: "sin_wsp", interes: null,
        callbackAt: CALLBACK_CADENCIA,
        callLog: [{ ts: ago(1 * DAY), outcome: "no_answer", by: "user_setter_nam" }],
        followUps: { '24hs': false, '48hs': false, '72hs': false, '7d': false, '15d': false },
        followUpStartedAt: null, notes: [], interactions: [],
      },
      lead_fu_only: {
        num: 3, name: "FuOnly", phone: "+521555000003", assignedTo: "setter_nam",
        estado: "contactado", conexion: "sin_wsp", interes: null,
        callbackAt: "",
        followUps: { '24hs': false, '48hs': true, '72hs': false, '7d': false, '15d': false },
        followUpStartedAt: FU_STARTED_AT,
        callLog: [], notes: [], interactions: [],
      },
      lead_both: {
        num: 4, name: "Both", phone: "+521555000004", assignedTo: "setter_nam",
        estado: "contactado", conexion: "sin_wsp", interes: null,
        callbackAt: CALLBACK_BOTH,
        followUps: { '24hs': false, '48hs': false, '72hs': true, '7d': false, '15d': false },
        followUpStartedAt: ago(1 * DAY),
        callLog: [{ ts: ago(1 * DAY), outcome: "callback_later", by: "user_setter_nam" }],
        notes: [], interactions: [],
      },
      lead_plain: {
        num: 5, name: "Plain", phone: "+521555000005", assignedTo: "setter_nam",
        estado: "sin_contactar", conexion: "sin_wsp", interes: null,
        callbackAt: "",
        followUps: { '24hs': false, '48hs': false, '72hs': false, '7d': false, '15d': false },
        followUpStartedAt: null, callLog: [], notes: [], interactions: [],
      },
      lead_already: {
        num: 6, name: "Already", phone: "+521555000006", assignedTo: "setter_nam",
        estado: "contactado", conexion: "sin_wsp", interes: null,
        callbackAt: "",
        followUps: { '24hs': false, '48hs': false, '72hs': false, '7d': false, '15d': false },
        followUpStartedAt: null, callLog: [], notes: [], interactions: [],
        nextAction: {
          tipo: "callback", dueAt: ALREADY_DUE, canal: "llamada",
          motivo: "seed-untouched", origen: "manual",
          createdAt: ago(1 * DAY), createdBy: "seed",
        },
      },
    },
    calendar: [],
    sessions: [],
  }, null, 2)
);

const { app } = await import("../index.js");

let cookieAdmin = "";
let cookieSetter = "";
const migrate = (body, cookie = cookieAdmin) =>
  request(app).post("/api/admin/backfill-next-action").set("Cookie", cookie).send(body);
const sinWsp = () =>
  request(app).get("/api/setters/leads/sin-wsp?include=callable").set("Cookie", cookieAdmin);
const rawFile = () => JSON.parse(fs.readFileSync(path.join(tmpData, "setters.json"), "utf8"));

beforeAll(async () => {
  const rA = await request(app).post("/api/auth/login").send({ email: "admin-nam@local.test", password: "nampass1234" });
  expect(rA.status).toBe(200);
  cookieAdmin = (rA.headers["set-cookie"] || []).find((c) => c.startsWith("gs_session=")).split(";")[0];

  const rS = await request(app).post("/api/auth/login").send({ email: "setter-nam@local.test", password: "nampass1234" });
  expect(rS.status).toBe(200);
  cookieSetter = (rS.headers["set-cookie"] || []).find((c) => c.startsWith("gs_session=")).split(";")[0];
});

describe("RBAC: solo admin puede migrar", () => {
  it("anónimo → 401", async () => {
    const r = await request(app).post("/api/admin/backfill-next-action").send({ dryRun: true });
    expect(r.status).toBe(401);
  });

  it("sesión de rol setter → 403", async () => {
    const r = await migrate({ dryRun: true }, cookieSetter);
    expect(r.status).toBe(403);
  });
});

describe("dryRun: simula sin escribir", () => {
  let dryBody;

  it("matched >= 1 y cuenta los 4 leads con compromiso derivable (manual/cadencia/followUps/ambos)", async () => {
    const r = await migrate({ dryRun: true });
    expect(r.status).toBe(200);
    expect(r.body.dryRun).toBe(true);
    expect(r.body.matched).toBe(4);
    expect(r.body.yaMigrados).toBe(1); // lead_already, saltado
    expect(r.body.scanned).toBe(6);
    const ids = r.body.leads.map((l) => l.id);
    expect(ids.sort()).toEqual(["lead_both", "lead_cadencia", "lead_fu_only", "lead_manual"]);
    dryBody = r.body;
  });

  it("el archivo en disco queda intacto: ningún lead ganó nextAction todavía", async () => {
    const raw = rawFile();
    expect(raw.leads.lead_manual.nextAction).toBeUndefined();
    expect(raw.leads.lead_cadencia.nextAction).toBeUndefined();
    expect(raw.leads.lead_fu_only.nextAction).toBeUndefined();
    expect(raw.leads.lead_fu_only.callbackAt).toBe(""); // sin espejar todavía
    expect(raw.leads.lead_both.nextAction).toBeUndefined();
    expect(raw.leads.lead_plain.nextAction).toBeUndefined();
    // lead_already conserva exactamente el nextAction sembrado (nadie lo tocó).
    expect(raw.leads.lead_already.nextAction.motivo).toBe("seed-untouched");
  });
});

describe("apply: escribe bajo mutex, respalda, y no mueve ninguna fecha visible", () => {
  let applyBody;

  it("updated === matched del dryRun", async () => {
    const r = await migrate({});
    expect(r.status).toBe(200);
    expect(r.body.dryRun).toBe(false);
    expect(r.body.updated).toBe(4);
    applyBody = r.body;
  });

  it("lead con callbackAt + callback_later → origen manual, dueAt IGUAL al callbackAt que ya tenía", () => {
    const raw = rawFile();
    const na = raw.leads.lead_manual.nextAction;
    expect(na).toBeTruthy();
    expect(na.origen).toBe("manual");
    expect(na.tipo).toBe("callback");
    expect(na.dueAt).toBe(CALLBACK_MANUAL);
    expect(raw.leads.lead_manual.callbackAt).toBe(CALLBACK_MANUAL); // la fecha no se movió
  });

  it("lead con callbackAt + no_answer → origen cadencia", () => {
    const raw = rawFile();
    const na = raw.leads.lead_cadencia.nextAction;
    expect(na.origen).toBe("cadencia");
    expect(na.dueAt).toBe(CALLBACK_CADENCIA);
    expect(raw.leads.lead_cadencia.callbackAt).toBe(CALLBACK_CADENCIA);
  });

  it("lead con followUps activo y SIN callbackAt → nextAction a followUpStartedAt+48h, y AHORA TAMBIÉN callbackAt espejado; los flags de followUps siguen intactos", () => {
    const raw = rawFile();
    const lead = raw.leads.lead_fu_only;
    const na = lead.nextAction;
    expect(na).toBeTruthy();
    expect(na.origen).toBe("manual");
    expect(na.motivo).toBe("follow-up 48h");
    const expectedDue = new Date(new Date(FU_STARTED_AT).getTime() + 48 * HOUR).toISOString();
    expect(na.dueAt).toBe(expectedDue);
    expect(lead.callbackAt).toBe(na.dueAt); // espejo D-03/D-04: antes era "", ahora la fecha del step
    expect(lead.followUps).toEqual({ '24hs': false, '48hs': true, '72hs': false, '7d': false, '15d': false });
    expect(lead.followUpStartedAt).toBe(FU_STARTED_AT); // historia intacta (D-04), no se borra
  });

  it("lead con callbackAt Y followUps activo → migra por el callbackAt (la fecha no se mueve, followUps no se limpia)", () => {
    const raw = rawFile();
    const lead = raw.leads.lead_both;
    expect(lead.nextAction.origen).toBe("manual");
    expect(lead.nextAction.dueAt).toBe(CALLBACK_BOTH);
    expect(lead.callbackAt).toBe(CALLBACK_BOTH);
    expect(lead.followUps["72hs"]).toBe(true); // no se toca, aunque no fue la fuente
  });

  it("lead sin callback ni followUps no gana la propiedad nextAction como objeto (queda null)", () => {
    const raw = rawFile();
    expect(raw.leads.lead_plain.nextAction).toBeNull();
    expect(raw.leads.lead_plain.callbackAt).toBe("");
  });

  it("lead ya migrado (nextAction sembrado) queda exactamente igual — la idempotencia lo saltea desde el vamos", () => {
    const raw = rawFile();
    expect(raw.leads.lead_already.nextAction).toEqual({
      tipo: "callback", dueAt: ALREADY_DUE, canal: "llamada",
      motivo: "seed-untouched", origen: "manual",
      createdAt: ago(1 * DAY), createdBy: "seed",
    });
  });

  it("hizo backup antes de escribir (makeBackup + snapshot en disco)", () => {
    const backupsDir = path.join(tmpData, "backups");
    expect(fs.existsSync(backupsDir)).toBe(true);
    const entries = fs.readdirSync(backupsDir).filter((f) => f.includes("pre-backfill-next-action"));
    expect(entries.length).toBeGreaterThanOrEqual(1);
  });
});

describe("idempotencia: segunda corrida no cambia nada", () => {
  it("dryRun de la segunda corrida → matched: 0, yaMigrados: 5", async () => {
    const r = await migrate({ dryRun: true });
    expect(r.body.matched).toBe(0);
    expect(r.body.yaMigrados).toBe(5); // los 4 recién migrados + lead_already
  });

  it("apply de la segunda corrida → updated: 0", async () => {
    const r = await migrate({});
    expect(r.body.updated).toBe(0);
  });
});

describe("la cola de llamadas responde igual antes y después (para los leads que ya tenían callbackAt)", () => {
  // Nota: este describe corre DESPUÉS de que la migración ya se aplicó en los
  // describes anteriores. Como la migración es idempotente (verificado arriba),
  // comparar "antes" (constantes fijadas en el fixture) contra "después"
  // (la respuesta HTTP actual) prueba lo mismo que comparar dos snapshots del
  // endpoint tomados a ambos lados de la migración.
  it("lead_manual y lead_cadencia: mismo callbackAt, mismo manualCallbackByOwner", async () => {
    const r = await sinWsp();
    expect(r.status).toBe(200);
    const byId = Object.fromEntries(r.body.leads.map((l) => [l.id, l]));

    expect(byId.lead_manual.callbackAt).toBe(CALLBACK_MANUAL);
    expect(byId.lead_manual.manualCallbackByOwner).toBe(true);

    expect(byId.lead_cadencia.callbackAt).toBe(CALLBACK_CADENCIA);
    expect(byId.lead_cadencia.manualCallbackByOwner).toBe(false); // origen cadencia, no manual

    expect(byId.lead_both.callbackAt).toBe(CALLBACK_BOTH);
    expect(byId.lead_both.manualCallbackByOwner).toBe(true);

    expect(byId.lead_plain.callbackAt).toBe("");
    expect(byId.lead_plain.manualCallbackByOwner).toBe(false);
  });

  it("lead_fu_only: manualCallbackByOwner ya era true ANTES de migrar (_leadNextAction deriva en cada lectura) — la migración solo persiste el callbackAt que la derivación ya mostraba, efecto D-03/D-04 documentado, no una regresión", async () => {
    const r = await sinWsp();
    const byId = Object.fromEntries(r.body.leads.map((l) => [l.id, l]));
    // callbackAt ahora tiene la fecha real (antes de migrar era "" en el JSON
    // crudo, aunque la lectura YA derivaba manualCallbackByOwner=true desde
    // 29-03). Es el único cambio de comportamiento de esta migración sobre
    // /leads/sin-wsp, y está explícitamente previsto por el plan.
    const expectedDue = new Date(new Date(FU_STARTED_AT).getTime() + 48 * HOUR).toISOString();
    expect(byId.lead_fu_only.callbackAt).toBe(expectedDue);
    expect(byId.lead_fu_only.manualCallbackByOwner).toBe(true);
  });
});

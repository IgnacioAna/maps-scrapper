// Plan 33-04 (DIAL-04): la ficha del lead pone al frente el historial de las
// vendedoras — última disposición, quién la marcó, la última nota y el
// compromiso pendiente — antes de discar. Este archivo cubre:
//   (a) Task 1 — backend: `userNames` en GET /api/setters/leads/sin-wsp
//       resuelve callLog[].by a un nombre, sin exponer emails ni el padrón
//       completo (T-33-12).
//   (b) Task 3 — el bloque puro `[33-04] HISTORY-PURE` (_leadHistoryBrief +
//       _leadHistoryHTML), extraído con `new Function` y evaluado con un
//       reloj FIJO (nunca Date.now() real), más el cableado en las 3
//       superficies y el cache-buster.
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `dial-history-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-dh@local.test";
process.env.ADMIN_PASSWORD = "adminpass1";
process.env.ADMIN_NAME = "AdminDH";
process.env.JWT_SECRET = "test-secret-dh";
// String vacio, NUNCA delete (dotenv re-carga el .env local si se borran).
process.env.OPENAI_API_KEY = "";
process.env.MERCURY_API_KEY = "";
process.env.QWEN_API_KEY = "";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}

const now = new Date().toISOString();

fs.writeFileSync(
  path.join(tmpData, "auth.json"),
  JSON.stringify({
    users: [
      { id: "user_admin", email: "admin-dh@local.test", name: "AdminDH", role: "admin", status: "active", setterId: "", password: pwd("adminpass1"), createdAt: now, updatedAt: now },
      { id: "user_judith", email: "judith@local.test", name: "Judith Mendez", role: "setter", status: "active", setterId: "setter_judith", password: pwd("judithpass1"), createdAt: now, updatedAt: now },
    ],
    invites: [],
    sessions: [],
  }, null, 2)
);

fs.writeFileSync(
  path.join(tmpData, "setters.json"),
  JSON.stringify({
    setters: [{ id: "setter_judith", name: "Judith Mendez" }],
    variants: [],
    leads: {
      // by de un usuario EXISTENTE + by de un usuario BORRADO en el mismo callLog.
      lead_mixto: {
        id: "lead_mixto", num: 1, name: "Mixto", phone: "+5215500000001", country: "México",
        assignedTo: "setter_judith", estado: "sin_contactar", conexion: "sin_wsp",
        callLog: [
          { ts: now, outcome: "no_answer", duration: 0, by: "user_borrado_inexistente" },
          { ts: now, outcome: "answered_interested", duration: 40, by: "user_judith" },
        ],
      },
    },
    calendar: [],
    sessions: [],
  }, null, 2)
);

const { app } = await import("../index.js");

async function login(email, password) {
  const r = await request(app).post("/api/auth/login").send({ email, password });
  expect(r.status).toBe(200);
  const cookies = r.headers["set-cookie"] || [];
  return (cookies.find((c) => c.startsWith("gs_session=")) || "").split(";")[0];
}

let adminCookie = "";

beforeAll(async () => {
  adminCookie = await login("admin-dh@local.test", "adminpass1");
});

afterAll(() => {
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
});

describe("GET /leads/sin-wsp — userNames (Task 1, DIAL-04)", () => {
  it("responde con la clave userNames además de leads (shape aditivo)", async () => {
    const r = await request(app).get("/api/setters/leads/sin-wsp").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.leads)).toBe(true);
    expect(typeof r.body.userNames).toBe("object");
  });

  it("incluye el nombre del usuario existente referenciado en callLog[].by", async () => {
    const r = await request(app).get("/api/setters/leads/sin-wsp").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.userNames.user_judith).toBe("Judith Mendez");
  });

  it("NO incluye el id de un usuario borrado (no está en auth.json)", async () => {
    const r = await request(app).get("/api/setters/leads/sin-wsp").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.userNames.user_borrado_inexistente).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(r.body.userNames, "user_borrado_inexistente")).toBe(false);
  });

  it("no viaja ningún email dentro de userNames (T-33-12)", async () => {
    const r = await request(app).get("/api/setters/leads/sin-wsp").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body.userNames)).not.toContain("@");
  });

  it("solo trae los ids referenciados por ESTA cola, no el padrón entero (admin no está en callLog)", async () => {
    const r = await request(app).get("/api/setters/leads/sin-wsp").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.userNames.user_admin).toBeUndefined();
    expect(Object.keys(r.body.userNames)).toEqual(["user_judith"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Task 3 — frontend: bloque [33-04] HISTORY-PURE, cableado y cache-buster.
// Sin browser ni jsdom en el repo: mismo molde que tests/commitment-hoy.test.js
// y tests/dial-sync.test.js.
//   1. Bloque puro (_leadHistoryBrief, _historyWhenLabel, HISTORY_OUTCOME_LABELS)
//      extraído por marcadores y evaluado con `new Function` contra un reloj
//      FIJO (nota #163 de CLAUDE.md: nunca Date.now() real de la corrida).
//   2. Aserciones de fuente sobre el builder NO puro (_leadHistoryHTML) y el
//      cableado en las 3 superficies.
// ─────────────────────────────────────────────────────────────────────────

const HISTORY_START_MARKER = "// ─── [33-04] HISTORY-PURE: INICIO ───";
const HISTORY_END_MARKER = "// ─── [33-04] HISTORY-PURE: FIN ───";

let appJs;
let indexHtml;
let hu; // { _leadHistoryBrief, _historyWhenLabel, HISTORY_OUTCOME_LABELS }

// Extrae el cuerpo `{...}` balanceado de una función/handler a partir del
// literal exacto de su declaración — copiado literal de
// tests/commitment-hoy.test.js / tests/dial-sync.test.js. `startLiteral`
// DEBE terminar en el `{` que abre el cuerpo, no el primer `{` que aparezca
// después (ej. un default param como `opts = {}`).
function extractFunctionBody(text, startLiteral) {
  if (!startLiteral.endsWith("{")) throw new Error("startLiteral debe terminar en '{' (el que abre el cuerpo)");
  const startIdx = text.indexOf(startLiteral);
  if (startIdx === -1) throw new Error(`No se encontró "${startLiteral}"`);
  const braceStart = startIdx + startLiteral.length - 1;
  let depth = 0;
  let i = braceStart;
  for (; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) { i++; break; }
    }
  }
  return text.slice(startIdx, i);
}

function countOccurrences(str, sub) {
  let count = 0;
  let idx = 0;
  while ((idx = str.indexOf(sub, idx)) !== -1) { count++; idx += sub.length; }
  return count;
}

beforeAll(() => {
  appJs = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");
  indexHtml = fs.readFileSync(path.join(process.cwd(), "public", "index.html"), "utf8");

  const startIdx = appJs.indexOf(HISTORY_START_MARKER);
  const endIdx = appJs.indexOf(HISTORY_END_MARKER);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(`No se encontraron los marcadores HISTORY-PURE en public/app.js (start=${startIdx}, end=${endIdx}).`);
  }
  const block = appJs.slice(startIdx, endIdx);
  const factory = new Function(
    block + `
    return { _leadHistoryBrief, _historyWhenLabel, HISTORY_OUTCOME_LABELS };
    `
  );
  hu = factory();
});

describe("HISTORY-PURE: las 3 piezas viven dentro del bloque de marcadores", () => {
  it("HISTORY_OUTCOME_LABELS, _historyWhenLabel y _leadHistoryBrief caen DENTRO del rango [33-04] HISTORY-PURE", () => {
    const startIdx = appJs.indexOf(HISTORY_START_MARKER);
    const endIdx = appJs.indexOf(HISTORY_END_MARKER);
    for (const lit of ["const HISTORY_OUTCOME_LABELS = {", "function _historyWhenLabel(", "function _leadHistoryBrief("]) {
      const idx = appJs.indexOf(lit);
      expect(idx).toBeGreaterThan(startIdx);
      expect(idx).toBeLessThan(endIdx);
    }
  });

  it("el bloque no referencia document/localStorage/fetch(/Date.now(/transcript (autocontenido)", () => {
    const startIdx = appJs.indexOf(HISTORY_START_MARKER);
    const endIdx = appJs.indexOf(HISTORY_END_MARKER);
    const block = appJs.slice(startIdx, endIdx);
    expect(block).not.toMatch(/document\.|localStorage|fetch\(|Date\.now\(/);
    expect(block).not.toMatch(/transcript/);
  });
});

describe("_leadHistoryBrief(lead, nowMs, opts) — D-12 (sin historial, sin bloque)", () => {
  const nowMs = new Date(2026, 7, 15, 12, 0).getTime(); // sábado 15/08/2026 12:00, fijo

  it("lead sin callLog, sin notas y sin compromiso → has:false, resto null/0", () => {
    const brief = hu._leadHistoryBrief({ callLog: [], notes: [], commitment: null }, nowMs);
    expect(brief).toEqual({ has: false, last: null, note: null, commitment: null, attempts: 0 });
  });

  it("lead sin ninguno de esos campos definidos (undefined) → has:false", () => {
    const brief = hu._leadHistoryBrief({}, nowMs);
    expect(brief.has).toBe(false);
  });

  it("lead null/undefined → has:false, no revienta", () => {
    expect(hu._leadHistoryBrief(null, nowMs).has).toBe(false);
    expect(hu._leadHistoryBrief(undefined, nowMs).has).toBe(false);
  });
});

describe("_leadHistoryBrief — última disposición (last)", () => {
  const nowMs = new Date(2026, 7, 15, 12, 0).getTime();
  const DAY_MS = 86400000;

  it("una sola entry → has:true, last.label mapeado y attempts = callLog.length", () => {
    const lead = { callLog: [{ ts: new Date(nowMs - DAY_MS).toISOString(), outcome: "answered_interested", by: "user_x" }] };
    const brief = hu._leadHistoryBrief(lead, nowMs, { userName: () => "Judith" });
    expect(brief.has).toBe(true);
    expect(brief.last.label).toBe("Interesado");
    expect(brief.attempts).toBe(1);
  });

  it("attempts usa lead.callAttempts si es number, ignora callLog.length", () => {
    const lead = { callAttempts: 7, callLog: [{ ts: new Date(nowMs).toISOString(), outcome: "no_answer" }] };
    const brief = hu._leadHistoryBrief(lead, nowMs);
    expect(brief.attempts).toBe(7);
  });

  it("last toma la entry de MAYOR ts aunque el array venga desordenado", () => {
    const lead = {
      callLog: [
        { ts: new Date(nowMs - DAY_MS).toISOString(), outcome: "no_answer" },
        { ts: new Date(nowMs - 5 * DAY_MS).toISOString(), outcome: "voicemail" },
        { ts: new Date(nowMs).toISOString(), outcome: "answered_interested" }, // el más reciente, en el medio del array
      ],
    };
    const brief = hu._leadHistoryBrief(lead, nowMs);
    expect(brief.last.outcome).toBe("answered_interested");
  });

  it("by se resuelve con el resolver inyectado (id existente)", () => {
    const lead = { callLog: [{ ts: new Date(nowMs).toISOString(), outcome: "no_answer", by: "user_judith" }] };
    const brief = hu._leadHistoryBrief(lead, nowMs, { userName: (id) => (id === "user_judith" ? "Judith Mendez" : "") });
    expect(brief.last.by).toBe("Judith Mendez");
  });

  it("by con un id que NO resuelve (usuario borrado) → '' y el bloque igual se arma", () => {
    const lead = { callLog: [{ ts: new Date(nowMs).toISOString(), outcome: "no_answer", by: "user_borrado" }] };
    const brief = hu._leadHistoryBrief(lead, nowMs, { userName: () => "" });
    expect(brief.has).toBe(true);
    expect(brief.last.by).toBe("");
  });

  it("entry sin `by` → by ''  (nunca llama al resolver con undefined)", () => {
    const lead = { callLog: [{ ts: new Date(nowMs).toISOString(), outcome: "no_answer" }] };
    const brief = hu._leadHistoryBrief(lead, nowMs, { userName: () => { throw new Error("no debería llamarse"); } });
    expect(brief.last.by).toBe("");
  });

  it("outcome sin mapear en HISTORY_OUTCOME_LABELS → cae al outcome crudo", () => {
    const lead = { callLog: [{ ts: new Date(nowMs).toISOString(), outcome: "outcome_inexistente" }] };
    const brief = hu._leadHistoryBrief(lead, nowMs);
    expect(brief.last.label).toBe("outcome_inexistente");
  });
});

describe("_leadHistoryBrief — última nota (note)", () => {
  const nowMs = new Date(2026, 7, 15, 12, 0).getTime();

  it("toma la ÚLTIMA nota (no la primera) con su texto, by y when", () => {
    const lead = {
      notes: [
        { text: "primera nota", by: "Alguien", date: new Date(nowMs - 5 * 86400000).toISOString() },
        { text: "nota más reciente", by: "Judith Mendez", date: new Date(nowMs).toISOString() },
      ],
    };
    const brief = hu._leadHistoryBrief(lead, nowMs);
    expect(brief.note.text).toBe("nota más reciente");
    expect(brief.note.by).toBe("Judith Mendez");
    expect(brief.note.when).toBe("hoy");
  });

  it("nota larga se trunca a 140 caracteres con elipsis", () => {
    const longText = "x".repeat(200);
    const lead = { notes: [{ text: longText, by: "Judith", date: new Date(nowMs).toISOString() }] };
    const brief = hu._leadHistoryBrief(lead, nowMs);
    expect(brief.note.text.length).toBe(141); // 140 + '…'
    expect(brief.note.text.endsWith("…")).toBe(true);
  });

  it("nota corta (<=140) NO se trunca", () => {
    const lead = { notes: [{ text: "nota corta", by: "Judith", date: new Date(nowMs).toISOString() }] };
    const brief = hu._leadHistoryBrief(lead, nowMs);
    expect(brief.note.text).toBe("nota corta");
  });

  it("el `by` de la nota NO pasa por el resolver de usuarios (ya es un nombre, nota #26)", () => {
    const lead = { notes: [{ text: "hola", by: "NombrePlano", date: new Date(nowMs).toISOString() }] };
    const brief = hu._leadHistoryBrief(lead, nowMs, { userName: () => { throw new Error("no debería llamarse para notas"); } });
    expect(brief.note.by).toBe("NombrePlano");
  });
});

describe("_leadHistoryBrief — compromiso (regla dura de 31-04: estado ALMACENADO, no derivado)", () => {
  const nowMs = new Date(2026, 7, 15, 12, 0).getTime();
  const DAY_MS = 86400000;

  it("estado ALMACENADO 'pendiente' → aparece en el brief", () => {
    const lead = { commitment: { estado: "pendiente", tipo: "enviar_info", dueAt: new Date(nowMs + DAY_MS).toISOString() } };
    const brief = hu._leadHistoryBrief(lead, nowMs, { commitmentLabel: (t) => "mandar info" });
    expect(brief.commitment).not.toBeNull();
    expect(brief.commitment.label).toBe("mandar info");
  });

  it("estado 'cumplido' (cerrado explícito) → NO aparece", () => {
    const lead = { commitment: { estado: "cumplido", tipo: "enviar_info", closedAt: new Date(nowMs).toISOString() } };
    const brief = hu._leadHistoryBrief(lead, nowMs);
    expect(brief.commitment).toBeNull();
  });

  it("estado 'vencido' (cierre explícito 'Ya no aplica') → NO aparece", () => {
    const lead = { commitment: { estado: "vencido", tipo: "enviar_info", closedAt: new Date(nowMs).toISOString() } };
    const brief = hu._leadHistoryBrief(lead, nowMs);
    expect(brief.commitment).toBeNull();
  });

  it("estado 'incumplido' → NO aparece", () => {
    const lead = { commitment: { estado: "incumplido", tipo: "hablar_con_socio", closedAt: new Date(nowMs).toISOString() } };
    const brief = hu._leadHistoryBrief(lead, nowMs);
    expect(brief.commitment).toBeNull();
  });

  it("compromiso pendiente con dueAt PASADO → vencido:true", () => {
    const lead = { commitment: { estado: "pendiente", tipo: "llamar_despues", dueAt: new Date(nowMs - DAY_MS).toISOString() } };
    const brief = hu._leadHistoryBrief(lead, nowMs);
    expect(brief.commitment.vencido).toBe(true);
  });

  it("compromiso pendiente con dueAt FUTURO → vencido:false", () => {
    const lead = { commitment: { estado: "pendiente", tipo: "llamar_despues", dueAt: new Date(nowMs + DAY_MS).toISOString() } };
    const brief = hu._leadHistoryBrief(lead, nowMs);
    expect(brief.commitment.vencido).toBe(false);
  });

  it("un lead SOLO con compromiso pendiente (sin callLog ni notas) ya cuenta como has:true (D-12)", () => {
    const lead = { callLog: [], notes: [], commitment: { estado: "pendiente", tipo: "pensarlo", dueAt: new Date(nowMs + DAY_MS).toISOString() } };
    const brief = hu._leadHistoryBrief(lead, nowMs);
    expect(brief.has).toBe(true);
  });
});

describe("_leadHistoryBrief — defensivo", () => {
  const nowMs = new Date(2026, 7, 15, 12, 0).getTime();

  it("sin opts (resolvers por defecto) no rompe", () => {
    const lead = { callLog: [{ ts: new Date(nowMs).toISOString(), outcome: "no_answer", by: "user_x" }] };
    expect(() => hu._leadHistoryBrief(lead, nowMs)).not.toThrow();
    const brief = hu._leadHistoryBrief(lead, nowMs);
    expect(brief.last.by).toBe(""); // resolver default devuelve ''
  });

  it("no muta el lead que recibe", () => {
    const lead = {
      callLog: [{ ts: new Date(nowMs).toISOString(), outcome: "no_answer", by: "user_x" }],
      notes: [{ text: "nota", by: "X", date: new Date(nowMs).toISOString() }],
      commitment: { estado: "pendiente", tipo: "otro", dueAt: new Date(nowMs).toISOString() },
    };
    const before = JSON.stringify(lead);
    hu._leadHistoryBrief(lead, nowMs, { userName: () => "N", commitmentLabel: () => "L" });
    expect(JSON.stringify(lead)).toBe(before);
  });
});

describe("_historyWhenLabel(ts, nowMs) — hoy / ayer / hace Nd, reloj FIJO", () => {
  const nowMs = new Date(2026, 7, 15, 23, 30).getTime(); // sábado 15/08/2026 23:30
  const DAY_MS = 86400000;

  it("ts sin valor (0/undefined) → ''", () => {
    expect(hu._historyWhenLabel(0, nowMs)).toBe("");
    expect(hu._historyWhenLabel(undefined, nowMs)).toBe("");
  });

  it("mismo día (delta < 24h) → 'hoy'", () => {
    const ts = new Date(2026, 7, 15, 0, 10).getTime(); // mismo día, 23h20 antes
    expect(hu._historyWhenLabel(ts, nowMs)).toBe("hoy");
  });

  it("delta de exactamente 1 día completo → 'ayer'", () => {
    const ts = nowMs - DAY_MS;
    expect(hu._historyWhenLabel(ts, nowMs)).toBe("ayer");
  });

  it("delta de N días (N>1) → 'hace Nd'", () => {
    const ts = nowMs - 3 * DAY_MS;
    expect(hu._historyWhenLabel(ts, nowMs)).toBe("hace 3d");
  });

  it("borde de día a las 23:30: un evento de 23h50 atrás (técnicamente 'ayer' en reloj de pared) sigue devolviendo 'hoy' — misma aritmética de ms cruda que fmtAgo, no calendario", () => {
    // now = 15/08 23:30. ts = 14/08 23:40 → delta 23h50, MENOS de 24h.
    const ts = new Date(2026, 7, 14, 23, 40).getTime();
    expect(hu._historyWhenLabel(ts, nowMs)).toBe("hoy");
  });
});

describe("Anti-deriva: HISTORY_OUTCOME_LABELS === outcomeMap de _renderCallHistory", () => {
  it("mismas claves y mismos valores (copiado literal — si uno cambia sin el otro, este test cae)", () => {
    const m = /const outcomeMap = (\{[\s\S]*?\});/.exec(appJs);
    expect(m).toBeTruthy();
    const outcomeMap = new Function(`return ${m[1]};`)();
    expect(hu.HISTORY_OUTCOME_LABELS).toEqual(outcomeMap);
  });
});

describe("D-13: NUNCA la transcripción expandida en el bloque nuevo", () => {
  it("_leadHistoryBrief no menciona 'transcript' en ningún lado del cuerpo", () => {
    const body = extractFunctionBody(appJs, "function _leadHistoryBrief(lead, nowMs, opts = {}) {");
    expect(body).not.toMatch(/transcript/i);
  });

  it("_leadHistoryHTML no emite '<details' (la transcripción sigue solo en el histórico)", () => {
    const body = extractFunctionBody(appJs, "function _leadHistoryHTML(lead) {");
    expect(body).not.toContain("<details");
    expect(body).not.toMatch(/transcript/i);
  });
});

describe("_leadHistoryHTML — sin emojis (BRAND-SCM)", () => {
  it("el cuerpo no contiene caracteres del rango de pictogramas/emoji", () => {
    const body = extractFunctionBody(appJs, "function _leadHistoryHTML(lead) {");
    // Mismo rango usado en el resto de la suite del proyecto para detectar emojis.
    const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    expect(emojiRegex.test(body)).toBe(false);
  });
});

describe("_leadHistoryHTML — escapado: toda interpolación de dato del lead pasa por escHtml", () => {
  // Cada token aparece 1-2 veces: la interpolación real (siempre precedida de
  // `escHtml(`) y, para los opcionales, un chequeo de truthiness previo
  // (`brief.X ?` / `brief.note && `) que NO renderiza el valor crudo — solo
  // decide si la línea se muestra. Cualquier ocurrencia que no sea NI un
  // escHtml( NI un chequeo de truthiness es una fuga sin escapar.
  it("toda ocurrencia de brief.last.*, brief.note.*, brief.commitment.* y attemptsTxt es escHtml( o un chequeo de truthiness — nunca interpolación cruda", () => {
    const body = extractFunctionBody(appJs, "function _leadHistoryHTML(lead) {");
    for (const tok of [
      "brief.last.label", "brief.last.when", "brief.last.by",
      "brief.note.text", "brief.note.by",
      "brief.commitment.label", "brief.commitment.when",
      "attemptsTxt",
    ]) {
      const re = new RegExp(tok.replace(/\./g, "\\."), "g");
      let m;
      let found = 0;
      let escapedCount = 0;
      while ((m = re.exec(body))) {
        found++;
        const before = body.slice(Math.max(0, m.index - 12), m.index);
        // Ventana amplia + trim: el chequeo de truthiness puede saltar de
        // línea antes del `?` (ej. "brief.note && brief.note.text\n  ? ...").
        const after = body.slice(m.index + tok.length, m.index + tok.length + 12).trimStart();
        const isEscaped = before.endsWith("escHtml(");
        const isTruthyCheck = after.startsWith("?") || after.startsWith("&&");
        const isDeclaration = before.trimEnd().endsWith("const");
        if (isEscaped) escapedCount++;
        expect(isEscaped || isTruthyCheck || isDeclaration).toBe(true);
      }
      expect(found).toBeGreaterThanOrEqual(1);
      expect(escapedCount).toBeGreaterThanOrEqual(1); // al menos UNA interpolación real, escapada
    }
  });
});

describe("Cableado en las 3 superficies de llamada", () => {
  it("_leadHistoryHTML se declara UNA vez y se llama en 3 call sites (4 ocurrencias totales)", () => {
    expect(countOccurrences(appJs, "_leadHistoryHTML(")).toBe(4);
  });

  it("_pdRender: _leadHistoryHTML(lead) va DESPUÉS del header (Bloque 1) y ANTES del ángulo (Bloque 1.5)", () => {
    const posHeader = appJs.indexOf("Bloque 1: Header del lead");
    expect(posHeader).toBeGreaterThan(-1);
    const posHistory = appJs.indexOf("${_leadHistoryHTML(lead)}", posHeader);
    const posB15 = appJs.indexOf("Bloque 1.5: Ángulo de apertura");
    expect(posHistory).toBeGreaterThan(posHeader);
    expect(posHistory).toBeLessThan(posB15);
  });

  it("window._leadFileHtml: rows.push(_leadHistoryHTML(lead)) es el PRIMER push del array rows", () => {
    const body = extractFunctionBody(appJs, "window._leadFileHtml = function(lead, opts = {}) {");
    const rowsDeclIdx = body.indexOf("const rows = [];");
    const firstPushIdx = body.indexOf("rows.push(");
    expect(rowsDeclIdx).toBeGreaterThan(-1);
    expect(firstPushIdx).toBeGreaterThan(rowsDeclIdx);
    expect(body.slice(firstPushIdx, firstPushIdx + 40)).toContain("rows.push(_leadHistoryHTML(lead));");
  });

  it("_callsRenderExpandedPanel: _leadHistoryHTML(l) va DESPUÉS de _expChips y ANTES de ${_briefBlock}", () => {
    const posExp = appJs.indexOf("_expChips.length ?");
    expect(posExp).toBeGreaterThan(-1);
    const posHistory = appJs.indexOf("${_leadHistoryHTML(l)}", posExp);
    const posBrief = appJs.indexOf("${_briefBlock}", posExp);
    expect(posHistory).toBeGreaterThan(posExp);
    expect(posHistory).toBeLessThan(posBrief);
  });
});

describe("window.__userNames — Hoy y Llamadas guardan el mapa (merge, no reemplazo)", () => {
  it("aparece al menos 3 veces en el archivo (2 escrituras con merge + 1 lectura en _leadHistoryHTML)", () => {
    expect(countOccurrences(appJs, "window.__userNames")).toBeGreaterThanOrEqual(3);
  });

  it("las 2 escrituras usan spread (merge), nunca reemplazo directo", () => {
    // Literal fijo (evita parsear el objeto completo — trae un `{}` anidado
    // en `|| {}` que rompe un regex ingenuo de balanceo simple).
    const spreadLit = "window.__userNames = { ...(window.__userNames || {})";
    expect(countOccurrences(appJs, spreadLit)).toBeGreaterThanOrEqual(2);
  });
});

describe("Cache-buster bumpeado (public/index.html)", () => {
  // Baseline REAL leído de disco ANTES de este plan (ver <important_note> del
  // prompt de ejecución): 20260816c (línea 3679, dejado por 33-03/Task 2 de
  // este plan no lo tocó todavía). No se pinea el valor exacto post-bump:
  // cualquier sesión paralela legítima puede volver a bumpearlo por un motivo
  // ajeno a esta fase (ya pasó varias veces, ver 31-03/32-03/32-04/33-01/
  // 33-02/33-03) — se verifica FORMA + estrictamente mayor que el baseline.
  it("app.js?v= tiene forma válida y es estrictamente mayor que el baseline real de este plan (20260816c)", () => {
    const m = /app\.js\?v=(\d{8}[a-z])/.exec(indexHtml);
    expect(m).toBeTruthy();
    expect(m[1] > "20260816c").toBe(true);
  });

  it("app.js?v= aparece una sola vez (no se duplicó la etiqueta)", () => {
    expect(countOccurrences(indexHtml, "app.js?v=")).toBe(1);
  });

  // 2026-08-16: el valor exacto quedó pineado a "20260815f" asumiendo que
  // ningún plan paralelo tocaría style.css — pero sí puede pasar (ver el
  // razonamiento de app.js?v= arriba, misma clase de bug). Una auditoría de
  // verde/jerarquía tipográfica (color/CSS, ajena a este plan) lo bumpeó a
  // 20260816a. Se verifica FORMA, no el valor congelado.
  it("style.css?v= sigue teniendo forma válida", () => {
    const m = /style\.css\?v=(\d{8}[a-z])/.exec(indexHtml);
    expect(m).toBeTruthy();
  });
});

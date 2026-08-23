// Fase 37, plan 04 (SES-03/SES-04): historial de sesiones de discado en Mi
// rendimiento. Sin browser ni jsdom en el repo: mismo molde que
// tests/dial-session-close-ui.test.js (aserciones de fuente, cuerpos
// extraídos por conteo de llaves balanceado, bloque puro evaluado con
// `new Function` — reloj SIEMPRE inyectado por parámetro, nunca Date.now()
// real de la corrida, nota #163 de CLAUDE.md).
//
// Cubre:
//   1. El bloque puro _sesHistoryRows (agrupación por día, sin sumar
//      totales, D-03 "no responder es válido").
//   2. Cableado: _mypLoadSessions colgada de _mypLoad con el setter
//      efectivo, apiUrl(), escHtml, SES_MOOD_LABELS compartido, estado
//      vacío con texto.
//   3. Cache-buster.

import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

let appJs;
let indexHtml;
let ses; // { _sesDurationLabel, _sesClosingModel, _sesHistoryRows, SES_MOOD_LABELS }

// Copiado literal de tests/dial-session-close-ui.test.js — extrae el cuerpo
// `{...}` balanceado de una función/handler a partir del literal exacto de
// su declaración (`startLiteral` DEBE terminar en el `{` que abre el
// cuerpo).
function extractFunctionBody(text, startLiteral, fromIndex = 0) {
  if (!startLiteral.endsWith("{")) throw new Error("startLiteral debe terminar en '{' (el que abre el cuerpo)");
  const startIdx = text.indexOf(startLiteral, fromIndex);
  if (startIdx === -1) throw new Error(`No se encontró "${startLiteral}" desde el índice ${fromIndex}`);
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

const SES_START_MARKER = "// ─── [37-03] SESSION-PURE: INICIO ───";
const SES_END_MARKER = "// ─── [37-03] SESSION-PURE: FIN ───";

// Reloj determinístico: construido con componentes locales explícitos
// (y, m, d, h, mi) — NUNCA depende de cuándo corre la suite ni de la
// timezone del runner, porque tanto `NOW` como los `startedAt` de los
// fixtures se arman con el MISMO constructor local. Agosto = mes índice 7.
function mkLocal(y, m, d, h = 12, mi = 0) {
  return new Date(y, m - 1, d, h, mi, 0, 0).getTime();
}
function isoLocal(y, m, d, h = 12, mi = 0) {
  return new Date(mkLocal(y, m, d, h, mi)).toISOString();
}
const NOW = mkLocal(2026, 8, 23, 15, 0); // "hoy" de referencia para todo el archivo
const TODAY_ISO = new Date(mkLocal(2026, 8, 23, 10, 15)).toISOString();
const YDAY_ISO = new Date(mkLocal(2026, 8, 22, 18, 30)).toISOString();
const FIVE_DAYS_AGO_ISO = new Date(mkLocal(2026, 8, 18, 9, 0)).toISOString();

beforeAll(() => {
  appJs = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");
  indexHtml = fs.readFileSync(path.join(process.cwd(), "public", "index.html"), "utf8");

  const startIdx = appJs.indexOf(SES_START_MARKER);
  const endIdx = appJs.indexOf(SES_END_MARKER);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(`No se encontraron los marcadores SESSION-PURE en public/app.js (start=${startIdx}, end=${endIdx}).`);
  }
  const block = appJs.slice(startIdx, endIdx);
  const factory = new Function(
    block + `
    return { _sesDurationLabel, _sesClosingModel, _sesHistoryRows, SES_MOOD_LABELS };
    `
  );
  ses = factory();
});

// ─────────────────────────────────────────────────────────────────────────
// 0. El bloque sigue siendo autocontenido tras la extensión de 37-04
// ─────────────────────────────────────────────────────────────────────────

describe("SESSION-PURE sigue autocontenido tras sumar SES_MOOD_LABELS/_sesHistoryRows", () => {
  it("_sesHistoryRows y SES_MOOD_LABELS caen DENTRO del rango de marcadores", () => {
    const startIdx = appJs.indexOf(SES_START_MARKER);
    const endIdx = appJs.indexOf(SES_END_MARKER);
    for (const lit of ["function _sesHistoryRows(", "const SES_MOOD_LABELS ="]) {
      const idx = appJs.indexOf(lit);
      expect(idx).toBeGreaterThan(startIdx);
      expect(idx).toBeLessThan(endIdx);
    }
  });

  it("el bloque sigue sin referenciar document/localStorage/fetch(/Date.now(/window. (autocontenido)", () => {
    const startIdx = appJs.indexOf(SES_START_MARKER);
    const endIdx = appJs.indexOf(SES_END_MARKER);
    const block = appJs.slice(startIdx, endIdx);
    expect(block).not.toMatch(/document|localStorage|fetch\(|Date\.now\(|window\./);
  });

  it("SES_MOOD_LABELS se declara exactamente 1 vez en todo el archivo", () => {
    expect(countOccurrences(appJs, "const SES_MOOD_LABELS = {")).toBe(1);
  });

  it("las 4 etiquetas de estado tienen los acentos correctos y los 4 ids de la whitelist del backend", () => {
    expect(ses.SES_MOOD_LABELS).toEqual({ bien: "Bien", normal: "Normal", costo: "Me costó", pesimo: "Pésima" });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 1. _sesHistoryRows — puro
// ─────────────────────────────────────────────────────────────────────────

describe("_sesHistoryRows(sessions, nowMs)", () => {
  it("lista vacía → []", () => {
    expect(ses._sesHistoryRows([], NOW)).toEqual([]);
  });

  it("sesiones de hoy y de ayer → 2 encabezados de día (Hoy / Ayer), las de hoy primero", () => {
    const sessions = [
      { id: "s_yday", startedAt: YDAY_ISO, endedAt: YDAY_ISO, durationS: 600, mode: "calls", closedBy: "user", mood: "", counters: { dials: 4 } },
      { id: "s_today", startedAt: TODAY_ISO, endedAt: TODAY_ISO, durationS: 600, mode: "calls", closedBy: "user", mood: "", counters: { dials: 9 } },
    ];
    const rows = ses._sesHistoryRows(sessions, NOW);
    const dayRows = rows.filter((r) => r.tipo === "dia");
    expect(dayRows.map((r) => r.label)).toEqual(["Hoy", "Ayer"]);
    // Primer row de sesión tras "Hoy" es s_today, no s_yday.
    const firstDayIdx = rows.findIndex((r) => r.tipo === "dia" && r.label === "Hoy");
    expect(rows[firstDayIdx + 1].tipo).toBe("sesion");
    expect(rows[firstDayIdx + 1].dials).toBe(9);
  });

  it("una sesión de hace 5 días → encabezado con la fecha (DD/MM), NO 'Ayer'", () => {
    const rows = ses._sesHistoryRows(
      [{ id: "s_old", startedAt: FIVE_DAYS_AGO_ISO, endedAt: FIVE_DAYS_AGO_ISO, durationS: 300, mode: "calls", closedBy: "user", mood: "", counters: { dials: 3 } }],
      NOW
    );
    const dayRow = rows.find((r) => r.tipo === "dia");
    expect(dayRow.label).not.toBe("Ayer");
    expect(dayRow.label).not.toBe("Hoy");
    expect(dayRow.label).toBe("18/08");
  });

  it("duracion sale de _sesDurationLabel — mismo texto para el mismo durationS", () => {
    const rows = ses._sesHistoryRows(
      [{ id: "s_1", startedAt: TODAY_ISO, endedAt: TODAY_ISO, durationS: 4320, mode: "calls", closedBy: "user", mood: "", counters: { dials: 1 } }],
      NOW
    );
    const row = rows.find((r) => r.tipo === "sesion");
    expect(row.duracion).toBe(ses._sesDurationLabel(4320));
    expect(row.duracion).toBe("1h 12");
  });

  it("mood: '' → el modelo devuelve '', nunca undefined ni 'undefined'", () => {
    const rows = ses._sesHistoryRows(
      [{ id: "s_1", startedAt: TODAY_ISO, endedAt: TODAY_ISO, durationS: 60, mode: "calls", closedBy: "user", mood: "", counters: { dials: 1 } }],
      NOW
    );
    const row = rows.find((r) => r.tipo === "sesion");
    expect(row.mood).toBe("");
    expect(row.mood).not.toBeUndefined();
    expect(String(row.mood)).not.toBe("undefined");
  });

  it("mood ausente del payload (sesión vieja) → también cae a '', no undefined", () => {
    const s = { id: "s_1", startedAt: TODAY_ISO, endedAt: TODAY_ISO, durationS: 60, mode: "calls", closedBy: "user", counters: { dials: 1 } };
    delete s.mood;
    const row = ses._sesHistoryRows([s], NOW).find((r) => r.tipo === "sesion");
    expect(row.mood).toBe("");
  });

  it("closedBy: 'auto' → auto: true", () => {
    const row = ses._sesHistoryRows(
      [{ id: "s_1", startedAt: TODAY_ISO, endedAt: TODAY_ISO, durationS: 60, mode: "calls", closedBy: "auto", mood: "", counters: { dials: 1 } }],
      NOW
    ).find((r) => r.tipo === "sesion");
    expect(row.auto).toBe(true);
  });

  it("closedBy: 'user' → auto: false", () => {
    const row = ses._sesHistoryRows(
      [{ id: "s_1", startedAt: TODAY_ISO, endedAt: TODAY_ISO, durationS: 60, mode: "calls", closedBy: "user", mood: "", counters: { dials: 1 } }],
      NOW
    ).find((r) => r.tipo === "sesion");
    expect(row.auto).toBe(false);
  });

  it("endedAt: null → enCurso: true y sin números (dials/connects/conversations === null)", () => {
    const row = ses._sesHistoryRows(
      [{ id: "s_open", startedAt: TODAY_ISO, endedAt: null, durationS: 0, mode: "calls", closedBy: "", mood: "", counters: null }],
      NOW
    ).find((r) => r.tipo === "sesion");
    expect(row.enCurso).toBe(true);
    expect(row.dials).toBeNull();
    expect(row.connects).toBeNull();
    expect(row.conversations).toBeNull();
  });

  it("counters ausente en una sesión CERRADA (caso raro, defensivo) → 0, no null y no tira", () => {
    const row = ses._sesHistoryRows(
      [{ id: "s_1", startedAt: TODAY_ISO, endedAt: TODAY_ISO, durationS: 60, mode: "calls", closedBy: "user", mood: "", counters: null }],
      NOW
    ).find((r) => r.tipo === "sesion");
    expect(row.dials).toBe(0);
    expect(row.connects).toBe(0);
    expect(row.conversations).toBe(0);
  });

  it("counters ausente en una sesión ABIERTA → no tira, sigue devolviendo null (no 0)", () => {
    expect(() => ses._sesHistoryRows(
      [{ id: "s_1", startedAt: TODAY_ISO, endedAt: null, durationS: 0, mode: "calls", closedBy: "", mood: "" }],
      NOW
    )).not.toThrow();
    const row = ses._sesHistoryRows(
      [{ id: "s_1", startedAt: TODAY_ISO, endedAt: null, durationS: 0, mode: "calls", closedBy: "", mood: "" }],
      NOW
    ).find((r) => r.tipo === "sesion");
    expect(row.dials).toBeNull();
  });

  it("orden: entra desordenado, sale por startedAt descendente (independiente del orden de entrada)", () => {
    const a = { id: "a", startedAt: isoLocal(2026, 8, 20, 10, 0), endedAt: "x", durationS: 60, mode: "calls", closedBy: "user", mood: "", counters: { dials: 1 } };
    const b = { id: "b", startedAt: TODAY_ISO, endedAt: "x", durationS: 60, mode: "calls", closedBy: "user", mood: "", counters: { dials: 2 } };
    const c = { id: "c", startedAt: YDAY_ISO, endedAt: "x", durationS: 60, mode: "calls", closedBy: "user", mood: "", counters: { dials: 3 } };
    const rows = ses._sesHistoryRows([a, b, c], NOW).filter((r) => r.tipo === "sesion");
    expect(rows.map((r) => r.dials)).toEqual([2, 3, 1]); // b (hoy) > c (ayer) > a (hace 3 días)
  });

  it("_sesHistoryRows NO suma nada por día: ningún row de tipo 'dia' trae counters/dials/connects/conversations", () => {
    const sessions = [
      { id: "s_1", startedAt: TODAY_ISO, endedAt: TODAY_ISO, durationS: 60, mode: "calls", closedBy: "user", mood: "", counters: { dials: 5 } },
      { id: "s_2", startedAt: isoLocal(2026, 8, 23, 11, 0), endedAt: "x", durationS: 60, mode: "calls", closedBy: "user", mood: "", counters: { dials: 7 } },
    ];
    const rows = ses._sesHistoryRows(sessions, NOW);
    const dayRows = rows.filter((r) => r.tipo === "dia");
    expect(dayRows).toHaveLength(1); // 2 sesiones el MISMO día = 1 solo encabezado
    for (const r of dayRows) {
      expect(r).not.toHaveProperty("counters");
      expect(r).not.toHaveProperty("dials");
      expect(r).not.toHaveProperty("connects");
      expect(r).not.toHaveProperty("conversations");
      expect(Object.keys(r).sort()).toEqual(["label", "tipo"]);
    }
  });

  it("2 sesiones abiertas + cerradas mezcladas el mismo día siguen bajo 1 solo encabezado", () => {
    const sessions = [
      { id: "s_open", startedAt: isoLocal(2026, 8, 23, 14, 0), endedAt: null, durationS: 0, mode: "hoy", hoyFilter: "callbacks", closedBy: "", mood: "", counters: null },
      { id: "s_closed", startedAt: TODAY_ISO, endedAt: TODAY_ISO, durationS: 300, mode: "calls", closedBy: "user", mood: "bien", counters: { dials: 6 } },
    ];
    const rows = ses._sesHistoryRows(sessions, NOW);
    expect(rows.filter((r) => r.tipo === "dia")).toHaveLength(1);
    expect(rows.filter((r) => r.tipo === "sesion")).toHaveLength(2);
  });

  it("cola trae mode/hoyFilter/queueSize tal cual vinieron del servidor", () => {
    const row = ses._sesHistoryRows(
      [{ id: "s_1", startedAt: TODAY_ISO, endedAt: TODAY_ISO, durationS: 60, mode: "hoy", hoyFilter: "interesados", queueSize: 12, closedBy: "user", mood: "", counters: { dials: 4 } }],
      NOW
    ).find((r) => r.tipo === "sesion");
    expect(row.cola).toEqual({ mode: "hoy", hoyFilter: "interesados", queueSize: 12 });
  });

  it("sessions no-array (null/undefined) → no tira, devuelve []", () => {
    expect(ses._sesHistoryRows(null, NOW)).toEqual([]);
    expect(ses._sesHistoryRows(undefined, NOW)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2. Cableado (aserciones de fuente)
// ─────────────────────────────────────────────────────────────────────────

describe("_mypLoadSessions: declaración única y llamada dentro de _mypLoad", () => {
  it("se declara exactamente 1 vez", () => {
    expect(countOccurrences(appJs, "async function _mypLoadSessions(effectiveSetter) {")).toBe(1);
  });

  it("_mypLoad llama _mypLoadSessions(effectiveSetter) con .catch(", () => {
    const body = extractFunctionBody(appJs, "async function _mypLoad() {");
    expect(body).toContain("_mypLoadSessions(effectiveSetter)");
    const callIdx = body.indexOf("_mypLoadSessions(effectiveSetter)");
    const tail = body.slice(callIdx, callIdx + 120);
    expect(tail).toContain(".catch(");
  });

  it("_mypLoad sigue calculando effectiveSetter con el criterio de la nota #135 (isViewAsSetter)", () => {
    const body = extractFunctionBody(appJs, "async function _mypLoad() {");
    expect(body).toContain("isViewAsSetter");
    expect(body).toContain("realRole === 'admin' && u?.role === 'setter'");
  });
});

describe("El fetch de _mypLoadSessions usa apiUrl( (nunca fetch crudo — reglas #135/#146)", () => {
  it("apiUrl( envuelve la URL del GET a dial-sessions", () => {
    const body = extractFunctionBody(appJs, "async function _mypLoadSessions(effectiveSetter) {");
    expect(body).toContain("apiUrl('/api/setters/dial-sessions?'");
    expect(body).not.toMatch(/fetch\('\/api/); // nunca fetch crudo con ruta relativa cruda
  });

  it("un SDR real nunca manda ?setter= (mismo criterio que _mypLoadPipeline)", () => {
    const body = extractFunctionBody(appJs, "async function _mypLoadSessions(effectiveSetter) {");
    expect(body).toContain("role === 'admin' || role === 'supervisor'");
  });
});

describe("El render usa escHtml sobre los campos que vienen del servidor (T-37-16)", () => {
  it("escHtml aparece varias veces dentro de _mypLoadSessions", () => {
    const body = extractFunctionBody(appJs, "async function _mypLoadSessions(effectiveSetter) {");
    expect(countOccurrences(body, "escHtml(")).toBeGreaterThanOrEqual(5);
  });

  it("el mode/hoyFilter (filtro persistido) se pinta con escHtml, no interpolado crudo", () => {
    const body = extractFunctionBody(appJs, "async function _mypLoadSessions(effectiveSetter) {");
    expect(body).toContain("escHtml(row.label)");
    expect(body).toContain("escHtml(modeLabels[row.cola.mode]");
    expect(body).toContain("escHtml(row.cola.hoyFilter)");
  });
});

describe("SES_MOOD_LABELS: un solo mapa, dos consumidores", () => {
  it("los chips de la pantalla de cierre lo consumen (Object.entries)", () => {
    expect(appJs).toContain("const moodOptions = Object.entries(SES_MOOD_LABELS);");
  });

  it("la columna 'Cómo la remó' del historial lo consume, con guion discreto si el mood es desconocido/vacío", () => {
    const body = extractFunctionBody(appJs, "async function _mypLoadSessions(effectiveSetter) {");
    expect(body).toContain("SES_MOOD_LABELS[row.mood]");
    expect(body).toMatch(/SES_MOOD_LABELS\[row\.mood\]\s*\|\|\s*['"]—['"]/);
  });

  it("un mood inválido en el mapa puro cae a undefined (el guion lo decide SIEMPRE quien consume, nunca el mapa)", () => {
    expect(ses.SES_MOOD_LABELS["no-existe"]).toBeUndefined();
  });
});

describe("Estado vacío: nunca una tabla con encabezados y nada abajo", () => {
  it("el texto guía existe literal en el archivo", () => {
    expect(appJs).toContain("Todavía no registraste ninguna sesión de discado — abrí el Power Dialer y al salir vas a ver acá el resultado.");
  });

  it("_mypLoadSessions corta ANTES de armar la tabla cuando sessions.length es 0", () => {
    const body = extractFunctionBody(appJs, "async function _mypLoadSessions(effectiveSetter) {");
    const emptyIdx = body.indexOf("if (!sessions.length)");
    const tableIdx = body.indexOf("<table");
    expect(emptyIdx).toBeGreaterThan(-1);
    expect(tableIdx).toBeGreaterThan(-1);
    expect(emptyIdx).toBeLessThan(tableIdx);
    // El branch de estado vacío hace return antes de llegar al armado de <table.
    const emptyBranch = body.slice(emptyIdx, tableIdx);
    expect(emptyBranch).toContain("return;");
  });
});

describe("Marcadas es la columna que manda visualmente (D-01)", () => {
  it("la celda de dials va en negrita (font-weight:700), atendieron/conversaciones en tono secundario", () => {
    const body = extractFunctionBody(appJs, "async function _mypLoadSessions(effectiveSetter) {");
    // La fila de sesión cerrada: dials con font-weight:700 antes que la celda de connects.
    const dialsIdx = body.indexOf("font-weight:700");
    const connectsIdx = body.indexOf("${row.connects}");
    expect(dialsIdx).toBeGreaterThan(-1);
    expect(connectsIdx).toBeGreaterThan(-1);
    expect(dialsIdx).toBeLessThan(connectsIdx);
  });
});

describe("Sesión cerrada sola: marca discreta con explicación (T-37-18)", () => {
  it("closedBy 'auto' se traduce a un tag visible con title explicativo", () => {
    const body = extractFunctionBody(appJs, "async function _mypLoadSessions(effectiveSetter) {");
    expect(body).toContain("row.auto");
    expect(body).toContain("cerrada sola");
    expect(body).toMatch(/title="[^"]*cerró sola[^"]*"|title="[^"]*no la cerraste[^"]*"/);
  });
});

describe("public/index.html: sección #myp-sessions dentro de view-myperf", () => {
  it("myp-sessions aparece exactamente 1 vez", () => {
    expect(countOccurrences(indexHtml, "myp-sessions")).toBe(1);
  });

  it("la sección vive DESPUÉS del bloque de Evolución y ANTES de #myp-empty", () => {
    const viewStart = indexHtml.indexOf('id="view-myperf"');
    const evolIdx = indexHtml.indexOf(">Evolución<", viewStart);
    const sessionsIdx = indexHtml.indexOf('id="myp-sessions"', viewStart);
    const emptyIdx = indexHtml.indexOf('id="myp-empty"', viewStart);
    expect(evolIdx).toBeGreaterThan(-1);
    expect(sessionsIdx).toBeGreaterThan(evolIdx);
    expect(emptyIdx).toBeGreaterThan(sessionsIdx);
  });

  it('el label de la sección dice "Sesiones de discado"', () => {
    expect(indexHtml).toContain(">Sesiones de discado<");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 3. Cache-buster
// ─────────────────────────────────────────────────────────────────────────

describe("Cache-buster bumpeado (public/index.html)", () => {
  // Baseline real con el que arrancó este plan (confirmado en disco antes de
  // cualquier edit propio): 20260823b (el que dejó 37-03). No se pinea el
  // valor exacto post-bump: cualquier sesión paralela legítima puede volver
  // a bumpearlo por un motivo ajeno a esta fase — se verifica FORMA +
  // estrictamente mayor que el baseline real (mismo criterio que
  // dial-session-close-ui.test.js).
  it("app.js?v= tiene forma válida y es estrictamente mayor que el baseline real de este plan (20260823b)", () => {
    const m = /app\.js\?v=(\d{8}[a-z])/.exec(indexHtml);
    expect(m).toBeTruthy();
    expect(m[1] > "20260823b").toBe(true);
  });

  it("app.js?v= aparece una sola vez (no se duplicó la etiqueta)", () => {
    expect(countOccurrences(indexHtml, "app.js?v=")).toBe(1);
  });

  it("style.css?v= sigue teniendo forma válida y SIN cambios (este plan no toca la hoja de estilos)", () => {
    const m = /style\.css\?v=(\d{8}[a-z])/.exec(indexHtml);
    expect(m).toBeTruthy();
    expect(m[1]).toBe("20260822a");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 4. Anti-regresión: lo que 37-03 dejó no se tocó
// ─────────────────────────────────────────────────────────────────────────

describe("Anti-regresión: el ciclo de vida de la sesión (37-03) sigue intacto", () => {
  it("_pdSessionOpen / _pdSessionClose / window._pdSessionMood / _pdShowClosing siguen declaradas", () => {
    for (const lit of [
      "function _pdSessionOpen() {",
      "async function _pdSessionClose({ reason } = {}) {",
      "window._pdSessionMood = async function(mood) {",
    ]) {
      expect(appJs).toContain(lit);
    }
    expect(countOccurrences(appJs, "_pdShowClosing")).toBeGreaterThanOrEqual(3);
  });

  it("window.__ses sigue exponiendo exactamente los mismos 2 puros que dejó 37-03 (no se rompió esa superficie)", () => {
    expect(appJs).toContain("window.__ses = { _sesDurationLabel, _sesClosingModel };");
  });
});

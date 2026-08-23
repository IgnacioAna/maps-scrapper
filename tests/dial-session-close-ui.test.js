// Fase 37, plan 03 (SES-02/SES-04): pantalla de cierre única del Power
// Dialer + ciclo de vida de la sesión de discado. Sin browser ni jsdom en el
// repo: mismo molde que tests/dial-hold.test.js (aserciones de fuente,
// cuerpos extraídos por conteo de llaves balanceado) y tests/dial-history
// .test.js (bloque puro evaluado con `new Function`, reloj SIEMPRE inyectado
// por parámetro, nunca Date.now() real de la corrida — nota #163 de
// CLAUDE.md).
//
// Cubre:
//   1. El bloque puro [37-03] SESSION-PURE (_sesDurationLabel,
//      _sesClosingModel) — D-01 (la victoria es marcar) escrito en código.
//   2. Cableado: un solo renderizador de cierre, los 3 caminos de salida
//      pasan por él, el fin de cola usa la MISMA pantalla, los guards de
//      _pd.closing, y que el hold/autopiloto/atajos no se tocaron.
//   3. Cache-buster.

import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

let appJs;
let indexHtml;
let ses; // { _sesDurationLabel, _sesClosingModel }

// Copiado literal de tests/dial-hold.test.js / tests/dial-history.test.js —
// extrae el cuerpo `{...}` balanceado de una función/handler a partir del
// literal exacto de su declaración (`startLiteral` DEBE terminar en el `{`
// que abre el cuerpo, no el primer `{` que aparezca después — ej. un default
// param como `opts = {}`). `fromIndex` opcional permite anclar la búsqueda
// después de cierto punto del archivo, para desambiguar declaraciones que se
// repiten textualmente (ej. varios `document.addEventListener('keydown', ...)`).
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
    return { _sesDurationLabel, _sesClosingModel };
    `
  );
  ses = factory();
});

// ─────────────────────────────────────────────────────────────────────────
// 1. Bloque puro
// ─────────────────────────────────────────────────────────────────────────

describe("SESSION-PURE: las 2 piezas viven dentro del rango de marcadores", () => {
  it("_sesDurationLabel y _sesClosingModel caen DENTRO del rango [37-03] SESSION-PURE", () => {
    const startIdx = appJs.indexOf(SES_START_MARKER);
    const endIdx = appJs.indexOf(SES_END_MARKER);
    for (const lit of ["function _sesDurationLabel(", "function _sesClosingModel("]) {
      const idx = appJs.indexOf(lit);
      expect(idx).toBeGreaterThan(startIdx);
      expect(idx).toBeLessThan(endIdx);
    }
  });

  it("el bloque no referencia document/localStorage/fetch(/Date.now(/window. (autocontenido)", () => {
    const startIdx = appJs.indexOf(SES_START_MARKER);
    const endIdx = appJs.indexOf(SES_END_MARKER);
    const block = appJs.slice(startIdx, endIdx);
    expect(block).not.toMatch(/document|localStorage|fetch\(|Date\.now\(|window\./);
  });

  it("el bloque no define un mapa propio de etiquetas de outcome (grep de 'answered_interested:' dentro del bloque devuelve 0)", () => {
    const startIdx = appJs.indexOf(SES_START_MARKER);
    const endIdx = appJs.indexOf(SES_END_MARKER);
    const block = appJs.slice(startIdx, endIdx);
    expect(block).not.toContain("answered_interested:");
  });

  it("window.__ses expone los 2 puros, FUERA de los marcadores (el bloque no puede contener 'window.')", () => {
    const endIdx = appJs.indexOf(SES_END_MARKER);
    const afterEnd = appJs.slice(endIdx, endIdx + 400);
    expect(afterEnd).toContain("window.__ses = { _sesDurationLabel, _sesClosingModel };");
  });
});

describe("_sesDurationLabel(seconds)", () => {
  it.each([
    [0, "0 min"],
    [59, "0 min"],
    [60, "1 min"],
    [95, "1 min"],
    [3599, "59 min"],
    [3600, "1h 00"],
    [4320, "1h 12"],
  ])("(%i) → %s", (input, expected) => {
    expect(ses._sesDurationLabel(input)).toBe(expected);
  });

  it("negativo → clampea a 0 → '0 min' (nunca negativo)", () => {
    expect(ses._sesDurationLabel(-30)).toBe("0 min");
  });

  it("NaN/undefined/string no numérico → '0 min' (nunca NaN)", () => {
    expect(ses._sesDurationLabel(NaN)).toBe("0 min");
    expect(ses._sesDurationLabel(undefined)).toBe("0 min");
    expect(ses._sesDurationLabel("no-numero")).toBe("0 min");
  });
});

describe("_sesClosingModel(payload, opts) — D-01: el número grande es SIEMPRE dials", () => {
  const bigPayload = {
    session: {
      id: "dsess_1",
      startedAt: "2026-08-23T10:00:00.000Z",
      endedAt: "2026-08-23T11:12:00.000Z",
      durationS: 4320,
      mode: "calls",
      hoyFilter: null,
      queueSize: 40,
      processed: 34,
      mood: "",
      closedBy: "user",
      counters: {
        dials: 34, connects: 20, conversations: 12, appointments: 3, deals: 1,
        totalDurationS: 1800, avgConvDurationS: 90, leads: 30,
        byOutcome: {
          no_answer: 10, answered_interested: 8, voicemail: 6,
          hung_up: 5, wrong_number: 3, scheduled_with_admin: 2,
        },
      },
    },
  };

  it("big.value === counters.dials (NO connects, NO processed) — este test es D-01 escrito en código", () => {
    const model = ses._sesClosingModel(bigPayload, { processedLocal: 999, reason: "salida" });
    expect(model.big.value).toBe(34);
    expect(model.big.value).not.toBe(bigPayload.session.counters.connects);
    expect(model.big.value).not.toBe(999);
  });

  it("big.label habla de marcadas (plural con 34)", () => {
    const model = ses._sesClosingModel(bigPayload, { processedLocal: 0, reason: "salida" });
    expect(model.big.label).toBe("marcadas");
  });

  it("big.sub incluye la duración y, si leads !== dials, cuántos leads distintos", () => {
    const model = ses._sesClosingModel(bigPayload, { processedLocal: 0, reason: "salida" });
    expect(model.big.sub).toContain("1h 12");
    expect(model.big.sub).toContain("30 lead");
  });

  it("dials: 0 → devuelve un modelo mostrable, no null ni excepción", () => {
    const zeroPayload = {
      session: {
        id: "s0", startedAt: "t", durationS: 0, mood: "",
        counters: { dials: 0, connects: 0, conversations: 0, appointments: 0, leads: 0, byOutcome: {} },
      },
    };
    let model;
    expect(() => { model = ses._sesClosingModel(zeroPayload, { processedLocal: 0, reason: "salida" }); }).not.toThrow();
    expect(model).not.toBeNull();
    expect(model.big.value).toBe(0);
    expect(model.degraded).toBe(false);
  });

  it("secondary sale en el orden fijo: atendieron → conversaciones → agendadas", () => {
    const model = ses._sesClosingModel(bigPayload, { processedLocal: 0, reason: "salida" });
    expect(model.secondary.map((s) => s.key)).toEqual(["connects", "conversations", "appointments"]);
    expect(model.secondary.map((s) => s.label)).toEqual(["Atendieron", "Conversaciones", "Agendadas"]);
    expect(model.secondary.map((s) => s.value)).toEqual([20, 12, 3]);
  });

  it("breakdown ordenado descendente por n, y su suma == dials", () => {
    const model = ses._sesClosingModel(bigPayload, { processedLocal: 0, reason: "salida" });
    const ns = model.breakdown.map((b) => b.n);
    expect(ns).toEqual([...ns].sort((a, b) => b - a));
    expect(ns.reduce((a, b) => a + b, 0)).toBe(34);
  });

  it("a igualdad de n, el desempate es alfabético por outcome (determinístico)", () => {
    const tiePayload = {
      session: {
        id: "s2", startedAt: "t", durationS: 100, mood: "",
        counters: { dials: 5, connects: 0, conversations: 0, appointments: 0, leads: 5, byOutcome: { wrong_number: 2, invalid_number: 2, no_answer: 1 } },
      },
    };
    const model = ses._sesClosingModel(tiePayload, { processedLocal: 0, reason: "salida" });
    expect(model.breakdown.map((b) => b.outcome)).toEqual(["invalid_number", "wrong_number", "no_answer"]);
  });

  it("breakdown NO trae etiquetas propias — cada item es { outcome, n }, sin `label`", () => {
    const model = ses._sesClosingModel(bigPayload, { processedLocal: 0, reason: "salida" });
    for (const item of model.breakdown) {
      expect(Object.keys(item).sort()).toEqual(["n", "outcome"]);
    }
  });

  it("con previous → comparación con el signo correcto (positivo, negativo y cero)", () => {
    const mkPayload = (prevDials) => ({
      ...bigPayload,
      previous: { id: "p1", startedAt: "2026-08-22T10:00:00.000Z", endedAt: "2026-08-22T11:00:00.000Z", durationS: 3000, counters: { dials: prevDials } },
    });
    expect(ses._sesClosingModel(mkPayload(10), { processedLocal: 0, reason: "salida" }).comparison).toEqual({ prevDials: 10, diff: 24, when: "2026-08-22T10:00:00.000Z" });
    expect(ses._sesClosingModel(mkPayload(40), { processedLocal: 0, reason: "salida" }).comparison).toEqual({ prevDials: 40, diff: -6, when: "2026-08-22T10:00:00.000Z" });
    expect(ses._sesClosingModel(mkPayload(34), { processedLocal: 0, reason: "salida" }).comparison).toEqual({ prevDials: 34, diff: 0, when: "2026-08-22T10:00:00.000Z" });
  });

  it("sin previous → comparison es null (no una comparación contra 0)", () => {
    const model = ses._sesClosingModel(bigPayload, { processedLocal: 0, reason: "salida" });
    expect(model.comparison).toBeNull();
  });

  it("canMood: true solo si hay session.id y no hubo error", () => {
    const withId = ses._sesClosingModel(bigPayload, { processedLocal: 0, reason: "salida" });
    expect(withId.canMood).toBe(true);

    const noId = { session: { ...bigPayload.session, id: "" } };
    expect(ses._sesClosingModel(noId, { processedLocal: 0, reason: "salida" }).canMood).toBe(false);

    expect(ses._sesClosingModel({ error: true }, { processedLocal: 0, reason: "salida" }).canMood).toBe(false);
  });

  it("degraded: true con error → big.value === opts.processedLocal y hay note", () => {
    const model = ses._sesClosingModel({ error: true }, { processedLocal: 17, reason: "salida" });
    expect(model.degraded).toBe(true);
    expect(model.big.value).toBe(17);
    expect(typeof model.note).toBe("string");
    expect(model.note.length).toBeGreaterThan(0);
    expect(model.canMood).toBe(false);
  });

  it("reason: 'cola_completa' cambia el título y NADA más (mismo big, mismo breakdown)", () => {
    const salida = ses._sesClosingModel(bigPayload, { processedLocal: 0, reason: "salida" });
    const colaCompleta = ses._sesClosingModel(bigPayload, { processedLocal: 0, reason: "cola_completa" });
    expect(salida.title).toBe("Sesión terminada");
    expect(colaCompleta.title).toBe("¡Cola completa!");
    expect(colaCompleta.big).toEqual(salida.big);
    expect(colaCompleta.breakdown).toEqual(salida.breakdown);
    expect(colaCompleta.secondary).toEqual(salida.secondary);
  });

  it("payload null / {} / {session:null} → no tira, devuelve el modelo degradado", () => {
    for (const bad of [null, {}, { session: null }]) {
      let model;
      expect(() => { model = ses._sesClosingModel(bad, { processedLocal: 5, reason: "salida" }); }).not.toThrow();
      expect(model.degraded).toBe(true);
      expect(model.big.value).toBe(5);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2. Cableado (aserciones de fuente)
// ─────────────────────────────────────────────────────────────────────────

describe("Un solo renderizador de cierre", () => {
  it("function _pdShowClosing( se declara exactamente 1 vez", () => {
    expect(countOccurrences(appJs, "async function _pdShowClosing(reason) {")).toBe(1);
  });
});

describe("window._pdExit: primera salida muestra el cierre, el confirm de llamada activa sigue antes", () => {
  it("el confirm de _telnyx?.activeCall aparece ANTES del branch de _pd.closing", () => {
    const body = extractFunctionBody(appJs, "window._pdExit = function() {");
    const confirmIdx = body.indexOf("_telnyx?.activeCall");
    const closingIdx = body.indexOf("if (!_pd.closing)");
    expect(confirmIdx).toBeGreaterThan(-1);
    expect(closingIdx).toBeGreaterThan(confirmIdx);
  });

  it("con !_pd.closing, llama _pdShowClosing('salida') y hace return (no esconde el panel todavía)", () => {
    const body = extractFunctionBody(appJs, "window._pdExit = function() {");
    expect(body).toContain("if (!_pd.closing) {");
    expect(body).toContain("_pdShowClosing('salida');");
    const closingBranchIdx = body.indexOf("if (!_pd.closing) {");
    const showClosingIdx = body.indexOf("_pdShowClosing('salida');");
    const returnAfterIdx = body.indexOf("return;", showClosingIdx);
    const exitFinalIdx = body.indexOf("_pdExitFinal();");
    expect(showClosingIdx).toBeGreaterThan(closingBranchIdx);
    expect(returnAfterIdx).toBeGreaterThan(showClosingIdx);
    // _pdExitFinal() (la salida real) queda DESPUÉS del bloque de la
    // primera salida — es el camino cuando _pd.closing ya es true.
    expect(exitFinalIdx).toBeGreaterThan(returnAfterIdx);
  });

  it("con _pd.closing ya true, llama a _pdExitFinal() (la salida real)", () => {
    const body = extractFunctionBody(appJs, "window._pdExit = function() {");
    expect(body).toContain("_pdExitFinal();");
  });
});

describe("Fin de cola unificado (_pdAdvance usa la MISMA pantalla)", () => {
  it("_pdAdvance llama _pdShowClosing('cola_completa') al agotar la cola", () => {
    const body = extractFunctionBody(appJs, "function _pdAdvance() {");
    expect(body).toContain("_pdShowClosing('cola_completa')");
  });

  it("_pdAdvance ya NO tiene el HTML propio de '¡Cola completa!' ni el texto 'Procesaste '", () => {
    const body = extractFunctionBody(appJs, "function _pdAdvance() {");
    expect(body).not.toContain("¡Cola completa!");
    expect(body).not.toContain("Procesaste ");
  });

  it("'Procesaste ' no aparece en NINGÚN lado del archivo (el resumen viejo desapareció)", () => {
    expect(countOccurrences(appJs, "Procesaste ")).toBe(0);
  });
});

describe("Guards de _pd.closing: sin tarjeta abajo, nadie actúa", () => {
  it("_pdRender arranca con el guard `if (_pd.closing) return;`", () => {
    const body = extractFunctionBody(appJs, "function _pdRender() {");
    const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
    expect(lines[1]).toBe("if (_pd.closing) return; // Fase 37 (SES-02): la pantalla de cierre es la única dueña de #pd-current-content");
  });

  it("_pdAdvance arranca con el guard `if (_pd.closing) return;`", () => {
    const body = extractFunctionBody(appJs, "function _pdAdvance() {");
    const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
    expect(lines[1]).toBe("if (_pd.closing) return; // Fase 37 (SES-02): ya no hay tarjeta, nada que avanzar");
  });

  it("el handler de teclado del dialer tiene el guard DESPUÉS de `if (!_pd.active) return;` y ANTES de `e.key >= '1'`", () => {
    const anchorIdx = appJs.indexOf("// Shortcuts globales para power dialer");
    expect(anchorIdx).toBeGreaterThan(-1);
    const body = extractFunctionBody(appJs, "document.addEventListener('keydown', (e) => {", anchorIdx);
    const activeIdx = body.indexOf("if (!_pd.active) return;");
    const closingIdx = body.indexOf("if (_pd.closing && e.key !== 'Escape') return;");
    const oneToNineIdx = body.indexOf("e.key >= '1'");
    expect(activeIdx).toBeGreaterThan(-1);
    expect(closingIdx).toBeGreaterThan(activeIdx);
    expect(oneToNineIdx).toBeGreaterThan(closingIdx);
  });

  it("ese mismo handler deja pasar Escape aun con _pd.closing (la salida real sigue andando)", () => {
    const anchorIdx = appJs.indexOf("// Shortcuts globales para power dialer");
    const body = extractFunctionBody(appJs, "document.addEventListener('keydown', (e) => {", anchorIdx);
    expect(body).toContain("if (_pd.closing && e.key !== 'Escape') return;");
    expect(body).toContain("if (e.key === 'Escape')");
  });
});

describe("Regresión: _pdKeyOutcomes no cambió (la fase no toca atajos)", () => {
  it("sigue teniendo exactamente los 9 outcomes de siempre, en el mismo orden", () => {
    expect(appJs).toContain(
      "const _pdKeyOutcomes = ['answered_interested','scheduled_with_admin','answered_not_interested','hung_up','no_answer','voicemail','callback_later','wrong_number','invalid_number'];"
    );
  });
});

describe("_pdSessionOpen: se llama dentro de window._pdStart, DESPUÉS del último early-return de cola vacía", () => {
  it("posición: _pdSessionOpen() aparece después del último `return;` de los early-return", () => {
    const body = extractFunctionBody(appJs, "window._pdStart = async function(mode, opts = {}) {");
    const lastReturnIdx = body.lastIndexOf("return;");
    const openCallIdx = body.indexOf("_pdSessionOpen();");
    expect(lastReturnIdx).toBeGreaterThan(-1);
    expect(openCallIdx).toBeGreaterThan(-1);
    expect(openCallIdx).toBeGreaterThan(lastReturnIdx);
  });

  it("junto a _pdSessionOpen(), _pdStart resetea _pd.closing y todo _pdSession a su estado inicial", () => {
    const body = extractFunctionBody(appJs, "window._pdStart = async function(mode, opts = {}) {");
    expect(body).toContain("_pd.closing = false;");
    expect(body).toContain("_pdSession.id = null;");
    expect(body).toContain("_pdSession.opening = null;");
    expect(body).toContain("_pdSession.error = false;");
  });
});

describe("_pdSessionClose: espera la apertura y tiene la gracia de 250ms", () => {
  it("contiene `await _pdSession.opening` y el setTimeout de gracia de 250ms", () => {
    const body = extractFunctionBody(appJs, "async function _pdSessionClose({ reason } = {}) {");
    expect(body).toContain("await _pdSession.opening;");
    expect(body).toContain("setTimeout(resolve, 250)");
  });

  it("sin _pdSession.id, devuelve { error: true } sin llamar a fetch", () => {
    const body = extractFunctionBody(appJs, "async function _pdSessionClose({ reason } = {}) {");
    const idx = body.indexOf("if (!_pdSession.id) return { error: true };");
    expect(idx).toBeGreaterThan(-1);
    // la gracia y el POST van DESPUÉS del guard de id — no se paga la
    // gracia de 250ms si ni siquiera hay sesión abierta.
    const graceIdx = body.indexOf("setTimeout(resolve, 250)");
    expect(graceIdx).toBeGreaterThan(idx);
  });
});

describe("Los 3 fetch nuevos usan apiUrl( (nunca fetch crudo — reglas #135/#146)", () => {
  it("abrir/cerrar/PATCH mood pasan los 3 por apiUrl(", () => {
    expect(appJs).toContain("fetch(apiUrl('/api/setters/dial-sessions'), {");
    expect(appJs).toContain("fetch(apiUrl(`/api/setters/dial-sessions/${_pdSession.id}/close`), {");
    expect(appJs).toContain("fetch(apiUrl(`/api/setters/dial-sessions/${_pdSession.id}`), {");
  });
});

describe("Los números de la sesión NO salen del chip de meta diaria (SES-05)", () => {
  it("_pdShowClosing no menciona _pdTodayStats ni callsLeadsCache", () => {
    const body = extractFunctionBody(appJs, "async function _pdShowClosing(reason) {");
    expect(body).not.toContain("_pdTodayStats");
    expect(body).not.toContain("callsLeadsCache");
  });
});

describe("Estado del operador (SES-04): 4 chips + PATCH opcional que nunca bloquea", () => {
  it("los 4 moods bien|normal|costo|pesimo aparecen como data-mood en el HTML de la pantalla de cierre", () => {
    expect(appJs).toContain("[['bien', 'Bien'], ['normal', 'Normal'], ['costo', 'Me costó'], ['pesimo', 'Pésima']]");
    expect(appJs).toContain('data-mood="${id}"');
  });

  it("window._pdSessionMood existe y hace PATCH", () => {
    expect(appJs).toContain("window._pdSessionMood = async function(mood) {");
    const body = extractFunctionBody(appJs, "window._pdSessionMood = async function(mood) {");
    expect(body).toContain("method: 'PATCH'");
  });

  it("window._pdSessionMood nunca puede impedir la salida: no llama a _pdExit ni a _pdExitFinal", () => {
    const body = extractFunctionBody(appJs, "window._pdSessionMood = async function(mood) {");
    expect(body).not.toContain("_pdExit(");
    expect(body).not.toContain("_pdExitFinal(");
  });
});

describe("Exposición en window: solo lo que el plan pide", () => {
  it("window._pdSessionMood y window.__ses existen", () => {
    expect(appJs).toContain("window._pdSessionMood = async function(mood) {");
    expect(appJs).toContain("window.__ses = { _sesDurationLabel, _sesClosingModel };");
  });

  it("_pdSessionOpen existe como función interna del bloque, NO se expone en window", () => {
    expect(appJs).toContain("function _pdSessionOpen() {");
    expect(appJs).not.toContain("window._pdSessionOpen");
  });

  it("_pdSessionClose existe como función interna del bloque, NO se expone en window (mismo criterio que _pdHold)", () => {
    expect(appJs).toContain("async function _pdSessionClose({ reason } = {}) {");
    expect(appJs).not.toContain("window._pdSessionClose");
  });
});

describe("Anti-regresión: el hold, el autopiloto y el resto del dialer no se tocaron en esta fase", () => {
  it("_pdHold sigue existiendo tal cual (_pd.holdCurrent = true una sola vez en todo el archivo)", () => {
    expect(countOccurrences(appJs, "_pd.holdCurrent = true")).toBe(1);
  });

  it("_pdToggleAutopilot / _pdStartAutopilotCountdown / _pdBuildQueue / _pdBuildQueueHoy siguen declaradas", () => {
    for (const fn of ["_pdToggleAutopilot", "_pdStartAutopilotCountdown", "_pdBuildQueue", "_pdBuildQueueHoy"]) {
      expect(appJs).toContain(fn);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 3. Cache-buster
// ─────────────────────────────────────────────────────────────────────────

describe("Cache-buster bumpeado (public/index.html)", () => {
  // Baseline real con el que arrancó este plan (confirmado en disco antes de
  // cualquier edit): 20260823a. No se pinea el valor exacto post-bump:
  // cualquier sesión paralela legítima puede volver a bumpearlo por un
  // motivo ajeno a esta fase (mismo criterio que 31-03/32-03/33-01/33-04) —
  // se verifica FORMA + estrictamente mayor que el baseline real.
  it("app.js?v= tiene forma válida y es estrictamente mayor que el baseline real de este plan (20260823a)", () => {
    const m = /app\.js\?v=(\d{8}[a-z])/.exec(indexHtml);
    expect(m).toBeTruthy();
    expect(m[1] > "20260823a").toBe(true);
  });

  it("app.js?v= aparece una sola vez (no se duplicó la etiqueta)", () => {
    expect(countOccurrences(indexHtml, "app.js?v=")).toBe(1);
  });

  it("style.css?v= sigue teniendo forma válida (NO se tocó en este plan)", () => {
    const m = /style\.css\?v=(\d{8}[a-z])/.exec(indexHtml);
    expect(m).toBeTruthy();
  });
});

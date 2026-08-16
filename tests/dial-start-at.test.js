// Test del punto de entrada puntual al Power Dialer — DIAL-01, Fase 33 Plan
// 01. Sin browser ni jsdom en el repo: mismo molde que
// tests/act-ui-whatsapp.test.js / tests/act-ui-discard-material.test.js.
//
// 1. Lógica pura del posicionamiento: se replica el cálculo de índice en el
//    propio test y se lo cruza contra la fuente real (no una
//    reimplementación libre — assertions de fuente sobre los literales
//    exactos de _pdStart).
// 2. Aserciones de fuente (cableado real de las 4 superficies + la cola del
//    propio dialer + los guards D-02/D-03/guard de expulsión), extrayendo
//    cuerpos de función por conteo de llaves balanceado — mismo helper que
//    act-ui-discard-material.test.js.
// 3. Cache-buster: chequeo de FORMA, nunca un valor pineado (nota de
//    31-03/32-03/32-04: un pin exacto se rompe con cualquier edición
//    legítima y ajena de otra sesión).

import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

let appJs;
let indexHtml;

// Copiado literal de tests/act-ui-discard-material.test.js — extrae el
// cuerpo `{...}` balanceado de una función/handler a partir del literal
// exacto de su declaración (`startLiteral` DEBE terminar en el `{` que abre
// el cuerpo, no el primer `{` que aparezca después — ej. un default param
// como `opts = {}`).
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
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  return text.slice(startIdx, i);
}

function countOccurrences(str, sub) {
  let count = 0;
  let idx = 0;
  while ((idx = str.indexOf(sub, idx)) !== -1) {
    count++;
    idx += sub.length;
  }
  return count;
}

beforeAll(() => {
  appJs = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");
  indexHtml = fs.readFileSync(path.join(process.cwd(), "public", "index.html"), "utf8");
});

describe("Posicionamiento de la cola (lógica pura, DIAL-01)", () => {
  // Réplica exacta del algoritmo de _pdStart — verificada abajo contra la
  // fuente real, no es una reimplementación libre.
  function computeStart(queue, startAtLeadId, leadExists) {
    const q = queue.slice();
    const forced = new Set();
    let currentIdx;
    const hasResolvableSeed = !!(startAtLeadId && leadExists);
    const sIdx = startAtLeadId ? q.indexOf(startAtLeadId) : -1;
    if (sIdx >= 0) {
      currentIdx = sIdx;
    } else if (hasResolvableSeed) {
      q.unshift(startAtLeadId);
      currentIdx = 0;
      forced.add(startAtLeadId);
    } else {
      currentIdx = 0;
    }
    return { queue: q, currentIdx, forced };
  }

  it("lead presente en la cola: currentIdx apunta a su posición y la cola NO cambia de largo", () => {
    const r = computeStart(["a", "b", "c"], "b", true);
    expect(r.currentIdx).toBe(1);
    expect(r.queue).toEqual(["a", "b", "c"]);
    expect(r.forced.size).toBe(0);
  });

  it("lead ausente de la cola pero resoluble: unshift + currentIdx=0 + queda en forced", () => {
    const r = computeStart(["a", "b"], "z", true);
    expect(r.currentIdx).toBe(0);
    expect(r.queue).toEqual(["z", "a", "b"]);
    expect(r.forced.has("z")).toBe(true);
  });

  it("sin startAtLeadId: currentIdx=0 y la cola queda intacta (comportamiento histórico)", () => {
    const r = computeStart(["a", "b"], undefined, false);
    expect(r.currentIdx).toBe(0);
    expect(r.queue).toEqual(["a", "b"]);
    expect(r.forced.size).toBe(0);
  });

  it("_pdStart contiene el mismo cálculo de índice que la réplica de arriba (aserción de fuente)", () => {
    const body = extractFunctionBody(appJs, "window._pdStart = async function(mode, opts = {}) {");
    expect(body).toContain("const _sIdx = opts.startAtLeadId ? _pd.queue.indexOf(opts.startAtLeadId) : -1;");
    expect(body).toContain("_pd.currentIdx = _sIdx;");
    expect(body).toContain("_pd.queue.unshift(opts.startAtLeadId);");
    expect(body).toContain("_pd.forced.add(opts.startAtLeadId);");
    expect(body).toContain("_pd.currentIdx = 0;");
  });
});

describe("D-02: la cola conserva el resto de los leads (no se arma una cola de 1)", () => {
  it("_pdStart nunca reasigna _pd.queue a un array de un solo elemento", () => {
    const body = extractFunctionBody(appJs, "window._pdStart = async function(mode, opts = {}) {");
    expect(body).not.toMatch(/_pd\.queue\s*=\s*\[/);
  });

  it("_pdDialHere nunca reasigna _pd.queue — usa splice para insertar sin descartar el resto", () => {
    const body = extractFunctionBody(appJs, "window._pdDialHere = async function(leadId, mode) {");
    expect(body).not.toMatch(/_pd\.queue\s*=\s*\[/);
    expect(body).toContain("_pd.queue.splice(_pd.currentIdx, 0, leadId);");
  });
});

describe("D-03: cero modos nuevos — solo 'hoy' y 'calls'", () => {
  it("_pdInferDialerMode solo devuelve 'hoy' o 'calls'", () => {
    const body = extractFunctionBody(appJs, "function _pdInferDialerMode() {");
    expect(body).toContain("'hoy'");
    expect(body).toContain("'calls'");
    const quoted = (body.match(/'[^']+'/g) || []).filter((q) => !q.includes("#") && !q.includes("."));
    expect(quoted.sort()).toEqual(["'calls'", "'hoy'"]);
  });

  it("_pdDialHere no introduce ningún modo nuevo (no asigna _pd.mode)", () => {
    const body = extractFunctionBody(appJs, "window._pdDialHere = async function(leadId, mode) {");
    expect(body).not.toContain("_pd.mode =");
  });
});

describe("Guard de expulsión de _pdRender respeta _pd.forced", () => {
  it("el cuerpo de _pdRender contiene el guard extendido (!_pd.holdCurrent && !_pd.forced.has(currentId))", () => {
    const body = extractFunctionBody(appJs, "function _pdRender() {");
    expect(body).toContain("!_pd.holdCurrent && !_pd.forced.has(currentId)");
  });
});

describe("Cableado del botón 'Discar acá' en las 4 superficies + la cola del dialer", () => {
  it("_actButtonsHTML emite window._pdDialHere( en la variante 'ficha'", () => {
    const body = extractFunctionBody(appJs, "function _actButtonsHTML(leadId, opts = {}) {");
    expect(body).toContain('class="call-action-btn" onclick="window._pdDialHere(\'${id}\')"');
  });

  it("_actButtonsHTML emite window._pdDialHere( en la variante 'hoy'", () => {
    const body = extractFunctionBody(appJs, "function _actButtonsHTML(leadId, opts = {}) {");
    expect(body).toContain('class="hoy-ficha-btn" onclick="window._pdDialHere(\'${id}\')"');
  });

  it("_actButtonsHTML emite window._pdDialHere( en la variante 'row', con stopPropagation adelante (la fila tiene su propio click)", () => {
    const body = extractFunctionBody(appJs, "function _actButtonsHTML(leadId, opts = {}) {");
    expect(body).toContain("event.stopPropagation(); window._pdDialHere('${id}')");
  });

  it("el cuerpo de _actButtonsHTML contiene window._pdDialHere( exactamente 3 veces (row/ficha/hoy)", () => {
    const body = extractFunctionBody(appJs, "function _actButtonsHTML(leadId, opts = {}) {");
    expect(countOccurrences(body, "window._pdDialHere(")).toBe(3);
  });

  it("la rama 'pd' de _actButtonsHTML NO emite el botón — la tarjeta actual del dialer no 'discar acá' sobre sí misma", () => {
    const body = extractFunctionBody(appJs, "function _actButtonsHTML(leadId, opts = {}) {");
    const pdBranchStart = body.indexOf("if (variant === 'pd') {");
    const pdBranchEnd = body.indexOf("if (variant === 'ficha') {");
    expect(pdBranchStart).toBeGreaterThan(-1);
    expect(pdBranchEnd).toBeGreaterThan(pdBranchStart);
    const pdBranch = body.slice(pdBranchStart, pdBranchEnd);
    expect(pdBranch).not.toContain("_pdDialHere");
  });

  it("_pdRender contiene window._pdDialHere( exactamente 1 vez (la fila de la cola siguiente, #pd-queue)", () => {
    const body = extractFunctionBody(appJs, "function _pdRender() {");
    expect(countOccurrences(body, "window._pdDialHere(")).toBe(1);
  });
});

describe("Autopiloto: abrir o saltar NUNCA dispara el autopiloto sobre la tarjeta destino", () => {
  it("_pdDialHere resetea autopilotArmed=false y cancela cualquier countdown antes de saltar", () => {
    const body = extractFunctionBody(appJs, "window._pdDialHere = async function(leadId, mode) {");
    expect(body).toContain("_pd.autopilotArmed = false;");
    expect(body).toContain("_pdCancelAutopilot();");
  });

  it("_pdStart sigue reseteando autopilotArmed=false al abrir sobre el primer lead (comportamiento histórico intacto)", () => {
    const body = extractFunctionBody(appJs, "window._pdStart = async function(mode, opts = {}) {");
    expect(body).toContain("_pd.autopilotArmed = false;");
  });
});

describe("Semilla del lead pedido (re-inyección tras el refresh)", () => {
  it("_pdStart captura la semilla ANTES del refresh y la re-inyecta con _rebuildCallsLeadsIndex() si el refresh la dejó afuera", () => {
    const body = extractFunctionBody(appJs, "window._pdStart = async function(mode, opts = {}) {");
    expect(body).toContain("const seed = opts.startAtLeadId ? _callsLeadsById.get(opts.startAtLeadId) : null;");
    expect(body).toContain("callsLeadsCache.push(seed);");
    expect(body).toContain("_rebuildCallsLeadsIndex();");
  });
});

describe("Cola vacía con lead puntual: no bloquea la apertura del dialer", () => {
  it("_pdStart condiciona el return de cola vacía a la ausencia de un lead puntual resoluble", () => {
    const body = extractFunctionBody(appJs, "window._pdStart = async function(mode, opts = {}) {");
    expect(body).toContain("const hasResolvableSeed = !!(opts.startAtLeadId && _callsLeadsById.get(opts.startAtLeadId));");
    expect(body).toContain("if (_pd.queue.length === 0 && !hasResolvableSeed) {");
  });

  it("_pdStart no exige callsLeadsCache no vacío cuando hay un startAtLeadId puntual", () => {
    const body = extractFunctionBody(appJs, "window._pdStart = async function(mode, opts = {}) {");
    expect(body).toContain("if (!opts.startAtLeadId && callsLeadsCache.length === 0) {");
  });
});

describe("T-33-01: el leadId pasa por escHtml antes de interpolarse en el onclick nuevo", () => {
  it("_actButtonsHTML interpola 'id' — ya escapado por escHtml al principio de la función — en los 3 botones nuevos", () => {
    const body = extractFunctionBody(appJs, "function _actButtonsHTML(leadId, opts = {}) {");
    expect(body).toContain("const id = escHtml(leadId);");
    expect(countOccurrences(body, "window._pdDialHere('${id}')")).toBe(3);
  });

  it("la fila de la cola siguiente de _pdRender escapa el id con escHtml( antes de window._pdDialHere(", () => {
    const body = extractFunctionBody(appJs, "function _pdRender() {");
    expect(body).toContain("window._pdDialHere('${escHtml(l.id)}')");
  });
});

describe("Aserciones de fuente: cache-buster bumpeado (public/index.html)", () => {
  // Baseline REAL con el que arrancó este plan, confirmado en disco antes de
  // cualquier edit: 20260815j, línea 3678. No se pinea un valor exacto
  // post-bump: cualquier sesión paralela legítima puede volver a bumpearlo
  // por un motivo ajeno a esta fase (ya pasó antes, ver 31-03/32-03/32-04) —
  // se verifica FORMA + estrictamente mayor que el baseline real.
  it("app.js?v= tiene forma válida y es estrictamente mayor que el baseline real de este plan (20260815j)", () => {
    const m = /app\.js\?v=(\d{8}[a-z])/.exec(indexHtml);
    expect(m).toBeTruthy();
    expect(m[1] > "20260815j").toBe(true);
  });

  it("app.js?v= aparece una sola vez (no se duplicó la etiqueta)", () => {
    expect(countOccurrences(indexHtml, "app.js?v=")).toBe(1);
  });

  it("style.css?v= sigue teniendo forma válida (NO se tocó en este plan — git diff vacío verificado en el SUMMARY)", () => {
    const m = /style\.css\?v=(\d{8}[a-z])/.exec(indexHtml);
    expect(m).toBeTruthy();
  });
});

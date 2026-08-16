// Test del hold universal del Power Dialer — DIAL-02, Fase 33 Plan 02. Sin
// browser ni jsdom en el repo: mismo molde que tests/act-ui-discard-material
// .test.js / tests/dial-start-at.test.js.
//
// 1. Aserciones de fuente (el único camino al hold, la señal determinística
//    de guardado, y que la heurística vieja desapareció), extrayendo cuerpos
//    de función por conteo de llaves balanceado — mismo helper que las
//    suites anteriores de la Fase 32/33.
// 2. Cache-buster: chequeo de FORMA (regex), nunca un literal pineado (nota
//    de 31-03/32-03/32-04/33-01: un pin exacto se rompe con cualquier
//    edición legítima y ajena de otra sesión).

import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

let appJs;
let indexHtml;

// Copiado literal de tests/act-ui-discard-material.test.js / dial-start-at
// .test.js — extrae el cuerpo `{...}` balanceado de una función/handler a
// partir del literal exacto de su declaración (`startLiteral` DEBE terminar
// en el `{` que abre el cuerpo, no el primer `{` que aparezca después — ej.
// un default param como `opts = {}`).
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

describe("Un solo hold (_pd.holdCurrent = true aparece una única vez)", () => {
  it("_pd.holdCurrent = true aparece exactamente 1 vez en todo el archivo", () => {
    expect(countOccurrences(appJs, "_pd.holdCurrent = true")).toBe(1);
  });

  it("esa única ocurrencia está dentro del cuerpo de _pdHold", () => {
    const body = extractFunctionBody(appJs, "function _pdHold(leadId, outcome, opts = {}) {");
    expect(countOccurrences(body, "_pd.holdCurrent = true")).toBe(1);
  });

  it("_pdHold se declara exactamente una vez y NO se expone en window (interna del bloque del dialer)", () => {
    expect(countOccurrences(appJs, "function _pdHold(leadId, outcome, opts = {}) {")).toBe(1);
    expect(appJs).not.toContain("window._pdHold");
  });
});

describe("Autopiloto (D-05): con autopiloto ON se mantiene el avance automático", () => {
  it("el cuerpo de _pdHold avanza (no holdea) cuando _pd.autopilot es true", () => {
    const body = extractFunctionBody(appJs, "function _pdHold(leadId, outcome, opts = {}) {");
    expect(body).toContain("if (_pd.autopilot && opts.autoAdvance !== false) { _pdAdvance(); return true; }");
  });

  it("el branch de autopiloto corre ANTES de setear holdCurrent (con autopiloto ON nunca se pinta el banner)", () => {
    const body = extractFunctionBody(appJs, "function _pdHold(leadId, outcome, opts = {}) {");
    const autopilotIdx = body.indexOf("if (_pd.autopilot");
    const holdIdx = body.indexOf("_pd.holdCurrent = true");
    expect(autopilotIdx).toBeGreaterThan(-1);
    expect(holdIdx).toBeGreaterThan(autopilotIdx);
  });
});

describe("Guard de tarjeta actual: _pdHold no toca estado si el lead no es la tarjeta activa", () => {
  it("el cuerpo de _pdHold chequea _pd.active y _pd.queue[_pd.currentIdx] !== leadId, devolviendo false sin tocar estado", () => {
    const body = extractFunctionBody(appJs, "function _pdHold(leadId, outcome, opts = {}) {");
    expect(body).toContain("if (!_pd.active || _pd.queue[_pd.currentIdx] !== leadId) return false;");
  });

  it("el guard es la PRIMERA línea del cuerpo (nada se ejecuta antes de validar la tarjeta actual)", () => {
    const body = extractFunctionBody(appJs, "function _pdHold(leadId, outcome, opts = {}) {");
    const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
    // lines[0] es la firma de la función; la primera línea del cuerpo real es lines[1]
    expect(lines[1]).toBe("if (!_pd.active || _pd.queue[_pd.currentIdx] !== leadId) return false;");
  });
});

describe("D-04: sin branching por modo — el hold es idéntico en Llamadas y en las 3 colas de Hoy", () => {
  it("_pdHold no menciona _pd.mode ni _pd.hoyFilter", () => {
    const body = extractFunctionBody(appJs, "function _pdHold(leadId, outcome, opts = {}) {");
    expect(body).not.toContain("_pd.mode");
    expect(body).not.toContain("_pd.hoyFilter");
  });

  it("el guard de expulsión de _pdRender tampoco menciona _pd.mode/_pd.hoyFilter", () => {
    const body = extractFunctionBody(appJs, "function _pdRender() {");
    const guardStart = body.indexOf("if (!_pd.holdCurrent && !_pd.forced.has(currentId)) {");
    expect(guardStart).toBeGreaterThan(-1);
    // El guard de expulsión completo son las 2 líneas de estado terminal +
    // callback futuro (hasta el cierre del `if`, antes del siguiente bloque
    // de construcción de HTML).
    const guardEnd = body.indexOf("const flagHTML");
    expect(guardEnd).toBeGreaterThan(guardStart);
    const guardBlock = body.slice(guardStart, guardEnd);
    expect(guardBlock).not.toContain("_pd.mode");
    expect(guardBlock).not.toContain("_pd.hoyFilter");
  });
});

describe("_pd.pendingSave: escritura, limpieza al entrar, y consumo validado", () => {
  it("la declaración de _pd incluye pendingSave: null", () => {
    expect(appJs).toContain("pendingSave: null,");
  });

  it("_dispoAfterSaved escribe _pd.pendingSave con leadId/outcome/at SOLO si el dialer está activo, y NO llama a _pdHold", () => {
    const body = extractFunctionBody(appJs, "function _dispoAfterSaved(leadId, opts = {}) {");
    expect(body).toContain("if (_pd.active) {");
    expect(body).toContain("_pd.pendingSave = { leadId, outcome: opts.outcome || '', at: Date.now() };");
    expect(body).not.toContain("_pdHold(");
  });

  it("window._pdHandleDisposition limpia _pd.pendingSave = null ANTES de esperar el guardado (arranque limpio)", () => {
    const body = extractFunctionBody(appJs, "window._pdHandleDisposition = async function(leadId, selectEl) {");
    const resetIdx = body.indexOf("_pd.pendingSave = null;");
    const awaitIdx = body.indexOf("await window._handleCallDisposition(leadId, selectEl);");
    expect(resetIdx).toBeGreaterThan(-1);
    expect(awaitIdx).toBeGreaterThan(resetIdx);
  });

  it("_consumeSaved valida leadId Y at (timestamp del arranque) antes de aceptar la señal — T-33-05", () => {
    const body = extractFunctionBody(appJs, "window._pdHandleDisposition = async function(leadId, selectEl) {");
    expect(body).toContain("if (!ps || ps.leadId !== leadId || ps.at < _startedAt) return null;");
    expect(body).toContain("_pd.pendingSave = null;");
  });

  it("_pd.pendingSave = null aparece exactamente 5 veces en todo el archivo: los 3 resets de estado del dialer (_pdStart/_pdAdvance/_pdBack) + 2 dentro del ciclo de vida propio del pendingSave en window._pdHandleDisposition (limpieza al entrar + consumo exitoso en _consumeSaved)", () => {
    expect(countOccurrences(appJs, "_pd.pendingSave = null")).toBe(5);
    const dispoBody = extractFunctionBody(appJs, "window._pdHandleDisposition = async function(leadId, selectEl) {");
    expect(countOccurrences(dispoBody, "_pd.pendingSave = null")).toBe(2);
  });

  it("los 3 resets de estado del dialer viven en _pdStart, _pdAdvance y _pdBack (no en otra parte)", () => {
    const start = extractFunctionBody(appJs, "window._pdStart = async function(mode, opts = {}) {");
    const advance = extractFunctionBody(appJs, "function _pdAdvance() {");
    const back = extractFunctionBody(appJs, "window._pdBack = function() {");
    expect(countOccurrences(start, "_pd.pendingSave = null")).toBe(1);
    expect(countOccurrences(advance, "_pd.pendingSave = null")).toBe(1);
    expect(countOccurrences(back, "_pd.pendingSave = null")).toBe(1);
  });
});

describe("Heurística stillActionable eliminada por completo", () => {
  it("el literal 'stillActionable' no aparece en ningún lado del archivo (ni código ni comentarios)", () => {
    expect(countOccurrences(appJs, "stillActionable")).toBe(0);
  });
});

describe("Los 4 modales siguen siendo esperados por nombre de id", () => {
  it("window._pdHandleDisposition sigue esperando a que los 4 ids de modal queden hidden", () => {
    const body = extractFunctionBody(appJs, "window._pdHandleDisposition = async function(leadId, selectEl) {");
    for (const id of ["call-callback-modal", "call-schedule-modal", "call-objection-modal", "call-next-modal"]) {
      expect(body).toContain(id);
    }
  });

  it("los 4 outcomes que abren modal siguen listados en modalOpening", () => {
    const body = extractFunctionBody(appJs, "window._pdHandleDisposition = async function(leadId, selectEl) {");
    expect(body).toContain(
      "['callback_later','scheduled_with_admin','answered_not_interested','answered_interested'].includes(outcome)"
    );
  });
});

describe("Cancelar un modal no holdea ni avanza", () => {
  it("la rama de modales llama _afterSaved SOLO dentro de `if (ps)` — sin señal (cancel) no se llama nada", () => {
    const body = extractFunctionBody(appJs, "window._pdHandleDisposition = async function(leadId, selectEl) {");
    expect(body).toContain("const ps = _consumeSaved();");
    expect(body).toContain("if (ps) _afterSaved(ps);");
  });

  it("dentro del check de cierre de modales, _pdAdvance() aparece una sola vez (solo el caso lead borrado, no el de cancel)", () => {
    const body = extractFunctionBody(appJs, "window._pdHandleDisposition = async function(leadId, selectEl) {");
    const checkStart = body.indexOf("const check = () => {");
    const checkEnd = body.indexOf("setTimeout(check, 600);");
    expect(checkStart).toBeGreaterThan(-1);
    expect(checkEnd).toBeGreaterThan(checkStart);
    const checkBody = body.slice(checkStart, checkEnd);
    expect(countOccurrences(checkBody, "_pdAdvance()")).toBe(1);
    expect(checkBody).toContain("if (!lead) { _pdAdvance(); return; }");
  });

  it("la rama de outcomes directos tampoco holdea si el polling se agota (POST fallido/handler sin confirmar)", () => {
    const body = extractFunctionBody(appJs, "window._pdHandleDisposition = async function(leadId, selectEl) {");
    expect(body).toContain("if (Date.now() >= _deadline) return; // se agotó: no holdear");
  });
});

describe("T-33-06: el polling de la rama directa tiene techo duro (no gira sin fin)", () => {
  it("el polling directo usa un deadline de 6000ms y reintenta cada 200ms", () => {
    const body = extractFunctionBody(appJs, "window._pdHandleDisposition = async function(leadId, selectEl) {");
    expect(body).toContain("const _deadline = Date.now() + 6000;");
    expect(body).toContain("setTimeout(pollDirect, 200);");
  });
});

describe("Banner (D-06): _pdRender sigue pintando el destino y _pdHold lo completa cuando falta", () => {
  it("el markup del banner '✓ Resultado guardado' sigue existiendo (literal completo, no una submención en comentario)", () => {
    expect(appJs).toContain(
      'font-weight:700; color:var(--success);">✓ Resultado guardado${_pd.holdOutcome && typeof callOutcomeLabel === \'function\' ? \' · \' + escHtml(callOutcomeLabel(_pd.holdOutcome)) : \'\'}</div>'
    );
  });

  it("_pdRender sigue leyendo _pd.holdMeta para pintar la línea de destino (_holdDestLine)", () => {
    const body = extractFunctionBody(appJs, "function _pdRender() {");
    expect(body).toContain("const hm = _pd.holdMeta;");
    expect(body).toContain("const _holdDestLine = hm ? `");
  });

  it("_pdHold completa holdMeta con _dispoDestination cuando está vacío (cubre los caminos con forceToast)", () => {
    const body = extractFunctionBody(appJs, "function _pdHold(leadId, outcome, opts = {}) {");
    expect(body).toContain("if (!_pd.holdMeta) {");
    expect(body).toContain("_pd.holdMeta = _dispoDestination(l, new Date());");
  });
});

describe("Anti-regresión 32-04: _actDiscard sigue avanzando sin holdear", () => {
  it("window._actDiscard conserva _pdAdvance() y NO llama a _pdHold", () => {
    const body = extractFunctionBody(appJs, "window._actDiscard = (leadId) => {");
    expect(body).toContain("if (_pd.active && _pd.queue[_pd.currentIdx] === leadId) _pdAdvance();");
    expect(body).not.toContain("_pdHold(");
  });

  it("window._actDiscard sigue anunciando con forceToast (no cambia el patrón de aviso de 32-04)", () => {
    const body = extractFunctionBody(appJs, "window._actDiscard = (leadId) => {");
    expect(body).toContain("_dispoAnnounce(leadId, { lead: d.lead, forceToast: true });");
  });
});

describe("Cache-buster bumpeado (public/index.html)", () => {
  // Baseline REAL con el que arrancó este plan, confirmado en disco antes de
  // cualquier edit: 20260816a (línea 3678, dejado por 33-01). No se pinea un
  // valor exacto post-bump: cualquier sesión paralela legítima puede volver
  // a bumpearlo por un motivo ajeno a esta fase (ver 31-03/32-03/32-04/33-01)
  // — se verifica FORMA + estrictamente mayor que el baseline real.
  it("app.js?v= tiene forma válida y es estrictamente mayor que el baseline real de este plan (20260816a)", () => {
    const m = /app\.js\?v=(\d{8}[a-z])/.exec(indexHtml);
    expect(m).toBeTruthy();
    expect(m[1] > "20260816a").toBe(true);
  });

  it("app.js?v= aparece una sola vez (no se duplicó la etiqueta)", () => {
    expect(countOccurrences(indexHtml, "app.js?v=")).toBe(1);
  });

  it("style.css?v= sigue teniendo forma válida (NO se tocó en este plan)", () => {
    const m = /style\.css\?v=(\d{8}[a-z])/.exec(indexHtml);
    expect(m).toBeTruthy();
  });
});

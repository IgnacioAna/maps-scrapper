// Fase 38, plan 01 — 5 bordes de interacción encontrados por la auditoría del
// bloque del dialer (public/app.js 6922-8615) del 2026-08-23, sobre las fases
// 35/36/37. Ninguno agrega capacidad de producto: son bordes (guards, un
// contador que se contradice con otro, un contenedor con la condición
// equivocada, un toast que promete lo que no hay).
//
// Sin browser ni jsdom en el repo: mismo molde que tests/dispo-feedback
// .test.js / tests/dial-hold.test.js — aserciones de fuente (cableado, orden,
// única declaración) + comportamiento de las funciones REALES extraídas y
// evaluadas con `new Function`, inyectando stubs mínimos.

import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

let appJs;
let indexHtml;

// Copiado literal del patrón de tests/dial-hold.test.js / tests/dispo-feedback
// .test.js: extrae el cuerpo `{...}` balanceado de una función/bloque a partir
// del literal exacto que abre el cuerpo (`startLiteral` DEBE terminar en '{').
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

// Extrae una declaración suelta (hasta el primer ';' luego del literal de
// arranque) — mismo helper que dispo-feedback.test.js.
function extractStatement(text, startLiteral) {
  const idx = text.indexOf(startLiteral);
  if (idx === -1) throw new Error(`No se encontró "${startLiteral}"`);
  const end = text.indexOf(";", idx);
  if (end === -1) throw new Error(`No se encontró ';' después de "${startLiteral}"`);
  return text.slice(idx, end + 1);
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

// ═══════════════════════════════════════════════════════════════════════
// EDGE-01: el teclado del dialer respeta los modales de disposición
// ═══════════════════════════════════════════════════════════════════════

describe("EDGE-01: _PD_DISPO_MODAL_IDS / _pdAnyDispoModalOpen — fuente única compartida", () => {
  it("_PD_DISPO_MODAL_IDS se declara exactamente 1 vez con los 4 modales", () => {
    expect(countOccurrences(appJs, "const _PD_DISPO_MODAL_IDS = ['call-callback-modal','call-schedule-modal','call-objection-modal','call-next-modal'];")).toBe(1);
  });

  it("_pdAnyDispoModalOpen se declara exactamente 1 vez", () => {
    expect(countOccurrences(appJs, "function _pdAnyDispoModalOpen() {")).toBe(1);
  });

  it("el array local viejo (modalIds) ya NO existe — _pdHandleDisposition usa el helper compartido", () => {
    expect(appJs).not.toContain("const modalIds = ['call-callback-modal','call-schedule-modal','call-objection-modal','call-next-modal'];");
    expect(appJs).not.toContain("const anyOpen = modalIds.some(id => {");
  });

  it("_pdHandleDisposition llama a _pdAnyDispoModalOpen() para esperar a que cierren los modales", () => {
    const body = extractFunctionBody(appJs, "window._pdHandleDisposition = async function(leadId, selectEl) {");
    expect(body).toContain("const anyOpen = _pdAnyDispoModalOpen();");
  });
});

describe("EDGE-01: guard del handler de teclado global — con modal abierto no reacciona a NADA", () => {
  function keydownHandlerBlock() {
    const prefix = "document.addEventListener('keydown', (e) => ";
    const full = extractFunctionBody(appJs, prefix + "{");
    expect(full.startsWith(prefix)).toBe(true);
    return full.slice(prefix.length); // "{ ... }" — arranca en el primer 'if (!_pd.active) return;'
  }

  it("el guard `if (_pdAnyDispoModalOpen()) return;` está presente en el handler global de teclado del dialer", () => {
    const block = keydownHandlerBlock();
    // Confirmar que ESTE bloque es el del dialer (referencia a _pd.active) y
    // no otro de los ~13 `addEventListener('keydown'` del archivo.
    expect(block).toContain("if (!_pd.active) return;");
    expect(block).toContain("if (_pdAnyDispoModalOpen()) return;");
  });

  it("el guard de modal va DESPUÉS del guard de cierre (_pd.closing) y ANTES del manejo de Escape — Escape no debe saltar el guard", () => {
    const block = keydownHandlerBlock();
    const closingIdx = block.indexOf("if (_pd.closing && e.key !== 'Escape') return;");
    const modalGuardIdx = block.indexOf("if (_pdAnyDispoModalOpen()) return;");
    const escapeIdx = block.indexOf("if (e.key === 'Escape')");
    expect(closingIdx).toBeGreaterThan(-1);
    expect(modalGuardIdx).toBeGreaterThan(closingIdx);
    expect(escapeIdx).toBeGreaterThan(modalGuardIdx);
  });

  it("el guard de modal va ANTES de los atajos c/s/b/a/p/n/1-9", () => {
    const block = keydownHandlerBlock();
    const modalGuardIdx = block.indexOf("if (_pdAnyDispoModalOpen()) return;");
    const digitsIdx = block.indexOf("e.key >= '1' && e.key <= '9'");
    expect(digitsIdx).toBeGreaterThan(modalGuardIdx);
  });
});

describe("EDGE-01: comportamiento real de _pdAnyDispoModalOpen (evaluado con new Function, sin jsdom)", () => {
  function buildAnyDispoModalOpen() {
    const idsLine = extractStatement(appJs, "const _PD_DISPO_MODAL_IDS = [");
    const fnBody = extractFunctionBody(appJs, "function _pdAnyDispoModalOpen() {");
    const src = `${idsLine}\n${fnBody}\nreturn _pdAnyDispoModalOpen;`;
    const factory = new Function("document", src);
    return factory;
  }

  // state: { [id]: 'open' | 'hidden' } — un id ausente del mapa simula que el
  // modal ni se creó todavía (getElementById devuelve null).
  function makeDocStub(state = {}) {
    return {
      getElementById: (id) => {
        const s = state[id];
        if (s === undefined) return null;
        return { classList: { contains: (c) => (c === "hidden" ? s === "hidden" : false) } };
      },
    };
  }

  it("ningún modal en el DOM (los 4 ausentes) → false", () => {
    const fn = buildAnyDispoModalOpen()(makeDocStub({}));
    expect(fn()).toBe(false);
  });

  it("los 4 en el DOM pero con class=hidden → false", () => {
    const fn = buildAnyDispoModalOpen()(makeDocStub({
      "call-callback-modal": "hidden",
      "call-schedule-modal": "hidden",
      "call-objection-modal": "hidden",
      "call-next-modal": "hidden",
    }));
    expect(fn()).toBe(false);
  });

  it("call-callback-modal visible (sin class=hidden) → true", () => {
    const fn = buildAnyDispoModalOpen()(makeDocStub({ "call-callback-modal": "open" }));
    expect(fn()).toBe(true);
  });

  it("call-objection-modal visible (el 3ro de la lista) → true", () => {
    const fn = buildAnyDispoModalOpen()(makeDocStub({
      "call-callback-modal": "hidden",
      "call-objection-modal": "open",
    }));
    expect(fn()).toBe(true);
  });

  it("call-next-modal visible (el 4to, próximo paso de Fase 30) → true", () => {
    const fn = buildAnyDispoModalOpen()(makeDocStub({ "call-next-modal": "open" }));
    expect(fn()).toBe(true);
  });
});

describe("EDGE-01: comportamiento real del handler de teclado completo (evaluado con new Function)", () => {
  function buildHandler() {
    const idsLine = extractStatement(appJs, "const _PD_DISPO_MODAL_IDS = [");
    const anyOpenBody = extractFunctionBody(appJs, "function _pdAnyDispoModalOpen() {");
    const keyOutcomesLine = extractStatement(appJs, "const _pdKeyOutcomes = [");
    const prefix = "document.addEventListener('keydown', (e) => ";
    const full = extractFunctionBody(appJs, prefix + "{");
    const block = full.slice(prefix.length); // "{ ... }"
    const src = `${idsLine}\n${anyOpenBody}\n${keyOutcomesLine}\nreturn function(e) ${block};`;
    const factory = new Function("document", "window", "_pd", "_pdCancelAutopilot", "_callsLeadsById", src);
    return factory;
  }

  function makeDocStub(state = {}) {
    return {
      getElementById: (id) => {
        const s = state[id];
        if (s === undefined) return null;
        return { classList: { contains: (c) => (c === "hidden" ? s === "hidden" : false) } };
      },
    };
  }

  function makeEnv(modalState = {}) {
    const calls = { pdExit: 0, pdSkip: 0, pdBack: 0, pdToggleAutopilot: 0, pdHandleDispositionDirect: [], startTelnyxCall: 0 };
    const win = {
      _pdExit: () => { calls.pdExit++; },
      _pdSkip: () => { calls.pdSkip++; },
      _pdBack: () => { calls.pdBack++; },
      _pdToggleAutopilot: () => { calls.pdToggleAutopilot++; },
      _pdHandleDispositionDirect: (id, outcome) => { calls.pdHandleDispositionDirect.push([id, outcome]); },
      _startTelnyxCall: () => { calls.startTelnyxCall++; },
    };
    let cancelCount = 0;
    const pdCancelAutopilot = () => { cancelCount++; };
    const pd = { active: true, closing: false, autopilotTimer: null, queue: ["lead1"], currentIdx: 0 };
    const callsLeadsById = new Map([["lead1", { id: "lead1" }]]);
    const handler = buildHandler()(makeDocStub(modalState), win, pd, pdCancelAutopilot, callsLeadsById);
    return { handler, calls, get cancelCount() { return cancelCount; }, pd };
  }

  it("SIN modal abierto: tecla '1' dispara la disposición directa (answered_interested, primera del grid)", () => {
    const { handler, calls, cancelCount } = makeEnv({});
    handler({ key: "1", target: {} });
    expect(calls.pdHandleDispositionDirect).toEqual([["lead1", "answered_interested"]]);
  });

  it("SIN modal abierto: tecla 's' dispara _pdSkip", () => {
    const { handler, calls } = makeEnv({});
    handler({ key: "s", target: {} });
    expect(calls.pdSkip).toBe(1);
  });

  it("SIN modal abierto: Escape (sin countdown activo) dispara _pdExit", () => {
    const { handler, calls } = makeEnv({});
    handler({ key: "Escape", target: {} });
    expect(calls.pdExit).toBe(1);
  });

  it("CON modal de callback abierto: tecla '1' NO dispara ninguna disposición (no se marca un 2do resultado sobre el mismo lead)", () => {
    const { handler, calls } = makeEnv({ "call-callback-modal": "open" });
    handler({ key: "1", target: {} });
    expect(calls.pdHandleDispositionDirect).toEqual([]);
  });

  it("CON modal de objeción abierto: tecla 's'/'b' NO mueven la cola por debajo del modal", () => {
    const { handler, calls } = makeEnv({ "call-objection-modal": "open" });
    handler({ key: "s", target: {} });
    handler({ key: "b", target: {} });
    expect(calls.pdSkip).toBe(0);
    expect(calls.pdBack).toBe(0);
  });

  it("CON modal de próximo paso abierto: Escape NO llama _pdExit — el modal maneja el suyo, el dialer no sale por debajo", () => {
    const { handler, calls } = makeEnv({ "call-next-modal": "open" });
    handler({ key: "Escape", target: {} });
    expect(calls.pdExit).toBe(0);
  });

  it("CON modal de agendar abierto: 'c'/'a'/'p' tampoco reaccionan", () => {
    const { handler, calls, cancelCount } = makeEnv({ "call-schedule-modal": "open" });
    handler({ key: "c", target: {} });
    handler({ key: "a", target: {} });
    handler({ key: "p", target: {} });
    expect(calls.startTelnyxCall).toBe(0);
    expect(calls.pdToggleAutopilot).toBe(0);
    expect(cancelCount).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// EDGE-02: un solo número para la misma jornada (chip alimentado del canon)
// ═══════════════════════════════════════════════════════════════════════
//
// Opción elegida: (1) — alimentar el chip del dato canónico del servidor
// para HOY (/api/setters/cold-call-metrics?period=today), cacheado en
// _pdTodayCanon y refrescado al abrir el dialer (_pdStart) y después de cada
// disposición guardada (_pdHold), con fallback al cálculo local si el fetch
// falla. Ver SUMMARY.md para el razonamiento completo.

describe("EDGE-02: _pdTodayStats prioriza el canon del servidor sobre el cálculo local", () => {
  function buildTodayCanonModule({ currentUserVal = null, apiUrlImpl, fetchImpl, renderTodaySpy, callsLeadsCacheVal = [] } = {}) {
    const canonVarLine = extractStatement(appJs, "let _pdTodayCanon = null;");
    const fetchFnBody = extractFunctionBody(appJs, "async function _pdFetchTodayCanon() {");
    const statsFnBody = extractFunctionBody(appJs, "function _pdTodayStats() {");
    const src = `
      ${canonVarLine}
      ${fetchFnBody}
      ${statsFnBody}
      return {
        fetchTodayCanon: _pdFetchTodayCanon,
        todayStats: _pdTodayStats,
        getCanon: () => _pdTodayCanon,
        setCanon: (v) => { _pdTodayCanon = v; },
      };
    `;
    const factory = new Function("currentUser", "apiUrl", "fetch", "_pdRenderToday", "callsLeadsCache", src);
    return factory(
      currentUserVal,
      apiUrlImpl || ((p) => p),
      fetchImpl || (async () => ({ ok: true, json: async () => ({ metrics: {} }) })),
      renderTodaySpy || (() => {}),
      callsLeadsCacheVal,
    );
  }

  it("con canon presente, todayStats() devuelve el canon TAL CUAL (nunca recalcula localmente)", () => {
    const mod = buildTodayCanonModule({ callsLeadsCacheVal: [{ callLog: [{ ts: new Date().toISOString(), outcome: "answered_interested" }] }] });
    mod.setCanon({ dials: 9, conversations: 5, interesados: 0, agendados: 2 });
    expect(mod.todayStats()).toEqual({ dials: 9, conversations: 5, interesados: 0, agendados: 2 });
  });

  it("sin canon (null), todayStats() cae al cálculo local sobre callsLeadsCache", () => {
    const todayIso = new Date().toISOString();
    const yesterday = new Date(Date.now() - 2 * 86400000).toISOString();
    const mod = buildTodayCanonModule({
      callsLeadsCacheVal: [
        { callLog: [{ ts: todayIso, outcome: "answered_interested" }, { ts: yesterday, outcome: "no_answer" }] },
      ],
    });
    const s = mod.todayStats();
    expect(s.dials).toBe(1); // solo la entry de HOY cuenta
    expect(s.interesados).toBe(1);
  });

  it("_pdFetchTodayCanon: fetch exitoso llena el canon desde metrics.{dials,conversations,appointments} y NO inventa 'interesados' (nota #157 — no re-implementar el funnel)", async () => {
    let rendered = 0;
    const mod = buildTodayCanonModule({
      fetchImpl: async () => ({ ok: true, json: async () => ({ metrics: { dials: 7, conversations: 4, appointments: 2 } }) }),
      renderTodaySpy: () => { rendered++; },
    });
    await mod.fetchTodayCanon();
    expect(mod.getCanon()).toEqual({ dials: 7, conversations: 4, interesados: 0, agendados: 2 });
    expect(rendered).toBe(1);
  });

  it("_pdFetchTodayCanon: pide período=today", async () => {
    let requestedUrl = "";
    const mod = buildTodayCanonModule({
      fetchImpl: async (url) => { requestedUrl = url; return { ok: true, json: async () => ({ metrics: {} }) }; },
    });
    await mod.fetchTodayCanon();
    expect(requestedUrl).toContain("period=today");
  });

  it("_pdFetchTodayCanon: en modo 'Ver como SDR' (realRole admin, role setter) manda el setter explícito — reglas #135/#146", async () => {
    let requestedUrl = "";
    const mod = buildTodayCanonModule({
      currentUserVal: { realRole: "admin", role: "setter", setterId: "setter_x92" },
      fetchImpl: async (url) => { requestedUrl = url; return { ok: true, json: async () => ({ metrics: {} }) }; },
    });
    await mod.fetchTodayCanon();
    expect(requestedUrl).toContain("setter=setter_x92");
  });

  it("_pdFetchTodayCanon: admin SIN impersonar no manda ?setter= (agregado normal del backend)", async () => {
    let requestedUrl = "";
    const mod = buildTodayCanonModule({
      currentUserVal: { realRole: "admin", role: "admin" },
      fetchImpl: async (url) => { requestedUrl = url; return { ok: true, json: async () => ({ metrics: {} }) }; },
    });
    await mod.fetchTodayCanon();
    expect(requestedUrl).not.toContain("setter=");
  });

  it("_pdFetchTodayCanon: un setter REAL (no impersonado) tampoco manda ?setter= — el backend ya fuerza su propio setterId", async () => {
    let requestedUrl = "";
    const mod = buildTodayCanonModule({
      currentUserVal: { realRole: "setter", role: "setter", setterId: "setter_abc" },
      fetchImpl: async (url) => { requestedUrl = url; return { ok: true, json: async () => ({ metrics: {} }) }; },
    });
    await mod.fetchTodayCanon();
    expect(requestedUrl).not.toContain("setter=");
  });

  it("_pdFetchTodayCanon: si el fetch falla (red caída), el canon queda SIN cambios — el chip nunca debe romperse ni vaciarse", async () => {
    let rendered = 0;
    const mod = buildTodayCanonModule({
      fetchImpl: async () => { throw new Error("network down"); },
      renderTodaySpy: () => { rendered++; },
    });
    mod.setCanon({ dials: 1, conversations: 1, interesados: 0, agendados: 1 });
    await mod.fetchTodayCanon();
    expect(mod.getCanon()).toEqual({ dials: 1, conversations: 1, interesados: 0, agendados: 1 });
    expect(rendered).toBe(0);
  });

  it("_pdFetchTodayCanon: si el server responde no-ok (403/500), el canon queda SIN cambios", async () => {
    const mod = buildTodayCanonModule({
      fetchImpl: async () => ({ ok: false, status: 403 }),
    });
    mod.setCanon({ dials: 3, conversations: 2, interesados: 0, agendados: 0 });
    await mod.fetchTodayCanon();
    expect(mod.getCanon()).toEqual({ dials: 3, conversations: 2, interesados: 0, agendados: 0 });
  });
});

describe("EDGE-02: cableado — _pdStart y _pdHold refrescan el canon", () => {
  it("_pdStart resetea _pdTodayCanon a null y dispara _pdFetchTodayCanon() ANTES del _pdRender() final", () => {
    const body = extractFunctionBody(appJs, "window._pdStart = async function(mode, opts = {}) {");
    const resetIdx = body.indexOf("_pdTodayCanon = null;");
    const fetchIdx = body.indexOf("_pdFetchTodayCanon();");
    const lastRenderIdx = body.lastIndexOf("_pdRender();");
    expect(resetIdx).toBeGreaterThan(-1);
    expect(fetchIdx).toBeGreaterThan(resetIdx);
    expect(lastRenderIdx).toBeGreaterThan(fetchIdx);
  });

  it("_pdHold dispara _pdFetchTodayCanon() tras confirmar el guard de tarjeta actual, ANTES de la rama de autopiloto (cubre autopiloto y hold)", () => {
    const body = extractFunctionBody(appJs, "function _pdHold(leadId, outcome, opts = {}) {");
    const guardIdx = body.indexOf("if (!_pd.active || _pd.queue[_pd.currentIdx] !== leadId) return false;");
    const fetchIdx = body.indexOf("_pdFetchTodayCanon();");
    const autopilotIdx = body.indexOf("if (_pd.autopilot && opts.autoAdvance !== false) { _pdAdvance(); return true; }");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(fetchIdx).toBeGreaterThan(guardIdx);
    expect(autopilotIdx).toBeGreaterThan(fetchIdx);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// EDGE-04: los botones de acción no dependen de los quick-links
// ═══════════════════════════════════════════════════════════════════════

describe("EDGE-04: el contenedor de quick-links/acciones del Power Dialer ya no depende de (mapsUrl||safeW||igUrl||validEmail)", () => {
  function block4() {
    const startIdx = appJs.indexOf("<!-- Bloque 4: Quick-links acción");
    const endIdx = appJs.indexOf("<!-- Bloque 5: Histórico", startIdx);
    expect(startIdx).toBeGreaterThan(-1);
    expect(endIdx).toBeGreaterThan(startIdx);
    return appJs.slice(startIdx, endIdx);
  }

  it("ya NO existe la condición vieja que envolvía todo el bloque (mapsUrl || safeW || igUrl || validEmail) ?", () => {
    const b = block4();
    expect(b).not.toMatch(/\$\{\(mapsUrl \|\| safeW \|\| igUrl \|\| validEmail\)\s*\?/);
  });

  it("el div se abre incondicionalmente y contiene los 4 links opcionales + _actButtonsHTML", () => {
    const b = block4();
    expect(b).toContain('<div style="margin-top:14px; display:flex; gap:6px; flex-wrap:wrap; align-items:center;">');
    expect(b).toContain("${mapsUrl ? `<a href=");
    expect(b).toContain("${safeW ? `<a href=");
    expect(b).toContain("${igUrl ? `<a href=");
    expect(b).toContain("${validEmail ? `<a href=");
    expect(b).toContain("_actButtonsHTML(lead.id, { variant: 'pd' })");
  });

  it("_actButtonsHTML(lead.id, { variant: 'pd' }) sigue siendo un único call site (no se duplicó al sacar la condición)", () => {
    expect(countOccurrences(appJs, "_actButtonsHTML(lead.id, { variant: 'pd' })")).toBe(1);
  });
});

describe("EDGE-04: _actButtonsHTML(variant:'pd') SIEMPRE devuelve contenido — justifica que el contenedor no dependa de los quick-links", () => {
  function buildActButtons() {
    const body = extractFunctionBody(appJs, "function _actButtonsHTML(leadId, opts = {}) {");
    const src = `${body}\nreturn _actButtonsHTML;`;
    const factory = new Function("escHtml", "_callsLeadsById", src);
    return factory;
  }

  it("lead sin discard, sin ningún quick-link (variant pd): igual trae WhatsApp + Descartar", () => {
    const escHtml = (s) => String(s);
    const leadsMap = new Map([["l1", { id: "l1", estado: "sin_contactar" }]]);
    const fn = buildActButtons()(escHtml, leadsMap);
    const html = fn("l1", { variant: "pd" });
    expect(html).toContain("WhatsApp");
    expect(html).toContain("Descartar");
    expect(html.trim().length).toBeGreaterThan(0);
  });

  it("lead ya descartado (variant pd): igual trae contenido (chip bloqueado en vez de vacío)", () => {
    const escHtml = (s) => String(s);
    const leadsMap = new Map([["l1", { id: "l1", estado: "descartado" }]]);
    const fn = buildActButtons()(escHtml, leadsMap);
    const html = fn("l1", { variant: "pd" });
    expect(html).toContain("Descartado");
    expect(html.trim().length).toBeGreaterThan(0);
  });

  it("lead no cacheado en _callsLeadsById (defensivo): igual trae contenido, nunca cadena vacía", () => {
    const escHtml = (s) => String(s);
    const leadsMap = new Map();
    const fn = buildActButtons()(escHtml, leadsMap);
    const html = fn("l-no-cacheado", { variant: "pd" });
    expect(html.trim().length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// EDGE-05: colgar una llamada manual no promete nada
// ═══════════════════════════════════════════════════════════════════════

describe("EDGE-05: el toast y el foco de disposición ya no corren para una llamada manual (_dispoReal===false)", () => {
  function endedBody() {
    return extractFunctionBody(appJs, "function _onTelnyxCallEnded(reason) {");
  }

  it("_dispoReal sigue siendo `!!(leadId && !ghostLead._isManualDial)` — no se tocó su definición", () => {
    const body = endedBody();
    expect(body).toContain("const _dispoReal = !!(leadId && !_callsLeadsById.get(leadId)?._isManualDial);");
  });

  it("el toast ahora branchea por _dispoReal: el mensaje 'Marcá el resultado abajo' solo sale en la rama _dispoReal verdadera", () => {
    const body = endedBody();
    expect(body).toContain("window.showToast?.(_dispoReal");
    // Rama verdadera (llamada real): promete marcar el resultado.
    expect(body).toContain(
      "? `Llamada finalizada · ${Math.floor(durationSecs/60)}:${String(durationSecs%60).padStart(2,'0')} · Marcá el resultado abajo ↓`"
    );
    // Rama falsa (llamada manual, _dispoReal false): informa el fin SIN pedir nada.
    expect(body).toContain(
      ": `Llamada finalizada · ${Math.floor(durationSecs/60)}:${String(durationSecs%60).padStart(2,'0')}`,"
    );
    // La duración del toast también depende de _dispoReal (5s con pedido, 3s sin).
    expect(body).toContain("duration: _dispoReal ? 5000 : 3000");
  });

  it("el bloque de scroll+flash+foco (incluye la navegación a Llamadas y _focusDispositionRow) queda envuelto en if (_dispoReal) — llamada manual no lo ejecuta", () => {
    const body = endedBody();
    // Debe haber DOS apariciones de "if (_dispoReal) {": la del upsert/gate
    // (ya existía) y la nueva que envuelve scroll/foco (Fase 38).
    expect(countOccurrences(body, "if (_dispoReal) {")).toBe(2);
    const secondGuardIdx = body.indexOf("if (_dispoReal) {", body.indexOf("if (_dispoReal) {") + 1);
    expect(secondGuardIdx).toBeGreaterThan(-1);
    const scrollCommentIdx = body.indexOf("// Scroll + flash + open al dropdown de disposition.");
    const navBlockIdx = body.indexOf("if (!_pd.active && document.querySelector('#view-hoy:not(.hidden)')) {");
    const focusCallIdx = body.indexOf("if (!_pd.active) _focusDispositionRow();");
    expect(scrollCommentIdx).toBeGreaterThan(secondGuardIdx);
    expect(navBlockIdx).toBeGreaterThan(secondGuardIdx);
    expect(focusCallIdx).toBeGreaterThan(secondGuardIdx);
    // Y el cierre marcado explícitamente del if agregado por esta fase debe
    // venir DESPUÉS de la llamada a _focusDispositionRow (todo adentro).
    const closeMarkerIdx = body.indexOf("} // Fase 38 (EDGE-05): fin del if (_dispoReal)");
    expect(closeMarkerIdx).toBeGreaterThan(focusCallIdx);
  });

  it("con _dispoReal===false (llamada manual), NADA de eso corre para leadId==null tampoco (guard de arriba, if (leadId && attemptedSecs >= 1))", () => {
    const body = endedBody();
    expect(body).toContain("if (leadId && attemptedSecs >= 1) {");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Salvaguardas: D-01/D-02 (fase 36) y el orden del grid (fase 36) intactos
// ═══════════════════════════════════════════════════════════════════════

describe("Salvaguardas: hold/autopiloto/grid no tocados por este plan", () => {
  it("_pd.holdCurrent = true sigue apareciendo exactamente 1 vez (dentro de _pdHold)", () => {
    expect(countOccurrences(appJs, "_pd.holdCurrent = true")).toBe(1);
  });

  it("el grid del dialer sigue con los 9 outcomes en el mismo orden (D-02, fase 36) — _pdKeyOutcomes sin tocar", () => {
    expect(appJs).toContain("const _pdKeyOutcomes = ['answered_interested','scheduled_with_admin','answered_not_interested','hung_up','no_answer','voicemail','callback_later','wrong_number','invalid_number'];");
  });

  it("_pdExit sigue con las 2 fases (SES-02, fase 37): primera llamada muestra el cierre, no esconde el panel", () => {
    const body = extractFunctionBody(appJs, "window._pdExit = function() {");
    expect(body).toContain("_pdShowClosing('salida');");
    expect(body).toContain("_pdExitFinal();");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Cache-buster
// ═══════════════════════════════════════════════════════════════════════

describe("Cache-buster (public/index.html)", () => {
  it("app.js?v= tiene forma válida y es estrictamente mayor que el baseline real de este plan (20260823c)", () => {
    const m = /app\.js\?v=(\d{8}[a-z])/.exec(indexHtml);
    expect(m).toBeTruthy();
    expect(m[1] > "20260823c").toBe(true);
  });

  it("app.js?v= aparece una sola vez (no se duplicó la etiqueta)", () => {
    expect(countOccurrences(indexHtml, "app.js?v=")).toBe(1);
  });

  it("style.css?v= NO se tocó en este plan — sigue en 20260822a", () => {
    expect(indexHtml).toContain("style.css?v=20260822a");
  });
});

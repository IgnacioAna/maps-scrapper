// Suite de HOY-03/HOY-05 — Fase 34, Plan 03 (34-03-PLAN.md, cierre de fase).
//
// Dos frentes:
// 1. Power Dialer por sección (D-07/D-08): _pdBuildQueueHoy reescrito para
//    las 5 sub-colas + los 3 botones nuevos + el parseo de los 5 modos en
//    window._pdStart.
// 2. Panel de higiene (D-12/D-13/D-14): 3 números, nunca un cero desnudo, y
//    — el blocker que el checker marcó el 2026-08-16 — INVARIANTE al filtro
//    de país (clasifica sobre allLeadsForHygiene, no sobre `leads` ya
//    filtrado por 34-02).
//
// Mismo molde que tests/dial-start-at.test.js / tests/hoy-sections.test.js /
// tests/commitment-hoy.test.js: no hay browser ni jsdom en el repo, así que
// las funciones que tocan `document`/`fetch` se verifican por ASERCIÓN DE
// FUENTE, y la lógica pura (_pdBuildQueueHoy, y el bloque de clasificación de
// higiene dentro de _hoyRenderFromStore) se ejecuta AISLADA con `new
// Function`, extrayendo el cuerpo real por conteo de llaves balanceado —
// nunca una reimplementación libre.

import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

let appJs;
let indexHtml;

// Copiado literal del helper usado en todo el proyecto (act-ui-discard-
// material.test.js, dial-start-at.test.js, hoy-sections.test.js,
// commitment-hoy.test.js): extrae el cuerpo `{...}` balanceado de una
// función a partir del literal exacto de su declaración. `startLiteral`
// DEBE terminar en el `{` que abre el cuerpo (no el primer `{` que aparezca
// después, ej. un default param como `opts = {}`).
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

// Ejecuta _pdBuildQueueHoy en aislamiento — depende solo de `_hoyState` y
// `_callsLeadsById`, ambas inyectables por closure.
// 2026-08-17: se inyecta el bloque DUEAT-PURE REAL (no un stub) — desde que
// _pdBuildQueueHoy filtra por el reloj efectivo del lead, stubearlo dejaría el
// test verificando una réplica en vez de la lógica de producción.
function dueAtBlock() {
  const start = appJs.indexOf("// ─── [34-06] DUEAT-PURE: INICIO ───");
  const end = appJs.indexOf("// ─── [34-06] DUEAT-PURE: FIN ───");
  if (start === -1 || end === -1) throw new Error("No encontré los marcadores DUEAT-PURE");
  return appJs.slice(start, end);
}

function buildIsolatedPdBuildQueueHoy() {
  const body = extractFunctionBody(appJs, "function _pdBuildQueueHoy(filter) {");
  const factory = new Function(`
    let _hoyState = {};
    let _callsLeadsById = new Map();
    ${dueAtBlock()}
    ${body}
    return {
      run(filter, state, leadsMap) {
        _hoyState = state;
        _callsLeadsById = leadsMap;
        return _pdBuildQueueHoy(filter);
      }
    };
  `);
  return factory();
}

// Ejecuta el _hoyRenderFromStore REAL en aislamiento — es la única forma de
// probar FUNCIONALMENTE (no solo por aserción de fuente) que el bloque de
// higiene es invariante al filtro de país: se lo corre una vez con
// `_hoySelectedCountry` devolviendo '' (todos los países) y otra devolviendo
// un país puntual, sobre el MISMO fixture, y se compara `_hoyState.hygiene`.
// Todas las dependencias externas de _hoyRenderFromStore (document,
// _hoySelectedSetter, _commitmentHoyBucket, _hoyRenderSection,
// _hoyNewLeadsPointer, _hoyCommitBadge, _leadStoreVersion/_hoyRenderedVersion)
// se stubean — ninguna de ellas participa del cálculo de higiene que este
// test verifica (_commitmentHoyBucket se stubea a `null` a propósito: el
// fixture usa callbacks/redSeguridad, no compromisos, para no depender de la
// lógica de COMMITMENT-PURE, ya cubierta por tests/commitment-hoy.test.js).
function buildIsolatedHoyRenderFromStore() {
  const body = extractFunctionBody(appJs, "function _hoyRenderFromStore(leadsArg) {");
  const factory = new Function(`
    let _hoyState = { callbackIds: [], interesadoIds: [], at: 0 };
    let _hoyRenderedVersion = -1;
    let _leadStoreVersion = 0;
    const _leadStoreDirty = new Set();
    const _callsLeadsById = new Map();
    let __countryFilter = '';
    ${dueAtBlock()}
    function _hoySelectedSetter() { return ''; }
    function _hoySelectedCountry() { return __countryFilter; }
    function _commitmentHoyBucket(l, now) { return null; }
    function _hoyRenderSection() { return ''; }
    function _hoyNewLeadsPointer() { return ''; }
    function _hoyCommitBadge() { return ''; }
    const document = {
      getElementById(id) {
        if (id === 'hoy-sections') return { children: { length: 0 }, innerHTML: '' };
        if (id === 'hoy-greeting') return { textContent: '' };
        return null;
      }
    };
    ${body}
    return {
      run(leads, countryFilter) {
        __countryFilter = countryFilter || '';
        _hoyRenderFromStore(leads);
        return _hoyState;
      }
    };
  `);
  return factory();
}

beforeAll(() => {
  appJs = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");
  indexHtml = fs.readFileSync(path.join(process.cwd(), "public", "index.html"), "utf8");
});

// ─────────────────────────────────────────────────────────────────────────
// D-07: _pdBuildQueueHoy reescrito — 5 sub-colas
// ─────────────────────────────────────────────────────────────────────────

describe("_pdBuildQueueHoy: aserción de fuente — 5 sub-colas de _hoyState", () => {
  it("el cuerpo referencia los 5 arrays de _hoyState", () => {
    const body = extractFunctionBody(appJs, "function _pdBuildQueueHoy(filter) {");
    expect(body).toContain("_hoyState.commitYoIds");
    expect(body).toContain("_hoyState.commitProspectoIds");
    expect(body).toContain("_hoyState.callbackIds");
    expect(body).toContain("_hoyState.interesadoIds");
    expect(body).toContain("_hoyState.retryIds");
  });

  it("cada sub-cola está condicionada por su propio valor de filter", () => {
    const body = extractFunctionBody(appJs, "function _pdBuildQueueHoy(filter) {");
    expect(body).toContain("if (!filter || filter === 'compromisos') parts.push(...dueNow(_hoyState.commitYoIds));");
    expect(body).toContain("if (!filter || filter === 'esperando') parts.push(...dueNow(_hoyState.commitProspectoIds));");
    expect(body).toContain("if (!filter || filter === 'callbacks') parts.push(...dueNow(_hoyState.callbackIds));");
    expect(body).toContain("if (!filter || filter === 'interesados') parts.push(..._hoyState.interesadoIds.map(id => _callsLeadsById.get(id)).filter(Boolean));");
    expect(body).toContain("if (!filter || filter === 'reintentos') parts.push(...dueNow(_hoyState.retryIds));");
  });
});

describe("_pdBuildQueueHoy: orden del chain (D-01) — compromisos < esperando < callbacks < interesados < reintentos", () => {
  it("las 5 condiciones aparecen, en este orden de indexOf", () => {
    const body = extractFunctionBody(appJs, "function _pdBuildQueueHoy(filter) {");
    const iComp = body.indexOf("filter === 'compromisos'");
    const iEsp = body.indexOf("filter === 'esperando'");
    const iCb = body.indexOf("filter === 'callbacks'");
    const iInt = body.indexOf("filter === 'interesados'");
    const iRet = body.indexOf("filter === 'reintentos'");
    for (const idx of [iComp, iEsp, iCb, iInt, iRet]) expect(idx).toBeGreaterThan(-1);
    expect(iComp).toBeLessThan(iEsp);
    expect(iEsp).toBeLessThan(iCb);
    expect(iCb).toBeLessThan(iInt);
    expect(iInt).toBeLessThan(iRet);
  });
});

describe("_pdBuildQueueHoy: lógica pura ejecutada en aislamiento (fixture de esta suite)", () => {
  const now = Date.now();
  const past = new Date(now - 60 * 1000).toISOString();
  const future = new Date(now + 60 * 1000).toISOString();
  const leadsMap = new Map([
    ["c1", { id: "c1", callbackAt: null }],
    ["c2", { id: "c2", callbackAt: past }],
    ["c3", { id: "c3", callbackAt: past }],
    ["c4", { id: "c4" }],
    ["c5", { id: "c5", callbackAt: future }], // vence más tarde hoy: NO entra
  ]);
  const state = {
    commitYoIds: ["c1"],
    commitProspectoIds: ["c2"],
    callbackIds: ["c3"],
    interesadoIds: ["c4"],
    retryIds: ["c5"],
  };

  it("fn(null) — chain completo — devuelve la unión ordenada de los 5 sub-arrays sin duplicados (c5 excluido: vence más tarde hoy)", () => {
    const h = buildIsolatedPdBuildQueueHoy();
    expect(h.run(null, state, leadsMap)).toEqual(["c1", "c2", "c3", "c4"]);
  });

  it("fn('compromisos') devuelve solo commitYoIds vencidos", () => {
    const h = buildIsolatedPdBuildQueueHoy();
    expect(h.run("compromisos", state, leadsMap)).toEqual(["c1"]);
  });

  it("fn('esperando') devuelve solo commitProspectoIds vencidos", () => {
    const h = buildIsolatedPdBuildQueueHoy();
    expect(h.run("esperando", state, leadsMap)).toEqual(["c2"]);
  });

  it("fn('callbacks') devuelve solo callbackIds vencidos", () => {
    const h = buildIsolatedPdBuildQueueHoy();
    expect(h.run("callbacks", state, leadsMap)).toEqual(["c3"]);
  });

  it("fn('interesados') devuelve interesadoIds SIN filtrar por fecha (D-03: aparece todos los días)", () => {
    const h = buildIsolatedPdBuildQueueHoy();
    expect(h.run("interesados", state, leadsMap)).toEqual(["c4"]);
  });

  it("fn('reintentos') respeta el mismo criterio de 'ya vencido' — c5 vence más tarde hoy, cola vacía", () => {
    const h = buildIsolatedPdBuildQueueHoy();
    expect(h.run("reintentos", state, leadsMap)).toEqual([]);
  });

  it("un callbackAt sin vencer (futuro) queda excluido en compromisos/esperando/callbacks/reintentos, no en interesados", () => {
    const h = buildIsolatedPdBuildQueueHoy();
    const futureState = {
      commitYoIds: ["c5"], commitProspectoIds: ["c5"], callbackIds: ["c5"], interesadoIds: ["c5"], retryIds: ["c5"],
    };
    expect(h.run("compromisos", futureState, leadsMap)).toEqual([]);
    expect(h.run("interesados", futureState, leadsMap)).toEqual(["c5"]);
  });

  it("defensivo: el mismo id en 2 sub-colas a la vez no se disca 2 veces (dedup, gana la primera del chain)", () => {
    const h = buildIsolatedPdBuildQueueHoy();
    const dupState = { commitYoIds: ["x"], commitProspectoIds: [], callbackIds: ["x"], interesadoIds: [], retryIds: [] };
    const dupMap = new Map([["x", { id: "x", callbackAt: null }]]);
    expect(h.run(null, dupState, dupMap)).toEqual(["x"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// D-07: los 5 modos parsean bien en window._pdStart
// ─────────────────────────────────────────────────────────────────────────

describe("window._pdStart: _pd.hoyFilter — los 5 modos (D-07)", () => {
  it("los 3 modos nuevos parsean al valor esperado", () => {
    const body = extractFunctionBody(appJs, "window._pdStart = async function(mode, opts = {}) {");
    expect(body).toContain("mode === 'hoy-compromisos' ? 'compromisos'");
    expect(body).toContain("mode === 'hoy-esperando' ? 'esperando'");
    expect(body).toContain("mode === 'hoy-reintentos' ? 'reintentos'");
  });

  it("los 2 modos preexistentes NO cambiaron de valor", () => {
    const body = extractFunctionBody(appJs, "window._pdStart = async function(mode, opts = {}) {");
    expect(body).toContain("mode === 'hoy-callbacks' ? 'callbacks'");
    expect(body).toContain("mode === 'hoy-interesados' ? 'interesados'");
  });

  it("el ternario cae a null si ningún modo matchea (chain completo 'hoy')", () => {
    const body = extractFunctionBody(appJs, "window._pdStart = async function(mode, opts = {}) {");
    const idx = body.indexOf("_pd.hoyFilter = mode ===");
    const endIdx = body.indexOf(";", idx);
    const stmt = body.slice(idx, endIdx + 1);
    expect(stmt.trim().endsWith(": null;")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// D-07/D-08: los 3 botones nuevos + Red de seguridad intacta
// ─────────────────────────────────────────────────────────────────────────

describe("Los 3 botones de Power Dialer por sección que faltaban", () => {
  it("'Mis compromisos' pasa 'hoy-compromisos' como 5to argumento", () => {
    expect(appJs).toContain(
      "_hoyRenderSection('Mis compromisos', misCompromisos, 'var(--warning)', 'Le prometí algo — vence hoy', 'hoy-compromisos', { rowBadge: _hoyCommitBadge })"
    );
  });

  it("'Esperando del prospecto' pasa 'hoy-esperando' como 5to argumento", () => {
    expect(appJs).toContain(
      "_hoyRenderSection('Esperando del prospecto', compromisosProspecto, 'var(--accent)', 'Se comprometió él — el plazo venció', 'hoy-esperando', { rowBadge: _hoyCommitBadge })"
    );
  });

  it("'Reintentos de no-contacto' pasa 'hoy-reintentos' como 5to argumento", () => {
    expect(appJs).toContain(
      "_hoyRenderSection('Reintentos de no-contacto', reintentos, '#8892A6', 'No atendieron — bajo esfuerzo, alto volumen', 'hoy-reintentos')"
    );
  });

  it("'Red de seguridad' SIGUE con dialerMode null (D-11: se resuelve individualmente, no en cola)", () => {
    const body = extractFunctionBody(appJs, "function _hoyRenderFromStore(leadsArg) {");
    const idx = body.indexOf("_hoyRenderSection('Red de seguridad'");
    expect(idx).toBeGreaterThan(-1);
    const line = body.slice(idx, body.indexOf(";", idx) + 1);
    expect(line).not.toMatch(/'hoy-/);
    expect(line).toContain(", null, { collapsible: true }");
  });

  it("D-08: hoy-section-count sigue en _hoyRenderSection para TODAS las secciones (nada especial que sumar en esta task)", () => {
    const body = extractFunctionBody(appJs, "function _hoyRenderSection(title, leads, accent, hint, dialerMode, opts = {}) {");
    expect(body).toContain('<span class="hoy-section-count">${leads.length}</span>');
  });
});

describe("Mensajes de cola vacía y de éxito nombran las 3 secciones nuevas", () => {
  it("cola vacía: 3 mensajes nuevos en el ternario", () => {
    const body = extractFunctionBody(appJs, "window._pdStart = async function(mode, opts = {}) {");
    expect(body).toContain("_pd.hoyFilter === 'compromisos' ? 'Sin compromisos propios que venzan hoy.'");
    expect(body).toContain("_pd.hoyFilter === 'esperando' ? 'Nada esperando respuesta vencida.'");
    expect(body).toContain("_pd.hoyFilter === 'reintentos' ? 'Sin reintentos pendientes hoy.'");
  });

  it("toast de éxito: 3 mensajes nuevos en el ternario", () => {
    const body = extractFunctionBody(appJs, "window._pdStart = async function(mode, opts = {}) {");
    expect(body).toContain("_pd.hoyFilter === 'compromisos' ? `Power dialer · ${_n} compromiso${_n > 1 ? 's' : ''} propio${_n > 1 ? 's' : ''} en cola`");
    expect(body).toContain("_pd.hoyFilter === 'esperando' ? `Power dialer · ${_n} en espera vencida en cola`");
    expect(body).toContain("_pd.hoyFilter === 'reintentos' ? `Power dialer · ${_n} reintento${_n > 1 ? 's' : ''} en cola`");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// HOY-05: panel de higiene (D-12/D-13/D-14)
// ─────────────────────────────────────────────────────────────────────────

describe("Panel de higiene: existe en el HTML", () => {
  it("div#hoy-hygiene está en el header de view-hoy, entre #hoy-kpis y #hoy-sections", () => {
    expect(indexHtml).toContain('id="hoy-hygiene"');
    const iKpis = indexHtml.indexOf('id="hoy-kpis"');
    const iHygiene = indexHtml.indexOf('id="hoy-hygiene"');
    const iSections = indexHtml.indexOf('id="hoy-sections"');
    expect(iKpis).toBeGreaterThan(-1);
    expect(iHygiene).toBeGreaterThan(iKpis);
    expect(iSections).toBeGreaterThan(iHygiene);
  });
});

describe("D-14: el panel NUNCA muestra un cero desnudo", () => {
  it("el cuerpo de _hoyRenderHygienePanel usa el patrón n > 0 ? String(n) : okText", () => {
    const body = extractFunctionBody(appJs, "async function _hoyRenderHygienePanel() {");
    expect(body).toContain("const shown = n > 0 ? String(n) : okText;");
  });

  it("las 2 llamadas al tile() pasan un texto de 'todo bien' explícito, nunca solo el número", () => {
    const body = extractFunctionBody(appJs, "async function _hoyRenderHygienePanel() {");
    expect(body).toContain("tile('Tocados sin próximo paso', h.redSeguridad, 'Al día — sin backlog')");
    expect(body).toContain("tile('Compromisos vencidos hoy', h.vencidos, 'Sin vencidos')");
  });

  it("el div .myp-tile-num nunca interpola el número crudo (${h.vencidos}/${h.redSeguridad}) fuera del helper tile()", () => {
    const body = extractFunctionBody(appJs, "async function _hoyRenderHygienePanel() {");
    expect(body).not.toContain("${h.vencidos}");
    expect(body).not.toContain("${h.redSeguridad}");
  });
});

describe("Panel de higiene: manda lo que _hoyRenderFromStore YA calculó — no re-deriva", () => {
  it("lee _hoyState.hygiene", () => {
    const body = extractFunctionBody(appJs, "async function _hoyRenderHygienePanel() {");
    expect(body).toContain("_hoyState.hygiene");
  });

  it("NO re-deriva callbacks.length/misCompromisos.length/etc. dentro de su propio cuerpo", () => {
    const body = extractFunctionBody(appJs, "async function _hoyRenderHygienePanel() {");
    expect(body).not.toContain("callbacks.length");
    expect(body).not.toContain("misCompromisos.length");
    expect(body).not.toContain("compromisosProspecto.length");
    expect(body).not.toContain("reintentos.length");
    expect(body).not.toContain("redSeguridad.length");
  });

  it("manda POST a /api/setters/hoy-hygiene-snapshot con los 2 conteos", () => {
    const body = extractFunctionBody(appJs, "async function _hoyRenderHygienePanel() {");
    expect(body).toContain("hoy-hygiene-snapshot");
    expect(body).toContain("vencidos: h.vencidos, redSeguridad: h.redSeguridad");
  });
});

describe("Blocker fix (checker 2026-08-16): invarianza al filtro de país", () => {
  it("(a) aserción de fuente — el bloque que calcula _hoyState.hygiene usa allLeadsForHygiene y claimedHygiene, NUNCA el patrón viejo post-filtro-de-país", () => {
    const body = extractFunctionBody(appJs, "function _hoyRenderFromStore(leadsArg) {");
    const hygieneIdx = body.indexOf("const claimedHygiene = new Set();");
    expect(hygieneIdx).toBeGreaterThan(-1);
    const assignIdx = body.indexOf("_hoyState.hygiene = {", hygieneIdx);
    expect(assignIdx).toBeGreaterThan(hygieneIdx);
    // Ventana acotada AL BLOQUE de higiene — el archivo tiene otro uso
    // legítimo de "callbacks.length + misCompromisos.length" más arriba
    // (tier123Empty, para el gate de "Nuevos por score", nada que ver con
    // higiene) que NO debe confundirse con el patrón viejo que el checker
    // marcó como blocker.
    const hygieneBlock = body.slice(hygieneIdx, assignIdx + 200);
    expect(hygieneBlock).toContain("allLeadsForHygiene");
    // El patrón viejo (blocker que marcó el checker): el bloque de higiene
    // jamás debe referenciar los arrays YA filtrados por país.
    expect(hygieneBlock).not.toContain("callbacks.length");
    expect(hygieneBlock).not.toContain("misCompromisos.length");
    expect(hygieneBlock).not.toContain("compromisosProspecto.length");
    expect(hygieneBlock).not.toContain("reintentos.length");
    expect(hygieneBlock).not.toContain("redSeguridad.length");
  });

  it("claimedHygiene es un Set PROPIO, distinto del `claimed` de la clasificación mostrada en pantalla", () => {
    const body = extractFunctionBody(appJs, "function _hoyRenderFromStore(leadsArg) {");
    expect(body).toContain("const claimed = new Set();");
    expect(body).toContain("const claimedHygiene = new Set();");
    // Ninguna línea reasigna uno al otro.
    expect(body).not.toContain("claimedHygiene = claimed");
    expect(body).not.toContain("claimed = claimedHygiene");
  });

  it("(b) fixture ejecutado: _hoyState.hygiene es IDÉNTICO sin filtro de país y con un país filtrado", () => {
    const now = Date.now();
    const past = new Date(now - 60 * 60 * 1000).toISOString();
    const leads = [
      { id: "uy-cb", country: "Uruguay", doNotCall: false, estado: "sin_contactar", callbackAt: past, callLog: [{ outcome: "callback_later", ts: past }] },
      { id: "mx-cb", country: "Mexico", doNotCall: false, estado: "sin_contactar", callbackAt: past, callLog: [{ outcome: "callback_later", ts: past }] },
      { id: "uy-red", country: "Uruguay", doNotCall: false, estado: "sin_contactar", callbackAt: null, callLog: [{ outcome: "no_answer", ts: past }], nextAction: null },
      { id: "mx-red", country: "Mexico", doNotCall: false, estado: "sin_contactar", callbackAt: null, callLog: [{ outcome: "no_answer", ts: past }], nextAction: null },
    ];
    const stateAll = buildIsolatedHoyRenderFromStore().run(leads, "");
    const stateUY = buildIsolatedHoyRenderFromStore().run(leads, "Uruguay");
    expect(stateAll.hygiene).toEqual({ vencidos: 2, redSeguridad: 2 });
    expect(stateUY.hygiene).toEqual(stateAll.hygiene);
  });

  it("(b) fixture: un país sin NINGÚN lead filtrado igual reporta los vencidos/redSeguridad de TODO el pipeline", () => {
    const now = Date.now();
    const past = new Date(now - 60 * 60 * 1000).toISOString();
    const leads = [
      { id: "uy-cb", country: "Uruguay", doNotCall: false, estado: "sin_contactar", callbackAt: past, callLog: [{ outcome: "callback_later", ts: past }] },
      { id: "mx-red", country: "Mexico", doNotCall: false, estado: "sin_contactar", callbackAt: null, callLog: [{ outcome: "no_answer", ts: past }], nextAction: null },
    ];
    // Filtrar por un país que no tiene NINGÚN lead en pantalla (Perú) — la
    // vista mostraría 0 secciones, pero la higiene sigue midiendo TODO.
    const stateEmpty = buildIsolatedHoyRenderFromStore().run(leads, "Peru");
    expect(stateEmpty.hygiene).toEqual({ vencidos: 1, redSeguridad: 1 });
  });

  it("DNC y leads terminales no cuentan para la higiene (mismo criterio que la clasificación mostrada)", () => {
    const now = Date.now();
    const past = new Date(now - 60 * 60 * 1000).toISOString();
    const leads = [
      { id: "dnc1", country: "Uruguay", doNotCall: true, estado: "sin_contactar", callbackAt: past, callLog: [{ outcome: "callback_later", ts: past }] },
      { id: "cerrado1", country: "Uruguay", doNotCall: false, estado: "cerrado", callLog: [{ outcome: "no_answer", ts: past }], nextAction: null },
    ];
    const state = buildIsolatedHoyRenderFromStore().run(leads, "");
    expect(state.hygiene).toEqual({ vencidos: 0, redSeguridad: 0 });
  });
});

describe("Color discipline: el panel de higiene no introduce verde/acento nuevo (regla del proyecto)", () => {
  it("_hoyRenderHygienePanel no usa var(--accent) ni tonos verdes para el estado 'todo bien'", () => {
    const body = extractFunctionBody(appJs, "async function _hoyRenderHygienePanel() {");
    expect(body).not.toContain("var(--accent)");
    expect(body).not.toMatch(/#4ADE80/i);
    // Estado positivo: neutro (text-secondary). Estado con pendientes: warning.
    expect(body).toContain("var(--text-secondary)");
    expect(body).toContain("var(--warning)");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Cache-buster
// ─────────────────────────────────────────────────────────────────────────

describe("Cache-buster: app.js bumpeado, style.css intacto", () => {
  it("app.js?v= tiene forma válida y es estrictamente mayor que el baseline real de este plan (20260816g)", () => {
    const m = /app\.js\?v=(\d{8}[a-z])/.exec(indexHtml);
    expect(m).toBeTruthy();
    expect(m[1] > "20260816g").toBe(true);
  });

  it("app.js?v= aparece una sola vez", () => {
    expect(countOccurrences(indexHtml, "app.js?v=")).toBe(1);
  });

  it("style.css?v= sigue teniendo forma válida (no se tocó en este plan)", () => {
    const m = /style\.css\?v=(\d{8}[a-z])/.exec(indexHtml);
    expect(m).toBeTruthy();
  });
});

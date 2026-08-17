// Reloj efectivo del lead — _leadDueAt y la cola del Power Dialer sobre Hoy.
//
// Bug que lo origina (2026-08-17): _pdBuildQueueHoy filtraba lo no vencido
// mirando UN SOLO reloj (`callbackAt`), pero Hoy tiene cinco tiers colgados de
// TRES relojes distintos. Un compromiso que vencía hoy a las 17:00 y sin
// callbackAt evaluaba `!l.callbackAt` como true y entraba a la cola a las 11
// de la mañana: el SDR lo discaba sin darse cuenta y rompía lo pactado por
// teléfono.
//
// Mismo molde que tests/dial-start-at.test.js: sin browser ni jsdom, se extrae
// el bloque puro por marcadores y se lo evalúa aislado, más aserciones de
// fuente para el cableado que no se puede ejecutar.
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

let appJs;

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
  let count = 0, idx = 0;
  while ((idx = str.indexOf(sub, idx)) !== -1) { count++; idx += sub.length; }
  return count;
}

// El bloque DUEAT-PURE no toca DOM, red ni almacenamiento: se evalúa aislado.
function buildDueAt() {
  const start = appJs.indexOf("// ─── [34-06] DUEAT-PURE: INICIO ───");
  const end = appJs.indexOf("// ─── [34-06] DUEAT-PURE: FIN ───");
  if (start === -1 || end === -1) throw new Error("No encontré los marcadores DUEAT-PURE");
  const body = appJs.slice(start, end);
  return new Function(`${body}\nreturn { _leadDueAt, _commitDueAt };`)();
}

beforeAll(() => {
  appJs = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");
});

const HOY_17 = "2026-08-17T17:00:00.000Z";
const AYER = "2026-08-16T09:00:00.000Z";

describe("_leadDueAt — precedencia de los tres relojes", () => {
  it("callbackAt manda sobre todo lo demás", () => {
    const { _leadDueAt } = buildDueAt();
    const lead = {
      callbackAt: HOY_17,
      nextAction: { dueAt: AYER, origen: "cadencia" },
      commitment: { dueAt: AYER },
    };
    expect(_leadDueAt(lead)).toBe(new Date(HOY_17).getTime());
  });

  it("sin callbackAt usa nextAction.dueAt — el reloj de los reintentos de cadencia", () => {
    const { _leadDueAt } = buildDueAt();
    const lead = { nextAction: { dueAt: HOY_17, origen: "cadencia" } };
    expect(_leadDueAt(lead)).toBe(new Date(HOY_17).getTime());
  });

  it("sin callbackAt ni nextAction cae al compromiso", () => {
    const { _leadDueAt } = buildDueAt();
    const lead = { commitment: { dueAt: HOY_17, parte: "yo", estado: "pendiente" } };
    expect(_leadDueAt(lead)).toBe(new Date(HOY_17).getTime());
  });

  it("sin ningún reloj devuelve null (el lead queda siempre elegible)", () => {
    const { _leadDueAt } = buildDueAt();
    expect(_leadDueAt({})).toBe(null);
    expect(_leadDueAt({ nextAction: null, commitment: null })).toBe(null);
    expect(_leadDueAt(null)).toBe(null);
    expect(_leadDueAt(undefined)).toBe(null);
  });

  it("una fecha basura no rompe: devuelve null en vez de NaN", () => {
    // NaN se compararía como false contra `<= now` y sacaría al lead de la
    // cola en silencio. null es explícito: "no tiene reloj".
    const { _leadDueAt } = buildDueAt();
    expect(_leadDueAt({ callbackAt: "no soy una fecha" })).toBe(null);
  });

  it("respeta la regla D-06 de _commitDueAt: la espera pisa al compromiso original", () => {
    // 'Esperando del prospecto': el compromiso ya se cumplió (su dueAt quedó
    // en el pasado) y lo que importa es cuándo vence la ESPERA, que vive en
    // nextAction con origen 'compromiso'.
    const { _commitDueAt } = buildDueAt();
    const lead = {
      nextAction: { dueAt: HOY_17, origen: "compromiso", tipo: "esperar_respuesta" },
      commitment: { dueAt: AYER, parte: "yo", estado: "cumplido" },
    };
    expect(_commitDueAt(lead)).toBe(HOY_17);
  });
});

describe("cola del Power Dialer sobre Hoy — las tres formas de reloj", () => {
  // Réplica del filtro real (`dueNow`), cruzada contra la fuente más abajo.
  function dueNow(leads, now, leadDueAt) {
    return leads.filter((l) => { const d = leadDueAt(l); return l && (d === null || d <= now); });
  }

  it("un compromiso para las 17:00 NO entra a la cola a las 11:00 (el bug)", () => {
    const { _leadDueAt } = buildDueAt();
    const now = new Date("2026-08-17T11:00:00.000Z").getTime();
    const lead = { id: "l1", commitment: { dueAt: HOY_17, parte: "yo", estado: "pendiente" } };
    expect(dueNow([lead], now, _leadDueAt)).toHaveLength(0);
  });

  it("un reintento de cadencia para las 17:00 tampoco entra", () => {
    const { _leadDueAt } = buildDueAt();
    const now = new Date("2026-08-17T11:00:00.000Z").getTime();
    const lead = { id: "l2", nextAction: { dueAt: HOY_17, origen: "cadencia" } };
    expect(dueNow([lead], now, _leadDueAt)).toHaveLength(0);
  });

  it("un callback para las 17:00 tampoco (lo único que ya funcionaba)", () => {
    const { _leadDueAt } = buildDueAt();
    const now = new Date("2026-08-17T11:00:00.000Z").getTime();
    const lead = { id: "l3", callbackAt: HOY_17 };
    expect(dueNow([lead], now, _leadDueAt)).toHaveLength(0);
  });

  it("los tres SÍ entran una vez pasada la hora", () => {
    const { _leadDueAt } = buildDueAt();
    const now = new Date("2026-08-17T18:00:00.000Z").getTime();
    const leads = [
      { id: "l1", commitment: { dueAt: HOY_17 } },
      { id: "l2", nextAction: { dueAt: HOY_17, origen: "cadencia" } },
      { id: "l3", callbackAt: HOY_17 },
    ];
    expect(dueNow(leads, now, _leadDueAt).map((l) => l.id)).toEqual(["l1", "l2", "l3"]);
  });

  it("un lead sin reloj entra siempre (comportamiento previo intacto)", () => {
    const { _leadDueAt } = buildDueAt();
    const now = new Date("2026-08-17T11:00:00.000Z").getTime();
    expect(dueNow([{ id: "l4" }], now, _leadDueAt)).toHaveLength(1);
  });
});

describe("aserciones de fuente — cableado", () => {
  it("_leadDueAt y _commitDueAt se declaran UNA sola vez, en scope compartido", () => {
    expect(countOccurrences(appJs, "function _leadDueAt(")).toBe(1);
    expect(countOccurrences(appJs, "function _commitDueAt(")).toBe(1);
    // Y la copia local que vivía dentro de _hoyRenderFromStore ya no existe.
    expect(appJs).not.toContain("const _commitDueAt = (l) =>");
  });

  it("dueNow usa _leadDueAt, no callbackAt suelto", () => {
    const body = extractFunctionBody(appJs, "function _pdBuildQueueHoy(filter) {");
    expect(body).toContain("_leadDueAt(l)");
    expect(body).not.toContain("!l.callbackAt");
  });

  it("los CUATRO tiers con reloj pasan por dueNow", () => {
    const body = extractFunctionBody(appJs, "function _pdBuildQueueHoy(filter) {");
    for (const ids of ["commitYoIds", "commitProspectoIds", "callbackIds", "retryIds"]) {
      expect(body).toContain(`dueNow(_hoyState.${ids})`);
    }
  });

  it("los interesados NO pasan por dueNow (D-03: aparecen todos los días)", () => {
    // Excepción intencional de la Fase 34 — un interesado se trabaja hasta
    // agendar o descartar, no vence.
    const body = extractFunctionBody(appJs, "function _pdBuildQueueHoy(filter) {");
    expect(body).toContain("_hoyState.interesadoIds.map(");
    expect(body).not.toContain("dueNow(_hoyState.interesadoIds)");
  });

  it("el botón Llamar de la lista de Hoy pasa por el guard", () => {
    expect(appJs).toContain(`class="hoy-call-btn" onclick="window._hoyCallGuard(`);
    expect(countOccurrences(appJs, "window._hoyCallGuard = function")).toBe(1);
  });

  it("el guard pide confirmación solo si todavía no venció, y disca igual si confirman", () => {
    const body = extractFunctionBody(appJs, "window._hoyCallGuard = function(leadId) {");
    expect(body).toContain("_leadDueAt(lead)");
    expect(body).toContain("due > now");
    expect(body).toContain("Llamar igual?");
    expect(body).not.toContain("¿");           // copy interno, sin signo de apertura
    expect(body).toContain("window._startTelnyxCall(leadId)");
  });

  it("el chip de hora de la lista distingue lo que no venció", () => {
    const body = extractFunctionBody(appJs, "function _hoyRenderSection(title, leads, accent, hint, dialerMode, opts = {}) {");
    expect(body).toContain("_leadDueAt(l)");
    expect(body).toContain("#FFB341");                     // mismo ámbar que "fuera de horario"
    expect(body).toContain("Todavía no vence: lo pactaste para las");
  });
});

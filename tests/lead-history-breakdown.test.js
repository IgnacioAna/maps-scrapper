// Milestone "operador solo" · Fase C — el historial dice DE QUÉ fueron los
// intentos, y cuántas veces se pospuso el lead.
//
// El bloque "Ya trabajado" ya existía (plan 33-04) y decía "3 intentos
// previos". Eso no alcanza para decidir en un segundo si vale la pena marcar:
// no es lo mismo que hayan atendido y cortado dos veces que que nunca hayan
// atendido.
//
// Y el contador de "pospuesta N veces" sale de un dato medido en producción el
// 2026-09-05 sobre 6413 leads: el repetido real NO es que los topes de
// reintento se esquiven (con el criterio exacto del pedido hay 1 lead en 6413),
// sino la acumulación de `callback_later`, que no tiene tope — ni debería
// tenerlo automático, porque son compromisos que tomó una persona. Activos: 44
// leads con 1, 12 con 2, 3 con 3 y 1 con 4.
//
// Mismo molde que tests/dial-history.test.js: el bloque puro se extrae por sus
// marcadores y se evalúa con un reloj FIJO.

import { describe, it, beforeAll, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const START = "// ─── [33-04] HISTORY-PURE: INICIO ───";
const END = "// ─── [33-04] HISTORY-PURE: FIN ───";

let appJs;
let hu;

const NOW = new Date(2026, 8, 5, 12, 0).getTime(); // 05/09/2026 12:00, fijo
const hace = (dias) => new Date(NOW - dias * 86400000).toISOString();

beforeAll(() => {
  appJs = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");
  const s = appJs.indexOf(START), e = appJs.indexOf(END);
  if (s === -1 || e === -1) throw new Error("marcadores HISTORY-PURE no encontrados");
  hu = new Function(appJs.slice(s, e) + "\nreturn { _leadHistoryBrief, HISTORY_OUTCOME_LABELS };")();
});

const lead = (outcomes, extra = {}) => ({
  callLog: outcomes.map((o, i) => ({ outcome: o, ts: hace(outcomes.length - i), by: "" })),
  notes: [], commitment: null, ...extra,
});

describe("Fase C · desglose por resultado", () => {
  it("cuenta cada resultado por separado", () => {
    const b = hu._leadHistoryBrief(lead(["no_answer", "hung_up", "no_answer"]), NOW);
    expect(b.breakdown).toEqual([
      { outcome: "hung_up", label: "Cortó", n: 1 },
      { outcome: "no_answer", label: "No atendió", n: 2 },
    ]);
  });

  it("el orden es el del catálogo de teclas 1-9, NO por frecuencia", () => {
    // Así el desglose de dos leads distintos se compara de un vistazo.
    const b = hu._leadHistoryBrief(lead(["voicemail", "voicemail", "voicemail", "answered_interested"]), NOW);
    expect(b.breakdown.map((x) => x.outcome)).toEqual(["answered_interested", "voicemail"]);
  });

  it("no inventa filas para resultados que no ocurrieron", () => {
    const b = hu._leadHistoryBrief(lead(["no_answer"]), NOW);
    expect(b.breakdown).toEqual([{ outcome: "no_answer", label: "No atendió", n: 1 }]);
  });

  it("ignora entradas del callLog sin outcome (data vieja) sin romper", () => {
    const l = lead(["no_answer"]);
    l.callLog.push({ ts: hace(0) }, null);
    const b = hu._leadHistoryBrief(l, NOW);
    expect(b.breakdown).toEqual([{ outcome: "no_answer", label: "No atendió", n: 1 }]);
  });

  it("un lead sin historial sigue devolviendo has:false (D-12, cartel vacío jamás)", () => {
    const b = hu._leadHistoryBrief({ callLog: [], notes: [], commitment: null }, NOW);
    expect(b.has).toBe(false);
  });
});

describe("Fase C · veces pospuesta", () => {
  it("cuenta los 'volver a llamar' del historial", () => {
    const b = hu._leadHistoryBrief(lead(["callback_later", "voicemail", "callback_later"]), NOW);
    expect(b.postponed).toBe(2);
  });

  it("el caso peor medido en producción: 4 veces pospuesta entre 6 llamadas", () => {
    // Wellness dental clinic, 2026-09-05.
    const b = hu._leadHistoryBrief(
      lead(["callback_later", "voicemail", "hung_up", "callback_later", "callback_later", "callback_later"]),
      NOW
    );
    expect(b.postponed).toBe(4);
    expect(b.attempts).toBe(6);
  });

  it("cero cuando nunca se pospuso", () => {
    expect(hu._leadHistoryBrief(lead(["no_answer", "hung_up"]), NOW).postponed).toBe(0);
  });
});

describe("Fase C · cómo se pinta", () => {
  const html = () => {
    const s = appJs.indexOf("function _leadHistoryHTML(lead) {");
    return appJs.slice(s, appJs.indexOf(END));
  };

  it("con 2 llamadas o más el encabezado dice el ordinal y el desglose", () => {
    expect(html()).toContain("`${brief.attempts}ª llamada · ${_desglose}`");
  });

  it("con UNA sola llamada se mantiene el texto viejo (el desglose sería repetir la línea de abajo)", () => {
    expect(html()).toContain("brief.attempts >= 2 && brief.breakdown && brief.breakdown.length");
    expect(html()).toContain("intento${brief.attempts > 1 ? 's' : ''} previo");
  });

  it("'Pospuesta N veces' recién a partir de la segunda vez", () => {
    expect(html()).toContain("brief.postponed >= 2");
  });

  it("el número de veces pospuesta se escapa igual que el resto", () => {
    expect(html()).toContain("escHtml(String(brief.postponed))");
  });

  it("el bloque sigue siendo puro: sin document, ni fetch, ni Date.now()", () => {
    const s = appJs.indexOf(START), e = appJs.indexOf(END);
    const bloque = appJs.slice(s, e);
    expect(bloque).not.toMatch(/document\.|localStorage|fetch\(|Date\.now\(/);
  });
});

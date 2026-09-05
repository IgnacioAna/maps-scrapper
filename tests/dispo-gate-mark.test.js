// Milestone "operador solo" · Fase A — marcar el resultado sin salir del
// Power Dialer.
//
// El bug, reproducido en vivo el 2026-09-05 contra datos de producción: con el
// gate de disposición armado, el cartel ofrecía "Ir a marcar" y se portaba
// distinto según de dónde se hubiera abierto el dialer:
//   · desde HOY  → _dispoFocusLeadRow navega a Llamadas, el delegate del
//                  sidebar dispara _pdExit() y la cola se pierde ("sesión
//                  cerrada" con 137 leads adentro);
//   · desde LLAMADAS → no navega (la vista ya es la visible), así que el foco
//                  va a un <select> que está DETRÁS del overlay: el SDR
//                  clickea y no pasa nada visible.
// Y en los dos casos, mientras tanto, el SDR podía seguir avanzando la cola con
// `S`: la tarjeta pasaba a ser OTRO lead y sus 9 botones marcaban ese otro,
// mientras el cartel seguía pidiendo el resultado del lead trabado.
//
// Sin browser ni jsdom: se ejercita el handler de teclado de la capa con un
// `new Function` (mismo molde que tests/dialer-edges.test.js) y se asertan las
// invariantes que no se pueden romper sin volver a abrir el bug.

import { describe, it, beforeAll, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

let appJs;

function extractFunctionBody(text, startLiteral) {
  if (!startLiteral.endsWith("{")) throw new Error("startLiteral debe terminar en '{'");
  const startIdx = text.indexOf(startLiteral);
  if (startIdx === -1) throw new Error(`No se encontró "${startLiteral}"`);
  const braceStart = startIdx + startLiteral.length - 1;
  let depth = 0, i = braceStart;
  for (; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return text.slice(startIdx, i);
}

// Statement de una línea que arranca con `literal` y termina en `];`
function extractStatement(text, literal) {
  const i = text.indexOf(literal);
  if (i === -1) throw new Error(`No se encontró "${literal}"`);
  const end = text.indexOf("];", i);
  return text.slice(i, end + 2);
}

beforeAll(() => {
  appJs = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");
});

describe("Fase A · el catálogo de resultados es uno solo", () => {
  it("PD_DISPO_OPTIONS tiene los 9 resultados, con la tecla igual a su posición", () => {
    const src = appJs.slice(appJs.indexOf("const PD_DISPO_OPTIONS = ["));
    const opts = new Function("return " + extractStatement(src, "const PD_DISPO_OPTIONS = [").replace("const PD_DISPO_OPTIONS = ", "").replace(/;$/, ""))();
    expect(opts).toHaveLength(9);
    opts.forEach((o, i) => {
      expect(o.k).toBe(String(i + 1));
      expect(typeof o.v).toBe("string");
      expect(o.label.length).toBeGreaterThan(0);
    });
  });

  it("PARIDAD: PD_DISPO_OPTIONS y _pdKeyOutcomes dicen exactamente lo mismo", () => {
    // _pdKeyOutcomes se deja como literal a propósito (dos tests independientes
    // lo fijan letra por letra como guard del orden tecla→resultado). Este test
    // es lo que impide que las dos definiciones se desincronicen en silencio:
    // si alguien toca una sola, acá se cae.
    const src = appJs.slice(appJs.indexOf("const PD_DISPO_OPTIONS = ["));
    const opts = new Function("return " + extractStatement(src, "const PD_DISPO_OPTIONS = [").replace("const PD_DISPO_OPTIONS = ", "").replace(/;$/, ""))();
    const keys = new Function("return " + extractStatement(appJs, "const _pdKeyOutcomes = [").replace("const _pdKeyOutcomes = ", "").replace(/;$/, ""))();
    expect(opts.map((o) => o.v)).toEqual(keys);
  });

  it("la tarjeta y la capa pintan el grid con el MISMO builder (no hay copia inline)", () => {
    expect(appJs).toContain("${_pdDispoGridHTML(lead.id)}");
    expect(appJs).toContain("${_pdDispoGridHTML(trabadoId)}");
    // Una sola definición del builder.
    expect(appJs.split("const _pdDispoGridHTML =").length - 1).toBe(1);
  });
});

describe("Fase A · el cartel no expulsa del dialer", () => {
  it("con el dialer abierto el botón dice 'Marcar acá' y abre la capa; sin dialer sigue navegando", () => {
    const body = extractFunctionBody(appJs, "function _dispoGateRenderBanner() {");
    expect(body).toContain("_enDialer ? 'Marcar acá' : 'Ir a marcar'");
    expect(body).toContain("if ((typeof _pd !== 'undefined') && _pd.active) window._dispoGateMark();");
    // El camino de siempre (fuera del dialer) queda intacto.
    expect(body).toContain("else _dispoFocusLeadRow(_dispoGate?.leadId);");
  });

  it("_dispoFocusLeadRow ya no es alcanzable desde el cartel con el dialer abierto", () => {
    const body = extractFunctionBody(appJs, "function _dispoGateRenderBanner() {");
    // La única llamada del banner a la navegación vive detrás del `else`.
    const llamadas = body.split("_dispoFocusLeadRow(").length - 1;
    expect(llamadas).toBe(1);
    expect(body).toMatch(/else _dispoFocusLeadRow\(/);
  });
});

describe("Fase A · la capa no mueve la cola", () => {
  it("no toca currentIdx, ni queue, ni avanza, ni holdea", () => {
    // Sobre el CÓDIGO, no sobre los comentarios: el cuerpo de _dispoGateMarcar
    // explica por qué NO usa _pdHandleDisposition (que llama a _pdAdvance), y
    // sin quitar los comentarios esta aserción se dispara contra la prosa.
    const sinComentarios = (s) => s.split(/\r?\n/).filter((l) => !l.trim().startsWith("//")).join("\n");
    const capa = sinComentarios(extractFunctionBody(appJs, "window._dispoGateMark = function() {"));
    const marcar = sinComentarios(extractFunctionBody(appJs, "function _dispoGateMarcar(leadId, outcome) {"));
    for (const src of [capa, marcar]) {
      expect(src).not.toMatch(/_pd\.currentIdx\s*(\+\+|--|=[^=])/);
      expect(src).not.toContain("_pdAdvance(");
      expect(src).not.toContain("_pdSkip(");
      expect(src).not.toContain("_pdExit(");
      expect(src).not.toContain("_pd.queue =");
    }
  });

  it("si el lead trabado ES la tarjeta actual, va por el camino normal del dialer (hold, autopiloto)", () => {
    const marcar = extractFunctionBody(appJs, "function _dispoGateMarcar(leadId, outcome) {");
    expect(marcar).toContain("_pd.queue[_pd.currentIdx] === leadId");
    expect(marcar).toContain("window._pdHandleDispositionDirect(leadId, outcome);");
  });

  it("si NO es la tarjeta, usa el handler base y NUNCA _pdHandleDisposition", () => {
    // _pdHandleDisposition tiene una rama `if (!lead) { _pdAdvance(); return; }`
    // que saltearía la tarjeta ACTUAL cuando el lead trabado no está en el cache
    // de la vista — que es justo el caso del dialer de Hoy con un lead trabado
    // que vino de Llamadas.
    const crudo = extractFunctionBody(appJs, "function _dispoGateMarcar(leadId, outcome) {");
    const marcar = crudo.split(/\r?\n/).filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(marcar).toContain("window._handleCallDisposition(leadId, { value: outcome, disabled: false });");
    expect(marcar).not.toMatch(/_pdHandleDisposition\(/);
    // Y el comentario que lo explica sigue ahí, para el que venga después.
    expect(crudo).toContain("_pdAdvance(); return; }");
  });

  it("la rama peligrosa de _pdHandleDisposition sigue existiendo (el comentario no miente)", () => {
    const h = extractFunctionBody(appJs, "window._pdHandleDisposition = async function(leadId, selectEl) {");
    expect(h).toContain("if (!lead) { _pdAdvance(); return; }");
  });
});

describe("Fase A · las teclas 1-9 de la capa marcan el lead TRABADO, no la tarjeta", () => {
  // El handler real de la capa, evaluado con un DOM/estado falso.
  function armar({ key, target = {}, ctrlKey = false }) {
    const src = extractFunctionBody(appJs, "window._dispoGateMark = function() {");
    const i = src.indexOf("_dispoGateMarkKeys = (e) => {");
    const cuerpo = extractFunctionBody(src.slice(i), "_dispoGateMarkKeys = (e) => {");
    const llamadas = [];
    const fn = new Function(
      "trabadoId", "PD_DISPO_OPTIONS", "window", "_dispoGateMarcar", "registro",
      "let " + cuerpo.replace("_dispoGateMarkKeys = ", "handler = ") + "; return handler;"
    )(
      "lead_trabado",
      [
        { v: "answered_interested", k: "1" }, { v: "scheduled_with_admin", k: "2" },
        { v: "answered_not_interested", k: "3" }, { v: "hung_up", k: "4" },
        { v: "no_answer", k: "5" }, { v: "voicemail", k: "6" },
        { v: "callback_later", k: "7" }, { v: "wrong_number", k: "8" },
        { v: "invalid_number", k: "9" },
      ],
      { _dispoGateCloseMark: () => llamadas.push(["cerrar"]) },
      (id, o) => llamadas.push(["marcar", id, o]),
      llamadas
    );
    const ev = {
      key, ctrlKey, metaKey: false, altKey: false,
      target: { matches: (sel) => !!target.esInput && /input/.test(sel) },
      _stop: 0, _prevent: 0,
      stopPropagation() { this._stop++; },
      preventDefault() { this._prevent++; },
    };
    fn(ev);
    return { llamadas, ev };
  }

  it("la tecla '1' marca el lead TRABADO (no el de la tarjeta) y corta la propagación", () => {
    const { llamadas, ev } = armar({ key: "1" });
    expect(llamadas).toEqual([["marcar", "lead_trabado", "answered_interested"]]);
    // Sin este stopPropagation, el handler del dialer (document, fase de
    // burbuja) marcaría ADEMÁS la tarjeta actual: dos resultados, uno mal.
    expect(ev._stop).toBe(1);
    expect(ev._prevent).toBe(1);
  });

  it("la tecla '9' llega hasta el último resultado del catálogo", () => {
    expect(armar({ key: "9" }).llamadas).toEqual([["marcar", "lead_trabado", "invalid_number"]]);
  });

  it("Escape cierra la capa y NO deja salir del dialer por debajo", () => {
    const { llamadas, ev } = armar({ key: "Escape" });
    expect(llamadas).toEqual([["cerrar"]]);
    expect(ev._stop).toBe(1);
  });

  it("tipeando en un input, los números no marcan nada", () => {
    expect(armar({ key: "1", target: { esInput: true } }).llamadas).toEqual([]);
  });

  it("con Ctrl/Cmd apretado no interfiere con los atajos del navegador", () => {
    const { llamadas, ev } = armar({ key: "1", ctrlKey: true });
    expect(llamadas).toEqual([]);
    expect(ev._stop).toBe(0);
  });

  it("una tecla cualquiera pasa de largo sin cortar la propagación", () => {
    const { llamadas, ev } = armar({ key: "k" });
    expect(llamadas).toEqual([]);
    expect(ev._stop).toBe(0);
  });
});

describe("Fase A · la capa se limpia sola", () => {
  it("al limpiarse el gate se cierra la capa (no queda flotando sobre un lead ya marcado)", () => {
    const body = extractFunctionBody(appJs, "function _dispoGateClear(leadId) {");
    expect(body).toContain("window._dispoGateCloseMark?.();");
  });

  it("cerrar desengancha el listener de teclado (en la MISMA fase en que se registró)", () => {
    const cerrar = extractFunctionBody(appJs, "window._dispoGateCloseMark = function() {");
    expect(cerrar).toContain("document.removeEventListener('keydown', _dispoGateMarkKeys, true);");
    const capa = extractFunctionBody(appJs, "window._dispoGateMark = function() {");
    // Capture en los dos lados: con `false` en el remove, el listener quedaría vivo.
    expect(capa).toContain("document.addEventListener('keydown', _dispoGateMarkKeys, true);");
  });

  it("abrir dos veces no apila capas ni listeners", () => {
    const capa = extractFunctionBody(appJs, "window._dispoGateMark = function() {");
    const idx = capa.indexOf("window._dispoGateCloseMark();");
    expect(idx).toBeGreaterThan(-1);
    expect(idx).toBeLessThan(capa.indexOf("document.createElement('div')"));
  });
});

describe("Fase A · la tarjeta avisa cuando el gate es de otro lead", () => {
  it("el aviso compara contra el lead de la tarjeta y ofrece marcar el otro", () => {
    expect(appJs).toContain("${(_dispoGate && _dispoGate.leadId !== lead.id) ?");
    expect(appJs).toContain('onclick="window._dispoGateMark()"');
  });
});

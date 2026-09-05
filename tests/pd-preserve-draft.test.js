// Milestone "operador solo" · Fase B — el re-render del Power Dialer no puede
// pisar lo que se está escribiendo.
//
// El bug: _pdRender reescribe el innerHTML ENTERO de #pd-current-content, y ahí
// adentro vive #pd-call-note. Cualquiera de sus ~11 llamadores (guardar "quién
// atendió", el Instagram del doctor, marcar un follow-up hecho, generar el brief)
// borraba la nota a medio tipear y mandaba el foco a <body> sin ningún aviso: el
// SDR marcaba el resultado después y la nota se iba vacía.
//
// Reproducido en vivo el 2026-09-05 contra datos de producción (6413 leads), con
// un centinela dentro del contenedor para probar que el re-render REALMENTE corrió
// (sin ese control el test pasa sin probar nada — nota #207 de CLAUDE.md):
//   sin el fix → texto "", foco BODY, cursor 0
//   con el fix → texto intacto, foco pd-call-note, cursor 11
//
// Acá se cubren las dos reglas que hacen que preservar no pueda romper nada:
//   (1) solo se restaura sobre la MISMA tarjeta (mismo lead) — el borrador no viaja
//   (2) solo se restaura si el template dejó el campo VACÍO — gana el render
// Sin browser ni jsdom en el repo: se extraen las dos funciones por el literal de
// su declaración y se evalúan con un `document` y un `CSS` inyectados, mismo molde
// que tests/dial-history.test.js.

import { describe, it, beforeAll, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

let appJs;
let indexHtml;
let mk; // factory: (documentFalso) => { _pdSnapshotInputs, _pdRestoreInputs }

// Copiado literal de tests/dial-history.test.js: extrae el cuerpo {...} balanceado
// a partir del literal exacto de la declaración (que DEBE terminar en el `{` que
// abre el cuerpo, no en un `{` de un default param).
function extractFunctionBody(text, startLiteral) {
  if (!startLiteral.endsWith("{")) throw new Error("startLiteral debe terminar en '{'");
  const startIdx = text.indexOf(startLiteral);
  if (startIdx === -1) throw new Error(`No se encontró "${startLiteral}"`);
  const braceStart = startIdx + startLiteral.length - 1;
  let depth = 0;
  let i = braceStart;
  for (; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return text.slice(startIdx, i);
}

// ── DOM mínimo: solo lo que las dos funciones tocan de verdad ──
function campo({ id, value = "", tag = "INPUT", type = "text" }) {
  return {
    id, value, type, tagName: tag,
    selectionStart: value.length, selectionEnd: value.length,
    _focos: 0, _rangos: [],
    focus() { this._focos++; },
    setSelectionRange(a, b) { this._rangos.push([a, b]); this.selectionStart = a; this.selectionEnd = b; },
  };
}

function raiz(campos) {
  return {
    campos,
    querySelectorAll() { return campos; },
    querySelector(sel) { return campos.find((c) => "#" + c.id === sel) || null; },
  };
}

beforeAll(() => {
  appJs = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");
  indexHtml = fs.readFileSync(path.join(process.cwd(), "public", "index.html"), "utf8");
  const snap = extractFunctionBody(appJs, "function _pdSnapshotInputs(root) {");
  const rest = extractFunctionBody(appJs, "function _pdRestoreInputs(root, snap) {");
  // `document` y `CSS` como parámetros: las funciones no son puras (leen
  // activeElement y escapan el id), pero toda su entrada real es `root`.
  const factory = new Function(
    "document", "CSS",
    snap + "\n" + rest + "\nreturn { _pdSnapshotInputs, _pdRestoreInputs };"
  );
  mk = (documentFalso) => factory(documentFalso, { escape: (s) => s });
});

describe("Fase B · el snapshot elige bien qué preservar", () => {
  it("ignora los campos vacíos que nadie está tocando (no hay borrador que salvar)", () => {
    const vacio = campo({ id: "pd-call-note" });
    const { _pdSnapshotInputs } = mk({ activeElement: null });
    expect(_pdSnapshotInputs(raiz([vacio]))).toBe(null);
  });

  it("guarda el campo con texto aunque el foco esté en otro lado", () => {
    const nota = campo({ id: "pd-call-note", value: "pedir por el Dr. Ramirez" });
    const { _pdSnapshotInputs } = mk({ activeElement: null });
    const snap = _pdSnapshotInputs(raiz([nota]));
    expect(snap).toHaveLength(1);
    expect(snap[0]).toMatchObject({ id: "pd-call-note", value: "pedir por el Dr. Ramirez", enfocado: false });
  });

  it("guarda el campo enfocado aunque esté vacío, con su cursor", () => {
    const nota = campo({ id: "pd-call-note" });
    nota.selectionStart = 0; nota.selectionEnd = 0;
    const { _pdSnapshotInputs } = mk({ activeElement: nota });
    const snap = _pdSnapshotInputs(raiz([nota]));
    expect(snap[0]).toMatchObject({ enfocado: true, selStart: 0, selEnd: 0 });
  });

  it("no toca checkbox/radio/botones: su `value` no es un borrador", () => {
    const campos = ["checkbox", "radio", "button", "submit", "reset", "file", "hidden"]
      .map((type, i) => campo({ id: "c" + i, value: "on", type }));
    const { _pdSnapshotInputs } = mk({ activeElement: null });
    expect(_pdSnapshotInputs(raiz(campos))).toBe(null);
  });

  it("un textarea con texto SÍ entra (el type de un textarea no es 'text')", () => {
    const ta = campo({ id: "pd-nota-larga", value: "contexto", tag: "TEXTAREA", type: "textarea" });
    const { _pdSnapshotInputs } = mk({ activeElement: null });
    expect(_pdSnapshotInputs(raiz([ta]))).toHaveLength(1);
  });
});

describe("Fase B · el restore devuelve el borrador sin pisar al render", () => {
  it("devuelve texto, foco y cursor exactos — el caso reproducido en vivo", () => {
    const antes = campo({ id: "pd-call-note", value: "atendio la secre, pedir por el Dr. Ramirez" });
    antes.selectionStart = 11; antes.selectionEnd = 11;
    const { _pdSnapshotInputs, _pdRestoreInputs } = mk({ activeElement: antes });
    const snap = _pdSnapshotInputs(raiz([antes]));

    // El render reescribió la tarjeta: campo nuevo, vacío, sin foco.
    const despues = campo({ id: "pd-call-note" });
    _pdRestoreInputs(raiz([despues]), snap);

    expect(despues.value).toBe("atendio la secre, pedir por el Dr. Ramirez");
    expect(despues._focos).toBe(1);
    expect(despues._rangos).toEqual([[11, 11]]);
  });

  it("REGLA 2: si el template escribió un valor, gana el render y no el borrador", () => {
    const snap = [{ id: "pd-call-note", value: "borrador viejo", enfocado: true, selStart: 3, selEnd: 3 }];
    const nuevo = campo({ id: "pd-call-note", value: "lo que puso el render" });
    const { _pdRestoreInputs } = mk({ activeElement: null });
    _pdRestoreInputs(raiz([nuevo]), snap);
    expect(nuevo.value).toBe("lo que puso el render");
    expect(nuevo._focos).toBe(0);
  });

  it("no roba el foco si el SDR ya se había ido del campo: restaura el texto y nada más", () => {
    const snap = [{ id: "pd-call-note", value: "texto a medias", enfocado: false, selStart: 5, selEnd: 5 }];
    const nuevo = campo({ id: "pd-call-note" });
    const { _pdRestoreInputs } = mk({ activeElement: null });
    _pdRestoreInputs(raiz([nuevo]), snap);
    expect(nuevo.value).toBe("texto a medias");
    expect(nuevo._focos).toBe(0);
  });

  it("si el campo ya no existe en la tarjeta nueva, no explota", () => {
    const snap = [{ id: "pd-call-note", value: "x", enfocado: true, selStart: 0, selEnd: 0 }];
    const { _pdRestoreInputs } = mk({ activeElement: null });
    expect(() => _pdRestoreInputs(raiz([]), snap)).not.toThrow();
  });

  it("ida y vuelta con varios campos a la vez", () => {
    const nota = campo({ id: "pd-call-note", value: "uno" });
    const otro = campo({ id: "pd-otro", value: "dos" });
    const { _pdSnapshotInputs, _pdRestoreInputs } = mk({ activeElement: otro });
    const snap = _pdSnapshotInputs(raiz([nota, otro]));
    const n2 = campo({ id: "pd-call-note" });
    const o2 = campo({ id: "pd-otro" });
    _pdRestoreInputs(raiz([n2, o2]), snap);
    expect([n2.value, o2.value]).toEqual(["uno", "dos"]);
    expect(n2._focos).toBe(0);
    expect(o2._focos).toBe(1);
  });
});

describe("Fase B · el cableado dentro de _pdRender", () => {
  it("REGLA 1: el snapshot se toma solo si la tarjeta es del MISMO lead, y antes de reescribirla", () => {
    const guard = "const _pdBorrador = (main.dataset.pdLeadId === lead.id) ? _pdSnapshotInputs(main) : null;";
    expect(appJs).toContain(guard);
    // El orden importa: capturar DESPUÉS de reescribir leería la tarjeta vacía.
    expect(appJs.indexOf(guard)).toBeLessThan(appJs.indexOf("main.innerHTML = `"));
  });

  it("el restore corre después de pintar, y deja sellado el lead de la tarjeta", () => {
    expect(appJs).toContain("main.dataset.pdLeadId = lead.id;");
    expect(appJs).toContain("if (_pdBorrador) _pdRestoreInputs(main, _pdBorrador);");
    expect(appJs.indexOf("main.innerHTML = `")).toBeLessThan(appJs.indexOf("if (_pdBorrador) _pdRestoreInputs(main, _pdBorrador);"));
  });

  it("hay un solo lugar que reescribe la tarjeta (si aparece otro, este fix no lo cubre)", () => {
    expect(appJs.split("main.innerHTML = `").length - 1).toBe(1);
  });

  it("las dos vías de disposición siguen vaciando la nota antes de re-renderizar", () => {
    // Es lo que impide que una nota ya consumida se resucite y se reenvíe pegada
    // a la disposición siguiente. Si alguien saca estos `value = ''`, el fix de
    // preservación pasa de inocuo a peligroso.
    expect(appJs.split("if (pdNote) { body.notes = pdNote.slice(0, 500); if (pdNoteEl) pdNoteEl.value = ''; }").length - 1).toBe(2);
  });

  it("el cache-buster de app.js se bumpeó (regla dura del proyecto)", () => {
    const m = indexHtml.match(/\/app\.js\?v=(\d{8}[a-z])/);
    expect(m).toBeTruthy();
    expect(m[1] >= "20260905a").toBe(true);
  });
});

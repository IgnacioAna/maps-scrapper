// Test de RESP-03 (Fase 36, Plan 03) — el teclado DTMF arranca visible y
// recuerda la preferencia por navegador. Sin browser ni jsdom en el repo:
// mismo molde que tests/dial-hold.test.js / tests/dispo-feedback.test.js /
// tests/dispo-async-meta.test.js.
//
// 1. Comportamiento: las 3 funciones reales (`_dtmfPadPrefOpen` /
//    `_applyDtmfPadPref` / `_setDtmfPadPref`) extraídas y evaluadas con
//    `new Function`, inyectando `document`/`localStorage` como stubs (no hay
//    jsdom).
// 2. Fuente / cableado: el toggle deja de mutar el estilo directo y pasa a
//    llamar `_setDtmfPadPref`; `_startTelnyxCall` aplica la preferencia
//    DESPUÉS de que el panel exista en pantalla; las 12 teclas siguen
//    cableadas exactamente igual.
// 3. Cache-buster: forma + estrictamente mayor que el baseline real.

import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

let appJs;
let indexHtml;

// Copiado literal de tests/dial-hold.test.js / tests/dispo-feedback.test.js /
// tests/dispo-async-meta.test.js — extrae el cuerpo `{...}` balanceado de una
// función a partir del literal exacto de su declaración (`startLiteral` DEBE
// terminar en el `{` que abre el cuerpo, no el primer `{` que aparezca
// después — ej. un default param como `opts = {}`).
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

// ─── Comportamiento: evaluar las 3 funciones reales con stubs ─────────────

describe("Comportamiento de _dtmfPadPrefOpen / _applyDtmfPadPref / _setDtmfPadPref (funciones reales vía new Function, sin jsdom)", () => {
  let factory;

  beforeAll(() => {
    const prefOpenBody = extractFunctionBody(appJs, "function _dtmfPadPrefOpen() {");
    const applyBody = extractFunctionBody(appJs, "function _applyDtmfPadPref(open) {");
    const setBody = extractFunctionBody(appJs, "function _setDtmfPadPref(open) {");
    const src = `${prefOpenBody}\n${applyBody}\n${setBody}\nreturn { prefOpen: _dtmfPadPrefOpen, apply: _applyDtmfPadPref, setPref: _setDtmfPadPref };`;
    factory = new Function("document", "localStorage", src);
  });

  // localStorage stub: un Map detrás de getItem/setItem alcanza.
  function makeStorage(initial = {}) {
    const map = new Map(Object.entries(initial));
    return {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => { map.set(k, String(v)); },
      _map: map,
    };
  }

  function makeThrowingStorage() {
    return {
      getItem: () => { throw new Error("localStorage restringido"); },
      setItem: () => { throw new Error("localStorage restringido"); },
    };
  }

  // document stub: el pad y el botón como objetos simples con lo que las
  // funciones reales tocan (style.display, setAttribute, style inline).
  function makeDocStub({ withPad = true, withToggle = true } = {}) {
    const padEl = withPad ? { style: { display: "" } } : null;
    const toggleEl = withToggle
      ? {
          _attrs: {},
          setAttribute(k, v) { this._attrs[k] = v; },
          style: { background: "", borderColor: "", color: "" },
        }
      : null;
    return {
      getElementById: (id) => {
        if (id === "telnyx-dtmf-pad") return padEl;
        if (id === "telnyx-call-dtmf-toggle") return toggleEl;
        return null;
      },
      _padEl: padEl,
      _toggleEl: toggleEl,
    };
  }

  it("sin nada guardado, _dtmfPadPrefOpen() es true — el default es visible, la mitad del criterio RESP-03", () => {
    const storage = makeStorage({});
    const { prefOpen } = factory(makeDocStub(), storage);
    expect(prefOpen()).toBe(true);
  });

  it("con '0' guardado, _dtmfPadPrefOpen() es false", () => {
    const storage = makeStorage({ scm_dtmf_pad: "0" });
    const { prefOpen } = factory(makeDocStub(), storage);
    expect(prefOpen()).toBe(false);
  });

  it("con '1' guardado, _dtmfPadPrefOpen() es true", () => {
    const storage = makeStorage({ scm_dtmf_pad: "1" });
    const { prefOpen } = factory(makeDocStub(), storage);
    expect(prefOpen()).toBe(true);
  });

  it("con basura ('x') guardada, _dtmfPadPrefOpen() es true — solo '0' cierra", () => {
    const storage = makeStorage({ scm_dtmf_pad: "x" });
    const { prefOpen } = factory(makeDocStub(), storage);
    expect(prefOpen()).toBe(true);
  });

  it("si localStorage.getItem TIRA, _dtmfPadPrefOpen() es true — el default gana, no se rompe la llamada", () => {
    const { prefOpen } = factory(makeDocStub(), makeThrowingStorage());
    expect(() => prefOpen()).not.toThrow();
    expect(prefOpen()).toBe(true);
  });

  it("_applyDtmfPadPref(true) deja pad.style.display en 'grid'", () => {
    const doc = makeDocStub();
    const { apply } = factory(doc, makeStorage());
    apply(true);
    expect(doc._padEl.style.display).toBe("grid");
  });

  it("_applyDtmfPadPref(false) deja pad.style.display en 'none'", () => {
    const doc = makeDocStub();
    const { apply } = factory(doc, makeStorage());
    apply(false);
    expect(doc._padEl.style.display).toBe("none");
  });

  it("_applyDtmfPadPref no escribe nada en localStorage (solo pinta)", () => {
    const doc = makeDocStub();
    const storage = makeStorage();
    const { apply } = factory(doc, storage);
    apply(true);
    expect(storage._map.has("scm_dtmf_pad")).toBe(false);
  });

  it("con los nodos ausentes (pad y toggle null), _applyDtmfPadPref no tira", () => {
    const doc = makeDocStub({ withPad: false, withToggle: false });
    const { apply } = factory(doc, makeStorage());
    expect(() => apply(true)).not.toThrow();
    expect(() => apply(false)).not.toThrow();
  });

  it("_setDtmfPadPref(false) escribe '0' en scm_dtmf_pad y aplica 'none'", () => {
    const doc = makeDocStub();
    const storage = makeStorage();
    const { setPref } = factory(doc, storage);
    setPref(false);
    expect(storage._map.get("scm_dtmf_pad")).toBe("0");
    expect(doc._padEl.style.display).toBe("none");
  });

  it("_setDtmfPadPref(true) escribe '1' en scm_dtmf_pad y aplica 'grid' — persistencia en los DOS sentidos", () => {
    const doc = makeDocStub();
    const storage = makeStorage();
    const { setPref } = factory(doc, storage);
    setPref(true);
    expect(storage._map.get("scm_dtmf_pad")).toBe("1");
    expect(doc._padEl.style.display).toBe("grid");
  });

  it("_setDtmfPadPref no tira si localStorage.setItem tira (modo restringido) — igual aplica el estilo", () => {
    const doc = makeDocStub();
    const { setPref } = factory(doc, makeThrowingStorage());
    expect(() => setPref(true)).not.toThrow();
    expect(doc._padEl.style.display).toBe("grid");
  });
});

// ─── Fuente / cableado ──────────────────────────────────────────────────

describe("El toggle #telnyx-call-dtmf-toggle llama a _setDtmfPadPref (ya no muta pad.style.display directo)", () => {
  it("el handler del click contiene _setDtmfPadPref(", () => {
    const body = extractFunctionBody(
      appJs,
      "document.getElementById('telnyx-call-dtmf-toggle')?.addEventListener('click', () => {"
    );
    expect(body).toContain("_setDtmfPadPref(");
  });

  it("el flip volátil pad.style.display === 'grid' ? 'none' : 'grid' desapareció del archivo", () => {
    expect(countOccurrences(appJs, "pad.style.display === 'grid' ? 'none' : 'grid'")).toBe(0);
  });

  it("las 3 funciones se declaran exactamente una vez cada una", () => {
    expect(countOccurrences(appJs, "function _dtmfPadPrefOpen() {")).toBe(1);
    expect(countOccurrences(appJs, "function _applyDtmfPadPref(open) {")).toBe(1);
    expect(countOccurrences(appJs, "function _setDtmfPadPref(open) {")).toBe(1);
  });

  it("scm_dtmf_pad aparece al menos 2 veces en el archivo (lectura + escritura)", () => {
    expect(countOccurrences(appJs, "scm_dtmf_pad")).toBeGreaterThanOrEqual(2);
  });
});

describe("_applyDtmfPadPref(_dtmfPadPrefOpen()) se aplica dentro de _startTelnyxCall, DESPUÉS de que el panel exista en pantalla", () => {
  it("el literal aparece dentro del cuerpo de window._startTelnyxCall = async (...)", () => {
    const body = extractFunctionBody(appJs, "window._startTelnyxCall = async (leadId, phoneOverride) => {");
    expect(body).toContain("_applyDtmfPadPref(_dtmfPadPrefOpen());");
  });

  it("su índice es POSTERIOR al de panel.style.display = 'flex'; — aplicar antes de que el panel exista no serviría de nada", () => {
    const body = extractFunctionBody(appJs, "window._startTelnyxCall = async (leadId, phoneOverride) => {");
    const panelIdx = body.indexOf("panel.style.display = 'flex';");
    const applyIdx = body.indexOf("_applyDtmfPadPref(_dtmfPadPrefOpen());");
    expect(panelIdx).toBeGreaterThan(-1);
    expect(applyIdx).toBeGreaterThan(-1);
    expect(applyIdx).toBeGreaterThan(panelIdx);
  });
});

describe("Las 12 teclas siguen cableadas exactamente igual (T-36-13: no se rompió el envío de tonos)", () => {
  it("el querySelectorAll de las teclas sigue apuntando a '#telnyx-dtmf-pad .dtmf-key'", () => {
    expect(appJs).toContain("document.querySelectorAll('#telnyx-dtmf-pad .dtmf-key').forEach((btn) => {");
  });

  it("la guarda if (!k || !_telnyx.activeCall) return; sigue presente", () => {
    expect(appJs).toContain("if (!k || !_telnyx.activeCall) return;");
  });

  it("el envío de tonos (_telnyx.activeCall.dtmf(k)) sigue apareciendo una sola vez", () => {
    expect(countOccurrences(appJs, "_telnyx.activeCall.dtmf(k)")).toBe(1);
  });

  it("public/index.html sigue teniendo 12 dtmf-key", () => {
    expect(countOccurrences(indexHtml, "dtmf-key")).toBe(12);
  });
});

// ─── Cache-buster ───────────────────────────────────────────────────────

describe("Cache-buster bumpeado (public/index.html)", () => {
  // Baseline REAL que dejó 36-02, confirmado en disco antes de este plan:
  // app.js 20260822d (línea 3750), style.css 20260822a (línea 15). Este plan
  // NO toca style.css (solo public/app.js + public/index.html) — se verifica
  // que su forma siga válida, no que haya cambiado.
  it("app.js?v= tiene forma válida y es estrictamente mayor que el baseline real de este plan (20260822d)", () => {
    const m = /app\.js\?v=(\d{8}[a-z])/.exec(indexHtml);
    expect(m).toBeTruthy();
    expect(m[1] > "20260822d").toBe(true);
  });

  it("app.js?v= aparece una sola vez (no se duplicó la etiqueta)", () => {
    expect(countOccurrences(indexHtml, "app.js?v=")).toBe(1);
  });

  it("style.css?v= sigue con forma válida — este plan NO tocó style.css", () => {
    const m = /style\.css\?v=(\d{8}[a-z])/.exec(indexHtml);
    expect(m).toBeTruthy();
  });
});

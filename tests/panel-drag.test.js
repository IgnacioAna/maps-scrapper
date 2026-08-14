// Test del motor de arrastre de los paneles de llamada (Fase 28, Plan 03).
// Extrae el bloque PANEL-DRAG-PURE literal de public/app.js (sin bundler, sin
// jsdom en el repo) y lo evalúa aislado — mismo patrón que
// tests/dtpicker-core.test.js: estos helpers no tocan el DOM, la red ni
// almacenamiento persistente.

import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

const START_MARKER = "// ─── [28-03] PANEL-DRAG-PURE: INICIO ───";
const END_MARKER = "// ─── [28-03] PANEL-DRAG-PURE: FIN ───";

let tlx;
let appSrc;
let htmlSrc;

beforeAll(() => {
  appSrc = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");
  htmlSrc = fs.readFileSync(path.join(process.cwd(), "public", "index.html"), "utf8");

  const startIdx = appSrc.indexOf(START_MARKER);
  const endIdx = appSrc.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(
      `No se encontraron los marcadores PANEL-DRAG-PURE en public/app.js (start=${startIdx}, end=${endIdx}). ` +
        `Verificar que "${START_MARKER}" y "${END_MARKER}" existen literales en el archivo.`
    );
  }
  const block = appSrc.slice(startIdx, endIdx);
  const factory = new Function(
    block +
      `
    return { _tlxClampPos, _tlxPosKey };
    `
  );
  tlx = factory();
});

describe("PANEL-DRAG-PURE: _tlxClampPos", () => {
  it("posición que ya entra en el viewport no se toca", () => {
    expect(tlx._tlxClampPos(100, 80, 420, 600, 1920, 1080)).toEqual({ left: 100, top: 80 });
  });

  it("posición negativa se clampea a 0,0", () => {
    expect(tlx._tlxClampPos(-300, -50, 420, 600, 1920, 1080)).toEqual({ left: 0, top: 0 });
  });

  it("posición que se pasa del borde derecho/inferior se pega a vw-w, vh-h", () => {
    expect(tlx._tlxClampPos(1900, 1000, 420, 600, 1920, 1080)).toEqual({ left: 1500, top: 480 });
  });

  it("panel más grande que el viewport nunca da left negativo ni NaN", () => {
    const out = tlx._tlxClampPos(500, 500, 2000, 800, 1200, 900);
    expect(out.left).toBe(0);
    expect(Number.isNaN(out.left)).toBe(false);
    expect(Number.isNaN(out.top)).toBe(false);
  });

  it("valores no numéricos devuelven {left:0, top:0} en vez de propagar basura", () => {
    expect(tlx._tlxClampPos(NaN, 80, 420, 600, 1920, 1080)).toEqual({ left: 0, top: 0 });
    expect(tlx._tlxClampPos(undefined, 80, 420, 600, 1920, 1080)).toEqual({ left: 0, top: 0 });
    expect(tlx._tlxClampPos("abc", 80, 420, 600, 1920, 1080)).toEqual({ left: 0, top: 0 });
  });
});

describe("PANEL-DRAG-PURE: _tlxPosKey", () => {
  it("arma la clave con panelKey y userId", () => {
    expect(tlx._tlxPosKey("call", "user_7")).toBe("tlx_panel_pos_call_user_7");
  });

  it("cae a 'anon' con userId vacío", () => {
    expect(tlx._tlxPosKey("script", "")).toBe("tlx_panel_pos_script_anon");
  });

  it("cae a 'anon' con userId nulo/indefinido", () => {
    expect(tlx._tlxPosKey("call", null)).toBe("tlx_panel_pos_call_anon");
    expect(tlx._tlxPosKey("call", undefined)).toBe("tlx_panel_pos_call_anon");
  });
});

describe("PANEL-DRAG-PURE: bloque puro sin dependencias de entorno", () => {
  it("no menciona document ni localStorage dentro de los marcadores", () => {
    const startIdx = appSrc.indexOf(START_MARKER);
    const endIdx = appSrc.indexOf(END_MARKER);
    const block = appSrc.slice(startIdx, endIdx);
    expect(/document|localStorage/.test(block)).toBe(false);
  });
});

describe("PANEL-DRAG-PURE: aserciones de fuente sobre public/index.html (D-11)", () => {
  it("el selector del empuje contiene :not(.tlx-dragged) exactamente una vez", () => {
    const matches = htmlSrc.match(/:not\(\.tlx-dragged\)/g) || [];
    expect(matches.length).toBe(1);
  });

  it("la regla del empuje conserva !important y la transición original", () => {
    const line = htmlSrc.split("\n").find((l) => l.includes("body.tlx-script-open #telnyx-call-panel"));
    expect(line).toBeTruthy();
    expect(line).toContain("!important");
    expect(line).toContain("transition:transform 0.25s");
  });

  it("existe la regla .tlx-dragged { animation:none !important; }", () => {
    expect(htmlSrc).toContain(".tlx-dragged { animation:none !important; }");
  });

  it("los dos headers tienen id para servir de drag handle", () => {
    expect((htmlSrc.match(/id="telnyx-call-panel-header"/g) || []).length).toBe(1);
    expect((htmlSrc.match(/id="telnyx-script-panel-header"/g) || []).length).toBe(1);
  });

  it("los dos botones de centrar existen", () => {
    expect((htmlSrc.match(/id="telnyx-call-recenter"/g) || []).length).toBe(1);
    expect((htmlSrc.match(/id="telnyx-script-recenter"/g) || []).length).toBe(1);
  });

  it("cache-buster de app.js bumpeado a v=20260814c", () => {
    const m = htmlSrc.match(/app\.js\?v=([0-9a-z]+)/i);
    expect(m && m[1]).toBe("20260814c");
  });
});

describe("PANEL-DRAG-PURE: aserciones de fuente sobre public/app.js (motor de arrastre)", () => {
  it("el arrastre usa setPointerCapture (eventos de puntero con captura)", () => {
    expect(appSrc).toContain("setPointerCapture");
  });

  it("_tlxApplyPos existe como declaración de función", () => {
    expect(appSrc).toContain("function _tlxApplyPos(panelKey)");
  });

  it("_tlxRecenter reescribe explícitamente left/top/transform con los valores home (nunca strings vacíos)", () => {
    const idx = appSrc.indexOf("function _tlxRecenter(panelKey)");
    expect(idx).toBeGreaterThan(-1);
    const slice = appSrc.slice(idx, idx + 700);
    expect(slice).toContain("panel.style.left = cfg.home.left");
    expect(slice).toContain("panel.style.top = cfg.home.top");
    expect(slice).toContain("panel.style.transform = cfg.home.transform");
  });

  it("los dos paneles quedan registrados y expone window._tlxRecenter para diagnóstico", () => {
    expect(appSrc).toContain("_tlxRegisterDrag('call')");
    expect(appSrc).toContain("_tlxRegisterDrag('script')");
    expect(appSrc).toContain("window._tlxRecenter = _tlxRecenter");
  });
});

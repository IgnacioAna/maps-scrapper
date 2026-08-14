// Test de los helpers puros del calendario propio (Fase 28, Plan 01).
// Extrae el bloque DTPICKER-PURE literal de public/app.js (sin bundler, sin
// jsdom en el repo) y lo evalúa aislado — mismo patrón que
// tests/app-version.test.js pero sin necesitar servidor: estos helpers no
// tocan el DOM, la red ni almacenamiento persistente.

import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

const START_MARKER = "// ─── [28-01] DTPICKER-PURE: INICIO ───";
const END_MARKER = "// ─── [28-01] DTPICKER-PURE: FIN ───";

let dtp;

beforeAll(() => {
  const src = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");
  const startIdx = src.indexOf(START_MARKER);
  const endIdx = src.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(
      `No se encontraron los marcadores DTPICKER-PURE en public/app.js (start=${startIdx}, end=${endIdx}). ` +
        `Verificar que "${START_MARKER}" y "${END_MARKER}" existen literales en el archivo.`
    );
  }
  const block = src.slice(startIdx, endIdx);
  const factory = new Function(
    block +
      `
    return { _dtpPad2, _dtpFormatValue, _dtpParseValue, _dtpDayKey, _dtpBuildMonthGrid, _dtpRelativeLabel, _dtpFullLabel, _dtpCountByDay };
    `
  );
  dtp = factory();
});

describe("DTPICKER-PURE: contrato de formato", () => {
  it("_dtpFormatValue produce YYYY-MM-DDTHH:mm exacto", () => {
    expect(dtp._dtpFormatValue(new Date(2026, 7, 18, 10, 0))).toBe("2026-08-18T10:00");
  });

  it("el output siempre matchea el regex de formato", () => {
    const out = dtp._dtpFormatValue(new Date(2026, 0, 5, 3, 7));
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it("round-trip: parse(format(d)) conserva la hora de pared local", () => {
    const d = new Date(2026, 11, 31, 23, 59);
    const roundTripped = dtp._dtpParseValue(dtp._dtpFormatValue(d));
    expect(roundTripped.getFullYear()).toBe(d.getFullYear());
    expect(roundTripped.getMonth()).toBe(d.getMonth());
    expect(roundTripped.getDate()).toBe(d.getDate());
    expect(roundTripped.getHours()).toBe(d.getHours());
    expect(roundTripped.getMinutes()).toBe(d.getMinutes());
  });

  it("_dtpParseValue devuelve null ante un string inválido o ausente", () => {
    expect(dtp._dtpParseValue("no-es-fecha")).toBeNull();
    expect(dtp._dtpParseValue("")).toBeNull();
    expect(dtp._dtpParseValue(null)).toBeNull();
  });
});

describe("DTPICKER-PURE: day-key local (nunca toISOString)", () => {
  it("_dtpDayKey nunca se corre al día siguiente por UTC", () => {
    expect(dtp._dtpDayKey(new Date(2026, 7, 18, 23, 30))).toBe("2026-08-18");
  });
});

describe("DTPICKER-PURE: grilla del mes", () => {
  it("_dtpBuildMonthGrid: 42 celdas, arranca en lunes, agosto 2026 con 31 in-month", () => {
    const cells = dtp._dtpBuildMonthGrid(2026, 7); // agosto, 0-based
    expect(cells.length).toBe(42);
    expect(cells[0].date.getDay()).toBe(1); // lunes
    const aug1 = cells.find((c) => c.key === "2026-08-01");
    expect(aug1).toBeTruthy();
    expect(aug1.inMonth).toBe(true);
    expect(cells.indexOf(aug1)).toBe(5);
    const inMonthCount = cells.filter((c) => c.inMonth).length;
    expect(inMonthCount).toBe(31);
  });
});

describe("DTPICKER-PURE: etiqueta relativa", () => {
  it("Hoy / Mañana / en N días / hace N días, por día calendario (no por diferencia de horas)", () => {
    const now = new Date(2026, 7, 14, 23, 50); // 14/08 23:50
    expect(dtp._dtpRelativeLabel(new Date(2026, 7, 14, 0, 5), now).texto).toBe("Hoy");
    expect(dtp._dtpRelativeLabel(new Date(2026, 7, 15, 0, 5), now).texto).toBe("Mañana");
    expect(dtp._dtpRelativeLabel(new Date(2026, 7, 18, 10, 0), now).texto).toBe("en 4 días");
    expect(dtp._dtpRelativeLabel(new Date(2026, 7, 12, 10, 0), now).texto).toBe("hace 2 días");
  });
});

describe("DTPICKER-PURE: etiqueta completa (D-04)", () => {
  it("arma 'Martes 18/08 · en 4 días · 10:00'", () => {
    const label = dtp._dtpFullLabel(new Date(2026, 7, 18, 10, 0), new Date(2026, 7, 14, 9, 0));
    expect(label).toContain("18/08");
    expect(label).toContain("en 4 días");
    expect(label).toContain("10:00");
    expect(label.split(" · ").length).toBe(3);
    expect(label[0]).toBe(label[0].toUpperCase());
  });
});

describe("DTPICKER-PURE: carga por día (D-07)", () => {
  it("cuenta callbacks manuales del dueño + entries de calendario, excluye cadencia automática y canceladas/reagendadas", () => {
    const leads = [
      { id: "l1", manualCallbackByOwner: true, callbackAt: new Date(2026, 7, 18, 10, 0).toISOString() },
      { id: "l2", manualCallbackByOwner: true, callbackAt: new Date(2026, 7, 18, 15, 0).toISOString() },
      { id: "l3", manualCallbackByOwner: false, callbackAt: new Date(2026, 7, 18, 11, 0).toISOString() }, // reintento automático, no cuenta
      { id: "l4", manualCallbackByOwner: true, callbackAt: "" }, // sin fecha real
      { id: "l5", manualCallbackByOwner: true, callbackAt: new Date(2026, 7, 19, 9, 0).toISOString() },
    ];
    const calendarEntries = [
      { fecha: new Date(2026, 7, 18, 16, 0).toISOString(), calendarioEstado: "agendada" },
      { fecha: new Date(2026, 7, 18, 17, 0).toISOString(), calendarioEstado: "cancelada" },
      { fecha: new Date(2026, 7, 18, 18, 0).toISOString(), calendarioEstado: "reagendada" },
    ];
    const map = dtp._dtpCountByDay(leads, calendarEntries);
    expect(map.get("2026-08-18")).toBe(3); // l1 + l2 + 1 entry agendada
    expect(map.get("2026-08-19")).toBe(1); // l5
    expect(map.has("2026-08-17")).toBe(false);
  });

  it("tolera null/undefined devolviendo un Map vacío", () => {
    expect(dtp._dtpCountByDay(null, null).size).toBe(0);
    expect(dtp._dtpCountByDay(undefined, undefined).size).toBe(0);
  });
});

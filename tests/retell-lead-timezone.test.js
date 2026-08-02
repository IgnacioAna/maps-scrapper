// Phase 26: la reunión se agenda en la hora LOCAL del prospecto.
//
// El bug: _retellParseBookingDate hacía Date.parse("2026-08-14T14:00") en el
// servidor. Un datetime sin offset se interpreta en la zona del proceso, y
// Railway corre en UTC → "las 2 de la tarde" acordadas con un prospecto
// mexicano quedaban guardadas como 14:00Z, o sea 8:00 AM en México.
// Falla en silencio: /book responde ok:true y la cita aparece en el calendario.
import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), "scm-tz-"));
process.env.DATA_DIR = tmpData;
process.env.NODE_ENV = "test";
process.env.OPENAI_API_KEY = "";
process.env.MERCURY_API_KEY = "";
process.env.QWEN_API_KEY = "";

let V;

beforeAll(async () => {
  fs.writeFileSync(path.join(tmpData, "auth.json"), JSON.stringify({ users: [], sessions: [], invites: [] }));
  fs.writeFileSync(path.join(tmpData, "setters.json"), JSON.stringify({ setters: [], variants: [], leads: {}, calendar: [], sessions: [] }));
  fs.writeFileSync(path.join(tmpData, "history.json"), JSON.stringify({ entries: {}, searches: [], lastPages: {} }));
  await import("../index.js");
  V = globalThis.__voiceAgent;
});

describe("zona horaria del lead", () => {
  it("mapea país → zona IANA, y devuelve '' para países no mapeados", () => {
    expect(V._leadTimezone({ country: "México" })).toBe("America/Mexico_City");
    expect(V._leadTimezone({ country: "Mexico" })).toBe("America/Mexico_City");
    expect(V._leadTimezone({ country: "Colombia" })).toBe("America/Bogota");
    expect(V._leadTimezone({ country: "  Chile  " })).toBe("America/Santiago");
    expect(V._leadTimezone({ country: "Wakanda" })).toBe("");
    expect(V._leadTimezone({})).toBe("");
    expect(V._leadTimezone(null)).toBe("");
  });

  it("EL BUG: 14:00 acordadas en México son 20:00 UTC, no 14:00 UTC", () => {
    const iso = V._wallTimeToUtcIso("2026-08-14", "14:00", "America/Mexico_City");
    // México (centro) es UTC-6 todo el año desde que eliminó el horario de verano.
    expect(iso).toBe("2026-08-14T20:00:00.000Z");

    // Y al volver a la zona del prospecto tiene que dar la hora que se acordó.
    const back = new Date(iso).toLocaleString("en-US", {
      timeZone: "America/Mexico_City", hour: "2-digit", hour12: false,
    });
    expect(back.replace(/\D/g, "")).toBe("14");
  });

  it("resuelve bien en una zona que SÍ tiene horario de verano (España)", () => {
    // Agosto: CEST, UTC+2 → 10:00 de pared son las 08:00 UTC.
    expect(V._wallTimeToUtcIso("2026-08-14", "10:00", "Europe/Madrid"))
      .toBe("2026-08-14T08:00:00.000Z");
    // Enero: CET, UTC+1 → 10:00 de pared son las 09:00 UTC.
    expect(V._wallTimeToUtcIso("2026-01-14", "10:00", "Europe/Madrid"))
      .toBe("2026-01-14T09:00:00.000Z");
  });

  it("sin hora asume medianoche local, no medianoche UTC", () => {
    expect(V._wallTimeToUtcIso("2026-08-14", "", "America/Mexico_City"))
      .toBe("2026-08-14T06:00:00.000Z");
  });

  it("devuelve null si la fecha no tiene formato YYYY-MM-DD", () => {
    expect(V._wallTimeToUtcIso("el martes", "14:00", "America/Mexico_City")).toBeNull();
    expect(V._wallTimeToUtcIso("", "14:00", "America/Mexico_City")).toBeNull();
  });

  it("_tzOffsetMs devuelve el offset con signo correcto", () => {
    const ms = Date.UTC(2026, 7, 14, 12, 0, 0);
    expect(V._tzOffsetMs(ms, "America/Mexico_City")).toBe(-6 * 3600 * 1000);
    expect(V._tzOffsetMs(ms, "Europe/Madrid")).toBe(2 * 3600 * 1000);
    expect(V._tzOffsetMs(ms, "UTC")).toBe(0);
  });
});

describe("fecha_local en las variables del dispatch", () => {
  it("manda la fecha actual del lead, no la del servidor", () => {
    const vars = V._retellDynamicVariables(
      { id: "l1", name: "Clínica", country: "México" },
      { whatsappReturn: "" },
    );
    expect(vars.fecha_local).toBeTruthy();
    // Tiene que traer el año en curso: es lo que impide que el modelo calcule
    // las fechas contra su año de entrenamiento.
    expect(vars.fecha_local).toContain(String(new Date().getFullYear()));
  });

  it("un país sin mapear igual recibe una fecha (cae a la TZ de negocio)", () => {
    const vars = V._retellDynamicVariables(
      { id: "l2", name: "X", country: "Wakanda" },
      { whatsappReturn: "" },
    );
    expect(vars.fecha_local).toBeTruthy();
  });

  it("no rompe el contrato: las 10 variables previas siguen estando", () => {
    const vars = V._retellDynamicVariables(
      { id: "l3", name: "N", city: "C", country: "México", reviews: 10, rating: 4.5, yearsActive: 3, doctor: "Dr. X" },
      { whatsappReturn: "+52" },
    );
    for (const k of ["nombre", "ciudad", "pais", "reviews", "rating", "years", "doctor_name", "gancho", "leadId", "whatsapp"]) {
      expect(vars).toHaveProperty(k);
      expect(typeof vars[k]).toBe("string");
    }
  });
});

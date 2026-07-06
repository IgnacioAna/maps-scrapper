// Test del filtro anti-alucinación de Whisper (_cleanWhisperSegments).
// Bug 2026-06-26: en llamadas de buzón/no-atendió (audio casi en silencio)
// Whisper inventa texto y lo repite en loop -> el transcript salía
// "Reactivación de pacientes." 30 veces. Filtramos por no_speech_prob/
// avg_logprob/compression_ratio + colapso de loops.

import { describe, it, beforeAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";

const tmpData = path.join(os.tmpdir(), `whisper-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-wh@local.test";
process.env.ADMIN_PASSWORD = "whpass1234";
process.env.ADMIN_NAME = "AdminWH";
process.env.JWT_SECRET = "test-secret-wh";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}
fs.writeFileSync(path.join(tmpData, "auth.json"), JSON.stringify({
  users: [{ id: "u_admin_wh", email: "admin-wh@local.test", name: "AdminWH", role: "admin", status: "active", setterId: "", password: pwd("whpass1234"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
  invites: [], sessions: [],
}, null, 2));
fs.writeFileSync(path.join(tmpData, "setters.json"), JSON.stringify({ setters: [], variants: [], leads: {}, calendar: [], sessions: [] }, null, 2));
fs.writeFileSync(path.join(tmpData, "history.json"), JSON.stringify({ entries: {}, lastPages: {} }, null, 2));

await import("../index.js");
const clean = globalThis.__whisper.cleanSegments;

// Helper: segmento "bueno" por default; pisá lo que necesites.
const seg = (over = {}) => ({ start: 0, end: 2, text: "hola", no_speech_prob: 0.05, avg_logprob: -0.2, compression_ratio: 1.5, ...over });

describe("_cleanWhisperSegments · anti-alucinación", () => {
  it("loop de la misma frase sobre silencio -> vacío (el bug real)", () => {
    const raw = Array.from({ length: 12 }, (_, i) => seg({
      start: i * 2, end: i * 2 + 2, text: "Reactivación de pacientes.",
      no_speech_prob: 0.85, avg_logprob: -0.9,
    }));
    expect(clean(raw, "lead")).toEqual([]);
  });

  it("descarta segmentos de silencio (no_speech alto + logprob muy bajo)", () => {
    const raw = [
      seg({ text: "Buenas, ¿cómo le va?", no_speech_prob: 0.1, avg_logprob: -0.2 }),
      seg({ text: "ruido inventado", no_speech_prob: 0.7, avg_logprob: -0.6 }),
    ];
    const out = clean(raw, "setter");
    expect(out.map((s) => s.text)).toEqual(["Buenas, ¿cómo le va?"]);
  });

  it("descarta segmentos repetitivos (compression_ratio alto)", () => {
    const raw = [
      seg({ text: "Sí, dale.", compression_ratio: 1.4 }),
      seg({ text: "gracias gracias gracias gracias", compression_ratio: 3.1 }),
    ];
    expect(clean(raw, "lead").map((s) => s.text)).toEqual(["Sí, dale."]);
  });

  it("colapsa repeticiones consecutivas extendiendo el rango", () => {
    const raw = [
      seg({ start: 0, end: 2, text: "Aló" }),
      seg({ start: 2, end: 4, text: "Aló" }),
      seg({ start: 4, end: 6, text: "¿Quién habla?" }),
    ];
    const out = clean(raw, "lead");
    expect(out.map((s) => s.text)).toEqual(["Aló", "¿Quién habla?"]);
    expect(out[0].end).toBe(4); // el primer "Aló" absorbió al segundo
  });

  it("conversación real variada pasa intacta", () => {
    const raw = [
      seg({ start: 0, end: 3, text: "Hola, le hablo de SCM." }),
      seg({ start: 3, end: 6, text: "Ah, sí, dígame." }),
      seg({ start: 6, end: 9, text: "Trabajamos reactivando pacientes." }),
    ];
    const out = clean(raw, "setter");
    expect(out.length).toBe(3);
    expect(out.every((s) => s.speaker === "setter")).toBe(true);
    expect(out[0]).not.toHaveProperty("_nsp"); // metadata interna no se filtra al output
  });

  it("dos frases distintas repetidas NO se descartan (uniq>1)", () => {
    const raw = [
      seg({ text: "Sí" }), seg({ text: "No" }), seg({ text: "Sí" }), seg({ text: "No" }),
    ];
    // alternan, ninguna consecutiva igual -> 4 quedan; uniq=2 -> no es alucinación
    expect(clean(raw, "lead").length).toBe(4);
  });

  it("entrada vacía o nula -> vacío", () => {
    expect(clean([], "lead")).toEqual([]);
    expect(clean(null, "setter")).toEqual([]);
    expect(clean(undefined, "lead")).toEqual([]);
  });

  // Audit 2026-07-06: el colapso a una sola frase ya NO vacía siempre el canal.
  it("'¿Aló?' x3 con métricas de voz real se CONSERVA (colapsado)", () => {
    const raw = [
      seg({ start: 0, end: 1, text: "¿Aló?", no_speech_prob: 0.1, avg_logprob: -0.2 }),
      seg({ start: 1, end: 2, text: "¿Aló?", no_speech_prob: 0.12, avg_logprob: -0.25 }),
      seg({ start: 2, end: 3, text: "¿Aló?", no_speech_prob: 0.08, avg_logprob: -0.18 }),
    ];
    const out = clean(raw, "lead");
    expect(out.length).toBe(1); // colapsado a un segmento
    expect(out[0].text).toBe("¿Aló?");
    expect(out[0].end).toBe(3);
  });

  it("frase repetida con métricas de silencio (avg) -> vacío aunque pase el filtro por-segmento", () => {
    // nsp 0.4 no llega al corte por-segmento (0.6) pero el promedio delata silencio
    const raw = Array.from({ length: 4 }, (_, i) => seg({
      start: i, end: i + 1, text: "Gracias por llamar.",
      no_speech_prob: 0.4, avg_logprob: -0.3,
    }));
    expect(clean(raw, "lead")).toEqual([]);
  });

  it("eco del prompt de Whisper repetido -> vacío aunque tenga buenas métricas", () => {
    const prompt = "Llamada telefónica en español de un vendedor a una clínica dental. Términos frecuentes: reactivación de pacientes, agenda, turnos, reseñas de Google, SCM.";
    const raw = Array.from({ length: 3 }, (_, i) => seg({
      start: i, end: i + 1, text: "reactivación de pacientes",
      no_speech_prob: 0.1, avg_logprob: -0.2,
    }));
    expect(clean(raw, "lead", prompt)).toEqual([]);
    // La misma frase SIN prompt (y con buenas métricas) se conserva
    expect(clean(raw, "lead").length).toBe(1);
  });
});

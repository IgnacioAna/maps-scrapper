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

  // Bug 2026-07-13 (caso real de la biblioteca): Whisper devolvió el prompt
  // PARTIDO en 2 segmentos DISTINTOS con buenas métricas — el gate de loop
  // (uniq.size <= 1) no los atrapaba y aparecían como turnos del CLIENTE.
  it("eco del prompt partido en segmentos distintos -> filtrado por segmento", () => {
    const prompt = "Llamada telefónica en español de un vendedor a una clínica dental. Términos frecuentes: reactivación de pacientes, agenda, turnos, reseñas de Google.";
    const raw = [
      seg({ start: 0, end: 4, text: "Llamada telefónica en español de un vendedor a una clínica dental.", no_speech_prob: 0.3, avg_logprob: -0.3, compression_ratio: 1.2 }),
      seg({ start: 5, end: 8, text: "Términos frecuentes.", no_speech_prob: 0.3, avg_logprob: -0.3, compression_ratio: 1.1 }),
    ];
    expect(clean(raw, "lead", prompt)).toEqual([]);
  });

  it("eco parcial del prompt mezclado con habla real -> solo se va el eco", () => {
    const prompt = "Llamada telefónica en español de un vendedor a una clínica dental. Términos frecuentes: reactivación de pacientes, agenda, turnos, reseñas de Google.";
    const raw = [
      seg({ start: 0, end: 2, text: "Términos frecuentes.", no_speech_prob: 0.2, avg_logprob: -0.3, compression_ratio: 1.0 }),
      seg({ start: 3, end: 6, text: "Sí, dígame, ¿de parte de quién?", no_speech_prob: 0.1, avg_logprob: -0.2, compression_ratio: 1.2 }),
    ];
    const out = clean(raw, "lead", prompt);
    expect(out.map((s) => s.text)).toEqual(["Sí, dígame, ¿de parte de quién?"]);
  });

  it("término del rubro dicho por el cliente NO se filtra (está después de 'Términos frecuentes:')", () => {
    const prompt = "Llamada telefónica en español de un vendedor a una clínica dental. Términos frecuentes: reactivación de pacientes, agenda, turnos, reseñas de Google.";
    const raw = [
      seg({ start: 0, end: 3, text: "Nos interesa la reactivación de pacientes, contame más.", no_speech_prob: 0.1, avg_logprob: -0.2, compression_ratio: 1.4 }),
    ];
    expect(clean(raw, "lead", prompt).length).toBe(1);
  });

  // Bug 2026-07-21 (caso real de la biblioteca): Whisper alucinó una VARIANTE del
  // prompt con texto extra ("...a una clínica dental EN COLOMBIA") sobre el canal
  // mudo del cliente — no es substring del prompt, el filtro viejo la dejaba pasar
  // y aparecía como turno del CLIENTE en la conversación.
  it("variante del prompt con cola extra -> filtrada (contiene el núcleo instruccional)", () => {
    const prompt = "Llamada telefónica en español de un vendedor a una clínica dental. Términos frecuentes: reactivación de pacientes, agenda, turnos, reseñas de Google.";
    const raw = [
      seg({ start: 0, end: 35, text: "Llamada telefónica en español de un vendedor a una clínica dental en Colombia", no_speech_prob: 0.3, avg_logprob: -0.35, compression_ratio: 1.3 }),
      seg({ start: 36, end: 40, text: "Sí, dígame.", no_speech_prob: 0.1, avg_logprob: -0.2, compression_ratio: 1.1 }),
    ];
    expect(clean(raw, "lead", prompt).map((s) => s.text)).toEqual(["Sí, dígame."]);
  });

  it("habla real que menciona 'clínica dental' suelta NO se filtra (no contiene la oración completa)", () => {
    const prompt = "Llamada telefónica en español de un vendedor a una clínica dental. Términos frecuentes: reactivación de pacientes, agenda, turnos, reseñas de Google.";
    const raw = [
      seg({ start: 0, end: 4, text: "Le llamo porque trabajamos con clínicas dentales de la zona.", no_speech_prob: 0.1, avg_logprob: -0.2, compression_ratio: 1.3 }),
    ];
    expect(clean(raw, "setter", prompt).length).toBe(1);
  });

  // Modo lax (2026-07-24): rescate cuando el medidor del browser confirmó voz
  // real pero la limpieza estricta vació el canal (caso real: audio telefónico
  // de línea pobre puntúa como "silencio" para Whisper y el filtro de métricas
  // se comía la conversación entera).
  it("lax conserva segmentos con métricas pobres que el modo estricto descarta", () => {
    const raw = [
      seg({ start: 0, end: 3, text: "¿Sí, dígame? ¿De parte de quién?", no_speech_prob: 0.7, avg_logprob: -0.6, compression_ratio: 1.3 }),
      seg({ start: 4, end: 8, text: "El doctor no se encuentra ahora.", no_speech_prob: 0.65, avg_logprob: -0.5, compression_ratio: 1.2 }),
    ];
    expect(clean(raw, "lead")).toEqual([]); // estricto: todo puntúa como silencio
    const out = clean(raw, "lead", "", { lax: true });
    expect(out.map((s) => s.text)).toEqual(["¿Sí, dígame? ¿De parte de quién?", "El doctor no se encuentra ahora."]);
  });

  it("lax IGUAL filtra el eco del prompt y colapsa loops", () => {
    const prompt = "Llamada telefónica en español de un vendedor a una clínica dental. Términos frecuentes: reactivación de pacientes, agenda, turnos, reseñas de Google.";
    const raw = [
      seg({ start: 0, end: 3, text: "Llamada telefónica en español de un vendedor a una clínica dental.", no_speech_prob: 0.3, avg_logprob: -0.3 }),
      seg({ start: 4, end: 6, text: "Vale, un momento.", no_speech_prob: 0.7, avg_logprob: -0.6 }),
      seg({ start: 6, end: 8, text: "Vale, un momento.", no_speech_prob: 0.7, avg_logprob: -0.6 }),
    ];
    const out = clean(raw, "lead", prompt, { lax: true });
    expect(out.map((s) => s.text)).toEqual(["Vale, un momento."]); // eco afuera, loop colapsado
    expect(out[0].end).toBe(8);
  });

  it("lax con canal que colapsa a eco del prompt repetido -> vacío igual", () => {
    const prompt = "Llamada telefónica en español de un vendedor a una clínica dental. Términos frecuentes: reactivación de pacientes, agenda, turnos, reseñas de Google.";
    const raw = Array.from({ length: 4 }, (_, i) => seg({
      start: i, end: i + 1, text: "reactivación de pacientes",
      no_speech_prob: 0.2, avg_logprob: -0.3,
    }));
    expect(clean(raw, "lead", prompt, { lax: true })).toEqual([]);
  });
});

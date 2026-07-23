// extractSpanishMobileFromHtml — rescate de móviles ES desde la web (2026-07-23).
// Solo señales fuertes (wa.me / tel: / +34 explícito); nunca un 9-dígitos suelto.

import { describe, it, expect } from "vitest";
import { extractSpanishMobileFromHtml, enrichFromWebsite } from "../src/enrichment.js";

describe("extractSpanishMobileFromHtml", () => {
  it("rescata desde link wa.me (con y sin prefijo 34)", () => {
    expect(extractSpanishMobileFromHtml('<a href="https://wa.me/34612345678">WhatsApp</a>')).toBe("+34612345678");
    expect(extractSpanishMobileFromHtml('<a href="https://api.whatsapp.com/send?phone=34712345678&text=hola">wa</a>')).toBe("+34712345678");
  });

  it("rescata desde link tel: con formato", () => {
    expect(extractSpanishMobileFromHtml('<a href="tel:+34 612 34 56 78">Llamar</a>')).toBe("+34612345678");
    expect(extractSpanishMobileFromHtml('<a href="tel:612-34-56-78">Llamar</a>')).toBe("+34612345678");
  });

  it("rescata desde texto con prefijo +34/0034 explícito", () => {
    expect(extractSpanishMobileFromHtml("<p>Urgencias: +34 655 11 22 33</p>")).toBe("+34655112233");
    expect(extractSpanishMobileFromHtml("<p>0034 733 44 55 66</p>")).toBe("+34733445566");
  });

  it("NO rescata fijos (+349) ni números sueltos sin señal fuerte", () => {
    expect(extractSpanishMobileFromHtml('<a href="tel:+34912345678">Fijo</a>')).toBeNull();
    expect(extractSpanishMobileFromHtml('<a href="https://wa.me/34912345678">wa fijo</a>')).toBeNull();
    // 9 dígitos que empieza en 6 SIN prefijo ni tel:/wa.me → puede ser un id/precio
    expect(extractSpanishMobileFromHtml("<p>ref 612345678</p>")).toBeNull();
    expect(extractSpanishMobileFromHtml("")).toBeNull();
    expect(extractSpanishMobileFromHtml(null)).toBeNull();
  });

  it("prioriza wa.me sobre tel: (es el contacto real de la clínica)", () => {
    const html = '<a href="tel:+34655000111">tel</a> <a href="https://wa.me/34622333444">wa</a>';
    expect(extractSpanishMobileFromHtml(html)).toBe("+34622333444");
  });
});

describe("enrichFromWebsite incluye esMobile", () => {
  it("devuelve esMobile del HTML fetcheado", async () => {
    const fetchImpl = async () => ({
      ok: true, status: 200,
      text: async () => '<html><body>Cita: <a href="https://wa.me/34611222333">WhatsApp</a> info@clinica.es</body></html>',
      headers: { get: () => "text/html" },
    });
    const r = await enrichFromWebsite("https://clinica-demo-es.example", { fetchImpl });
    expect(r.esMobile).toBe("+34611222333");
  });
});

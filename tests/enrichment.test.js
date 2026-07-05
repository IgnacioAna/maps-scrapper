// Tests del módulo de enriquecimiento de leads (src/enrichment.js).
// Las funciones puras (extractEmailFromHtml, parseNpiResults) se testean con
// HTML/JSON de ejemplo. Las funciones con red (enrichFromWebsite, enrichFromNPI)
// se testean inyectando un fetchImpl MOCKEADO — NUNCA se pega a la red real.

import { describe, it, expect } from "vitest";
import {
  extractEmailFromHtml,
  extractSocialFromHtml,
  classifyEmailType,
  enrichFromWebsite,
  parseNpiResults,
  enrichFromNPI,
  isBlockedHost,
} from "../src/enrichment.js";

// Helper: fabrica un fetchImpl falso que devuelve un body con status dado.
function mockFetch({ body = "", status = 200, ok = true, throwErr = null } = {}) {
  return async () => {
    if (throwErr) throw throwErr;
    return {
      ok,
      status,
      text: async () => body,
    };
  };
}

describe("extractSocialFromHtml (PURA)", () => {
  it("extrae el handle de Instagram", () => {
    const html = `<a href="https://www.instagram.com/clinicasonrisa/">IG</a>`;
    expect(extractSocialFromHtml(html).instagram).toBe("https://instagram.com/clinicasonrisa");
  });
  it("extrae el handle de Facebook", () => {
    const html = `<a href="https://facebook.com/ClinicaSonrisaOK">FB</a>`;
    expect(extractSocialFromHtml(html).facebook).toBe("https://facebook.com/ClinicaSonrisaOK");
  });
  it("ignora paths que no son perfiles (sharer, /p/, plugins)", () => {
    const html = `
      <a href="https://www.facebook.com/sharer/sharer.php?u=x">share</a>
      <a href="https://www.instagram.com/p/ABC123/">post</a>
      <a href="https://www.facebook.com/plugins/like.php">like</a>`;
    const out = extractSocialFromHtml(html);
    expect(out.instagram).toBe("");
    expect(out.facebook).toBe("");
  });
  it("sin redes → strings vacíos, no rompe", () => {
    expect(extractSocialFromHtml("<p>hola</p>")).toEqual({ instagram: "", facebook: "" });
    expect(extractSocialFromHtml(null)).toEqual({ instagram: "", facebook: "" });
  });
});

describe("extractEmailFromHtml (PURA)", () => {
  it("extrae email de un mailto:", () => {
    const html = `<a href="mailto:info@clinicasonrisa.com">Escribinos</a>`;
    expect(extractEmailFromHtml(html)).toBe("info@clinicasonrisa.com");
  });

  it("extrae email suelto en texto plano", () => {
    const html = `<p>Contactanos a contacto@dentalplus.mx para turnos.</p>`;
    expect(extractEmailFromHtml(html)).toBe("contacto@dentalplus.mx");
  });

  it("devuelve null cuando no hay email", () => {
    const html = `<html><body><h1>Bienvenidos</h1><p>Sin contacto.</p></body></html>`;
    expect(extractEmailFromHtml(html)).toBeNull();
  });

  it("devuelve null con HTML basura / vacío / no-string", () => {
    expect(extractEmailFromHtml("")).toBeNull();
    expect(extractEmailFromHtml(null)).toBeNull();
    expect(extractEmailFromHtml(12345)).toBeNull();
    expect(extractEmailFromHtml("<<<>>> &&& ???")).toBeNull();
  });

  it("filtra falsos positivos (.png, example.com, sentry/wix)", () => {
    const html = `
      <img src="logo@2x.png">
      <span>user@example.com</span>
      <script>Sentry.init({dsn:'https://abc@o123.ingest.sentry.io/1'})</script>
      <meta content="something@sentry-next.wixpress.com">
    `;
    expect(extractEmailFromHtml(html)).toBeNull();
  });

  it("prefiere mailto: por sobre un email suelto", () => {
    const html = `
      <p>Spam scraping: random@gmail.com</p>
      <a href="mailto:citas@odonto.com">Agenda</a>
    `;
    expect(extractEmailFromHtml(html)).toBe("citas@odonto.com");
  });

  it("prefiere email del mismo dominio que el sitio", () => {
    const html = `
      <p>soporte@proveedor-externo.com</p>
      <p>recepcion@miclinica.com</p>
    `;
    expect(extractEmailFromHtml(html, "https://www.miclinica.com")).toBe(
      "recepcion@miclinica.com"
    );
  });

  it("decodifica entidades HTML del email", () => {
    const html = `<p>info&#64;dentalcare&#46;com</p>`;
    expect(extractEmailFromHtml(html)).toBe("info@dentalcare.com");
  });
});

describe("classifyEmailType (PURA)", () => {
  it("prefijos genéricos → 'generic'", () => {
    for (const e of ["info@clinica.com", "contacto@x.com", "citas@odonto.mx", "recepcion@y.com", "webmaster@z.com", "turnos@a.com"]) {
      expect(classifyEmailType(e)).toBe("generic");
    }
  });
  it("nombre.apellido / inicial+apellido / nombre → 'personal'", () => {
    expect(classifyEmailType("maria.perez@clinica.com")).toBe("personal");
    expect(classifyEmailType("jperez@clinica.com")).toBe("personal");
    expect(classifyEmailType("j.perez@clinica.com")).toBe("personal");
    expect(classifyEmailType("maria@clinica.com")).toBe("personal");
    expect(classifyEmailType("maria.perez2@clinica.com")).toBe("personal"); // dígitos finales
  });
  it("basura / no-string → 'unknown'", () => {
    expect(classifyEmailType("")).toBe("unknown");
    expect(classifyEmailType(null)).toBe("unknown");
    expect(classifyEmailType("sinarroba")).toBe("unknown");
  });
});

describe("scoreEmail INVERTIDO: personal gana al genérico", () => {
  it("elige el email personal por sobre info@ del mismo dominio", () => {
    const html = `
      <a href="mailto:info@clinica.com">info</a>
      <a href="mailto:maria.perez@clinica.com">Dra. Pérez</a>
    `;
    expect(extractEmailFromHtml(html, "https://clinica.com")).toBe("maria.perez@clinica.com");
  });
  it("si solo hay genérico, lo devuelve igual (mejor que nada)", () => {
    const html = `<a href="mailto:info@clinica.com">info</a>`;
    expect(extractEmailFromHtml(html, "https://clinica.com")).toBe("info@clinica.com");
  });
  it("enrichFromWebsite devuelve emailType del email ganador", async () => {
    const r = await enrichFromWebsite("clinica.com", {
      fetchImpl: mockFetch({ body: `<a href="mailto:dr.gomez@clinica.com">mail</a>` }),
    });
    expect(r.email).toBe("dr.gomez@clinica.com");
    expect(r.emailType).toBe("personal");
  });
});

describe("enrichFromWebsite (fetch MOCKEADO)", () => {
  it("encuentra email en el HTML servido", async () => {
    const f = mockFetch({
      body: `<a href="mailto:hola@clinica.com">mail</a>`,
    });
    const r = await enrichFromWebsite("clinica.com", { fetchImpl: f });
    expect(r.email).toBe("hola@clinica.com");
    expect(r.error).toBeNull();
  });

  it("normaliza website sin esquema (agrega https)", async () => {
    let calledUrl = "";
    const f = async (url) => {
      calledUrl = url;
      return { ok: true, status: 200, text: async () => "contacto@x.com" };
    };
    const r = await enrichFromWebsite("midominio.com", { fetchImpl: f });
    expect(calledUrl.startsWith("https://")).toBe(true);
    expect(r.email).toBe("contacto@x.com");
  });

  it("degrada a no_website cuando falta el website", async () => {
    expect(await enrichFromWebsite("", { fetchImpl: mockFetch() })).toEqual({
      email: null,
      ads: null,
      social: {},
      age: {},
      emailType: "unknown",
      error: "no_website",
    });
    expect(await enrichFromWebsite(null, { fetchImpl: mockFetch() })).toEqual({
      email: null,
      ads: null,
      social: {},
      age: {},
      emailType: "unknown",
      error: "no_website",
    });
  });

  it("rechaza websites-basura (wa.me, instagram, etc.)", async () => {
    const r = await enrichFromWebsite("https://wa.me/5215551234", {
      fetchImpl: mockFetch({ body: "x@x.com" }),
    });
    expect(r.email).toBeNull();
    expect(r.error).toBe("junk_website");
  });

  it("bloquea hosts internos (anti-SSRF) sin hacer fetch", async () => {
    let fetched = false;
    const spy = async () => { fetched = true; return { ok: true, status: 200, text: async () => "info@x.com" }; };
    const r = await enrichFromWebsite("http://169.254.169.254/latest/meta-data/", { fetchImpl: spy });
    expect(r.error).toBe("blocked_host");
    expect(fetched).toBe(false); // nunca pegó al host interno
  });

  it("bloquea redirect hacia host interno (anti-SSRF por redirect, WR-07)", async () => {
    // El host inicial es público, pero responde 302 → metadata cloud interno.
    // Con redirect:"follow" el fetch lo seguía; ahora se revalida cada hop.
    let hops = 0;
    const spy = async (u) => {
      hops++;
      if (hops === 1) {
        return {
          ok: false,
          status: 302,
          headers: { get: (h) => (h.toLowerCase() === "location" ? "http://169.254.169.254/latest/meta-data/" : null) },
          text: async () => "",
        };
      }
      // No debería llegar acá — el hop interno tiene que cortarse antes del fetch.
      return { ok: true, status: 200, text: async () => "secreto@interno.com" };
    };
    const r = await enrichFromWebsite("http://clinica-publica.com", { fetchImpl: spy });
    expect(r.error).toBe("blocked_redirect");
    expect(hops).toBe(1); // solo el fetch inicial; el redirect interno nunca se ejecutó
  });

  it("sigue un redirect a host público válido", async () => {
    let hops = 0;
    const spy = async (u) => {
      hops++;
      if (hops === 1) {
        return {
          ok: false,
          status: 301,
          headers: { get: (h) => (h.toLowerCase() === "location" ? "https://www.clinica.com/home" : null) },
          text: async () => "",
        };
      }
      return { ok: true, status: 200, text: async () => `<a href="mailto:dr@clinica.com">x</a>` };
    };
    const r = await enrichFromWebsite("http://clinica.com", { fetchImpl: spy });
    expect(r.email).toBe("dr@clinica.com");
    expect(hops).toBe(2);
  });

  it("degrada cuando el sitio no tiene email", async () => {
    const r = await enrichFromWebsite("clinica.com", {
      fetchImpl: mockFetch({ body: "<h1>Hola</h1>" }),
    });
    expect(r.email).toBeNull();
    expect(r.error).toBe("no_email_found");
  });

  it("degrada con error HTTP (404)", async () => {
    const r = await enrichFromWebsite("clinica.com", {
      fetchImpl: mockFetch({ ok: false, status: 404, body: "" }),
    });
    expect(r.email).toBeNull();
    expect(r.error).toBe("http_404");
  });

  it("nunca lanza si fetch tira excepción", async () => {
    const r = await enrichFromWebsite("clinica.com", {
      fetchImpl: mockFetch({ throwErr: new Error("ECONNRESET") }),
    });
    expect(r.email).toBeNull();
    expect(typeof r.error).toBe("string");
  });

  it("respeta el timeout (fetch que nunca resuelve)", async () => {
    const f = () => new Promise(() => {}); // nunca resuelve
    const r = await enrichFromWebsite("clinica.com", {
      fetchImpl: f,
      timeoutMs: 30,
    });
    expect(r.email).toBeNull();
    expect(r.error).toBe("timeout");
  });
});

describe("isBlockedHost (anti-SSRF)", () => {
  it("bloquea internos / loopback / metadata / privadas", () => {
    for (const h of ["localhost", "127.0.0.1", "10.0.0.5", "192.168.1.1", "172.16.0.1", "172.31.255.255", "169.254.169.254", "::1", "fe80::1", "metadata.internal", "foo.local", "0.0.0.0", "100.64.0.1"]) {
      expect(isBlockedHost(h)).toBe(true);
    }
  });
  it("permite hosts públicos (incluido 172.x fuera de 16-31 — fix del bug viejo)", () => {
    for (const h of ["arteoral.com", "www.google.com", "8.8.8.8", "172.15.0.1", "172.32.0.1", "example.com.ar"]) {
      expect(isBlockedHost(h)).toBe(false);
    }
  });
});

describe("parseNpiResults (PURA)", () => {
  const orgJson = {
    result_count: 1,
    results: [
      {
        number: 1234567890,
        basic: { organization_name: "Bright Smile Dental PC" },
        taxonomies: [
          { desc: "Dentist", primary: true },
          { desc: "General Practice", primary: false },
        ],
        addresses: [
          { address_purpose: "LOCATION", city: "Austin", state: "TX" },
          { address_purpose: "MAILING", city: "Dallas", state: "TX" },
        ],
      },
    ],
  };

  const personJson = {
    result_count: 1,
    results: [
      {
        number: 9876543210,
        basic: { first_name: "Jane", last_name: "Doe", credential: "DDS" },
        taxonomies: [{ desc: "Orthodontics", primary: true }],
        addresses: [{ address_purpose: "LOCATION", city: "Miami", state: "FL" }],
      },
    ],
  };

  it("organización: usa organization_name + taxonomy primary + LOCATION", () => {
    const r = parseNpiResults(orgJson, { name: "Bright Smile Dental" });
    expect(r).toEqual({
      npi: "1234567890",
      ownerName: "Bright Smile Dental PC",
      specialty: "Dentist",
      city: "Austin",
      state: "TX",
    });
  });

  it("persona: arma First Last, credential, especialidad", () => {
    const r = parseNpiResults(personJson, { name: "Jane Doe" });
    expect(r.npi).toBe("9876543210");
    expect(r.ownerName).toBe("Jane Doe, DDS");
    expect(r.specialty).toBe("Orthodontics");
    expect(r.city).toBe("Miami");
    expect(r.state).toBe("FL");
  });

  it("sin results devuelve null", () => {
    expect(parseNpiResults({ result_count: 0, results: [] })).toBeNull();
  });

  it("JSON inválido / vacío devuelve null sin lanzar", () => {
    expect(parseNpiResults(null)).toBeNull();
    expect(parseNpiResults({})).toBeNull();
    expect(parseNpiResults({ results: "nope" })).toBeNull();
  });

  it("elige el mejor match por tokens del nombre buscado", () => {
    const json = {
      results: [
        {
          number: 111,
          basic: { organization_name: "Random Clinic LLC" },
          taxonomies: [{ desc: "Dentist", primary: true }],
          addresses: [{ city: "Reno", state: "NV" }],
        },
        {
          number: 222,
          basic: { organization_name: "Sunrise Dental Group" },
          taxonomies: [{ desc: "Dentist", primary: true }],
          addresses: [{ city: "Reno", state: "NV" }],
        },
      ],
    };
    const r = parseNpiResults(json, { name: "Sunrise Dental" });
    expect(r.npi).toBe("222");
  });

  it("toma la primera taxonomy con desc si no hay primary", () => {
    const json = {
      results: [
        {
          number: 333,
          basic: { organization_name: "No Primary Tax Clinic" },
          taxonomies: [{ desc: "Pediatric Dentistry", primary: false }],
          addresses: [{ city: "Tampa", state: "FL" }],
        },
      ],
    };
    const r = parseNpiResults(json);
    expect(r.specialty).toBe("Pediatric Dentistry");
  });
});

describe("enrichFromNPI (fetch MOCKEADO)", () => {
  it("devuelve el mejor match desde el JSON servido", async () => {
    const body = JSON.stringify({
      results: [
        {
          number: 5550001111,
          basic: { organization_name: "Pearl Dental Care" },
          taxonomies: [{ desc: "Dentist", primary: true }],
          addresses: [{ address_purpose: "LOCATION", city: "Phoenix", state: "AZ" }],
        },
      ],
    });
    const r = await enrichFromNPI(
      { name: "Pearl Dental Care", city: "Phoenix", state: "AZ" },
      { fetchImpl: mockFetch({ body }) }
    );
    expect(r.npi).toBe("5550001111");
    expect(r.ownerName).toBe("Pearl Dental Care");
    expect(r.specialty).toBe("Dentist");
    expect(r.city).toBe("Phoenix");
  });

  it("null cuando no hay name", async () => {
    expect(await enrichFromNPI({ city: "X" }, { fetchImpl: mockFetch() })).toBeNull();
  });

  it("null cuando la API no devuelve results", async () => {
    const r = await enrichFromNPI(
      { name: "Inexistente Clinic" },
      { fetchImpl: mockFetch({ body: JSON.stringify({ result_count: 0, results: [] }) }) }
    );
    expect(r).toBeNull();
  });

  it("error de red degrada a { error } (no lanza)", async () => {
    const r = await enrichFromNPI(
      { name: "Some Clinic" },
      { fetchImpl: mockFetch({ throwErr: new Error("DNS fail") }) }
    );
    expect(r).toMatchObject({ error: expect.any(String) });
  });

  it("JSON inválido degrada a { error: bad_json }", async () => {
    const r = await enrichFromNPI(
      { name: "Some Clinic" },
      { fetchImpl: mockFetch({ body: "not json {{{" }) }
    );
    expect(r).toEqual({ error: "bad_json" });
  });

  it("respeta el timeout", async () => {
    const r = await enrichFromNPI(
      { name: "Some Clinic" },
      { fetchImpl: () => new Promise(() => {}), timeoutMs: 30 }
    );
    expect(r).toEqual({ error: "timeout" });
  });

  it("construye la URL del NPI con los params correctos", async () => {
    let calledUrl = "";
    const f = async (url) => {
      calledUrl = url;
      return { ok: true, status: 200, text: async () => JSON.stringify({ results: [] }) };
    };
    await enrichFromNPI({ name: "ABC Dental", city: "Reno", state: "nv" }, { fetchImpl: f });
    expect(calledUrl).toContain("npiregistry.cms.hhs.gov/api/");
    expect(calledUrl).toContain("version=2.1");
    expect(calledUrl).toContain("organization_name=ABC+Dental");
    expect(calledUrl).toContain("city=Reno");
    expect(calledUrl).toContain("state=NV"); // upper-cased
  });
});

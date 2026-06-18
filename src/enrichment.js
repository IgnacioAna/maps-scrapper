// Lead Enrichment — datos extra para cold calls de clínicas dentales/estéticas.
//
// Módulo SELF-CONTAINED (ESM, Node 20, sin dependencias nuevas). Dos fuentes
// gratis y confiables:
//   1. Email desde el sitio web del lead (global, cualquier país): fetch del HTML
//      + extracción del email más probable.
//   2. NPI Registry (USA): API pública gratis de CMS para owner + especialidad.
//
// ─────────────────────────────────────────────────────────────────────────────
// CONTRATO PARA INTEGRACIÓN (index.js — endpoint admin batch con caps)
// ─────────────────────────────────────────────────────────────────────────────
// Firmas estables. Ninguna lanza excepción hacia afuera: siempre degradan a
// null o a un objeto con { error }. Las versiones con red aceptan un fetchImpl
// inyectable (default = fetch global) para testear sin tocar la red.
//
//   extractEmailFromHtml(html, siteUrl?) -> string | null            (PURA)
//   enrichFromWebsite(website, { fetchImpl?, timeoutMs? })
//        -> Promise<{ email: string|null, error: string|null }>
//   parseNpiResults(json, { name? }) -> { npi, ownerName, specialty,
//        city, state } | null                                        (PURA)
//   enrichFromNPI({ name, city, state }, { fetchImpl?, timeoutMs? })
//        -> Promise<{ npi, ownerName, specialty, city, state,
//                     error? } | null>
//
// Uso esperado desde el endpoint: iterar leads con cap (ej. 25/llamada),
// llamar enrichFromWebsite(lead.website) y/o enrichFromNPI({name,city,state})
// para leads de USA, y mergear el resultado al lead. Las funciones son seguras
// para Promise.all con timeout individual.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 1_500_000; // no parsear páginas gigantes

// Dominios / tokens que casi nunca son el email real del negocio.
const EMAIL_BLOCKLIST_DOMAINS = new Set([
  "example.com",
  "example.org",
  "example.net",
  "domain.com",
  "email.com",
  "yourdomain.com",
  "sentry.io",
  "wix.com",
  "wixpress.com",
  "sentry-next.wixpress.com",
  "godaddy.com",
  "squarespace.com",
  "schema.org",
  "w3.org",
  "googlemail.com", // raro como contacto público real (mapeamos a gmail abajo)
  "company.com",
  "test.com",
  "mail.com",
]);

// Extensiones de archivo: si un "email" termina así, es un asset (img@2x.png, etc.)
const FILE_EXT_RE = /\.(png|jpe?g|gif|svg|webp|css|js|ico|woff2?|ttf|eot|pdf|mp4|webm|avif)$/i;

// Local-parts típicos de placeholders / tracking que no son contacto real.
const EMAIL_BLOCKLIST_LOCAL = new Set([
  "you",
  "your",
  "username",
  "user",
  "name",
  "email",
  "someone",
  "no-reply",
  "noreply",
  "example",
  "sentry",
]);

// Regex de email "suelto" en texto plano. Deliberadamente conservador.
const EMAIL_TEXT_RE =
  /[a-z0-9](?:[a-z0-9._%+-]{0,62}[a-z0-9])?@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/gi;

/**
 * Normaliza un candidato a email (lowercase + trim de basura común).
 * Devuelve null si no parece un email válido / es un falso positivo.
 */
function normalizeEmailCandidate(raw) {
  if (!raw || typeof raw !== "string") return null;
  let e = raw.trim().toLowerCase();
  // Limpiar prefijos de mailto: y query params (?subject=...)
  e = e.replace(/^mailto:/i, "");
  e = e.split("?")[0];
  // Quitar puntuación / paréntesis residual de pegado en texto
  e = e.replace(/^[<("']+/, "").replace(/[>)"'.,;:]+$/, "");
  // Decodificar entidades HTML básicas que rompen el email
  e = e
    .replace(/&#0?64;/g, "@")
    .replace(/&#0?46;/g, ".")
    .replace(/&commat;/gi, "@")
    .replace(/&period;/gi, ".")
    .replace(/&amp;/gi, "&");
  if (!e || e.length > 254) return null;
  if (FILE_EXT_RE.test(e)) return null;

  const at = e.lastIndexOf("@");
  if (at <= 0 || at === e.length - 1) return null;
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);

  // Validación estructural mínima de cada lado.
  if (!/^[a-z0-9._%+-]+$/.test(local)) return null;
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return null;
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return null;
  if (domain.includes("..")) return null;

  if (EMAIL_BLOCKLIST_LOCAL.has(local)) return null;
  if (EMAIL_BLOCKLIST_DOMAINS.has(domain)) return null;
  // Cualquier subdominio de un dominio bloqueado (ej. foo.sentry.io)
  for (const bad of EMAIL_BLOCKLIST_DOMAINS) {
    if (domain.endsWith("." + bad)) return null;
  }
  return e;
}

/**
 * Extrae el host (sin www) de una URL. Devuelve "" si no parsea.
 */
function hostFromUrl(url) {
  if (!url || typeof url !== "string") return "";
  try {
    const u = new URL(url.includes("://") ? url : "https://" + url);
    return u.hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Puntúa un candidato a email. Mayor = más probable que sea el contacto real.
 * @param {object} c { email, fromMailto:boolean }
 * @param {string} siteHost host del sitio (sin www) para preferir mismo dominio
 */
function scoreEmail(c, siteHost) {
  let s = 0;
  if (c.fromMailto) s += 100; // mailto: es señal fortísima de contacto real
  const domain = c.email.slice(c.email.lastIndexOf("@") + 1);
  if (siteHost) {
    if (domain === siteHost) s += 60;
    else if (domain.endsWith("." + siteHost) || siteHost.endsWith("." + domain)) s += 40;
  }
  // Local-parts típicos de contacto de negocio.
  const local = c.email.slice(0, c.email.lastIndexOf("@"));
  if (/^(info|contacto|contact|hello|hola|admin|citas|turnos|recepcion|reservas|appointments|clinic|clinica|consultas)$/.test(local)) {
    s += 15;
  }
  // Dominios de email genéricos (gmail, etc.) son válidos pero menos "oficiales".
  if (/^(gmail|hotmail|outlook|yahoo|live|icloud|aol)\.[a-z.]+$/.test(domain)) s -= 10;
  return s;
}

/**
 * PURA. Extrae el email más probable de un string de HTML.
 * Estrategia: junta candidatos de mailto: (alta confianza) + de texto plano,
 * los normaliza/filtra, y devuelve el de mayor score. null si no hay ninguno.
 *
 * @param {string} html
 * @param {string} [siteUrl] URL del sitio (para preferir email del mismo dominio)
 * @returns {string|null}
 */
export function extractEmailFromHtml(html, siteUrl = "") {
  try {
    if (!html || typeof html !== "string") return null;
    const siteHost = hostFromUrl(siteUrl);
    const candidates = new Map(); // email -> { email, fromMailto }

    const add = (raw, fromMailto) => {
      const norm = normalizeEmailCandidate(raw);
      if (!norm) return;
      const prev = candidates.get(norm);
      if (!prev) candidates.set(norm, { email: norm, fromMailto });
      else if (fromMailto && !prev.fromMailto) prev.fromMailto = true;
    };

    // 1) mailto: links (href="mailto:..." o cualquier ocurrencia de mailto:)
    const mailtoRe = /mailto:([^"'\s>?]+)/gi;
    let m;
    while ((m = mailtoRe.exec(html)) !== null) add(m[1], true);

    // 2) emails sueltos en el texto / HTML (incluye entidades simples al decodificar)
    const decoded = html
      .replace(/&#0?64;/g, "@")
      .replace(/&#0?46;/g, ".")
      .replace(/&commat;/gi, "@")
      .replace(/&period;/gi, ".");
    const textMatches = decoded.match(EMAIL_TEXT_RE) || [];
    for (const t of textMatches) add(t, false);

    if (candidates.size === 0) return null;

    let best = null;
    let bestScore = -Infinity;
    for (const c of candidates.values()) {
      const sc = scoreEmail(c, siteHost);
      if (sc > bestScore) {
        bestScore = sc;
        best = c;
      }
    }
    return best ? best.email : null;
  } catch {
    return null;
  }
}

/**
 * Helper interno: fetch con timeout robusto (AbortController + race de respaldo).
 * Nunca lanza: resuelve a { ok, status, text } o { ok:false, error }.
 */
async function safeFetch(url, { fetchImpl, timeoutMs, headers = {} }) {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  let timer = null;
  const timeoutP = new Promise((resolve) => {
    timer = setTimeout(() => {
      try {
        controller?.abort();
      } catch {}
      resolve({ ok: false, error: "timeout" });
    }, timeoutMs);
  });
  try {
    const fetchP = (async () => {
      try {
        const res = await fetchImpl(url, {
          signal: controller?.signal,
          redirect: "follow",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (compatible; SCM-LeadEnrich/1.0; +https://scm-setting.up.railway.app)",
            Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
            ...headers,
          },
        });
        if (!res) return { ok: false, error: "no_response" };
        const status = typeof res.status === "number" ? res.status : 0;
        if (res.ok === false || (status && (status < 200 || status >= 400))) {
          return { ok: false, status, error: "http_" + status };
        }
        let text = "";
        try {
          text = typeof res.text === "function" ? await res.text() : "";
        } catch {
          return { ok: false, status, error: "read_failed" };
        }
        if (text && text.length > MAX_HTML_BYTES) text = text.slice(0, MAX_HTML_BYTES);
        return { ok: true, status, text };
      } catch (e) {
        const name = e && e.name;
        if (name === "AbortError") return { ok: false, error: "timeout" };
        return { ok: false, error: "fetch_failed" };
      }
    })();
    return await Promise.race([fetchP, timeoutP]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Hace fetch del website del lead y extrae el email más probable.
 * Nunca lanza. Degrada a { email:null, error:"..." }.
 *
 * @param {string} website
 * @param {{ fetchImpl?: Function, timeoutMs?: number }} [opts]
 * @returns {Promise<{ email: string|null, error: string|null }>}
 */
export async function enrichFromWebsite(website, opts = {}) {
  const fetchImpl = opts.fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  try {
    if (!website || typeof website !== "string" || !website.trim()) {
      return { email: null, error: "no_website" };
    }
    if (!fetchImpl) return { email: null, error: "no_fetch" };

    let url = website.trim();
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;

    // Filtrar websites-basura típicos (wa.me, links de redes que no son sitio).
    const host = hostFromUrl(url);
    if (!host) return { email: null, error: "bad_url" };
    if (/^(wa\.me|api\.whatsapp\.com|whatsapp\.com|m\.facebook\.com|facebook\.com|instagram\.com|t\.me|linktr\.ee|goo\.gl|bit\.ly|maps\.google\.)/i.test(host)) {
      return { email: null, error: "junk_website" };
    }

    const r = await safeFetch(url, { fetchImpl, timeoutMs });
    if (!r.ok) return { email: null, error: r.error || "fetch_failed" };

    const email = extractEmailFromHtml(r.text, url);
    return { email: email || null, error: email ? null : "no_email_found" };
  } catch {
    return { email: null, error: "unexpected" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// NPI Registry (USA)
// API pública gratis de CMS: https://npiregistry.cms.hhs.gov/api/?version=2.1&...
// Devuelve { result_count, results:[ { number, basic:{...},
//   taxonomies:[{ desc, primary, ... }], addresses:[{ city, state, ... }] } ] }
// Doc verificada: https://npiregistry.cms.hhs.gov/api-page
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Construye el nombre del owner desde el bloque basic de un resultado NPI.
 * Org -> organization_name. Persona -> "First Last".
 */
function ownerNameFromBasic(basic) {
  if (!basic || typeof basic !== "object") return "";
  if (basic.organization_name && basic.organization_name.trim()) {
    return basic.organization_name.trim();
  }
  const parts = [basic.first_name, basic.last_name]
    .filter((p) => p && String(p).trim())
    .map((p) => String(p).trim());
  if (parts.length) {
    let name = parts.join(" ");
    if (basic.credential && String(basic.credential).trim()) {
      name += ", " + String(basic.credential).trim();
    }
    return name;
  }
  return "";
}

/**
 * Especialidad: prefiere la taxonomy marcada primary, sino la primera con desc.
 */
function specialtyFromTaxonomies(taxonomies) {
  if (!Array.isArray(taxonomies) || !taxonomies.length) return "";
  const primary = taxonomies.find((t) => t && t.primary && t.desc);
  if (primary) return String(primary.desc).trim();
  const first = taxonomies.find((t) => t && t.desc);
  return first ? String(first.desc).trim() : "";
}

/**
 * Devuelve la dirección "primary" (LOCATION) o la primera disponible.
 */
function pickAddress(addresses) {
  if (!Array.isArray(addresses) || !addresses.length) return {};
  const loc =
    addresses.find((a) => a && a.address_purpose === "LOCATION") ||
    addresses.find((a) => a && (a.city || a.state)) ||
    addresses[0];
  return loc || {};
}

/**
 * PURA. Elige el mejor match de la respuesta JSON del NPI Registry.
 * Recibe el JSON YA parseado (sin red). null si no hay resultados útiles.
 *
 * @param {object} json respuesta del NPI Registry
 * @param {{ name?: string }} [opts] nombre buscado (para desempatar)
 * @returns {{ npi:string, ownerName:string, specialty:string, city:string, state:string }|null}
 */
export function parseNpiResults(json, opts = {}) {
  try {
    if (!json || typeof json !== "object") return null;
    const results = Array.isArray(json.results) ? json.results : [];
    if (!results.length) return null;

    const wanted = (opts.name || "").trim().toLowerCase();
    const wantedTokens = wanted
      ? wanted.split(/[^a-z0-9]+/i).filter((t) => t.length >= 3)
      : [];

    const scored = results
      .map((r) => {
        if (!r || typeof r !== "object") return null;
        const npi = r.number != null ? String(r.number) : "";
        if (!npi) return null;
        const ownerName = ownerNameFromBasic(r.basic);
        const specialty = specialtyFromTaxonomies(r.taxonomies);
        const addr = pickAddress(r.addresses);
        const city = addr.city ? String(addr.city).trim() : "";
        const state = addr.state ? String(addr.state).trim() : "";

        // Score: match de tokens del nombre buscado contra owner + org.
        let score = 0;
        if (wantedTokens.length) {
          const hay = (ownerName + " " + (r.basic?.organization_name || "")).toLowerCase();
          for (const t of wantedTokens) if (hay.includes(t)) score += 5;
        }
        if (specialty) score += 1;
        if (city || state) score += 1;
        return { npi, ownerName, specialty, city, state, score };
      })
      .filter(Boolean);

    if (!scored.length) return null;
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    return {
      npi: best.npi,
      ownerName: best.ownerName,
      specialty: best.specialty,
      city: best.city,
      state: best.state,
    };
  } catch {
    return null;
  }
}

/**
 * Consulta el NPI Registry por nombre de organización + ciudad + estado.
 * Nunca lanza. Degrada a null, o a { error } si falla la red.
 *
 * @param {{ name:string, city?:string, state?:string }} q
 * @param {{ fetchImpl?: Function, timeoutMs?: number }} [opts]
 * @returns {Promise<{ npi, ownerName, specialty, city, state, error? }|null>}
 */
export async function enrichFromNPI(q = {}, opts = {}) {
  const fetchImpl = opts.fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  try {
    const name = (q.name || "").trim();
    const city = (q.city || "").trim();
    const state = (q.state || "").trim();
    if (!name) return null;
    if (!fetchImpl) return { error: "no_fetch" };

    const params = new URLSearchParams();
    params.set("version", "2.1");
    // organization_name acepta wildcard con * al final.
    params.set("organization_name", name.length > 2 ? name + "*" : name);
    if (city) params.set("city", city);
    if (state && /^[A-Za-z]{2}$/.test(state)) params.set("state", state.toUpperCase());
    params.set("country_code", "US");
    params.set("limit", "10");

    const url = "https://npiregistry.cms.hhs.gov/api/?" + params.toString();
    const r = await safeFetch(url, {
      fetchImpl,
      timeoutMs,
      headers: { Accept: "application/json" },
    });
    if (!r.ok) return { error: r.error || "fetch_failed" };

    let json = null;
    try {
      json = JSON.parse(r.text);
    } catch {
      return { error: "bad_json" };
    }
    const best = parseNpiResults(json, { name });
    return best; // {match} o null si no hubo resultados
  } catch {
    return { error: "unexpected" };
  }
}

export default {
  extractEmailFromHtml,
  enrichFromWebsite,
  parseNpiResults,
  enrichFromNPI,
};

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
//   classifyEmailType(email) -> 'personal'|'generic'|'unknown'       (PURA)
//   enrichFromWebsite(website, { fetchImpl?, timeoutMs? })
//        -> Promise<{ email: string|null, emailType: string,
//                     ads, social, age, error: string|null }>
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

// Local-parts GENÉRICOS de la clínica (no del decisor). Antes se PREMIABAN en el
// scoring (+15); 2026-06-26 se invirtió a -20 porque el vendedor necesita el
// email de la persona (decisor/profesional), no el info@/contacto@ del negocio.
const EMAIL_GENERIC_LOCAL = new Set([
  "info", "contacto", "contact", "citas", "turnos", "recepcion", "reservas",
  "appointments", "hello", "hola", "admin", "clinic", "clinica", "consultas",
  "webmaster", "ventas", "sales", "soporte", "support", "atencion", "general",
  "mail", "correo", "office", "oficina", "secretaria", "hi", "team", "staff",
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
 * PURA. ¿El host apunta a la red interna / loopback / metadata cloud? (anti-SSRF).
 * true = bloquear el fetch. Cubre localhost, IPv4 privadas/loopback/link-local/CGNAT
 * (incluido el metadata 169.254.169.254), IPv6 loopback/link-local/unique-local, y
 * sufijos internos. Arregla el bug del check viejo `startsWith('172.')` que bloqueaba
 * TODO 172.x (172.16-31 es privado, pero 172.0-15 y 172.32-255 son públicos).
 */
export function isBlockedHost(hostname) {
  if (!hostname || typeof hostname !== "string") return true; // sin host → bloquear
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, ""); // quita brackets IPv6
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return true;
  // IPv6 loopback (::1), link-local (fe80::), unique-local (fc00::/7 → fc/fd)
  if (h === "::1" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true;
  // IPv4
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const o = m.slice(1).map(Number);
    if (o.some((x) => x > 255)) return true;
    const [a, b] = o;
    if (a === 0 || a === 127) return true;                 // this-network / loopback
    if (a === 10) return true;                              // privada
    if (a === 192 && b === 168) return true;               // privada
    if (a === 172 && b >= 16 && b <= 31) return true;      // privada (FIX: solo 16-31)
    if (a === 169 && b === 254) return true;               // link-local (metadata 169.254.169.254)
    if (a === 100 && b >= 64 && b <= 127) return true;     // CGNAT
  }
  return false;
}

/**
 * PURA. Clasifica un email en 'personal' (del decisor/profesional),
 * 'generic' (info@/contacto@ de la clínica) o 'unknown'. Se usa para el scoring
 * y se persiste como lead.emailType (llega al export).
 * @param {string} email
 * @returns {'personal'|'generic'|'unknown'}
 */
export function classifyEmailType(email) {
  if (!email || typeof email !== "string") return "unknown";
  const at = email.lastIndexOf("@");
  if (at <= 0) return "unknown";
  const local = email.slice(0, at).toLowerCase().trim();
  const localNoDigits = local.replace(/\d+$/, ""); // maria.perez2 -> maria.perez
  if (EMAIL_GENERIC_LOCAL.has(local) || EMAIL_GENERIC_LOCAL.has(localNoDigits)) return "generic";
  // nombre.apellido / nombre_apellido / nombre-apellido (señal fuerte de persona)
  if (/^[a-z]{2,}[._-][a-z]{2,}$/.test(localNoDigits)) return "personal";
  // inicial+apellido: j.perez, jperez
  if (/^[a-z]\.?[a-z]{3,}$/.test(localNoDigits)) return "personal";
  // token único alfabético (nombre@): 3-15 chars, no genérico
  if (/^[a-z]{3,15}$/.test(localNoDigits)) return "personal";
  return "unknown";
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
  // Tipo de email: 2026-06-26 INVERTIDO. Preferimos el del decisor (nombre propio,
  // +25) sobre el genérico de la clínica (info@/contacto@, -20). Antes premiaba
  // los genéricos (+15) → el export salía con el email equivocado.
  const type = classifyEmailType(c.email);
  if (type === "personal") s += 25;
  else if (type === "generic") s -= 20;
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
 * PURA. Detecta píxeles/tags de publicidad en el HTML (prueba directa de que el
 * negocio invierte en ads → señal de cold call "ya pauta, ¿ese lead lo sigue
 * alguien?"). Phase 10 C6. Devuelve { hasMetaPixel, hasGoogleAds, hasTikTokPixel,
 * hasGTM, runsAds }.
 */
export function detectAdPixels(html) {
  const out = { hasMetaPixel: false, hasGoogleAds: false, hasTikTokPixel: false, hasGTM: false, runsAds: false };
  if (!html || typeof html !== "string") return out;
  const h = html.toLowerCase();
  // Meta/Facebook pixel
  out.hasMetaPixel = h.includes("connect.facebook.net/en_us/fbevents.js") || h.includes("fbq('init'") || h.includes('fbq("init"') || /\bfbq\(/.test(h) || h.includes("facebook.com/tr?id=");
  // Google Ads (conversion/remarketing AW-) — distinto de GA4 (analytics, no ads)
  out.hasGoogleAds = /aw-\d{6,}/.test(h) || h.includes("googleadservices.com") || h.includes("google_conversion_id") || h.includes("gtag/js?id=aw-");
  // TikTok pixel
  out.hasTikTokPixel = h.includes("analytics.tiktok.com") || h.includes("ttq.load");
  // Google Tag Manager (señal débil de stack de marketing)
  out.hasGTM = h.includes("googletagmanager.com/gtm.js") || h.includes("gtm-");
  out.runsAds = out.hasMetaPixel || out.hasGoogleAds || out.hasTikTokPixel;
  return out;
}

/**
 * PURA. Extrae links de Instagram/Facebook del HTML del sitio (gratis, del mismo
 * fetch que ya hacemos para email/ads). Filtra paths que NO son perfiles
 * (sharer, plugins, /p/, /reel/, etc.). Devuelve { instagram:"", facebook:"" }.
 */
export function extractSocialFromHtml(html) {
  const out = { instagram: "", facebook: "" };
  if (!html || typeof html !== "string") return out;
  // Instagram: instagram.com/<handle> — excluir paths que no son perfiles.
  const IG_BAD = new Set(["p", "reel", "reels", "explore", "accounts", "about", "developer", "legal", "directory", "tv", "stories", "share", "embed", "graphql"]);
  const igRe = /(?:https?:)?\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9_.]{2,40})\/?/gi;
  let m;
  while ((m = igRe.exec(html)) !== null) {
    const handle = m[1];
    if (!handle || IG_BAD.has(handle.toLowerCase())) continue;
    out.instagram = "https://instagram.com/" + handle;
    break;
  }
  // Facebook: facebook.com/<handle> — excluir sharer/plugins/dialog/tr/etc.
  const FB_BAD = new Set(["sharer", "sharer.php", "plugins", "dialog", "tr", "login", "help", "privacy", "policies", "watch", "gaming", "marketplace", "share", "l.php", "events", "groups"]);
  const fbRe = /(?:https?:)?\/\/(?:www\.|m\.|web\.)?facebook\.com\/([a-zA-Z0-9_.\-]{2,60})\/?/gi;
  while ((m = fbRe.exec(html)) !== null) {
    const handle = m[1];
    const low = (handle || "").toLowerCase();
    if (!handle || FB_BAD.has(low) || low.startsWith("sharer") || low.startsWith("tr?")) continue;
    out.facebook = "https://facebook.com/" + handle;
    break;
  }
  return out;
}

/**
 * PURA. Extrae la antigüedad de la clínica del HTML del sitio: "desde XXXX",
 * "fundada en AÑO", "X años de experiencia/trayectoria". Devuelve
 * { foundedYear:"", yearsActive:null }. Gratis, del mismo fetch del email.
 */
export function extractAgeFromHtml(html) {
  const out = { foundedYear: "", yearsActive: null };
  if (!html || typeof html !== "string") return out;
  // Sacar <script> y tags → no matchear años dentro de URLs/JS/copyright.
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const nowY = new Date().getFullYear();
  const since = text.match(/\b(?:desde(?:\s+el\s+a[ñn]o)?|fundad[oa]s?\s+en|estable?cid[oa]s?\s+en|operando\s+desde|inaugurad[oa]s?\s+en|a[ñn]o\s+de\s+fundaci[oó]n[:\s]*)\s*(19[5-9]\d|20[0-4]\d)\b/i);
  const exp = text.match(/\b(?:m[aá]s\s+de\s+)?(\d{1,3})\s*a[ñn]os\s+(?:de\s+)?(?:experiencia|trayectoria|en\s+el\s+mercado|atendiendo|brindando|cuidando|al\s+servicio)/i);
  if (since) {
    const y = parseInt(since[1], 10); const age = nowY - y;
    if (age >= 0 && age <= 120) { out.foundedYear = String(y); out.yearsActive = age; }
  } else if (exp) {
    const y = parseInt(exp[1], 10);
    if (y > 0 && y <= 120) { out.yearsActive = y; out.foundedYear = String(nowY - y); }
  }
  return out;
}

/**
 * Hace fetch del website del lead y extrae el email más probable + señales de
 * publicidad (píxeles) + redes (instagram/facebook) + antigüedad. Nunca lanza.
 * Degrada a { email:null, ads:null, social:{}, age:{}, error }.
 *
 * @param {string} website
 * @param {{ fetchImpl?: Function, timeoutMs?: number }} [opts]
 * @returns {Promise<{ email: string|null, ads: object|null, social: object, age: object, error: string|null }>}
 */
export async function enrichFromWebsite(website, opts = {}) {
  const fetchImpl = opts.fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  try {
    if (!website || typeof website !== "string" || !website.trim()) {
      return { email: null, ads: null, social: {}, age: {}, emailType: "unknown", error: "no_website" };
    }
    if (!fetchImpl) return { email: null, ads: null, social: {}, age: {}, emailType: "unknown", error: "no_fetch" };

    let url = website.trim();
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;

    // Filtrar websites-basura típicos (wa.me, links de redes que no son sitio).
    const host = hostFromUrl(url);
    if (!host) return { email: null, ads: null, social: {}, age: {}, emailType: "unknown", error: "bad_url" };
    // Anti-SSRF: el website llega por alta manual/CSV → bloquear hosts internos
    // antes de hacer fetch (no exfiltrar metadata cloud ni pegarle a la red privada).
    if (isBlockedHost(host)) return { email: null, ads: null, social: {}, age: {}, emailType: "unknown", error: "blocked_host" };
    if (/^(wa\.me|api\.whatsapp\.com|whatsapp\.com|m\.facebook\.com|facebook\.com|instagram\.com|t\.me|linktr\.ee|goo\.gl|bit\.ly|maps\.google\.)/i.test(host)) {
      return { email: null, ads: null, social: {}, age: {}, emailType: "unknown", error: "junk_website" };
    }

    const r = await safeFetch(url, { fetchImpl, timeoutMs });
    if (!r.ok) return { email: null, ads: null, social: {}, age: {}, emailType: "unknown", error: r.error || "fetch_failed" };

    const email = extractEmailFromHtml(r.text, url);
    const ads = detectAdPixels(r.text);
    const social = extractSocialFromHtml(r.text);
    const age = extractAgeFromHtml(r.text);
    const emailType = email ? classifyEmailType(email) : "unknown";
    return { email: email || null, emailType, ads, social, age, error: email ? null : "no_email_found" };
  } catch {
    return { email: null, ads: null, social: {}, age: {}, emailType: "unknown", error: "unexpected" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Meta Ad Library (¿la clínica corre anuncios AHORA en Facebook/Instagram?)
// ─────────────────────────────────────────────────────────────────────────────

// País (nombre ES como viene en lead.country) → ISO2 para ad_reached_countries.
const META_COUNTRY_ISO = {
  "argentina": "AR", "uruguay": "UY", "brasil": "BR", "brazil": "BR",
  "méxico": "MX", "mexico": "MX", "colombia": "CO", "chile": "CL",
  "españa": "ES", "espana": "ES", "spain": "ES", "perú": "PE", "peru": "PE",
  "ecuador": "EC",
};

/** PURA. Extrae el handle/id de página de un URL de Facebook. "" si no parsea. */
function fbHandleFromUrl(fb) {
  if (!fb || typeof fb !== "string") return "";
  const m = fb.match(/facebook\.com\/(?:profile\.php\?id=)?([A-Za-z0-9_.\-]+)/i);
  if (!m) return "";
  const h = m[1];
  if (/^(sharer|plugins|dialog|tr|login|help|events|groups|watch)$/i.test(h)) return "";
  return h;
}

let _metaTokenWarned = false;

/**
 * ¿La clínica corre anuncios activos en Meta (Facebook/Instagram)? Consulta la
 * Meta Ad Library. Nunca lanza: degrada a { metaAdsActive:false, skipped|error }.
 *
 * CAVEAT IMPORTANTE: la API `ads_archive` expone anuncios COMERCIALES solo en la
 * UE (España ✅ por DSA). En LatAm suele devolver únicamente anuncios políticos/
 * de temas sociales → `metaAdsActive` puede dar false aunque la clínica paute.
 * Para LatAm, la detección de pixel (detectAdPixels) sigue siendo el proxy.
 *
 * Cómo obtener META_AD_LIBRARY_TOKEN:
 *   1. developers.facebook.com → crear una App (tipo Business).
 *   2. Agregar el producto "Meta Ad Library API".
 *   3. Completar la verificación de identidad si la pide.
 *   4. Generar un access token y setearlo en Railway como META_AD_LIBRARY_TOKEN.
 *
 * @param {{ facebook?:string, country?:string }} lead
 * @param {{ fetchImpl?:Function, timeoutMs?:number, token?:string }} [opts]
 * @returns {Promise<{ metaAdsActive:boolean, metaAdsCount:number, metaAdsLastCreated:string, skipped?:string, error?:string }>}
 */
export async function enrichFromMetaAdLibrary(lead = {}, opts = {}) {
  const fetchImpl = opts.fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const token = opts.token !== undefined ? opts.token : (typeof process !== "undefined" ? process.env.META_AD_LIBRARY_TOKEN : "");
  const base = { metaAdsActive: false, metaAdsCount: 0, metaAdsLastCreated: "" };
  try {
    const fb = String(lead.facebook || "").trim();
    if (!fb) return { ...base, skipped: "no_facebook" };
    const handle = fbHandleFromUrl(fb);
    if (!handle) return { ...base, skipped: "no_handle" };
    if (!token) {
      if (!_metaTokenWarned) {
        console.warn("[meta-ad-library] META_AD_LIBRARY_TOKEN no configurado — se saltea el chequeo de ads (setealo en Railway).");
        _metaTokenWarned = true;
      }
      return { ...base, skipped: "no_token" };
    }
    if (!fetchImpl) return { ...base, skipped: "no_fetch" };
    const iso = META_COUNTRY_ISO[String(lead.country || "").trim().toLowerCase()] || "";
    if (!iso) return { ...base, skipped: "unsupported_country" };

    const params = new URLSearchParams();
    params.set("access_token", token);
    params.set("ad_reached_countries", `["${iso}"]`);
    params.set("search_terms", handle);
    params.set("ad_active_status", "ACTIVE");
    params.set("fields", "id,ad_creation_time,ad_creative_link_titles");
    params.set("limit", "50");
    const url = "https://graph.facebook.com/v21.0/ads_archive?" + params.toString();

    const r = await safeFetch(url, { fetchImpl, timeoutMs, headers: { Accept: "application/json" } });
    if (!r.ok) return { ...base, error: r.error || "fetch_failed" };
    let json = null;
    try { json = JSON.parse(r.text); } catch { return { ...base, error: "bad_json" }; }
    if (json && json.error) return { ...base, error: "api_" + (json.error.code || "error") };
    const ads = Array.isArray(json && json.data) ? json.data : [];
    let last = "";
    for (const a of ads) { const t = a && a.ad_creation_time; if (t && String(t) > last) last = String(t); }
    return { metaAdsActive: ads.length > 0, metaAdsCount: ads.length, metaAdsLastCreated: last };
  } catch {
    return { ...base, error: "unexpected" };
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
  classifyEmailType,
  detectAdPixels,
  extractSocialFromHtml,
  extractAgeFromHtml,
  isBlockedHost,
  enrichFromWebsite,
  enrichFromMetaAdLibrary,
  parseNpiResults,
  enrichFromNPI,
};

// Corre el Brief IA sobre los leads de ESPAÑA en producción y te imprime el texto
// generado para revisar calidad (orientación a reactivación + que NO se filtre marca).
//
// Hace, en orden:
//   1. Login admin (cookie gs_session).
//   2. Recon GRATIS (dryRun): cuántos leads de España quedan por briefear (reseñas y web).
//   3. Brief de RESEÑAS (💲 SerpApi + LLM) — tandas de 8, país=España.
//   4. Brief desde WEB (solo LLM, sin SerpApi) — tandas de 12, país=España.
//   5. Imprime cada brief generado: nombre, fit, hook, brief, tratamientos, fuente.
//      Marca con ⚠️ si aparece alguna marca (SCM u otra) en el texto.
//
// Empieza con un LOTE CHICO por default para que veas el output antes de gastar.
// Subí los topes con env vars cuando estés conforme con la calidad.
//
// Uso (PowerShell):
//   $env:ADMIN_EMAIL="ignacioana91@gmail.com"; $env:ADMIN_PASSWORD="<pass>"; node scripts/brief-espana.mjs
// Opcional:
//   $env:REVIEWS_ROUNDS="2"   (tandas de 8 del brief de reseñas; 0 = saltear)
//   $env:WEB_ROUNDS="2"       (tandas de 12 del brief de web; 0 = saltear)
//   $env:RAILWAY_URL="https://scm-setting.up.railway.app"

const BASE = (process.env.RAILWAY_URL || "https://scm-setting.up.railway.app").replace(/\/$/, "");
const EMAIL = process.env.ADMIN_EMAIL || "ignacioana91@gmail.com";
const PASSWORD = process.env.ADMIN_PASSWORD || "";
const COUNTRY = process.env.BRIEF_COUNTRY || "España";
const REVIEWS_ROUNDS = parseInt(process.env.REVIEWS_ROUNDS ?? "2", 10);
const WEB_ROUNDS = parseInt(process.env.WEB_ROUNDS ?? "2", 10);

if (!PASSWORD) {
  console.error("❌ Falta ADMIN_PASSWORD. Ejemplo (PowerShell):\n   $env:ADMIN_PASSWORD=\"tu-pass\"; node scripts/brief-espana.mjs");
  process.exit(1);
}

let COOKIE = "";
async function api(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(COOKIE ? { Cookie: COOKIE } : {}) },
    body: JSON.stringify(body || {}),
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie && setCookie.includes("gs_session")) COOKIE = setCookie.split(";")[0];
  let json = null;
  try { json = await res.json(); } catch { /* respuesta no-JSON */ }
  return { status: res.status, ok: res.ok, json };
}

const BRAND_RE = /\bscm\b|scm dental/i;
function flagBrand(txt) { return BRAND_RE.test(String(txt || "")) ? " ⚠️ MARCA DETECTADA" : ""; }

function printBriefs(resp, label) {
  const briefs = resp.leadBriefs || {};
  const sample = resp.briefedSample || [];
  const nameById = {};
  for (const s of sample) nameById[s.id] = s.name;
  const ids = Object.keys(briefs);
  if (!ids.length) { console.log(`   (sin briefs nuevos en esta tanda)`); return; }
  for (const id of ids) {
    const b = briefs[id];
    const name = nameById[id] || id;
    console.log(`\n   ── ${name}  ·  fit ${b.fitScore != null ? b.fitScore : "—"}  ·  ${label}`);
    if (b.hookPhrase) console.log(`      HOOK: ${b.hookPhrase}${flagBrand(b.hookPhrase)}`);
    if (b.brief) console.log(`      BRIEF: ${b.brief}${flagBrand(b.brief)}`);
    if (Array.isArray(b.painPoints) && b.painPoints.length) {
      console.log(`      DOLORES: ${b.painPoints.map((p) => (typeof p === "string" ? p : p.dolor)).join(" | ")}`);
    }
    if (Array.isArray(b.treatments) && b.treatments.length) console.log(`      TRATAMIENTOS: ${b.treatments.join(", ")}`);
  }
}

(async () => {
  console.log(`🔑 Login ${EMAIL} en ${BASE} ...`);
  const login = await api("/api/auth/login", { email: EMAIL, password: PASSWORD });
  if (!login.ok || !COOKIE) { console.error("❌ Login falló:", login.status, login.json?.error || ""); process.exit(1); }
  console.log("✅ Login OK\n");

  // Recon gratis
  const reconR = await api("/api/admin/enrich-brief", { dryRun: true, country: COUNTRY });
  const reconW = await api("/api/admin/enrich-web-brief", { dryRun: true, country: COUNTRY });
  console.log(`📊 España — pendientes de brief:`);
  console.log(`   reseñas (10+): ${reconR.json?.pending ?? "?"}  (con place_id: ${reconR.json?.pendingWithPlaceId ?? "?"})`);
  if (reconW.status === 404) console.log(`   web: ⚠️ endpoint enrich-web-brief NO responde (¿deploy todavía en curso?)`);
  else console.log(`   web (con sitio propio): ${reconW.json?.pending ?? "?"}`);
  console.log("");

  // Brief de reseñas (💲)
  let totalReviews = 0;
  for (let i = 0; i < REVIEWS_ROUNDS; i++) {
    console.log(`💲 Brief RESEÑAS — tanda ${i + 1}/${REVIEWS_ROUNDS} (España, hasta 8)...`);
    const r = await api("/api/admin/enrich-brief", { country: COUNTRY, limit: 8 });
    if (!r.ok) { console.error("   ⚠️", r.json?.error || r.status); break; }
    console.log(`   briefeados ${r.json.briefed} (escaneó ${r.json.scanned}; sin ficha ${r.json.errors?.no_place_id || 0}; IA falló ${r.json.errors?.bad_llm || 0})`);
    printBriefs(r.json, "reseñas");
    totalReviews += r.json.briefed || 0;
    if (!r.json.briefed) { console.log("   → no quedan más para briefear por reseñas.\n"); break; }
    console.log("");
  }

  // Brief desde web (gratis de SerpApi)
  let totalWeb = 0;
  for (let i = 0; i < WEB_ROUNDS; i++) {
    console.log(`🌐 Brief WEB — tanda ${i + 1}/${WEB_ROUNDS} (España, hasta 12)...`);
    const r = await api("/api/admin/enrich-web-brief", { country: COUNTRY, limit: 12 });
    if (r.status === 404) { console.error("   ⚠️ endpoint no disponible (deploy en curso). Reintentá en unos minutos."); break; }
    if (!r.ok) { console.error("   ⚠️", r.json?.error || r.status); break; }
    console.log(`   briefeados ${r.json.briefed} (escaneó ${r.json.scanned}; sin texto ${r.json.errors?.no_site_text || 0}; IA falló ${r.json.errors?.bad_llm || 0})`);
    printBriefs(r.json, "web");
    totalWeb += r.json.briefed || 0;
    if (!r.json.briefed) { console.log("   → no quedan más para briefear por web.\n"); break; }
    console.log("");
  }

  console.log(`\n🏁 Total: ${totalReviews} briefs por reseñas + ${totalWeb} por web (España).`);
  console.log(`   Si el texto se ve bien, subí topes: $env:REVIEWS_ROUNDS="20"; $env:WEB_ROUNDS="20"; node scripts/brief-espana.mjs`);
})().catch((e) => { console.error("❌ Error:", e?.message || e); process.exit(1); });

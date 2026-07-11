#!/usr/bin/env node
/**
 * Pre-deploy script: descarga la data actual del servidor Railway
 * y la guarda localmente en data/ para que no se pierda al re-deployar.
 *
 * Uso:  npm run pre-deploy
 *
 * Requiere estas env vars (o las pide por stdin):
 *   RAILWAY_URL  – URL de tu app en Railway (ej: https://tu-app.up.railway.app)
 *   ADMIN_EMAIL  – tu email de admin
 *   ADMIN_PASSWORD – tu contraseña de admin
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import readline from "readline";
// 2026-07-11: cargar credenciales del proyecto (gitignored). Con ADMIN_EMAIL y
// ADMIN_PASSWORD en .env o .env.local, el pre-deploy corre sin preguntar nada
// → se puede automatizar el ciclo completo de deploy. dotenv NO pisa vars ya
// cargadas, así que .env.local (más específico) gana sobre .env.
import dotenv from "dotenv";
const _root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
// .env.local primero (defaults de dev local), luego .env con override: para el
// pre-deploy, .env manda — es donde el user pone las credenciales de PRODUCCIÓN
// (evita que un ADMIN_EMAIL de dev en .env.local rompa el login a Railway).
dotenv.config({ path: path.join(_root, ".env.local") });
dotenv.config({ path: path.join(_root, ".env"), override: true });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (ans) => { rl.close(); resolve(ans.trim()); }));
}

async function main() {
  console.log("\n=== PRE-DEPLOY: Backup de data desde Railway ===\n");

  // 1. Obtener URL y credenciales. RAILWAY_URL default a la app de producción
  // (la URL es pública, no un secreto) → así con solo ADMIN_EMAIL/PASSWORD en
  // .env.local el pre-deploy corre 100% sin preguntas.
  let baseUrl = process.env.RAILWAY_URL || "https://scm-setting.up.railway.app";
  baseUrl = baseUrl.trim().replace(/\/+$/, ""); // quitar trailing slash
  // Tolerar URL sin protocolo (ej: "scm-setting.up.railway.app") — sin esto
  // fetch() explota con ERR_INVALID_URL y el backup no corre.
  if (!/^https?:\/\//i.test(baseUrl)) baseUrl = "https://" + baseUrl;

  let email = process.env.ADMIN_EMAIL;
  if (!email) email = await ask("Email de admin: ");

  let password = process.env.ADMIN_PASSWORD;
  if (!password) password = await ask("Contraseña de admin: ");

  // 2. Login para obtener cookie de sesión
  console.log("Logueando en Railway...");
  const loginResp = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    redirect: "manual",
  });

  if (!loginResp.ok && loginResp.status !== 302) {
    const body = await loginResp.text();
    console.error(`Error de login (${loginResp.status}): ${body}`);
    process.exit(1);
  }

  // Extraer cookie de sesión
  const setCookie = loginResp.headers.getSetCookie?.() || loginResp.headers.raw?.()?.["set-cookie"] || [];
  const cookies = (Array.isArray(setCookie) ? setCookie : [setCookie])
    .map((c) => c.split(";")[0])
    .join("; ");

  if (!cookies) {
    console.error("No se recibió cookie de sesión. Verificá credenciales.");
    process.exit(1);
  }
  console.log("Login OK.");

  // 3. Descargar data
  console.log("Descargando data...");
  const exportResp = await fetch(`${baseUrl}/api/admin/export-data`, {
    headers: { Cookie: cookies },
  });

  if (!exportResp.ok) {
    const body = await exportResp.text();
    console.error(`Error descargando data (${exportResp.status}): ${body}`);
    process.exit(1);
  }

  const data = await exportResp.json();
  console.log(`Data recibida (exportada: ${data.exportedAt})`);

  // 4. Guardar archivos
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  // Helper para escribir cada archivo de forma aislada: un fallo de uno no
  // bloquea el resto del backup. Loguea con tag claro de éxito/error.
  const results = { saved: [], skipped: [], failed: [] };
  function saveFile(fname, payload, summary = "") {
    if (payload == null) { results.skipped.push(`${fname} (server devolvió null)`); return; }
    const fpath = path.join(DATA_DIR, fname);
    try {
      fs.writeFileSync(fpath, JSON.stringify(payload, null, 2));
      console.log(`  ok  ${fname}${summary ? "  (" + summary + ")" : ""}`);
      results.saved.push(fname);
    } catch (e) {
      console.error(`  ERR ${fname}: ${e.message}`);
      results.failed.push(`${fname}: ${e.message}`);
    }
  }

  if (data.history) {
    const entries = Object.keys(data.history.entries || {}).length;
    saveFile("history.json", data.history, `${entries} entries`);
  } else { results.skipped.push("history.json (no en payload)"); }

  if (data.auth) {
    const users = (data.auth.users || []).length;
    const invites = (data.auth.invites || []).length;
    // Seguridad: NUNCA commitear las sesiones vivas al repo. El `id` de cada
    // sesion ES el valor del cookie `gs_session` (index.js:1461 lo setea,
    // index.js:369 lo lee) — o sea, cada sesion guardada es un bearer token
    // valido hasta su expiresAt. Commiteadas quedan en el historial de git y
    // cualquiera con acceso de lectura puede secuestrar la sesion. A diferencia
    // de los proxies/Telnyx, limpiarlas no tiene costo de restore: los users
    // simplemente vuelven a loguear. Mismo criterio que los otros strippers.
    const strippedSessions = Array.isArray(data.auth.sessions) ? data.auth.sessions.length : 0;
    data.auth.sessions = [];
    if (strippedSessions) console.log(`  lock auth.json: ${strippedSessions} session token(s) limpiado(s) (los users re-loguean)`);
    saveFile("auth.json", data.auth, `${users} users, ${invites} invites, 0 sessions`);
  } else { results.skipped.push("auth.json (no en payload)"); }

  if (data.setters) {
    const setters = (data.setters.setters || []).length;
    const leads = Object.keys(data.setters.leads || {}).length;
    saveFile("setters.json", data.setters, `${setters} setters, ${leads} leads`);
  } else { results.skipped.push("setters.json (no en payload)"); }

  if (data.faqs) {
    const entries = (data.faqs.entries || []).length;
    saveFile("faqs.json", data.faqs, `${entries} entradas`);
  } else { results.skipped.push("faqs.json (no en payload)"); }

  if (data.training) {
    const materials = (data.training.materials || []).length;
    saveFile("training.json", data.training, `${materials} materiales`);
  } else { results.skipped.push("training.json (no en payload)"); }

  // Audit fix (2026-05-23): persistir el resto de los archivos que el endpoint
  // ahora expone. Sin esto, un container nuevo de Railway perdia config Mercury,
  // generaciones, alertas, config Telnyx, eventos, scripts y mensajes programados.
  // Nota: el server hace try/catch por loader, asi que un loader que falla devuelve
  // null. Por eso saveFile() chequea null y skippea en vez de escribir "null" a disco.
  // Seguridad: NUNCA persistir los secrets de Telnyx al repo. Viven en env vars
  // de Railway (TELNYX_API_KEY, TELNYX_SIP_*, etc.). El export-data los devuelve
  // en crudo, y GitHub Push Protection rechaza el push si detecta la API key.
  // Limpiamos los 5 campos sensibles a "" antes de guardar (numbers/routing/etc
  // quedan intactos). Ver memoria predeploy-telnyx-secret-leak.
  if (data.telnyxConfig && typeof data.telnyxConfig === "object") {
    const SENSITIVE = ["apiKey", "sipUsername", "sipPassword", "sipConnectionId", "signaturePublicKey"];
    let cleaned = 0;
    for (const f of SENSITIVE) {
      if (data.telnyxConfig[f]) { data.telnyxConfig[f] = ""; cleaned++; }
    }
    if (cleaned) console.log(`  lock telnyx_config.json: ${cleaned} secret(s) limpiados (viven en env vars de Railway)`);
  }

  const extras = [
    ['mercuryConfig', 'mercury_config.json'],
    ['mercuryGenerations', 'mercury_generations.json'],
    ['alertConfig', 'alert_config.json'],
    ['telnyxConfig', 'telnyx_config.json'],
    ['telnyxEvents', 'telnyx_events.json'],
    ['callScripts', 'call_scripts.json'],
    ['scheduledMessages', 'scheduled_messages.json'],
    // Audit scraper 2026-07-11: los batches son leads ya PAGADOS con créditos
    // SerpAPI — sin esto, un container nuevo de Railway los perdía.
    ['scrapeBatches', 'scrape_batches.json'],
  ];
  for (const [key, fname] of extras) {
    saveFile(fname, data[key]);
  }

  // 5. Bajar data del módulo WA (si existe el endpoint)
  try {
    const waResp = await fetch(`${baseUrl}/api/wa/admin/export`, { headers: { Cookie: cookies } });
    if (waResp.ok) {
      const waData = await waResp.json();
      if (waData.accounts) {
        // Seguridad: NUNCA commitear proxy.pass al repo (mismo criterio que los
        // secrets de Telnyx, arriba). El export /api/wa/admin/export lo trae en
        // claro a propósito (necesario para un restore en vivo vía import), pero
        // el archivo que se versiona en GitHub se limpia: GitHub Push Protection
        // NO detecta contraseñas de proxy genéricas, así que se commitearían
        // silenciosamente. Tras una pérdida total del volumen, las pass de proxy
        // se vuelven a cargar a mano por cuenta (igual que se re-proveen los
        // secrets de Telnyx desde env vars). Ver memoria proxy-pass-predeploy-leak-risk.
        let proxyCleaned = 0;
        for (const acc of (waData.accounts.accounts || [])) {
          if (acc && acc.proxy && acc.proxy.pass) { acc.proxy.pass = ""; proxyCleaned++; }
        }
        if (proxyCleaned) console.log(`  lock wa_accounts.json: ${proxyCleaned} proxy pass limpiado(s) (re-cargar a mano tras restore)`);
        saveFile("wa_accounts.json", waData.accounts, `${(waData.accounts.accounts || []).length} cuentas`);
      }
      if (waData.routines) saveFile("wa_routines.json", waData.routines, `${(waData.routines.routines || []).length} rutinas`);
      if (waData.events) saveFile("wa_events.json", waData.events, `${(waData.events.events || []).length} eventos`);
      if (waData.campaigns) saveFile("wa_campaigns.json", waData.campaigns, `${(waData.campaigns.campaigns || []).length} campañas`);
    } else if (waResp.status !== 404) {
      console.warn(`  WARN módulo WA respondió ${waResp.status}, skipping wa_*.json`);
      results.skipped.push(`wa_*.json (HTTP ${waResp.status})`);
    }
  } catch (e) {
    console.warn(`  WARN módulo WA no disponible (${e.message}), skipping wa_*.json`);
    results.skipped.push(`wa_*.json (${e.message})`);
  }

  // 6. Resumen final
  console.log(`\n=== RESUMEN ===`);
  console.log(`  Guardados: ${results.saved.length} archivos`);
  console.log(`  Omitidos:  ${results.skipped.length} (${results.skipped.join(", ") || "ninguno"})`);
  if (results.failed.length) {
    console.error(`  FALLARON:  ${results.failed.length} archivos`);
    for (const f of results.failed) console.error(`    - ${f}`);
    console.error(`\nNO commitear. Resolver fallos primero.`);
    process.exit(1);
  }

  console.log("\nBackup completo. Ahora podés commitear y pushear.\n");
}

main().catch((e) => { console.error("Error:", e); process.exit(1); });

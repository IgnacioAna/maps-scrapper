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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (ans) => { rl.close(); resolve(ans.trim()); }));
}

async function main() {
  console.log("\n=== PRE-DEPLOY: Backup de data desde Railway ===\n");

  // 1. Obtener URL y credenciales
  let baseUrl = process.env.RAILWAY_URL;
  if (!baseUrl) baseUrl = await ask("URL de Railway (ej: https://tu-app.up.railway.app): ");
  baseUrl = baseUrl.replace(/\/+$/, ""); // quitar trailing slash

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

  if (data.history) {
    const histPath = path.join(DATA_DIR, "history.json");
    fs.writeFileSync(histPath, JSON.stringify(data.history, null, 2));
    const entries = Object.keys(data.history.entries || {}).length;
    console.log(`  history.json guardado (${entries} entries)`);
  }

  if (data.auth) {
    const authPath = path.join(DATA_DIR, "auth.json");
    fs.writeFileSync(authPath, JSON.stringify(data.auth, null, 2));
    const users = (data.auth.users || []).length;
    console.log(`  auth.json guardado (${users} usuarios)`);
  }

  if (data.setters) {
    const settersPath = path.join(DATA_DIR, "setters.json");
    fs.writeFileSync(settersPath, JSON.stringify(data.setters, null, 2));
    console.log(`  setters.json guardado`);
  }

  // 5. Bajar data del módulo WA (si existe el endpoint)
  try {
    const waResp = await fetch(`${baseUrl}/api/wa/admin/export`, { headers: { Cookie: cookies } });
    if (waResp.ok) {
      const waData = await waResp.json();
      if (waData.accounts) {
        fs.writeFileSync(path.join(DATA_DIR, "wa_accounts.json"), JSON.stringify(waData.accounts, null, 2));
        console.log(`  wa_accounts.json guardado (${(waData.accounts.accounts || []).length} cuentas)`);
      }
      if (waData.routines) {
        fs.writeFileSync(path.join(DATA_DIR, "wa_routines.json"), JSON.stringify(waData.routines, null, 2));
        console.log(`  wa_routines.json guardado (${(waData.routines.routines || []).length} rutinas)`);
      }
      if (waData.events) {
        fs.writeFileSync(path.join(DATA_DIR, "wa_events.json"), JSON.stringify(waData.events, null, 2));
        console.log(`  wa_events.json guardado`);
      }
    } else if (waResp.status !== 404) {
      console.warn(`  ⚠ módulo WA respondió ${waResp.status}, skipping wa_*.json`);
    }
  } catch (e) {
    console.warn(`  ⚠ módulo WA no disponible (${e.message}), skipping wa_*.json`);
  }

  console.log("\n Backup completo. Ahora podés commitear y pushear.\n");
}

main().catch((e) => { console.error("Error:", e); process.exit(1); });

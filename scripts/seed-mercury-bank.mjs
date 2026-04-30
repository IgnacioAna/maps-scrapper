#!/usr/bin/env node
/**
 * Seed Mercury Bank — importa 32 entradas curadas al Banco de Respuestas.
 *
 * Idempotente: dedup por pregunta normalizada (lowercase + strip de signos
 * `¿¡?!.,;:` en bordes). Si la pregunta ya existe, salta.
 *
 * Uso local (default — escribe directo a data/faqs.json):
 *   node scripts/seed-mercury-bank.mjs
 *
 * Uso remoto (vía API contra Railway):
 *   RAILWAY_URL=https://... ADMIN_EMAIL=... ADMIN_PASSWORD=... \
 *     node scripts/seed-mercury-bank.mjs --remote
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BANK_FILE = path.join(__dirname, "seed", "mercury-bank-32.json");
const FAQ_FILE = path.join(ROOT, "data", "faqs.json");

const ENTRIES = JSON.parse(fs.readFileSync(BANK_FILE, "utf8"));

function normPregunta(s) {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/^[¿¡]+/, "")
    .replace(/[?!.,;:]+$/, "")
    .replace(/\s+/g, " ");
}

async function seedLocal() {
  if (!fs.existsSync(FAQ_FILE)) {
    console.error(`No existe ${FAQ_FILE}. Corré el server al menos una vez o creá el archivo manualmente.`);
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(FAQ_FILE, "utf8"));
  data.entries = Array.isArray(data.entries) ? data.entries : [];
  const existing = new Set(data.entries.map((e) => normPregunta(e.pregunta)));

  const created = [];
  const skipped = [];
  const now = new Date().toISOString();

  for (const raw of ENTRIES) {
    const pregunta = String(raw.pregunta || "").trim();
    const respuesta = String(raw.respuesta || "").trim();
    if (!pregunta || !respuesta) {
      skipped.push({ pregunta: pregunta.substring(0, 60), motivo: "falta pregunta o respuesta" });
      continue;
    }
    const key = normPregunta(pregunta);
    if (existing.has(key)) {
      skipped.push({ pregunta: pregunta.substring(0, 60), motivo: "ya existía" });
      continue;
    }
    const entry = {
      id: `faq_mercury_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      pregunta,
      respuesta,
      categoria: ["precio", "objecion", "seguimiento", "calificacion", "general"].includes(raw.categoria) ? raw.categoria : "general",
      tags: Array.isArray(raw.tags) ? raw.tags.map((t) => String(t).trim()).filter(Boolean) : [],
      variantes: Array.isArray(raw.variantes) ? raw.variantes.map((v) => String(v).trim()).filter(Boolean).slice(0, 10) : [],
      variantId: null,
      createdBy: "Mercury Seed",
      createdById: "system_mercury_seed",
      createdAt: now,
      updatedAt: now,
      usos: 0,
      funcionaron: 0,
      tagsExtra: ["mercury-seed"],
    };
    data.entries.push(entry);
    existing.add(key);
    created.push({ pregunta: entry.pregunta.substring(0, 60), categoria: entry.categoria });
  }

  fs.writeFileSync(FAQ_FILE, JSON.stringify(data, null, 2), "utf8");
  console.log(`Seed local OK → ${FAQ_FILE}`);
  console.log(`  creadas: ${created.length}`);
  console.log(`  omitidas: ${skipped.length}`);
  if (skipped.length) console.log("  motivos:", JSON.stringify(skipped.slice(0, 5), null, 2));
}

async function seedRemote() {
  const RAILWAY_URL = (process.env.RAILWAY_URL || "").replace(/\/+$/, "");
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "";
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
  if (!RAILWAY_URL || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.error("Faltan env vars: RAILWAY_URL, ADMIN_EMAIL, ADMIN_PASSWORD");
    process.exit(1);
  }
  const loginRes = await fetch(`${RAILWAY_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (!loginRes.ok) {
    console.error("Login falló:", loginRes.status, await loginRes.text());
    process.exit(1);
  }
  const cookie = loginRes.headers.get("set-cookie") || "";
  const importRes = await fetch(`${RAILWAY_URL}/api/faqs/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ entries: ENTRIES }),
  });
  const out = await importRes.json();
  console.log("Seed remoto:", out);
}

const args = process.argv.slice(2);
if (args.includes("--remote")) seedRemote().catch((e) => { console.error(e); process.exit(1); });
else seedLocal().catch((e) => { console.error(e); process.exit(1); });

// Re-normaliza el campo `whatsappUrl` de cada lead en data/setters.json usando
// la versión actual de buildWhatsAppUrl. Soluciona casos históricos donde se
// guardó `wa.me/1...` con prefijo `1` espurio sobre números que ya traían su
// código de país (ej. España 34, AR 54, MX 52, etc.).
//
// Uso:
//   node scripts/normalize-stored-whatsapp-urls.mjs            # apply
//   node scripts/normalize-stored-whatsapp-urls.mjs --dry-run  # solo reporta
//
// Hace un backup automático en data/setters.json.bak-pre-norm-<timestamp>.

// Evita que importar index.js levante el servidor HTTP.
process.env.NODE_ENV = process.env.NODE_ENV || "test";

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildWhatsAppUrl } from "../index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataPath = path.resolve(__dirname, "..", "data", "setters.json");
const dryRun = process.argv.includes("--dry-run");

if (!fs.existsSync(dataPath)) {
  console.error(`No existe ${dataPath}`);
  process.exit(1);
}

const raw = fs.readFileSync(dataPath, "utf8");
const data = JSON.parse(raw);
const leads = data.leads || {};
const ids = Object.keys(leads);

let touched = 0, unchanged = 0, cleared = 0;
const samples = [];

for (const id of ids) {
  const l = leads[id];
  const oldUrl = l.whatsappUrl || "";
  // Recomputar desde phone/webWhatsApp/aiWhatsApp + country, sin texto (igual
  // a como hace PUT /api/setters/leads/:id en index.js línea ~2022).
  const newUrl = buildWhatsAppUrl(
    l.phone || l.webWhatsApp || l.aiWhatsApp || "",
    l.country || "",
    ""
  );
  if (newUrl === oldUrl) { unchanged++; continue; }
  if (samples.length < 10) samples.push({ id, num: l.num, country: l.country, phone: l.phone, oldUrl, newUrl });
  if (!newUrl) cleared++;
  l.whatsappUrl = newUrl;
  touched++;
}

console.log(`Leads totales: ${ids.length}`);
console.log(`Sin cambios:   ${unchanged}`);
console.log(`Modificados:   ${touched} (de los cuales ${cleared} quedaron vacíos por phone irrecuperable)`);
console.log("Primeros cambios:");
for (const s of samples) console.log(JSON.stringify(s));

if (!dryRun && touched > 0) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = `${dataPath}.bak-pre-norm-${ts}`;
  fs.writeFileSync(backup, raw);
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
  console.log(`Backup escrito: ${backup}`);
  console.log(`setters.json actualizado.`);
} else if (dryRun) {
  console.log("[dry-run] no se escribió nada.");
}

// index.js puede haber dejado el server escuchando aunque seteemos NODE_ENV=test
// (depende del orden de ejecución de los imports ESM). Forzar salida.
process.exit(0);

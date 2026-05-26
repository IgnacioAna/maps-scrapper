#!/usr/bin/env node
/**
 * One-shot 2026-05-25 — Crear setter "Ignacio" para que el admin tenga su
 * propio pipeline de setteo. Link user admin → setterId. Reasignar los 3
 * leads test (Ignacio x2 + tiago) a este setter nuevo.
 *
 * Resultado:
 *  - data.setters[] gana un record { id: 'setter_ignacio', name: 'Ignacio' }
 *  - auth.users[admin].setterId = 'setter_ignacio'
 *  - Los 3 leads test se reasignan a setter_ignacio
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, "..", "data");
const RAILWAY_URL = "https://scm-setting.up.railway.app";
const EMAIL = "ignacio.scmdental@gmail.com";
const PASS = "Ignacio2026!";

const SETTER_ID = "setter_ignacio";
const SETTER_NAME = "Ignacio";

const setters = JSON.parse(fs.readFileSync(path.join(DATA, "setters.json"), "utf8"));
const auth = JSON.parse(fs.readFileSync(path.join(DATA, "auth.json"), "utf8"));

// 1. Crear setter si no existe
if (!(setters.setters || []).find((s) => s.id === SETTER_ID)) {
  setters.setters = setters.setters || [];
  setters.setters.push({
    id: SETTER_ID,
    name: SETTER_NAME,
    createdAt: new Date().toISOString(),
  });
  console.log(`[FASE 1] Setter ${SETTER_ID} creado.`);
} else {
  console.log(`[FASE 1] Setter ${SETTER_ID} ya existe.`);
}

// 2. Linkear admin user
const adminUser = (auth.users || []).find((u) => u.role === "admin" && /ignacio/i.test(u.email || ""));
if (!adminUser) { console.error("Admin no encontrado en auth.json"); process.exit(1); }
const beforeSetterId = adminUser.setterId;
adminUser.setterId = SETTER_ID;
adminUser.updatedAt = new Date().toISOString();
console.log(`[FASE 2] Admin ${adminUser.email} setterId: '${beforeSetterId || "(vacio)"}' → '${SETTER_ID}'`);

// 3. Reasignar los 3 leads test
let reassigned = 0;
const testNames = ["ignacio", "tiago", "thiago"];
for (const [id, lead] of Object.entries(setters.leads || {})) {
  const n = String(lead.name || "").toLowerCase().trim();
  // Match exacto del nombre (case-insensitive) para evitar matches como "Santiago"
  if (testNames.includes(n)) {
    setters.leads[id] = { ...lead, assignedTo: SETTER_ID };
    reassigned++;
    console.log(`  reassign → "${lead.name}" (${lead.phone}) de ${lead.assignedTo} → ${SETTER_ID}`);
  }
}
console.log(`[FASE 3] Leads test reasignados: ${reassigned}`);

// 4. Upload via /api/admin/import-data
const login = await fetch(`${RAILWAY_URL}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASS }),
});
if (!login.ok) { console.error("Login falló:", await login.text()); process.exit(1); }
const setCookie = login.headers.getSetCookie?.() || login.headers.raw?.()?.["set-cookie"] || [];
const cookie = (Array.isArray(setCookie) ? setCookie : [setCookie]).map((c) => c.split(";")[0]).join("; ");
console.log("[UPLOAD] Login OK. Subiendo setters + auth...");

const up = await fetch(`${RAILWAY_URL}/api/admin/import-data`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: cookie },
  body: JSON.stringify({ setters, auth }),
});
const body = await up.text();
console.log("[UPLOAD]", up.status, body);
if (!up.ok) process.exit(1);

// Guardar local
fs.writeFileSync(path.join(DATA, "setters.json"), JSON.stringify(setters, null, 2));
fs.writeFileSync(path.join(DATA, "auth.json"), JSON.stringify(auth, null, 2));
console.log("\nLISTO. Hacé logout/login del admin para que la nueva setterId tome efecto en tu sesión.");

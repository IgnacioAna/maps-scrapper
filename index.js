import dotenv from "dotenv";
import { getJson } from "serpapi";
import path from "path";
import fs from "fs";
import express from "express";
import OpenAI from "openai";
import crypto from "crypto";
import { mountWa } from "./src/wa/index.js";

dotenv.config();
const apiKey = process.env.API_KEY;

const app = express();
const PORT = process.env.PORT || 3000;

// Configurar IA para enriquecimiento: Mercury (Inception Labs) si hay API key, sino Qwen como fallback
const mercuryKey = process.env.MERCURY_API_KEY;
const qwenKey = process.env.QWEN_API_KEY;
const ai = mercuryKey
  ? new OpenAI({
      apiKey: mercuryKey,
      baseURL: "https://api.inceptionlabs.ai/v1"
    })
  : new OpenAI({
      apiKey: qwenKey || "missing_key",
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "GoogleScraper"
      }
    });
const AI_MODEL = mercuryKey ? 'mercury-2' : 'qwen/qwen3-14b:free';
console.log(`🤖 IA configurada: ${mercuryKey ? 'Mercury 2 (Inception Labs)' : 'Qwen (OpenRouter)'}`);


// Middleware
app.use(express.json({ limit: '50mb' }));

// Liveness probe público para Railway / monitoreo externo (light, sin auth, sin tocar disco).
app.get('/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));
app.get('/api/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// ── Rate limiting in-memory (simple sliding window) ──
// Sin Redis: para single-instance es suficiente. Map por key con timestamps.
const rateLimitStore = new Map();
function rateLimit({ windowMs, max, keyFn }) {
  return (req, res, next) => {
    const key = keyFn(req);
    if (!key) return next();
    const now = Date.now();
    const arr = (rateLimitStore.get(key) || []).filter(t => now - t < windowMs);
    if (arr.length >= max) {
      const retryAfter = Math.ceil((windowMs - (now - arr[0])) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: `Demasiados intentos. Probá en ${retryAfter}s.`, retryAfter });
    }
    arr.push(now);
    rateLimitStore.set(key, arr);
    next();
  };
}
if (process.env.NODE_ENV !== 'test') {
  setInterval(() => {
    const now = Date.now();
    for (const [k, arr] of rateLimitStore.entries()) {
      const fresh = arr.filter(t => now - t < 60 * 60 * 1000);
      if (fresh.length === 0) rateLimitStore.delete(k);
      else rateLimitStore.set(k, fresh);
    }
  }, 10 * 60 * 1000);
}
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 1000 : 5,
  keyFn: (req) => 'login:' + ((req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString().split(',')[0].trim())
});
const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 1000 : 30,
  keyFn: (req) => 'ai:' + (req.auth?.user?.id || ((req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString().split(',')[0].trim()))
});
// Rate limiter para endpoints que queman creditos externos (SerpAPI, Apify).
// Pegar al boton "Scrape" 50 veces seguidas no debe vaciar la billetera.
const scrapeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 1000 : 5,
  keyFn: (req) => 'scrape:' + (req.auth?.user?.id || ((req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString().split(',')[0].trim()))
});
const enrichLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 1000 : 30,
  keyFn: (req) => 'enrich:' + (req.auth?.user?.id || ((req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString().split(',')[0].trim()))
});

// AUTH_FILE se define después de DATA_DIR para usar el volume si está montado
let AUTH_FILE = path.join(process.cwd(), "data", "auth.json");
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

function ensureDataDir() {
  const dir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function createPasswordRecord(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, record) {
  if (!record || !record.salt || !record.hash) return false;
  const candidateHex = createPasswordRecord(password, record.salt).hash;
  const candidateBuf = Buffer.from(candidateHex, "hex");
  const storedBuf = Buffer.from(record.hash, "hex");
  if (candidateBuf.length !== storedBuf.length) return false;
  return crypto.timingSafeEqual(candidateBuf, storedBuf);
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    setterId: user.setterId || "",
    createdAt: user.createdAt,
    updatedAt: user.updatedAt || user.createdAt
  };
}

function defaultAuthData() {
  return {
    users: [],
    invites: [],
    sessions: []
  };
}

function loadAuthData() {
  try {
    ensureDataDir();
    if (fs.existsSync(AUTH_FILE)) {
      const raw = JSON.parse(fs.readFileSync(AUTH_FILE, "utf8"));
      if (!Array.isArray(raw.users)) raw.users = [];
      if (!Array.isArray(raw.invites)) raw.invites = [];
      if (!Array.isArray(raw.sessions)) raw.sessions = [];
      // NOTA: la purga de sesiones expiradas se hace en setInterval (ver
      // gcExpiredSessions abajo), NO en cada request. Antes esto corria en
      // CADA llamada autenticada — escribia auth.json cuando una sesion
      // expiraba, racing contra otros writes y bloqueando el hot path.
      return raw;
    }
  } catch (e) {
    console.error("Error leyendo auth data:", e);
  }
  return defaultAuthData();
}

// Purga periódica de sesiones expiradas. Corre cada 10 minutos en background,
// fuera del request handler. Owner unico => no race.
function gcExpiredSessions() {
  try {
    if (!fs.existsSync(AUTH_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(AUTH_FILE, "utf8"));
    if (!Array.isArray(raw.sessions)) return;
    const now = Date.now();
    const before = raw.sessions.length;
    raw.sessions = raw.sessions.filter((s) => !s.expiresAt || new Date(s.expiresAt).getTime() > now);
    if (raw.sessions.length < before) {
      saveAuthData(raw);
      console.log(`[gcExpiredSessions] purgadas ${before - raw.sessions.length} sesiones expiradas`);
    }
  } catch (e) {
    console.warn("[gcExpiredSessions] error:", e.message);
  }
}
if (process.env.NODE_ENV !== 'test') {
  setInterval(gcExpiredSessions, 10 * 60 * 1000); // cada 10 min
}

function saveAuthData(data) {
  try {
    ensureDataDir();
    fs.writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch (e) {
    console.error("Error guardando auth data:", e);
  }
}

function ensureAuthSeeds() {
  const data = loadAuthData();
  const now = new Date().toISOString();

  // Solo crear admin si no existe ningún usuario admin
  const hasAdmin = data.users.some((u) => u.role === "admin" && u.status === "active");
  if (!hasAdmin) {
    const adminPwd = process.env.ADMIN_PASSWORD;
    if (!adminPwd) {
      console.error("⚠️ ADMIN_PASSWORD no configurada en .env — No se puede crear el usuario admin.");
      console.error("   Agregá ADMIN_PASSWORD=tu_contraseña en las variables de entorno.");
    } else {
      data.users.push({
        id: "user_admin_ignacio",
        email: process.env.ADMIN_EMAIL || "ignacio.scmdental@gmail.com",
        name: process.env.ADMIN_NAME || "Ignacio",
        role: "admin",
        status: "active",
        setterId: "",
        password: createPasswordRecord(adminPwd),
        createdAt: now,
        updatedAt: now
      });
      console.log("✅ Usuario admin creado. Los setters se agregan desde el panel con invitaciones.");
    }
  }

  if (!data.invites) data.invites = [];
  if (!data.sessions) data.sessions = [];
  saveAuthData(data);
}

function parseCookies(cookieHeader = "") {
  return cookieHeader.split(";").reduce((acc, part) => {
    const [rawKey, ...rest] = part.split("=");
    if (!rawKey) return acc;
    const key = rawKey.trim();
    if (!key) return acc;
    acc[key] = decodeURIComponent(rest.join("=").trim());
    return acc;
  }, {});
}

function getSessionFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  const sessionId = cookies.gs_session;
  if (!sessionId) return null;

  const data = loadAuthData();
  const now = Date.now();
  const session = data.sessions.find((s) => s.id === sessionId && (!s.expiresAt || new Date(s.expiresAt).getTime() > now));
  if (!session) return null;

  const user = data.users.find((u) => u.id === session.userId && u.status === "active");
  if (!user) return null;

  return { session, user };
}

// Mapa en memoria: userId → { lastSeen, ip, userAgent, name, email, role }
const onlinePresence = new Map();

function attachAuth(req, _res, next) {
  req.auth = getSessionFromRequest(req);
  if (req.auth?.user) {
    const u = req.auth.user;
    const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString().split(',')[0].trim();
    onlinePresence.set(u.id, {
      userId: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      lastSeen: Date.now(),
      ip,
      userAgent: (req.headers['user-agent'] || '').slice(0, 200)
    });
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.auth?.user) return res.status(401).json({ error: "No autenticado." });
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.auth?.user) return res.status(401).json({ error: "No autenticado." });
    if (!roles.includes(req.auth.user.role)) return res.status(403).json({ error: "No autorizado." });
    next();
  };
}

function ensureSetterProfile(name) {
  const settersData = loadSettersData();
  const setterName = name.trim();
  const setterId = `setter_${setterName.toLowerCase().replace(/\s+/g, '_')}`;
  if (!settersData.setters.find((s) => s.id === setterId || s.name.toLowerCase() === setterName.toLowerCase())) {
    settersData.setters.push({ id: setterId, name: setterName, activeVariantId: "", createdAt: new Date().toISOString() });
    saveSettersData(settersData);
  }
  return setterId;
}

function parseLocationParts(location = "") {
  const raw = String(location || "").trim();
  if (!raw) return { country: "", city: "" };
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return { city: parts[0], country: parts.slice(1).join(', ') };
  }
  return { country: raw, city: "" };
}

function ensureLeadDefaults(lead = {}) {
  if (!lead.followUps) lead.followUps = { '24hs': false, '48hs': false, '72hs': false, '7d': false, '15d': false };
  if (!Array.isArray(lead.notes)) lead.notes = [];
  if (!Array.isArray(lead.interactions)) lead.interactions = [];
  if (!lead.country) lead.country = '';
  if (!lead.city) lead.city = '';
  if (!lead.whatsappUrl) lead.whatsappUrl = '';
  if (!lead.lastStage) lead.lastStage = '';
  if (!lead.lastVariantId) lead.lastVariantId = '';
  if (lead.calificado === undefined) lead.calificado = false;
  // Llamadas: clasificación automática y log
  if (!lead.wspProbability) lead.wspProbability = computeWspProbability(lead);
  if (!lead.phoneStatus) lead.phoneStatus = '';   // '', 'wrong', 'invalid', 'voicemail'
  if (!Array.isArray(lead.callLog)) lead.callLog = [];
  if (typeof lead.callAttempts !== 'number') lead.callAttempts = 0;
  if (!lead.callbackAt) lead.callbackAt = '';      // ISO datetime para "Volver a llamar después"
  return lead;
}

// Clasifica si el lead es candidato a WhatsApp o sólo a llamada,
// usando los campos que YA salen del enrichment (regex + IA).
function computeWspProbability(lead = {}) {
  const hasWaWeb = !!(lead.webWhatsApp && String(lead.webWhatsApp).trim());
  const hasWaAi = !!(lead.aiWhatsApp && String(lead.aiWhatsApp).trim());
  if (hasWaWeb || hasWaAi) return 'high';
  const hasPhone = !!(lead.phone && String(lead.phone).replace(/\D/g, '').length >= 7);
  if (hasPhone) return 'low'; // teléfono pero ninguna señal de WSP → llamada
  return 'unknown';
}

function normalizeBlockRecord(block = {}, index = 0) {
  const rawLabel = String(block.label || block.name || '').trim();
  return {
    id: block.id || `block_${Date.now()}_${index}`,
    label: rawLabel || `Bloque ${index + 1}`,
    text: String(block.text || block.message || '').trim(),
    order: Number.isFinite(Number(block.order)) ? Number(block.order) : index,
    usedCount: Number.isFinite(Number(block.usedCount)) ? Number(block.usedCount) : 0,
    interestedCount: Number.isFinite(Number(block.interestedCount)) ? Number(block.interestedCount) : 0,
    createdAt: block.createdAt || new Date().toISOString()
  };
}

function variantBlocksFromMessages(messages = {}) {
  return [
    { label: 'Apertura', text: messages.apertura || '' },
    { label: 'Problema', text: messages.problema || '' },
    { label: 'Prueba social', text: messages.pruebaSocial || '' },
    { label: 'Cierre', text: messages.cierrePregunta || '' }
  ].map((block, index) => normalizeBlockRecord(block, index)).filter((block) => block.text);
}

function normalizeVariantRecord(variant = {}) {
  const blocks = Array.isArray(variant.blocks) && variant.blocks.length > 0
    ? variant.blocks.map((block, index) => normalizeBlockRecord(block, index)).filter((block) => block.text)
    : variantBlocksFromMessages(variant.messages || {});

  const messages = blocks.length > 0 ? {
    apertura: blocks[0]?.text || '',
    problema: blocks[1]?.text || '',
    pruebaSocial: blocks[2]?.text || '',
    cierrePregunta: blocks[3]?.text || ''
  } : {
    apertura: variant.messages?.apertura || '',
    problema: variant.messages?.problema || '',
    pruebaSocial: variant.messages?.pruebaSocial || '',
    cierrePregunta: variant.messages?.cierrePregunta || ''
  };

  return {
    id: variant.id || `var_${Date.now()}`,
    name: String(variant.name || 'Variable').trim(),
    weekLabel: String(variant.weekLabel || '').trim(),
    active: variant.active !== false,
    setterId: String(variant.setterId || variant.ownerSetterId || '').trim(),
    sharedWith: Array.isArray(variant.sharedWith) ? variant.sharedWith.filter(Boolean).map(String) : [],
    usedCount: Number.isFinite(Number(variant.usedCount)) ? Number(variant.usedCount) : 0,
    blocks,
    messages,
    createdAt: variant.createdAt || new Date().toISOString(),
    updatedAt: variant.updatedAt || variant.createdAt || new Date().toISOString()
  };
}

function incrementVariantUsage(data, variantId) {
  if (!variantId) return;
  const variant = data.variants.find((v) => v.id === variantId);
  if (variant) variant.usedCount = (Number(variant.usedCount) || 0) + 1;
}

function variantStageMessage(variant, stage = 'apertura', lead = {}) {
  const blocks = Array.isArray(variant?.blocks) ? variant.blocks : [];
  const fallback = {
    apertura: blocks[0]?.text || variant?.messages?.apertura || '',
    problema: blocks[1]?.text || variant?.messages?.problema || '',
    pruebaSocial: blocks[2]?.text || variant?.messages?.pruebaSocial || '',
    cierrePregunta: blocks[3]?.text || variant?.messages?.cierrePregunta || ''
  };
  const stageText = fallback[stage] || fallback.apertura || '';
  const openerBank = [
    'Buenas tardes, ¿cómo están?',
    'Hola, buen día. ¿Cómo viene la semana?',
    'Buenas, ¿cómo vienen hoy?',
    'Hola, espero que estén muy bien.',
    'Buen día, ¿cómo arrancaron la jornada?'
  ];
  const text = String(stageText || '').trim() || openerBank[Math.floor(Math.random() * openerBank.length)];
  return text.replace(/\{\{nombre\}\}/g, lead.name || '').replace(/\{\{name\}\}/g, lead.name || '').trim();
}

const OPENING_BANK = [...new Set([
  'Buenas, muy ajetreada la jornada hoy',
  'Qué tal, mucho por resolver hoy',
  'Hola, cómo va el trabajo por la clínica?',
  'Buenos días, bastante cargados hoy',
  'Buen día, todo muy activo hoy',
  'Buenas, cómo está yendo la jornada?',
  'Hola, muy activa la semana',
  'Qué tal, con los turnos muy cargados',
  'Buenos días, mucho movimiento hoy',
  'Buen día, cómo están esta semana?',
  'Hola, jornada muy ocupada la de hoy',
  'Buenas, todo con mucho ritmo hoy',
  'Qué tal, bastante actividad en la clínica',
  'Hola, mucho trabajo hoy en la clínica',
  'Buenos días, la jornada muy activa',
  'Buen día, muy cargada la semana',
  'Buenas, cómo andan de trabajo hoy?',
  'Hola, jornada muy larga la de hoy',
  'Qué tal, la clínica muy movida hoy',
  'Buenos días, con mucha demanda esta semana',
  'Buen día, todo en movimiento hoy',
  'Hola, cómo va todo esta semana?',
  'Buenas, jornada muy activa hoy',
  'Qué tal, mucho trabajo en la clínica hoy',
  'Hola, bastante ocupados hoy',
  'Buenos días, muchos turnos hoy',
  'Buen día, cómo viene el trabajo hoy?',
  'Buenas, muy cargados de trabajo',
  'Hola, la semana muy ocupada',
  'Qué tal, cómo van con los pacientes?',
  'Buenos días, día muy cargado el de hoy',
  'Hola, una consulta',
  'Hola, todo con mucho movimiento hoy',
  'Buenas, la semana muy movida',
  'Qué tal, cómo está yendo la clínica?',
  'Hola, con mucho trabajo hoy',
  'Buenas, cómo va el día a día por la clínica',
  'Hola, qué tal todo esta semana',
  'Buen día, cómo arrancaron el mes',
  'Hola, a tope o con respiro esta semana',
  'Buenas, cómo va todo el equipo hoy',
  'Hola, sin parar o algo más tranquilo hoy',
  'Buen día, espero que estén bien',
  'Hola, cómo va la semana para la clínica',
  'Buen día, como terminaron la semana',
  'Hola, todo tranquilo por ahí',
  'Buenas, como la llevan',
  'Buenas, mucho lío hoy',
  'Buen día, como está todo por ahí',
  'Hola, como los trata la semana',
  'Hola, como va todo por la clínica',
  'Hola, qué jornada',
  'Hola, como vienen con los turnos',
  'Buenas, como avanza eso',
  'Buen día, cómo andan de trabajo',
  'Buen día, arrancaron con todo',
  'Hola, a full hoy con todo',
  'Buen día, como les está yendo',
  'Hola, todo súper por allá',
  'Hola, jornada movida hoy',
  'Hola, como va el día',
  'Buenas, día movidito',
  'Buenas, todo bien',
  'Buenas, mucho movimiento por ahí',
  'Buenas, como viene la mano',
  'Hola, todo viento en popa',
  'Hola, muchos pacientes hoy',
  'Hola, como andan',
  'Hola equipo, buen día',
  'Buen día, como están las cosas',
  'Buenas, todo bien en la oficina',
  'Hola, como arrancaron la semana',
  'Buen día, como va el trabajo',
  'Hola, como sigue la jornada',
  'Buenas, como anda todo',
  'Hola, con mucha demanda hoy',
  'Buen día, como los está tratando el mes',
  'Hola, como lo llevan',
  'Buen día, como van con el mes',
  'Hola, como van con los pacientes',
  'Buenas, como andamos',
  'Buen día, todo al cien',
  'Hola, mucho trabajo por suerte'
])];

function makeOpeningMessage(context = {}) {
  const bank = OPENING_BANK;
  const base = bank[Math.floor(Math.random() * bank.length)] || 'Hola, buen día';
  const country = String(context.country || '').trim();
  const city = String(context.city || '').trim();
  if (!country && !city) return base;
  const place = city || country;
  const softened = base.replace(/hoy/gi, place ? `hoy por ${place}` : 'hoy');
  return softened.replace(/\s+/g, ' ').trim();
}

function makeWhatsAppMessage(variant, stage, lead = {}) {
  const text = variantStageMessage(variant, stage, lead);
  return text || 'Buenas, ¿cómo están?';
}

// Lista de prefijos internacionales conocidos, ordenados por longitud DESC para
// matchear primero los más específicos (598 antes que 5, 593 antes que 5, etc.).
// Sirve para detectar si los dígitos crudos ya traen un código de país sin "+".
const KNOWN_INTL_PREFIXES = [
  '598', '593', '595', '591', '506', '507',
  '54', '56', '57', '52', '51', '58', '34', '55',
  '44', '49', '33', '39', '61', '64', '81', '82', '86', '91',
  '1'
];

function digitsHaveKnownPrefix(digits) {
  if (!digits) return false;
  for (const p of KNOWN_INTL_PREFIXES) {
    if (digits.startsWith(p) && digits.length >= p.length + 8 && digits.length <= p.length + 12) {
      return true;
    }
  }
  return false;
}

// Largo esperado del NÚMERO LOCAL (sin código de país) para móviles WhatsApp.
// Solo países donde el largo móvil es estricto. AR (54) y MX (52) NO están porque
// tienen prefijos móvil 9/1 opcionales que confunden el cálculo.
const COUNTRY_LOCAL_MOBILE_LENGTH = {
  '57': 10,   // Colombia: 3XX XXX XXXX
  '56': 9,    // Chile:    9 XXXX XXXX
  '51': 9,    // Perú:     9XX XXX XXX
  '34': 9,    // España:   6XX XXX XXX / 7XX XXX XXX
  '598': 8,   // Uruguay:  9X XXX XXX
  '593': 9,   // Ecuador:  9X XXX XXXX
  '595': 9,   // Paraguay: 9XX XXX XXX
  '591': 8,   // Bolivia:  7X XXX XXX
  '506': 8,   // Costa Rica
  '507': 8,   // Panamá
  '58': 10    // Venezuela: 4XX XXX XXXX
};

// Saca dígitos sobrantes que vienen ENTRE el código de país y el local.
// Caso típico: Colombia con "+57 1 3XX..." donde el "1" es código de Bogotá
// (fijo) y se cuela en el celular. WhatsApp no lo entiende.
// Si el local supera el largo esperado por exactamente 1 dígito y empieza con
// "1", asumimos que ese "1" es ruido y lo eliminamos.
function _stripExtraIntermediateDigits(digits, prefix) {
  if (!prefix || !COUNTRY_LOCAL_MOBILE_LENGTH[prefix]) return digits;
  const expected = COUNTRY_LOCAL_MOBILE_LENGTH[prefix];
  const local = digits.substring(prefix.length);
  if (local.length === expected + 1 && local.startsWith('1')) {
    return prefix + local.substring(1);
  }
  return digits;
}

// Si los dígitos no tienen prefijo de país explícito (caso country=''), intentamos
// detectar el prefijo internacional automáticamente y aplicar el strip.
function _autoDetectAndStrip(digits) {
  for (const p of Object.keys(COUNTRY_LOCAL_MOBILE_LENGTH).sort((a, b) => b.length - a.length)) {
    if (digits.startsWith(p)) {
      return _stripExtraIntermediateDigits(digits, p);
    }
  }
  return digits;
}

function buildWhatsAppUrl(phone, country, message = '') {
  if (!phone) return '';
  let digits = String(phone).replace(/\D/g, '');
  if (!digits) return '';

  // Normalizar país: sin acentos, lowercase, y aliases (CO, MX, etc.)
  const normalize = (s) => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const countryAliases = {
    argentina: '54', ar: '54',
    chile: '56', cl: '56',
    uruguay: '598', uy: '598',
    colombia: '57', co: '57',
    mexico: '52', mx: '52',
    peru: '51', pe: '51',
    ecuador: '593', ec: '593',
    paraguay: '595', py: '595',
    bolivia: '591', bo: '591',
    venezuela: '58', ve: '58',
    'costa rica': '506', cr: '506',
    panama: '507', pa: '507',
    'republica dominicana': '1', do: '1',
    espana: '34', spain: '34', es: '34',
    'estados unidos': '1', 'united states': '1', us: '1', usa: '1',
    brasil: '55', brazil: '55', br: '55'
  };
  const normalizedCountry = normalize(country);
  const prefix = countryAliases[normalizedCountry] || '';

  // Si ya viene con "+" internacional, respetar (intentando sanear con auto-detect)
  if (phone.trim().startsWith('+')) {
    const cleaned = _autoDetectAndStrip(digits);
    return `https://wa.me/${cleaned}${message ? `?text=${encodeURIComponent(message)}` : ''}`;
  }
  // Si los dígitos ya empiezan con el prefijo del país, no duplicar
  if (prefix && digits.startsWith(prefix) && digits.length >= prefix.length + 8) {
    const cleaned = _stripExtraIntermediateDigits(digits, prefix);
    return `https://wa.me/${cleaned}${message ? `?text=${encodeURIComponent(message)}` : ''}`;
  }
  if (digits.startsWith('0')) digits = digits.substring(1);
  if (prefix === '54' && !digits.startsWith('9') && digits.length >= 10) digits = `9${digits}`;

  // Si no hay prefijo conocido, NO inventar +1. Intentar detectar por longitud
  // o devolver tal cual con los dígitos raw (wa.me acepta sin +).
  if (!prefix) {
    // Si los dígitos ya tienen CUALQUIER prefijo internacional conocido
    // (lead sin country o country mal cargado), usar tal cual. Evita el bug
    // histórico de prefijar con `1` un número que ya traía 34/54/52/etc.
    if (digitsHaveKnownPrefix(digits)) {
      const cleaned = _autoDetectAndStrip(digits);
      return `https://wa.me/${cleaned}${message ? `?text=${encodeURIComponent(message)}` : ''}`;
    }
    // Dígitos largos (>=11) probablemente ya incluyen código de país
    if (digits.length >= 11) {
      return `https://wa.me/${digits}${message ? `?text=${encodeURIComponent(message)}` : ''}`;
    }
    // Si son cortos y no tenemos país, no podemos armar un link confiable
    return '';
  }
  return `https://wa.me/${prefix}${digits}${message ? `?text=${encodeURIComponent(message)}` : ''}`;
}

function stageLabel(stage = '') {
  return ({
    apertura: 'Apertura',
    problema: 'Calificación 1',
    pruebaSocial: 'Calificación 2',
    cierrePregunta: 'Cierre'
  })[stage] || stage;
}

ensureAuthSeeds();
app.use('/api', attachAuth);
app.use('/api/setters', requireAuth);

function setAuthCookie(res, sessionId) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  res.setHeader('Set-Cookie', `gs_session=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`);
}

function clearAuthCookie(res) {
  res.setHeader('Set-Cookie', 'gs_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

app.get('/api/auth/me', (req, res) => {
  if (!req.auth?.user) return res.json({ authenticated: false });
  res.json({ authenticated: true, user: publicUser(req.auth.user) });
});

// Quién está conectado (solo admin)
app.get('/api/auth/online', requireRole('admin'), (req, res) => {
  const now = Date.now();
  const ONLINE_THRESHOLD = 2 * 60 * 1000; // 2 min
  const RECENT_THRESHOLD = 30 * 60 * 1000; // 30 min

  const data = loadAuthData();
  const allUsers = data.users.filter(u => u.status === 'active').map(u => {
    const presence = onlinePresence.get(u.id);
    const age = presence ? now - presence.lastSeen : Infinity;
    let status = 'offline';
    if (age < ONLINE_THRESHOLD) status = 'online';
    else if (age < RECENT_THRESHOLD) status = 'recent';
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      status,
      lastSeen: presence?.lastSeen || null,
      ip: presence?.ip || null,
      userAgent: presence?.userAgent || null
    };
  });
  // Ordenar: online > recent > offline; dentro de cada grupo, lastSeen desc
  allUsers.sort((a, b) => {
    const order = { online: 0, recent: 1, offline: 2 };
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    return (b.lastSeen || 0) - (a.lastSeen || 0);
  });
  res.json({ users: allUsers, generatedAt: now });
});

app.post('/api/auth/login', loginLimiter, (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos.' });

  const data = loadAuthData();
  const user = data.users.find((u) => u.email.toLowerCase() === String(email).toLowerCase().trim() && u.status === 'active');
  if (!user || !verifyPassword(password, user.password)) {
    return res.status(401).json({ error: 'Credenciales inválidas.' });
  }

  const session = {
    id: `sess_${crypto.randomUUID().replace(/-/g, '')}`,
    userId: user.id,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString()
  };
  data.sessions.push(session);
  saveAuthData(data);
  setAuthCookie(res, session.id);
  res.json({ user: publicUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  const cookies = parseCookies(req.headers.cookie || '');
  const sessionId = cookies.gs_session;
  if (sessionId) {
    const data = loadAuthData();
    data.sessions = data.sessions.filter((s) => s.id !== sessionId);
    saveAuthData(data);
  }
  clearAuthCookie(res);
  res.json({ ok: true });
});

app.get('/api/auth/users', requireAuth, requireRole('admin'), (req, res) => {
  const data = loadAuthData();
  res.json({ users: data.users.map(publicUser), invites: data.invites });
});

app.get('/api/auth/invites/:token', (req, res) => {
  const data = loadAuthData();
  const invite = data.invites.find((item) => item.token === req.params.token && item.status === 'pending');
  if (!invite) return res.status(404).json({ error: 'Invitación no encontrada.' });
  res.json({ invite: { id: invite.id, name: invite.name, email: invite.email, role: invite.role, setterId: invite.setterId || '' } });
});

async function sendInviteEmail(toEmail, toName, role, inviteUrl) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return { sent: false, reason: 'RESEND_API_KEY no configurada' };
  const fromEmail = process.env.INVITE_FROM_EMAIL || 'SCM Dental Setting App <onboarding@resend.dev>';
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: fromEmail,
        to: [toEmail],
        subject: `${toName}, te invitaron a SCM Dental Setting App`,
        html: `
          <div style="font-family:sans-serif; max-width:480px; margin:0 auto; padding:24px;">
            <h2 style="color:#1e1f20;">Hola ${toName}!</h2>
            <p>Te invitaron a unirte a <strong>SCM Dental Setting App</strong> como <strong>${role}</strong>.</p>
            <p>Hacé clic en el botón para crear tu contraseña y acceder:</p>
            <a href="${inviteUrl}" style="display:inline-block; background:#a8c7fa; color:#131314; padding:12px 24px; border-radius:100px; text-decoration:none; font-weight:600; margin:16px 0;">Crear mi acceso</a>
            <p style="color:#666; font-size:13px; margin-top:24px;">Si el botón no funciona, copiá este link:<br><a href="${inviteUrl}">${inviteUrl}</a></p>
          </div>`
      })
    });
    if (resp.ok) return { sent: true };
    const err = await resp.json();
    return { sent: false, reason: err.message || 'Error de Resend' };
  } catch (e) {
    return { sent: false, reason: e.message };
  }
}

// ── Reporte semanal automático (Resend) ──
// DATA_DIR se inicializa más abajo en el archivo; usamos lazy resolve.
function getReportsFile() {
  const dir = (typeof DATA_DIR !== 'undefined' && DATA_DIR) || (process.env.DATA_DIR || (fs.existsSync('/data') ? '/data' : path.join(process.cwd(), 'data')));
  return path.join(dir, 'reports.json');
}
function loadReportsState() {
  try { const f = getReportsFile(); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {}; }
  catch { return {}; }
}
function saveReportsState(state) {
  try { fs.writeFileSync(getReportsFile(), JSON.stringify(state, null, 2)); } catch (e) { console.warn('No pude guardar reports state:', e.message); }
}

function buildWeeklyReportData() {
  const settersData = loadSettersData();
  const allLeads = Object.values(settersData.leads || {});
  const calendar = settersData.calendar || [];
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayOfWeek = today.getDay() || 7;
  const thisMonday = new Date(today.getTime() - (dayOfWeek - 1) * 24 * 60 * 60 * 1000);
  const lastMonday = new Date(thisMonday.getTime() - 7 * 24 * 60 * 60 * 1000);
  const lastSunday = new Date(thisMonday.getTime() - 1);
  const fromTs = lastMonday.getTime();
  const toTs = thisMonday.getTime();
  const conexionesNew = allLeads.filter(l => {
    const t = l.lastContactAt ? new Date(l.lastContactAt).getTime() : 0;
    return l.conexion === 'enviada' && t >= fromTs && t < toTs;
  }).length;
  let callsWeek = 0, callsAnsweredWeek = 0, callsScheduledWeek = 0, callsDeadWeek = 0;
  for (const l of allLeads) {
    if (Array.isArray(l.callLog)) {
      for (const c of l.callLog) {
        const t = c.ts ? new Date(c.ts).getTime() : 0;
        if (t >= fromTs && t < toTs) {
          callsWeek++;
          if (['answered_interested', 'answered_not_interested', 'scheduled_with_admin'].includes(c.outcome)) callsAnsweredWeek++;
          if (c.outcome === 'scheduled_with_admin') callsScheduledWeek++;
          if (['wrong_number', 'invalid_number'].includes(c.outcome)) callsDeadWeek++;
        }
      }
    }
  }
  const calRealized = calendar.filter(e => { const t = e.fecha ? new Date(e.fecha).getTime() : 0; return e.calendarioEstado === 'realizada' && t >= fromTs && t < toTs; }).length;
  const calNoShow = calendar.filter(e => { const t = e.fecha ? new Date(e.fecha).getTime() : 0; return e.calendarioEstado === 'no_show' && t >= fromTs && t < toTs; }).length;
  const calPendingNow = calendar.filter(e => e.calendarioEstado === 'pendiente').length;
  const calOverdueNow = calendar.filter(e => e.calendarioEstado === 'pendiente' && e.fecha && new Date(e.fecha).getTime() < Date.now()).length;
  const perSetter = (settersData.setters || []).map(s => {
    const myLeads = allLeads.filter(l => l.assignedTo === s.id);
    const conexionesSetter = myLeads.filter(l => { const t = l.lastContactAt ? new Date(l.lastContactAt).getTime() : 0; return l.conexion === 'enviada' && t >= fromTs && t < toTs; }).length;
    let llamadas = 0, agendadosLlamada = 0;
    for (const l of myLeads) {
      if (Array.isArray(l.callLog)) {
        for (const c of l.callLog) {
          const t = c.ts ? new Date(c.ts).getTime() : 0;
          if (t >= fromTs && t < toTs) {
            llamadas++;
            if (c.outcome === 'scheduled_with_admin') agendadosLlamada++;
          }
        }
      }
    }
    return { name: s.name, leadsAsignados: myLeads.length, conexiones: conexionesSetter, llamadas, agendadosLlamada };
  }).filter(s => s.conexiones > 0 || s.llamadas > 0);
  return {
    period: { from: lastMonday.toISOString().substring(0, 10), to: lastSunday.toISOString().substring(0, 10) },
    wsp: { conexionesNew, respondieronTotal: allLeads.filter(l => l.respondio).length, interesadosTotal: allLeads.filter(l => l.interes === 'si').length, agendadosTotal: allLeads.filter(l => l.estado === 'agendado').length },
    calls: { totalWeek: callsWeek, answeredWeek: callsAnsweredWeek, scheduledWeek: callsScheduledWeek, deadWeek: callsDeadWeek, pctAtendidas: callsWeek > 0 ? ((callsAnsweredWeek / callsWeek) * 100).toFixed(1) : '0.0' },
    calendar: { realized: calRealized, noShow: calNoShow, pendingNow: calPendingNow, overdueNow: calOverdueNow },
    perSetter,
    leadsTotal: allLeads.length
  };
}

function buildWeeklyReportHtml(data) {
  const { period, wsp, calls, calendar: cal, perSetter, leadsTotal } = data;
  const card = (label, value, color = '#9D85F2') => `<div style="background:#161922;border:1px solid #262B3B;border-radius:10px;padding:14px 16px;flex:1;min-width:140px;"><div style="font-size:11px;color:#7E8494;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;margin-bottom:4px;">${label}</div><div style="font-size:22px;color:${color};font-weight:700;">${value}</div></div>`;
  const rowsSetter = perSetter.map(s => `<tr style="border-bottom:1px solid #262B3B;"><td style="padding:8px 12px;color:#E5E7E2;font-weight:600;">${s.name}</td><td style="padding:8px 12px;">${s.leadsAsignados}</td><td style="padding:8px 12px;">${s.conexiones}</td><td style="padding:8px 12px;">${s.llamadas}</td><td style="padding:8px 12px;color:#4ADE80;font-weight:600;">${s.agendadosLlamada}</td></tr>`).join('') ||
    `<tr><td colspan="5" style="padding:14px;text-align:center;color:#7E8494;">Sin actividad en la semana.</td></tr>`;
  return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#0F1115;font-family:-apple-system,sans-serif;color:#E5E7E2;"><div style="max-width:680px;margin:0 auto;"><h1 style="color:#9D85F2;font-size:24px;margin:0 0 4px;">📊 Reporte semanal SCM</h1><p style="color:#B4B8C2;margin:0 0 24px;font-size:14px;">Semana del <strong>${period.from}</strong> al <strong>${period.to}</strong></p><h3 style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin:24px 0 10px;color:#7E8494;">💬 WhatsApp</h3><div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:18px;">${card('Conexiones nuevas', wsp.conexionesNew)}${card('Respondieron (total)', wsp.respondieronTotal)}${card('Interesados (total)', wsp.interesadosTotal, '#4ADE80')}${card('Agendados (total)', wsp.agendadosTotal, '#4ADE80')}</div><h3 style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin:24px 0 10px;color:#7E8494;">📞 Llamadas (semana)</h3><div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:18px;">${card('Total', calls.totalWeek)}${card('% Atendidas', calls.pctAtendidas + '%')}${card('Agendadas con vos', calls.scheduledWeek, '#4ADE80')}${card('Números muertos', calls.deadWeek, '#F87171')}</div><h3 style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin:24px 0 10px;color:#7E8494;">📅 Calendario</h3><div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:18px;">${card('Realizadas (semana)', cal.realized, '#4ADE80')}${card('No-shows (semana)', cal.noShow, '#FBBF24')}${card('Pendientes (ahora)', cal.pendingNow)}${card('Atrasadas (ahora)', cal.overdueNow, cal.overdueNow > 0 ? '#F87171' : '#9D85F2')}</div><h3 style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin:24px 0 10px;color:#7E8494;">👤 Por setter</h3><table style="width:100%;border-collapse:collapse;background:#161922;border:1px solid #262B3B;border-radius:10px;overflow:hidden;font-size:13px;"><thead><tr style="background:#11141B;"><th style="padding:10px 12px;text-align:left;color:#7E8494;font-size:11px;">Setter</th><th style="padding:10px 12px;text-align:left;color:#7E8494;font-size:11px;">Leads</th><th style="padding:10px 12px;text-align:left;color:#7E8494;font-size:11px;">Conexiones</th><th style="padding:10px 12px;text-align:left;color:#7E8494;font-size:11px;">Llamadas</th><th style="padding:10px 12px;text-align:left;color:#7E8494;font-size:11px;">Agendados</th></tr></thead><tbody>${rowsSetter}</tbody></table><p style="color:#565C6E;font-size:12px;margin-top:32px;padding-top:16px;border-top:1px solid #262B3B;">Reporte automático · ${leadsTotal} leads totales</p></div></body></html>`;
}

async function sendWeeklyReport(toEmail, dataOverride = null) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return { sent: false, reason: 'RESEND_API_KEY no configurada' };
  const data = dataOverride || buildWeeklyReportData();
  const html = buildWeeklyReportHtml(data);
  const fromEmail = process.env.INVITE_FROM_EMAIL || 'SCM Dental Setting App <onboarding@resend.dev>';
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: fromEmail, to: [toEmail], subject: `📊 Reporte semanal SCM · ${data.period.from} - ${data.period.to}`, html })
    });
    if (resp.ok) { const body = await resp.json(); return { sent: true, id: body.id }; }
    const err = await resp.json().catch(() => ({}));
    return { sent: false, reason: err.message || 'Error de Resend' };
  } catch (e) { return { sent: false, reason: e.message }; }
}

function maybeRunWeeklyReportCron() {
  const now = new Date();
  if (now.getDay() !== 1 || now.getHours() < 8) return;
  const state = loadReportsState();
  const last = state.lastWeeklyReportAt ? new Date(state.lastWeeklyReportAt) : null;
  if (last && (now.getTime() - last.getTime()) < 6 * 24 * 60 * 60 * 1000) return;
  let adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) {
    try { const admin = (loadAuthData().users || []).find(u => u.role === 'admin' && u.status === 'active'); adminEmail = admin?.email; }
    catch {}
  }
  if (!adminEmail) { console.warn('Weekly report skipped: no admin email'); return; }
  sendWeeklyReport(adminEmail).then(result => {
    if (result.sent) {
      state.lastWeeklyReportAt = now.toISOString();
      state.lastWeeklyReportTo = adminEmail;
      saveReportsState(state);
      console.log(`📨 Reporte semanal enviado a ${adminEmail}`);
    } else { console.warn('Weekly report failed:', result.reason); }
  });
}
if (process.env.NODE_ENV !== 'test') {
  setInterval(maybeRunWeeklyReportCron, 60 * 60 * 1000);
  setTimeout(maybeRunWeeklyReportCron, 60 * 1000);
}

app.get('/api/admin/weekly-report/preview', requireAuth, requireRole('admin'), (_req, res) => {
  try { const data = buildWeeklyReportData(); res.json({ data, html: buildWeeklyReportHtml(data) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/weekly-report/send', requireAuth, requireRole('admin'), async (req, res) => {
  const toEmail = req.body?.to || process.env.ADMIN_EMAIL || req.auth?.user?.email;
  if (!toEmail) return res.status(400).json({ error: 'No hay email destinatario.' });
  const result = await sendWeeklyReport(toEmail);
  if (!result.sent) return res.status(500).json(result);
  const state = loadReportsState();
  state.lastWeeklyReportAt = new Date().toISOString();
  state.lastWeeklyReportTo = toEmail;
  saveReportsState(state);
  res.json({ ok: true, ...result, to: toEmail });
});

app.post('/api/auth/invites', requireAuth, requireRole('admin'), async (req, res) => {
  const { name, email, role, sendEmail } = req.body || {};
  if (!name || !email || !role) return res.status(400).json({ error: 'Nombre, email y rol son requeridos.' });
  if (!['admin', 'setter'].includes(role)) return res.status(400).json({ error: 'Rol inválido.' });

  const data = loadAuthData();
  if (data.users.find((u) => u.email.toLowerCase() === String(email).toLowerCase())) {
    return res.status(400).json({ error: 'Ese email ya tiene usuario.' });
  }
  if (data.invites.find((i) => i.email.toLowerCase() === String(email).toLowerCase() && i.status === 'pending')) {
    return res.status(400).json({ error: 'Ese email ya tiene una invitación pendiente.' });
  }

  let setterId = '';
  if (role === 'setter') {
    setterId = ensureSetterProfile(name);
  }

  const invite = {
    id: `inv_${Date.now()}`,
    token: crypto.randomUUID().replace(/-/g, ''),
    name: name.trim(),
    email: email.trim().toLowerCase(),
    role,
    setterId,
    status: 'pending',
    createdAt: new Date().toISOString(),
    createdBy: req.auth.user.email
  };
  data.invites.push(invite);
  saveAuthData(data);

  const relativeUrl = `/?invite=${invite.token}`;
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
  const fullUrl = `${protocol}://${host}${relativeUrl}`;

  let emailResult = { sent: false, reason: 'No solicitado' };
  if (sendEmail !== false) {
    emailResult = await sendInviteEmail(invite.email, invite.name, invite.role, fullUrl);
  }

  res.json({ invite, inviteUrl: relativeUrl, fullInviteUrl: fullUrl, emailSent: emailResult.sent, emailError: emailResult.reason || null });
});

app.post('/api/auth/accept-invite', (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) return res.status(400).json({ error: 'Token y contraseña requeridos.' });
  if (String(password).length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });

  const data = loadAuthData();
  const invite = data.invites.find((item) => item.token === token && item.status === 'pending');
  if (!invite) return res.status(404).json({ error: 'Invitación inválida.' });

  const existing = data.users.find((u) => u.email.toLowerCase() === invite.email.toLowerCase());
  if (existing) return res.status(400).json({ error: 'Ya existe un usuario con ese email.' });

  const now = new Date().toISOString();
  const user = {
    id: `user_${invite.role}_${Date.now()}`,
    email: invite.email,
    name: invite.name,
    role: invite.role,
    status: 'active',
    setterId: invite.setterId || '',
    password: createPasswordRecord(password),
    createdAt: now,
    updatedAt: now
  };
  data.users.push(user);
  invite.status = 'accepted';
  invite.acceptedAt = now;
  saveAuthData(data);
  res.json({ user: publicUser(user) });
});

// ── Admin: Exportar toda la data (para backup pre-deploy) ──
// Backups admin: listar y trigger manual
app.get('/api/admin/backups', requireAuth, requireRole('admin'), (_req, res) => {
  try {
    if (!fs.existsSync(BACKUPS_DIR)) return res.json({ backups: [] });
    const list = fs.readdirSync(BACKUPS_DIR)
      .filter(n => fs.statSync(path.join(BACKUPS_DIR, n)).isDirectory())
      .sort()
      .reverse()
      .map(name => {
        const dir = path.join(BACKUPS_DIR, name);
        const files = fs.readdirSync(dir);
        const sizeBytes = files.reduce((s, f) => s + fs.statSync(path.join(dir, f)).size, 0);
        const stat = fs.statSync(dir);
        return {
          name,
          createdAt: stat.mtime.toISOString(),
          fileCount: files.length,
          sizeBytes,
          sizeMb: (sizeBytes / 1024 / 1024).toFixed(2),
          reason: name.split('_').slice(-1)[0] || 'auto'
        };
      });
    res.json({ backups: list, dir: BACKUPS_DIR });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/backups/now', requireAuth, requireRole('admin'), (req, res) => {
  const result = makeBackup('manual');
  if (!result.ok) return res.status(500).json(result);
  res.json(result);
});

app.get('/api/admin/export-data', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const history = loadHistory();
    const auth = loadAuthData();
    const setters = loadSettersData();
    // faqs y training también se exportan: sin esto, el pre-deploy no los baja
    // y un container nuevo de Railway arrancaría con faqs.json del repo (potencialmente
    // desactualizado o vacío) descartando el banco vivo.
    let faqs = null, training = null;
    try { faqs = loadFaqs(); } catch {}
    try { training = loadTraining(); } catch {}
    res.json({
      exportedAt: new Date().toISOString(),
      history,
      auth,
      setters,
      faqs,
      training
    });
  } catch (e) {
    console.error('Export error:', e);
    res.status(500).json({ error: 'Error exportando data' });
  }
});

// ── Admin: Importar data (restore después de deploy) ──
app.post('/api/admin/import-data', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const { history, auth, setters, faqs, training } = req.body;

    // Validacion de shape ANTES de tocar nada. Un payload malo no debe llegar
    // a sobrescribir los archivos vivos. Cada bloque tiene su forma minima.
    const errors = [];
    if (history !== undefined) {
      if (!history || typeof history !== 'object') errors.push('history debe ser objeto');
      else if (history.entries !== undefined && (typeof history.entries !== 'object' || Array.isArray(history.entries))) {
        errors.push('history.entries debe ser un map (objeto)');
      }
    }
    if (auth !== undefined) {
      if (!auth || typeof auth !== 'object') errors.push('auth debe ser objeto');
      else if (!Array.isArray(auth.users)) errors.push('auth.users debe ser array');
      else if (auth.invites !== undefined && !Array.isArray(auth.invites)) errors.push('auth.invites debe ser array');
      else if (auth.sessions !== undefined && !Array.isArray(auth.sessions)) errors.push('auth.sessions debe ser array');
    }
    if (setters !== undefined) {
      if (!setters || typeof setters !== 'object') errors.push('setters debe ser objeto');
      else if (!Array.isArray(setters.setters)) errors.push('setters.setters debe ser array');
      else if (setters.leads !== undefined && (typeof setters.leads !== 'object' || Array.isArray(setters.leads))) {
        errors.push('setters.leads debe ser un map (objeto)');
      }
    }
    if (faqs !== undefined) {
      if (!faqs || typeof faqs !== 'object' || !Array.isArray(faqs.entries)) {
        errors.push('faqs.entries debe ser array');
      }
    }
    if (training !== undefined) {
      if (!training || typeof training !== 'object' || !Array.isArray(training.materials)) {
        errors.push('training.materials debe ser array');
      }
    }
    if (history === undefined && auth === undefined && setters === undefined && faqs === undefined && training === undefined) {
      errors.push('payload vacio: incluir al menos uno de history/auth/setters/faqs/training');
    }
    if (errors.length) {
      return res.status(400).json({ error: 'Validacion fallida', detalles: errors });
    }

    // Backup ANTES de sobrescribir, para poder revertir si algo sale mal.
    const backup = makeBackup('pre-import');
    if (history) saveHistory(history);
    if (auth) saveAuthData(auth);
    if (setters) saveSettersData(setters);
    if (faqs) saveFaqs(faqs);
    if (training) saveTraining(training);
    res.json({ ok: true, message: 'Data importada correctamente', backup: backup?.path || null });
  } catch (e) {
    console.error('Import error:', e);
    res.status(500).json({ error: 'Error importando data' });
  }
});

// API de Apify (Buscador de Instagram Puro)
app.post('/api/apify-scrape', requireAuth, requireRole('admin'), scrapeLimiter, async (req, res) => {
  const { query, maxItems } = req.body;
  const apifyToken = process.env.APIFY_TOKEN;
  
  if (!apifyToken) return res.status(401).json({ error: 'Falta Token de APIFY en .env' });

  try {
    const isUrl = query.startsWith('http') || query.startsWith('www') || query.startsWith('instagram.com');
    const isHashtag = query.startsWith('#');
    const limit = parseInt(maxItems) || 20;

    // El actor apify/instagram-scraper espera directUrls (array de URLs) o search + searchType
    let runInput;
    if (isUrl) {
      // Si es una URL directa, usar directUrls
      const url = query.startsWith('http') ? query : `https://${query}`;
      runInput = {
        directUrls: [url],
        resultsType: "posts",
        searchLimit: limit,
        addParentData: false
      };
    } else {
      // Búsqueda por hashtag o usuario
      runInput = {
        search: query.replace('#', ''),
        searchType: isHashtag ? "hashtag" : "user",
        resultsType: "details",
        searchLimit: limit,
        addParentData: false
      };
    }

    // Endpoint síncrono: espera a que termine y devuelve el dataset directamente
    // Timeout de 120s (Apify lo permite hasta 300s)
    const runUrl = `https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items?token=${apifyToken}&format=json&timeout=120`;

    const startResp = await fetch(runUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(runInput),
        signal: AbortSignal.timeout(130000)
    });
    
    // Si excede el tiempo del sync (normalmente 1-2 min), Apify devuelve error de timeout pero deja el dataset creado.
    // Para resultados chicos (20 items de Ig) suele retornar instantaneo en JSON.
    const items = await startResp.json();
    console.log(`Apify Response Status: ${startResp.status}`);
    
    if (items.error || !Array.isArray(items)) {
        console.error('Apify Error Detail:', items);
        return res.status(500).json({ error: items.error || items.message || 'Error desconocido de Apify' });
    }
    
    // 3. Limpiar y enviar la data cruda de Instagram para la tabla
    const cleaned = items.map(i => {
      let extPhone = i.publicPhoneNumber || i.contactPhoneNumber || '';
      let bioStr = i.biography || '';
      
      // Intentar extraer telefono del final del bio si menciona wp o algun numero
      if (!extPhone && bioStr) {
          const match = bioStr.match(/(?:wa\.me\/|whatsapp|wsp|📱|📞)[\s]*([+\d\s.-]{8,15})/i);
          if (match) extPhone = match[1].trim();
      }
      
      return {
          id: i.id || Math.random(),
          username: i.username || 'Desconocido',
          url: i.url || (i.username ? `https://instagram.com/${i.username}` : '#'),
          fullName: i.fullName || '',
          bio: bioStr.substring(0, 150) + '...',
          email: i.publicEmail || i.businessEmail || '',
          followers: i.followersCount || 0,
          phone: extPhone,
          posts: i.postsCount || 0
      };
    });

    res.json({ results: cleaned });
  } catch (error) {
    console.error('Apify error:', error);
    res.status(500).json({ error: error.message || 'Error en actor de Apify' });
  }
});
// ── GET /api/admin/history — paginated history with search ──
app.get('/api/admin/history', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const history = loadHistory();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, Math.min(500, parseInt(req.query.limit) || 50));
    const search = (req.query.search || '').toLowerCase().trim();

    // Convert entries object to array
    let entries = Object.entries(history.entries).map(([key, val]) => ({
      key,
      name: val.name || '',
      address: val.address || '',
      scrapedAt: val.scrapedAt || val.addedAt || '',
      query: val.query || '',
      location: val.location || ''
    }));

    // Filter by search term
    if (search) {
      entries = entries.filter(e =>
        e.name.toLowerCase().includes(search) ||
        e.address.toLowerCase().includes(search) ||
        e.query.toLowerCase().includes(search)
      );
    }

    // Sort by scrapedAt descending (newest first)
    entries.sort((a, b) => new Date(b.scrapedAt || 0) - new Date(a.scrapedAt || 0));

    const total = entries.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const start = (page - 1) * limit;
    const paged = entries.slice(start, start + limit);

    res.json({ entries: paged, total, page, totalPages });
  } catch (error) {
    console.error('Error in /api/admin/history:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── POST /api/admin/history/import — import leads with deduplication ──
app.post('/api/admin/history/import', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const { leads } = req.body;
    if (!Array.isArray(leads)) return res.status(400).json({ error: 'leads must be an array' });

    const history = loadHistory();
    let imported = 0;
    let skipped = 0;

    // Build lookup sets from existing entries for fast dedup
    const existingPhones = new Set();
    const existingNameAddr = new Set();
    for (const val of Object.values(history.entries)) {
      const ph = normalizePhoneForDedup(val.phone);
      if (ph) existingPhones.add(ph);
      const nn = normalizeNameForDedup(val.name);
      const na = normalizeAddressForDedup(val.address);
      if (nn && na) existingNameAddr.add(nn + '|||' + na);
    }

    for (const lead of leads) {
      const key = makeKey(lead);

      // Check 1: exact key match
      if (history.entries[key]) { skipped++; continue; }

      // Check 2: phone match
      const ph = normalizePhoneForDedup(lead.phone);
      if (ph && existingPhones.has(ph)) { skipped++; continue; }

      // Check 3: normalized name+address match
      const nn = normalizeNameForDedup(lead.name);
      const na = normalizeAddressForDedup(lead.address);
      if (nn && na && existingNameAddr.has(nn + '|||' + na)) { skipped++; continue; }

      // Add the lead
      history.entries[key] = { ...lead, scrapedAt: lead.scrapedAt || new Date().toISOString() };
      imported++;

      // Update lookup sets so subsequent leads in this batch also dedup
      if (ph) existingPhones.add(ph);
      if (nn && na) existingNameAddr.add(nn + '|||' + na);
    }

    saveHistory(history);
    res.json({ imported, skipped, total: Object.keys(history.entries).length });
  } catch (error) {
    console.error('Error in /api/admin/history/import:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── POST /api/admin/history/dedup — remove duplicates from existing history ──
app.post('/api/admin/history/dedup', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const history = loadHistory();
    const seenPhones = new Map();   // normalizedPhone -> key
    const seenNameAddr = new Map();  // normalizedName|||normalizedAddr -> key
    const keysToRemove = new Set();

    // Sort entries by scrapedAt ascending so the oldest is kept
    const sorted = Object.entries(history.entries).sort((a, b) => {
      const dateA = new Date(a[1].scrapedAt || a[1].addedAt || 0);
      const dateB = new Date(b[1].scrapedAt || b[1].addedAt || 0);
      return dateA - dateB;
    });

    for (const [key, val] of sorted) {
      let isDup = false;

      // Check phone
      const ph = normalizePhoneForDedup(val.phone);
      if (ph) {
        if (seenPhones.has(ph)) { isDup = true; }
        else { seenPhones.set(ph, key); }
      }

      // Check name+address
      const nn = normalizeNameForDedup(val.name);
      const na = normalizeAddressForDedup(val.address);
      if (nn && na) {
        const naKey = nn + '|||' + na;
        if (seenNameAddr.has(naKey)) { isDup = true; }
        else { seenNameAddr.set(naKey, key); }
      }

      if (isDup) keysToRemove.add(key);
    }

    for (const key of keysToRemove) {
      delete history.entries[key];
    }

    saveHistory(history);
    res.json({ removed: keysToRemove.size, remaining: Object.keys(history.entries).length });
  } catch (error) {
    console.error('Error in /api/admin/history/dedup:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── DELETE /api/admin/history/entry — delete a specific entry ──
app.delete('/api/admin/history/entry', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const { key } = req.body;
    if (!key) return res.status(400).json({ error: 'key is required' });

    const history = loadHistory();
    if (!history.entries[key]) return res.status(404).json({ error: 'Entry not found' });

    delete history.entries[key];
    saveHistory(history);
    res.json({ ok: true });
  } catch (error) {
    console.error('Error in DELETE /api/admin/history/entry:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── Onboarding oficial del equipo ──
const ONBOARDING_MODULES = [
  { num: 1, slug: 'el-proyecto', title: 'El proyecto', subtitle: 'Por qué existe SCM', minutes: 7 },
  { num: 2, slug: 'tu-rol', title: 'Tu rol como setter', subtitle: 'Qué se espera de vos', minutes: 5 },
  { num: 3, slug: 'sistema-operativo', title: 'Sistema operativo', subtitle: 'Cómo usar tu panel de trabajo', minutes: 6 },
  { num: 4, slug: 'conversacion', title: 'Conversación', subtitle: 'Cómo se mueve una charla buena, paso a paso', minutes: 7 },
  { num: 5, slug: 'canales-warmeo', title: 'Canales y warmeo', subtitle: 'Por dónde prospectar y cómo no quemar cuentas', minutes: 6 },
  { num: 6, slug: 'tracking', title: 'Tracking', subtitle: 'Cómo organizar tu trabajo diario', minutes: 4 },
  { num: 7, slug: 'objeciones', title: 'Objeciones', subtitle: 'Las 10 que más vas a escuchar y cómo manejarlas', minutes: 6 },
  { num: 8, slug: 'glosario', title: 'Glosario', subtitle: 'El vocabulario común del equipo SCM', minutes: 5 }
];
const ONBOARDING_DIR = path.join(process.cwd(), 'public', 'onboarding', 'files');
const onboardingTextCache = new Map(); // num → plain text

function extractPlainText(html) {
  if (!html) return '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function loadOnboardingText() {
  for (const mod of ONBOARDING_MODULES) {
    try {
      const filePath = path.join(ONBOARDING_DIR, `scm-onboarding-modulo${mod.num}.html`);
      if (fs.existsSync(filePath)) {
        const html = fs.readFileSync(filePath, 'utf8');
        onboardingTextCache.set(mod.num, extractPlainText(html));
      }
    } catch (e) { console.warn(`No pude extraer onboarding ${mod.num}:`, e.message); }
  }
  console.log(`📘 Onboarding cargado: ${onboardingTextCache.size}/${ONBOARDING_MODULES.length} módulos`);
}
loadOnboardingText();

// Validación del quiz-data.json al boot — alerta de schema, no bloquea el arranque.
// Estructura esperada: { moduloN: { titulo, preguntas: [{ pregunta, opciones[3], correcta 0..2, explicacion }], bancoExtra?: [...] } }
function validateQuizData() {
  const quizPath = path.join(process.cwd(), 'public', 'onboarding', 'quiz-data.json');
  if (!fs.existsSync(quizPath)) {
    console.warn('⚠️  quiz-data.json no encontrado — el quiz mostrará "Quiz en preparación"');
    return { ok: false, errors: ['archivo no encontrado'] };
  }
  let data;
  try { data = JSON.parse(fs.readFileSync(quizPath, 'utf8')); }
  catch (e) {
    console.error('❌ quiz-data.json inválido (JSON parse error):', e.message);
    return { ok: false, errors: [e.message] };
  }
  const errors = [];
  let totalPreguntas = 0;
  let totalExtras = 0;
  for (const mod of ONBOARDING_MODULES) {
    const key = `modulo${mod.num}`;
    const m = data[key];
    if (!m) { errors.push(`${key}: falta el bloque entero`); continue; }
    const validatePool = (poolName, arr) => {
      if (!Array.isArray(arr)) { errors.push(`${key}.${poolName}: no es array`); return 0; }
      arr.forEach((q, i) => {
        const where = `${key}.${poolName}[${i}]`;
        if (typeof q.pregunta !== 'string' || !q.pregunta.trim()) errors.push(`${where}.pregunta vacía o no string`);
        if (!Array.isArray(q.opciones) || q.opciones.length !== 3) errors.push(`${where}.opciones debe ser array de 3`);
        else q.opciones.forEach((o, j) => { if (typeof o !== 'string' || !o.trim()) errors.push(`${where}.opciones[${j}] vacía`); });
        if (typeof q.correcta !== 'number' || q.correcta < 0 || q.correcta > 2) errors.push(`${where}.correcta debe ser 0..2`);
        if (typeof q.explicacion !== 'string') errors.push(`${where}.explicacion debe ser string`);
      });
      return arr.length;
    };
    totalPreguntas += validatePool('preguntas', m.preguntas);
    if (m.bancoExtra !== undefined) totalExtras += validatePool('bancoExtra', m.bancoExtra);
  }
  if (errors.length > 0) {
    console.warn(`⚠️  quiz-data.json tiene ${errors.length} problemas de schema:`);
    errors.slice(0, 10).forEach(e => console.warn('   -', e));
    if (errors.length > 10) console.warn(`   ... y ${errors.length - 10} más`);
  }
  console.log(`📝 Quiz cargado: ${totalPreguntas} preguntas base${totalExtras ? ` + ${totalExtras} en bancos extra` : ''} (${ONBOARDING_MODULES.length} módulos)`);
  return { ok: errors.length === 0, errors, totalPreguntas, totalExtras };
}
validateQuizData();

// API: metadata de los 8 módulos
app.get('/api/onboarding/modules', (_req, res) => {
  res.json({ modules: ONBOARDING_MODULES, total: ONBOARDING_MODULES.length });
});

// Middleware manual: intercepta /onboarding/files/*.html para inyectar el quiz
// y deja pasar /onboarding/quiz.js, /onboarding/quiz-data.json, etc al express.static
app.use((req, res, next) => {
  const m = req.path.match(/^\/onboarding\/files\/scm-onboarding-modulo(\d+)\.html$/);
  if (!m || req.method !== 'GET') return next();
  const num = parseInt(m[1], 10);
  const filePath = path.join(ONBOARDING_DIR, `scm-onboarding-modulo${num}.html`);
  if (!fs.existsSync(filePath)) return next();
  try {
    let html = fs.readFileSync(filePath, 'utf8');
    const inject = `\n<div id="scm-quiz-root"></div>\n<script src="/onboarding/quiz.js?v=20260425b"></script>\n`;
    html = html.includes('</body>') ? html.replace('</body>', inject + '</body>') : html + inject;
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', 'no-cache');
    return res.send(html);
  } catch (e) { return next(e); }
});

// Wrapper page: /onboarding/N — encierra el HTML del módulo en un iframe con topbar
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  const m = req.path.match(/^\/onboarding\/(\d+)$/);
  if (!m) return next();
  const num = parseInt(m[1], 10);
  const mod = ONBOARDING_MODULES.find(m => m.num === num);
  if (!mod) return res.status(404).send('Módulo no encontrado');
  // Admin bypass del gate progresivo: detectamos rol via cookie session
  const session = getSessionFromRequest(req);
  const isAdmin = session?.user?.role === 'admin';
  const titleEsc = mod.title.replace(/"/g, '&quot;');
  const subtitleEsc = mod.subtitle.replace(/"/g, '&quot;');
  const html = `<!DOCTYPE html>
<html lang="es"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SCM · Módulo ${num} · ${titleEsc}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;}
  html,body{margin:0;padding:0;background:#0E1117;font-family:'Inter',system-ui,sans-serif;color:#fff;height:100%;}
  .topbar{position:sticky;top:0;height:60px;background:rgba(14,17,23,0.95);backdrop-filter:blur(8px);border-bottom:1px solid #1f2430;display:flex;align-items:center;padding:0 24px;gap:18px;z-index:1000;}
  .back-link{display:inline-flex;align-items:center;gap:8px;color:#A78BFA;text-decoration:none;font-size:14px;font-weight:500;padding:8px 14px;border-radius:8px;transition:background 0.15s;}
  .back-link:hover{background:rgba(167,139,250,0.1);}
  .crumb{color:#8b94a8;font-size:13px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .crumb strong{color:#fff;font-weight:600;}
  .crumb .num-pill{background:rgba(167,139,250,0.15);color:#A78BFA;padding:3px 10px;border-radius:10px;font-size:12px;font-weight:600;margin-right:8px;}
  .status-pill{padding:8px 14px;border-radius:10px;font-weight:600;font-size:12px;letter-spacing:0.3px;display:inline-flex;align-items:center;gap:6px;}
  .status-pill.pending{background:rgba(210,153,34,0.15);color:#D29922;border:1px solid rgba(210,153,34,0.3);}
  .status-pill.passed{background:rgba(63,185,80,0.15);color:#3FB950;border:1px solid rgba(63,185,80,0.3);}
  .status-pill.locked{background:rgba(126,132,148,0.15);color:#8b94a8;border:1px solid rgba(126,132,148,0.3);}
  .status-pill.admin{background:rgba(167,139,250,0.15);color:#A78BFA;border:1px solid rgba(167,139,250,0.3);}
  iframe{width:100%;height:calc(100vh - 60px);border:none;display:block;background:#0E1117;}
  .locked-screen{display:flex;align-items:center;justify-content:center;height:calc(100vh - 60px);padding:32px;}
  .locked-card{max-width:520px;background:#161B22;border:1px solid #21262D;border-radius:16px;padding:40px;text-align:center;}
  .locked-icon{font-size:56px;line-height:1;margin-bottom:16px;}
  .locked-title{font-size:22px;font-weight:700;color:#E6EDF3;margin:0 0 12px;}
  .locked-desc{color:#B8C2CC;font-size:15px;line-height:1.6;margin:0 0 28px;}
  .locked-desc strong{color:#A78BFA;}
  .locked-actions{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;}
  .locked-btn{padding:12px 22px;background:#A78BFA;color:#0E1117;text-decoration:none;border-radius:10px;font-weight:600;font-size:14px;border:none;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:8px;transition:all 0.15s;}
  .locked-btn:hover{transform:translateY(-1px);box-shadow:0 6px 20px rgba(167,139,250,0.3);}
  .locked-btn.secondary{background:transparent;color:#A78BFA;border:1px solid #21262D;}
  .locked-btn.secondary:hover{background:rgba(167,139,250,0.08);border-color:#A78BFA;}
  @media (max-width:600px){.crumb{font-size:12px;} .back-link span.label{display:none;}}
</style>
</head><body>
<div class="topbar">
  <a class="back-link" href="/?view=training" title="Volver al Centro de Entrenamiento">← <span class="label">Volver</span></a>
  <div class="crumb"><span class="num-pill">Módulo ${num} de 8</span><strong>${titleEsc}</strong> · ${subtitleEsc}</div>
  <span class="status-pill pending" id="scm-status-pill">🎯 Quiz pendiente</span>
</div>
<div id="scm-content"></div>
<script>
  (function(){
    var N = ${num};
    var IS_ADMIN = ${isAdmin ? 'true' : 'false'};
    var KEY = 'scm_onboarding_progress';
    var content = document.getElementById('scm-content');
    var pill = document.getElementById('scm-status-pill');
    function getP(){ try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch(e){ return {}; } }
    function setPassed(){
      pill.textContent = '✅ Quiz aprobado';
      pill.classList.remove('pending', 'locked'); pill.classList.add('passed');
    }
    function setLocked(){
      pill.textContent = '🔒 Bloqueado';
      pill.classList.remove('pending', 'passed'); pill.classList.add('locked');
    }
    function setAdminMode(){
      pill.textContent = '👑 Admin · libre';
      pill.classList.remove('pending', 'locked', 'passed'); pill.classList.add('admin');
    }

    var progress = getP();

    // Gate progresivo: módulo N requiere N-1 aprobado (módulo 1 siempre disponible)
    // Admin bypass: si sos admin, no hay gate. Todo libre.
    if (!IS_ADMIN && N > 1 && !progress[N - 1]) {
      setLocked();
      content.innerHTML = '<div class="locked-screen"><div class="locked-card">' +
        '<div class="locked-icon">🔒</div>' +
        '<h1 class="locked-title">Módulo ' + N + ' bloqueado</h1>' +
        '<p class="locked-desc">Para acceder a este módulo necesitás aprobar primero el <strong>quiz del módulo ' + (N - 1) + '</strong>. El onboarding está pensado para hacerse en orden — cada módulo construye sobre el anterior.</p>' +
        '<div class="locked-actions">' +
          '<a class="locked-btn" href="/onboarding/' + (N - 1) + '">Ir al módulo ' + (N - 1) + ' →</a>' +
          '<a class="locked-btn secondary" href="/?view=training">Volver al índice</a>' +
        '</div>' +
      '</div></div>';
      return;
    }

    // Desbloqueado: insertar iframe del módulo
    var iframe = document.createElement('iframe');
    iframe.id = 'scm-mod-iframe';
    iframe.src = '/onboarding/files/scm-onboarding-modulo' + N + '.html';
    content.appendChild(iframe);

    if (IS_ADMIN) setAdminMode();
    else if (progress[N]) setPassed();

    // El quiz dentro del iframe nos avisa al aprobar
    window.addEventListener('message', function(e){
      if (e.data && e.data.type === 'scm_quiz_passed' && e.data.module === N) {
        var p = getP(); p[N] = true; localStorage.setItem(KEY, JSON.stringify(p));
        setPassed();
      }
    });
  })();
</script>
</body></html>`;
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

app.use(express.static(path.join(process.cwd(), "public"), { maxAge: 0, etag: false }));

// ── Historial persistente ──
// Si hay un volume montado en /data (Railway), usarlo; si no, usar ./data local
const DATA_DIR = process.env.DATA_DIR || (fs.existsSync('/data') ? '/data' : path.join(process.cwd(), "data"));
const HISTORY_FILE = path.join(DATA_DIR, "history.json");

// Al arrancar: si el volume está vacío pero hay data en el repo, copiarla al volume
function seedVolumeFromRepo() {
  const repoData = path.join(process.cwd(), "data");
  if (DATA_DIR === repoData) return; // no estamos usando volume
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  for (const file of ['history.json', 'auth.json', 'setters.json', 'faqs.json', 'training.json', 'wa_accounts.json', 'wa_routines.json', 'wa_events.json']) {
    const volumePath = path.join(DATA_DIR, file);
    const repoPath = path.join(repoData, file);
    if (!fs.existsSync(volumePath) && fs.existsSync(repoPath)) {
      console.log(`Copiando ${file} del repo al volume...`);
      fs.copyFileSync(repoPath, volumePath);
    }
  }
}
seedVolumeFromRepo();
// Reasignar paths de archivos para que usen el volume
AUTH_FILE = path.join(DATA_DIR, "auth.json");
console.log(`📁 Data dir: ${DATA_DIR}`);

// ── Error logging persistente ──
// Escribe errores a data/error.log (rotación a .old cuando llega a 5MB).
// Endpoint admin para ver últimos N errores. Trail útil cuando algo falla en prod.
const ERROR_LOG = path.join(DATA_DIR, 'error.log');
const ERROR_LOG_MAX_BYTES = 5 * 1024 * 1024;

function logError(err, context = {}) {
  try {
    const entry = {
      ts: new Date().toISOString(),
      message: err?.message || String(err),
      stack: err?.stack || null,
      ...context
    };
    const line = JSON.stringify(entry) + '\n';
    // Rotación si pasa el límite
    if (fs.existsSync(ERROR_LOG) && fs.statSync(ERROR_LOG).size > ERROR_LOG_MAX_BYTES) {
      fs.renameSync(ERROR_LOG, ERROR_LOG + '.old');
    }
    fs.appendFileSync(ERROR_LOG, line, 'utf8');
  } catch (writeErr) {
    console.error('No pude escribir al error log:', writeErr.message);
  }
  console.error('🔴', err?.message || err, context.path ? `[${context.path}]` : '');
}

// Capturar excepciones no atrapadas y rejections (no tirar el server, loguearlas)
process.on('uncaughtException', (err) => logError(err, { source: 'uncaughtException' }));
process.on('unhandledRejection', (reason) => logError(reason instanceof Error ? reason : new Error(String(reason)), { source: 'unhandledRejection' }));

// ── Backups automáticos del data/ ──
// Snapshot cada 6 horas a data/backups/{ISO_timestamp}/. Mantiene últimos 28 (1 semana).
// Permite recovery si una corrupción rompe los JSON principales.
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
const BACKUP_INTERVAL_HOURS = 6;
const BACKUP_KEEP = 28;
const BACKUP_FILES = ['setters.json', 'auth.json', 'history.json', 'faqs.json', 'training.json', 'wa_accounts.json', 'wa_routines.json', 'wa_events.json'];

function makeBackup(reason = 'auto') {
  try {
    if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = path.join(BACKUPS_DIR, `${stamp}_${reason}`);
    fs.mkdirSync(dir, { recursive: true });
    let copied = 0;
    let totalBytes = 0;
    for (const f of BACKUP_FILES) {
      const src = path.join(DATA_DIR, f);
      if (fs.existsSync(src)) {
        const dst = path.join(dir, f);
        fs.copyFileSync(src, dst);
        totalBytes += fs.statSync(src).size;
        copied++;
      }
    }
    // Cleanup: mantener solo los últimos BACKUP_KEEP
    const all = fs.readdirSync(BACKUPS_DIR).filter(n => fs.statSync(path.join(BACKUPS_DIR, n)).isDirectory()).sort();
    if (all.length > BACKUP_KEEP) {
      const toDelete = all.slice(0, all.length - BACKUP_KEEP);
      for (const old of toDelete) {
        fs.rmSync(path.join(BACKUPS_DIR, old), { recursive: true, force: true });
      }
    }
    console.log(`💾 Backup ${reason}: ${copied} archivos, ${(totalBytes/1024/1024).toFixed(2)} MB → ${path.basename(dir)} (total snapshots: ${Math.min(all.length, BACKUP_KEEP)})`);
    return { ok: true, dir: path.basename(dir), copied, totalBytes };
  } catch (e) {
    console.error('❌ Error en backup:', e.message);
    return { ok: false, error: e.message };
  }
}

// Backup inicial al boot + cron cada 6 hs
if (process.env.NODE_ENV !== 'test') {
  setTimeout(() => makeBackup('boot'), 30000); // 30s después del boot
  setInterval(() => makeBackup('cron'), BACKUP_INTERVAL_HOURS * 60 * 60 * 1000);
}

function loadHistory() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(HISTORY_FILE)) {
      const data = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
      if (!data.lastPages) data.lastPages = {};
      return data;
    }
  } catch (e) {
    console.error("Error leyendo historial:", e);
  }
  return { entries: {}, searches: [], lastPages: {} };
}

function saveHistory(history) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), "utf8");
  } catch (e) {
    console.error("Error guardando historial:", e);
  }
}

function makeKey(item) {
  return `${(item.name || '').toLowerCase().trim()}_${(item.address || '').toLowerCase().trim()}`;
}

// Normalizar nombre para detectar duplicados con diferente orden de palabras
// "Clínica Dental Sonrisa" y "Sonrisa - Clínica Dental" → mismas palabras
function normalizeNameForDedup(name) {
  if (!name) return '';
  return name.toLowerCase()
    .replace(/[^a-záéíóúñü\s]/gi, '') // quitar puntuación, guiones, etc.
    .split(/\s+/)
    .filter(w => w.length > 2) // ignorar "de", "la", "el", etc.
    .sort()
    .join(' ');
}

// Normalizar teléfono para dedup (solo dígitos, últimos 8)
function normalizePhoneForDedup(phone) {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7) return '';
  return digits.slice(-8); // últimos 8 dígitos ignoran prefijos/códigos de país
}

// Normalizar dirección para dedup
function normalizeAddressForDedup(address) {
  if (!address) return '';
  return address.toLowerCase()
    .replace(/[^a-záéíóúñü0-9\s]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Cargar la API Key
if (!apiKey || apiKey === "tu_clave_secreta_aqui" || apiKey === "your_api_key_here") {
  console.warn("⚠️ Advertencia: No has configurado tu API_KEY en el archivo .env");
}

// ── Función que busca en UNA ubicación con paginación ──
// Incluye corte temprano: si una página tiene <30% resultados relevantes, deja de paginar
async function searchLocation(query, location, maxPages, startPage = 1) {
  const results = [];
  const limit = Math.min(Math.max(1, parseInt(maxPages)), 100);
  let hasMoreResults = false;

  const basePageOffset = Math.max(0, parseInt(startPage) - 1);

  // Preparar raíces de relevancia para corte temprano
  const stopWords = new Set(['en', 'de', 'del', 'la', 'las', 'el', 'los', 'un', 'una', 'y', 'o', 'a', 'con', 'para', 'por', 'que', 'como', 'the', 'in', 'and', 'or', 'for', 'near', 'best']);
  const queryWords = query.toLowerCase().split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w))
    .map(w => w.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
  const queryRoots = queryWords.map(w => w.substring(0, Math.min(w.length, 4)));

  for (let i = 0; i < limit; i++) {
    const currentOffset = (basePageOffset + i) * 20;

    let searchQuery = query;
    const searchParams = {
      engine: "google_maps",
      api_key: apiKey,
      type: "search",
      start: currentOffset
    };

    if (location) {
      if (location.startsWith('@')) {
        searchParams.ll = location;
      } else {
        searchQuery = `${query} en ${location}`;
      }
    }

    searchParams.q = searchQuery;

    const json = await getJson(searchParams);

    if (json.error) {
      if (results.length > 0) break;
      console.log(`Sin resultados para "${searchQuery}": ${json.error}`);
      break;
    }

    const localResults = json.local_results || [];
    if (localResults.length === 0) break;

    const parsedData = localResults.map(item => {
      const { country, city } = parseLocationParts(location || '');
      return {
        name: item.title,
        phone: item.phone || "",
        reviews: item.reviews,
        rating: item.rating,
        address: item.address,
        website: item.website || "",
        type: item.type || "",
        types: Array.isArray(item.types) ? item.types.join(', ') : (item.type || ""),
        unclaimed: item.unclaimed_listing ? "Sí (Oportunidad)" : "Reclamado",
        locationSearched: location || "General",
        country,
        city
      };
    });

    // ── Corte temprano por relevancia: no gastar créditos en páginas basura ──
    if (queryRoots.length > 0 && i > 0) { // Siempre aceptar la primera página
      const relevantCount = parsedData.filter(item => {
        const text = [item.name, item.type, item.types].join(' ').toLowerCase()
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        return queryRoots.some(root => text.includes(root));
      }).length;

      const relevanceRatio = relevantCount / parsedData.length;
      console.log(`   📊 Pág ${basePageOffset + i + 1}: ${relevantCount}/${parsedData.length} relevantes (${(relevanceRatio * 100).toFixed(0)}%)`);

      if (relevanceRatio < 0.3) {
        console.log(`   🛑 Corte temprano: <30% relevancia en pág ${basePageOffset + i + 1}. No se pedirán más páginas (ahorro de créditos SerpAPI).`);
        // Igual agregar los pocos relevantes de esta última página
        const relevantOnly = parsedData.filter(item => {
          const text = [item.name, item.type, item.types].join(' ').toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          return queryRoots.some(root => text.includes(root));
        });
        results.push(...relevantOnly);
        break;
      }
    }

    results.push(...parsedData);

    // Si la última página devolvió 20 resultados, probablemente hay más
    if (localResults.length >= 20 && i === limit - 1) {
      hasMoreResults = true;
    }

    if (localResults.length < 20) break;
  }

  return { results, hasMoreResults };
}

// ── Endpoint principal ──
app.post('/api/scrape', requireAuth, requireRole('admin'), scrapeLimiter, async (req, res) => {
  const { query, location, maxPages = 1, startPage = 1 } = req.body;

  if (!query) {
    return res.status(400).json({ error: "La búsqueda (query) es requerida." });
  }

  try {
    // Soportar múltiples keywords separadas por salto de línea
    const queries = query.split('\n').map(q => q.trim()).filter(Boolean);
    const locations = location
      ? location.split(';').map(loc => loc.trim()).filter(Boolean)
      : [''];

    // Clamp anti-quema-creditos: total de llamadas SerpAPI no puede pasar 50 por request.
    // Esto previene un click accidental con 5 keywords x 10 ciudades x 5 paginas = 250 llamadas.
    const totalCalls = queries.length * locations.length * Math.min(maxPages, 10);
    if (totalCalls > 50) {
      return res.status(400).json({
        error: `Demasiado trabajo: ${queries.length} keywords x ${locations.length} ubicaciones x ${maxPages} paginas = ${totalCalls} llamadas. Maximo 50 por request. Reduci alguna dimension.`
      });
    }

    console.log(`Buscando ${queries.length} keyword(s): [${queries.join(', ')}] en ${locations.length} ubicación(es): [${locations.join(', ')}]`);

    const allResults = [];
    const seenKeys = new Set();      // dedup exacto: nombre+dirección
    const seenPhones = new Set();    // dedup por teléfono
    const seenNormNames = new Set(); // dedup por nombre normalizado (palabras reordenadas)
    let totalHasMore = false;
    let dedupCount = 0;

    // Cargar historial existente
    const history = loadHistory();

    for (const currentQuery of queries) {
      console.log(`\n🔎 Keyword: "${currentQuery}"`);

      for (let locIndex = 0; locIndex < locations.length; locIndex++) {
        const loc = locations[locIndex];
        console.log(`── Ubicación ${locIndex + 1}/${locations.length}: "${loc || 'Sin ubicación'}" (Desde Pág ${startPage}) ──`);

        const { results: locationResults, hasMoreResults } = await searchLocation(currentQuery, loc, maxPages, startPage);
        if (hasMoreResults) totalHasMore = true;

        // Actualizar la última página scrapeada de esta ciudad
        if (!history.lastPages) history.lastPages = {};
        const pageKey = `${currentQuery.toLowerCase().trim()}_${(loc || '').toLowerCase().trim()}`;
        const maxPageReached = parseInt(startPage) + parseInt(maxPages) - 1;
        const previousEnd = history.lastPages[pageKey] || 0;
        if (maxPageReached > previousEnd) {
          history.lastPages[pageKey] = maxPageReached;
        }

        for (const item of locationResults) {
          const key = makeKey(item);
          const normPhone = normalizePhoneForDedup(item.phone);
          const normName = normalizeNameForDedup(item.name);
          const normAddr = normalizeAddressForDedup(item.address);
          // Clave compuesta: mismo nombre normalizado + misma dirección normalizada
          const normNameAddrKey = normName && normAddr ? `${normName}_${normAddr}` : '';

          // Duplicado si:
          // 1. Exacto nombre+dirección ya existe
          // 2. Mismo teléfono (últimos 8 dígitos)
          // 3. Mismo nombre normalizado + misma dirección normalizada
          const isDup = seenKeys.has(key)
            || (normPhone && seenPhones.has(normPhone))
            || (normNameAddrKey && seenNormNames.has(normNameAddrKey));

          if (!isDup) {
            seenKeys.add(key);
            if (normPhone) seenPhones.add(normPhone);
            if (normNameAddrKey) seenNormNames.add(normNameAddrKey);
            // Marcar si ya fue scrapeado antes
            item.alreadyScraped = !!history.entries[key];
            allResults.push(item);
          } else {
            dedupCount++;
          }
        }

        console.log(`   → ${locationResults.length} encontrados, ${allResults.length} únicos, ${dedupCount} duplicados removidos`);
      }
    }

    // ── Filtro de relevancia: descartar resultados que no matchean la búsqueda ──
    // Google Maps en ciudades chicas devuelve negocios irrelevantes
    // Extraer palabras clave significativas de la búsqueda (ignorar preposiciones, artículos, etc.)
    const stopWords = new Set(['en', 'de', 'del', 'la', 'las', 'el', 'los', 'un', 'una', 'y', 'o', 'a', 'con', 'para', 'por', 'que', 'como', 'the', 'in', 'and', 'or', 'for', 'near', 'best']);
    // Extraer raíces de palabras (primeros 4+ chars) para matching flexible
    // "dentales" -> "dent", "clínicas" -> "clin", "implantes" -> "impl", "odontología" -> "odon"
    const queryWords = queries.flatMap(q => q.toLowerCase().split(/\s+/))
      .filter(w => w.length > 2 && !stopWords.has(w))
      .map(w => w.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
    const queryRoots = queryWords.map(w => w.substring(0, Math.min(w.length, 4)));

    let relevanceFiltered = allResults;
    let irrelevantRemoved = 0;
    if (queryRoots.length > 0) {
      relevanceFiltered = allResults.filter(item => {
        // Texto completo del resultado: nombre + tipo + tipos de Google
        const text = [item.name, item.type, item.types].join(' ').toLowerCase()
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        // El resultado es relevante si ALGUNA raíz de la búsqueda aparece en su nombre/tipo
        // "dent" matchea "dentist", "dental", "dentales", "dentalaser", etc.
        const isRelevant = queryRoots.some(root => text.includes(root));
        if (!isRelevant) {
          irrelevantRemoved++;
          return false;
        }
        return true;
      });
      if (irrelevantRemoved > 0) console.log(`🚫 Filtro de relevancia: ${irrelevantRemoved} resultados descartados (no matchean "${queries.join(', ')}")`);
    }

    // Filtrar: remover sin teléfono Y sin sitio web
    const contactableResults = relevanceFiltered.filter(item => item.phone || item.website);
    const removed = relevanceFiltered.length - contactableResults.length;

    // Separar nuevos de ya scrapeados
    const newResults = contactableResults.filter(item => !item.alreadyScraped);
    const oldResults = contactableResults.filter(item => item.alreadyScraped);

    // Guardar los nuevos en el historial
    const searchTimestamp = new Date().toISOString();
    for (const item of newResults) {
      const key = makeKey(item);
      history.entries[key] = {
        name: item.name,
        address: item.address,
        scrapedAt: searchTimestamp,
        query: query,
        location: item.locationSearched
      };
    }

    // Registrar esta búsqueda
    history.searches.push({
      query: queries.join(' | '),
      locations: locations.filter(Boolean),
      timestamp: searchTimestamp,
      newFound: newResults.length,
      duplicatesSkipped: oldResults.length
    });

    saveHistory(history);

    const totalInHistory = Object.keys(history.entries).length;

    if (removed > 0) {
      console.log(`Se removieron ${removed} resultados sin teléfono ni sitio web.`);
    }
    if (dedupCount > 0) {
      console.log(`Se removieron ${dedupCount} duplicados cross-keyword.`);
    }
    console.log(`Nuevos: ${newResults.length} | Ya scrapeados: ${oldResults.length} | Total en historial: ${totalInHistory}`);

    res.json({
      results: contactableResults,
      newCount: newResults.length,
      alreadyScrapedCount: oldResults.length,
      totalInHistory,
      totalBeforeFilter: allResults.length,
      removedNoContact: removed,
      dedupRemoved: dedupCount,
      locationsSearched: locations.length,
      hasMoreResults: totalHasMore
    });

  } catch (errError) {
    console.error("Error durante el scraping:", errError);
    // Limpiar el mensaje: SerpAPI a veces devuelve HTML crudo (pagina de error 5xx).
    // Strip de tags + truncar a 300 chars para que no contamine el frontend.
    let raw = String(errError?.message || errError || 'Error desconocido');
    if (/<html|<!doctype|<body|<title/i.test(raw)) {
      // El error viene como pagina HTML — devolver mensaje generico claro.
      raw = 'SerpAPI devolvio una pagina de error (probable 5xx temporal o cuota agotada). Verifica tu cuenta en https://serpapi.com/manage-api-key';
    } else {
      raw = raw.replace(/<[^>]+>/g, '').substring(0, 300);
    }
    logError(errError, { source: '/api/scrape', query: req.body?.query, location: req.body?.location });
    return res.status(500).json({ error: raw });
  }
});

// ── Stats del historial ──
app.get('/api/history/stats', requireAuth, requireRole('admin'), (req, res) => {
  const history = loadHistory();
  const totalEntries = Object.keys(history.entries).length;
  const recentSearches = (history.searches || []).slice(-10).reverse();
  res.json({ totalEntries, recentSearches });
});

// ── Limpiar historial ──
app.delete('/api/history', requireAuth, requireRole('admin'), (req, res) => {
  saveHistory({ entries: {}, searches: [], lastPages: {} });
  res.json({ message: "Historial limpiado." });
});

// ── Sugerir próxima página ──
app.get('/api/history/suggest-page', requireAuth, requireRole('admin'), (req, res) => {
  const { query, location } = req.query;
  const history = loadHistory();
  if (!history.lastPages) history.lastPages = {};
  
  const locs = location ? location.split(';').map(l => l.trim()).filter(Boolean) : [''];
  let maxSuggested = 1;

  if (query) {
    for (const loc of locs) {
      const key = `${query.toLowerCase().trim()}_${loc.toLowerCase().trim()}`;
      
      // Calcular cuántos leads ya tenemos para inferir página si no hay registro directo
      let entriesCount = 0;
      const targetQuery = query.toLowerCase().trim();
      const targetBaseLoc = loc.split(',')[0].toLowerCase().trim(); // Ej: de "Santiago, Chile" extrae "santiago"

      for (const k in history.entries) {
        const e = history.entries[k];
        if (!e.query || !e.location) continue;

        const histQuery = e.query.toLowerCase().trim();
        const histLoc = e.location.toLowerCase().trim();

        // Coincidencia más inteligente (fuzzy) para lidiar con el viejo "Santiago de Chile" vs "Santiago, Chile"
        if ((histQuery.includes(targetQuery) || targetQuery.includes(histQuery)) &&
            (histLoc.includes(targetBaseLoc) || targetBaseLoc.includes(histLoc))) {
           entriesCount++;
        }
      }
      
      // Estimación basada en registros previos (~20 por página)
      const estimatedPage = Math.floor(entriesCount / 20) + 1;

      // Usar la página más alta: o la calculada por leads, o el número exacto guardado
      const recordedNextPage = (history.lastPages[key] || 0) + 1;
      const nextStart = Math.max(estimatedPage, recordedNextPage);

      if (nextStart > maxSuggested) maxSuggested = nextStart;
    }
  }
  
  res.json({ suggestedPage: maxSuggested });
});

// ══════════════════════════════════════════════════════════════
// ── MÓDULO SETTERS v2 ──
// ══════════════════════════════════════════════════════════════
const SETTERS_FILE = path.join(DATA_DIR, "setters.json");

function defaultSettersData() {
  return {
    setters: [
      { id: "setter_paula", name: "Paula", activeVariantId: "", createdAt: new Date().toISOString() },
      { id: "setter_evelio", name: "Evelio", activeVariantId: "", createdAt: new Date().toISOString() }
    ],
    variants: [],
    leads: {},
    calendar: [],
    sessions: []
  };
}

function loadSettersData() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(SETTERS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(SETTERS_FILE, "utf8"));
      // Migración: formato viejo (setters era array de strings)
      if (raw.setters && raw.setters.length > 0 && typeof raw.setters[0] === 'string') {
        raw.setters = raw.setters.map(name => ({
          id: name.toLowerCase().trim() === 'ignacio' ? 'setter_evelio' : `setter_${name.toLowerCase().replace(/\s+/g, '_')}`,
          name: name.toLowerCase().trim() === 'ignacio' ? 'Evelio' : name,
          activeVariantId: "",
          createdAt: new Date().toISOString()
        }));
        if (!raw.variants) raw.variants = [];
        if (!raw.calendar) raw.calendar = [];
        // Migrar leads al formato nuevo
        for (const key in raw.leads) {
          const l = raw.leads[key];
          if (!l.conexion) l.conexion = l.status === 'nuevo' ? '' : 'enviada';
          if (l.respondio === undefined) l.respondio = ['respondio','interesado','agendado','cerrado'].includes(l.status);
          if (l.interes === undefined) l.interes = ['interesado','agendado','cerrado'].includes(l.status) ? 'si' : null;
          if (!l.followUps) l.followUps = { '24hs': false, '48hs': false, '72hs': false, '7d': false, '15d': false };
          if (!l.varianteId) l.varianteId = '';
          if (!l.apertura) l.apertura = '';
          if (l.doctor === undefined) l.doctor = l.owner || '';
          if (l.decisor === undefined) l.decisor = '';
          if (!l.fecha) l.fecha = l.importedAt ? l.importedAt.substring(0,10) : '';
          if (!l.num) l.num = 0;
        }
        saveSettersData(raw);
      }
      // Migración (one-shot) de clasificación WSP — SOLO INFORMATIVA, no toca el pipeline.
      // Computa wspProbability para cada lead y agrega defaults nuevos para llamadas.
      // NO mueve leads a "Sin WSP" automáticamente (la heurística tiene muchos falsos
      // positivos: muchas clínicas tienen WSP aunque no haya wa.me en su web).
      if (!raw.__wspClassified) {
        let reclassified = 0;
        for (const key in raw.leads) {
          const l = raw.leads[key];
          if (!l.wspProbability) {
            l.wspProbability = computeWspProbability(l);
            reclassified++;
          }
          if (!l.phoneStatus) l.phoneStatus = '';
          if (!Array.isArray(l.callLog)) l.callLog = [];
          if (typeof l.callAttempts !== 'number') l.callAttempts = 0;
          if (!l.callbackAt) l.callbackAt = '';
        }
        raw.__wspClassified = true;
        saveSettersData(raw);
        if (reclassified > 0) {
          console.log(`📞 wspProbability calculada para ${reclassified} leads (informativa, sin auto-ruteo).`);
        }
      }
      if (!raw.variants) raw.variants = [];
      if (!raw.calendar) raw.calendar = [];
      if (!raw.sessions) raw.sessions = [];
      raw.variants = raw.variants.map(normalizeVariantRecord);
      for (const setter of raw.setters || []) {
        if (setter.activeVariantId) {
          const v = raw.variants.find((variant) => variant.id === setter.activeVariantId);
          if (v && !v.setterId) v.setterId = setter.id;
        }
      }
      for (const key in raw.leads) {
        raw.leads[key] = ensureLeadDefaults(raw.leads[key]);
      }
      return raw;
    }
  } catch (e) {
    console.error("Error leyendo setters data:", e);
  }
  return defaultSettersData();
}

function saveSettersData(data) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SETTERS_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch (e) {
    console.error("Error guardando setters data:", e);
  }
}

// Wrapper atómico para mutaciones de setters.json en handlers ASYNC.
// Garantiza que el load+mutate+save ocurra como una unidad sin que otro handler
// (PATCH, POST de notas, etc.) pueda colarse entre el load y el save y perder
// cambios. Para handlers 100% sync, NO hace falta usar este wrapper porque
// Node single-thread ya los hace atómicos.
//
// Uso: const result = await mutateSettersData(data => { data.foo = bar; return X; });
let _settersMutex = Promise.resolve();
async function mutateSettersData(mutator) {
  const next = _settersMutex.then(async () => {
    const data = loadSettersData();
    const result = await Promise.resolve(mutator(data));
    saveSettersData(data);
    return result;
  });
  // Si este mutator falla, no envenenamos la cola para los próximos.
  _settersMutex = next.catch(() => {});
  return next;
}

// ── Setters: Info general ──
app.get('/api/setters', (req, res) => {
  const data = loadSettersData();
  const variants = data.variants.map(normalizeVariantRecord);
  res.json({ setters: data.setters, variants });
});

// ── Setters: Gestionar equipo ──
app.post('/api/setters/team', requireAuth, requireRole('admin'), (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Nombre requerido." });
  const data = loadSettersData();
  const id = `setter_${name.trim().toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`;
  if (data.setters.find(s => s.name.toLowerCase() === name.trim().toLowerCase())) {
    return res.status(400).json({ error: "Ya existe un setter con ese nombre." });
  }
  data.setters.push({ id, name: name.trim(), activeVariantId: "", createdAt: new Date().toISOString() });
  saveSettersData(data);
  res.json({ setters: data.setters });
});

app.patch('/api/setters/team/:id', requireAuth, requireRole('admin'), (req, res) => {
  const data = loadSettersData();
  const setter = data.setters.find(s => s.id === req.params.id);
  if (!setter) return res.status(404).json({ error: "Setter no encontrado." });
  if (req.body.activeVariantId !== undefined) setter.activeVariantId = req.body.activeVariantId;
  if (req.body.name) setter.name = req.body.name;
  saveSettersData(data);
  res.json({ setter });
});

app.post('/api/setters/team/:id/duplicate', requireAuth, requireRole('admin'), (req, res) => {
  const data = loadSettersData();
  const source = data.setters.find(s => s.id === req.params.id);
  if (!source) return res.status(404).json({ error: 'Setter no encontrado.' });

  const baseName = `${source.name} (copia)`;
  let copyName = baseName;
  let suffix = 2;
  while (data.setters.some(s => s.name.toLowerCase() === copyName.toLowerCase())) {
    copyName = `${baseName} ${suffix++}`;
  }

  const newSetterId = `setter_${copyName.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`;
  const newSetter = { id: newSetterId, name: copyName, activeVariantId: '', createdAt: new Date().toISOString() };
  data.setters.push(newSetter);

  const sourceVariants = data.variants.filter(v => v.setterId === source.id);
  const copiedVariantIds = new Map();

  sourceVariants.forEach((variant, index) => {
    const copiedBlocks = (variant.blocks || []).map((block, blockIndex) => ({
      id: `copy_${Date.now()}_${index}_${blockIndex}`,
      label: block.label || `Bloque ${blockIndex + 1}`,
      text: block.text || '',
      order: blockIndex,
      usedCount: 0,
      interestedCount: 0,
      createdAt: new Date().toISOString()
    }));
    const copied = normalizeVariantRecord({
      id: `var_${Date.now()}_${index}`,
      name: `${variant.name} (copia)`,
      weekLabel: variant.weekLabel || '',
      setterId: newSetterId,
      active: variant.active !== false,
      blocks: copiedBlocks,
      createdAt: new Date().toISOString()
    });
    data.variants.push(copied);
    copiedVariantIds.set(variant.id, copied.id);
  });

  if (source.activeVariantId && copiedVariantIds.has(source.activeVariantId)) {
    newSetter.activeVariantId = copiedVariantIds.get(source.activeVariantId);
  } else if (sourceVariants.length > 0) {
    newSetter.activeVariantId = copiedVariantIds.get(sourceVariants[0].id) || '';
  }

  saveSettersData(data);
  res.json({ setter: newSetter, copiedVariants: sourceVariants.length });
});

app.delete('/api/setters/team/:id', requireAuth, requireRole('admin'), (req, res) => {
  const setterId = req.params.id;
  const data = loadSettersData();
  const setter = data.setters.find(s => s.id === setterId);
  if (!setter) return res.status(404).json({ error: 'Setter no encontrado.' });

  // 1) Sacar del array de setters
  data.setters = data.setters.filter(s => s.id !== setterId);

  // 2) Liberar variantes (las que apuntaban a este setter quedan sin asignar)
  let variantsFreed = 0;
  data.variants = data.variants.map((variant) => {
    if (variant.setterId === setterId) { variant.setterId = ''; variantsFreed++; }
    if (Array.isArray(variant.sharedWith)) variant.sharedWith = variant.sharedWith.filter(id => id !== setterId);
    return variant;
  });

  // 3) Liberar leads asignados a este setter (no se borran, quedan reasignables)
  let leadsFreed = 0;
  if (data.leads && typeof data.leads === 'object') {
    for (const id of Object.keys(data.leads)) {
      if (data.leads[id]?.assignedTo === setterId) {
        data.leads[id].assignedTo = '';
        leadsFreed++;
      }
    }
  }

  // 4) Cerrar sesiones activas del setter en sus sessions internas (las propias del modulo
  //    de setteo, no las de auth) — limpiar las que sean de este setter.
  if (Array.isArray(data.sessions)) {
    data.sessions = data.sessions.filter(s => s.setter !== setterId);
  }

  saveSettersData(data);

  // 5) Cascada al usuario asociado en auth.json (si existe).
  //    Lo desactivamos en lugar de borrarlo para preservar trazabilidad
  //    historica (notas, interacciones que mencionan su nombre, etc).
  let userDeactivated = false;
  let sessionsRevoked = 0;
  let userEmail = '';
  try {
    const auth = loadAuthData();
    const user = (auth.users || []).find(u => u.role === 'setter' && u.setterId === setterId);
    if (user) {
      userEmail = user.email;
      user.status = 'inactive';
      user.setterId = '';
      user.updatedAt = new Date().toISOString();
      userDeactivated = true;
      const before = (auth.sessions || []).length;
      auth.sessions = (auth.sessions || []).filter(s => s.userId !== user.id);
      sessionsRevoked = before - auth.sessions.length;
      saveAuthData(auth);
      console.log(`[setter:delete] Setter '${setter.name}' eliminado en cascada: user '${userEmail}' desactivado, ${sessionsRevoked} sesion(es) revocada(s), ${leadsFreed} lead(s) liberado(s), ${variantsFreed} variante(s) liberada(s).`);
    } else {
      console.log(`[setter:delete] Setter '${setter.name}' eliminado: ${leadsFreed} lead(s) liberado(s), ${variantsFreed} variante(s) liberada(s). Sin user asociado en auth.json.`);
    }
  } catch (e) {
    console.warn('[setter:delete] Cascada al usuario fallo (no critico):', e.message);
  }

  res.json({
    ok: true,
    setterName: setter.name,
    leadsFreed,
    variantsFreed,
    userDeactivated,
    userEmail: userDeactivated ? userEmail : '',
    sessionsRevoked
  });
});

// ── Variantes CRUD (compartidas) ──
app.get('/api/setters/variants', (req, res) => {
  const data = loadSettersData();
   res.json({ variants: data.variants.map(normalizeVariantRecord) });
});

app.post('/api/setters/variants', requireAuth, (req, res) => {
  const { name, weekLabel, setterId, blocks = [], active = true } = req.body;
  if (!name) return res.status(400).json({ error: "Nombre requerido." });
  const role = req.auth?.user?.role;
  let finalSetterId = setterId || '';
  if (role !== 'admin') {
    // Setters sólo crean variantes asignadas a ellos mismos
    finalSetterId = req.auth?.user?.setterId || '';
    if (!finalSetterId) return res.status(403).json({ error: 'No tenés setter asignado.' });
  }
  const data = loadSettersData();
  const variant = normalizeVariantRecord({
    id: `var_${Date.now()}`,
    name,
    weekLabel: weekLabel || '',
    setterId: finalSetterId,
    active,
    blocks,
    createdAt: new Date().toISOString()
  });
  data.variants.push(variant);
  saveSettersData(data);
  res.json({ variant, variants: data.variants });
});

app.patch('/api/setters/variants/:id', requireAuth, (req, res) => {
  const data = loadSettersData();
  const v = data.variants.find(v => v.id === req.params.id);
  if (!v) return res.status(404).json({ error: "Variante no encontrada." });
  // Setters sólo pueden editar variantes asignadas a ellos
  const role = req.auth?.user?.role;
  if (role !== 'admin') {
    const mySetterId = req.auth?.user?.setterId;
    if (!mySetterId || v.setterId !== mySetterId) {
      return res.status(403).json({ error: 'Sólo podés editar tus propias variables.' });
    }
    // Setters no pueden reasignar la variante a otro setter
    if (req.body.setterId !== undefined && req.body.setterId !== mySetterId) {
      return res.status(403).json({ error: 'No podés reasignar la variable.' });
    }
  }
  if (req.body.name) v.name = req.body.name;
  if (req.body.weekLabel) v.weekLabel = req.body.weekLabel;
  if (req.body.setterId !== undefined) v.setterId = req.body.setterId;
  // sharedWith: sólo admin puede modificarlo
  if (req.body.sharedWith !== undefined && role === 'admin') {
    v.sharedWith = Array.isArray(req.body.sharedWith) ? req.body.sharedWith.filter(Boolean).map(String) : [];
  }
  if (req.body.blocks) v.blocks = req.body.blocks.map((block, index) => normalizeBlockRecord(block, index)).filter((block) => block.text);
  if (req.body.messages) v.blocks = variantBlocksFromMessages({ ...v.messages, ...req.body.messages });
  if (req.body.active !== undefined) v.active = req.body.active;
  Object.assign(v, normalizeVariantRecord(v));
  if (req.body.active !== undefined) v.active = req.body.active;
  saveSettersData(data);
  res.json({ variant: v });
});

app.delete('/api/setters/variants/:id', requireAuth, (req, res) => {
  const data = loadSettersData();
  const v = data.variants.find(x => x.id === req.params.id);
  if (!v) return res.status(404).json({ error: 'Variante no encontrada.' });
  const role = req.auth?.user?.role;
  if (role !== 'admin') {
    const mySetterId = req.auth?.user?.setterId;
    if (!mySetterId || v.setterId !== mySetterId) {
      return res.status(403).json({ error: 'Sólo podés eliminar tus propias variables.' });
    }
  }
  data.variants = data.variants.filter(v => v.id !== req.params.id);
  saveSettersData(data);
  res.json({ ok: true });
});

// ── Leads ──
app.get('/api/setters/leads', (req, res) => {
  const { setter, estado } = req.query;
  const data = loadSettersData();
  let leads = Object.entries(data.leads).map(([id, lead]) => ({ id, ...lead }));
  const authSetterId = req.auth?.user?.role === 'setter' ? req.auth.user.setterId : '';
  if (authSetterId) {
    leads = leads.filter((l) => l.assignedTo === authSetterId);
  } else if (setter) {
    leads = leads.filter(l => l.assignedTo === setter);
  }
  if (estado) leads = leads.filter(l => l.estado === estado);
  leads.sort((a, b) => (a.num || 0) - (b.num || 0));
  res.json({ leads, setters: data.setters, variants: data.variants });
});

// Sin WSP - DEBE estar antes de las rutas con :id
app.get('/api/setters/leads/sin-wsp', requireAuth, (req, res) => {
  const { setter } = req.query;
  const data = loadSettersData();
  let leads = Object.entries(data.leads)
    .filter(([_, l]) => l.conexion === 'sin_wsp')
    .map(([id, l]) => ({ id, ...l }));
  const authSetterId = req.auth?.user?.role === 'setter' ? req.auth.user.setterId : '';
  if (authSetterId) {
    leads = leads.filter((l) => l.assignedTo === authSetterId);
  } else if (setter) {
    leads = leads.filter(l => l.assignedTo === setter);
  }
  leads.sort((a, b) => (a.num || 0) - (b.num || 0));
  res.json({ leads });
});

app.post('/api/setters/import', requireAuth, requireRole('admin'), (req, res) => {
  try {
  const { leads: incoming, assignTo } = req.body;
  if (!incoming || !Array.isArray(incoming) || incoming.length === 0) {
    return res.status(400).json({ error: "No hay leads para importar." });
  }
  // Validación: max 10000 leads por batch + cada lead debe tener al menos name o phone
  if (incoming.length > 10000) {
    return res.status(413).json({ error: `Demasiados leads en un solo batch (max 10000, recibidos ${incoming.length}).` });
  }
  const malformed = incoming.findIndex((l) => {
    if (!l || typeof l !== 'object') return true;
    const hasName = typeof l.name === 'string' && l.name.trim().length > 0;
    const hasPhone = typeof l.phone === 'string' && l.phone.trim().length > 0;
    return !hasName && !hasPhone;
  });
  if (malformed >= 0) {
    return res.status(400).json({ error: `Lead #${malformed + 1} inválido: requiere al menos 'name' o 'phone' string no vacío.` });
  }
  const data = loadSettersData();
  let imported = 0, skipped = 0;
  // Buscar el num más alto actual
  let maxNum = 0;
  for (const key in data.leads) { if (data.leads[key].num > maxNum) maxNum = data.leads[key].num; }
  // Buscar variante activa del setter
  const setter = data.setters.find(s => s.id === assignTo || s.name === assignTo);
  const varianteId = setter ? setter.activeVariantId || '' : '';
  const now = new Date();

  // Construir sets de dedup de leads existentes (todos los setters)
  const existingPhones = new Set();
  const existingNameAddr = new Set();
  for (const key in data.leads) {
    const l = data.leads[key];
    const ph = normalizePhoneForDedup(l.phone || l.webWhatsApp || l.aiWhatsApp || '');
    if (ph) existingPhones.add(ph);
    const nn = normalizeNameForDedup(l.name);
    const na = normalizeAddressForDedup(l.address);
    if (nn && na) existingNameAddr.add(`${nn}_${na}`);
  }

  for (const lead of incoming) {
    const id = `l_${(lead.name || '').toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 30)}_${(lead.phone || lead.website || '').replace(/\D/g, '').substring(0, 12)}`;

    // Dedup por ID exacto
    if (data.leads[id]) { skipped++; continue; }

    // Dedup por teléfono (últimos 8 dígitos)
    const incomingPhone = normalizePhoneForDedup(lead.phone || lead.webWhatsApp || lead.aiWhatsApp || '');
    if (incomingPhone && existingPhones.has(incomingPhone)) { skipped++; continue; }

    // Dedup por nombre+dirección normalizado
    const incomingName = normalizeNameForDedup(lead.name);
    const incomingAddr = normalizeAddressForDedup(lead.address);
    const incomingNameAddr = incomingName && incomingAddr ? `${incomingName}_${incomingAddr}` : '';
    if (incomingNameAddr && existingNameAddr.has(incomingNameAddr)) { skipped++; continue; }

    // Registrar en sets para evitar duplicados intra-batch
    if (incomingPhone) existingPhones.add(incomingPhone);
    if (incomingNameAddr) existingNameAddr.add(incomingNameAddr);
    maxNum++;

    // Extraer teléfono limpio de URLs wa.me si viene así
    let cleanPhone = lead.phone || '';
    let importedWaUrl = lead.whatsappUrl || '';
    let importedOpenMsg = lead.openMessage || '';
    if (cleanPhone.includes('wa.me/')) {
      const waMatch = cleanPhone.match(/wa\.me\/(\d+)/);
      if (waMatch) {
        if (!importedWaUrl) importedWaUrl = cleanPhone.startsWith('http') ? cleanPhone : 'https://' + cleanPhone;
        const textMatch = cleanPhone.match(/[?&]text=([^&]*)/);
        if (textMatch && !importedOpenMsg) {
          try { importedOpenMsg = decodeURIComponent(textMatch[1]); } catch(e) { importedOpenMsg = textMatch[1]; }
        }
        cleanPhone = waMatch[1];
      }
    }

    const { country, city } = parseLocationParts(lead.locationSearched || lead.city || lead.country || '');
    const baseLead = ensureLeadDefaults({
      num: maxNum,
      fecha: now.toISOString().substring(0, 10),
      name: lead.name || 'Sin nombre',
      phone: cleanPhone,
      website: lead.website || '',
      address: lead.address || '',
      city: lead.city || city || '',
      country: lead.country || country || '',
      rating: lead.rating || '',
      reviews: lead.reviews || 0,
      instagram: lead.instagram || '',
      facebook: lead.facebook || '',
      linkedin: lead.linkedin || '',
      email: lead.email || '',
      doctor: (() => { const d = String(lead.owner || lead.aiRole || ''); return (d.includes('N/A') || d.includes('Sin identificar') || d.includes('no soportada') || d.includes('Requiere clave') || d.includes('pausada') || d.includes('sin contenido')) ? '' : d; })(),
      decisor: '',
      webWhatsApp: lead.webWhatsApp || '',
      aiWhatsApp: lead.aiWhatsApp || '',
      openMessage: importedOpenMsg || lead.openMessage || '',
      assignedTo: setter ? setter.id : '',
      varianteId,
      conexion: '',
      apertura: '',
      respondio: false,
      calificado: false,
      interes: null,
      estado: 'sin_contactar',
      notes: [],
      interactions: [],
      importedAt: now.toISOString(),
      lastContactAt: null
    });
    // Si ya viene con URL de WhatsApp completa (del CSV), usarla; si no, construirla
    baseLead.whatsappUrl = importedWaUrl || buildWhatsAppUrl(baseLead.phone || baseLead.webWhatsApp || baseLead.aiWhatsApp || '', baseLead.country || country || '', importedOpenMsg);
    // Re-evaluar wspProbability con los datos finales. Esto es info SOLO INFORMATIVA:
    // NO auto-ruteamos porque la heurística (sin wa.me en web) tiene muchos falsos
    // positivos — la mayoría de las clínicas SÍ tienen WSP aunque no lo pongan en su web.
    // El setter sigue marcando "Sin WSP" manualmente cuando confirma que el número no
    // responde por WSP, igual que hoy.
    baseLead.wspProbability = computeWspProbability(baseLead);
    data.leads[id] = {
      ...baseLead,
      followUps: baseLead.followUps || { '24hs': false, '48hs': false, '72hs': false, '7d': false, '15d': false }
    };
    incrementVariantUsage(data, varianteId);
    imported++;
  }
  saveSettersData(data);
  res.json({ imported, skipped, total: Object.keys(data.leads).length });
  } catch (err) {
    console.error('Error en /api/setters/import:', err);
    res.status(500).json({ error: err.message || 'Error importando leads' });
  }
});

// ── Borrar leads de un setter con filtro opcional por país/ciudad ──
app.delete('/api/setters/leads-bulk', requireAuth, requireRole('admin'), (req, res) => {
  const { setter, country, city } = req.body;
  const data = loadSettersData();
  let removed = 0;
  for (const id in data.leads) {
    const lead = data.leads[id];
    // Filtrar por setter
    if (setter && lead.assignedTo !== setter) continue;
    // Filtrar por país si se especificó
    if (country && !(lead.country || '').toLowerCase().includes(country.toLowerCase())) continue;
    // Filtrar por ciudad si se especificó
    if (city && !(lead.city || '').toLowerCase().includes(city.toLowerCase()) && !(lead.locationSearched || '').toLowerCase().includes(city.toLowerCase())) continue;
    // Si no se especificó setter ni country ni city, no borrar nada (protección)
    if (!setter && !country && !city) continue;
    delete data.leads[id];
    removed++;
  }
  if (removed > 0) saveSettersData(data);
  res.json({ removed, remaining: Object.keys(data.leads).length });
});

// Actualizar lead (campos múltiples)
app.patch('/api/setters/leads/:id', requireAuth, (req, res) => {
  const data = loadSettersData();
  const lead = data.leads[req.params.id];
  if (!lead) return res.status(404).json({ error: "Lead no encontrado." });
  if (req.auth?.user?.role === 'setter' && lead.assignedTo !== req.auth.user.setterId) {
    return res.status(403).json({ error: "No autorizado para este lead." });
  }
  const allowed = ['conexion', 'apertura', 'respondio', 'calificado', 'interes', 'doctor', 'decisor', 'estado', 'assignedTo', 'varianteId'];
  for (const field of allowed) {
    if (req.body[field] !== undefined) lead[field] = req.body[field];
  }

  // ── Cascada hacia adelante ──
  if (req.body.conexion === 'enviada') {
    if (!lead.fechaContacto) lead.fechaContacto = new Date().toISOString().substring(0, 10);
    if (!lead.estado || lead.estado === 'sin_contactar') lead.estado = 'contactado';
    lead.lastContactAt = new Date().toISOString();
  }
  if (req.body.conexion === 'sin_wsp') {
    lead.estado = 'sin_wsp';
    lead.respondio = false;
    lead.calificado = false;
    lead.interes = null;
  }
  if (req.body.respondio === true) {
    if (!lead.conexion) lead.conexion = 'enviada';
    lead.estado = 'respondio';
    lead.lastContactAt = new Date().toISOString();
  }
  if (req.body.calificado === true) {
    if (!lead.conexion) lead.conexion = 'enviada';
    if (!lead.respondio) lead.respondio = true;
    if (lead.estado === 'sin_contactar' || lead.estado === 'contactado' || lead.estado === 'respondio') lead.estado = 'calificado';
    lead.lastContactAt = new Date().toISOString();
  }
  // calificado='no' → marcado explícitamente como no calificó (reversa + estado especial)
  if (req.body.calificado === 'no') {
    lead.interes = null;
    if (lead.respondio) lead.estado = 'respondio';
    else if (lead.conexion === 'enviada') lead.estado = 'contactado';
    else lead.estado = 'sin_contactar';
  }
  if (req.body.interes === 'si') {
    if (!lead.conexion) lead.conexion = 'enviada';
    if (!lead.respondio) lead.respondio = true;
    if (lead.calificado !== true) lead.calificado = true;
    lead.estado = 'interesado';
    lead.lastContactAt = new Date().toISOString();
  }

  // ── Cascada reversa ──
  if (req.body.conexion === '' || req.body.conexion === null) {
    lead.fechaContacto = null;
    lead.respondio = false;
    lead.calificado = false;
    lead.interes = null;
    lead.estado = 'sin_contactar';
  }
  if (req.body.respondio === false && req.body.conexion === undefined) {
    lead.calificado = false;
    lead.interes = null;
    if (lead.conexion === 'enviada') lead.estado = 'contactado';
    else lead.estado = 'sin_contactar';
  }
  if ((req.body.calificado === false) && req.body.respondio === undefined && req.body.conexion === undefined) {
    lead.interes = null;
    if (lead.respondio) lead.estado = 'respondio';
    else if (lead.conexion === 'enviada') lead.estado = 'contactado';
    else lead.estado = 'sin_contactar';
  }
  if ((req.body.interes === '' || req.body.interes === null || req.body.interes === 'no') && req.body.calificado === undefined && req.body.respondio === undefined && req.body.conexion === undefined) {
    if (lead.calificado === true) lead.estado = 'calificado';
    else if (lead.respondio) lead.estado = 'respondio';
    else if (lead.conexion === 'enviada') lead.estado = 'contactado';
    else lead.estado = 'sin_contactar';
  }

  if (req.body.varianteId !== undefined && req.body.varianteId !== lead.varianteId) {
    incrementVariantUsage(data, req.body.varianteId || '');
  }
  lead.whatsappUrl = buildWhatsAppUrl(lead.phone || lead.webWhatsApp || lead.aiWhatsApp || '', lead.country || '', '');
  saveSettersData(data);
  res.json({ ok: true, lead: { id: req.params.id, ...lead } });
});

app.post('/api/setters/leads/:id/interaction', requireAuth, (req, res) => {
  const { stage = '', action = '', message = '', variantId = '', blockId = '' } = req.body || {};
  const data = loadSettersData();
  const lead = data.leads[req.params.id];
  if (!lead) return res.status(404).json({ error: 'Lead no encontrado.' });
  if (req.auth?.user?.role === 'setter' && lead.assignedTo !== req.auth.user.setterId) {
    return res.status(403).json({ error: 'No autorizado para este lead.' });
  }

  ensureLeadDefaults(lead);
  const now = new Date().toISOString();
  const entry = {
    id: `int_${Date.now()}`,
    stage,
    action,
    message: String(message || '').trim(),
    variantId: variantId || lead.varianteId || '',
    blockId: blockId || '',
    setterId: lead.assignedTo || req.auth.user.setterId || '',
    by: req.auth?.user?.name || req.auth?.user?.email || 'Sistema',
    createdAt: now
  };
  lead.interactions.push(entry);
  lead.lastContactAt = now;
  lead.lastStage = stage;
  lead.lastVariantId = entry.variantId;

  if (action === 'open') {
    lead.conexion = 'enviada';
    lead.estado = 'contactado';
    lead.apertura = message || lead.apertura || '';
  }
  if (action === 'qualified') {
    lead.conexion = 'enviada';
    lead.respondio = true;
    lead.estado = 'respondio';
  }
  if (action === 'interest') {
    lead.conexion = 'enviada';
    lead.respondio = true;
    lead.interes = 'si';
    lead.estado = 'interesado';
  }
  if (blockId && lead.varianteId) {
    const variant = data.variants.find((v) => v.id === lead.varianteId);
    if (variant && Array.isArray(variant.blocks)) {
      const block = variant.blocks.find((b) => b.id === blockId);
      if (block) {
        block.usedCount = (Number(block.usedCount) || 0) + 1;
        if (action === 'interest') block.interestedCount = (Number(block.interestedCount) || 0) + 1;
      }
    }
  }
  if (action === 'no_interest') {
    lead.interes = 'no';
  }
  if (stage === 'cierrePregunta' && action !== 'open') {
    lead.apertura = lead.apertura || message || '';
  }
  saveSettersData(data);
  res.json({ ok: true, lead: { id: req.params.id, ...lead } });
});

// Follow-up toggle
app.patch('/api/setters/leads/:id/followup', requireAuth, (req, res) => {
  const { step, value } = req.body;
  const valid = ['24hs', '48hs', '72hs', '7d', '15d'];
  if (!valid.includes(step)) return res.status(400).json({ error: "Step inválido." });
  const data = loadSettersData();
  const lead = data.leads[req.params.id];
  if (!lead) return res.status(404).json({ error: "Lead no encontrado." });
  if (req.auth?.user?.role === 'setter' && lead.assignedTo !== req.auth.user.setterId) {
    return res.status(403).json({ error: "No autorizado para este lead." });
  }
  if (!lead.followUps) lead.followUps = { '24hs': false, '48hs': false, '72hs': false, '7d': false, '15d': false };
  // Si viene value explícito, usarlo (determinístico). Si no, toggle (legacy).
  if (typeof value === 'boolean') {
    lead.followUps[step] = value;
  } else {
    lead.followUps[step] = !lead.followUps[step];
  }
  lead.lastContactAt = new Date().toISOString();
  saveSettersData(data);
  res.json({ ok: true, followUps: lead.followUps, lead: { id: req.params.id, ...lead } });
});

// Notas
app.post('/api/setters/leads/:id/note', requireAuth, (req, res) => {
  const { text, by } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: "Nota vacía." });
  const data = loadSettersData();
  if (!data.leads[req.params.id]) return res.status(404).json({ error: "Lead no encontrado." });
  if (req.auth?.user?.role === 'setter' && data.leads[req.params.id].assignedTo !== req.auth.user.setterId) {
    return res.status(403).json({ error: "No autorizado para este lead." });
  }
  data.leads[req.params.id].notes.push({ text: text.trim(), by: by || 'Sistema', date: new Date().toISOString() });
  data.leads[req.params.id].lastContactAt = new Date().toISOString();
  saveSettersData(data);
  res.json({ ok: true, notes: data.leads[req.params.id].notes });
});

app.delete('/api/setters/leads/:id/note/:noteIndex', requireAuth, (req, res) => {
  const data = loadSettersData();
  const lead = data.leads[req.params.id];
  if (!lead) return res.status(404).json({ error: "Lead no encontrado." });
  if (req.auth?.user?.role === 'setter' && lead.assignedTo !== req.auth.user.setterId) {
    return res.status(403).json({ error: "No autorizado para este lead." });
  }
  const idx = parseInt(req.params.noteIndex, 10);
  if (isNaN(idx) || idx < 0 || idx >= (lead.notes || []).length) {
    return res.status(400).json({ error: "Índice de nota inválido." });
  }
  lead.notes.splice(idx, 1);
  saveSettersData(data);
  res.json({ ok: true, notes: lead.notes });
});

app.delete('/api/setters/leads/:id', requireAuth, requireRole('admin'), (req, res) => {
  const data = loadSettersData();
  if (data.leads[req.params.id]) { delete data.leads[req.params.id]; saveSettersData(data); }
  res.json({ ok: true });
});

// Disposition de una llamada — endpoint específico de Llamadas.
// Recibe { outcome, notes?, callbackAt?, scheduled? } y aplica los cambios de estado
// + log de la llamada + opcional creación de evento en el calendario (agenda con admin).
const CALL_OUTCOMES = new Set([
  'answered_interested',     // ✅ Atendió + Interesado → calificado, queda en Llamadas
  'answered_not_interested', // ❌ Atendió + No interesado → descarta
  'no_answer',               // 📵 No atendió → contador +1, sigue
  'voicemail',               // 📭 Buzón → marca phoneStatus + sigue
  'wrong_number',            // 🔢 Número equivocado → descarta + flag
  'invalid_number',          // 🚫 No existe → descarta + flag
  'callback_later',          // 🔄 Volver a llamar (con fecha) → oculta hasta fecha
  'scheduled_with_admin'     // 📅 Agendó llamada de ventas con admin → crea evento en calendar
]);

app.post('/api/setters/leads/:id/call-disposition', requireAuth, (req, res) => {
  const data = loadSettersData();
  const lead = data.leads[req.params.id];
  if (!lead) return res.status(404).json({ error: "Lead no encontrado." });
  if (req.auth?.user?.role === 'setter' && lead.assignedTo !== req.auth.user.setterId) {
    return res.status(403).json({ error: "No autorizado para este lead." });
  }

  const { outcome, notes, callbackAt, scheduled } = req.body || {};
  if (!CALL_OUTCOMES.has(outcome)) {
    return res.status(400).json({ error: `outcome inválido. Esperado uno de: ${[...CALL_OUTCOMES].join(', ')}` });
  }

  // Asegurar arrays/campos
  if (!Array.isArray(lead.callLog)) lead.callLog = [];
  if (typeof lead.callAttempts !== 'number') lead.callAttempts = 0;

  const now = new Date().toISOString();
  const logEntry = {
    ts: now,
    outcome,
    by: req.auth?.user?.id || '',
    notes: (notes || '').toString().slice(0, 500)
  };
  lead.callLog.push(logEntry);
  lead.callAttempts += 1;
  lead.lastContactAt = now;
  // El lead siempre permanece en "Llamadas" — la conexion no se mueve a 'enviada'
  if (lead.conexion !== 'sin_wsp') lead.conexion = 'sin_wsp';

  let calendarEntry = null;

  switch (outcome) {
    case 'answered_interested':
      lead.respondio = true;
      lead.calificado = true;
      lead.interes = 'si';
      lead.estado = 'interesado';
      // Sigue en Llamadas con chip verde, esperando agendamiento
      break;

    case 'answered_not_interested':
      lead.respondio = true;
      lead.interes = 'no';
      lead.estado = 'descartado';
      break;

    case 'no_answer':
      // Solo contador + log, no cambia estado
      break;

    case 'voicemail':
      lead.phoneStatus = 'voicemail';
      break;

    case 'wrong_number':
      lead.phoneStatus = 'wrong';
      lead.estado = 'descartado';
      break;

    case 'invalid_number':
      lead.phoneStatus = 'invalid';
      lead.estado = 'descartado';
      break;

    case 'callback_later':
      // callbackAt debe venir en ISO. Si no, default a +24hs
      lead.callbackAt = callbackAt || new Date(Date.now() + 24*60*60*1000).toISOString();
      break;

    case 'scheduled_with_admin':
      // Crea entrada en data.calendar reusando el mismo formato que /api/setters/calendar
      if (!Array.isArray(data.calendar)) data.calendar = [];
      const sched = scheduled || {};
      calendarEntry = {
        id: `cal_${Date.now()}`,
        leadId: req.params.id,
        fecha: sched.fecha || new Date(Date.now() + 24*60*60*1000).toISOString(),
        nombre: sched.nombre || lead.name || '',
        calendarioEstado: 'pendiente',
        valorProyecto: 0,
        comision: 0,
        setterId: req.auth?.user?.role === 'setter' ? req.auth.user.setterId : (lead.assignedTo || ''),
        sourceCall: true
      };
      data.calendar.push(calendarEntry);
      lead.respondio = true;
      lead.calificado = true;
      lead.interes = 'si';
      lead.estado = 'agendado';
      break;
  }

  saveSettersData(data);
  res.json({ ok: true, lead, calendarEntry });
});

// ── Deduplicar leads de setters (conserva el más viejo / más trabajado) ──
app.post('/api/setters/dedup', requireAuth, requireRole('admin'), (req, res) => {
  const data = loadSettersData();
  const entries = Object.entries(data.leads);

  // Ordenar por fecha de importación ascendente (más viejos primero)
  // Si no tiene importedAt, se considera viejo (principio del tiempo)
  entries.sort((a, b) => {
    const dateA = a[1].importedAt || a[1].fecha || '2000-01-01';
    const dateB = b[1].importedAt || b[1].fecha || '2000-01-01';
    return dateA.localeCompare(dateB);
  });

  const seenPhones = new Map();    // phone(last8) → leadId
  const seenNameAddr = new Map();  // normName_normAddr → leadId
  const toDelete = [];

  // Helper: un lead "trabajado" tiene interacciones, notas, o estado avanzado
  function workScore(lead) {
    let score = 0;
    if (lead.interactions?.length) score += lead.interactions.length * 2;
    if (lead.notes?.length) score += lead.notes.length;
    if (lead.conexion === 'enviada') score += 3;
    if (lead.respondio) score += 5;
    if (lead.interes === 'si') score += 10;
    if (lead.estado === 'agendado') score += 20;
    if (lead.estado === 'respondio') score += 8;
    return score;
  }

  for (const [id, lead] of entries) {
    const phone = normalizePhoneForDedup(lead.phone || lead.webWhatsApp || lead.aiWhatsApp || '');
    const normName = normalizeNameForDedup(lead.name);
    const normAddr = normalizeAddressForDedup(lead.address);
    const nameAddrKey = normName && normAddr ? `${normName}_${normAddr}` : '';

    let existingId = null;

    // Buscar duplicado por teléfono
    if (phone && seenPhones.has(phone)) {
      existingId = seenPhones.get(phone);
    }
    // Buscar duplicado por nombre+dirección normalizado
    if (!existingId && nameAddrKey && seenNameAddr.has(nameAddrKey)) {
      existingId = seenNameAddr.get(nameAddrKey);
    }

    if (existingId) {
      const existingLead = data.leads[existingId];
      const existingScore = workScore(existingLead);
      const currentScore = workScore(lead);

      // Si el actual tiene MÁS trabajo que el existente, eliminar el existente y quedarse con este
      if (currentScore > existingScore) {
        toDelete.push(existingId);
        // Reemplazar en los maps
        if (phone) seenPhones.set(phone, id);
        if (nameAddrKey) seenNameAddr.set(nameAddrKey, id);
      } else {
        // Eliminar el actual (más reciente y/o menos trabajado)
        toDelete.push(id);
      }
    } else {
      // No es duplicado, registrar
      if (phone) seenPhones.set(phone, id);
      if (nameAddrKey) seenNameAddr.set(nameAddrKey, id);
    }
  }

  // Eliminar duplicados
  for (const id of toDelete) {
    delete data.leads[id];
  }

  if (toDelete.length > 0) saveSettersData(data);

  const remaining = Object.keys(data.leads).length;
  res.json({ removed: toDelete.length, remaining });
});

// ── KPI Stats ──
app.get('/api/setters/stats', requireAuth, (req, res) => {
  const { setter } = req.query;
  const data = loadSettersData();
  let leads = Object.values(data.leads);
  const authSetterId = req.auth?.user?.role === 'setter' ? req.auth.user.setterId : '';
  if (authSetterId) {
    leads = leads.filter((l) => l.assignedTo === authSetterId);
  } else if (setter) {
    leads = leads.filter(l => l.assignedTo === setter);
  }

  const total = leads.length;
  const conexiones = leads.filter(l => l.conexion === 'enviada').length;
  const sinWsp = leads.filter(l => l.conexion === 'sin_wsp').length;
  const respondieron = leads.filter(l => l.respondio).length;
  const calificados = leads.filter(l => l.calificado === true).length;
  const interesados = leads.filter(l => l.interes === 'si').length;
  const agendados = leads.filter(l => l.estado === 'agendado').length;
  const cerrados = leads.filter(l => l.estado === 'cerrado').length;
  const totalMessages = leads.reduce((sum, lead) => sum + (Array.isArray(lead.interactions) ? lead.interactions.length : 0), 0);
  const stageCounts = leads.reduce((acc, lead) => {
    for (const it of (lead.interactions || [])) {
      if (it.stage) acc[it.stage] = (acc[it.stage] || 0) + 1;
      if (it.action === 'open') acc.open = (acc.open || 0) + 1;
      if (it.action === 'qualified') acc.qualified = (acc.qualified || 0) + 1;
      if (it.action === 'interest') acc.interest = (acc.interest || 0) + 1;
    }
    return acc;
  }, { open: 0, qualified: 0, interest: 0, apertura: 0, problema: 0, pruebaSocial: 0, cierrePregunta: 0 });

  // Stats por variante
  const byVariant = {};
  for (const v of data.variants) {
    const vLeads = leads.filter(l => l.varianteId === v.id);
    const vConex = vLeads.filter(l => l.conexion === 'enviada').length;
    const vResp = vLeads.filter(l => l.respondio).length;
    const vCal = vLeads.filter(l => l.calificado === true).length;
    const vInt = vLeads.filter(l => l.interes === 'si').length;
    const vMsgs = vLeads.reduce((sum, lead) => sum + (Array.isArray(lead.interactions) ? lead.interactions.length : 0), 0);
    byVariant[v.id] = { name: v.name, total: vLeads.length, conexiones: vConex, respondieron: vResp, calificados: vCal, interesados: vInt, mensajes: vMsgs, usedCount: Number(v.usedCount) || 0 };
  }

  res.json({
    total, conexiones, sinWsp, respondieron, calificados, interesados, agendados, cerrados,
    mensajes: totalMessages,
    stageCounts,
    pctConexion: total > 0 ? ((conexiones / total) * 100).toFixed(1) : '0.0',
    pctApertura: conexiones > 0 ? ((respondieron / conexiones) * 100).toFixed(1) : '0.0',
    pctCalificacion: calificados > 0 ? ((interesados / calificados) * 100).toFixed(1) : '0.0',
    byVariant,
    setters: data.setters,
    variants: data.variants
  });
});

// ── Centro de comando: stats por setter ──
app.get('/api/setters/command', requireAuth, requireRole('admin'), (req, res) => {
  const data = loadSettersData();
  const allLeads = Object.values(data.leads);

  const perSetter = data.setters.map(s => {
    const leads = allLeads.filter(l => l.assignedTo === s.id);
    const total = leads.length;
    const conexiones = leads.filter(l => l.conexion === 'enviada').length;
    const respondieron = leads.filter(l => l.respondio).length;
    const calificados = leads.filter(l => l.calificado === true).length;
    const interesados = leads.filter(l => l.interes === 'si').length;
    const agendados = leads.filter(l => l.estado === 'agendado').length;
    const activeVar = data.variants.find(v => v.setterId === s.id || (Array.isArray(v.sharedWith) && v.sharedWith.includes(s.id))) || data.variants.find(v => v.id === s.activeVariantId);
    // "Mensajes" = leads con WSP enviado + interactions extra loggeadas (no double-count)
    const mensajes = leads.reduce((sum, lead) => {
      const base = lead.conexion === 'enviada' ? 1 : 0;
      const extra = Array.isArray(lead.interactions) ? lead.interactions.filter(it => it.action !== 'open').length : 0;
      return sum + base + extra;
    }, 0);
    const aperturas = leads.reduce((sum, lead) => sum + (lead.interactions || []).filter((it) => it.action === 'open').length, 0);
    const calificaciones = leads.reduce((sum, lead) => sum + (lead.interactions || []).filter((it) => it.action === 'qualified').length, 0);
    const intereses = leads.reduce((sum, lead) => sum + (lead.interactions || []).filter((it) => it.action === 'interest').length, 0);
    return {
      id: s.id, name: s.name, total, conexiones, respondieron, interesados, agendados, mensajes, aperturas, calificaciones, intereses,
      pctConexion: total > 0 ? ((conexiones / total) * 100).toFixed(1) : '0.0',
      pctApertura: conexiones > 0 ? ((respondieron / conexiones) * 100).toFixed(1) : '0.0',
      pctCalificacion: calificados > 0 ? ((interesados / calificados) * 100).toFixed(1) : '0.0',
      activeVariant: activeVar ? activeVar.name : '—'
    };
  }).sort((a, b) => {
    const interestedDiff = (Number(b.interesados) || 0) - (Number(a.interesados) || 0);
    if (interestedDiff !== 0) return interestedDiff;
    const rateDiff = parseFloat(b.pctCalificacion || '0') - parseFloat(a.pctCalificacion || '0');
    if (rateDiff !== 0) return rateDiff;
    return (Number(b.total) || 0) - (Number(a.total) || 0);
  });

  const perVariant = data.variants.map(v => {
    const leads = allLeads.filter(l => l.varianteId === v.id);
    const total = leads.length;
    const conexiones = leads.filter(l => l.conexion === 'enviada').length;
    const respondieron = leads.filter(l => l.respondio).length;
    const calificados = leads.filter(l => l.calificado === true).length;
    const interesados = leads.filter(l => l.interes === 'si').length;
    // "Mensajes" = leads con WSP enviado + interactions extra loggeadas (no double-count)
    const mensajes = leads.reduce((sum, lead) => {
      const base = lead.conexion === 'enviada' ? 1 : 0;
      const extra = Array.isArray(lead.interactions) ? lead.interactions.filter(it => it.action !== 'open').length : 0;
      return sum + base + extra;
    }, 0);
    return {
      id: v.id, name: v.name, setterId: v.setterId || '', blocks: Array.isArray(v.blocks) ? v.blocks : [], total, conexiones, respondieron, calificados, interesados, mensajes,
      pctApertura: conexiones > 0 ? ((respondieron / conexiones) * 100).toFixed(1) : '0.0',
      pctCalificacion: calificados > 0 ? ((interesados / calificados) * 100).toFixed(1) : '0.0'
    };
  });

  const perBlock = data.variants.flatMap((v) => (v.blocks || []).map((b) => ({
    variantId: v.id,
    variantName: v.name,
    id: b.id,
    label: b.label || 'Bloque',
    usedCount: Number(b.usedCount) || 0,
    interestedCount: Number(b.interestedCount) || 0,
    pctInterest: (Number(b.usedCount) || 0) > 0 ? (((Number(b.interestedCount) || 0) / (Number(b.usedCount) || 0)) * 100).toFixed(1) : '0.0'
  }))).sort((a, b) => {
    const interestDiff = b.interestedCount - a.interestedCount;
    if (interestDiff !== 0) return interestDiff;
    const pctDiff = parseFloat(b.pctInterest || '0') - parseFloat(a.pctInterest || '0');
    if (pctDiff !== 0) return pctDiff;
    return b.usedCount - a.usedCount;
  });

  // Totales
  const total = allLeads.length;
  const conexiones = allLeads.filter(l => l.conexion === 'enviada').length;
  const respondieron = allLeads.filter(l => l.respondio).length;
  const calificados = allLeads.filter(l => l.calificado === true).length;
  const interesados = allLeads.filter(l => l.interes === 'si').length;
  const agendados = allLeads.filter(l => l.estado === 'agendado').length;
  const sinWsp = allLeads.filter(l => l.conexion === 'sin_wsp').length;

  // ── Métricas de llamadas (cross-cuts con WSP, agregado separado) ──
  const today = new Date().toISOString().substring(0, 10);
  const callLeads = allLeads.filter(l => l.conexion === 'sin_wsp');
  const totalCalls = callLeads.reduce((s, l) => s + (Array.isArray(l.callLog) ? l.callLog.length : 0), 0);
  let callsToday = 0, answeredToday = 0;
  let callsWithAnswered = 0, callsWithInterested = 0, callsScheduledWithAdmin = 0;
  let phoneDead = 0;
  for (const l of callLeads) {
    if (Array.isArray(l.callLog)) {
      for (const c of l.callLog) {
        if ((c.ts || '').substring(0, 10) === today) {
          callsToday++;
          if (['answered_interested', 'answered_not_interested', 'scheduled_with_admin'].includes(c.outcome)) answeredToday++;
        }
        if (c.outcome === 'answered_interested') callsWithInterested++;
        if (['answered_interested', 'answered_not_interested'].includes(c.outcome)) callsWithAnswered++;
        if (c.outcome === 'scheduled_with_admin') callsScheduledWithAdmin++;
      }
    }
    if (['wrong', 'invalid'].includes(l.phoneStatus)) phoneDead++;
  }
  const calendarEntries = Array.isArray(data.calendar) ? data.calendar : [];
  const callScheduledPending = calendarEntries.filter(e => e.sourceCall && e.calendarioEstado === 'pendiente').length;
  const callScheduledRealized = calendarEntries.filter(e => e.sourceCall && e.calendarioEstado === 'realizada').length;
  const callScheduledNoShow = calendarEntries.filter(e => e.sourceCall && e.calendarioEstado === 'no_show').length;

  // Métricas de llamadas por setter
  const callsPerSetter = data.setters.map(s => {
    const leads = callLeads.filter(l => l.assignedTo === s.id);
    const totalLogs = leads.reduce((sum, l) => sum + (Array.isArray(l.callLog) ? l.callLog.length : 0), 0);
    let callsTodaySetter = 0, interesadosSetter = 0, agendadosSetter = 0;
    for (const l of leads) {
      if (Array.isArray(l.callLog)) {
        for (const c of l.callLog) {
          if ((c.ts || '').substring(0, 10) === today) callsTodaySetter++;
          if (c.outcome === 'answered_interested') interesadosSetter++;
          if (c.outcome === 'scheduled_with_admin') agendadosSetter++;
        }
      }
    }
    return {
      id: s.id, name: s.name,
      leadsAsignados: leads.length,
      totalLlamadas: totalLogs,
      llamadasHoy: callsTodaySetter,
      interesados: interesadosSetter,
      agendados: agendadosSetter,
      pctConversion: totalLogs > 0 ? ((agendadosSetter / totalLogs) * 100).toFixed(1) : '0.0'
    };
  }).filter(s => s.leadsAsignados > 0 || s.totalLlamadas > 0);

  res.json({
    totals: { total, conexiones, respondieron, calificados, interesados, agendados, sinWsp,
      mensajes: allLeads.reduce((sum, lead) => {
        const base = lead.conexion === 'enviada' ? 1 : 0;
        const extra = Array.isArray(lead.interactions) ? lead.interactions.filter(it => it.action !== 'open').length : 0;
        return sum + base + extra;
      }, 0),
      pctConexion: total > 0 ? ((conexiones / total) * 100).toFixed(1) : '0.0',
      pctApertura: conexiones > 0 ? ((respondieron / conexiones) * 100).toFixed(1) : '0.0',
      pctCalificacion: calificados > 0 ? ((interesados / calificados) * 100).toFixed(1) : '0.0'
    },
    callTotals: {
      leadsEnLlamadas: callLeads.length,
      totalLlamadas: totalCalls,
      llamadasHoy: callsToday,
      pctAtendidasHoy: callsToday > 0 ? ((answeredToday / callsToday) * 100).toFixed(1) : '0.0',
      atendidasHistorico: callsWithAnswered,
      interesadosHistorico: callsWithInterested,
      agendadosConAdmin: callsScheduledWithAdmin,
      numerosMuertos: phoneDead,
      agendamientoPendientes: callScheduledPending,
      agendamientoRealizados: callScheduledRealized,
      agendamientoNoShows: callScheduledNoShow,
      // Conversion rate: agendamientos / total llamadas que tuvieron contacto
      pctConversion: callsWithAnswered > 0 ? ((callsScheduledWithAdmin / callsWithAnswered) * 100).toFixed(1) : '0.0',
      // Tasa de números muertos: % de leads en Llamadas con phoneStatus muerto
      pctNumerosMuertos: callLeads.length > 0 ? ((phoneDead / callLeads.length) * 100).toFixed(1) : '0.0'
    },
    callsPerSetter,
    perSetter, perVariant, perBlock,
    setters: data.setters,
    variants: data.variants.map(normalizeVariantRecord)
  });
});

app.get('/api/setters/export', requireAuth, (req, res) => {
  const { setter = '', estado = '' } = req.query;
  const data = loadSettersData();
  let leads = Object.entries(data.leads).map(([id, lead]) => ({ id, ...ensureLeadDefaults(lead) }));
  const authSetterId = req.auth?.user?.role === 'setter' ? req.auth.user.setterId : '';
  if (authSetterId) {
    leads = leads.filter((l) => l.assignedTo === authSetterId);
  } else if (setter) {
    leads = leads.filter((l) => l.assignedTo === setter);
  }
  if (estado) leads = leads.filter((l) => l.estado === estado);

  const csvEscape = (value) => `"${String(value ?? '').replace(/\r?\n/g, ' ').replace(/"/g, '""')}"`;
  const headers = [
    'ID', 'Numero', 'Fecha', 'Nombre', 'Pais', 'Ciudad', 'Telefono', 'WhatsApp', 'Web', 'Doctor', 'Setter', 'Variante', 'Estado', 'Respondio', 'Interes', 'Ultimo Paso', 'Mensajes'
  ];
  const rows = [headers.join(',')];

  leads.forEach((lead) => {
    const setterObj = data.setters.find((s) => s.id === lead.assignedTo);
    const variant = data.variants.find((v) => v.id === lead.varianteId) || (setterObj ? data.variants.find((v) => v.id === setterObj.activeVariantId) : null);
    const whatsappText = makeWhatsAppMessage(variant, 'apertura', lead);
    const whatsapp = buildWhatsAppUrl(lead.phone || lead.webWhatsApp || lead.aiWhatsApp || '', lead.country || '', whatsappText);
    rows.push([
      csvEscape(lead.id),
      csvEscape(lead.num || ''),
      csvEscape(lead.fecha || ''),
      csvEscape(lead.name || ''),
      csvEscape(lead.country || ''),
      csvEscape(lead.city || ''),
      csvEscape(lead.phone || ''),
      csvEscape(whatsapp),
      csvEscape(lead.website || ''),
      csvEscape(lead.doctor || ''),
      csvEscape(setterObj ? setterObj.name : (lead.assignedTo || '')),
      csvEscape(variant ? variant.name : ''),
      csvEscape(lead.estado || ''),
      csvEscape(lead.respondio ? 'SI' : 'NO'),
      csvEscape(lead.interes || ''),
      csvEscape(lead.lastStage || ''),
      csvEscape((lead.interactions || []).length)
    ].join(','));
  });

  const csv = `\uFEFF${rows.join('\n')}`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="setters_export_${Date.now()}.csv"`);
  res.send(csv);
});

// (sin-wsp route moved above :id routes to avoid Express conflict)

// ── Sesiones ──
app.post('/api/setters/sessions/start', requireAuth, (req, res) => {
  const { setter } = req.body;
  const effectiveSetter = req.auth?.user?.role === 'setter' ? req.auth.user.setterId : setter;
  if (!effectiveSetter) return res.status(400).json({ error: "Setter requerido." });
  const data = loadSettersData();
  const active = data.sessions.find(s => s.setter === effectiveSetter && !s.endedAt);
  if (active) return res.json({ session: active, alreadyActive: true });
  const session = { id: `s_${Date.now()}`, setter: effectiveSetter, startedAt: new Date().toISOString(), endedAt: null };
  data.sessions.push(session);
  saveSettersData(data);
  res.json({ session });
});

app.post('/api/setters/sessions/end', requireAuth, async (req, res) => {
  const { setter } = req.body;
  // Snapshot inicial para CALCULAR métricas (lectura solamente). La mutación
  // real de la sesión se hace al final con mutateSettersData para que sea
  // atómica frente a edits concurrentes que ocurran mientras esperamos a la IA.
  const data = loadSettersData();
  const effectiveSetter = req.auth?.user?.role === 'setter' ? req.auth.user.setterId : setter;
  const active = data.sessions.find(s => s.setter === effectiveSetter && !s.endedAt);
  if (!active) return res.status(404).json({ error: "No hay sesión activa." });
  active.endedAt = new Date().toISOString();

  // Resumen de la sesión: contar interacciones del setter en este período
  const start = new Date(active.startedAt).getTime();
  const end = new Date(active.endedAt).getTime();
  const durationMin = Math.max(1, Math.round((end - start) / 60000));

  const leads = Object.values(data.leads || {});
  const setterLeads = leads.filter((l) => l.assignedTo === effectiveSetter);
  let connections = 0, replies = 0, qualified = 0, interested = 0, scheduled = 0, notesAdded = 0, sinWsp = 0;
  const interactionsSnap = [];
  for (const lead of setterLeads) {
    if (Array.isArray(lead.interactions)) {
      for (const it of lead.interactions) {
        const t = new Date(it.createdAt).getTime();
        if (t >= start && t <= end) {
          interactionsSnap.push({ leadName: lead.name, action: it.action, stage: it.stage, at: it.createdAt });
          if (it.action === 'open') connections += 1;
          if (it.action === 'qualified') qualified += 1;
          if (it.action === 'interest') interested += 1;
        }
      }
    }
    if (Array.isArray(lead.notes)) {
      for (const n of lead.notes) {
        if (n.date && new Date(n.date).getTime() >= start && new Date(n.date).getTime() <= end) {
          notesAdded += 1;
        }
      }
    }
    // Contadores aproximados según último estado
    const lc = lead.lastContactAt ? new Date(lead.lastContactAt).getTime() : 0;
    if (lc >= start && lc <= end) {
      if (lead.respondio) replies += 1;
      if (lead.estado === 'agendado') scheduled += 1;
      if (lead.conexion === 'sin_wsp') sinWsp += 1;
    }
  }

  active.summary = {
    durationMin,
    connections,
    replies,
    qualified,
    interested,
    scheduled,
    notesAdded,
    sinWsp,
    totalInteractions: interactionsSnap.length,
  };

  // Resumen narrativo con IA (best-effort, no bloquea si falla)
  active.aiSummary = null;
  try {
    if (qwenKey || mercuryKey) {
      const interactionsList = interactionsSnap.slice(0, 25).map((i) => `- ${new Date(i.at).toLocaleString()}: ${i.action} → ${i.leadName}`).join("\n");
      const prompt = `Sos un coach de un equipo de prospección por WhatsApp. Hacé un mini-resumen (3-5 lineas, español rioplatense, tono cordial pero directo) de la sesión de un setter llamado ${effectiveSetter}.
Datos:
- Duración: ${durationMin} min
- Conexiones enviadas: ${connections}
- Respondieron: ${replies}
- Calificados: ${qualified}
- Interesados: ${interested}
- Agendados: ${scheduled}
- Notas agregadas: ${notesAdded}
- Marcados sin WhatsApp: ${sinWsp}
- Total interacciones: ${interactionsSnap.length}
Interacciones (primeras 25):
${interactionsList || '(ninguna)'}

Escribí: 1) un resumen ejecutivo de qué hizo, 2) un destacado positivo si lo hay, 3) una sugerencia concreta para la próxima sesión. Sin emojis, sin saludos, máximo 5 lineas.`;
      const completion = await ai.chat.completions.create({
        model: AI_MODEL,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 280,
      });
      active.aiSummary = completion.choices?.[0]?.message?.content?.trim() || null;
    }
  } catch (err) {
    console.warn("[sessions/end] IA summary falló:", err.message);
  }

  // Mutación final ATÓMICA: re-cargamos el estado actual (puede haber cambiado
  // mientras esperábamos a la IA) y aplicamos solo los campos de la sesión.
  // Esto evita pisar PATCH a leads que ocurrieron entre el load inicial y este save.
  const sessionPatch = {
    endedAt: active.endedAt,
    summary: active.summary,
    aiSummary: active.aiSummary
  };
  await mutateSettersData((freshData) => {
    const freshActive = freshData.sessions?.find(s => s.setter === effectiveSetter && s.startedAt === active.startedAt && !s.endedAt);
    if (freshActive) {
      Object.assign(freshActive, sessionPatch);
    }
  });
  res.json({ session: active });
});

// Listar sesiones (admin ve todas, setter ve las suyas)
app.get('/api/setters/sessions', requireAuth, (req, res) => {
  const data = loadSettersData();
  const sessions = data.sessions || [];
  const isSetter = req.auth?.user?.role === 'setter';
  const setterId = req.auth?.user?.setterId;
  const filtered = isSetter ? sessions.filter((s) => s.setter === setterId) : sessions;
  // ordenar más recientes primero
  const sorted = [...filtered].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  res.json({ sessions: sorted.slice(0, 50) });
});

// ── Calendario ──
app.get('/api/setters/calendar', requireAuth, (req, res) => {
  const data = loadSettersData();
  const calendar = data.calendar || [];
  const authSetterId = req.auth?.user?.role === 'setter' ? req.auth.user.setterId : '';
  res.json({ calendar: authSetterId ? calendar.filter((entry) => entry.setterId === authSetterId) : calendar });
});

app.post('/api/setters/calendar', requireAuth, (req, res) => {
  const { leadId, fecha, nombre, calendarioEstado, valorProyecto, comision, setterId } = req.body;
  const data = loadSettersData();
  const effectiveSetterId = req.auth?.user?.role === 'setter' ? req.auth.user.setterId : (setterId || '');
  const entry = {
    id: `cal_${Date.now()}`, leadId: leadId || '', fecha: fecha || '', nombre: nombre || '',
    calendarioEstado: calendarioEstado || 'pendiente', valorProyecto: valorProyecto || 0,
    comision: comision || 0, setterId: effectiveSetterId
  };
  data.calendar.push(entry);
  saveSettersData(data);
  res.json({ entry });
});

// GET enriquecido: calendar con info del lead (telefono, ciudad, callLog).
// Va ANTES de los routes con :id para que /enriched no se atrape como param.
app.get('/api/setters/calendar/enriched', requireAuth, (req, res) => {
  const data = loadSettersData();
  const calendar = Array.isArray(data.calendar) ? data.calendar.slice() : [];
  const authSetterId = req.auth?.user?.role === 'setter' ? req.auth.user.setterId : '';
  const filtered = authSetterId ? calendar.filter((e) => e.setterId === authSetterId) : calendar;
  const settersById = {};
  for (const s of (data.setters || [])) settersById[s.id] = s.name;
  const enriched = filtered.map((entry) => {
    const lead = entry.leadId ? data.leads[entry.leadId] : null;
    return {
      ...entry,
      setterName: settersById[entry.setterId] || '',
      lead: lead ? {
        id: entry.leadId,
        name: lead.name,
        phone: lead.phone,
        country: lead.country,
        city: lead.city,
        doctor: lead.doctor,
        notes: lead.notes,
        callAttempts: lead.callAttempts,
        callLog: lead.callLog,
        estado: lead.estado
      } : null
    };
  });
  enriched.sort((a, b) => new Date(a.fecha || 0).getTime() - new Date(b.fecha || 0).getTime());
  res.json({ calendar: enriched });
});

// PATCH: actualizar estado de una entry (admin marca realizada/no-show/cancelada/reagendada)
const CALENDAR_STATES = new Set(['pendiente', 'realizada', 'no_show', 'cancelada', 'reagendada']);
app.patch('/api/setters/calendar/:id', requireAuth, (req, res) => {
  const data = loadSettersData();
  if (!Array.isArray(data.calendar)) data.calendar = [];
  const entry = data.calendar.find((e) => e.id === req.params.id);
  if (!entry) return res.status(404).json({ error: 'Entry no encontrada.' });
  if (req.auth?.user?.role === 'setter' && entry.setterId !== req.auth.user.setterId) {
    return res.status(403).json({ error: 'No autorizado.' });
  }
  if (req.body.calendarioEstado !== undefined) {
    if (!CALENDAR_STATES.has(req.body.calendarioEstado)) {
      return res.status(400).json({ error: `Estado inválido. Esperado uno de: ${[...CALENDAR_STATES].join(', ')}` });
    }
    entry.calendarioEstado = req.body.calendarioEstado;
  }
  if (req.body.fecha !== undefined) entry.fecha = req.body.fecha;
  if (req.body.nombre !== undefined) entry.nombre = String(req.body.nombre).slice(0, 200);
  if (req.body.notas !== undefined) entry.notas = String(req.body.notas).slice(0, 1000);
  if (req.body.valorProyecto !== undefined) entry.valorProyecto = Number(req.body.valorProyecto) || 0;
  if (req.body.comision !== undefined) entry.comision = Number(req.body.comision) || 0;
  saveSettersData(data);
  res.json({ entry });
});

// DELETE: borrar una entry (admin solo)
app.delete('/api/setters/calendar/:id', requireAuth, requireRole('admin'), (req, res) => {
  const data = loadSettersData();
  if (!Array.isArray(data.calendar)) data.calendar = [];
  const before = data.calendar.length;
  data.calendar = data.calendar.filter((e) => e.id !== req.params.id);
  saveSettersData(data);
  res.json({ ok: data.calendar.length < before });
});

// ── Cache de enriquecimiento (evita llamadas duplicadas a Qwen/fetch) ──
const enrichCache = new Map();
const CACHE_TTL = 1000 * 60 * 60; // 1 hora
const CACHE_MAX_SIZE = 500;

// ── Endpoint para enriquecer datos ──
app.post('/api/enrich', requireAuth, requireRole('admin'), enrichLimiter, async (req, res) => {
  let { url, currentPhone, country = '', city = '', location = '' } = req.body;

  if (!url) {
    return res.json({ instagram: "", linkedin: "", facebook: "", email: "", phone: "", owner: "", aiRole: "" });
  }

  // Nos aseguramos que la URL tenga protocolo para que el fetch de node no falle con TypeError
  if (!/^https?:\/\//i.test(url.trim())) {
     url = `https://${url.trim()}`;
  }

  // Cache: si ya enriquecimos esta URL recientemente, devolver directo sin gastar API
  const cacheKey = url.toLowerCase().replace(/\/+$/, '');
  const cached = enrichCache.get(cacheKey);
  if (cached && (Date.now() - cached.ts < CACHE_TTL)) {
    console.log(`Cache HIT para ${url} (ahorrando tokens de IA)`);
    return res.json(cached.data);
  }

  try {
    // Validación SSRF: solo permitir HTTP(S) público
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      return res.json({ instagram: "", linkedin: "", facebook: "", email: "", phone: "", owner: "" });
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return res.json({ instagram: "", linkedin: "", facebook: "", email: "", phone: "", owner: "" });
    }
    const hostname = parsedUrl.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' || hostname.startsWith('10.') || hostname.startsWith('192.168.') || hostname.startsWith('172.') || hostname === '169.254.169.254' || hostname.endsWith('.internal') || hostname.endsWith('.local')) {
      return res.json({ instagram: "", linkedin: "", facebook: "", email: "", phone: "", owner: "" });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache'
      }
    });
    clearTimeout(timeout);

    const html = await response.text();

    const igMatch = html.match(/https?:\/\/(www\.)?instagram\.com\/[a-zA-Z0-9_.]+/i);
    const liMatch = html.match(/https?:\/\/(www\.)?linkedin\.com\/(?:company|in)\/[a-zA-Z0-9_-]+/i);
    const fbMatch = html.match(/https?:\/\/(www\.)?facebook\.com\/[a-zA-Z0-9_.]+/i);
    const emailMatch = html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);

    // Búsqueda de un posible doctor responsable en el texto limpio sin saltos de línea
    const cleanHtml = html.replace(/<[^>]*>?/gm, ' ');
    const singleLineHtml = cleanHtml.replace(/\s+/g, ' ').trim();
    const nameMatch = singleLineHtml.match(/(?:Dr\.?|Dra\.?|Doctor|Doctora)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+(?:de\s+)?(?:la\s+)?[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){0,3})/);
    const foundOwner = nameMatch ? `Dr/a. ${nameMatch[1].trim()}` : "";

    let aiRoleDescription = "";
    let parsed = null;

    // Extraer teléfono y WhatsApp por regex ANTES de decidir si llamar a la IA
    let foundPhone = "";
    if (!currentPhone) {
      const phonePatterns = [
        /(?:tel|phone|teléfono|telefono|fono|móvil|celular|whatsapp)[:\s]*([+\d\s().-]{7,20})/i,
        /href="tel:([^"]+)"/i,
        /(\+\d{1,3}[\s.-]?\(?\d{1,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4})/
      ];
      for (const pattern of phonePatterns) {
        const match = html.match(pattern);
        if (match) {
          foundPhone = match[1].trim();
          break;
        }
      }
    }

    let webWhatsApp = "";
    // Primero intentar wa.me/NUMERO (capturar solo dígitos del path, ignorar query string)
    const waMe = html.match(/https?:\/\/wa\.me\/(\d{7,15})/i);
    // Luego intentar api.whatsapp.com/send?phone=NUMERO
    const waApi = html.match(/https?:\/\/api\.whatsapp\.com\/send\/?\?phone=(\d{7,15})/i);
    if (waMe) {
      webWhatsApp = waMe[1];
    } else if (waApi) {
      webWhatsApp = waApi[1];
    }

    // Decidir si vale la pena llamar a la IA:
    // Solo si NO encontramos WhatsApp por regex Y el texto tiene suficiente contenido (>500 chars)
    const regexFoundWa = !!webWhatsApp;
    const regexFoundOwner = !!foundOwner;
    const textLength = singleLineHtml.length;
    const shouldCallAI = (mercuryKey || qwenKey) && textLength > 500 && !(regexFoundWa && regexFoundOwner);

    if (shouldCallAI) {
      try {
        // Enviar solo lo necesario (menos tokens = menos costo)
        const maxChars = Math.min(textLength, 8000);
        const textToAnalyze = singleLineHtml.substring(0, maxChars);
        const prompt = `Analiza el texto de un sitio web de una clínica/consultorio.

Contexto opcional del lead:
- País: ${country || ''}
- Ciudad: ${city || ''}
- Ubicación buscada: ${location || ''}

REGLAS:
1. Solo extrae datos si están explícitos.
2. WhatsApp: solo si aparece como WhatsApp, Wsp, wa.me o link de WhatsApp.
3. Dueño/doctor: tiene que ser una persona real mencionada en el texto.
4. Si no hay certeza, deja campos vacíos.
5. Genera una apertura humana de WhatsApp basada en este estilo, sin nombrar la clínica ni inventar datos.
6. Podés ajustar levemente el tono si el país o ciudad lo justifican, pero sin exagerar.

Responde SOLO con este JSON:
{
  "found": true/false,
  "owner": "Nombre de la persona o vacío",
  "role": "Rol o cargo exacto o vacío",
  "whatsapp": "Numero solo si es WhatsApp explicito o vacio",
  "openMessage": "Mensaje de apertura listo para WhatsApp",
  "country": "País o vacío",
  "city": "Ciudad o vacío",
  "instagram": "Instagram o vacío",
  "facebook": "Facebook o vacío",
  "linkedin": "LinkedIn o vacío",
  "confidence": "high|medium|low"
}

Texto: ${textToAnalyze}`;

        let aiResponse = null;
        let retries = 3;
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                aiResponse = await ai.chat.completions.create({
                    model: AI_MODEL,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.1,
                    response_format: { type: "json_object" }
                });
                break;
            } catch (err) {
                if (err.status === 429 && attempt < retries) {
                    console.log(`Qwen 429 Rate Limit. Esperando 30 segundos (Intento ${attempt}/${retries})...`);
                    await new Promise(r => setTimeout(r, 30000));
                } else {
                    throw err;
                }
            }
        }

        if (aiResponse && aiResponse.choices && aiResponse.choices[0] && aiResponse.choices[0].message && aiResponse.choices[0].message.content) {
           try {
             parsed = JSON.parse(aiResponse.choices[0].message.content.trim());
           } catch (parseErr) {
             console.error("Error parseando respuesta de IA:", parseErr.message);
             parsed = null;
           }
            if (parsed && parsed.found && (parsed.owner || parsed.name)) {
                const ownerName = parsed.owner || parsed.name;
                const roleName = parsed.role ? ` - ${parsed.role}` : '';
                aiRoleDescription = `${ownerName}${roleName}`;
            } else {
                aiRoleDescription = "N/A - Sin identificar";
            }
        }

      } catch (e) {
        console.error("Qwen Error:", e.message);
        if (e.message && e.message.includes('429')) {
             aiRoleDescription = "IA pausada (Límite temporal)";
        } else {
             aiRoleDescription = "Web no soportada por la IA";
        }
      }
    } else if (!mercuryKey && !qwenKey) {
        aiRoleDescription = "Requiere MERCURY_API_KEY o QWEN_API_KEY en Railway";
    } else if (textLength <= 500) {
        aiRoleDescription = "Página sin contenido útil";
    } else {
        // Regex ya encontró todo, IA innecesaria
        aiRoleDescription = regexFoundOwner ? foundOwner : "N/A - Sin identificar";
        console.log(`Skip IA para ${url} (regex encontró WA:${regexFoundWa} Owner:${regexFoundOwner}) → ahorrando tokens`);
    }

    let aiWhatsApp = "";
    if (parsed && parsed.whatsapp) {
       aiWhatsApp = parsed.whatsapp.replace(/\D/g, "");
    }
    const aiOpenMessage = parsed && parsed.openMessage ? String(parsed.openMessage).trim() : makeOpeningMessage({ country, city });

    const result = {
      instagram: igMatch ? igMatch[0] : "",
      linkedin: liMatch ? liMatch[0] : "",
      facebook: fbMatch ? fbMatch[0] : "",
      email: emailMatch ? emailMatch[0] : "",
      phone: foundPhone,
      webWhatsApp: webWhatsApp,
      aiWhatsApp: aiWhatsApp,
      openMessage: aiOpenMessage,
      country: parsed && parsed.country ? String(parsed.country).trim() : country || '',
      city: parsed && parsed.city ? String(parsed.city).trim() : city || '',
      owner: foundOwner,
      aiRole: aiRoleDescription,
      ownerInstagram: "",
      ownerLinkedin: "",
      ownerFacebook: ""
    };

    // Guardar en cache (con eviction LRU simple)
    if (enrichCache.size >= CACHE_MAX_SIZE) {
      const oldest = enrichCache.keys().next().value;
      enrichCache.delete(oldest);
    }
    enrichCache.set(cacheKey, { ts: Date.now(), data: result });

    res.json(result);

  } catch (err) {
    console.error("Error en /api/enrich para URL:", url, "→", err.message);
    res.json({ instagram: "", linkedin: "", facebook: "", email: "", phone: "", owner: "", openMessage: makeOpeningMessage({ country, city }) });
  }
});

// ══════════════════════════════════════════════════════════════
// ── MÓDULO FAQ / BANCO DE RESPUESTAS ──
// ══════════════════════════════════════════════════════════════
const FAQ_FILE = path.join(DATA_DIR, "faqs.json");

function loadFaqs() {
  try {
    if (fs.existsSync(FAQ_FILE)) return JSON.parse(fs.readFileSync(FAQ_FILE, "utf8"));
  } catch (e) { console.error("Error leyendo faqs:", e); }
  return { entries: [] };
}

function saveFaqs(data) {
  try { fs.writeFileSync(FAQ_FILE, JSON.stringify(data, null, 2), "utf8"); }
  catch (e) { console.error("Error guardando faqs:", e); }
}

// GET /api/faqs — listar con búsqueda opcional
//   sort=usos      (default, más usados primero)
//   sort=top       (mejor ratio funcionaron/usos; requiere usos>=2 para puntuar)
//   sort=recientes (por updatedAt desc)
app.get('/api/faqs', requireAuth, (req, res) => {
  const { q = '', categoria = '', sort = 'usos' } = req.query;
  const data = loadFaqs();
  let entries = data.entries || [];
  if (q.trim()) {
    const lq = q.toLowerCase();
    entries = entries.filter(e =>
      e.pregunta?.toLowerCase().includes(lq) ||
      e.respuesta?.toLowerCase().includes(lq) ||
      (e.tags || []).some(t => t.toLowerCase().includes(lq))
    );
  }
  if (categoria) entries = entries.filter(e => e.categoria === categoria);
  if (sort === 'top') {
    const eff = e => (e.usos || 0) >= 2 ? (e.funcionaron || 0) / (e.usos || 1) : -1;
    entries = [...entries].sort((a, b) => {
      const ea = eff(a), eb = eff(b);
      if (eb !== ea) return eb - ea;
      return (b.usos || 0) - (a.usos || 0);
    });
  } else if (sort === 'recientes') {
    entries = [...entries].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  } else {
    entries = [...entries].sort((a, b) => (b.usos || 0) - (a.usos || 0));
  }
  res.json({ entries });
});

// POST /api/faqs — crear entrada (admin + setters)
// Helper: normaliza el array de variantes (formas alternas de la misma pregunta).
// Acepta array de strings o string con saltos de línea. Trim, dedup, max 10, max 200 chars c/u.
function _faqNormalizeVariantes(input) {
  if (!input) return [];
  const arr = Array.isArray(input) ? input : String(input).split(/\r?\n/);
  const out = [];
  const seen = new Set();
  for (const v of arr) {
    const t = String(v || '').trim().slice(0, 200);
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= 10) break;
  }
  return out;
}

app.post('/api/faqs', requireAuth, (req, res) => {
  const { pregunta, respuesta, categoria = 'general', tags = [], variantId = null, variantes = [] } = req.body;
  if (!pregunta?.trim() || !respuesta?.trim()) return res.status(400).json({ error: 'pregunta y respuesta son requeridas' });
  const data = loadFaqs();
  const entry = {
    id: `faq_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    pregunta: pregunta.trim(),
    respuesta: respuesta.trim(),
    categoria,
    tags: Array.isArray(tags) ? tags : [],
    variantes: _faqNormalizeVariantes(variantes),
    variantId,
    createdBy: req.auth.user.name || req.auth.user.email,
    createdById: req.auth.user.id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    usos: 0,
    funcionaron: 0
  };
  data.entries.push(entry);
  saveFaqs(data);
  res.json({ entry });
});

// POST /api/faqs/import — importar entradas en bulk (admin + setters)
// Body acepta uno de:
//   { entries: [ { pregunta, respuesta, categoria?, tags?, variantes? }, ... ] }   ← JSON
//   { csv: "pregunta,respuesta,categoria,tags\n..." }                              ← CSV
//   { text: "P: ...\nR: ...\n\nP: ...\nR: ...\n" }                                 ← texto plano
//
// Dedup: por pregunta normalizada (case-insensitive, trim) contra el banco existente.
// Devuelve { creadas, omitidas, errores } con detalle.
const VALID_FAQ_CATS = new Set(['precio','objecion','seguimiento','calificacion','general']);

function _faqParseCsv(csv) {
  // CSV minimalista: la primera línea son headers (pregunta, respuesta, categoria, tags, variantes).
  // Soporta valores con comillas dobles para escapar comas. tags y variantes se splittean por ;
  const lines = String(csv).split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return [];
  const splitLine = (line) => {
    const out = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (c === ',' && !inQuotes) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out.map(s => s.trim());
  };
  const headers = splitLine(lines[0]).map(h => h.toLowerCase());
  const idx = (name) => headers.indexOf(name);
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitLine(lines[i]);
    const e = {
      pregunta: cols[idx('pregunta')] || '',
      respuesta: cols[idx('respuesta')] || '',
      categoria: idx('categoria') >= 0 ? cols[idx('categoria')] : 'general',
      tags: idx('tags') >= 0 ? (cols[idx('tags')] || '').split(';').map(t => t.trim()).filter(Boolean) : [],
      variantes: idx('variantes') >= 0 ? (cols[idx('variantes')] || '').split(';').map(t => t.trim()).filter(Boolean) : []
    };
    if (e.pregunta && e.respuesta) out.push(e);
  }
  return out;
}

function _faqParsePlainText(text) {
  // Formato: bloques separados por línea en blanco. Cada bloque tiene "P: ..." y "R: ..." (multilinea OK).
  // Categoria opcional con "C: precio". Tags opcional "T: a, b, c".
  const blocks = String(text).split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
  const out = [];
  for (const block of blocks) {
    const e = { pregunta: '', respuesta: '', categoria: 'general', tags: [], variantes: [] };
    let mode = null;
    for (const line of block.split(/\n/)) {
      const m = line.match(/^\s*(P|R|C|T|V)\s*[:\-]\s*(.*)$/i);
      if (m) {
        mode = m[1].toUpperCase();
        const val = m[2];
        if (mode === 'P') e.pregunta = val;
        else if (mode === 'R') e.respuesta = val;
        else if (mode === 'C') e.categoria = val.toLowerCase().trim();
        else if (mode === 'T') e.tags = val.split(',').map(s => s.trim()).filter(Boolean);
        else if (mode === 'V') e.variantes = val.split('|').map(s => s.trim()).filter(Boolean);
      } else if (mode === 'P') e.pregunta = (e.pregunta + ' ' + line).trim();
      else if (mode === 'R') e.respuesta = (e.respuesta + '\n' + line).trim();
    }
    if (e.pregunta && e.respuesta) out.push(e);
  }
  return out;
}

app.post('/api/faqs/import', requireAuth, (req, res) => {
  const { entries, csv, text } = req.body || {};
  let parsed = [];
  try {
    if (Array.isArray(entries) && entries.length) parsed = entries;
    else if (typeof csv === 'string' && csv.trim()) parsed = _faqParseCsv(csv);
    else if (typeof text === 'string' && text.trim()) parsed = _faqParsePlainText(text);
    else return res.status(400).json({ error: 'Pasá entries (array), csv (string) o text (string).' });
  } catch (e) {
    return res.status(400).json({ error: 'No pude parsear el input: ' + e.message });
  }
  if (!parsed.length) return res.status(400).json({ error: 'No encontré entradas válidas (pregunta + respuesta).' });

  const data = loadFaqs();
  const existingPreguntas = new Set((data.entries || []).map(e => (e.pregunta || '').toLowerCase().trim()));
  const creadas = [];
  const omitidas = [];
  const errores = [];

  for (const raw of parsed) {
    const pregunta = String(raw.pregunta || '').trim();
    const respuesta = String(raw.respuesta || '').trim();
    if (!pregunta || !respuesta) {
      errores.push({ pregunta: pregunta.substring(0, 60), error: 'falta pregunta o respuesta' });
      continue;
    }
    const key = pregunta.toLowerCase();
    if (existingPreguntas.has(key)) {
      omitidas.push({ pregunta: pregunta.substring(0, 60), motivo: 'ya existía' });
      continue;
    }
    const categoria = VALID_FAQ_CATS.has(raw.categoria) ? raw.categoria : 'general';
    const entry = {
      id: `faq_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      pregunta,
      respuesta,
      categoria,
      tags: Array.isArray(raw.tags) ? raw.tags.map(t => String(t).trim()).filter(Boolean) : [],
      variantes: _faqNormalizeVariantes(raw.variantes),
      variantId: null,
      createdBy: req.auth.user.name || req.auth.user.email,
      createdById: req.auth.user.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      usos: 0,
      funcionaron: 0
    };
    data.entries.push(entry);
    existingPreguntas.add(key);
    creadas.push({ id: entry.id, pregunta: entry.pregunta.substring(0, 60), categoria });
  }
  saveFaqs(data);
  res.json({ creadas: creadas.length, omitidas: omitidas.length, errores: errores.length, detalle: { creadas, omitidas, errores } });
});

// PUT /api/faqs/:id — editar (admin o el creador)
app.put('/api/faqs/:id', requireAuth, (req, res) => {
  const data = loadFaqs();
  const idx = data.entries.findIndex(e => e.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'No encontrado' });
  const isAdmin = req.auth.user.role === 'admin';
  const isOwner = data.entries[idx].createdById === req.auth.user.id;
  if (!isAdmin && !isOwner) return res.status(403).json({ error: 'Solo podés editar tus propias entradas' });
  const { pregunta, respuesta, categoria, tags, variantId, variantes } = req.body;
  if (pregunta !== undefined) data.entries[idx].pregunta = pregunta.trim();
  if (respuesta !== undefined) data.entries[idx].respuesta = respuesta.trim();
  if (categoria !== undefined) data.entries[idx].categoria = categoria;
  if (tags !== undefined) data.entries[idx].tags = Array.isArray(tags) ? tags : [];
  if (variantes !== undefined) data.entries[idx].variantes = _faqNormalizeVariantes(variantes);
  if (variantId !== undefined) data.entries[idx].variantId = variantId;
  data.entries[idx].updatedAt = new Date().toISOString();
  saveFaqs(data);
  res.json({ entry: data.entries[idx] });
});

// DELETE /api/faqs/:id (admin o el creador)
app.delete('/api/faqs/:id', requireAuth, (req, res) => {
  const data = loadFaqs();
  const idx = data.entries.findIndex(e => e.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'No encontrado' });
  const isAdmin = req.auth.user.role === 'admin';
  const isOwner = data.entries[idx].createdById === req.auth.user.id;
  if (!isAdmin && !isOwner) return res.status(403).json({ error: 'Solo podés borrar tus propias entradas' });
  data.entries.splice(idx, 1);
  saveFaqs(data);
  res.json({ ok: true });
});

// PATCH /api/faqs/:id/uso — setter usó esta respuesta
app.patch('/api/faqs/:id/uso', requireAuth, (req, res) => {
  const data = loadFaqs();
  const entry = data.entries.find(e => e.id === req.params.id);
  if (!entry) return res.status(404).json({ error: 'No encontrado' });
  entry.usos = (entry.usos || 0) + 1;
  if (req.body.funcionó === true) entry.funcionaron = (entry.funcionaron || 0) + 1;
  saveFaqs(data);
  res.json({ ok: true, usos: entry.usos, funcionaron: entry.funcionaron });
});

// — Retrieval helpers para el Banco de Respuestas —
// Nota: las palabras interrogativas (quien, donde, cuando, como, cual, porque) NO están
// en stopwords a propósito — son señales fuertes de intención del lead y permiten matchear
// "Y a vos quién te conoce?" con "¿Quién sos?".
const FAQ_STOPWORDS_ES = new Set([
  'que','de','la','el','los','las','un','una','unos','unas','y','o','u','a','en','con','por','para','del','al',
  'es','son','soy','eres','ser','este','esta','estos','estas','eso','esa','esto','mi','tu','su','sus','mis','tus',
  'me','te','se','le','les','nos','lo','si','no','ya','muy','mas','pero','tambien','hay','ha','he','han','fue',
  'fui','sera','sin','sobre','entre','hasta','desde','vos','usted','ustedes','tipo','algo','alguien','nada'
]);

function _faqNormalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9\s]/g, ' ');
}
function _faqTokens(s) {
  const set = new Set();
  for (const t of _faqNormalize(s).split(/\s+/)) {
    if (t.length >= 3 && !FAQ_STOPWORDS_ES.has(t)) set.add(t);
  }
  return set;
}
function _faqScore(entry, qTokens, opts = {}) {
  // Sumamos pregunta + respuesta + variantes a la bolsa de tokens del entry.
  const variantesText = Array.isArray(entry.variantes) ? entry.variantes.join(' ') : '';
  const eTokens = _faqTokens((entry.pregunta || '') + ' ' + (entry.respuesta || '') + ' ' + variantesText);
  if (qTokens.size === 0 || eTokens.size === 0) return 0;
  let inter = 0;
  for (const t of qTokens) if (eTokens.has(t)) inter++;
  if (inter === 0) return 0;
  // Cosine sobre sets de tokens
  let score = inter / Math.sqrt(qTokens.size * eTokens.size);
  // Boost por tag coincidente con tokens de la query
  let tagHits = 0;
  for (const tag of (entry.tags || [])) {
    for (const tok of _faqNormalize(tag).split(/\s+/)) {
      if (tok && qTokens.has(tok)) { tagHits++; break; }
    }
  }
  score += Math.min(tagHits, 3) * 0.08;
  // Boost por categoría coincidente
  if (opts.categoria && entry.categoria && entry.categoria === opts.categoria) score += 0.10;
  // Boost por efectividad histórica
  const usos = entry.usos || 0;
  const ok = entry.funcionaron || 0;
  if (usos > 0) score += Math.min(ok / usos, 1) * 0.15;
  // Pequeño boost por popularidad bruta
  score += Math.min(usos / 20, 1) * 0.05;
  return score;
}

// POST /api/faqs/check-duplicate — encuentra entradas similares al crear/editar
// Body: { pregunta, respuesta?, categoria?, excludeId? }
app.post('/api/faqs/check-duplicate', requireAuth, (req, res) => {
  const { pregunta = '', respuesta = '', categoria = '', excludeId = '' } = req.body || {};
  if (!pregunta.trim() && !respuesta.trim()) return res.json({ duplicates: [], threshold: 0.4 });
  const data = loadFaqs();
  const qTokens = _faqTokens(pregunta + ' ' + respuesta);
  const THRESHOLD = 0.4;
  const dupes = (data.entries || [])
    .filter(e => e.id !== excludeId && e.pregunta && e.respuesta)
    .map(e => ({ entry: e, score: _faqScore(e, qTokens, { categoria }) }))
    .filter(x => x.score >= THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(x => ({
      id: x.entry.id,
      pregunta: x.entry.pregunta,
      respuesta: x.entry.respuesta,
      categoria: x.entry.categoria,
      score: Number(x.score.toFixed(3))
    }));
  res.json({ duplicates: dupes, threshold: THRESHOLD });
});

// POST /api/faqs/suggest-tags — IA sugiere categoria + tags para una FAQ
// Body: { pregunta, respuesta }
app.post('/api/faqs/suggest-tags', requireAuth, async (req, res) => {
  const { pregunta = '', respuesta = '' } = req.body || {};
  if (!pregunta.trim()) return res.status(400).json({ error: 'pregunta requerida' });
  if (!mercuryKey && !qwenKey) return res.status(400).json({ error: 'No hay API de IA configurada' });

  const prompt = `Sos un clasificador de FAQs de ventas para una agencia dental (SCM Dental).
Dada una pregunta/objeción y su respuesta, devolvé EXCLUSIVAMENTE un JSON válido con esta forma exacta:
{"categoria":"<una de: precio|objecion|seguimiento|calificacion|general>","tags":["palabra1","palabra2","palabra3"]}

Reglas:
- "categoria": elegí UNA sola, la más representativa.
- "tags": 2 a 5 palabras clave en minúsculas, sin acentos, sin números, sin espacios (usá guiones si es compuesto). Apuntan a temas, objeciones o triggers (ej: "caro", "ya-tengo-marketing", "competencia", "horarios", "agenda").
- No inventes contenido ni agregues texto fuera del JSON. Sin markdown, sin comillas externas, sin explicación.

PREGUNTA: ${pregunta}
RESPUESTA: ${respuesta || '(vacía)'}`;

  try {
    const completion = await ai.chat.completions.create({
      model: AI_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 150
    });
    const raw = completion.choices?.[0]?.message?.content?.trim() || '';
    const m = raw.match(/\{[\s\S]*\}/);
    let parsed = {};
    if (m) { try { parsed = JSON.parse(m[0]); } catch {} }
    const validCats = new Set(['precio','objecion','seguimiento','calificacion','general']);
    const categoria = validCats.has(parsed.categoria) ? parsed.categoria : 'general';
    const tags = Array.isArray(parsed.tags)
      ? parsed.tags
          .map(t => String(t).toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9-]/g, '').trim())
          .filter(t => t.length >= 2 && t.length <= 30)
          .slice(0, 5)
      : [];
    res.json({ categoria, tags });
  } catch (e) {
    console.error('Error FAQ suggest-tags IA:', e.message);
    res.status(500).json({ error: 'Error de IA: ' + e.message });
  }
});

// POST /api/faqs/suggest — IA genera respuesta sugerida basada en ejemplos (admin + setters)
app.post('/api/faqs/suggest', requireAuth, aiLimiter, async (req, res) => {
  const { pregunta, variantId, contexto = '', categoria = '' } = req.body;
  if (!pregunta?.trim()) return res.status(400).json({ error: 'pregunta requerida' });

  if (!mercuryKey && !qwenKey) return res.status(400).json({ error: 'No hay API de IA configurada' });

  // Retrieval: scoring por tokens + tags + categoría + efectividad histórica
  const data = loadFaqs();
  const qTokens = _faqTokens(pregunta);
  const SCORE_THRESHOLD = 0.10;
  const MAX_EXAMPLES = 8;
  const scored = (data.entries || [])
    .filter(e => e.respuesta && e.pregunta)
    .map(e => ({ entry: e, score: _faqScore(e, qTokens, { categoria }) }))
    .filter(x => x.score >= SCORE_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_EXAMPLES);
  const similares = scored.map(x => x.entry);

  // Buscar variante para contexto
  let varianteTexto = '';
  if (variantId) {
    try {
      const settersData = loadSettersData();
      const variant = settersData.variants?.find(v => v.id === variantId);
      if (variant?.blocks?.length) varianteTexto = variant.blocks.map(b => b.text || '').join('\n');
    } catch {}
  }

  const ejemplosTexto = similares.length > 0
    ? similares.map((e, i) => `Ejemplo ${i+1}:\nPregunta: ${e.pregunta}\nRespuesta: ${e.respuesta}`).join('\n\n')
    : 'No hay ejemplos previos similares.';

  // Incluir material del Centro de Entrenamiento como contexto base
  let trainingContext = '';
  try {
    const tData = loadTraining();
    const chunks = (tData.materials || [])
      .map(m => {
        const body = (m.extractedText || m.description || '').trim();
        if (!body) return '';
        return `- ${m.title}:\n${body.substring(0, 1200)}`;
      })
      .filter(Boolean);
    if (chunks.length > 0) {
      trainingContext = `\nMATERIAL DE ENTRENAMIENTO DE LA AGENCIA (usá esta info como base de verdad sobre SCM Dental):\n${chunks.join('\n\n')}\n`;
    }
  } catch {}

  // Inyectar onboarding oficial del equipo (resumen por módulo)
  let onboardingContext = '';
  try {
    const oChunks = ONBOARDING_MODULES.map(m => {
      const text = onboardingTextCache.get(m.num);
      if (!text) return '';
      return `[Módulo ${m.num} — ${m.title}: ${m.subtitle}]\n${text.substring(0, 1500)}`;
    }).filter(Boolean);
    if (oChunks.length > 0) {
      onboardingContext = `\nONBOARDING OFICIAL DEL EQUIPO SCM (base de verdad sobre cómo trabaja el equipo y el sistema):\n${oChunks.join('\n\n')}\n`;
    }
  } catch {}

  const prompt = `Eres un asistente de ventas de SCM Dental, una agencia que ayuda a clínicas dentales a conseguir más pacientes. Tu trabajo es responder objeciones o preguntas de dueños de clínicas dentales (leads) por WhatsApp.
${onboardingContext}${trainingContext}
${varianteTexto ? `MENSAJE INICIAL QUE SE LES ENVIÓ:\n${varianteTexto}\n` : ''}
${contexto ? `CONTEXTO ADICIONAL: ${contexto}\n` : ''}
PREGUNTA/OBJECIÓN DEL LEAD: ${pregunta}

EJEMPLOS DE RESPUESTAS DEL BANCO (priorizá el estilo, tono y argumentos de estos ejemplos — son respuestas validadas del equipo):
${ejemplosTexto}

REGLAS DE FORMATO (críticas):
- Devolvé 1 o 2 bloques de mensaje, separados por UNA línea en blanco (un único \\n\\n entre bloques).
- Cada bloque máximo 2-3 frases (idealmente menos de 280 caracteres).
- Si la respuesta es corta, usá un solo bloque. Si necesita un cierre con pregunta o CTA, usá un segundo bloque corto.
- Tono cercano, profesional, en español rioplatense neutro. Sin emojis salvo que el ejemplo los use.
- Sin markdown, sin viñetas, sin comillas, sin "Hola" ni saludo inicial (ya están en conversación).
- Usá [Nombre del Doctor] o [Nombre de la clínica] como placeholders SOLO si hace falta personalizar.
- Respetá los hechos del material de entrenamiento y onboarding. No inventes precios, plazos ni features.

Devolvé SOLO el/los bloque(s) de texto, nada más.`;

  try {
    const completion = await ai.chat.completions.create({
      model: AI_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      max_tokens: 500
    });
    let sugerencia = completion.choices?.[0]?.message?.content?.trim() || '';
    // Normalizar: colapsar 3+ saltos a doble salto, máximo 2 bloques
    sugerencia = sugerencia.replace(/\n{3,}/g, '\n\n');
    let bloques = sugerencia.split(/\n\n+/).map(b => b.trim()).filter(Boolean);
    if (bloques.length > 2) bloques = bloques.slice(0, 2);
    sugerencia = bloques.join('\n\n');

    // Fallback: si la IA devolvió algo vacío o trunco pero TENEMOS un match fuerte
    // del banco, usar la respuesta literal del top match en vez de devolver vacío.
    let usedFallback = false;
    if ((!sugerencia || bloques.length === 0) && scored.length > 0) {
      console.warn('FAQ suggest: IA devolvió vacío. Usando fallback del banco para:', pregunta.substring(0, 80));
      sugerencia = scored[0].entry.respuesta;
      bloques = sugerencia.split(/\n\n+/).map(b => b.trim()).filter(Boolean);
      usedFallback = true;
    }

    const ejemplos = scored.map(x => ({
      id: x.entry.id,
      pregunta: x.entry.pregunta,
      score: Number(x.score.toFixed(3))
    }));
    res.json({
      sugerencia,
      bloques,
      ejemplosUsados: similares.length,
      ejemplos,
      usedFallback
    });
  } catch (e) {
    console.error('Error FAQ suggest IA:', e.message);
    res.status(500).json({ error: 'Error de IA: ' + e.message });
  }
});

// ══════════════════════════════════════════════════════════════
// ── CENTRO DE ENTRENAMIENTO ──
// Archivos PDF/DOC/TXT/imagen + texto descriptivo para que los
// setters nuevos aprendan. Se guarda binario en /data/training/
// y metadata en training.json. El texto descriptivo se usa como
// contexto adicional para la IA del Banco de Respuestas.
// ══════════════════════════════════════════════════════════════
const TRAINING_FILE = path.join(DATA_DIR, 'training.json');
const TRAINING_DIR = path.join(DATA_DIR, 'training');

function loadTraining() {
  try {
    if (!fs.existsSync(TRAINING_FILE)) return { materials: [] };
    return JSON.parse(fs.readFileSync(TRAINING_FILE, 'utf8'));
  } catch { return { materials: [] }; }
}
function saveTraining(data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(TRAINING_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// GET list
app.get('/api/training', requireAuth, (_req, res) => {
  const data = loadTraining();
  // No devolver base64 en list — sólo metadata
  const materials = (data.materials || []).map(m => ({
    id: m.id, title: m.title, description: m.description || '',
    extractedText: m.extractedText || '',
    fileName: m.fileName || '', mimeType: m.mimeType || '',
    sizeBytes: m.sizeBytes || 0,
    createdBy: m.createdBy || '', createdAt: m.createdAt,
    hasFile: !!m.fileName
  }));
  res.json({ materials });
});

// POST upload (admin)
app.post('/api/training', requireAuth, requireRole('admin'), (req, res) => {
  const { title, description = '', extractedText = '', fileName = '', mimeType = '', fileBase64 = '' } = req.body || {};
  if (!title?.trim()) return res.status(400).json({ error: 'Título requerido.' });
  if (!description.trim() && !extractedText.trim() && !fileBase64) {
    return res.status(400).json({ error: 'Subí un archivo o agregá descripción/texto.' });
  }
  const data = loadTraining();
  const id = `train_${Date.now()}`;
  let storedFileName = '';
  let sizeBytes = 0;
  if (fileBase64 && fileName) {
    try {
      if (!fs.existsSync(TRAINING_DIR)) fs.mkdirSync(TRAINING_DIR, { recursive: true });
      const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      storedFileName = `${id}_${safeName}`;
      const buffer = Buffer.from(fileBase64, 'base64');
      sizeBytes = buffer.length;
      // Límite 10MB
      if (sizeBytes > 10 * 1024 * 1024) return res.status(400).json({ error: 'Archivo supera 10MB.' });
      fs.writeFileSync(path.join(TRAINING_DIR, storedFileName), buffer);
    } catch (e) {
      return res.status(500).json({ error: 'Error guardando archivo: ' + e.message });
    }
  }
  const material = {
    id, title: title.trim(),
    description: description.trim(),
    extractedText: extractedText.trim(),
    fileName: storedFileName,
    originalFileName: fileName,
    mimeType, sizeBytes,
    createdBy: req.auth?.user?.name || req.auth?.user?.email || 'Admin',
    createdAt: new Date().toISOString()
  };
  data.materials = data.materials || [];
  data.materials.push(material);
  saveTraining(data);
  res.json({ ok: true, material: { ...material, hasFile: !!material.fileName } });
});

// GET download
app.get('/api/training/:id/download', requireAuth, (req, res) => {
  const data = loadTraining();
  const m = (data.materials || []).find(x => x.id === req.params.id);
  if (!m || !m.fileName) return res.status(404).json({ error: 'Archivo no encontrado.' });
  const filePath = path.join(TRAINING_DIR, m.fileName);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Archivo faltante en disco.' });
  res.setHeader('Content-Type', m.mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${m.originalFileName || m.fileName}"`);
  fs.createReadStream(filePath).pipe(res);
});

// PATCH update (admin)
app.patch('/api/training/:id', requireAuth, requireRole('admin'), (req, res) => {
  const data = loadTraining();
  const m = (data.materials || []).find(x => x.id === req.params.id);
  if (!m) return res.status(404).json({ error: 'Material no encontrado.' });
  if (req.body.title !== undefined) m.title = String(req.body.title).trim();
  if (req.body.description !== undefined) m.description = String(req.body.description).trim();
  if (req.body.extractedText !== undefined) m.extractedText = String(req.body.extractedText).trim();
  saveTraining(data);
  res.json({ ok: true });
});

// DELETE (admin)
app.delete('/api/training/:id', requireAuth, requireRole('admin'), (req, res) => {
  const data = loadTraining();
  const m = (data.materials || []).find(x => x.id === req.params.id);
  if (!m) return res.status(404).json({ error: 'No encontrado.' });
  if (m.fileName) {
    try { fs.unlinkSync(path.join(TRAINING_DIR, m.fileName)); } catch {}
  }
  data.materials = data.materials.filter(x => x.id !== req.params.id);
  saveTraining(data);
  res.json({ ok: true });
});

// Global error handler — atrapa errores no capturados en rutas async
app.use((err, _req, res, _next) => {
  console.error("Error no capturado:", err);
  if (!res.headersSent) {
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

// ── Módulo WhatsApp Multi-Account ────────────────────────────────────────
// Helpers que reusa el módulo WA (auth, datos)
function verifyCredentialsHelper(email, password) {
  const data = loadAuthData();
  const user = data.users.find((u) => u.email.toLowerCase() === String(email).toLowerCase().trim() && u.status === "active");
  if (!user || !verifyPassword(password, user.password)) return null;
  return { user };
}
function userIdFromSetterIdHelper(setterId) {
  if (!setterId) return null;
  const data = loadAuthData();
  // 1) buscar user con role=setter cuyo setterId matchea
  const setterUser = data.users.find((u) => u.setterId === setterId && u.status === "active");
  if (setterUser) return setterUser.id;
  // 2) si no hay user setter para ese refId (caso típico: admin operando una
  //    cuenta a su propio nombre), rutear al único admin activo
  const admins = data.users.filter((u) => u.role === "admin" && u.status === "active");
  if (admins.length === 1) return admins[0].id;
  return null;
}

// Healthcheck: estado del sistema en tiempo real (admin only)
const SERVER_BOOT_TS = Date.now();
app.get('/api/admin/health', requireAuth, requireRole('admin'), (_req, res) => {
  const checks = {
    server: { ok: true, uptimeSeconds: Math.round((Date.now() - SERVER_BOOT_TS) / 1000), nodeEnv: process.env.NODE_ENV || 'production' },
    data: { ok: true, dir: DATA_DIR, files: {} },
    counts: {},
    ai: { mercury: !!process.env.MERCURY_API_KEY, qwen: !!process.env.QWEN_API_KEY },
    backups: { ok: false, count: 0, latest: null },
    errors: { ok: true, last24hCount: 0, latest: null },
    rateLimit: { activeKeys: rateLimitStore.size }
  };

  // Tamaños de los JSON principales
  const filesToCheck = ['setters.json', 'auth.json', 'history.json', 'faqs.json', 'training.json', 'wa_accounts.json', 'wa_events.json', 'wa_routines.json'];
  for (const f of filesToCheck) {
    const fp = path.join(DATA_DIR, f);
    if (fs.existsSync(fp)) {
      const stat = fs.statSync(fp);
      checks.data.files[f] = { sizeBytes: stat.size, sizeMb: (stat.size / 1024 / 1024).toFixed(2), modifiedAt: stat.mtime.toISOString() };
    } else {
      checks.data.files[f] = null;
    }
  }

  // Counts de negocio
  try {
    const settersData = loadSettersData();
    const allLeads = Object.values(settersData.leads || {});
    checks.counts.leads = allLeads.length;
    checks.counts.sinWsp = allLeads.filter(l => l.conexion === 'sin_wsp').length;
    checks.counts.interesados = allLeads.filter(l => l.interes === 'si').length;
    checks.counts.agendados = allLeads.filter(l => l.estado === 'agendado').length;
    const cal = settersData.calendar || [];
    const now = Date.now();
    checks.counts.calendarPendientes = cal.filter(e => e.calendarioEstado === 'pendiente').length;
    checks.counts.calendarAtrasados = cal.filter(e => e.calendarioEstado === 'pendiente' && e.fecha && new Date(e.fecha).getTime() < now).length;
    checks.counts.setters = (settersData.setters || []).length;
    checks.counts.variants = (settersData.variants || []).length;
  } catch (e) {
    checks.data.ok = false;
    checks.data.error = e.message;
  }
  try {
    const authData = loadAuthData();
    checks.counts.users = (authData.users || []).filter(u => u.status === 'active').length;
    checks.counts.activeSessions = (authData.sessions || []).filter(s => !s.expiresAt || new Date(s.expiresAt).getTime() > Date.now()).length;
  } catch {}
  try {
    const history = loadHistory();
    checks.counts.historyEntries = Object.keys(history.entries || {}).length;
  } catch {}

  // Backups
  try {
    if (fs.existsSync(BACKUPS_DIR)) {
      const list = fs.readdirSync(BACKUPS_DIR).filter(n => fs.statSync(path.join(BACKUPS_DIR, n)).isDirectory()).sort();
      checks.backups.count = list.length;
      if (list.length > 0) {
        const latest = list[list.length - 1];
        const latestPath = path.join(BACKUPS_DIR, latest);
        const stat = fs.statSync(latestPath);
        checks.backups.latest = { name: latest, createdAt: stat.mtime.toISOString(), ageHours: ((Date.now() - stat.mtime.getTime()) / 1000 / 3600).toFixed(1) };
        // Si el último backup tiene > 8 hs, es un warning (debería correr cada 6)
        checks.backups.ok = (Date.now() - stat.mtime.getTime()) < 8 * 60 * 60 * 1000;
      }
    }
  } catch (e) { checks.backups.error = e.message; }

  // Errores recientes
  try {
    if (fs.existsSync(ERROR_LOG)) {
      const content = fs.readFileSync(ERROR_LOG, 'utf8');
      const lines = content.split('\n').filter(Boolean);
      const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
      let count24h = 0, latest = null;
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const e = JSON.parse(lines[i]);
          const t = new Date(e.ts).getTime();
          if (t < dayAgo) break;
          count24h++;
          if (!latest) latest = { ts: e.ts, message: (e.message || '').substring(0, 200), path: e.path };
        } catch {}
      }
      checks.errors.last24hCount = count24h;
      checks.errors.latest = latest;
      checks.errors.ok = count24h < 50; // alerta si > 50 errores en 24h
    }
  } catch (e) { checks.errors.error = e.message; }

  // Status global
  const allOk = checks.server.ok && checks.data.ok && checks.backups.ok && checks.errors.ok;
  const status = allOk ? 'healthy' : (checks.data.ok && checks.errors.ok ? 'degraded' : 'unhealthy');
  res.json({ status, checks, generatedAt: new Date().toISOString() });
});

// Endpoint admin para ver errores recientes
app.get('/api/admin/errors/recent', requireAuth, requireRole('admin'), (_req, res) => {
  try {
    if (!fs.existsSync(ERROR_LOG)) return res.json({ errors: [], total: 0 });
    const content = fs.readFileSync(ERROR_LOG, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    const recent = lines.slice(-100).reverse().map(l => { try { return JSON.parse(l); } catch { return { raw: l }; } });
    res.json({ errors: recent, total: lines.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Express error handler global (DEBE ir DESPUÉS de todas las rutas)
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  logError(err, {
    path: req.path,
    method: req.method,
    userId: req.auth?.user?.id,
    role: req.auth?.user?.role
  });
  res.status(err.status || 500).json({ error: err.message || 'Error interno' });
});

// En tests, NODE_ENV=test → no levantamos listener, sólo exportamos `app`.
let server = null;
if (process.env.NODE_ENV !== "test") {
  server = app.listen(PORT, () => {
    console.log(`🚀 Servidor ejecutándose en http://localhost:${PORT}`);
    console.log("👉 Abre ese enlace en tu navegador para usar el panel de extracción.");
  });
}

mountWa(app, server, {
  dataDir: DATA_DIR,
  jwtSecret: process.env.JWT_SECRET || (process.env.ADMIN_PASSWORD || "change-me-in-prod") + "_wa",
  requireAuth,
  requireRole,
  getSessionFromRequest,
  verifyCredentials: verifyCredentialsHelper,
  userIdFromSetterId: userIdFromSetterIdHelper,
});

export { app, buildWhatsAppUrl, digitsHaveKnownPrefix };

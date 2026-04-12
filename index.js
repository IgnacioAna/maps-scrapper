import dotenv from "dotenv";
import { getJson } from "serpapi";
import path from "path";
import fs from "fs";
import express from "express";
import OpenAI from "openai";
import crypto from "crypto";

dotenv.config();
const apiKey = process.env.API_KEY;

const app = express();
const PORT = process.env.PORT || 3000;

// Configurar Qwen (a través de OpenRouter dado que la clave empieza con sk-or-v1-)
const ai = new OpenAI({
  apiKey: process.env.QWEN_API_KEY || "missing_key",
  baseURL: "https://openrouter.ai/api/v1",
  defaultHeaders: {
    "HTTP-Referer": "http://localhost:3000", // OpenRouter requiere un referer
    "X-Title": "GoogleScraper"
  }
});

// Middleware
app.use(express.json({ limit: '50mb' }));

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
      // Purgar sesiones expiradas para evitar crecimiento indefinido
      const now = Date.now();
      const beforeCount = raw.sessions.length;
      raw.sessions = raw.sessions.filter((s) => !s.expiresAt || new Date(s.expiresAt).getTime() > now);
      if (raw.sessions.length < beforeCount) {
        try { fs.writeFileSync(AUTH_FILE, JSON.stringify(raw, null, 2), "utf8"); } catch {}
      }
      return raw;
    }
  } catch (e) {
    console.error("Error leyendo auth data:", e);
  }
  return defaultAuthData();
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

function attachAuth(req, _res, next) {
  req.auth = getSessionFromRequest(req);
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
  return lead;
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

function buildWhatsAppUrl(phone, country, message = '') {
  if (!phone) return '';
  let digits = String(phone).replace(/\D/g, '');
  if (!digits) return '';
  const prefixMap = {
    Argentina: '54', Chile: '56', Uruguay: '598', Colombia: '57', México: '52', Perú: '51', Ecuador: '593', Paraguay: '595', Bolivia: '591', Venezuela: '58', 'Costa Rica': '506', Panamá: '507', 'República Dominicana': '1', España: '34', 'Estados Unidos': '1', Brasil: '55'
  };
  const prefix = prefixMap[country] || '';
  if (phone.trim().startsWith('+')) {
    return `https://wa.me/${digits}${message ? `?text=${encodeURIComponent(message)}` : ''}`;
  }
  if (prefix && digits.startsWith(prefix) && digits.length >= prefix.length + 8) {
    return `https://wa.me/${digits}${message ? `?text=${encodeURIComponent(message)}` : ''}`;
  }
  if (digits.startsWith('0')) digits = digits.substring(1);
  if (prefix === '54' && !digits.startsWith('9') && digits.length >= 10) digits = `9${digits}`;
  return `https://wa.me/${prefix || '1'}${digits}${message ? `?text=${encodeURIComponent(message)}` : ''}`;
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

app.post('/api/auth/login', (req, res) => {
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
  const fromEmail = process.env.INVITE_FROM_EMAIL || 'Maps Scraper Pro <onboarding@resend.dev>';
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: fromEmail,
        to: [toEmail],
        subject: `${toName}, te invitaron a Maps Scraper Pro`,
        html: `
          <div style="font-family:sans-serif; max-width:480px; margin:0 auto; padding:24px;">
            <h2 style="color:#1e1f20;">Hola ${toName}!</h2>
            <p>Te invitaron a unirte a <strong>Maps Scraper Pro</strong> como <strong>${role}</strong>.</p>
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
app.get('/api/admin/export-data', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const history = loadHistory();
    const auth = loadAuthData();
    const setters = loadSettersData();
    res.json({
      exportedAt: new Date().toISOString(),
      history,
      auth,
      setters
    });
  } catch (e) {
    console.error('Export error:', e);
    res.status(500).json({ error: 'Error exportando data' });
  }
});

// ── Admin: Importar data (restore después de deploy) ──
app.post('/api/admin/import-data', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const { history, auth, setters } = req.body;
    if (history) saveHistory(history);
    if (auth) saveAuthData(auth);
    if (setters) saveSettersData(setters);
    res.json({ ok: true, message: 'Data importada correctamente' });
  } catch (e) {
    console.error('Import error:', e);
    res.status(500).json({ error: 'Error importando data' });
  }
});

// API de Apify (Buscador de Instagram Puro)
app.post('/api/apify-scrape', requireAuth, requireRole('admin'), async (req, res) => {
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
  for (const file of ['history.json', 'auth.json', 'setters.json']) {
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
async function searchLocation(query, location, maxPages, startPage = 1) {
  const results = [];
  const limit = Math.min(Math.max(1, parseInt(maxPages)), 100); // Permitir hasta 100 pags por query
  let hasMoreResults = false;

  const basePageOffset = Math.max(0, parseInt(startPage) - 1);

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
            unclaimed: item.unclaimed_listing ? "Sí (Oportunidad)" : "Reclamado",
            locationSearched: location || "General",
            country,
            city
          };
        });

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
app.post('/api/scrape', requireAuth, requireRole('admin'), async (req, res) => {
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

    // Filtrar: remover sin teléfono Y sin sitio web
    const contactableResults = allResults.filter(item => item.phone || item.website);
    const removed = allResults.length - contactableResults.length;

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
    return res.status(500).json({ error: errError.message || errError });
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
  const data = loadSettersData();
  const setter = data.setters.find(s => s.id === req.params.id);
  if (!setter) return res.status(404).json({ error: 'Setter no encontrado.' });

  data.setters = data.setters.filter(s => s.id !== req.params.id);
  data.variants = data.variants.map((variant) => {
    if (variant.setterId === req.params.id) variant.setterId = '';
    return variant;
  });
  saveSettersData(data);
  res.json({ ok: true });
});

// ── Variantes CRUD (compartidas) ──
app.get('/api/setters/variants', (req, res) => {
  const data = loadSettersData();
   res.json({ variants: data.variants.map(normalizeVariantRecord) });
});

app.post('/api/setters/variants', requireAuth, requireRole('admin'), (req, res) => {
  const { name, weekLabel, setterId, blocks = [], active = true } = req.body;
  if (!name) return res.status(400).json({ error: "Nombre requerido." });
  const data = loadSettersData();
  const variant = normalizeVariantRecord({
    id: `var_${Date.now()}`,
    name,
    weekLabel: weekLabel || '',
    setterId: setterId || '',
    active,
    blocks,
    createdAt: new Date().toISOString()
  });
  data.variants.push(variant);
  saveSettersData(data);
  res.json({ variant, variants: data.variants });
});

app.patch('/api/setters/variants/:id', requireAuth, requireRole('admin'), (req, res) => {
  const data = loadSettersData();
  const v = data.variants.find(v => v.id === req.params.id);
  if (!v) return res.status(404).json({ error: "Variante no encontrada." });
  if (req.body.name) v.name = req.body.name;
  if (req.body.weekLabel) v.weekLabel = req.body.weekLabel;
  if (req.body.setterId !== undefined) v.setterId = req.body.setterId;
  if (req.body.blocks) v.blocks = req.body.blocks.map((block, index) => normalizeBlockRecord(block, index)).filter((block) => block.text);
  if (req.body.messages) v.blocks = variantBlocksFromMessages({ ...v.messages, ...req.body.messages });
  if (req.body.active !== undefined) v.active = req.body.active;
  Object.assign(v, normalizeVariantRecord(v));
  if (req.body.active !== undefined) v.active = req.body.active;
  saveSettersData(data);
  res.json({ variant: v });
});

app.delete('/api/setters/variants/:id', requireAuth, requireRole('admin'), (req, res) => {
  const data = loadSettersData();
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

app.post('/api/setters/import', requireAuth, requireRole('admin'), (req, res) => {
  try {
  const { leads: incoming, assignTo } = req.body;
  if (!incoming || !Array.isArray(incoming) || incoming.length === 0) {
    return res.status(400).json({ error: "No hay leads para importar." });
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
      interes: null,
      estado: 'sin_contactar',
      notes: [],
      interactions: [],
      importedAt: now.toISOString(),
      lastContactAt: null
    });
    // Si ya viene con URL de WhatsApp completa (del CSV), usarla; si no, construirla
    baseLead.whatsappUrl = importedWaUrl || buildWhatsAppUrl(baseLead.phone || baseLead.webWhatsApp || baseLead.aiWhatsApp || '', baseLead.country || country || '', importedOpenMsg);
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

// ── Borrar todos los leads de un setter (para reimportar limpio) ──
app.delete('/api/setters/leads-bulk', requireAuth, requireRole('admin'), (req, res) => {
  const { setter } = req.body;
  const data = loadSettersData();
  let removed = 0;
  for (const id in data.leads) {
    if (!setter || data.leads[id].assignedTo === setter) {
      delete data.leads[id];
      removed++;
    }
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
  const allowed = ['conexion', 'apertura', 'respondio', 'interes', 'doctor', 'decisor', 'estado', 'assignedTo', 'varianteId'];
  for (const field of allowed) {
    if (req.body[field] !== undefined) lead[field] = req.body[field];
  }
  // Guardar fecha del primer contacto
  if (req.body.conexion === 'enviada' && !lead.fechaContacto) {
    lead.fechaContacto = new Date().toISOString().substring(0, 10);
  }
  if (req.body.varianteId !== undefined && req.body.varianteId !== lead.varianteId) {
    incrementVariantUsage(data, req.body.varianteId || '');
  }
  // Si resetean conexion, limpiar fecha
  if (req.body.conexion === '' || req.body.conexion === null) {
    lead.fechaContacto = null;
  }
  if (req.body.conexion === 'enviada' || req.body.respondio || req.body.interes) {
    lead.lastContactAt = new Date().toISOString();
  }
  // Si marcan sin_wsp, mover a estado sin_wsp
  if (req.body.conexion === 'sin_wsp') {
    lead.estado = 'sin_wsp';
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
  const { step } = req.body;
  const valid = ['24hs', '48hs', '72hs', '7d', '15d'];
  if (!valid.includes(step)) return res.status(400).json({ error: "Step inválido." });
  const data = loadSettersData();
  const lead = data.leads[req.params.id];
  if (!lead) return res.status(404).json({ error: "Lead no encontrado." });
  if (req.auth?.user?.role === 'setter' && lead.assignedTo !== req.auth.user.setterId) {
    return res.status(403).json({ error: "No autorizado para este lead." });
  }
  if (!lead.followUps) lead.followUps = { '24hs': false, '48hs': false, '72hs': false, '7d': false, '15d': false };
  lead.followUps[step] = !lead.followUps[step];
  lead.lastContactAt = new Date().toISOString();
  saveSettersData(data);
  res.json({ ok: true, followUps: lead.followUps });
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

app.delete('/api/setters/leads/:id', requireAuth, requireRole('admin'), (req, res) => {
  const data = loadSettersData();
  if (data.leads[req.params.id]) { delete data.leads[req.params.id]; saveSettersData(data); }
  res.json({ ok: true });
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
  const calificados = leads.filter(l => (l.interactions || []).some((it) => it.action === 'qualified') || l.estado === 'respondio').length;
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
    const vCal = vLeads.filter(l => (l.interactions || []).some((it) => it.action === 'qualified') || l.estado === 'respondio').length;
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
    const calificados = leads.filter(l => (l.interactions || []).some((it) => it.action === 'qualified') || l.estado === 'respondio').length;
    const interesados = leads.filter(l => l.interes === 'si').length;
    const agendados = leads.filter(l => l.estado === 'agendado').length;
    const activeVar = data.variants.find(v => v.setterId === s.id) || data.variants.find(v => v.id === s.activeVariantId);
    const mensajes = leads.reduce((sum, lead) => sum + (Array.isArray(lead.interactions) ? lead.interactions.length : 0), 0);
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
    const calificados = leads.filter(l => (l.interactions || []).some((it) => it.action === 'qualified') || l.estado === 'respondio').length;
    const interesados = leads.filter(l => l.interes === 'si').length;
    const mensajes = leads.reduce((sum, lead) => sum + (Array.isArray(lead.interactions) ? lead.interactions.length : 0), 0);
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
  const calificados = allLeads.filter(l => (l.interactions || []).some((it) => it.action === 'qualified') || l.estado === 'respondio').length;
  const interesados = allLeads.filter(l => l.interes === 'si').length;
  const agendados = allLeads.filter(l => l.estado === 'agendado').length;
  const sinWsp = allLeads.filter(l => l.conexion === 'sin_wsp').length;

  res.json({
    totals: { total, conexiones, respondieron, calificados, interesados, agendados, sinWsp,
      mensajes: allLeads.reduce((sum, lead) => sum + (Array.isArray(lead.interactions) ? lead.interactions.length : 0), 0),
      pctConexion: total > 0 ? ((conexiones / total) * 100).toFixed(1) : '0.0',
      pctApertura: conexiones > 0 ? ((respondieron / conexiones) * 100).toFixed(1) : '0.0',
      pctCalificacion: calificados > 0 ? ((interesados / calificados) * 100).toFixed(1) : '0.0'
    },
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

// Leads sin WSP (para vista de llamadas)
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

app.post('/api/setters/sessions/end', requireAuth, (req, res) => {
  const { setter } = req.body;
  const data = loadSettersData();
  const effectiveSetter = req.auth?.user?.role === 'setter' ? req.auth.user.setterId : setter;
  const active = data.sessions.find(s => s.setter === effectiveSetter && !s.endedAt);
  if (!active) return res.status(404).json({ error: "No hay sesión activa." });
  active.endedAt = new Date().toISOString();
  saveSettersData(data);
  res.json({ session: active });
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

// ── Cache de enriquecimiento (evita llamadas duplicadas a Qwen/fetch) ──
const enrichCache = new Map();
const CACHE_TTL = 1000 * 60 * 60; // 1 hora
const CACHE_MAX_SIZE = 500;

// ── Endpoint para enriquecer datos ──
app.post('/api/enrich', requireAuth, requireRole('admin'), async (req, res) => {
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
    const shouldCallAI = process.env.QWEN_API_KEY && textLength > 500 && !(regexFoundWa && regexFoundOwner);

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
                    model: 'qwen/qwen3.6-plus:free',
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
    } else if (!process.env.QWEN_API_KEY) {
        aiRoleDescription = "Requiere clave de Qwen en .env";
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

// Global error handler — atrapa errores no capturados en rutas async
app.use((err, _req, res, _next) => {
  console.error("Error no capturado:", err);
  if (!res.headersSent) {
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor ejecutándose en http://localhost:${PORT}`);
  console.log("👉 Abre ese enlace en tu navegador para usar el panel de extracción.");
});

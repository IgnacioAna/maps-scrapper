/**
 * persona-generator.js
 *
 * Genera una "persona ficticia" para cada cuenta inscrita en el warming
 * network. La persona es DETERMINÍSTICA por accountId — la misma cuenta
 * recibe siempre la misma persona, así su estilo conversacional es
 * consistente para todas las otras cuentas con las que chatea.
 *
 * Una persona define:
 *   - Nombre ficticio (para que el LLM se refiera consistente al "yo")
 *   - Edad (afecta vocabulario y tono)
 *   - Ubicación (Buenos Aires, Córdoba, Rosario, etc.)
 *   - Ocupación genérica (NO mentar SCM ni dental para evitar artificios)
 *   - 3-5 intereses (afectan los topics de conversación)
 *   - Estilo de mensajes (corto/medio/largo, formal/casual, emojis)
 *   - Hora pico de actividad (mañanero, vespertino, nocturno)
 *   - Velocidad de respuesta (rápida/media/lenta)
 *
 * Esto NO se le muestra a la cuenta dueña (Paula no ve "tu cuenta es
 * María de Córdoba"). Se usa solo internamente para que el LLM genere
 * mensajes coherentes con esa persona.
 */

// Hash determinístico FNV-1a (32 bits)
function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Mulberry32 PRNG
function makePrng(seed) {
  let s = seed >>> 0;
  return function rand() {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rand, arr) {
  return arr[Math.floor(rand() * arr.length)];
}

function pickN(rand, arr, n) {
  const copy = arr.slice();
  const out = [];
  for (let i = 0; i < n && copy.length > 0; i++) {
    const idx = Math.floor(rand() * copy.length);
    out.push(copy[idx]);
    copy.splice(idx, 1);
  }
  return out;
}

// ===== POOLS =====

const FIRST_NAMES_M = [
  "Martín", "Diego", "Federico", "Lucas", "Tomás", "Nicolás", "Mateo", "Joaquín",
  "Santiago", "Iván", "Bruno", "Alejandro", "Ezequiel", "Gonzalo", "Sebastián",
  "Facundo", "Pablo", "Hernán", "Agustín", "Gabriel", "Cristian", "Damián",
  "Leandro", "Maxi", "Rodrigo", "Andrés", "Marcos", "Emiliano",
];

const FIRST_NAMES_F = [
  "Camila", "Sofía", "Lucía", "Valentina", "Florencia", "Carolina", "Antonella",
  "Julieta", "Martina", "Agustina", "Micaela", "Daniela", "Romina", "Brenda",
  "Mariana", "Natalia", "Ana", "Belén", "Paula", "Victoria", "Luciana",
  "Catalina", "Mercedes", "Bianca", "Rocío", "Tamara", "Gisela",
];

const CITIES = [
  "Buenos Aires", "Córdoba", "Rosario", "Mendoza", "La Plata", "Mar del Plata",
  "Tucumán", "Salta", "Santa Fe", "Neuquén", "Bahía Blanca", "Resistencia",
  "Posadas", "Paraná", "San Juan", "Río Cuarto", "Tandil", "Bariloche",
];

const OCCUPATIONS = [
  "trabaja en una oficina",
  "tiene un kiosco",
  "es contador",
  "trabaja en logística",
  "vende ropa online",
  "es profesor",
  "trabaja en construcción",
  "es médico",
  "trabaja en un banco",
  "es diseñador",
  "trabaja en una pyme",
  "es empleado público",
  "tiene un emprendimiento",
  "es vendedor",
  "trabaja en sistemas",
  "es agente de seguros",
  "tiene un local de comida",
  "trabaja en un call center",
  "es arquitecto",
  "trabaja desde casa",
];

const INTERESTS = [
  "fútbol", "el asado", "la pesca", "el running", "el gym", "los autos",
  "ver series en Netflix", "cocinar", "los viajes", "la música",
  "las plantas", "leer libros", "el cine", "el yoga", "andar en bici",
  "los mates con amigos", "ir al teatro", "los conciertos", "ir a la cancha",
  "los videojuegos", "la fotografía", "el camping", "la jardinería",
  "salir a comer afuera", "los perros", "los gatos", "la moda",
  "las redes sociales", "los podcasts", "el básquet", "el tenis",
];

const MESSAGE_STYLES = [
  { name: "corto-casual",      avgLen: 25,  emojiRate: 0.25, formality: "casual" },
  { name: "medio-amistoso",    avgLen: 50,  emojiRate: 0.30, formality: "casual" },
  { name: "largo-detallista",  avgLen: 90,  emojiRate: 0.20, formality: "casual" },
  { name: "telegrama",         avgLen: 15,  emojiRate: 0.10, formality: "directo" },
  { name: "expresivo",         avgLen: 55,  emojiRate: 0.50, formality: "casual" },
  { name: "formal-medio",      avgLen: 60,  emojiRate: 0.05, formality: "neutral" },
];

const ACTIVE_WINDOWS = [
  { name: "mañanero",  peakStart: 8,  peakEnd: 12, secondaryStart: 19, secondaryEnd: 21 },
  { name: "diurno",    peakStart: 11, peakEnd: 17, secondaryStart: 20, secondaryEnd: 22 },
  { name: "vespertino",peakStart: 17, peakEnd: 22, secondaryStart: 12, secondaryEnd: 14 },
  { name: "nocturno",  peakStart: 20, peakEnd: 24, secondaryStart: 14, secondaryEnd: 16 },
  { name: "balanceado",peakStart: 9,  peakEnd: 22, secondaryStart: -1, secondaryEnd: -1 },
];

const REPLY_SPEEDS = [
  { name: "rápido",    minMin: 1,    maxMin: 30,    description: "responde casi al toque" },
  { name: "medio",     minMin: 5,    maxMin: 180,   description: "tarda algunas horas a veces" },
  { name: "lento",     minMin: 30,   maxMin: 480,   description: "no siempre está mirando WA" },
  { name: "irregular", minMin: 2,    maxMin: 720,   description: "a veces responde rápido, a veces tarda muchísimo" },
];

// ===== GENERATOR =====

/**
 * Genera la persona ficticia para una cuenta. Determinístico por accountId.
 *
 * @param {string} accountId
 * @returns {object} persona
 */
export function personaFor(accountId) {
  const seed = hashSeed(`scm-warming-persona-v1::${accountId}`);
  const rand = makePrng(seed);

  // Género: 50/50 (ocasionalmente "no binarie" en el futuro, no por ahora)
  const isFemale = rand() < 0.5;
  const firstName = isFemale ? pick(rand, FIRST_NAMES_F) : pick(rand, FIRST_NAMES_M);

  // Edad: 22-55 con sesgo a 25-40
  const age = 22 + Math.floor(rand() * 34);

  const city = pick(rand, CITIES);
  const occupation = pick(rand, OCCUPATIONS);
  const interestsCount = 3 + Math.floor(rand() * 3); // 3-5 intereses
  const interests = pickN(rand, INTERESTS, interestsCount);

  const style = pick(rand, MESSAGE_STYLES);
  const activeWindow = pick(rand, ACTIVE_WINDOWS);
  const replySpeed = pick(rand, REPLY_SPEEDS);

  return {
    accountId,
    seed,
    name: firstName,
    age,
    gender: isFemale ? "F" : "M",
    city,
    occupation,
    interests,
    style: style.name,
    styleConfig: style,
    activeWindow: activeWindow.name,
    activeWindowConfig: activeWindow,
    replySpeed: replySpeed.name,
    replySpeedConfig: replySpeed,
    // Hash visible (debug / logs)
    seedHex: seed.toString(16),
  };
}

/**
 * Construye una descripción narrativa de la persona, lista para inyectar
 * en un system prompt de LLM.
 *
 * @param {object} persona
 * @returns {string}
 */
export function personaPromptDescription(persona) {
  const { name, age, gender, city, occupation, interests, styleConfig, activeWindowConfig, replySpeedConfig } = persona;
  const genderText = gender === "F" ? "mujer" : "varón";
  const interestsText = interests.length > 1
    ? `${interests.slice(0, -1).join(", ")} y ${interests[interests.length - 1]}`
    : interests[0];

  return [
    `Sos ${name}, ${genderText} argentina/o de ${age} años, vivís en ${city}.`,
    `${occupation[0].toUpperCase() + occupation.slice(1)}.`,
    `Te gusta(n) ${interestsText}.`,
    `Tu estilo de mensajes es "${styleConfig.name}" — mensajes de ~${styleConfig.avgLen} caracteres en promedio, ${styleConfig.formality}.`,
    activeWindowConfig.peakEnd > 0
      ? `Solés estar más activa/o en WhatsApp entre las ${activeWindowConfig.peakStart} y las ${activeWindowConfig.peakEnd}hs.`
      : "Estás disponible durante todo el día.",
    `Cuando te escriben, ${replySpeedConfig.description}.`,
    "Sos argentina/o real, no usás lunfardo extremo ni 'ché' artificial. Hablás casual y natural, como en chats reales con conocidos.",
  ].join(" ");
}

/**
 * Test helper: 2 cuentas distintas dan personas distintas.
 * @param {string} aId
 * @param {string} bId
 */
export function personasAreDifferent(aId, bId) {
  const a = personaFor(aId);
  const b = personaFor(bId);
  return a.name !== b.name || a.city !== b.city || a.style !== b.style;
}

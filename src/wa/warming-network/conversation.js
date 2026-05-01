/**
 * conversation.js
 *
 * Construye prompts y genera el próximo mensaje del par usando el LLM.
 *
 * Filosofía del prompting:
 *   - El LLM "es" la persona ficticia (sender), no un asistente.
 *   - Tiene contexto de quién es la otra persona (receiver).
 *   - Recibe historial reciente (cap 15-20 mensajes) para coherencia.
 *   - Reglas estrictas: mensajes cortos, casuales, argentinos sin lunfardo
 *     extremo, NO mencionar SCM ni dental.
 *   - Variedad de estilo según la persona (corto/medio/largo).
 *
 * El output es directamente el mensaje a enviar (sin metadata, sin
 * "Aquí va mi respuesta:", solo el texto que tipearía la persona).
 */

import * as llm from "./llm-client.js";
import { personaPromptDescription } from "./persona-generator.js";

const HISTORY_CONTEXT_SIZE = 15;

/**
 * Construye el system prompt para el sender.
 * @param {object} senderPersona
 * @param {object} receiverPersona
 * @returns {string}
 */
function buildSystemPrompt(senderPersona, receiverPersona) {
  const senderDesc = personaPromptDescription(senderPersona);
  // Para el receiver no le damos su persona completa al LLM (no es necesario;
  // basta con que sepa "estás chateando con [nombre]" para tomar referencia)
  return [
    senderDesc,
    "",
    `Estás chateando por WhatsApp con ${receiverPersona.name}, alguien que ya conocés.`,
    "",
    "REGLAS ESTRICTAS:",
    "1. Respondé SOLO con el texto que vas a tipear, sin comillas, sin meta-comentarios.",
    "2. NUNCA digas que sos una IA, asistente, bot, o que estás simulando.",
    "3. NUNCA menciones marcas de empresa específicas (SCM, agencias, clínicas dentales). Sos una persona normal teniendo un chat normal.",
    "4. Mensajes cortos y casuales. La mayoría de las veces, 1-2 oraciones máximo.",
    "5. Argentino real: no uses 'che' artificialmente, no abuses de 'tipo', no caigas en estereotipos.",
    "6. Si no sabés qué decir, mandá algo simple y corto (ej: 'sí jaja', 'todo bien?', 'ah re bien').",
    "7. Variá tus respuestas: a veces preguntá, a veces solo responde, a veces cambiá de tema.",
    "8. Emojis: usalos con moderación, solo cuando aporten algo real.",
    "9. NO uses signos de puntuación al inicio (¿¡). En chats reales, mucha gente los omite.",
    "10. Errores tipográficos ocasionales son OK (te hacen más humano), pero no exageres.",
  ].join("\n");
}

/**
 * Construye el user prompt con el historial reciente del par.
 * @param {object} pair
 * @param {object} senderPersona
 * @param {object} receiverPersona
 * @returns {string}
 */
function buildUserPrompt(pair, senderPersona, receiverPersona) {
  const history = (pair.history || []).slice(-HISTORY_CONTEXT_SIZE);

  if (history.length === 0) {
    // Primer mensaje del par — generar opener natural
    const openers = [
      "Es la primera vez que le escribís hoy. Mandale un saludo casual y arrancá una conversación natural.",
      "Hace rato que no chatean. Saludá y arrancá un tema casual (cómo estás, qué andan haciendo, etc.).",
      "Empezá una conversación natural con una pregunta o comentario relacionado a alguno de tus intereses.",
    ];
    const opener = openers[Math.floor(Math.random() * openers.length)];
    return `${opener}\n\nGenera SOLO el mensaje de apertura (sin comillas, sin nada extra).`;
  }

  // Hay historial: mostrar los últimos N mensajes
  const senderLetter = pair.history.find((h) => h.from === "A")
    ? pair.accountA === senderPersona.accountId
      ? "A"
      : "B"
    : "A";

  const transcript = history
    .map((m) => {
      const fromMe = m.from === senderLetter;
      const who = fromMe ? "TÚ" : receiverPersona.name;
      return `${who}: ${m.text}`;
    })
    .join("\n");

  return [
    "Conversación reciente (los más nuevos abajo):",
    "---",
    transcript,
    "---",
    "",
    `Es tu turno de responder. Generá SOLO el próximo mensaje (sin comillas, sin "${senderPersona.name}:", sin nada extra). Sé natural, breve, y mantené el flow del chat.`,
  ].join("\n");
}

/**
 * Genera el próximo mensaje del par. Compatible con la signature que
 * espera orchestrator.js: (pair, senderPersona, receiverPersona) => string
 *
 * @param {object} pair
 * @param {object} senderPersona
 * @param {object} receiverPersona
 * @returns {Promise<string>} el mensaje a enviar (string), con metadata
 *   adjunta como propiedades expandibles si fuera necesario
 */
export async function generateMessage(pair, senderPersona, receiverPersona) {
  const system = buildSystemPrompt(senderPersona, receiverPersona);
  const user = buildUserPrompt(pair, senderPersona, receiverPersona);

  const result = await llm.callLLM({
    system,
    user,
    maxTokens: 150,
    temperature: 0.9, // alta variabilidad
  });

  let text = result.text.trim();

  // Limpiar artifacts comunes del LLM
  text = text
    .replace(/^["'`]+|["'`]+$/g, "") // comillas envoltorio
    .replace(/^[A-Z][a-záéíóúñ]+:\s*/i, "") // "Pablo: ..." → quitar prefijo
    .replace(/^TÚ:\s*/i, "")
    .replace(/^([^.!?\n]{1,200})$/s, "$1") // limit razonable
    .trim();

  if (!text) {
    text = "todo bien?"; // fallback mínimo
  }

  // Anexar metadata como propiedades del string para que orchestrator pueda
  // loggearlas (JS permite esto vía Object wrappers, pero más simple: usamos
  // un objeto expansible con valueOf override)
  const wrapped = new String(text);
  wrapped._llmCost = result.cost;
  wrapped._llmModel = result.model;
  wrapped._tokensIn = result.tokensIn;
  wrapped._tokensOut = result.tokensOut;
  return wrapped;
}

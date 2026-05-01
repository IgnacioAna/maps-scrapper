/**
 * llm-client.js
 *
 * Cliente LLM para el warming network. Reusa el cliente AI ya configurado
 * en GoogleSrapper (Mercury primario, Qwen fallback) — cero API keys
 * nuevas requeridas.
 *
 * Costos aproximados (estimación 2026):
 *   - Mercury (Inception Labs): ~$0.0001 / 1K tokens. Mensaje warming
 *     promedio = ~500 tokens = ~$0.00005 cada uno. 10 msgs/día × 30 cuentas
 *     × 30 días = 9000 msgs/mes = ~$0.45/mes. Muy barato.
 *   - Qwen 3 14B free (OpenRouter): gratis con rate limits razonables.
 *     Fallback ideal si Mercury cae.
 *
 * El cliente recibe `aiClient` y `aiModel` inyectados al inicializar
 * (se pasan desde el boot del server, donde se construyen los clientes).
 */

let _aiClient = null;
let _aiModel = null;
let _logger = console;

// Tracking simple de costo (estimado)
const COST_PER_1K_INPUT = 0.0001;  // Mercury aproximado
const COST_PER_1K_OUTPUT = 0.0002; // Mercury aproximado

const stats = {
  totalCalls: 0,
  totalSuccesses: 0,
  totalFailures: 0,
  totalEstimatedCostUsd: 0,
};

/**
 * Inicializa el cliente. Llamar al boot del server.
 * @param {object} opts
 * @param {object} opts.aiClient - cliente OpenAI-compatible (Mercury o Qwen)
 * @param {string} opts.aiModel - nombre del modelo (ej "mercury-2")
 * @param {object} opts.logger
 */
export function initLLMClient({ aiClient, aiModel, logger }) {
  _aiClient = aiClient;
  _aiModel = aiModel;
  if (logger) _logger = logger;
  _logger.log("[warming-llm] inicializado con modelo:", aiModel);
}

/**
 * Llama al LLM con un sistema y un user message.
 *
 * @param {object} opts
 * @param {string} opts.system - system prompt
 * @param {string} opts.user - user message
 * @param {number} [opts.maxTokens=200]
 * @param {number} [opts.temperature=0.85]
 * @returns {Promise<{text: string, tokensIn: number, tokensOut: number, cost: number, model: string}>}
 */
export async function callLLM({ system, user, maxTokens = 200, temperature = 0.85 }) {
  if (!_aiClient || !_aiModel) {
    throw new Error("LLM client no inicializado (llamar initLLMClient primero)");
  }

  stats.totalCalls++;
  const start = Date.now();

  try {
    const response = await _aiClient.chat.completions.create({
      model: _aiModel,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: maxTokens,
      temperature,
    });

    const text = (response.choices[0]?.message?.content || "").trim();
    const tokensIn = response.usage?.prompt_tokens || 0;
    const tokensOut = response.usage?.completion_tokens || 0;
    const cost = (tokensIn / 1000) * COST_PER_1K_INPUT + (tokensOut / 1000) * COST_PER_1K_OUTPUT;
    stats.totalSuccesses++;
    stats.totalEstimatedCostUsd += cost;

    const elapsed = Date.now() - start;
    _logger.log(
      `[warming-llm] ok ${tokensIn}+${tokensOut}tok ${elapsed}ms $${cost.toFixed(5)}`,
    );
    return { text, tokensIn, tokensOut, cost, model: _aiModel };
  } catch (err) {
    stats.totalFailures++;
    _logger.error("[warming-llm] error:", err.message);
    throw err;
  }
}

export function getLLMStats() {
  return { ...stats };
}

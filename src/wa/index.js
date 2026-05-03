// Punto de entrada del módulo WA. Se importa desde index.js de GoogleSrapper.
// mountWa(app, server, deps) hace todo: data + gateway + routes + warming-network.
import { initWaData, getAccount } from "./data.js";
import { initGateway, sendToUser } from "./gateway.js";
import { registerWaRoutes } from "./routes.js";

export async function mountWa(app, httpServer, deps) {
  initWaData(deps.dataDir);
  if (httpServer) initGateway(httpServer, deps);
  registerWaRoutes(app, deps);
  if (process.env.NODE_ENV !== "test") console.log("✅ Módulo WhatsApp Multi-Account montado en /api/wa");

  // ── Warming network (AI-to-AI) ──
  // Solo arrancamos en producción / dev real. En tests no.
  if (process.env.NODE_ENV !== "test") {
    try {
      const wnStore = await import("./warming-network/store.js");
      const llm = await import("./warming-network/llm-client.js");
      const conv = await import("./warming-network/conversation.js");
      const orch = await import("./warming-network/orchestrator.js");

      wnStore.initWarmingStore(deps.dataDir);

      // Inyectar el cliente AI configurado por el server padre
      if (deps.aiClient && deps.aiModel) {
        llm.initLLMClient({ aiClient: deps.aiClient, aiModel: deps.aiModel });
      } else {
        console.warn("⚠️  Warming network: aiClient no provisto, LLM no funcionará");
      }

      // Importar isUserOnline del gateway para que el orchestrator pueda
      // chequear presence ANTES de mandar (evita silent drops).
      const { isUserOnline } = await import("./gateway.js");

      // Inyectar el orchestrator con dependencias
      orch.initOrchestrator({
        llmGenerateMessage: conv.generateMessage,
        isUserOnline,
        wsEmit: ({ setterId, senderAccountId, receiverAccountId, text, pairId }) => {
          // Resolver el teléfono del receiver a partir del accountId
          const receiverAccount = getAccount(receiverAccountId);
          if (!receiverAccount || !receiverAccount.phone) {
            console.warn("[warming-orch] receiver sin telefono:", receiverAccountId);
            return;
          }
          // Mandar al wa-multi del setter dueño del SENDER
          sendToUser(setterId, "warming:send-message", {
            accountId: senderAccountId,
            phone: receiverAccount.phone,
            text,
            pairId,
            isWarming: true,
          });
        },
      });

      orch.startOrchestrator();
      console.log("✅ Warming network orchestrator activo");
    } catch (err) {
      console.error("⚠️  Warming network no se pudo iniciar:", err);
    }
  }
}

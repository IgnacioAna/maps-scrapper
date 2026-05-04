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

      // Importar helpers del gateway. isUserOnline + admin fallback.
      const { isUserOnline, getPresenceList, sendToUser } = await import("./gateway.js");

      // Helper: ¿hay algún admin online? Sirve como fallback para warming
      // cuando el setter dueño de la cuenta no está conectado (caso típico:
      // el admin tiene wa-multi con TODAS las cuentas — incluyendo las de
      // setters que no están conectados — porque escaneó QR de cada una).
      function findOnlineAdminId() {
        const list = getPresenceList();
        const admin = list.find((p) => p.online && p.role === "admin");
        return admin ? admin.userId : null;
      }

      // ¿Está la cuenta accesible por algún wa-multi conectado?
      // Devuelve el userId que debería recibir el comando, o null.
      function findRecipientForAccount(setterId) {
        if (isUserOnline(setterId)) return setterId; // setter dueño primero
        const adminId = findOnlineAdminId();          // fallback: admin
        return adminId;
      }

      // Inyectar el orchestrator con dependencias.
      // isUserOnline considera setter directo OR admin fallback.
      orch.initOrchestrator({
        llmGenerateMessage: conv.generateMessage,
        isUserOnline: (setterId) => findRecipientForAccount(setterId) !== null,
        wsEmit: ({ setterId, senderAccountId, receiverAccountId, text, pairId }) => {
          const receiverAccount = getAccount(receiverAccountId);
          if (!receiverAccount || !receiverAccount.phone) {
            console.warn("[warming-orch] receiver sin telefono:", receiverAccountId);
            return;
          }
          // Resolver destinatario del comando: setter dueño si está online,
          // sino admin online (que tiene la sesion de la cuenta igual).
          const targetUserId = findRecipientForAccount(setterId);
          if (!targetUserId) {
            console.warn(`[warming-orch] no hay recipient online para setter=${setterId}`);
            return;
          }
          if (targetUserId !== setterId) {
            console.log(`[warming-orch] setter ${setterId} offline, fallback a admin ${targetUserId}`);
          }
          sendToUser(targetUserId, "warming:send-message", {
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

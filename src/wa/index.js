// Punto de entrada del módulo WA. Se importa desde index.js de GoogleSrapper.
// mountWa(app, server, deps) hace todo: data + gateway + routes.
import { initWaData } from "./data.js";
import { initGateway } from "./gateway.js";
import { registerWaRoutes } from "./routes.js";

export function mountWa(app, httpServer, deps) {
  // deps esperados:
  //   dataDir            → DATA_DIR de index.js
  //   jwtSecret          → secret para firmar JWT de la desktop
  //   requireAuth        → middleware existente
  //   requireRole        → middleware existente
  //   getSessionFromRequest → helper existente para WS auth via cookie
  //   verifyCredentials(email, password) → helper para login desktop
  //   userIdFromSetterId(setterId) → resuelve setter.id → user.id
  initWaData(deps.dataDir);
  initGateway(httpServer, deps);
  registerWaRoutes(app, deps);
  console.log("✅ Módulo WhatsApp Multi-Account montado en /api/wa");
}

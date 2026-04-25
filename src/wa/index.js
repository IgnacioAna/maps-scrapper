// Punto de entrada del módulo WA. Se importa desde index.js de GoogleSrapper.
// mountWa(app, server, deps) hace todo: data + gateway + routes.
import { initWaData } from "./data.js";
import { initGateway } from "./gateway.js";
import { registerWaRoutes } from "./routes.js";

export function mountWa(app, httpServer, deps) {
  initWaData(deps.dataDir);
  if (httpServer) initGateway(httpServer, deps);
  registerWaRoutes(app, deps);
  if (process.env.NODE_ENV !== "test") console.log("✅ Módulo WhatsApp Multi-Account montado en /api/wa");
}

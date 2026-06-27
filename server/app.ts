import { createApp as createH3App, toNodeListener, toWebHandler } from "h3";
import apiHealthHandler from "./api/health.get";
import { corsMiddleware } from "./middleware/cors";
import healthHandler from "./routes/health.get";

export function createApp() {
  const app = createH3App();
  app.use("/", corsMiddleware);
  app.use("/api/health", apiHealthHandler);
  app.use("/health", healthHandler);
  const fetch = toWebHandler(app);
  return Object.assign(app, { fetch });
}

export const toNodeHandler = toNodeListener;

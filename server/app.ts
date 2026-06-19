import { createApp as createH3App, eventHandler, toNodeListener, toWebHandler } from "h3";
import healthHandler from "./routes/health.get";

export function createApp() {
  const app = createH3App();
  app.use("/health", eventHandler(() => healthHandler()));
  const fetch = toWebHandler(app);
  return Object.assign(app, { fetch });
}

export const toNodeHandler = toNodeListener;
import pino from "pino";
import { getConfig } from "../config";

function buildLogger() {
  const cfg = getConfig();
  return pino({
    level: cfg.nodeEnv === "production" ? "info" : "debug",
    redact: {
      paths: [
        "password",
        "totpSecret",
        "apiKey",
        "*.headers.authorization",
        "*.headers.cookie",
        "*.headers['x-idempotency-key']",
      ],
      censor: "[REDACTED]",
    },
    base: { service: "stock-market-backend", env: cfg.nodeEnv },
  });
}

let cached: ReturnType<typeof buildLogger> | undefined;

export function getLogger() {
  if (!cached) cached = buildLogger();
  return cached;
}

export const logger = new Proxy({} as ReturnType<typeof buildLogger>, {
  get(_t, prop) {
    return (getLogger() as unknown as Record<string | symbol, unknown>)[prop as string];
  },
});
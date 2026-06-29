import { createApp as createH3App, toNodeListener, toWebHandler } from "h3";
import apiHealthHandler from "./api/health.get";
import { corsMiddleware } from "./middleware/cors";
import healthHandler from "./routes/health.get";
import { getDb } from "./data/drizzle/client";

export function createApp() {
  const app = createH3App();

  // Initialize database connection (lazy singleton)
  // This will connect to Supabase Postgres when first accessed
  try {
    getDb();
    console.log("✅ Database connection initialized");
  } catch (error) {
    console.error("❌ Database connection failed:", error);
    // Don't block app startup - DB will connect when needed
  }

  app.use("/", corsMiddleware);
  app.use("/api/health", apiHealthHandler);
  app.use("/health", healthHandler);

  const fetch = toWebHandler(app);
  return Object.assign(app, { fetch });
}

export const toNodeHandler = toNodeListener;
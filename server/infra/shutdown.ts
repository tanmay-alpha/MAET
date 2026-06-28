/**
 * Graceful Shutdown Handler
 *
 * Handles SIGTERM and SIGINT signals for safe Render deployments.
 * Ensures all workers, connections, and in-flight requests are
 * properly cleaned up before process exit.
 */

import { stopOrchestrator } from "../orchestrator";
import { closeRedis } from "../data/redis/client";
import { logger } from "./logger";

let isShuttingDown = false;

export function registerShutdownHandlers(): void {
  // SIGTERM: Render sends this on deploy/start
  process.on("SIGTERM", async () => {
    logger.info("SIGTERM received, starting graceful shutdown...");
    await shutdown();
    process.exit(0);
  });

  // SIGINT: Ctrl+C in terminal
  process.on("SIGINT", async () => {
    logger.info("SIGINT received, starting graceful shutdown...");
    await shutdown();
    process.exit(0);
  });

  // Uncaught exceptions - log and exit
  process.on("uncaughtException", (error) => {
    logger.error({ error }, "Uncaught exception during shutdown");
    process.exit(1);
  });

  // Unhandled promise rejections
  process.on("unhandledRejection", (reason) => {
    logger.error({ reason }, "Unhandled rejection during shutdown");
    process.exit(1);
  });
}

async function shutdown(): Promise<void> {
  if (isShuttingDown) {
    logger.info("Shutdown already in progress...");
    return;
  }

  isShuttingDown = true;
  const timeout = 30_000; // 30 second max shutdown time

  try {
    // Create shutdown promise with timeout
    const shutdownPromise = (async () => {
      logger.info("Stopping orchestrator...");
      await stopOrchestrator();

      logger.info("Closing Redis connection...");
      await closeRedis();

      logger.info("Graceful shutdown complete");
    })();

    // Race against timeout
    await Promise.race([
      shutdownPromise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Shutdown timeout exceeded")), timeout)
      ),
    ]);
  } catch (error) {
    logger.error({ error }, "Error during graceful shutdown");
    // Force exit even if cleanup fails
    process.exit(1);
  }
}

// Export for testing
export function isShuttingDownState(): boolean {
  return isShuttingDown;
}
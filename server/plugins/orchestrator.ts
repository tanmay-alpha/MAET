import type { NitroAppPlugin } from "nitropack";
import { startOrchestrator, stopOrchestrator } from "../orchestrator";
import { updateHealthStatus } from "../infra/health";
import { getLogger } from "../infra/logger";
import { createGracefulShutdown } from "../infra/shutdown";
import { closeRedis } from "../data/redis/client";
import { closeDb } from "../data/drizzle/client";
import { paperStreamHub } from "../modules/paper-trading/stream-hub";

const orchestratorPlugin: NitroAppPlugin = (nitroApp) => {
  startOrchestrator();
  updateHealthStatus("orchestrator", true);

  // Nitro's node-server runtime turns SIGTERM/SIGINT into this close hook.
  const shutdown = createGracefulShutdown({
    stopWorkers: stopOrchestrator,
    closeRedis: async () => {
      await Promise.all([paperStreamHub.close(), closeRedis()]);
    },
    closeDb,
    log: getLogger().child({ module: "shutdown" }),
  });
  nitroApp.hooks.hook("close", async () => {
    updateHealthStatus("orchestrator", false);
    await shutdown();
  });
};

export default orchestratorPlugin;

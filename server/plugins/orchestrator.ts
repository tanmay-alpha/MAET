import type { NitroAppPlugin } from "nitropack";
import { startOrchestrator, stopOrchestrator } from "../orchestrator";
import { updateHealthStatus } from "../infra/health";

const orchestratorPlugin: NitroAppPlugin = (nitroApp) => {
  startOrchestrator();
  updateHealthStatus("orchestrator", true);
  nitroApp.hooks.hook("close", async () => {
    updateHealthStatus("orchestrator", false);
    await stopOrchestrator();
  });
};

export default orchestratorPlugin;

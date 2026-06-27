import type { NitroAppPlugin } from "nitropack";
import { startOrchestrator, stopOrchestrator } from "../orchestrator";
import { refreshDependencyChecks, registerCheck } from "../infra/health";

const orchestratorPlugin: NitroAppPlugin = (nitroApp) => {
  startOrchestrator();
  registerCheck("orchestrator", true, "running");
  void refreshDependencyChecks(true);
  const healthTimer = setInterval(() => void refreshDependencyChecks(true), 60_000);
  nitroApp.hooks.hook("close", async () => {
    clearInterval(healthTimer);
    registerCheck("orchestrator", false, "stopped");
    await stopOrchestrator();
  });
};

export default orchestratorPlugin;

import type { NitroAppPlugin } from "nitropack";
import { isDatabaseAvailable } from "../data/drizzle/availability";
import { getLogger } from "../infra/logger";
import { registerScheduledJob } from "../infra/shutdown";
import { createPaperPortfolioSnapshotService } from "../modules/paper-trading/portfolio-snapshots";
import { PortfolioSnapshotScheduler } from "../modules/paper-trading/portfolio-snapshot-scheduler";

/**
 * End-of-day paper portfolio snapshots, run inside the web process after each NSE close.
 * The orchestrator plugin's graceful shutdown stops it before the database pool closes.
 */
const paperPortfolioSnapshotsPlugin: NitroAppPlugin = (nitroApp) => {
  if (process.env.NODE_ENV === "test") return;
  const log = getLogger().child({ module: "paper-portfolio-snapshots" });
  const scheduler = new PortfolioSnapshotScheduler(createPaperPortfolioSnapshotService(), {
    onRun: (result) => log.info({ result }, "paper portfolio end-of-day snapshot run"),
    onError: (error) =>
      log.error({ err: error instanceof Error ? error.message : String(error) }, "paper portfolio snapshot run failed"),
    isDatabaseAvailable,
  });
  scheduler.start();
  registerScheduledJob("paper-portfolio-snapshots", () => scheduler.stop());
};

export default paperPortfolioSnapshotsPlugin;

import { bus } from "../infra/bus";
import { computePhase, MarketClock, type MarketPhase } from "../domain/market/clock";
import { getConfig } from "../config";

export type MarketClockWorkerOptions = {
  tickMs?: number;
  getNow?: () => Date;
  holidays?: Date[];
};

function getLog() {
  try {
    return require("../infra/logger").getLogger().child({ worker: "market-clock" });
  } catch {
    return { info: (..._args: unknown[]) => {} };
  }
}

export class MarketClockWorker {
  private clock: MarketClock;
  private off: (() => void) | undefined;

  constructor(opts: MarketClockWorkerOptions = {}) {
    let holidays = opts.holidays;
    if (!holidays) {
      try {
        holidays = getConfig().nseHolidays;
      } catch {
        holidays = [];
      }
    }
    this.clock = new MarketClock({
      tickMs: opts.tickMs ?? 1_000,
      getNow: opts.getNow,
      holidays,
    });
  }

  start(): void {
    this.off = this.clock.subscribe((phase: MarketPhase) => {
      getLog().info({ phase }, "market phase change");
      bus.emit("market:phase", { phase, ts: new Date().toISOString() });
    });
    this.clock.start();
  }

  stop(): void {
    this.clock.stop();
    this.off?.();
    this.off = undefined;
  }

  onPhase(cb: (phase: MarketPhase) => void): () => void {
    const handler = (e: { phase: MarketPhase }) => cb(e.phase);
    bus.on("market:phase", handler);
    return () => bus.off("market:phase", handler);
  }
}

export { computePhase };

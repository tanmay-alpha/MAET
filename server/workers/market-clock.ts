import { bus } from "../infra/bus";
import { computePhase, MarketClock, type MarketPhase } from "../domain/market/clock";
import { getLogger } from "../infra/logger";
import { getConfig } from "../config";

const log = getLogger().child({ worker: "market-clock" });

export type MarketClockWorkerOptions = {
  tickMs?: number;
  getNow?: () => Date;
};

export class MarketClockWorker {
  private clock: MarketClock;
  private off: (() => void) | undefined;
  private busOff: (() => void) | undefined;

  constructor(opts: MarketClockWorkerOptions = {}) {
    const cfg = getConfig();
    this.clock = new MarketClock({
      tickMs: opts.tickMs ?? 1_000,
      getNow: opts.getNow,
      holidays: cfg.nseHolidays,
    });
  }

  start(): void {
    this.off = this.clock.subscribe((phase: MarketPhase) => {
      log.info({ phase }, "market phase change");
      bus.emit("market:phase", { phase, ts: new Date().toISOString() });
    });
    this.busOff = bus.on("market:phase", () => {}); // placeholder for any subscriber fan-in
    this.clock.start();
  }

  stop(): void {
    this.clock.stop();
    this.off?.();
    this.busOff?.();
  }

  onPhase(cb: (phase: MarketPhase) => void): () => void {
    const handler = (e: { phase: MarketPhase }) => cb(e.phase);
    bus.on("market:phase", handler);
    return () => bus.off("market:phase", handler);
  }
}

export { computePhase };
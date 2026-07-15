import { bus } from "../infra/bus";
import { onTick } from "../domain/market/matcher";
import { riskEngine } from "../domain/portfolio/risk-engine";
import type { Tick } from "@shared/types";

export class OrderMatcherWorker {
  private off: (() => void) | undefined;

  start(): void {
    if (this.off) return;

    // Start background risk monitoring loop (checks every 2 seconds)
    riskEngine.start(2000);

    this.off = bus.on("tick", (tick: Tick) => {
      // 1. Update risk engine cache with latest asset prices
      riskEngine.updatePrice(tick.symbol, tick.price);

      // 2. Coordinates order matching for this symbol
      onTick(tick.symbol, tick.price, tick.price, tick.price, tick.volume)
        .catch((err) => {
          console.error(`[OrderMatcherWorker] Error processing tick for ${tick.symbol}:`, err);
        });
    });

    console.log("[OrderMatcherWorker] Started and listening to tick events");
  }

  stop(): void {
    this.off?.();
    this.off = undefined;

    // Stop background risk engine
    riskEngine.stop();

    console.log("[OrderMatcherWorker] Stopped order matching worker");
  }
}

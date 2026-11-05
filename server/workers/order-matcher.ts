import { bus } from "../infra/bus";
import { onTick } from "../domain/market/matcher";
import { paperRiskMonitor } from "../modules/paper-trading/risk-monitor";
import { evaluateExecutionQuote, type Tick } from "@shared/types";

export class OrderMatcherWorker {
  private off: (() => void) | undefined;

  start(): void {
    if (this.off) return;

    // Start background margin monitoring loop (checks every 2 seconds)
    paperRiskMonitor.start(2000);

    this.off = bus.on("tick", (tick: Tick) => {
      // 0. Validate tick execution policy
      const policyResult = evaluateExecutionQuote(tick);
      if (!policyResult.executable) {
        return;
      }

      // 1. Feed the margin monitor the latest quote for this exchange:symbol
      paperRiskMonitor.updateQuote(tick);

      // 2. Coordinates order matching for this symbol
      onTick(tick)
        .catch((err) => {
          console.error(`[OrderMatcherWorker] Error processing tick for ${tick.symbol}:`, err);
        });
    });

    console.log("[OrderMatcherWorker] Started and listening to tick events");
  }

  stop(): void {
    this.off?.();
    this.off = undefined;

    // Stop background margin monitor
    paperRiskMonitor.stop();

    console.log("[OrderMatcherWorker] Stopped order matching worker");
  }
}

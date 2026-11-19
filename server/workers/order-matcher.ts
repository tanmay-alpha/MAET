import { bus } from "../infra/bus";
import { onTick } from "../domain/market/matcher";
import { paperRiskMonitor } from "../modules/paper-trading/risk-monitor";
import { paperExecutionPolicy } from "../modules/paper-trading/fill-writer";
import { paperTradingTickProcessor } from "../modules/paper-trading/tick-processor";
import { evaluateExecutionQuote, type Tick } from "@shared/types";

export type OrderMatcherOptions = {
  /**
   * Whether `exchange:symbol` may have working paper orders. When it answers false the
   * tick skips order matching, which would otherwise query paper_orders on every tick of
   * every streamed symbol. Omitted: every tick is matched.
   */
  hasWorkingOrders?: (exchange: string, symbol: string) => boolean;
};

export class OrderMatcherWorker {
  private off: (() => void) | undefined;

  constructor(private readonly options: OrderMatcherOptions = {}) {}

  start(): void {
    if (this.off) return;

    // Start background margin monitoring loop (checks every 2 seconds)
    paperRiskMonitor.start(2000);

    this.off = bus.on("tick", (tick: Tick) => {
      // Only executable ticks (configured freshness, no delayed feeds) can mark margin or fill orders
      if (!evaluateExecutionQuote(tick, tick.symbol, paperExecutionPolicy()).executable) {
        return;
      }

      // 1. Feed the margin monitor the latest live quote for this exchange:symbol
      paperRiskMonitor.updateQuote(tick);

      // 2. No working order on the symbol: keep its volume baseline current, skip the database.
      if (this.options.hasWorkingOrders && !this.options.hasWorkingOrders(tick.exchange, tick.symbol)) {
        paperTradingTickProcessor.observeTick(tick);
        return;
      }

      // 3. Coordinates order matching for this symbol
      onTick(tick)
        .then((receipts) => {
          // A fill can end a working order or close a position: the paper-interest
          // subscriptions re-read which symbols still need ticks.
          if (receipts.length > 0) bus.emit("paper:interest_changed", { reason: "order_filled" });
        })
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

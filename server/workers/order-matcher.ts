import { bus } from "../infra/bus";
import { onTick } from "../domain/market/matcher";
import { paperRiskMonitor } from "../modules/paper-trading/risk-monitor";
import { paperExecutionPolicy } from "../modules/paper-trading/fill-writer";
import { evaluateExecutionQuote, type Tick } from "@shared/types";
import type { MatchingReceipt } from "../modules/paper-trading/contracts";
import { DatabaseGate } from "../infra/database-gate";

export type OrderMatcherDeps = {
  match?: (tick: Tick) => Promise<MatchingReceipt[]>;
  riskMonitor?: Pick<typeof paperRiskMonitor, "start" | "stop" | "updateQuote">;
  log?: { info: (message: string) => void; error: (message: string, err: unknown) => void };
};

export class OrderMatcherWorker {
  private off: (() => void) | undefined;
  private readonly match: (tick: Tick) => Promise<MatchingReceipt[]>;
  private readonly riskMonitor: Pick<typeof paperRiskMonitor, "start" | "stop" | "updateQuote">;
  private readonly log: { info: (message: string) => void; error: (message: string, err: unknown) => void };
  private readonly database: DatabaseGate;

  constructor(deps: OrderMatcherDeps = {}) {
    this.match = deps.match ?? onTick;
    this.riskMonitor = deps.riskMonitor ?? paperRiskMonitor;
    this.log = deps.log ?? { info: (message) => console.log(message), error: (message, err) => console.error(message, err) };
    this.database = new DatabaseGate("order-matcher", {
      warn: (fields, message) => this.log.error(`[OrderMatcherWorker] ${message}`, fields),
      info: (_fields, message) => this.log.info(`[OrderMatcherWorker] ${message}`),
    });
  }

  start(): void {
    if (this.off) return;

    // Start background margin monitoring loop (checks every 2 seconds)
    this.riskMonitor.start(2000);

    this.off = bus.on("tick", (tick: Tick) => {
      // Only executable ticks (configured freshness, no delayed feeds) can mark margin or fill orders
      if (!evaluateExecutionQuote(tick, tick.symbol, paperExecutionPolicy()).executable) {
        return;
      }

      // 1. Feed the margin monitor the latest live quote for this exchange:symbol
      this.riskMonitor.updateQuote(tick);

      // 2. Coordinates order matching for this symbol
      // Through the database circuit: while it is open the tick is skipped without a
      // query. Working orders stay in the database and match on the first tick after.
      this.database
        .run(() => this.match(tick))
        .then((receipts) => {
          // A fill can end a working order or close a position: the paper-interest
          // subscriptions re-read which symbols still need ticks.
          if (receipts && receipts.length > 0) bus.emit("paper:interest_changed", { reason: "order_filled" });
        })
        .catch((err) => {
          this.log.error(`[OrderMatcherWorker] Error processing tick for ${tick.symbol}:`, err);
        });
    });

    this.log.info("[OrderMatcherWorker] Started and listening to tick events");
  }

  stop(): void {
    this.off?.();
    this.off = undefined;

    // Stop background margin monitor
    this.riskMonitor.stop();

    this.log.info("[OrderMatcherWorker] Stopped order matching worker");
  }
}

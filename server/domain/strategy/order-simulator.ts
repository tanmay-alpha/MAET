/**
 * Multi-Bar Simulated Order and Partial Fill Engine — MAET P2.
 *
 * Simulates real-market order execution:
 * 1. Participation constraints: fills capped at configurable rate of bar volume (e.g. 10%).
 * 2. Multi-bar accumulation: large orders fill over multiple successive candles.
 * 3. Exact reconciliation: sum(fillQty) == filledQuantity, exact volume-weighted average price.
 * 4. Order lifecycle: NEW -> PARTIALLY_FILLED -> FILLED / EXPIRED / CANCELLED.
 * 5. Time-in-force policies: DAY (session expiry), GTC (good 'til cancelled), IOC (immediate or cancel).
 */

import type { Candle } from "@shared/types";
import type { StrategyExecutionConfig } from "../../../shared/strategy/ast";
import {
  ExecutionModel,
  type ExecutionContext,
  type ExecutionCostBreakdown,
  type OrderSide,
  type TimeInForce,
  type OrderFillStatus,
  type OrderFillEvent,
  type SimulatedOrderState,
} from "./execution-model";

export class SimulatedOrder {
  public state: SimulatedOrderState;
  private executionModel: ExecutionModel;
  private config: StrategyExecutionConfig;

  constructor(
    orderId: string,
    symbol: string,
    side: OrderSide,
    requestedQuantity: number,
    config: StrategyExecutionConfig,
    placedBarIndex: number,
    placedTimestamp: string | number,
    timeInForce: TimeInForce = "GTC",
  ) {
    this.config = config;
    this.executionModel = new ExecutionModel(config);
    this.state = {
      orderId,
      symbol,
      side,
      requestedQuantity,
      filledQuantity: 0,
      remainingQuantity: requestedQuantity,
      averageFillPrice: 0,
      status: "NEW",
      fillCount: 0,
      timeInForce: config.timeInForce ?? timeInForce,
      placedBarIndex,
      placedTimestamp,
      lastBarIndex: placedBarIndex,
      cumulativeCosts: {
        brokerageFees: 0,
        taxesAndCharges: 0,
        spreadCost: 0,
        slippageCost: 0,
        marketImpactCost: 0,
        totalTransactionCost: 0,
        costDragPercent: 0,
      },
      fills: [],
    };
  }

  /**
   * Processes a bar for this order. Returns true if any fill occurred on this bar.
   */
  public processBar(
    bar: Candle,
    barIndex: number,
    rollingAtr?: number,
    averageDailyVolume?: number,
  ): boolean {
    if (
      this.state.status === "FILLED" ||
      this.state.status === "CANCELLED" ||
      this.state.status === "EXPIRED"
    ) {
      return false;
    }

    if (this.state.remainingQuantity <= 0) {
      this.state.status = "FILLED";
      return false;
    }

    // IOC: If placed in a previous bar and not filled, cannot fill on subsequent bars
    if (this.state.timeInForce === "IOC" && barIndex > this.state.placedBarIndex) {
      this.state.status = this.state.filledQuantity > 0 ? "PARTIALLY_FILLED" : "EXPIRED";
      return false;
    }

    // DAY: Expire order if bar calendar day has progressed
    if (this.state.timeInForce === "DAY") {
      const placedDate = new Date(this.state.placedTimestamp).toISOString().slice(0, 10);
      const currDate = new Date(bar.ts).toISOString().slice(0, 10);
      if (currDate !== placedDate) {
        this.state.status = "EXPIRED";
        return false;
      }
    }

    const ctx: ExecutionContext = {
      bar,
      orderQuantity: this.state.remainingQuantity,
      side: this.state.side,
      rollingAtr,
      averageDailyVolume,
      config: this.config,
      barIndex,
    };

    const fillRes = this.executionModel.executeBarFill(ctx, this.state.remainingQuantity);
    if (fillRes.fillQuantity <= 0) {
      return false;
    }

    // Exact weighted average fill price calculation:
    // (oldQty * oldPrice + newQty * newPrice) / (oldQty + newQty)
    const priorQty = this.state.filledQuantity;
    const priorCost = priorQty * this.state.averageFillPrice;
    const newQty = fillRes.fillQuantity;
    const newCost = newQty * fillRes.effectivePrice;
    const totalFilled = priorQty + newQty;

    this.state.averageFillPrice = totalFilled > 0 ? (priorCost + newCost) / totalFilled : 0;
    this.state.filledQuantity = totalFilled;
    this.state.remainingQuantity = Math.max(0, this.state.requestedQuantity - totalFilled);
    this.state.fillCount += 1;
    this.state.lastBarIndex = barIndex;

    // Accumulate costs exactly
    this.state.cumulativeCosts.brokerageFees += fillRes.costs.brokerageFees;
    this.state.cumulativeCosts.taxesAndCharges += fillRes.costs.taxesAndCharges;
    this.state.cumulativeCosts.spreadCost += fillRes.costs.spreadCost;
    this.state.cumulativeCosts.slippageCost += fillRes.costs.slippageCost;
    this.state.cumulativeCosts.marketImpactCost += fillRes.costs.marketImpactCost;
    this.state.cumulativeCosts.totalTransactionCost += fillRes.costs.totalTransactionCost;

    const totalNotional = totalFilled * this.state.averageFillPrice;
    this.state.cumulativeCosts.costDragPercent =
      totalNotional > 0 ? (this.state.cumulativeCosts.totalTransactionCost / totalNotional) * 100 : 0;

    this.state.fills.push({
      barIndex,
      timestamp: bar.ts,
      fillQuantity: fillRes.fillQuantity,
      fillPrice: fillRes.effectivePrice,
      notional: fillRes.notional,
      costs: fillRes.costs,
      spreadBps: fillRes.spreadBps,
      impactBps: fillRes.impactBps,
      slippageBps: fillRes.slippageBps,
    });

    if (this.state.remainingQuantity === 0) {
      this.state.status = "FILLED";
    } else {
      this.state.status = "PARTIALLY_FILLED";
      if (this.state.timeInForce === "IOC") {
        this.state.status = "CANCELLED"; // remainder cancelled immediately
      }
    }

    return true;
  }

  public cancel(): void {
    if (this.state.status !== "FILLED") {
      this.state.status = "CANCELLED";
    }
  }
}

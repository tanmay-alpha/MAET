/**
 * Deterministic Liquidity, Spread, Market Impact, and Execution Engine — MAET P2.
 *
 * Implements a professional-grade execution model:
 * 1. Reference price resolution (mid, open, close, limit, stop).
 * 2. Configurable spread models: NONE, FIXED_BPS, VOLATILITY_BASED, LIQUIDITY_BASED.
 * 3. Deterministic square-root market impact: impactBps = coeff * sqrt(participation) * volFactor.
 *    - BUY impact shifts execution price upward.
 *    - SELL impact shifts execution price downward.
 *    - Invariant: non-negative, finite, bounded at maxImpactBps, zero impact for zero quantity.
 * 4. Slippage and per-leg brokerage/statutory charges (computeLegCharges).
 * 5. Participation constraints: maxFillQuantity = floor(referenceVolume * maxParticipationRate).
 * 6. Execution cost reporting: brokerage, taxes, spread, slippage, impact, cost drag.
 *
 * Look-ahead rule: an order filled on bar i is decided at bar i's open, so every liquidity or
 * volatility input (referenceVolume, rollingAtr, averageDailyVolume) must come from bars <= i-1.
 * Only the fill bar's open/close (as the reference price) and timestamp are read from `bar`.
 */

import type { Candle } from "@shared/types";
import type { StrategyExecutionConfig } from "../../../shared/strategy/ast";
import { computeLegCharges } from "./fee-model";

// ============================================================
// Types & Contracts
// ============================================================

export type OrderSide = "BUY" | "SELL";
export type OrderExecutionType = "MARKET" | "LIMIT" | "STOP";

export interface ExecutionContext {
  /** The bar the order fills on; only its open/close (reference price) and timestamp are read. */
  bar: Candle;
  orderQuantity: number;
  side: OrderSide;
  orderType?: OrderExecutionType;
  referencePrice?: number;
  limitPrice?: number;
  stopPrice?: number;
  /** ATR known before the fill (bar i-1); drives VOLATILITY_BASED spread and the impact vol factor. */
  rollingAtr?: number;
  averageDailyVolume?: number;
  /** Volume of the last completed bar (i-1); drives the participation cap, impact and LIQUIDITY_BASED spread. */
  referenceVolume: number;
  config: StrategyExecutionConfig;
  barIndex?: number;
}

export interface ExecutionCostBreakdown {
  brokerageFees: number;
  taxesAndCharges: number;
  spreadCost: number;
  slippageCost: number;
  marketImpactCost: number;
  totalTransactionCost: number;
  costDragPercent: number; // totalTransactionCost / tradeNotional * 100
}

export interface SingleFillResult {
  fillQuantity: number;
  referencePrice: number;
  effectivePrice: number;
  spreadBps: number;
  slippageBps: number;
  impactBps: number;
  notional: number;
  costs: ExecutionCostBreakdown;
  timestamp: string | number;
  barIndex?: number;
}

// ============================================================
// Core Execution Calculation Engine
// ============================================================

export class ExecutionModel {
  private config: StrategyExecutionConfig;

  constructor(config: StrategyExecutionConfig) {
    this.config = config;
  }

  /**
   * Resolves reference price based on bar and context.
   */
  public resolveReferencePrice(ctx: ExecutionContext): number {
    if (ctx.referencePrice != null && ctx.referencePrice > 0 && Number.isFinite(ctx.referencePrice)) {
      return ctx.referencePrice;
    }
    const policy = ctx.config.fillPolicy ?? "NEXT_BAR_OPEN";
    if (policy === "ON_CLOSE") {
      return ctx.bar.close;
    }
    return ctx.bar.open;
  }

  /**
   * Evaluates spread in basis points.
   */
  public calculateSpreadBps(ctx: ExecutionContext, refPrice: number): number {
    const model = ctx.config.spreadModel ?? "FIXED_BPS";
    const baseSpreadBps = ctx.config.baseSpreadBps ?? ctx.config.slippageBps ?? 5;

    if (model === "NONE") {
      return 0;
    }

    if (model === "FIXED_BPS") {
      return Math.max(0, baseSpreadBps);
    }

    if (model === "VOLATILITY_BASED") {
      // Volatility component from the prior-bar ATR; during ATR warm-up assume a typical 1% range.
      const volFraction = ctx.rollingAtr != null && refPrice > 0 ? ctx.rollingAtr / refPrice : 0.01;
      // 1% daily volatility adds ~5 bps spread
      const volComponentBps = Math.min(50, volFraction * 10000 * 0.5);
      return Math.max(0, baseSpreadBps + volComponentBps);
    }

    if (model === "LIQUIDITY_BASED") {
      // Illiquidity component: if the last completed bar traded less than average, spread widens
      const adv = ctx.averageDailyVolume ?? (ctx.referenceVolume > 0 ? ctx.referenceVolume : 100_000);
      const barVol = Math.max(1, ctx.referenceVolume);
      const illiquidityRatio = Math.max(0, adv / barVol - 1);
      const illiquidityBps = Math.min(100, illiquidityRatio * 2);
      return Math.max(0, baseSpreadBps + illiquidityBps);
    }

    return Math.max(0, baseSpreadBps);
  }

  /**
   * Evaluates square-root market impact in basis points.
   * Deterministic formula:
   *   participation = orderQuantity / referenceVolume
   *   impactBps = coeff * sqrt(participation) * volatilityFactor
   */
  public calculateMarketImpactBps(ctx: ExecutionContext, fillQty: number, refPrice: number): number {
    const model = ctx.config.marketImpactModel ?? "SQUARE_ROOT";
    if (model === "NONE" || fillQty <= 0) {
      return 0;
    }

    const barVol = Math.max(1, ctx.referenceVolume);
    const participation = Math.min(1.0, fillQty / barVol);
    const coeff = ctx.config.impactCoefficient ?? 10;
    const maxImpactBps = ctx.config.maxImpactBps ?? 500;

    // Volatility scaling factor: baseline is 1.0 (typical 1.5% volatility)
    let volFactor = 1.0;
    if (ctx.rollingAtr && refPrice > 0) {
      const dailyVol = ctx.rollingAtr / refPrice;
      volFactor = Math.min(3.0, Math.max(0.5, dailyVol / 0.015));
    }

    const rawImpact = coeff * Math.sqrt(participation) * volFactor;
    if (!Number.isFinite(rawImpact) || rawImpact < 0) {
      return 0;
    }

    return Math.min(maxImpactBps, rawImpact);
  }

  /**
   * Computes the maximum quantity that can be filled in the given bar based on participation constraints.
   */
  public getMaximumBarFillQuantity(barVolume: number, participationRate?: number): number {
    const rate = participationRate ?? this.config.maxParticipationRate ?? 0.1; // default 10% of bar volume
    if (rate >= 1.0) {
      return barVolume > 0 ? barVolume : Infinity;
    }
    const maxQty = Math.floor(Math.max(0, barVolume) * rate);
    // If bar volume is positive but rate produces 0, allow at least 1 share so simulation makes progress
    return barVolume > 0 ? Math.max(1, maxQty) : 0;
  }

  /**
   * Simulates a single bar execution step for an order.
   */
  public executeBarFill(
    ctx: ExecutionContext,
    targetQty: number,
    options: { enforceParticipationCap: boolean } = { enforceParticipationCap: true },
  ): SingleFillResult {
    const refPrice = this.resolveReferencePrice(ctx);
    const safeRefPrice = Number.isFinite(refPrice) && refPrice > 0 ? refPrice : ctx.bar.close;

    // Participation cap (forced exits such as stops close the whole position regardless)
    const maxFillQty = options.enforceParticipationCap
      ? this.getMaximumBarFillQuantity(ctx.referenceVolume, ctx.config.maxParticipationRate)
      : Infinity;
    const fillQty = Math.min(Math.max(0, targetQty), maxFillQty);

    if (fillQty === 0) {
      return {
        fillQuantity: 0,
        referencePrice: safeRefPrice,
        effectivePrice: safeRefPrice,
        spreadBps: 0,
        slippageBps: 0,
        impactBps: 0,
        notional: 0,
        costs: {
          brokerageFees: 0,
          taxesAndCharges: 0,
          spreadCost: 0,
          slippageCost: 0,
          marketImpactCost: 0,
          totalTransactionCost: 0,
          costDragPercent: 0,
        },
        timestamp: ctx.bar.ts,
        barIndex: ctx.barIndex,
      };
    }

    const spreadBps = this.calculateSpreadBps(ctx, safeRefPrice);
    const impactBps = this.calculateMarketImpactBps(ctx, fillQty, safeRefPrice);
    const slippageBps = ctx.config.slippageBps ?? 5;

    // Half spread is charged on each side
    const halfSpreadRate = (spreadBps / 2) / 10000;
    const impactRate = impactBps / 10000;
    const slippageRate = slippageBps / 10000;

    let effectivePrice: number;
    if (ctx.side === "BUY") {
      // BUY price shifts up (worse)
      effectivePrice = safeRefPrice * (1 + halfSpreadRate + impactRate + slippageRate);
    } else {
      // SELL price shifts down (worse)
      effectivePrice = safeRefPrice * (1 - halfSpreadRate - impactRate - slippageRate);
      effectivePrice = Math.max(0.01, effectivePrice); // prevent negative prices
    }

    const notional = fillQty * effectivePrice;
    const baseNotional = fillQty * safeRefPrice;

    // Brokerage and statutory charges on the traded notional, side-aware (stamp duty is BUY-only).
    const charges = computeLegCharges(ctx.config, ctx.side, notional);
    const statutoryCharges = charges.taxesAndCharges;
    const brokerageFees = charges.brokerage;

    const spreadCost = baseNotional * halfSpreadRate;
    const slippageCost = baseNotional * slippageRate;
    const marketImpactCost = baseNotional * impactRate;

    const totalTransactionCost = brokerageFees + statutoryCharges + spreadCost + slippageCost + marketImpactCost;
    const costDragPercent = notional > 0 ? (totalTransactionCost / notional) * 100 : 0;

    return {
      fillQuantity: fillQty,
      referencePrice: safeRefPrice,
      effectivePrice,
      spreadBps,
      slippageBps,
      impactBps,
      notional,
      costs: {
        brokerageFees,
        taxesAndCharges: statutoryCharges,
        spreadCost,
        slippageCost,
        marketImpactCost,
        totalTransactionCost,
        costDragPercent,
      },
      timestamp: ctx.bar.ts,
      barIndex: ctx.barIndex,
    };
  }
}


import { describe, expect, it } from "bun:test";
import type { ExecutionQuote } from "../../types/market";
import { computeIndianEquityCharges } from "../costs/indian-equity-charges";
import { PAPER_CHARGE_PRODUCT, executePaperFill, type ExecuteFillResult } from "./execution";
import { calculateMarkedUnrealisedPnl } from "./margin";
import { reconcilePosition } from "./reconcile-position";
import type { PaperAccount, PaperOrder } from "./types";

/** mulberry32: a small deterministic PRNG so every sweep is reproducible from its seed. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function expectClose(actual: number, expected: number, label: string): void {
  const tolerance = 1e-6 * Math.max(1, Math.abs(expected));
  if (!(Math.abs(actual - expected) <= tolerance)) {
    throw new Error(`${label}: expected ${expected}, received ${actual}`);
  }
}

const SYMBOLS = ["RELIANCE", "TCS", "INFY"] as const;
type Side = "BUY" | "SELL";
/** Large enough that margin never refuses a fill: these sweeps test accounting, not buying power. */
const INITIAL_CASH = 1e12;

function freshAccount(): PaperAccount {
  return {
    version: 3,
    initialCash: INITIAL_CASH,
    cash: INITIAL_CASH,
    allocatedMargin: 0,
    maintenanceMargin: 0,
    realisedPnl: 0,
    status: "ACTIVE",
    positions: [],
    orders: [],
    fills: [],
  };
}

function marketFill(account: PaperAccount, symbol: string, side: Side, quantity: number, price: number): ExecuteFillResult {
  const now = new Date().toISOString();
  const order: PaperOrder = {
    id: crypto.randomUUID(),
    symbol,
    side,
    quantity,
    type: "MARKET",
    status: "PENDING",
    filledQuantity: 0,
    createdAt: now,
    updatedAt: now,
  };
  const executionQuote: ExecutionQuote = {
    exchange: "NSE",
    symbol,
    price,
    volume: 1_000_000,
    ts: now,
    source: "angelone",
    quality: "live",
  };
  return executePaperFill({
    account: { ...account, orders: [order] },
    order,
    fillQuantity: quantity,
    quote: executionQuote,
    reason: "USER_ORDER",
  });
}

interface FillStep {
  before: PaperAccount;
  result: ExecuteFillResult;
}

/**
 * A seeded random walk of MARKET fills over SYMBOLS. Alongside the engine's account it keeps
 * what the fills alone say: the net trade cash flow (sells minus buys at fill prices) and fees.
 */
class FillRun {
  readonly random: () => number;
  readonly prices: Map<string, number>;
  readonly steps: FillStep[] = [];
  account = freshAccount();
  tradeCashFlow = 0;
  fees = 0;

  constructor(seed: number, fills: number) {
    this.random = seededRandom(seed);
    this.prices = new Map(SYMBOLS.map((symbol) => [symbol, 200 + this.random() * 2_800]));
    for (let index = 0; index < fills; index++) {
      const symbol = SYMBOLS[Math.floor(this.random() * SYMBOLS.length)]!;
      this.prices.set(symbol, Math.max(10, this.prices.get(symbol)! * (0.9 + this.random() * 0.2)));
      this.steps.push(this.fill(symbol, this.random() < 0.5 ? "BUY" : "SELL", 1 + Math.floor(this.random() * 200)));
    }
  }

  /** Fills a MARKET order at the symbol's current price. */
  fill(symbol: string, side: Side, quantity: number): FillStep {
    const before = this.account;
    const result = marketFill(before, symbol, side, quantity, this.prices.get(symbol)!);
    this.account = result.account;
    this.tradeCashFlow -= (side === "BUY" ? quantity : -quantity) * result.fill.fillPrice;
    this.fees += result.fill.fees;
    return { before, result };
  }
}

function markedEquity(account: PaperAccount, marks: Map<string, number>): number {
  return account.positions.reduce((equity, position) => equity + calculateMarkedUnrealisedPnl(position, marks.get(position.symbol)!), account.cash);
}

describe("paper engine accounting invariants (seeded random fill sequences)", () => {
  it("cash, realised P&L, positions and margins reconcile with the fill history after every fill", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const run = new FillRun(seed, 40);
      let tradeCashFlow = 0;
      let fees = 0;
      let realised = 0;
      const net = new Map<string, number>();
      for (const { before, result } of run.steps) {
        const { fill, account } = result;
        const signed = fill.side === "BUY" ? fill.quantity : -fill.quantity;
        tradeCashFlow -= signed * fill.fillPrice;
        fees += fill.fees;
        realised += fill.realisedPnl;
        net.set(fill.symbol, (net.get(fill.symbol) ?? 0) + signed);

        // Fees: exactly the statutory schedule on this fill's turnover, charged once.
        const schedule = computeIndianEquityCharges({ exchange: "NSE", product: PAPER_CHARGE_PRODUCT, side: fill.side, turnoverInr: fill.fillPrice * fill.quantity });
        expect(fill.fees).toBe(schedule.total);
        expect(account.cash).toBe(before.cash + fill.realisedPnl - fill.fees);
        expect(account.fills.filter((recorded) => recorded.id === fill.id)).toHaveLength(1);

        expectClose(account.cash, INITIAL_CASH + realised - fees, `seed ${seed} cash`);
        expectClose(account.realisedPnl, realised, `seed ${seed} realised`);

        for (const symbol of SYMBOLS) {
          const position = account.positions.find((candidate) => candidate.symbol === symbol);
          expect(position?.quantity ?? 0).toBe(net.get(symbol) ?? 0);
        }
        expect(account.positions.every((position) => position.quantity !== 0)).toBe(true);
        const allocated = account.positions.reduce((sum, position) => sum + (Math.abs(position.quantity) * position.averagePrice) / 5, 0);
        expectClose(account.allocatedMargin, allocated, `seed ${seed} allocated margin`);
        expectClose(account.maintenanceMargin, allocated * 0.8, `seed ${seed} maintenance margin`);

        // Margin-account identity: cash + unrealised at any marks equals the starting cash plus
        // the net trade cash flow plus the market value of what is held, less fees.
        const marks = new Map(SYMBOLS.map((symbol) => [symbol, 10 + run.random() * 3_000]));
        const marketValue = account.positions.reduce((sum, position) => sum + position.quantity * marks.get(position.symbol)!, 0);
        expectClose(markedEquity(account, marks), INITIAL_CASH + tradeCashFlow + marketValue - fees, `seed ${seed} equity identity`);
      }
    }
  });

  it("closing every position at the mark moves unrealised into realised; equity changes only by fees and slippage", () => {
    for (let seed = 101; seed <= 140; seed++) {
      const run = new FillRun(seed, 30);
      const marks = new Map(run.prices);
      const opened = run.account;
      const unrealisedBefore = opened.positions.reduce((sum, position) => sum + calculateMarkedUnrealisedPnl(position, marks.get(position.symbol)!), 0);
      const equityBefore = markedEquity(opened, marks);
      const realisedBefore = opened.realisedPnl;

      let closeFees = 0;
      let closeSlippage = 0;
      for (const position of opened.positions) {
        const { result } = run.fill(position.symbol, position.quantity > 0 ? "SELL" : "BUY", Math.abs(position.quantity));
        closeFees += result.fill.fees;
        closeSlippage += result.fill.slippage * result.fill.quantity;
      }

      const closed = run.account;
      expect(closed.positions).toHaveLength(0);
      expect(closed.allocatedMargin).toBe(0);
      expectClose(closed.realisedPnl - realisedBefore, unrealisedBefore - closeSlippage, `seed ${seed} realised gain`);
      expectClose(closed.cash, equityBefore - closeFees - closeSlippage, `seed ${seed} equity after close`);
      expectClose(closed.cash, INITIAL_CASH + run.tradeCashFlow - run.fees, `seed ${seed} flat cash`);
    }
  });

  it("a long on a price path and a short on its mirror earn the same P&L", () => {
    const random = seededRandom(0x51de);
    const centre = 1_000;
    for (let trial = 0; trial < 200; trial++) {
      let long = { quantity: 0, averagePrice: 0, realised: 0 };
      let short = { quantity: 0, averagePrice: 0, realised: 0 };
      const trades = 1 + Math.floor(random() * 25);
      for (let index = 0; index < trades; index++) {
        const side: Side = random() < 0.55 ? "BUY" : "SELL";
        const quantity = 1 + Math.floor(random() * 100);
        const price = 500 + random() * 1_000;
        const mirrorSide: Side = side === "BUY" ? "SELL" : "BUY";
        const l = reconcilePosition({ existingQuantity: long.quantity, existingAveragePrice: long.averagePrice, side, fillQuantity: quantity, fillPrice: price });
        const s = reconcilePosition({ existingQuantity: short.quantity, existingAveragePrice: short.averagePrice, side: mirrorSide, fillQuantity: quantity, fillPrice: 2 * centre - price });
        long = { quantity: l.resultingQuantity, averagePrice: l.resultingAveragePrice, realised: long.realised + l.realisedPnl };
        short = { quantity: s.resultingQuantity, averagePrice: s.resultingAveragePrice, realised: short.realised + s.realisedPnl };

        expect(short.quantity + long.quantity).toBe(0);
        expectClose(short.realised, long.realised, `trial ${trial} realised`);
        const mark = 500 + random() * 1_000;
        const longUnrealised = long.quantity === 0 ? 0 : calculateMarkedUnrealisedPnl(long, mark);
        const shortUnrealised = short.quantity === 0 ? 0 : calculateMarkedUnrealisedPnl(short, 2 * centre - mark);
        expectClose(shortUnrealised, longUnrealised, `trial ${trial} unrealised`);
      }
    }
  });
});

/**
 * applyFill's quote policy: production callers pass none and get paperExecutionPolicy(), which must
 * keep rejecting synthetic quotes. Only the demo seed opts into synthetic fills explicitly.
 */
import { describe, expect, it } from "bun:test";
import { PaperExecutionError } from "@shared/domain/paper-trading/execution";
import type { ExecutionQuote } from "@shared/types";
import { applyFill } from "./fill-writer";
import type { PaperAccountRow, PaperOrderRow } from "./contracts";
import type { PaperTradingWriteRepository } from "./repository";

const now = new Date();
const account: PaperAccountRow = {
  userId: "00000000-0000-4000-8000-0000000000f1",
  cashBalance: "1000000.0000",
  allocatedMargin: "0.0000",
  maintenanceMargin: "0.0000",
  leverageFactor: 5,
  liquidationThreshold: "0.1000",
  isLocked: false,
  createdAt: now,
  updatedAt: now,
  initialCash: "1000000.0000",
  realisedPnl: "0.0000",
  status: "ACTIVE",
  lockReason: null,
  lockedAt: null,
  liquidationCompletedAt: null,
  generation: 1,
  version: 1,
  currency: "INR",
  lastEquity: null,
  lastValuedAt: null,
  resetAt: null,
};
const order: PaperOrderRow = {
  id: "00000000-0000-4000-8000-0000000000f2",
  userId: account.userId,
  parentOrderId: null,
  symbol: "DEMO-ARKA",
  exchange: "NSE",
  side: "BUY",
  type: "MARKET",
  status: "PENDING",
  executionType: "GOOD_TILL_CANCELLED",
  qty: 10,
  limitPrice: null,
  stopPrice: null,
  stopLossPrice: null,
  takeProfitPrice: null,
  filledQty: 0,
  averageFillPrice: null,
  slippageApplied: "0.0000",
  transactionFee: "0.0000",
  rejectReason: null,
  trailingDistance: null,
  trailingHwm: null,
  trailingLwm: null,
  isTrailingPercent: false,
  placedAt: now,
  filledAt: null,
  updatedAt: now,
  clientOrderId: null,
  idempotencyKey: null,
  generation: 1,
  triggeredAt: null,
  cancelledAt: null,
  lastFillAt: null,
  quoteSource: null,
  quoteQuality: null,
  quoteTimestamp: null,
  referencePrice: null,
  lastQuoteFingerprint: null,
  version: 1,
};

class WriteReached extends Error {}

/** Records whether applyFill got past quote validation to its first write. */
function attempt(quote: ExecutionQuote, policy?: Parameters<typeof applyFill>[0]["policy"]) {
  const write = {
    findWorkingChildOrdersForUpdate: async () => [],
    nextExecutionSequence: async () => 1,
    insertFill: async () => {
      throw new WriteReached();
    },
  } as unknown as PaperTradingWriteRepository; // applyFill reads only these before its first write
  return applyFill({
    write,
    account,
    order,
    positions: [],
    quote,
    quoteFingerprint: "fp",
    fillQuantity: order.qty,
    reason: "USER_ORDER",
    ledgerSourceType: "FILL",
    markFor: () => undefined,
    now,
    createId: () => crypto.randomUUID(),
    policy,
  });
}

const synthetic: ExecutionQuote = { exchange: "NSE", symbol: "DEMO-ARKA", price: 100, volume: 1000, ts: now.toISOString(), source: "simulated", quality: "synthetic" };

describe("applyFill quote policy", () => {
  it("rejects a synthetic quote before any write when no policy is passed", async () => {
    const error = await attempt(synthetic).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PaperExecutionError);
    expect((error as Error).message).toContain("Synthetic quotes are rejected");
  });

  it("fills the same order from a live quote under the default policy", async () => {
    const live: ExecutionQuote = { ...synthetic, source: "angelone", quality: "live" };
    expect(await attempt(live).catch((e: unknown) => e)).toBeInstanceOf(WriteReached);
  });

  it("accepts a synthetic quote only when the caller passes a policy allowing it", async () => {
    expect(await attempt(synthetic, { allowSynthetic: true }).catch((e: unknown) => e)).toBeInstanceOf(WriteReached);
  });
});

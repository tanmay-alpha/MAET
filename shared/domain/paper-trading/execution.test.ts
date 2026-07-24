import { describe, expect, it } from "bun:test";
import type { ExecutionQuote } from "../../types/market";
import {
  PAPER_TRANSACTION_FEE_RATE,
  PaperExecutionError,
  createExecutionPlan,
  executePaperFill,
  settlePaperAccount,
  type PaperExecutionRequest,
} from "./execution";
import type {
  PaperAccount,
  PaperOrder,
  PaperPosition,
} from "./types";

function liveQuote(
  price = 1000,
  overrides: Partial<ExecutionQuote> = {}
): ExecutionQuote {
  return {
    exchange: "NSE",
    symbol: "RELIANCE",
    price,
    volume: 10_000,
    ts: new Date().toISOString(),
    source: "angelone",
    quality: "live",
    ...overrides,
  };
}

function order(
  overrides: Partial<PaperOrder> = {}
): PaperOrder {
  const timestamp = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    symbol: "RELIANCE",
    side: "BUY",
    quantity: 10,
    type: "MARKET",
    status: "PENDING",
    filledQuantity: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function position(
  quantity: number,
  averagePrice: number,
  unrealisedPnl = 0
): PaperPosition {
  return {
    symbol: "RELIANCE",
    quantity,
    averagePrice,
    marginLocked:
      (Math.abs(quantity) * averagePrice) / 5,
    realisedPnl: 0,
    unrealisedPnl,
    updatedAt: new Date().toISOString(),
  };
}

function account(
  paperOrder: PaperOrder,
  positions: PaperPosition[] = [],
  cash = 1_000_000
): PaperAccount {
  const allocatedMargin = positions.reduce(
    (total, current) =>
      total +
      (Math.abs(current.quantity) *
        current.averagePrice) /
        5,
    0
  );
  return {
    version: 3,
    initialCash: cash,
    cash,
    allocatedMargin,
    maintenanceMargin: allocatedMargin * 0.8,
    realisedPnl: 0,
    status: "ACTIVE",
    positions,
    orders: [paperOrder],
    fills: [],
  };
}

function request(
  paperOrder: PaperOrder,
  quote: ExecutionQuote,
  paperAccount = account(paperOrder),
  fillQuantity = paperOrder.quantity
): PaperExecutionRequest {
  return {
    account: paperAccount,
    order: paperOrder,
    fillQuantity,
    quote,
    reason: "USER_ORDER",
  };
}

function expectExecutionError(
  operation: () => unknown,
  code: PaperExecutionError["code"]
): void {
  try {
    operation();
    throw new Error("Expected paper execution to fail");
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(PaperExecutionError);
    if (error instanceof PaperExecutionError) {
      expect(error.code).toBe(code);
    }
  }
}

describe("authoritative paper execution boundary", () => {
  it("rejects synthetic quotes on a direct call", () => {
    const paperOrder = order();
    expectExecutionError(
      () =>
        executePaperFill(
          request(
            paperOrder,
            liveQuote(1000, {
              source: "simulated",
              quality: "synthetic",
            })
          )
        ),
      "NON_EXECUTABLE_QUOTE"
    );
  });

  it("rejects delayed quotes on a direct call", () => {
    const paperOrder = order();
    expectExecutionError(
      () =>
        executePaperFill(
          request(
            paperOrder,
            liveQuote(1000, {
              source: "yahoo",
              quality: "delayed",
            })
          )
        ),
      "NON_EXECUTABLE_QUOTE"
    );
  });

  it("rejects stale quotes on a direct call", () => {
    const paperOrder = order();
    expectExecutionError(
      () =>
        executePaperFill(
          request(
            paperOrder,
            liveQuote(1000, {
              ts: new Date(
                Date.now() - 10_000
              ).toISOString(),
            })
          )
        ),
      "NON_EXECUTABLE_QUOTE"
    );
  });

  it("rejects wrong-symbol and malformed quotes on a direct call", () => {
    const paperOrder = order();
    expectExecutionError(
      () =>
        executePaperFill(
          request(
            paperOrder,
            liveQuote(1000, { symbol: "TCS" })
          )
        ),
      "INVALID_QUOTE"
    );

    const malformed = {
      symbol: "RELIANCE",
      price: 1000,
    } as unknown as ExecutionQuote;
    expectExecutionError(
      () =>
        executePaperFill(
          request(paperOrder, malformed)
        ),
      "INVALID_QUOTE"
    );
  });

  it("ignores extra caller fill values and calculates its own plan", () => {
    const paperOrder = order();
    const baseRequest = request(
      paperOrder,
      liveQuote(1000)
    );
    const attemptedBypass = {
      ...baseRequest,
      referencePrice: 1,
      fillPrice: 1,
      slippage: 0,
      fees: 0,
    };
    const result = executePaperFill(attemptedBypass);

    expect(result.fill.referencePrice).toBe(1000);
    expect(result.fill.fillPrice).toBeGreaterThan(1000);
    expect(result.fill.slippage).toBeGreaterThan(0);
    expect(result.fill.fees).toBeGreaterThan(0);
  });
});

describe("canonical price protection", () => {
  it("never fills a BUY limit above its limit", () => {
    const paperOrder = order({
      type: "LIMIT",
      side: "BUY",
      limitPrice: 100,
      quantity: 100,
    });
    const plan = createExecutionPlan(
      request(paperOrder, liveQuote(99.99))
    );

    expect(plan.fillPrice).toBe(100);
    expect(plan.fillPrice).toBeLessThanOrEqual(100);
    expect(plan.slippage).toBeCloseTo(0.01, 8);
  });

  it("never fills a SELL limit below its limit", () => {
    const paperOrder = order({
      type: "LIMIT",
      side: "SELL",
      limitPrice: 100,
      quantity: 100,
    });
    const plan = createExecutionPlan(
      request(paperOrder, liveQuote(100.01))
    );

    expect(plan.fillPrice).toBe(100);
    expect(plan.fillPrice).toBeGreaterThanOrEqual(100);
    expect(plan.slippage).toBeCloseTo(0.01, 8);
  });

  it("stores actual protected slippage and fees from protected price", () => {
    const paperOrder = order({
      type: "LIMIT",
      side: "BUY",
      limitPrice: 100,
      quantity: 100,
    });
    const result = executePaperFill(
      request(paperOrder, liveQuote(99.99))
    );

    expect(result.fill.slippage).toBeCloseTo(0.01, 8);
    expect(result.fill.fees).toBeCloseTo(
      100 * 100 * PAPER_TRANSACTION_FEE_RATE,
      12
    );
  });

  it("keeps a triggered stop-limit as STOP_LOSS_LIMIT", () => {
    const paperOrder = order({
      type: "STOP_LOSS_LIMIT",
      status: "TRIGGERED",
      triggeredAt: new Date().toISOString(),
      side: "SELL",
      stopPrice: 101,
      limitPrice: 100,
    });
    const result = executePaperFill(
      request(paperOrder, liveQuote(100.01))
    );

    expect(result.account.orders[0].type).toBe(
      "STOP_LOSS_LIMIT"
    );
    expect(result.account.orders[0].status).toBe("FILLED");
  });

  it("rejects an untriggered stop-limit direct call", () => {
    const paperOrder = order({
      type: "STOP_LOSS_LIMIT",
      status: "PENDING",
      side: "SELL",
      stopPrice: 101,
      limitPrice: 100,
    });
    expectExecutionError(
      () =>
        executePaperFill(
          request(paperOrder, liveQuote(100.01))
        ),
      "INVALID_ORDER"
    );
  });
});

describe("projected execution margin", () => {
  it("allows a reversal that releases old margin", () => {
    const paperOrder = order({
      side: "SELL",
      quantity: 110,
    });
    const result = executePaperFill(
      request(
        paperOrder,
        liveQuote(1000),
        account(
          paperOrder,
          [position(100, 1000)],
          20_000
        )
      )
    );

    expect(result.account.positions[0].quantity).toBe(-10);
    expect(result.account.allocatedMargin).toBeLessThan(
      2_001
    );
  });

  it("rejects an oversized reversal", () => {
    const paperOrder = order({
      side: "SELL",
      quantity: 250,
    });
    expectExecutionError(
      () =>
        executePaperFill(
          request(
            paperOrder,
            liveQuote(1000),
            account(
              paperOrder,
              [position(100, 1000)],
              20_000
            )
          )
        ),
      "INSUFFICIENT_MARGIN"
    );
  });

  it("allows a position reduction and close when projected margin falls", () => {
    const reduction = order({
      side: "SELL",
      quantity: 50,
    });
    const reduced = executePaperFill(
      request(
        reduction,
        liveQuote(1000),
        account(
          reduction,
          [position(100, 1000)],
          21_000
        )
      )
    );
    expect(reduced.account.positions[0].quantity).toBe(50);
    expect(reduced.account.allocatedMargin).toBe(10_000);

    const close = order({
      side: "SELL",
      quantity: 100,
    });
    const closed = executePaperFill(
      request(
        close,
        liveQuote(1000),
        account(
          close,
          [position(100, 1000)],
          21_000
        )
      )
    );
    expect(closed.account.positions).toHaveLength(0);
    expect(closed.account.allocatedMargin).toBe(0);
  });

  it("checks a same-direction increase against projected margin", () => {
    const paperOrder = order({
      side: "BUY",
      quantity: 1,
    });
    expectExecutionError(
      () =>
        executePaperFill(
          request(
            paperOrder,
            liveQuote(1000),
            account(
              paperOrder,
              [position(100, 1000)],
              20_000
            )
          )
        ),
      "INSUFFICIENT_MARGIN"
    );
  });

  it("includes slippage and fees in post-fill equity", () => {
    const paperOrder = order({
      side: "BUY",
      quantity: 10,
    });
    const result = executePaperFill(
      request(paperOrder, liveQuote(1000))
    );

    expect(result.account.positions[0].unrealisedPnl).toBe(
      -result.fill.slippage * result.fill.quantity
    );
    expect(result.account.cash).toBe(
      1_000_000 - result.fill.fees
    );
  });
});

describe("settlement liquidity and stop-limit behavior", () => {
  it("leaves a stop-limit triggered across a gap without converting it", () => {
    const paperOrder = order({
      type: "STOP_LOSS_LIMIT",
      side: "SELL",
      stopPrice: 100,
      limitPrice: 99,
      quantity: 10,
    });
    const settled = settlePaperAccount(
      account(paperOrder),
      new Map([
        ["RELIANCE", liveQuote(98, { volume: 1000 })],
      ])
    );

    expect(settled.orders[0].type).toBe(
      "STOP_LOSS_LIMIT"
    );
    expect(settled.orders[0].status).toBe("TRIGGERED");
    expect(settled.fills).toHaveLength(0);
  });

  it("defers limit fills with missing or zero volume", () => {
    for (const volume of [undefined, 0]) {
      const paperOrder = order({
        type: "LIMIT",
        side: "BUY",
        limitPrice: 100,
      });
      const settled = settlePaperAccount(
        account(paperOrder),
        new Map([
          ["RELIANCE", liveQuote(99, { volume })],
        ])
      );
      expect(settled.orders[0].status).toBe("PENDING");
      expect(settled.fills).toHaveLength(0);
    }
  });

  it("caps a partial fill at ten percent of quote volume", () => {
    const paperOrder = order({
      type: "LIMIT",
      side: "BUY",
      limitPrice: 100,
      quantity: 100,
    });
    const settled = settlePaperAccount(
      account(paperOrder),
      new Map([
        ["RELIANCE", liveQuote(99, { volume: 50 })],
      ])
    );

    expect(settled.orders[0].status).toBe(
      "PARTIALLY_FILLED"
    );
    expect(settled.orders[0].filledQuantity).toBe(5);
    expect(settled.fills[0].quantity).toBe(5);
  });
});

describe("fill accounting is applied exactly once", () => {
  it("handles long and short partial reductions", () => {
    const longReduction = order({
      side: "SELL",
      quantity: 40,
    });
    const longResult = executePaperFill(
      request(
        longReduction,
        liveQuote(1100),
        account(
          longReduction,
          [position(100, 1000)]
        )
      )
    );
    expect(longResult.account.positions[0].quantity).toBe(60);
    expect(longResult.fill.realisedPnl).toBeGreaterThan(0);

    const shortReduction = order({
      side: "BUY",
      quantity: 40,
    });
    const shortResult = executePaperFill(
      request(
        shortReduction,
        liveQuote(900),
        account(
          shortReduction,
          [position(-100, 1000)]
        )
      )
    );
    expect(shortResult.account.positions[0].quantity).toBe(-60);
    expect(shortResult.fill.realisedPnl).toBeGreaterThan(0);
  });

  it("handles long/short closes and both reversal directions", () => {
    const cases: Array<{
      existing: number;
      side: "BUY" | "SELL";
      quantity: number;
      expected: number;
    }> = [
      { existing: 10, side: "SELL", quantity: 10, expected: 0 },
      { existing: -10, side: "BUY", quantity: 10, expected: 0 },
      { existing: 10, side: "SELL", quantity: 15, expected: -5 },
      { existing: -10, side: "BUY", quantity: 15, expected: 5 },
    ];

    for (const testCase of cases) {
      const paperOrder = order({
        side: testCase.side,
        quantity: testCase.quantity,
      });
      const result = executePaperFill(
        request(
          paperOrder,
          liveQuote(1000),
          account(
            paperOrder,
            [position(testCase.existing, 1000)]
          )
        )
      );
      const resultingQuantity =
        result.account.positions[0]?.quantity ?? 0;
      expect(resultingQuantity).toBe(testCase.expected);
    }
  });

  it("records one fill, one order aggregate, and one cash/PnL update", () => {
    const paperOrder = order({
      side: "SELL",
      quantity: 5,
    });
    const initial = account(
      paperOrder,
      [position(10, 1000)]
    );
    const result = executePaperFill(
      request(paperOrder, liveQuote(1100), initial)
    );

    expect(result.account.fills).toHaveLength(1);
    expect(result.account.orders[0].filledQuantity).toBe(5);
    expect(result.account.orders[0].averageFillPrice).toBe(
      result.fill.fillPrice
    );
    expect(result.account.realisedPnl).toBe(
      result.fill.realisedPnl
    );
    expect(result.account.cash).toBe(
      initial.cash +
        result.fill.realisedPnl -
        result.fill.fees
    );
  });
});

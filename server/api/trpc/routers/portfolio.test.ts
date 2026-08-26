import { describe, expect, it, mock } from "bun:test";

const selections: unknown[][] = [];

function query(rows: unknown[]) {
  const builder = {
    where: () => builder,
    orderBy: () => builder,
    then: <TResult1 = unknown[], TResult2 = never>(
      onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) => Promise.resolve(rows).then(onfulfilled, onrejected),
  };
  return builder;
}

mock.module("../../../data/drizzle/client", () => ({
  db: {
    select: () => ({ from: () => query(selections.shift() ?? []) }),
  },
}));

const { portfolioRouter } = await import("./portfolio");

describe("portfolio.getAnalytics", () => {
  it("calculates analytics from seeded closed paper fills", async () => {
    selections.push(
      [{ id: "order-1" }],
      [{ generation: 1, initialCash: "1000.0000" }],
      [
        { symbol: "ABC", exchange: "NSE", side: "BUY", quantity: 10, fillPrice: "100.0000", fees: "0.0000", realizedPnl: "0.0000", executedAt: new Date("2026-01-05T09:15:00.000Z") },
        { symbol: "ABC", exchange: "NSE", side: "SELL", quantity: 10, fillPrice: "110.0000", fees: "0.0000", realizedPnl: "100.0000", executedAt: new Date("2026-01-05T15:15:00.000Z") },
        { symbol: "ABC", exchange: "NSE", side: "BUY", quantity: 10, fillPrice: "100.0000", fees: "0.0000", realizedPnl: "0.0000", executedAt: new Date("2026-01-06T09:15:00.000Z") },
        { symbol: "ABC", exchange: "NSE", side: "SELL", quantity: 10, fillPrice: "90.0000", fees: "0.0000", realizedPnl: "-100.0000", executedAt: new Date("2026-01-06T15:15:00.000Z") },
        { symbol: "ABC", exchange: "NSE", side: "BUY", quantity: 10, fillPrice: "100.0000", fees: "0.0000", realizedPnl: "0.0000", executedAt: new Date("2026-01-07T09:15:00.000Z") },
        { symbol: "ABC", exchange: "NSE", side: "SELL", quantity: 10, fillPrice: "120.0000", fees: "0.0000", realizedPnl: "200.0000", executedAt: new Date("2026-01-07T15:15:00.000Z") },
      ],
      [],
    );

    const caller = portfolioRouter.createCaller({
      userId: "user-1",
      email: null,
      role: "user",
    });
    const analytics = await caller.getAnalytics();

    expect(analytics.sharpeRatio).toBeCloseTo(9.1341109848, 10);
    expect(analytics.winRate).toBeCloseTo(66.6666666667, 10);
    expect(analytics.maxDrawdown).toBeCloseTo(0.0909090909, 10);
  });
});

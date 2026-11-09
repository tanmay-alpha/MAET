import { afterAll, describe, expect, it, mock } from "bun:test";
import { TRPCError } from "@trpc/server";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import * as drizzleClientModule from "../../../data/drizzle/client";

interface MockQueryBuilder {
  where: (...args: unknown[]) => MockQueryBuilder;
  orderBy: (...args: unknown[]) => MockQueryBuilder;
  limit: (n: number) => MockQueryBuilder;
  then: <TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) => Promise<TResult1 | TResult2>;
}

const mockSelections: unknown[][] = [];
let lastCapturedLimit: number | null = null;
let lastCapturedWhere: unknown[] = [];

function createMockQuery(rows: unknown[]): MockQueryBuilder {
  const builder: MockQueryBuilder = {
    where: (...args: unknown[]) => {
      lastCapturedWhere = args;
      return builder;
    },
    orderBy: () => builder,
    limit: (n: number) => {
      lastCapturedLimit = n;
      return builder;
    },
    then: <TResult1 = unknown[], TResult2 = never>(
      onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) => Promise.resolve(rows).then(onfulfilled, onrejected),
  };
  return builder;
}

// mock.module is process-wide in Bun and outlives this file. Snapshot the real
// client and put it back afterwards so later files in the same `bun test` run
// (e.g. companies-peers.test.ts) don't silently query this stub.
const realDrizzleClient = { ...drizzleClientModule };
afterAll(() => {
  mock.module("../../../data/drizzle/client", () => realDrizzleClient);
});

mock.module("../../../data/drizzle/client", () => ({
  db: {
    select: () => ({
      from: () => createMockQuery(mockSelections.shift() ?? []),
    }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([{ id: "mock-run-id-123", name: "preset-name" }]),
      }),
    }),
    delete: () => ({
      where: () => Promise.resolve(),
    }),
  },
}));

const { backtestV2Router, MAX_BACKTEST_CANDLES } = await import("./backtest-v2");

describe("backtestV2Router TRPC tests", () => {
  const caller = backtestV2Router.createCaller({
    userId: "test-user-1",
    email: "test@example.com",
    role: "user",
  });

  const baseInput = {
    symbol: "INFY",
    timeframe: "1d" as const,
    strategy: {
      type: "SMA_CROSS" as const,
      fastPeriod: 5,
      slowPeriod: 10,
    },
    risk: {
      initialCapital: 100000,
      feeBps: 10,
      slippageBps: 5,
      positionSizePercent: 100,
      maximumOpenPositions: 1,
    },
  };

  it("1. Rejects maximumOpenPositions > 1 with BAD_REQUEST describing portfolio runner", async () => {
    try {
      await caller.run({
        ...baseInput,
        risk: {
          ...baseInput.risk,
          maximumOpenPositions: 3,
        },
      });
      expect(true).toBe(false); // Should not reach here
    } catch (err: any) {
      expect(err).toBeInstanceOf(TRPCError);
      expect(err.code).toBe("BAD_REQUEST");
      expect(err.message).toContain("Single-symbol backtest engine supports maximumOpenPositions = 1");
      expect(err.message).toContain("portfolio backtesting");
    }
  });

  it("2. Rejects invalid 'from' date format with BAD_REQUEST", async () => {
    try {
      await caller.run({
        ...baseInput,
        from: "invalid-date-format",
      });
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err).toBeInstanceOf(TRPCError);
      expect(err.code).toBe("BAD_REQUEST");
      expect(err.message).toContain("Invalid 'from' date format");
    }
  });

  it("3. Rejects invalid 'to' date format with BAD_REQUEST", async () => {
    try {
      await caller.run({
        ...baseInput,
        to: "not-a-valid-date",
      });
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err).toBeInstanceOf(TRPCError);
      expect(err.code).toBe("BAD_REQUEST");
      expect(err.message).toContain("Invalid 'to' date format");
    }
  });

  it("4. Rejects when 'from' is greater than 'to'", async () => {
    try {
      await caller.run({
        ...baseInput,
        from: "2026-06-01T00:00:00Z",
        to: "2026-01-01T00:00:00Z",
      });
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err).toBeInstanceOf(TRPCError);
      expect(err.code).toBe("BAD_REQUEST");
      expect(err.message).toContain("must be earlier than or equal to 'to' date");
    }
  });

  it("5. Enforces MAX_BACKTEST_CANDLES safety limit", async () => {
    // Generate MAX_BACKTEST_CANDLES + 1 dummy candles
    const overflowCandles = Array.from({ length: MAX_BACKTEST_CANDLES + 1 }, (_, i) => ({
      id: `c-${i}`,
      symbol: "INFY",
      timeframe: "1d",
      ts: new Date(Date.UTC(2020, 0, 1) + i * 86400000),
      open: "100.00",
      high: "105.00",
      low: "95.00",
      close: "102.00",
      volume: 1000,
      source: "NSE",
    }));

    mockSelections.push(overflowCandles);

    try {
      await caller.run({
        ...baseInput,
        from: "2020-01-01T00:00:00Z",
        to: "2025-01-01T00:00:00Z",
      });
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err).toBeInstanceOf(TRPCError);
      expect(err.code).toBe("BAD_REQUEST");
      expect(err.message).toContain("Backtest interval contains too many candles");
    }
  });

  it("6. Runs successfully within bounds, returns effectivePeriod and version v3", async () => {
    const validCandles = Array.from({ length: 60 }, (_, i) => ({
      id: `c-${i}`,
      symbol: "INFY",
      timeframe: "1d",
      ts: new Date(Date.UTC(2025, 0, 1) + i * 86400000),
      open: (1000 + i).toFixed(2),
      high: (1010 + i).toFixed(2),
      low: (990 + i).toFixed(2),
      close: (1005 + i).toFixed(2),
      volume: 10000,
      source: "NSE",
    }));

    mockSelections.push(validCandles);

    const res = await caller.run({
      ...baseInput,
      from: "2025-01-01T00:00:00.000Z",
      to: "2025-03-01T00:00:00.000Z",
    });

    expect(res.runId).toBe("mock-run-id-123");
    expect(res.status).toBe("completed");
    expect(res.effectivePeriod).toBeDefined();
    expect(res.effectivePeriod.from).toBe(validCandles[0].ts.toISOString());
    expect(res.effectivePeriod.to).toBe(validCandles[validCandles.length - 1].ts.toISOString());
    expect(res.result.engineVersion).toBe("v3");
    expect(res.result.symbol).toBe("INFY");
    expect(res.result.metrics).toBeDefined();
    expect(res.result.equityCurve.length).toBe(60);
  });

  it("7. listRuns respects user-provided limit parameter", async () => {
    mockSelections.push([]);
    await caller.listRuns({ limit: 7 });
    expect(lastCapturedLimit).toBe(7);

    mockSelections.push([]);
    await caller.listRuns();
    expect(lastCapturedLimit).toBe(20);
  });

  it("8. Rejects oversize indicator periods and too many combined rules with BAD_REQUEST", async () => {
    const oversize = [
      { ...baseInput, strategy: { ...baseInput.strategy, slowPeriod: 100_000 } },
      { ...baseInput, strategy: { type: "DONCHIAN_BREAKOUT" as const, donchianPeriod: 100_000 } },
      {
        ...baseInput,
        strategy: {
          ...baseInput.strategy,
          combinedRules: Array.from({ length: 500 }, () => ({ indicator: "RSI", op: ">", value: 50 })),
        },
      },
    ];
    for (const input of oversize) {
      const err = await caller.run(input).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe("BAD_REQUEST");
    }
  });

  it("9. Rejects unknown timeframes with BAD_REQUEST", async () => {
    const err = await caller.run({ ...baseInput, timeframe: "1d'; --" as "1d" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("BAD_REQUEST");
  });

  it("10. compareRuns binds each run id individually, scoped to the caller", async () => {
    const runIds = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"];
    mockSelections.push([]);
    await caller.compareRuns({ runIds });
    const query = new PgDialect().sqlToQuery(lastCapturedWhere[0] as SQL);
    expect(query.params).toEqual(["test-user-1", ...runIds]);
    expect(query.sql).not.toContain("::uuid[]");
  });
});

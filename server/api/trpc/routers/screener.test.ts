import { afterAll, describe, it, expect, mock } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { getCalculator, type CalculatorInput } from "../../../domain/calculations/engine/calculator-registry";
import * as drizzleClientModule from "../../../data/drizzle/client";
import { candles, companies, technicalSnapshots } from "../../../db/schema";
import {
  applyCandleFilters,
  CALCULATION_RESULTS_FILTERS,
  calculationResultsFilterQuery,
  MAX_SAVED_SCREENERS_PER_USER,
  MAX_SCREENER_FILTERS,
  screenerRouter,
} from "./screener";

const BARS = 120;
const closes = Array.from({ length: BARS }, (_, i) => 400 + 30 * Math.sin(i / 8) + 0.4 * i);
const input: CalculatorInput = {
  symbol: "TEST",
  closes,
  opens: closes.map((c) => c - 1),
  highs: closes.map((c, i) => c + 3 + (i % 3)),
  lows: closes.map((c, i) => c - 3 - (i % 2)),
  volumes: closes.map((_, i) => 20_000 + (i % 5) * 1_000),
  dates: closes.map((_, i) => new Date(Date.UTC(2025, 0, 1 + i)).toISOString().split("T")[0]),
};

describe("screener calculation_results fallback", () => {
  it("only filters on indicator rows the calculation engine actually stores", () => {
    for (const [field, source] of Object.entries(CALCULATION_RESULTS_FILTERS)) {
      const calc = getCalculator(source.indicatorName);
      expect({ field, registered: calc !== undefined }).toEqual({ field, registered: true });

      const [row] = calc!.calculate(input);
      for (const column of source.columns) {
        expect({ field, column, stored: row?.[column] != null }).toEqual({ field, column, stored: true });
      }
    }
  });

  it("covers MACD, Stochastic %K, Williams %R and Bollinger width", () => {
    for (const field of ["macd_value", "stoch_k", "williams_r", "bollinger_width"]) {
      expect(CALCULATION_RESULTS_FILTERS[field]).toBeDefined();
    }
  });

  it("binds each symbol individually and only the values the filter needs", () => {
    const dialect = new PgDialect();
    const render = (operator: string) => dialect.sqlToQuery(calculationResultsFilterQuery({
      symbols: ["TCS", "INFY"],
      source: CALCULATION_RESULTS_FILTERS.rsi_14,
      latestDate: "2026-01-02",
      operator,
      value: 30,
    }));

    const gt = render("gt");
    expect(gt.params).toEqual(["TCS", "INFY", "RSI_14", "2026-01-02", 30]);
    expect(gt.sql).not.toContain("::text[]");

    // Operators without a scalar comparison (e.g. "between") add no stray "" parameter.
    expect(render("between").params).toEqual(["TCS", "INFY", "RSI_14", "2026-01-02"]);
  });
});

describe("applyCandleFilters", () => {
  const rows = [
    { symbol: "TCS", timeframe: "1d", source: "nse", volume: 5_000 },
    { symbol: "INFY", timeframe: "1d", source: "nse", volume: 50 },
  ];

  it("keeps only rows satisfying every filter", () => {
    expect(applyCandleFilters(rows, [{ field: "volume", operator: "gt", value: 1_000 }]).map((r) => r.symbol)).toEqual(["TCS"]);
    expect(applyCandleFilters(rows, [{ field: "volume", operator: "between", value: [10, 100] }]).map((r) => r.symbol)).toEqual(["INFY"]);
    expect(applyCandleFilters(rows, [
      { field: "volume", operator: "gte", value: 50 },
      { field: "volume", operator: "lt", value: 50 },
    ])).toEqual([]);
    expect(applyCandleFilters(rows, [])).toEqual(rows);
  });
});

// runScreen against a stubbed db. mock.module is process-wide in Bun: restore the real client
// afterwards so later files in the same run don't query this stub.
const realDrizzleClient = { ...drizzleClientModule };
afterAll(() => {
  mock.module("../../../data/drizzle/client", () => realDrizzleClient);
});

const selectRows = new Map<unknown, unknown[]>();
const selectedTables: unknown[] = [];
const executeResults: unknown[][] = [];
const executed: SQL[] = [];

function query(rows: unknown[]) {
  const builder = {
    $dynamic: () => builder,
    where: () => builder,
    orderBy: () => builder,
    limit: () => builder,
    then: <T>(onfulfilled: (value: unknown[]) => T) => Promise.resolve(rows).then(onfulfilled),
  };
  return builder;
}

/** Rows a user already has in screener_runs (read by saveScreener's cap check). */
let savedScreenerCount = 0;
const inserted: unknown[] = [];
const savedTx = {
  execute: (statement: SQL) => {
    executed.push(statement);
    return Promise.resolve([]);
  },
  select: () => ({ from: () => ({ where: () => Promise.resolve([{ count: savedScreenerCount }]) }) }),
  insert: () => ({
    values: (row: unknown) => {
      inserted.push(row);
      return { returning: () => Promise.resolve([{ id: "saved-1", name: "mine", startedAt: new Date("2026-01-02T00:00:00Z") }]) };
    },
  }),
};

mock.module("../../../data/drizzle/client", () => ({
  ...realDrizzleClient,
  db: {
    select: () => ({
      from: (table: unknown) => {
        selectedTables.push(table);
        return query(selectRows.get(table) ?? []);
      },
    }),
    execute: (statement: SQL) => {
      executed.push(statement);
      return Promise.resolve(executeResults.shift() ?? []);
    },
    transaction: <T>(fn: (tx: typeof savedTx) => Promise<T>) => fn(savedTx),
  },
}));

describe("screener.runScreen", () => {
  const caller = screenerRouter.createCaller({ userId: "test-user-1", email: "test@example.com", role: "user" });
  const candle = (symbol: string, volume: number) =>
    ({ symbol, timeframe: "1d", ts: "2026-01-02T00:00:00Z", open: 1, high: 1, low: 1, close: 1, volume, source: "nse" });

  const reset = () => {
    selectRows.clear();
    selectedTables.length = 0;
    executeResults.length = 0;
    executed.length = 0;
    selectRows.set(companies, [{ symbol: "TCS" }, { symbol: "INFY" }]);
    // A candle-only fallback would return this row.
    selectRows.set(candles, [candle("WIPRO", 1_000_000)]);
  };

  it("applies candle filters to the technical matches", async () => {
    reset();
    selectRows.set(technicalSnapshots, [{ symbol: "TCS" }, { symbol: "INFY" }]);
    executeResults.push([candle("TCS", 5_000), candle("INFY", 10)]);

    const res = await caller.runScreen({
      filters: [
        { field: "rsi_14", operator: "gt", value: 70 },
        { field: "volume", operator: "gt", value: 1_000 },
      ],
    });

    expect(res.results.map((r) => r.symbol)).toEqual(["TCS"]);
    expect(selectedTables).not.toContain(candles);
  });

  it("returns nothing when the technical filters match nothing", async () => {
    reset();
    executeResults.push([{ max_date: null }]);

    const res = await caller.runScreen({
      filters: [
        { field: "rsi_14", operator: "gt", value: 70 },
        { field: "volume", operator: "gt", value: 1_000 },
      ],
    });

    expect(res.results).toEqual([]);
    expect(selectedTables).not.toContain(candles);
  });

  it("returns nothing for filters it cannot evaluate", async () => {
    reset();
    const res = await caller.runScreen({ filters: [{ field: "pe_ratio", operator: "lt", value: 20 }] });

    expect(res.results).toEqual([]);
    expect(res.warnings.join(" ")).toContain("pe_ratio");
    expect(selectedTables).toEqual([]);
  });

  it("screens a technical range as both inclusive bounds", async () => {
    reset();
    executeResults.push([{ max_date: "2026-01-02" }], [{ symbol: "TCS" }, { symbol: "INFY" }], [{ symbol: "TCS" }], [candle("TCS", 5_000)]);

    const res = await caller.runScreen({ filters: [{ field: "stoch_k", operator: "between", value: [20, 80] }] });

    expect(res.results.map((r) => r.symbol)).toEqual(["TCS"]);
    const dialect = new PgDialect();
    const [gteQuery, lteQuery] = executed.slice(1, 3).map((s) => dialect.sqlToQuery(s));
    expect(gteQuery.sql).toContain(">=");
    expect(gteQuery.params).toContain(20);
    expect(lteQuery.sql).toContain("<=");
    expect(lteQuery.params).toContain(80);
  });
});

describe("screener input bounds", () => {
  const caller = screenerRouter.createCaller({ userId: "test-user-1", email: "test@example.com", role: "user" });
  const filters = (count: number) =>
    Array.from({ length: count }, (_, i) => ({ field: "volume" as const, operator: "gt" as const, value: i }));

  it("rejects one filter more than the cap before touching the database, on both procedures", async () => {
    selectedTables.length = 0;
    executed.length = 0;
    inserted.length = 0;
    const tooMany = filters(MAX_SCREENER_FILTERS + 1);
    await expect(caller.runScreen({ filters: tooMany })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.saveScreener({ name: "wide", filters: tooMany })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(selectedTables).toEqual([]);
    expect(executed).toEqual([]);
    expect(inserted).toEqual([]);
  });

  it("accepts exactly the cap", async () => {
    selectRows.clear();
    await expect(caller.runScreen({ filters: filters(MAX_SCREENER_FILTERS) })).resolves.toMatchObject({ results: [] });
  });

  it("rejects a range value with more than its two bounds", async () => {
    await expect(
      caller.runScreen({ filters: [{ field: "volume", operator: "between", value: [1, 2, 3] }] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("saves below the per-user cap and refuses at it, under the user's advisory lock", async () => {
    executed.length = 0;
    inserted.length = 0;
    savedScreenerCount = MAX_SAVED_SCREENERS_PER_USER - 1;
    await expect(caller.saveScreener({ name: "mine", filters: filters(1) })).resolves.toMatchObject({ id: "saved-1" });
    expect(inserted).toHaveLength(1);
    const lock = new PgDialect().sqlToQuery(executed[0]!);
    expect(lock.sql).toContain("pg_advisory_xact_lock");
    expect(lock.params).toEqual(["screener-runs:test-user-1"]);

    savedScreenerCount = MAX_SAVED_SCREENERS_PER_USER;
    await expect(caller.saveScreener({ name: "one more", filters: filters(1) })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(inserted).toHaveLength(1);
  });
});

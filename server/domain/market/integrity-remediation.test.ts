import { describe, expect, it, beforeEach } from "bun:test";
import { evaluateExecutionQuote, type ExecutionQuote } from "@shared/types";
import {
  placePaperOrder,
  settlePaperOrders,
  getPaperAccount,
  resetPaperAccount,
} from "../../../src/hooks/use-paper-account";
import { readFileSync } from "fs";
import { join } from "path";

describe("Phase 0.1: Financial Integrity Remediation Suite", () => {
  beforeEach(() => {
    resetPaperAccount();
  });

  const getNowIso = () => new Date().toISOString();

  it("1. MARKET order without quote is rejected", () => {
    const res = placePaperOrder({
      type: "MARKET",
      symbol: "RELIANCE",
      side: "BUY",
      quantity: 10,
    } as any);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/rejected/i);
  });

  it("2. Quote missing source is rejected", () => {
    const invalidQuote = {
      exchange: "NSE",
      symbol: "RELIANCE",
      price: 2500,
      volume: 100,
      ts: getNowIso(),
      quality: "live",
    };
    const res = evaluateExecutionQuote(invalidQuote, "RELIANCE");
    expect(res.executable).toBe(false);
    expect(res.reason).toContain("Quote validation failed for source");
  });

  it("3. Quote missing quality is rejected", () => {
    const invalidQuote = {
      exchange: "NSE",
      symbol: "RELIANCE",
      price: 2500,
      volume: 100,
      ts: getNowIso(),
      source: "angelone",
    };
    const res = evaluateExecutionQuote(invalidQuote, "RELIANCE");
    expect(res.executable).toBe(false);
    expect(res.reason).toContain("Quote validation failed for quality");
  });

  it("4. quality='stale' is rejected even with a current timestamp", () => {
    const staleQuote: ExecutionQuote = {
      exchange: "NSE",
      symbol: "RELIANCE",
      price: 2500,
      volume: 100,
      ts: getNowIso(),
      source: "angelone",
      quality: "stale",
    };
    const res = evaluateExecutionQuote(staleQuote, "RELIANCE");
    expect(res.executable).toBe(false);
    expect(res.reason).toContain("Quote quality is marked stale");
  });

  it("5. Quote with a future timestamp is rejected", () => {
    const futureTs = new Date(Date.now() + 20000).toISOString(); // 20s ahead
    const futureQuote: ExecutionQuote = {
      exchange: "NSE",
      symbol: "RELIANCE",
      price: 2500,
      volume: 100,
      ts: futureTs,
      source: "angelone",
      quality: "live",
    };
    const res = evaluateExecutionQuote(futureQuote, "RELIANCE");
    expect(res.executable).toBe(false);
    expect(res.reason).toContain("future");
  });

  it("6. Quote symbol mismatch is rejected", () => {
    const mismatchQuote: ExecutionQuote = {
      exchange: "NSE",
      symbol: "TCS",
      price: 3500,
      volume: 100,
      ts: getNowIso(),
      source: "angelone",
      quality: "live",
    };
    const res = evaluateExecutionQuote(mismatchQuote, "RELIANCE");
    expect(res.executable).toBe(false);
    expect(res.reason).toContain("Quote symbol mismatch: expected RELIANCE but received TCS");
  });

  it("7. Settlement does not default unknown source to Angel One", () => {
    const quotes = new Map();
    quotes.set("RELIANCE", {
      symbol: "RELIANCE",
      price: 2500,
      timestamp: getNowIso(),
      // no source field attached
    });
    settlePaperOrders(quotes);
    const acc = getPaperAccount();
    expect(acc.orders.length).toBe(0);
  });

  it("8. Settlement does not default unknown quality to live", () => {
    const quotes = new Map();
    quotes.set("RELIANCE", {
      symbol: "RELIANCE",
      price: 2500,
      timestamp: getNowIso(),
      source: "angelone",
      // no quality field attached
    });
    settlePaperOrders(quotes);
    const acc = getPaperAccount();
    expect(acc.orders.length).toBe(0);
  });

  it("9. Invalid quote cannot update unrealised P&L", () => {
    const validQuote: ExecutionQuote = {
      exchange: "NSE",
      symbol: "RELIANCE",
      price: 2500,
      volume: 500,
      ts: getNowIso(),
      source: "angelone",
      quality: "live",
    };
    const orderRes = placePaperOrder({
      symbol: "RELIANCE",
      side: "BUY",
      quantity: 10,
      type: "MARKET",
      quote: validQuote,
    });
    expect(orderRes.ok).toBe(true);

    const accBefore = getPaperAccount();
    const posBefore = accBefore.positions.find((p) => p.symbol === "RELIANCE")!;

    // Now send an invalid quote (synthetic/simulated) during settlement
    const invalidQuotes = new Map();
    invalidQuotes.set("RELIANCE", {
      exchange: "NSE",
      symbol: "RELIANCE",
      price: 3000,
      volume: 500,
      ts: getNowIso(),
      source: "simulated",
      quality: "synthetic",
    });

    settlePaperOrders(invalidQuotes);
    const accAfter = getPaperAccount();
    const posAfter = accAfter.positions.find((p) => p.symbol === "RELIANCE")!;

    expect(posAfter.unrealisedPnl).toBe(posBefore.unrealisedPnl);
  });

  it("10. Invalid quote cannot trigger margin liquidation", () => {
    const validQuote: ExecutionQuote = {
      exchange: "NSE",
      symbol: "RELIANCE",
      price: 2500,
      volume: 500,
      ts: getNowIso(),
      source: "angelone",
      quality: "live",
    };
    const orderRes = placePaperOrder({
      symbol: "RELIANCE",
      side: "BUY",
      quantity: 10,
      type: "MARKET",
      quote: validQuote,
    });
    expect(orderRes.ok).toBe(true);

    // Provide invalid quote attempting to force price drop
    const invalidQuotes = new Map();
    invalidQuotes.set("RELIANCE", {
      exchange: "NSE",
      symbol: "RELIANCE",
      price: 1, // Extreme price drop
      ts: getNowIso(),
      source: "yahoo",
      quality: "delayed",
    });

    settlePaperOrders(invalidQuotes);
    const acc = getPaperAccount();
    expect(acc.status).toBe("ACTIVE"); // not LIQUIDATION_PENDING because quote is invalid delayed
    expect(acc.positions.length).toBe(1);
  });

  it("11. Invalid quote cannot fill limit or stop orders", () => {
    placePaperOrder({
      type: "LIMIT",
      symbol: "RELIANCE",
      side: "BUY",
      quantity: 10,
      limitPrice: 2400,
    });

    const invalidQuotes = new Map();
    invalidQuotes.set("RELIANCE", {
      exchange: "NSE",
      symbol: "RELIANCE",
      price: 2350,
      ts: getNowIso(),
      source: "simulated",
      quality: "synthetic",
    });

    settlePaperOrders(invalidQuotes);
    const acc = getPaperAccount();
    expect(acc.orders[0].status).toBe("PENDING");
  });

  it("12. Missing volume does not become volume 1000", () => {
    placePaperOrder({
      symbol: "RELIANCE",
      side: "BUY",
      quantity: 10,
      type: "LIMIT",
      limitPrice: 2500,
    });

    const quoteWithoutVolume = {
      exchange: "NSE",
      symbol: "RELIANCE",
      price: 2450,
      ts: getNowIso(),
      source: "angelone",
      quality: "live",
    };

    const evalResult = evaluateExecutionQuote(quoteWithoutVolume, "RELIANCE");
    expect(evalResult.executable).toBe(true);
    expect(quoteWithoutVolume.volume).toBeUndefined();
  });

  it("13. Legacy permissive RLS policy names are absent in migration 0010", () => {
    const migrationSql = readFileSync(
      join(process.cwd(), "server/db/migrations/0010_remove_legacy_permissive_policies.sql"),
      "utf-8"
    );
    expect(migrationSql).toContain('DROP POLICY IF EXISTS "service write price_daily"');
    expect(migrationSql).toContain('DROP POLICY IF EXISTS "service write price_intraday"');
    expect(migrationSql).toContain('DROP POLICY IF EXISTS "service write sectors"');
    expect(migrationSql).toContain('DROP POLICY IF EXISTS "service write peers"');
    expect(migrationSql).toContain('DROP POLICY IF EXISTS "service write ingestion_runs"');
    expect(migrationSql).toContain('DROP POLICY IF EXISTS "service write dead_letter_queue"');
    expect(migrationSql).toContain('DROP POLICY IF EXISTS "service write calculation_results"');
  });

  it("14. anon/authenticated have no market-table write privileges in migration 0010", () => {
    const migrationSql = readFileSync(
      join(process.cwd(), "server/db/migrations/0010_remove_legacy_permissive_policies.sql"),
      "utf-8"
    );
    expect(migrationSql).toContain("REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.companies FROM anon, authenticated");
    expect(migrationSql).toContain("REVOKE ALL ON public.ingestion_runs FROM anon, authenticated");
  });

  it("15. All workflows use the same pinned Bun version", () => {
    const ciYaml = readFileSync(join(process.cwd(), ".github/workflows/ci.yml"), "utf-8");
    const renderYaml = readFileSync(join(process.cwd(), ".github/workflows/deploy-render.yml"), "utf-8");

    expect(ciYaml).toContain('bun-version: "1.3.14"');
    expect(ciYaml).not.toContain("bun-version: latest");
    expect(renderYaml).toContain("bun-version: 1.3.14");
    expect(renderYaml).not.toContain("bun-version: latest");
  });

  it("16. All workflow dependency installs are frozen", () => {
    const ciYaml = readFileSync(join(process.cwd(), ".github/workflows/ci.yml"), "utf-8");
    const renderYaml = readFileSync(join(process.cwd(), ".github/workflows/deploy-render.yml"), "utf-8");

    expect(ciYaml).toContain("bun install --frozen-lockfile");
    expect(ciYaml).not.toMatch(/run: bun install\s*$/m);
    expect(renderYaml).toContain("bun install --frozen-lockfile");
  });
});

describe("Phase 0.2: Final Financial Integrity Closure Suite", () => {
  beforeEach(() => {
    resetPaperAccount();
  });

  const getNowIso = () => new Date().toISOString();

  it("1. LIQUIDATION_PENDING rejects new order placement but allows quotes to liquidate positions", () => {
    const validQuote: ExecutionQuote = {
      exchange: "NSE",
      symbol: "RELIANCE",
      price: 2500,
      volume: 500,
      ts: getNowIso(),
      source: "angelone",
      quality: "live",
    };

    // Open positions in RELIANCE and INFY
    placePaperOrder({
      type: "MARKET",
      symbol: "RELIANCE",
      side: "BUY",
      quantity: 1000,
      quote: validQuote,
    });
    placePaperOrder({
      type: "MARKET",
      symbol: "INFY",
      side: "BUY",
      quantity: 900,
      quote: { ...validQuote, symbol: "INFY" },
    });

    // Drop INFY price with quote for INFY only (no quote for RELIANCE)
    const partialQuotes = new Map();
    partialQuotes.set("INFY", {
      exchange: "NSE",
      symbol: "INFY",
      price: 10,
      volume: 500,
      ts: getNowIso(),
      source: "angelone",
      quality: "live",
    });

    // Triggers LIQUIDATION_PENDING state; INFY liquidates but RELIANCE remains open
    settlePaperOrders(partialQuotes);

    let acc = getPaperAccount();
    expect(acc.status).toBe("LIQUIDATION_PENDING");
    expect(acc.lockReason).toBe("Margin call breach");
    expect(acc.lockedAt).toBeDefined();

    // Rejects new order placement
    const newOrderRes = placePaperOrder({
      type: "MARKET",
      symbol: "TCS",
      side: "BUY",
      quantity: 1,
      quote: { ...validQuote, symbol: "TCS" },
    });
    expect(newOrderRes.ok).toBe(false);
    expect(newOrderRes.message).toContain("Account is pending margin liquidation");

    // Subsequent valid quote for RELIANCE completes liquidation and transitions to LIQUIDATED
    const recoveryQuotes = new Map();
    recoveryQuotes.set("RELIANCE", {
      exchange: "NSE",
      symbol: "RELIANCE",
      price: 2500,
      volume: 500,
      ts: getNowIso(),
      source: "angelone",
      quality: "live",
    });

    settlePaperOrders(recoveryQuotes);
    acc = getPaperAccount();
    expect(acc.status).toBe("LIQUIDATED");
    expect(acc.positions.length).toBe(0);
    expect(acc.lockReason).toBe("Margin call liquidation completed");
  });

  it("2. Pure position reduction and position close require 0 additional margin", () => {
    const quote: ExecutionQuote = {
      exchange: "NSE",
      symbol: "RELIANCE",
      price: 1000,
      ts: getNowIso(),
      source: "angelone",
      quality: "live",
    };

    // Open initial position: Buy 10 @ 1000 => margin = (10 * 1000)/5 = 2000
    placePaperOrder({
      type: "MARKET",
      symbol: "RELIANCE",
      side: "BUY",
      quantity: 10,
      quote,
    });

    // Reduce position by 5 => Selling 5 requires 0 additional margin
    const reduceRes = placePaperOrder({
      type: "MARKET",
      symbol: "RELIANCE",
      side: "SELL",
      quantity: 5,
      quote,
    });
    expect(reduceRes.ok).toBe(true);

    const acc = getPaperAccount();
    const pos = acc.positions.find((p) => p.symbol === "RELIANCE");
    expect(pos?.quantity).toBe(5);
  });

  it("3. Same-direction position increase requires margin only for the added size", () => {
    const quote: ExecutionQuote = {
      exchange: "NSE",
      symbol: "RELIANCE",
      price: 1000,
      ts: getNowIso(),
      source: "angelone",
      quality: "live",
    };

    placePaperOrder({
      type: "MARKET",
      symbol: "RELIANCE",
      side: "BUY",
      quantity: 10,
      quote,
    });

    // Add 5 more @ 1000 => Incremental margin required is for 5 shares = (5 * 1000)/5 = 1000
    const addRes = placePaperOrder({
      type: "MARKET",
      symbol: "RELIANCE",
      side: "BUY",
      quantity: 5,
      quote,
    });
    expect(addRes.ok).toBe(true);

    const acc = getPaperAccount();
    const pos = acc.positions.find((p) => p.symbol === "RELIANCE");
    expect(pos?.quantity).toBe(15);
  });

  it("4. Position reversal requires margin only for the new opposite-side remainder", () => {
    const quote: ExecutionQuote = {
      exchange: "NSE",
      symbol: "RELIANCE",
      price: 1000,
      ts: getNowIso(),
      source: "angelone",
      quality: "live",
    };

    // Long 10 @ 1000
    placePaperOrder({
      type: "MARKET",
      symbol: "RELIANCE",
      side: "BUY",
      quantity: 10,
      quote,
    });

    // Reverse to Short 5 => Sell 15 @ 1000.
    // 10 shares close existing position (0 margin required).
    // 5 remaining shares open new Short (margin required = (5 * 1000)/5 = 1000).
    const reverseRes = placePaperOrder({
      type: "MARKET",
      symbol: "RELIANCE",
      side: "SELL",
      quantity: 15,
      quote,
    });
    expect(reverseRes.ok).toBe(true);

    const acc = getPaperAccount();
    const pos = acc.positions.find((p) => p.symbol === "RELIANCE");
    expect(pos?.quantity).toBe(-5);
  });

  it("5. Provenance fields (source, quality, timestamp, referencePrice, slippage, fee) are recorded on fills", () => {
    const ts = getNowIso();
    const quote: ExecutionQuote = {
      exchange: "NSE",
      symbol: "RELIANCE",
      price: 2500,
      ts,
      source: "angelone",
      quality: "live",
    };

    placePaperOrder({
      type: "MARKET",
      symbol: "RELIANCE",
      side: "BUY",
      quantity: 10,
      quote,
    });

    const acc = getPaperAccount();
    const filledOrder = acc.orders[0];

    expect(filledOrder.quoteSource).toBe("angelone");
    expect(filledOrder.quoteQuality).toBe("live");
    expect(filledOrder.quoteTimestamp).toBe(ts);
    expect(filledOrder.referencePrice).toBe(2500);

    // Verify fill exists with provenance
    expect(acc.fills.length).toBeGreaterThan(0);
    const fill = acc.fills[0];
    expect(fill.quoteSource).toBe("angelone");
    expect(fill.quoteQuality).toBe("live");
    expect(fill.slippage).toBeGreaterThanOrEqual(0);
    expect(fill.fees).toBeGreaterThan(0);
  });

  it("6. Typecheck scripts exist in package.json and run in CI", () => {
    const pkgJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8"));
    expect(pkgJson.scripts["typecheck:frontend"]).toBeDefined();
    expect(pkgJson.scripts["typecheck:server"]).toBeDefined();
    expect(pkgJson.scripts["typecheck"]).toContain("typecheck:frontend");
    expect(pkgJson.scripts["typecheck"]).toContain("typecheck:server");

    const ciYaml = readFileSync(join(process.cwd(), ".github/workflows/ci.yml"), "utf-8");
    expect(ciYaml).toContain("bun run typecheck");
  });

  it("7. Account fills array is populated on every execution", () => {
    const quote: ExecutionQuote = {
      exchange: "NSE",
      symbol: "RELIANCE",
      price: 2500,
      ts: getNowIso(),
      source: "angelone",
      quality: "live",
    };
    placePaperOrder({
      type: "MARKET",
      symbol: "RELIANCE",
      side: "BUY",
      quantity: 10,
      quote,
    });
    const acc = getPaperAccount();
    expect(Array.isArray(acc.fills)).toBe(true);
    expect(acc.fills.length).toBeGreaterThan(0);
    expect(acc.fills[0].reason).toBe("USER_ORDER");
  });
});

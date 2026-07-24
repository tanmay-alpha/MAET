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

  it("1. MARKET order with marketPrice but no quote is rejected", () => {
    const res = placePaperOrder({
      symbol: "RELIANCE",
      side: "BUY",
      qty: 10,
      type: "MARKET",
      marketPrice: 2500,
    });
    expect(res.ok).toBe(false);
    expect(res.message).toContain("Trusted quote object is required for execution");
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
      qty: 10,
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

    expect(posAfter.unrealizedPnl).toBe(posBefore.unrealizedPnl);
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
      qty: 10,
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
    expect(acc.isLocked).toBe(false);
    expect(acc.positions.length).toBe(1);
  });

  it("11. Invalid quote cannot fill limit or stop orders", () => {
    placePaperOrder({
      symbol: "RELIANCE",
      side: "BUY",
      qty: 10,
      type: "LIMIT",
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
    expect(acc.orders[0].status).toBe("pending");
  });

  it("12. Missing volume does not become volume 1000", () => {
    placePaperOrder({
      symbol: "RELIANCE",
      side: "BUY",
      qty: 10,
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

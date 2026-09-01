import { describe, expect, it } from "bun:test";
import { evaluateExecutionQuote, type ExecutionQuote } from "@shared/types";
import { placePaperOrderInAccount } from "@shared/domain/paper-trading/execution";
import { readFileSync } from "fs";
import { join } from "path";

const emptyAccount = {
  id: "acc-1",
  userId: "user-1",
  version: 3,
  generation: 1,
  currency: "INR" as const,
  cash: 1000000,
  initialCash: 1000000,
  realisedPnl: 0,
  allocatedMargin: 0,
  maintenanceMargin: 0,
  status: "ACTIVE" as const,
  isLocked: false,
  positions: [],
  orders: [],
  fills: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("Phase 0.1: Financial Integrity Remediation Suite", () => {
  const getNowIso = () => new Date().toISOString();

  it("1. MARKET order without quote is rejected", () => {
    const res = placePaperOrderInAccount(emptyAccount, {
      type: "MARKET",
      symbol: "RELIANCE",
      side: "BUY",
      quantity: 10,
    });
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
    const res = evaluateExecutionQuote(invalidQuote as any, "RELIANCE");
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
    const res = evaluateExecutionQuote(invalidQuote as any, "RELIANCE");
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
    const futureTs = new Date(Date.now() + 20000).toISOString();
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

  it("7. Invalid quote cannot update unrealised P&L", () => {
    const invalidQuote: ExecutionQuote = {
      exchange: "NSE",
      symbol: "RELIANCE",
      price: 3000,
      volume: 500,
      ts: getNowIso(),
      source: "simulated",
      quality: "synthetic",
    };
    const evalRes = evaluateExecutionQuote(invalidQuote, "RELIANCE");
    expect(evalRes.executable).toBe(false);
  });

  it("8. Invalid quote cannot trigger margin liquidation", () => {
    const invalidQuote: ExecutionQuote = {
      exchange: "NSE",
      symbol: "RELIANCE",
      price: 1,
      ts: getNowIso(),
      source: "yahoo",
      quality: "delayed",
    };
    const evalRes = evaluateExecutionQuote(invalidQuote, "RELIANCE");
    expect(evalRes.executable).toBe(false);
  });

  it("9. Missing volume does not become volume 1000", () => {
    const quoteWithoutVolume = {
      exchange: "NSE",
      symbol: "RELIANCE",
      price: 2450,
      ts: getNowIso(),
      source: "angelone",
      quality: "live",
    };

    const evalResult = evaluateExecutionQuote(quoteWithoutVolume as any, "RELIANCE");
    expect(evalResult.executable).toBe(true);
    expect(quoteWithoutVolume.volume).toBeUndefined();
  });

  it("10. Legacy permissive RLS policy names are absent in migration 0010", () => {
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

  it("11. anon/authenticated have no market-table write privileges in migration 0010", () => {
    const migrationSql = readFileSync(
      join(process.cwd(), "server/db/migrations/0010_remove_legacy_permissive_policies.sql"),
      "utf-8"
    );
    expect(migrationSql).toContain("REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.companies FROM anon, authenticated");
    expect(migrationSql).toContain("REVOKE ALL ON public.ingestion_runs FROM anon, authenticated");
  });

  it("12. All workflows use the same pinned Bun version", () => {
    const ciYaml = readFileSync(join(process.cwd(), ".github/workflows/ci.yml"), "utf-8");
    const renderYaml = readFileSync(join(process.cwd(), ".github/workflows/deploy-render.yml"), "utf-8");

    expect(ciYaml).toContain('bun-version: "1.3.14"');
    expect(ciYaml).not.toContain("bun-version: latest");
    expect(renderYaml).toContain("bun-version: 1.3.14");
    expect(renderYaml).not.toContain("bun-version: latest");
  });

  it("13. All workflow dependency installs are frozen", () => {
    const ciYaml = readFileSync(join(process.cwd(), ".github/workflows/ci.yml"), "utf-8");
    const renderYaml = readFileSync(join(process.cwd(), ".github/workflows/deploy-render.yml"), "utf-8");

    expect(ciYaml).toContain("bun install --frozen-lockfile");
    expect(ciYaml).not.toMatch(/run: bun install\s*$/m);
    expect(renderYaml).toContain("bun install --frozen-lockfile");
  });

  it("14. All workflows use the Node 24 checkout action", () => {
    const ciYaml = readFileSync(join(process.cwd(), ".github/workflows/ci.yml"), "utf-8");
    const renderYaml = readFileSync(join(process.cwd(), ".github/workflows/deploy-render.yml"), "utf-8");

    expect(ciYaml).not.toContain("actions/checkout@v4");
    expect(ciYaml).toContain("actions/checkout@v6");
    expect(renderYaml).not.toContain("actions/checkout@v4");
    expect(renderYaml).toContain("actions/checkout@v6");
  });
});

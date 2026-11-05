import { describe, expect, it } from "bun:test";
import {
  compareMigrations,
  compareSchema,
  countLedgerMismatches,
  exitCodeFor,
  formatHuman,
  parseArgs,
  redactTarget,
  toScaledUnits,
} from "./verify-db-restore";

describe("compareMigrations", () => {
  const files = ["0001_a.sql", "0002_b.sql", "0003_c.sql"];

  it("passes when every file is applied in order", () => {
    const applied = files.map((name, i) => ({ name, appliedAt: new Date(2026, 0, i + 1) }));
    expect(compareMigrations(files, applied)).toEqual({ missing: [], unknown: [], outOfOrder: [] });
  });

  it("reports missing and unknown migrations", () => {
    const applied = [
      { name: "0001_a.sql", appliedAt: "2026-01-01T00:00:00Z" },
      { name: "0003_c.sql", appliedAt: "2026-01-02T00:00:00Z" },
      { name: "0099_rogue.sql", appliedAt: "2026-01-03T00:00:00Z" },
    ];
    const result = compareMigrations(files, applied);
    expect(result.missing).toEqual(["0002_b.sql"]);
    expect(result.unknown).toEqual(["0099_rogue.sql"]);
    expect(result.outOfOrder).toEqual([]);
  });

  it("flags a migration applied after a later-numbered one", () => {
    const applied = [
      { name: "0001_a.sql", appliedAt: "2026-01-01T00:00:00Z" },
      { name: "0003_c.sql", appliedAt: "2026-01-02T00:00:00Z" },
      { name: "0002_b.sql", appliedAt: "2026-01-03T00:00:00Z" },
    ];
    expect(compareMigrations(files, applied).outOfOrder).toEqual(["0002_b.sql"]);
  });

  it("breaks applied_at ties by name, so batch-applied migrations are in order", () => {
    const t = "2026-01-01T00:00:00Z";
    const applied = [...files].reverse().map((name) => ({ name, appliedAt: t }));
    expect(compareMigrations(files, applied).outOfOrder).toEqual([]);
  });
});

describe("compareSchema", () => {
  const expected = [
    { schema: "public", name: "paper_fills", columns: ["id", "order_id", "generation"] },
    { schema: "public", name: "companies", columns: ["id", "symbol"] },
  ];

  it("passes when all tables and columns exist (extra columns are fine)", () => {
    const actual = new Map([
      ["public.paper_fills", new Set(["id", "order_id", "generation", "extra"])],
      ["public.companies", new Set(["id", "symbol"])],
    ]);
    expect(compareSchema(expected, actual)).toEqual({ missingTables: [], missingColumns: [] });
  });

  it("reports missing tables and columns", () => {
    const actual = new Map([["public.paper_fills", new Set(["id"])]]);
    expect(compareSchema(expected, actual)).toEqual({
      missingTables: ["public.companies"],
      missingColumns: ["public.paper_fills.generation", "public.paper_fills.order_id"],
    });
  });
});

describe("ledger reconciliation", () => {
  it("parses numeric(18,4) strings exactly", () => {
    expect(toScaledUnits("1000000.0000")).toBe(10_000_000_000n);
    expect(toScaledUnits("-12.5")).toBe(-125_000n);
    expect(toScaledUnits("0.1")).toBe(1_000n);
    expect(toScaledUnits("7")).toBe(70_000n);
  });

  it("counts mismatches and accounts without a ledger separately", () => {
    const result = countLedgerMismatches([
      { cashBalance: "1000000.0000", ledgerSum: "1000000", ledgerEntries: 1 },
      { cashBalance: "999979.7600", ledgerSum: "999979.7500", ledgerEntries: 3 },
      { cashBalance: "1000000.0000", ledgerSum: null, ledgerEntries: 0 },
    ]);
    expect(result).toEqual({ mismatched: 1, withoutLedger: 1 });
  });
});

describe("redactTarget", () => {
  it("keeps only the registrable domain, never credentials or path", () => {
    const out = redactTarget("postgresql://postgres.abc:s3cret@aws-0-ap-south-1.pooler.supabase.com:6543/postgres");
    expect(out).toBe("*.supabase.com");
    expect(out).not.toContain("s3cret");
  });

  it("hides IP addresses and tolerates garbage", () => {
    expect(redactTarget("postgresql://u:p@10.1.2.3:5432/db")).toBe("<ip-address>");
    expect(redactTarget("not a url")).toBe("<unparseable-url>");
  });
});

describe("CLI helpers", () => {
  it("parses flags and rejects a literal URL for --url-env", () => {
    expect(parseArgs(["--json", "--url-env=PROD_DB", "--timeout-ms=5000"])).toEqual({
      json: true,
      urlEnv: "PROD_DB",
      timeoutMs: 5000,
    });
    expect(() => parseArgs(["--url-env=postgresql://u:p@h/db"])).toThrow();
    expect(() => parseArgs(["--bogus"])).toThrow();
  });

  it("maps check statuses to exit codes and formats a summary", () => {
    const checks = [
      { name: "a", status: "pass" as const, summary: "ok" },
      { name: "b", status: "warn" as const, summary: "meh" },
    ];
    expect(exitCodeFor(checks)).toBe(0);
    const failing = [...checks, { name: "c", status: "fail" as const, summary: "bad", details: { missing: ["x"] } }];
    expect(exitCodeFor(failing)).toBe(1);
    const text = formatHuman({ target: "*.supabase.com", serverVersion: "17.4", checks: failing, exitCode: 1 });
    expect(text).toContain("[FAIL] c: bad");
    expect(text).toContain("missing: x");
    expect(text).toContain("1 CHECK(S) FAILED");
  });
});

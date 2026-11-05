import { describe, expect, it } from "bun:test";
import {
  MAX_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  UsageError,
  compareMigrations,
  compareSchema,
  exitCodeFor,
  formatHuman,
  isLedgerMismatch,
  parseArgs,
  redactTarget,
  resolveUrlEnv,
  scrubError,
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

  it("accepts a never-reset account with no INITIAL_CASH entry (cash = initial_cash + fee/P&L entries)", () => {
    // Generation 1 after one buy: fee -20, realised P&L 0, no INITIAL_CASH row.
    expect(isLedgerMismatch({ cashBalance: "999980.0000", initialCash: "1000000.0000", ledgerSum: "-20.0000", ledgerEntries: 2 })).toBe(false);
    // Untouched account: no ledger at all.
    expect(isLedgerMismatch({ cashBalance: "1000000.0000", initialCash: "1000000.0000", ledgerSum: null, ledgerEntries: 0 })).toBe(false);
  });

  it("accepts a reset account (INITIAL_CASH excluded from the sum by the query)", () => {
    expect(isLedgerMismatch({ cashBalance: "500000.0000", initialCash: "500000.0000", ledgerSum: null, ledgerEntries: 0 })).toBe(false);
  });

  it("tolerates 0.0001 of rounding drift per ledger entry, no more", () => {
    // P&L 0.00003 and fee 1.00006 round to 0.0000 and -1.0001; cash moved -1.0000.
    const base = { initialCash: "100.0000", ledgerSum: "-1.0001", ledgerEntries: 2 };
    expect(isLedgerMismatch({ ...base, cashBalance: "99.0000" })).toBe(false);
    expect(isLedgerMismatch({ ...base, cashBalance: "98.9997" })).toBe(false); // diff 0.0002 = 2 entries
    expect(isLedgerMismatch({ ...base, cashBalance: "98.9996" })).toBe(true); // diff 0.0003
    expect(isLedgerMismatch({ cashBalance: "100.0001", initialCash: "100.0000", ledgerSum: null, ledgerEntries: 0 })).toBe(true);
  });

  it("flags a real cash/ledger divergence", () => {
    expect(isLedgerMismatch({ cashBalance: "500.0000", initialCash: "1000.0000", ledgerSum: null, ledgerEntries: 0 })).toBe(true);
  });
});

describe("redactTarget", () => {
  it("shows the Supabase project ref for direct and pooler URLs, never the password", () => {
    const direct = redactTarget("postgresql://postgres:s3cret@db.abcdefghijklmnop.supabase.co:5432/postgres");
    expect(direct).toBe("db.abcdefghijklmnop.supabase.co");
    const pooler = redactTarget("postgresql://postgres.abcdefghijklmnop:s3cret@aws-0-ap-south-1.pooler.supabase.com:6543/postgres");
    expect(pooler).toBe("postgres.abcdefghijklmnop@*.pooler.supabase.com");
    expect(direct + pooler).not.toContain("s3cret");
  });

  it("collapses other hosts to their domain plus database, hides IPs, tolerates garbage", () => {
    expect(redactTarget("postgresql://u:p@a.b.example.com:5432/maet")).toBe("*.example.com/maet");
    expect(redactTarget("postgresql://u:p@10.1.2.3:5432/db")).toBe("<ip-address>/db");
    expect(redactTarget("not a url")).toBe("<unparseable-url>");
  });

  it("scrubs password, user and host from error messages", () => {
    const url = "postgresql://postgres:s3cretpw@db.abcdefghijklmnop.supabase.co:5432/postgres";
    const err = Object.assign(new Error("connect to db.abcdefghijklmnop.supabase.co failed for s3cretpw"), { code: "57P01" });
    const out = scrubError(err, url);
    expect(out).toStartWith("57P01: ");
    expect(out).not.toContain("s3cretpw");
    expect(out).not.toContain("abcdefghijklmnop");
  });
});

describe("CLI helpers", () => {
  it("parses flags and rejects a literal URL for --url-env", () => {
    expect(parseArgs(["--json", "--url-env=PROD_DB", "--timeout-ms=5000"])).toEqual({
      json: true,
      urlEnv: "PROD_DB",
      timeoutMs: 5000,
    });
    expect(() => parseArgs(["--url-env=postgresql://u:p@h/db"])).toThrow(UsageError);
  });

  it("never echoes argument values in usage errors", () => {
    for (const arg of ["--url=postgresql://postgres:SECRETPW@h/db", "postgresql://postgres:SECRETPW@h/db", "--url-env=postgresql://postgres:SECRETPW@h"]) {
      let message = "";
      try {
        parseArgs([arg]);
      } catch (err) {
        expect(err).toBeInstanceOf(UsageError);
        message = err instanceof Error ? err.message : String(err);
      }
      expect(message).not.toBe("");
      expect(message).not.toContain("SECRETPW");
    }
    expect(() => parseArgs(["--url=x"])).toThrow("Unknown argument: --url.");
  });

  it("clamps --timeout-ms and rejects non-numbers", () => {
    expect(parseArgs(["--timeout-ms=1"]).timeoutMs).toBe(MIN_TIMEOUT_MS);
    expect(parseArgs(["--timeout-ms=1e30"]).timeoutMs).toBe(MAX_TIMEOUT_MS);
    expect(() => parseArgs(["--timeout-ms=soon"])).toThrow(UsageError);
  });

  it("requires --url-env when both SUPABASE_DB_URL and DATABASE_URL are set", () => {
    expect(() => resolveUrlEnv({ SUPABASE_DB_URL: "a", DATABASE_URL: "b" }, null)).toThrow(UsageError);
    expect(resolveUrlEnv({ SUPABASE_DB_URL: "a", DATABASE_URL: "b" }, "DATABASE_URL")).toBe("DATABASE_URL");
    expect(resolveUrlEnv({ SUPABASE_DB_URL: "a" }, null)).toBe("SUPABASE_DB_URL");
    expect(resolveUrlEnv({ DATABASE_URL: "b" }, null)).toBe("DATABASE_URL");
    expect(() => resolveUrlEnv({}, null)).toThrow(UsageError);
    expect(() => resolveUrlEnv({ DATABASE_URL: "b" }, "RESTORED_DB_URL")).toThrow(UsageError);
  });

  it("maps check statuses to exit codes and formats a summary", () => {
    const checks = [
      { name: "a", status: "pass" as const, summary: "ok" },
      { name: "b", status: "warn" as const, summary: "meh" },
    ];
    expect(exitCodeFor(checks)).toBe(0);
    const failing = [...checks, { name: "c", status: "fail" as const, summary: "bad", details: { missing: ["x"] } }];
    expect(exitCodeFor(failing)).toBe(1);
    const text = formatHuman({ target: "db.abc.supabase.co", serverVersion: "17.4", checks: failing, exitCode: 1 });
    expect(text).toContain("[FAIL] c: bad");
    expect(text).toContain("missing: x");
    expect(text).toContain("1 CHECK(S) FAILED");
  });
});

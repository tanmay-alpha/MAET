/**
 * Read-only database restore verifier.
 *
 * Run after restoring the production Supabase project to confirm the schema,
 * migration history and paper-trading invariants are intact. Every query runs
 * inside a `READ ONLY` transaction with a statement timeout; nothing is written.
 *
 * Usage:
 *   bun run verify:db [--json] [--url-env=VAR_NAME] [--timeout-ms=15000]
 *
 * The connection string comes from SUPABASE_DB_URL, then DATABASE_URL, or the
 * env var named by --url-env. The URL itself is never printed.
 *
 * Exit codes: 0 = all checks pass, 1 = one or more failures, 2 = cannot connect.
 */
import * as schemaModule from "../db/schema";
import { readdirSync } from "fs";
import { join } from "path";
import { is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import postgres from "postgres";

export type CheckStatus = "pass" | "warn" | "fail";

export interface CheckResult {
  name: string;
  status: CheckStatus;
  summary: string;
  details?: Record<string, unknown>;
}

export interface VerifyReport {
  target: string;
  serverVersion: string | null;
  checks: CheckResult[];
  exitCode: 0 | 1 | 2;
}

export const KEY_TABLES = [
  "companies",
  "candles",
  "price_daily",
  "fundamentals",
  "financial_statements",
  "paper_accounts",
  "paper_orders",
  "paper_fills",
  "paper_positions",
  "paper_ledger_entries",
] as const;

/**
 * price_daily is created by the ingestion engine's own schema
 * (server/workers/ingestion-engine/storage/supabase-schema), not by
 * server/db/migrations, so its absence is a warning rather than a failure.
 */
const OPTIONAL_KEY_TABLES: Record<string, true> = { price_daily: true };

// ---------------------------------------------------------------------------
// Pure comparison logic (unit-tested)
// ---------------------------------------------------------------------------

export interface AppliedMigration {
  name: string;
  appliedAt: Date | string | null;
}

export interface MigrationComparison {
  missing: string[];
  unknown: string[];
  outOfOrder: string[];
}

/**
 * missing    = migration files never recorded as applied.
 * unknown    = applied rows with no matching file.
 * outOfOrder = known migrations applied (by applied_at, ties broken by name)
 *              after a migration whose filename sorts later.
 */
export function compareMigrations(files: readonly string[], applied: readonly AppliedMigration[]): MigrationComparison {
  const fileSet = new Set(files);
  const appliedSet = new Set(applied.map((a) => a.name));
  const missing = [...fileSet].filter((f) => !appliedSet.has(f)).sort();
  const unknown = [...appliedSet].filter((a) => !fileSet.has(a)).sort();

  const chronological = applied
    .filter((a) => fileSet.has(a.name))
    .map((a) => ({ name: a.name, t: a.appliedAt == null ? Number.NEGATIVE_INFINITY : new Date(a.appliedAt).getTime() }))
    .sort((x, y) => x.t - y.t || x.name.localeCompare(y.name));

  const outOfOrder: string[] = [];
  let maxName = "";
  for (const { name } of chronological) {
    if (name < maxName) outOfOrder.push(name);
    else maxName = name;
  }
  // A missing file that sorts before an applied one is also an ordering gap,
  // but it is already reported under `missing`.
  return { missing, unknown, outOfOrder: outOfOrder.sort() };
}

export interface ExpectedTable {
  schema: string;
  name: string;
  columns: string[];
}

export interface SchemaComparison {
  missingTables: string[];
  missingColumns: string[];
}

/** `actual` maps "schema.table" → set of column names present in the database. */
export function compareSchema(expected: readonly ExpectedTable[], actual: ReadonlyMap<string, ReadonlySet<string>>): SchemaComparison {
  const missingTables: string[] = [];
  const missingColumns: string[] = [];
  for (const table of expected) {
    const key = `${table.schema}.${table.name}`;
    const cols = actual.get(key);
    if (!cols) {
      missingTables.push(key);
      continue;
    }
    for (const col of table.columns) {
      if (!cols.has(col)) missingColumns.push(`${key}.${col}`);
    }
  }
  return { missingTables: missingTables.sort(), missingColumns: missingColumns.sort() };
}

export interface LedgerBalanceRow {
  cashBalance: string;
  ledgerSum: string | null;
  ledgerEntries: number;
}

/** Exact decimal comparison at numeric(18,4) scale, avoiding float rounding. */
export function toScaledUnits(value: string): bigint {
  const trimmed = value.trim();
  const negative = trimmed.startsWith("-");
  const unsigned = negative || trimmed.startsWith("+") ? trimmed.slice(1) : trimmed;
  const [whole = "0", frac = ""] = unsigned.split(".");
  const units = BigInt(whole || "0") * 10_000n + BigInt((frac + "0000").slice(0, 4));
  return negative ? -units : units;
}

export function countLedgerMismatches(rows: readonly LedgerBalanceRow[]): { mismatched: number; withoutLedger: number } {
  let mismatched = 0;
  let withoutLedger = 0;
  for (const row of rows) {
    if (row.ledgerEntries === 0 || row.ledgerSum == null) {
      withoutLedger++;
      continue;
    }
    if (toScaledUnits(row.cashBalance) !== toScaledUnits(row.ledgerSum)) mismatched++;
  }
  return { mismatched, withoutLedger };
}

/** Keep only the host's registrable domain (e.g. "*.supabase.com"). */
export function redactTarget(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    if (/^[\d.]+$/.test(host) || host === "localhost" || host.includes(":")) return host === "localhost" ? "localhost" : "<ip-address>";
    const parts = host.split(".");
    return parts.length <= 2 ? host : `*.${parts.slice(-2).join(".")}`;
  } catch {
    return "<unparseable-url>";
  }
}

export function exitCodeFor(checks: readonly CheckResult[]): 0 | 1 {
  return checks.some((c) => c.status === "fail") ? 1 : 0;
}

export function formatHuman(report: VerifyReport): string {
  const icon: Record<CheckStatus, string> = { pass: "PASS", warn: "WARN", fail: "FAIL" };
  const lines = [`Database restore verification — target ${report.target}`];
  if (report.serverVersion) lines.push(`Server: ${report.serverVersion}`);
  for (const c of report.checks) {
    lines.push(`[${icon[c.status]}] ${c.name}: ${c.summary}`);
    if (c.status !== "pass" && c.details) {
      for (const [k, v] of Object.entries(c.details)) {
        if (Array.isArray(v) && v.length === 0) continue;
        const text = Array.isArray(v) ? v.join(", ") : v !== null && typeof v === "object" ? JSON.stringify(v) : String(v);
        lines.push(`       ${k}: ${text}`);
      }
    }
  }
  const failed = report.checks.filter((c) => c.status === "fail").length;
  lines.push(
    report.exitCode === 2 ? "Result: CANNOT CONNECT" : failed === 0 ? "Result: ALL CHECKS PASSED" : `Result: ${failed} CHECK(S) FAILED`,
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Database checks
// ---------------------------------------------------------------------------

export function listMigrationFiles(dir = join(import.meta.dir, "../db/migrations")): string[] {
  return readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
}

export function loadExpectedTables(): ExpectedTable[] {
  const tables: ExpectedTable[] = [];
  const seen = new Set<string>();
  for (const value of Object.values(schemaModule)) {
    if (!is(value, PgTable)) continue;
    const config = getTableConfig(value);
    const key = `${config.schema ?? "public"}.${config.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tables.push({ schema: config.schema ?? "public", name: config.name, columns: config.columns.map((c) => c.name) });
  }
  return tables.sort((a, b) => `${a.schema}.${a.name}`.localeCompare(`${b.schema}.${b.name}`));
}

type Tx = postgres.TransactionSql;

async function tableExists(tx: Tx, name: string): Promise<boolean> {
  const [row] = await tx<{ ok: boolean }[]>`SELECT to_regclass(${`public.${name}`}) IS NOT NULL AS ok`;
  return Boolean(row?.ok);
}

async function checkMigrations(tx: Tx, files: string[]): Promise<CheckResult> {
  const name = "migrations";
  if (!(await tableExists(tx, "_applied_migrations"))) {
    return { name, status: "fail", summary: "public._applied_migrations table is missing" };
  }
  const rows = await tx<{ name: string; applied_at: Date | null }[]>`
    SELECT name, applied_at FROM public._applied_migrations
  `;
  const cmp = compareMigrations(
    files,
    rows.map((r) => ({ name: r.name, appliedAt: r.applied_at })),
  );
  const status: CheckStatus = cmp.missing.length || cmp.unknown.length ? "fail" : cmp.outOfOrder.length ? "warn" : "pass";
  return {
    name,
    status,
    summary: `${rows.length} applied / ${files.length} files; missing ${cmp.missing.length}, unknown ${cmp.unknown.length}, out-of-order ${cmp.outOfOrder.length}`,
    details: { ...cmp },
  };
}

async function checkSchema(tx: Tx, expected: ExpectedTable[]): Promise<CheckResult> {
  const schemas = [...new Set(expected.map((t) => t.schema))];
  const rows = await tx<{ table_schema: string; table_name: string; column_name: string }[]>`
    SELECT table_schema, table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = ANY(${schemas})
  `;
  const actual = new Map<string, Set<string>>();
  for (const r of rows) {
    const key = `${r.table_schema}.${r.table_name}`;
    let set = actual.get(key);
    if (!set) actual.set(key, (set = new Set()));
    set.add(r.column_name);
  }
  const cmp = compareSchema(expected, actual);
  const failed = cmp.missingTables.length + cmp.missingColumns.length > 0;
  return {
    name: "schema",
    status: failed ? "fail" : "pass",
    summary: `${expected.length} Drizzle tables checked; missing tables ${cmp.missingTables.length}, missing columns ${cmp.missingColumns.length}`,
    details: { ...cmp },
  };
}

async function checkRowCounts(tx: Tx): Promise<CheckResult> {
  const counts: Record<string, number | null> = {};
  const missing: string[] = [];
  for (const table of KEY_TABLES) {
    if (!(await tableExists(tx, table))) {
      counts[table] = null;
      missing.push(table);
      continue;
    }
    const [row] = await tx<{ n: string }[]>`SELECT count(*)::text AS n FROM ${tx("public")}.${tx(table)}`;
    counts[table] = Number(row?.n ?? 0);
  }
  const missingRequired = missing.filter((t) => !OPTIONAL_KEY_TABLES[t]);
  return {
    name: "row-counts",
    status: missingRequired.length ? "fail" : missing.length ? "warn" : "pass",
    summary: KEY_TABLES.map((t) => `${t}=${counts[t] ?? "MISSING"}`).join(" "),
    details: { counts, missing, missingRequired },
  };
}

async function checkPaperInvariants(tx: Tx): Promise<CheckResult> {
  const required = ["paper_accounts", "paper_orders", "paper_fills", "paper_positions", "paper_ledger_entries"];
  const absent: string[] = [];
  for (const t of required) if (!(await tableExists(tx, t))) absent.push(t);
  if (absent.length) {
    return { name: "paper-invariants", status: "fail", summary: `cannot evaluate; missing tables: ${absent.join(", ")}` };
  }

  const [orphan] = await tx<{ n: string }[]>`
    SELECT count(*)::text AS n FROM public.paper_fills f
    WHERE NOT EXISTS (SELECT 1 FROM public.paper_orders o WHERE o.id = f.order_id)
  `;
  const [badPositions] = await tx<{ n: string }[]>`
    SELECT count(*)::text AS n FROM public.paper_positions WHERE total_shares <= 0
  `;
  // Cash = initial cash + realised PnL − fees, all of which are ledgered for
  // the account's current generation. Only aggregate counts leave this query.
  const balances = await tx<{ cash_balance: string; ledger_sum: string | null; ledger_entries: number }[]>`
    SELECT a.cash_balance::text AS cash_balance,
           l.ledger_sum::text AS ledger_sum,
           COALESCE(l.ledger_entries, 0)::int AS ledger_entries
    FROM public.paper_accounts a
    LEFT JOIN (
      SELECT user_id, generation, sum(amount) AS ledger_sum, count(*) AS ledger_entries
      FROM public.paper_ledger_entries
      GROUP BY user_id, generation
    ) l ON l.user_id = a.user_id AND l.generation = a.generation
  `;
  const ledger = countLedgerMismatches(
    balances.map((b) => ({ cashBalance: b.cash_balance, ledgerSum: b.ledger_sum, ledgerEntries: b.ledger_entries })),
  );
  const orphanFills = Number(orphan?.n ?? 0);
  const nonPositivePositions = Number(badPositions?.n ?? 0);
  const failed = orphanFills > 0 || nonPositivePositions > 0 || ledger.mismatched > 0;
  return {
    name: "paper-invariants",
    status: failed ? "fail" : ledger.withoutLedger > 0 ? "warn" : "pass",
    summary: `orphan fills ${orphanFills}, ledger/cash mismatches ${ledger.mismatched} of ${balances.length} accounts (${ledger.withoutLedger} without ledger), positions with total_shares<=0 ${nonPositivePositions}`,
    details: {
      orphanFills,
      ledgerCashMismatches: ledger.mismatched,
      accountsWithoutLedger: ledger.withoutLedger,
      accountsChecked: balances.length,
      nonPositivePositions,
    },
  };
}

async function checkRls(tx: Tx): Promise<CheckResult> {
  const rows = await tx<{ relname: string; relrowsecurity: boolean }[]>`
    SELECT c.relname, c.relrowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname LIKE 'paper\\_%'
    ORDER BY c.relname
  `;
  const disabled = rows.filter((r) => !r.relrowsecurity).map((r) => r.relname);
  return {
    name: "rls",
    status: rows.length === 0 || disabled.length ? "fail" : "pass",
    summary: rows.length === 0 ? "no paper_* tables found" : `${rows.length - disabled.length}/${rows.length} paper_* tables have RLS enabled`,
    details: { disabled },
  };
}

export interface VerifyOptions {
  url: string;
  timeoutMs?: number;
  migrationFiles?: string[];
}

const ROLLBACK = Symbol("rollback");

export async function verifyDatabase({ url, timeoutMs = 15_000, migrationFiles }: VerifyOptions): Promise<VerifyReport> {
  const target = redactTarget(url);
  const sql = postgres(url, {
    max: 1,
    prepare: false, // compatible with Supabase's transaction pooler
    connect_timeout: Math.ceil(timeoutMs / 1000),
    idle_timeout: 5,
    onnotice: () => {},
  });
  try {
    let serverVersion: string;
    try {
      const [row] = await sql<{ v: string }[]>`SELECT current_setting('server_version') AS v`;
      serverVersion = row?.v ?? "unknown";
    } catch (err) {
      const reason = err && typeof err === "object" && "code" in err ? String(err.code) : err instanceof Error ? err.name : "error";
      return {
        target,
        serverVersion: null,
        checks: [{ name: "connectivity", status: "fail", summary: `cannot connect (${reason})` }],
        exitCode: 2,
      };
    }

    const files = migrationFiles ?? listMigrationFiles();
    const expected = loadExpectedTables();
    const checks: CheckResult[] = [{ name: "connectivity", status: "pass", summary: `connected, PostgreSQL ${serverVersion}` }];

    await sql.begin(async (tx) => {
      await tx`SET TRANSACTION READ ONLY`;
      await tx.unsafe(`SET LOCAL statement_timeout = ${Math.max(1, Math.floor(timeoutMs))}`);
      checks.push(await checkMigrations(tx, files));
      checks.push(await checkSchema(tx, expected));
      checks.push(await checkRowCounts(tx));
      checks.push(await checkPaperInvariants(tx));
      checks.push(await checkRls(tx));
      // Never commit anything, even though READ ONLY already forbids writes.
      throw ROLLBACK;
    }).catch((err) => {
      if (err === ROLLBACK) return;
      const message = err instanceof Error ? err.message : String(err);
      checks.push({ name: "query-error", status: "fail", summary: message.replaceAll(url, "<redacted>") });
    });

    return { target, serverVersion, checks, exitCode: exitCodeFor(checks) };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function parseArgs(argv: readonly string[]): { json: boolean; urlEnv: string | null; timeoutMs: number } {
  let json = false;
  let urlEnv: string | null = null;
  let timeoutMs = 15_000;
  for (const arg of argv) {
    if (arg === "--json") json = true;
    else if (arg.startsWith("--url-env=")) urlEnv = arg.slice("--url-env=".length);
    else if (arg.startsWith("--timeout-ms=")) timeoutMs = Number(arg.slice("--timeout-ms=".length));
    else throw new Error(`Unknown argument: ${arg}. Usage: verify-db-restore [--json] [--url-env=VAR] [--timeout-ms=N]`);
  }
  if (urlEnv !== null && !/^[A-Z_][A-Z0-9_]*$/i.test(urlEnv)) throw new Error("--url-env must be an environment variable name, not a URL");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("--timeout-ms must be a positive number");
  return { json, urlEnv, timeoutMs };
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const envName = args.urlEnv ?? (process.env.SUPABASE_DB_URL ? "SUPABASE_DB_URL" : "DATABASE_URL");
  const url = process.env[envName];
  if (!url) {
    console.error(`No connection string: ${envName} is not set.`);
    return 2;
  }
  const report = await verifyDatabase({ url, timeoutMs: args.timeoutMs });
  console.log(args.json ? JSON.stringify({ ...report, urlSource: envName }, null, 2) : `${formatHuman(report)}\n(url from ${envName})`);
  return report.exitCode;
}

if (import.meta.main) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 2;
    });
}

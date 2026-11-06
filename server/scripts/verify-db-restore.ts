/**
 * Read-only database restore verifier.
 *
 * Run after restoring the production Supabase project to confirm the schema,
 * migration history and paper-trading invariants are intact. The session is
 * opened with default_transaction_read_only=on, every check runs inside a
 * `READ ONLY` transaction (one savepoint per check) with a statement timeout,
 * and the transaction is always rolled back; nothing is written.
 *
 * Usage:
 *   bun run verify:db [--json] [--url-env=VAR_NAME] [--timeout-ms=15000]
 *
 * The connection string comes from the env var named by --url-env, otherwise
 * from whichever of SUPABASE_DB_URL / DATABASE_URL is set (if both are set,
 * --url-env is required). `.env` is not loaded. The URL and password are never
 * printed; the target is shown as e.g. `db.<ref>.supabase.co`.
 * --timeout-ms is clamped to 100..600000.
 *
 * Exit codes: 0 = all checks pass (warnings allowed), 1 = one or more failures,
 * 2 = cannot connect, 3 = usage/configuration error.
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

/**
 * One paper account's current generation. `ledgerSum`/`ledgerEntries` cover
 * only non-INITIAL_CASH entries: INITIAL_CASH is written on reset only, while
 * never-reset accounts start from `initial_cash` with no ledger entry.
 */
export interface LedgerBalanceRow {
  cashBalance: string;
  initialCash: string;
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

/**
 * cash_balance must equal initial_cash + Σ ledger amounts (excluding
 * INITIAL_CASH). Each ledger entry is rounded to numeric(18,4) on its own while
 * cash is rounded once, so allow 0.0001 (one scaled unit) of drift per entry.
 */
export function isLedgerMismatch(row: LedgerBalanceRow): boolean {
  const expected = toScaledUnits(row.initialCash) + (row.ledgerSum == null ? 0n : toScaledUnits(row.ledgerSum));
  const diff = toScaledUnits(row.cashBalance) - expected;
  const tolerance = BigInt(Math.max(0, row.ledgerEntries));
  return (diff < 0n ? -diff : diff) > tolerance;
}

/**
 * Identify the target without leaking credentials. Supabase project refs are
 * not secret and are shown so a restored project can't be confused with
 * another one: `db.<ref>.supabase.co`, `postgres.<ref>@*.pooler.supabase.com`.
 * Other hosts collapse to their registrable domain (IPs to `<ip-address>`)
 * plus the database name.
 */
export function redactTarget(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "<unparseable-url>";
  }
  const host = parsed.hostname.toLowerCase();
  if (/^db\.[a-z0-9]+\.supabase\.co$/.test(host)) return host;
  if (host.endsWith(".pooler.supabase.com")) {
    const user = decodeURIComponent(parsed.username);
    const ref = /^[a-z_]+\.([a-z0-9]+)$/i.exec(user)?.[1];
    return `${ref ? `postgres.${ref}@` : ""}*.pooler.supabase.com`;
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, "")) || "<default-db>";
  let shownHost: string;
  if (host === "localhost") shownHost = "localhost";
  else if (/^[\d.]+$/.test(host) || host.startsWith("[")) shownHost = "<ip-address>";
  else {
    const parts = host.split(".");
    shownHost = parts.length <= 2 ? host : `*.${parts.slice(-2).join(".")}`;
  }
  return `${shownHost}/${database}`;
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

/** Tables above this estimated size get a reltuples estimate instead of count(*). */
const EXACT_COUNT_LIMIT = 1_000_000;

async function tableExists(tx: Tx, name: string): Promise<boolean> {
  const [row] = await tx<{ ok: boolean }[]>`SELECT to_regclass(${`public.${name}`}) IS NOT NULL AS ok`;
  return Boolean(row?.ok);
}

async function checkMigrations(tx: Tx, files: string[]): Promise<CheckResult> {
  const name = "migrations";
  if (!(await tableExists(tx, "_applied_migrations"))) {
    return {
      name,
      status: "warn",
      summary:
        "public._applied_migrations not found; it is only written by server/scripts/apply-migrations.ts. " +
        "If this database was migrated another way (Supabase SQL editor/CLI), rely on the schema check and " +
        "confirm the migration history manually.",
    };
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

interface TableCount {
  rows: number | null;
  estimated: boolean;
}

async function countTable(tx: Tx, table: string): Promise<TableCount> {
  // pg_partition_tree also returns plain tables, and sums partitions of
  // partitioned parents (whose own reltuples is -1/0).
  const [est] = await tx<{ n: string }[]>`
    SELECT COALESCE(sum(GREATEST(c.reltuples, 0)), 0)::bigint::text AS n
    FROM pg_partition_tree(${`public.${table}`}::regclass) pt
    JOIN pg_class c ON c.oid = pt.relid
  `;
  const estimate = Number(est?.n ?? 0);
  if (estimate >= EXACT_COUNT_LIMIT) return { rows: estimate, estimated: true };
  try {
    // Own savepoint: a statement timeout here must not abort the remaining counts.
    const [row] = await tx.savepoint((sp) => sp<{ n: string }[]>`SELECT count(*)::text AS n FROM ${sp("public")}.${sp(table)}`);
    return { rows: Number(row?.n ?? 0), estimated: false };
  } catch {
    return { rows: estimate, estimated: true };
  }
}

async function checkRowCounts(tx: Tx): Promise<CheckResult> {
  const counts: Record<string, number | null> = {};
  const estimated: string[] = [];
  const missing: string[] = [];
  for (const table of KEY_TABLES) {
    if (!(await tableExists(tx, table))) {
      counts[table] = null;
      missing.push(table);
      continue;
    }
    const result = await countTable(tx, table);
    counts[table] = result.rows;
    if (result.estimated) estimated.push(table);
  }
  const missingRequired = missing.filter((t) => !OPTIONAL_KEY_TABLES[t]);
  const label = (t: string) => (counts[t] == null ? "MISSING" : estimated.includes(t) ? `~${counts[t]}` : String(counts[t]));
  return {
    name: "row-counts",
    status: missingRequired.length ? "fail" : missing.length ? "warn" : "pass",
    summary: KEY_TABLES.map((t) => `${t}=${label(t)}`).join(" ") + (estimated.length ? " (~ = pg_class.reltuples estimate)" : ""),
    details: { counts, estimated, missing, missingRequired },
  };
}

async function checkPaperInvariants(tx: Tx): Promise<CheckResult> {
  const required = ["paper_accounts", "paper_orders", "paper_fills", "paper_positions", "paper_ledger_entries"];
  const absent: string[] = [];
  for (const t of required) if (!(await tableExists(tx, t))) absent.push(t);
  if (absent.length) {
    return { name: "paper-invariants", status: "fail", summary: `cannot evaluate; missing tables: ${absent.join(", ")}` };
  }

  // order_id is NOT NULL with an FK, so orphan fills can't exist; a fill whose
  // order belongs to another user or generation can.
  const [crossFills] = await tx<{ n: string }[]>`
    SELECT count(*)::text AS n
    FROM public.paper_fills f
    JOIN public.paper_orders o ON o.id = f.order_id
    WHERE o.user_id <> f.user_id OR o.generation <> f.generation
  `;
  const [badPositions] = await tx<{ n: string }[]>`
    SELECT count(*)::text AS n FROM public.paper_positions WHERE total_shares <= 0
  `;
  // Only balances and counts leave this query — never user ids.
  const balances = await tx<
    { cash_balance: string; initial_cash: string; ledger_sum: string | null; ledger_entries: number; liquidated: boolean }[]
  >`
    SELECT a.cash_balance::text AS cash_balance,
           a.initial_cash::text AS initial_cash,
           l.ledger_sum::text AS ledger_sum,
           COALESCE(l.ledger_entries, 0)::int AS ledger_entries,
           (a.liquidation_completed_at IS NOT NULL) AS liquidated
    FROM public.paper_accounts a
    LEFT JOIN (
      SELECT user_id, generation, sum(amount) AS ledger_sum, count(*) AS ledger_entries
      FROM public.paper_ledger_entries
      WHERE entry_type <> 'INITIAL_CASH'
      GROUP BY user_id, generation
    ) l ON l.user_id = a.user_id AND l.generation = a.generation
  `;
  const rows = balances.map((b) => ({
    row: { cashBalance: b.cash_balance, initialCash: b.initial_cash, ledgerSum: b.ledger_sum, ledgerEntries: b.ledger_entries },
    liquidated: b.liquidated,
  }));
  const mismatched = rows.filter((r) => isLedgerMismatch(r.row));
  const mismatchedLiquidated = mismatched.filter((r) => r.liquidated).length;
  const crossOwnerFills = Number(crossFills?.n ?? 0);
  const nonPositivePositions = Number(badPositions?.n ?? 0);
  const failed = crossOwnerFills > 0 || nonPositivePositions > 0 || mismatched.length > 0;
  return {
    name: "paper-invariants",
    status: failed ? "fail" : "pass",
    summary:
      `fills on another user's/generation's order ${crossOwnerFills}, ` +
      `ledger/cash mismatches ${mismatched.length} of ${balances.length} accounts` +
      (mismatchedLiquidated ? ` (${mismatchedLiquidated} liquidated: liquidation P&L is not ledgered)` : "") +
      `, positions with total_shares<=0 ${nonPositivePositions}`,
    details: {
      crossOwnerFills,
      ledgerCashMismatches: mismatched.length,
      ledgerCashMismatchesLiquidated: mismatchedLiquidated,
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

/** Error text with every part of the connection string scrubbed. */
export function scrubError(err: unknown, url: string): string {
  const code = err && typeof err === "object" && "code" in err ? String(err.code) : null;
  let message = err instanceof Error ? err.message : String(err);
  const secrets: string[] = [url];
  try {
    const parsed = new URL(url);
    secrets.push(parsed.password, decodeURIComponent(parsed.password), parsed.hostname, parsed.username);
  } catch {
    // Unparseable URL: only the whole string can be scrubbed.
  }
  for (const secret of secrets) if (secret.length >= 3) message = message.replaceAll(secret, "<redacted>");
  return code ? `${code}: ${message}` : message;
}

export interface VerifyOptions {
  url: string;
  timeoutMs?: number;
  migrationFiles?: string[];
}

const ROLLBACK = Symbol("rollback");

export async function verifyDatabase({ url, timeoutMs = DEFAULT_TIMEOUT_MS, migrationFiles }: VerifyOptions): Promise<VerifyReport> {
  const target = redactTarget(url);
  const sql = postgres(url, {
    max: 1,
    prepare: false, // compatible with Supabase's transaction pooler
    connect_timeout: Math.ceil(Math.min(timeoutMs, 30_000) / 1000),
    idle_timeout: 5,
    // Startup parameter: every statement in the session, including the
    // version probe below, runs read-only.
    connection: { default_transaction_read_only: true },
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
    const steps: [string, (tx: Tx) => Promise<CheckResult>][] = [
      ["migrations", (tx) => checkMigrations(tx, files)],
      ["schema", (tx) => checkSchema(tx, expected)],
      ["row-counts", checkRowCounts],
      ["paper-invariants", checkPaperInvariants],
      ["rls", checkRls],
    ];

    await sql
      .begin(async (tx) => {
        await tx`SET TRANSACTION READ ONLY`;
        await tx.unsafe(`SET LOCAL statement_timeout = ${timeoutMs}`);
        for (const [name, run] of steps) {
          // One savepoint per check: an error or timeout fails that check only.
          try {
            checks.push(await tx.savepoint((sp) => run(sp)));
          } catch (err) {
            checks.push({ name, status: "fail", summary: `query failed (${scrubError(err, url)})` });
          }
        }
        // Never commit anything, even though READ ONLY already forbids writes.
        throw ROLLBACK;
      })
      .catch((err) => {
        if (err === ROLLBACK) return;
        checks.push({ name: "transaction", status: "fail", summary: scrubError(err, url) });
      });

    return { target, serverVersion, checks, exitCode: exitCodeFor(checks) };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export const DEFAULT_TIMEOUT_MS = 15_000;
export const MIN_TIMEOUT_MS = 100;
export const MAX_TIMEOUT_MS = 600_000;
export const USAGE = "Usage: verify-db-restore [--json] [--url-env=VAR_NAME] [--timeout-ms=N]";

/** Bad invocation; exits 3. Messages never contain argument values. */
export class UsageError extends Error {}

export function parseArgs(argv: readonly string[]): { json: boolean; urlEnv: string | null; timeoutMs: number } {
  let json = false;
  let urlEnv: string | null = null;
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  for (const arg of argv) {
    if (arg === "--json") json = true;
    else if (arg.startsWith("--url-env=")) urlEnv = arg.slice("--url-env=".length);
    else if (arg.startsWith("--timeout-ms=")) {
      const value = Number(arg.slice("--timeout-ms=".length));
      if (!Number.isFinite(value)) throw new UsageError(`--timeout-ms must be a number of milliseconds. ${USAGE}`);
      timeoutMs = Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.floor(value)));
    } else {
      // Echo only a recognisable flag name; values may be connection strings.
      const flag = /^--[a-z][a-z0-9-]*/i.exec(arg)?.[0] ?? "<positional argument>";
      throw new UsageError(`Unknown argument: ${flag}. ${USAGE}`);
    }
  }
  if (urlEnv !== null && !/^[A-Z_][A-Z0-9_]*$/i.test(urlEnv)) {
    throw new UsageError("--url-env must be an environment variable name, not a URL");
  }
  return { json, urlEnv, timeoutMs };
}

/**
 * Pick the env var holding the connection string. When both defaults are set
 * the operator must choose, so a restore is never checked against the wrong
 * database by accident.
 */
export function resolveUrlEnv(env: Readonly<Record<string, string | undefined>>, urlEnv: string | null): string {
  if (urlEnv !== null) {
    if (!env[urlEnv]) throw new UsageError(`${urlEnv} is not set`);
    return urlEnv;
  }
  const supabase = Boolean(env.SUPABASE_DB_URL);
  const database = Boolean(env.DATABASE_URL);
  if (supabase && database) {
    throw new UsageError("Both SUPABASE_DB_URL and DATABASE_URL are set; pass --url-env=SUPABASE_DB_URL or --url-env=DATABASE_URL");
  }
  if (supabase) return "SUPABASE_DB_URL";
  if (database) return "DATABASE_URL";
  throw new UsageError(`No connection string: set SUPABASE_DB_URL or DATABASE_URL, or pass --url-env. ${USAGE}`);
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const envName = resolveUrlEnv(process.env, args.urlEnv);
  const url = process.env[envName] ?? "";
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
      if (err instanceof UsageError) {
        console.error(err.message);
        process.exitCode = 3;
        return;
      }
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 2;
    });
}

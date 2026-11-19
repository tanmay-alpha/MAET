/**
 * Synthetic demo seed against PostgreSQL. Skipped without TEST_DATABASE_URL.
 *
 * In-process: seeds the shared test database (which holds other suites' users, hence
 * allowExistingData) and checks the rows, labels and ledger. CLI: `bun run seed:demo` against a
 * fresh database checks the content guard (real users or companies are refused unless --i-know,
 * before any write) and that a rerun replaces rather than duplicates the demo rows.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { join } from "node:path";
import postgres from "postgres";
import { applyMigrations } from "../../scripts/apply-migrations";
import { getSqlClient } from "../../data/drizzle/client";
import { strategyBacktestsRouter } from "../../api/trpc/routers/strategy-backtests";
import { countDemoRows, DEMO_BACKTEST_JOB_ID, seedDemo, type DemoSeedSummary } from "./seed";
import { DEMO_COMPANIES, DEMO_USER_EMAIL, DEMO_USER_ID } from "./universe";

const enabled = Boolean(process.env.TEST_DATABASE_URL);
const repoRoot = join(import.meta.dir, "../../..");

let first: DemoSeedSummary;
let firstCounts: Record<string, number>;

describe("synthetic demo seed (PostgreSQL)", () => {
  beforeAll(async () => {
    if (!enabled) return;
    await applyMigrations();
    first = await seedDemo({ allowExistingData: true });
    firstCounts = await countDemoRows();
  }, 60_000);

  it("writes the demo universe, a paper account with fills, screens and a completed backtest", async () => {
    if (!enabled) return console.log("  Skipping demo seed test: TEST_DATABASE_URL not set");
    expect(firstCounts).toMatchObject({
      users: 1,
      paper_accounts: 1,
      paper_orders: 4,
      paper_fills: 4,
      saved_screener_definitions: 3,
      strategy_definitions: 1,
      strategy_versions: 1,
      strategy_backtest_jobs: 1,
      strategy_performance_snapshots: 1,
      companies: DEMO_COMPANIES.length,
      quote_snapshots: DEMO_COMPANIES.length,
      candles: DEMO_COMPANIES.length * first.barsPerSymbol,
    });
    expect(firstCounts.paper_positions).toBe(3);

    const caller = strategyBacktestsRouter.createCaller({ userId: DEMO_USER_ID, email: DEMO_USER_EMAIL, role: "user" });
    const { job, snapshot } = await caller.getJob({ jobId: DEMO_BACKTEST_JOB_ID });
    expect(job.status).toBe("COMPLETED");
    expect(snapshot?.dataHash).toBe(first.backtestDataHash);
    expect(snapshot?.tradeCount).toBe(first.backtestTrades);
    expect(first.backtestTrades).toBeGreaterThan(0);
    expect((await caller.getTrades({ jobId: DEMO_BACKTEST_JOB_ID })).trades).toHaveLength(first.backtestTrades);
  });

  it("labels every demo fill and quote as synthetic and keeps the account's cash consistent with its ledger", async () => {
    if (!enabled) return console.log("  Skipping demo seed test: TEST_DATABASE_URL not set");
    const sql = getSqlClient();
    const fills = await sql<{ quote_source: string; quote_quality: string }[]>`
      SELECT quote_source, quote_quality FROM public.paper_fills WHERE user_id = ${DEMO_USER_ID}`;
    expect(fills.every((fill) => fill.quote_source === "simulated" && fill.quote_quality === "synthetic")).toBe(true);
    const snapshots = await sql<{ source: string }[]>`
      SELECT source FROM public.quote_snapshots WHERE company_id IN ${sql(DEMO_COMPANIES.map((c) => c.symbol))}`;
    expect(snapshots.every((row) => row.source === "simulated")).toBe(true);

    const [account] = await sql<{ cash: string; ledger: string; last_balance: string }[]>`
      SELECT a.cash_balance AS cash,
        (SELECT sum(amount) FROM public.paper_ledger_entries l WHERE l.user_id = a.user_id) AS ledger,
        (SELECT balance_after FROM public.paper_ledger_entries l WHERE l.user_id = a.user_id ORDER BY created_at DESC, entry_type = 'EXECUTION_FEE' DESC LIMIT 1) AS last_balance
      FROM public.paper_accounts a WHERE a.user_id = ${DEMO_USER_ID}`;
    // Cash moves only by realised P&L and fees, each with a ledger row; the initial cash is a ledger row too.
    expect(Number(account.cash)).toBeCloseTo(Number(account.ledger), 4);
    expect(Number(account.cash)).toBeCloseTo(Number(account.last_balance), 4);
  });
});

/** A migrated, otherwise empty database that only `bun run seed:demo` (a child process) writes to. */
const fresh = {
  name: `maet_demo_guard_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
  url: "",
  sql: undefined as postgres.Sql | undefined,
  async seed(...args: string[]) {
    const run = Bun.spawnSync([process.execPath, "--no-env-file", "run", "server/scripts/seed-demo.ts", ...args], {
      cwd: repoRoot,
      env: { PATH: process.env.PATH ?? "", NODE_ENV: "test", TEST_DATABASE_URL: fresh.url },
    });
    const stdout = run.stdout.toString();
    const rowsLine = /rows: (\{.*\})/u.exec(stdout)?.[1];
    return { exitCode: run.exitCode, stdout, stderr: run.stderr.toString(), rows: rowsLine ? (JSON.parse(rowsLine) as Record<string, number>) : null };
  },
  /** When the demo backtest job was written: a seed run deletes and recreates it. */
  async demoJobCreatedAt(): Promise<string | null> {
    const [row] = await fresh.sql!<{ created_at: Date }[]>`SELECT created_at FROM public.strategy_backtest_jobs WHERE id = ${DEMO_BACKTEST_JOB_ID}`;
    return row ? row.created_at.toISOString() : null;
  },
};

describe("`bun run seed:demo` content guard (fresh PostgreSQL database)", () => {
  let admin: postgres.Sql | undefined;

  beforeAll(async () => {
    if (!enabled) return;
    admin = postgres(process.env.TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE DATABASE ${fresh.name}`);
    const url = new URL(process.env.TEST_DATABASE_URL!);
    url.pathname = `/${fresh.name}`;
    fresh.url = url.toString();
    fresh.sql = postgres(fresh.url, { max: 1, onnotice: () => {} });
    await applyMigrations({ sql: fresh.sql });
  }, 60_000);

  afterAll(async () => {
    if (!enabled) return;
    await fresh.sql?.end({ timeout: 1 });
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${fresh.name} WITH (FORCE)`);
    await admin?.end({ timeout: 1 });
  });

  it("accepts an empty database, then one holding only a previous demo seed, with identical rows", async () => {
    if (!enabled) return console.log("  Skipping demo seed guard test: TEST_DATABASE_URL not set");
    const empty = await fresh.seed();
    expect(empty.stderr).not.toContain("Refusing");
    expect(empty.exitCode).toBe(0);
    // The CLI writes exactly what the in-process seed wrote, down to the backtest's data hash.
    expect(empty.stdout).toContain(`data hash ${first.backtestDataHash}`);
    expect(empty.rows).toEqual(firstCounts);
    const demoOnly = await fresh.seed();
    expect(demoOnly.exitCode).toBe(0);
    expect(demoOnly.rows).toEqual(empty.rows);
  }, 60_000);

  it("refuses, before any write, a database with a real user, and seeds it with --i-know", async () => {
    if (!enabled) return console.log("  Skipping demo seed guard test: TEST_DATABASE_URL not set");
    const realUser = crypto.randomUUID();
    await fresh.sql!`INSERT INTO auth.users (id) VALUES (${realUser})`;
    await fresh.sql!`INSERT INTO public.users (id, email) VALUES (${realUser}, 'trader@example.com')`;
    const before = await fresh.demoJobCreatedAt();
    expect(before).not.toBeNull();

    const refused = await fresh.seed();
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain("Refusing to seed demo data: the database holds 1 user(s) other than the demo user");
    expect(await fresh.demoJobCreatedAt()).toBe(before);

    const overridden = await fresh.seed("--i-know");
    expect(overridden.exitCode).toBe(0);
    expect(await fresh.demoJobCreatedAt()).not.toBe(before);
    await fresh.sql!`DELETE FROM public.users WHERE id = ${realUser}`;
    await fresh.sql!`DELETE FROM auth.users WHERE id = ${realUser}`;
  }, 60_000);

  it("refuses a database whose auth.users holds a real account without a profile row", async () => {
    if (!enabled) return console.log("  Skipping demo seed guard test: TEST_DATABASE_URL not set");
    const authOnly = crypto.randomUUID();
    await fresh.sql!`INSERT INTO auth.users (id) VALUES (${authOnly})`;
    const refused = await fresh.seed();
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain("1 user(s) other than the demo user");
    await fresh.sql!`DELETE FROM auth.users WHERE id = ${authOnly}`;
  }, 60_000);

  it("refuses a database holding real companies", async () => {
    if (!enabled) return console.log("  Skipping demo seed guard test: TEST_DATABASE_URL not set");
    await fresh.sql!`INSERT INTO public.companies (id, symbol, name, exchange) VALUES ('REALCO', 'REALCO', 'Real Company Ltd', 'NSE')`;
    const before = await fresh.demoJobCreatedAt();
    const refused = await fresh.seed();
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain("1 companies that are not demo rows");
    expect(await fresh.demoJobCreatedAt()).toBe(before);
    await fresh.sql!`DELETE FROM public.companies WHERE id = 'REALCO'`;
    expect((await fresh.seed()).exitCode).toBe(0);
  }, 60_000);
});

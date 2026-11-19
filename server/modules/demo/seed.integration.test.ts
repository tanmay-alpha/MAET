/**
 * Synthetic demo seed against PostgreSQL. Skipped without TEST_DATABASE_URL.
 *
 * Seeds in-process, then again through `bun run seed:demo` (the CLI path), and checks the second
 * run replaced rather than duplicated the first, produced the same backtest from the same bars,
 * and left the paper account consistent with its fills.
 */
import { beforeAll, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { applyMigrations } from "../../scripts/apply-migrations";
import { getSqlClient } from "../../data/drizzle/client";
import { strategyBacktestsRouter } from "../../api/trpc/routers/strategy-backtests";
import { countDemoRows, DEMO_BACKTEST_JOB_ID, DEMO_USER_EMAIL, DEMO_USER_ID, seedDemo, type DemoSeedSummary } from "./seed";
import { DEMO_COMPANIES } from "./universe";

const enabled = Boolean(process.env.TEST_DATABASE_URL);
const repoRoot = join(import.meta.dir, "../../..");

let first: DemoSeedSummary;
let firstCounts: Record<string, number>;

describe("synthetic demo seed (PostgreSQL)", () => {
  beforeAll(async () => {
    if (!enabled) return;
    await applyMigrations();
    first = await seedDemo();
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

  it("replaces its own rows when run again through `bun run seed:demo`", async () => {
    if (!enabled) return console.log("  Skipping demo seed test: TEST_DATABASE_URL not set");
    const run = Bun.spawnSync([process.execPath, "--no-env-file", "run", "server/scripts/seed-demo.ts"], {
      cwd: repoRoot,
      env: { PATH: process.env.PATH ?? "", NODE_ENV: "test", TEST_DATABASE_URL: process.env.TEST_DATABASE_URL! },
    });
    expect(run.stderr.toString()).not.toContain("error");
    expect(run.exitCode).toBe(0);
    expect(run.stdout.toString()).toContain(`data hash ${first.backtestDataHash}`);

    expect(await countDemoRows()).toEqual(firstCounts);
  }, 60_000);
});

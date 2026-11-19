import { test, expect, signIn } from "./support/fixtures";
import type { SweepResultView, SweepView } from "../../src/lib/strategy-jobs";

const STRATEGY_ID = "a1000000-0000-4000-8000-000000000001";
const SWEEP_ID = "a1000000-0000-4000-8000-000000000002";
const WARNING =
  "CORPORATE_ACTIONS_IN_WINDOW: 1 corporate action(s) between 2023-01-02 and 2023-07-20 are not applied to these prices: " +
  "split 2:1 on 2023-03-01. Yahoo split-adjusts candles as of the day they were fetched, and dividends are not added to returns.";

const SWEEP: SweepView = {
  id: SWEEP_ID,
  strategyId: STRATEGY_ID,
  status: "COMPLETED",
  parameters: [{ name: "fast", path: "entry.children.0.left.params.period", values: [3, 5] }],
  combinationCount: 2,
  completedCount: 2,
  symbolOrUniverse: "RELIANCE",
  timeframe: "1d",
  fromDate: "2023-01-02T00:00:00.000Z",
  toDate: "2023-07-20T00:00:00.000Z",
  createdAt: "2026-11-05T10:00:00.000Z",
};

const result = (fast: number, warnings?: string[]): SweepResultView => ({
  id: `a1000000-0000-4000-8000-00000000001${fast}`,
  combinationIndex: fast,
  parameterValues: { fast },
  resultSummary: {
    sharpe: "1.2000",
    sortino: "1.5000",
    totalReturn: "0.100000",
    maxDrawdown: "0.050000",
    winRate: "0.500000",
    profitFactor: null,
    tradeCount: 12,
    ...(warnings ? { warnings } : {}),
  },
});

test("parameter sweep results list their backtest warnings once", async ({ page, api }) => {
  await signIn(page);
  api.onQuery("strategyDefinitions.get", () => ({ strategy: { id: STRATEGY_ID, name: "SMA cross" }, versions: [] }));
  api.onQuery("strategyOptimisation.listSweeps", () => ({ sweeps: [SWEEP] }));
  // A result stored before warnings were kept has none; the others repeat the window's warning.
  api.onQuery("strategyOptimisation.getSweep", () => ({
    sweep: SWEEP,
    results: [result(3, [WARNING]), result(5, [WARNING]), result(8)],
    robustness: null,
  }));

  await page.goto(`/strategies/${STRATEGY_ID}/backtests?tab=sweeps&job=${SWEEP_ID}`);
  const warnings = page.getByTestId("sweep-warnings");
  await expect(warnings.getByRole("listitem")).toHaveCount(1);
  await expect(warnings).toHaveText(WARNING);
  await expect(page.getByText("Top 3 of 3 combinations by Sharpe", { exact: false })).toBeVisible();
});

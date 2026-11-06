import { describe, expect, it } from "bun:test";
import {
  backtestDisplayStatus,
  combinationCount,
  defaultJobWindow,
  defaultRange,
  describeJobError,
  discoverSweepableParameters,
  expandRange,
  jobPollInterval,
  jobWindowToIso,
  parseResearchSearch,
  sweepProgress,
  walkForwardError,
  walkForwardViewResult,
  type WalkForwardRunView,
  type WalkForwardWindowView,
} from "./strategy-jobs";
import { TrpcRequestError } from "./trpc";

const sma = (period: number) => ({ kind: "INDICATOR", indicator: "SMA", params: { period }, lag: 0 });
const definition = {
  name: "cross",
  direction: "LONG_ONLY",
  entry: { kind: "GROUP", id: "e", combinator: "AND", children: [{ kind: "CONDITION", id: "e1", left: sma(5), operator: "CROSS_ABOVE", right: sma(20) }] },
  exit: { kind: "GROUP", id: "x", combinator: "AND", children: [{ kind: "CONDITION", id: "x1", left: { kind: "INDICATOR", indicator: "RSI", params: { period: 14 }, lag: 1 }, operator: "GREATER_THAN", right: { kind: "CONSTANT", value: 70 } }] },
  risk: { sizingMethod: "PERCENT_OF_EQUITY", sizeValue: 100, maximumOpenPositions: 1, allowPyramiding: false },
  execution: { fillPolicy: "NEXT_BAR_OPEN", slippageBps: 5, initialCapital: 100_000 },
};

describe("job polling and status", () => {
  it("polls only while a job is queued or running", () => {
    expect(jobPollInterval(["COMPLETED", "QUEUED"])).toBe(2000);
    expect(jobPollInterval(["RUNNING"])).toBe(2000);
    expect(jobPollInterval(["COMPLETED", "FAILED", "CANCELLED"])).toBe(false);
    expect(jobPollInterval([])).toBe(false);
  });

  it("shows a queued backtest with a pending cancellation as cancelling", () => {
    expect(backtestDisplayStatus({ status: "QUEUED", cancelRequestedAt: "2026-01-01T00:00:00Z" })).toBe("CANCELLING");
    expect(backtestDisplayStatus({ status: "COMPLETED", cancelRequestedAt: "2026-01-01T00:00:00Z" })).toBe("COMPLETED");
    expect(backtestDisplayStatus({ status: "RUNNING", cancelRequestedAt: null })).toBe("RUNNING");
  });

  it("reports sweep progress from backtested combinations", () => {
    expect(sweepProgress({ status: "RUNNING", completedCount: 30, combinationCount: 120 })).toBe(25);
    expect(sweepProgress({ status: "COMPLETED", completedCount: 0, combinationCount: 0 })).toBe(100);
    expect(sweepProgress({ status: "QUEUED", completedCount: 0, combinationCount: 0 })).toBe(0);
  });
});

describe("describeJobError", () => {
  it("flags the per-user active job cap so the UI can explain it", () => {
    const error = new TrpcRequestError("At most 3 active backtest jobs allowed; wait for one to finish or cancel it.", 429, "TOO_MANY_REQUESTS");
    expect(describeJobError(error)).toEqual({ title: "Job limit reached", message: error.message, isJobLimit: true });
  });

  it("keeps the server's message for other failures", () => {
    expect(describeJobError(new TrpcRequestError("Date range is too short", 400, "BAD_REQUEST"))).toMatchObject({ isJobLimit: false, message: "Date range is too short" });
    expect(describeJobError(new Error("offline")).isJobLimit).toBe(false);
    expect(describeJobError("??").message).toMatch(/Try again/);
  });
});

describe("job date window", () => {
  it("defaults to the last two years", () => {
    expect(defaultJobWindow(new Date("2026-11-06T10:00:00Z"))).toEqual({ from: "2024-11-06", to: "2026-11-06" });
  });

  it("sends whole days and rejects an empty or inverted window", () => {
    expect(jobWindowToIso({ from: "2024-01-01", to: "2024-12-31" })).toEqual({ from: "2024-01-01T00:00:00.000Z", to: "2024-12-31T23:59:59.999Z" });
    expect(jobWindowToIso({ from: "2024-12-31", to: "2024-01-01" })).toHaveProperty("error");
    expect(jobWindowToIso({ from: "", to: "2024-01-01" })).toHaveProperty("error");
  });
});

describe("sweep parameters", () => {
  it("finds the numeric strategy fields a sweep can vary, with readable unique names", () => {
    expect(discoverSweepableParameters(definition)).toEqual([
      { path: "entry.children.0.left.params.period", name: "entry SMA period", currentValue: 5 },
      { path: "entry.children.0.right.params.period", name: "entry SMA period #2", currentValue: 20 },
      { path: "exit.children.0.left.params.period", name: "exit RSI period", currentValue: 14 },
      { path: "exit.children.0.right.value", name: "exit threshold", currentValue: 70 },
      { path: "risk.sizeValue", name: "risk sizeValue", currentValue: 100 },
      { path: "risk.maximumOpenPositions", name: "risk maximumOpenPositions", currentValue: 1 },
      { path: "execution.slippageBps", name: "execution slippageBps", currentValue: 5 },
    ]);
  });

  it("expands an inclusive range without float drift and enforces the per-parameter limit", () => {
    expect(expandRange(5, 15, 5)).toEqual([5, 10, 15]);
    expect(expandRange(0.1, 0.5, 0.1)).toEqual([0.1, 0.2, 0.3, 0.4, 0.5]);
    expect(expandRange(5, 5, 1)).toEqual([5]);
    expect(expandRange(1, 20, 1)).toHaveProperty("error");
    expect(expandRange(10, 5, 1)).toHaveProperty("error");
    expect(expandRange(1, 5, 0)).toHaveProperty("error");
  });

  it("suggests a range of about five values around the current value", () => {
    expect(defaultRange(20)).toEqual({ start: 10, end: 30, step: 5 });
    expect(defaultRange(1)).toEqual({ start: 1, end: 2, step: 1 });
    expect(defaultRange(0.5)).toEqual({ start: 0.25, end: 0.75, step: 0.125 });
    for (const value of [3, 7, 14, 50, 200, 0.02, 0]) {
      const { start, end, step } = defaultRange(value);
      expect(Array.isArray(expandRange(start, end, step))).toBe(true);
    }
  });

  it("counts combinations", () => {
    expect(combinationCount([{ values: [3, 5, 7] }, { values: [30, 20, 40, 50] }])).toBe(12);
    expect(combinationCount([])).toBe(1);
  });
});

describe("result mapping", () => {
  const run: WalkForwardRunView = {
    id: "r1", strategyId: "s1", mode: "ROLLING", parameters: [], symbol: "TCS", timeframe: "1d",
    fromDate: "2024-01-01T00:00:00.000Z", toDate: "2024-12-31T00:00:00.000Z", trainingDays: 120, validationDays: 40, windowCount: 2,
    status: "COMPLETED", createdAt: "2024-12-31T00:00:00.000Z",
    oosSummary: {
      isReturnAvg: 0.1, oosReturnTotal: 0.05, isSharpeAvg: 1, oosSharpeAvg: 0.5, isDrawdownAvg: 0.1, oosDrawdownMax: 0.08,
      performanceRetention: 0.5, performanceRetentionReason: null, walkForwardEfficiency: 0.4, walkForwardEfficiencyReason: null,
      acceptedWindowsCount: 1, testedWindowsCount: 1, totalWindowsCount: 2, warnings: ["Window 2 rejected"],
      oosEquityCurve: [{ timestamp: 1, equity: 100 }, { timestamp: 2, equity: 105 }],
    },
  };
  const metrics = { totalReturn: 0.1, annualisedReturn: 0.2, sharpe: 1.1, maxDrawdown: 0.05, tradeCount: 4, winRate: 0.5 };
  const windows: WalkForwardWindowView[] = [
    {
      windowIndex: 1, trainingFrom: "2024-01-01", trainingTo: "2024-03-01", validationFrom: "2024-03-01", validationTo: "2024-04-01",
      testFrom: "2024-04-01", testTo: "2024-05-01", selectedParameters: { fast: 5 }, trainingMetrics: metrics,
      validationMetrics: { metrics, accepted: true, rejectionReason: null }, testMetrics: metrics,
    },
    {
      windowIndex: 2, trainingFrom: "2024-05-01", trainingTo: "2024-07-01", validationFrom: "2024-07-01", validationTo: "2024-08-01",
      testFrom: "2024-08-01", testTo: "2024-09-01", selectedParameters: { fast: 8 }, trainingMetrics: metrics,
      validationMetrics: { metrics, accepted: false, rejectionReason: "validation Sharpe -2.00 is below -1" }, testMetrics: null,
    },
  ];

  it("maps a completed walk-forward run and its stored windows onto the view's result", () => {
    const view = walkForwardViewResult(run, windows)!;
    expect(view.summary.oosReturnTotal).toBe(0.05);
    expect(view.warnings).toEqual(["Window 2 rejected"]);
    expect(view.aggregateOosEquityCurve).toHaveLength(2);
    expect(view.windows.map((w) => [w.windowNumber, w.validationAccepted, w.oosMetrics?.sharpe ?? null])).toEqual([[1, true, 1.1], [2, false, null]]);
    expect(view.windows[1].rejectionReason).toMatch(/validation Sharpe/);
  });

  it("has nothing to show until the run completes, and exposes a failure reason", () => {
    expect(walkForwardViewResult({ ...run, status: "RUNNING" }, [])).toBeNull();
    const failed = { ...run, status: "FAILED" as const, oosSummary: { error: "Insufficient history" } };
    expect(walkForwardViewResult(failed, [])).toBeNull();
    expect(walkForwardError(failed)).toBe("Insufficient history");
    expect(walkForwardError(run)).toBeNull();
  });
});

describe("research page search params", () => {
  it("keeps a known tab and job id and drops anything else", () => {
    expect(parseResearchSearch({ tab: "sweeps", job: "abc" })).toEqual({ tab: "sweeps", job: "abc" });
    expect(parseResearchSearch({ tab: "toString", job: 4 })).toEqual({ tab: undefined, job: undefined });
    expect(parseResearchSearch({})).toEqual({ tab: undefined, job: undefined });
  });
});

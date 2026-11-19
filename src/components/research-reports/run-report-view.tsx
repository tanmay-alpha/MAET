import { useState, type ReactNode } from "react";
import { MetricGrid, secondaryButton, type MetricItem } from "@/components/strategy/page-chrome";
import { count, dateTime, decimal, percent, percentValue, rupees, signTone } from "@/components/strategy/format";
import { downloadText, researchReports, type CsvKind, type RunReport } from "./api";

const NOT_RECORDED = "Not recorded";

function Fields({ label, rows }: { label: string; rows: Array<[string, ReactNode]> }) {
  return (
    <section aria-label={label} className="rounded border border-border bg-panel">
      <h2 className="border-b border-border px-3 py-1.5 text-xs font-medium text-muted-foreground">{label}</h2>
      <dl className="divide-y divide-border text-xs">
        {rows.map(([name, value]) => (
          <div key={name} className="flex items-baseline justify-between gap-4 px-3 py-1.5">
            <dt className="shrink-0 text-muted-foreground">{name}</dt>
            <dd className="min-w-0 break-all text-right font-mono">{value ?? <span className="text-amber-400">{NOT_RECORDED}</span>}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function orNull<T>(value: T | null, render: (v: T) => ReactNode = (v) => String(v)): ReactNode | null {
  return value === null ? null : render(value);
}

function DownloadButtons({ report }: { report: RunReport }) {
  const [pending, setPending] = useState<CsvKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const jobId = report.identity.jobId;

  const downloadCsv = async (kind: CsvKind) => {
    setPending(kind);
    setError(null);
    try {
      const file = await researchReports.exportCsv.query({ jobId, kind });
      downloadText(file.filename, file.content, "text/csv;charset=utf-8");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        className={secondaryButton}
        onClick={() => downloadText(`maet-run-${jobId}-report.json`, `${JSON.stringify(report, null, 2)}\n`, "application/json")}
      >
        Download JSON
      </button>
      <button type="button" className={secondaryButton} disabled={pending !== null} onClick={() => downloadCsv("trades")}>
        {pending === "trades" ? "Preparing…" : "Trades CSV"}
      </button>
      <button type="button" className={secondaryButton} disabled={pending !== null} onClick={() => downloadCsv("equity")}>
        {pending === "equity" ? "Preparing…" : "Equity CSV"}
      </button>
      {error && <span role="alert" className="text-xs text-bear">{error}</span>}
    </div>
  );
}

export function RunReportView({ report }: { report: RunReport }) {
  const { reproducible: r } = report;
  const m = r.metrics;
  const metrics: MetricItem[] = [
    { label: "Total return", value: percent(m.totalReturn), tone: signTone(m.totalReturn) },
    { label: "CAGR", value: percent(m.annualizedReturn), tone: signTone(m.annualizedReturn) },
    { label: "Max drawdown", value: percent(m.maxDrawdown) },
    { label: "Sharpe", value: decimal(m.sharpe) },
    { label: "Sortino", value: decimal(m.sortino) },
    { label: "Calmar", value: decimal(m.calmar) },
    { label: "Win rate", value: percent(m.winRate) },
    { label: "Profit factor", value: decimal(m.profitFactor), hint: m.profitFactor === null ? "Undefined: no losing trades" : undefined },
    { label: "Expectancy / trade", value: rupees(m.expectancy) },
    { label: "Trades", value: `${count(m.tradeCount)} (${count(m.longTradeCount)} long, ${count(m.shortTradeCount)} short)` },
    { label: "Fees", value: rupees(m.feesPaid) },
    { label: "Slippage", value: rupees(m.slippageCost) },
    { label: "Net profit", value: rupees(m.netProfit), tone: signTone(m.netProfit) },
    { label: "Exposure", value: percentValue(m.exposurePercent) },
    { label: "Benchmark return", value: percent(m.benchmarkReturn), hint: m.benchmarkReturn === null ? "No benchmark series was applied" : undefined },
    { label: "Alpha", value: percent(m.alpha) },
  ];
  const e = r.execution;

  return (
    <div className="space-y-4">
      <section aria-label="Reproducibility" className="rounded border border-border bg-panel p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xs font-medium text-muted-foreground">Reproducibility hash (SHA-256)</h2>
            <p className="mt-1 break-all font-mono text-xs">{report.reproducibilityHash.value}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Over the {report.reproducibilityHash.scope.replace(/^sha256 of the /, "")}: same strategy version, data, costs, server
              revision and results give the same hash. Generated {dateTime(report.generatedAt)}.
            </p>
          </div>
          <DownloadButtons report={report} />
        </div>
        {report.warnings.length > 0 && (
          <ul role="status" className="mt-3 space-y-1 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
            {report.warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        )}
        {r.missingFields.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Not recorded for this run: <span className="font-mono">{r.missingFields.join(", ")}</span>
          </p>
        )}
      </section>

      <MetricGrid label="Run metrics" items={metrics} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Fields
          label="Strategy and engine"
          rows={[
            ["Definition hash", r.strategy.definitionHash],
            ["Schema version", String(r.strategy.schemaVersion)],
            ["Engine that ran", orNull(r.versions.strategyEngine)],
            ["Indicator engine that ran", orNull(r.versions.indicatorEngine)],
            ["Engine pinned by version", r.versions.strategyEnginePinned],
            ["Indicators pinned by version", r.versions.indicatorEnginePinned],
            ["Fee model", orNull(r.versions.feeModel)],
            ["Server commit", orNull(r.server.gitCommitSha)],
          ]}
        />
        <Fields
          label="Data"
          rows={[
            ["Symbols", r.data.symbols.join(", ")],
            ["Timeframe", r.data.timeframe],
            ["Requested window", `${dateTime(r.data.window.from)} → ${dateTime(r.data.window.to)}`],
            ["Bars used", orNull(r.data.candleCount, count)],
            ["First bar", orNull(r.data.firstCandleTs, dateTime)],
            ["Last bar", orNull(r.data.lastCandleTs, dateTime)],
            ["Candle SHA-256", orNull(r.data.candleSha256)],
            ["Engine data hash", orNull(r.data.engineDataHash)],
          ]}
        />
        <Fields
          label="Costs and fills"
          rows={[
            ["Initial capital", rupees(e.initialCapital, 0)],
            ["Fill policy", e.fillPolicy],
            ["Intrabar policy", e.intrabarPolicy ?? "Engine default"],
            ["Fee model", e.feeModel],
            ...(e.feeBps !== null ? [["Fee (bps per leg)", decimal(e.feeBps)] as [string, ReactNode]] : []),
            ...(e.exchange !== null ? [["Statutory schedule", `${e.exchange} ${e.product ?? ""}`] as [string, ReactNode]] : []),
            ...(e.brokerage !== null ? [["Brokerage (₹ per leg)", decimal(e.brokerage)] as [string, ReactNode]] : []),
            ["Slippage (bps)", decimal(e.slippageBps)],
            ["Spread model", e.spreadModel ?? "None declared"],
            ["Market impact model", e.marketImpactModel ?? "None declared"],
          ]}
        />
        <Fields
          label="Benchmark and results"
          rows={[
            ["Benchmark", r.benchmark.symbol ?? "None"],
            ["Benchmark applied", r.benchmark.applied ? "Yes" : "No"],
            ["Trades stored", count(r.results.tradeCount)],
            ["Equity points stored", count(r.results.equityPointCount)],
            ["Trades CSV SHA-256", r.results.tradesCsvSha256],
            ["Equity CSV SHA-256", r.results.equityCsvSha256],
          ]}
        />
      </div>
    </div>
  );
}

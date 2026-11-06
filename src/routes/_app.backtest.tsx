import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { trpc } from "@/lib/trpc";
import { ratioMetric } from "./-backtest-metrics";
import { EquityLine } from "@/components/strategy/equity-line";
import { EmptyLine, ErrorLine, MetricGrid, PageHeader, primaryButton, secondaryButton, type MetricItem } from "@/components/strategy/page-chrome";
import { count, dateTime, decimal, percent, rupees, shortDate, signTone } from "@/components/strategy/format";
import { SignedOutNotice } from "@/components/common/signed-out-notice";
import { useSignedIn } from "@/hooks/use-signed-in";
import { DEFAULT_INITIAL_CAPITAL_INR } from "@shared/strategy/ast";

export interface BacktestSearch {
  symbol?: string;
  sourceContext?: string;
}

export const Route = createFileRoute("/_app/backtest")({
  validateSearch: (search: Record<string, unknown>): BacktestSearch => ({
    symbol: typeof search.symbol === "string" ? search.symbol : undefined,
    sourceContext: typeof search.sourceContext === "string" ? search.sourceContext : undefined,
  }),
  head: () => ({ meta: [{ title: "Backtest — MAET" }] }),
  component: Backtest,
});

const STRATEGIES: Record<string, string> = {
  SMA_CROSS: "SMA cross",
  EMA_CROSS: "EMA cross",
  RSI_REVERSAL: "RSI reversal",
  MACD_CROSS: "MACD cross",
  DONCHIAN_BREAKOUT: "Donchian breakout",
  BOLLINGER_MEAN_REVERSION: "Bollinger mean reversion",
};

/** Risk settings every run uses; shown next to the results so the numbers can be read correctly. */
const RISK = {
  initialCapital: DEFAULT_INITIAL_CAPITAL_INR,
  feeBps: 10,
  slippageBps: 5,
  positionSizePercent: 100,
  maximumOpenPositions: 1,
};

/** backtestV2 metrics (server/domain/backtest/risk-metrics.ts): ratios are fractions. */
interface RunMetrics {
  totalReturn?: number;
  annualisedReturn?: number;
  sharpe?: number;
  sortino?: number;
  calmar?: number;
  maxDrawdown?: number;
  ulcerIndex?: number;
  winRate?: number;
  profitFactor?: number | null;
  payoffRatio?: number | null;
}

interface RunResult {
  runId?: string;
  symbol: string;
  from?: string;
  to?: string;
  metrics?: RunMetrics;
  equityCurve?: Array<{ timestamp: number; equity: number }>;
  trades?: unknown[];
}

interface RunResponse {
  runId: string;
  result: RunResult;
}

/** backtest_runs row; `result` is the stored payload, with signalCount = number of trades. */
interface StoredRun {
  id: string;
  symbol: string;
  timeframe: string;
  strategy: string;
  createdAt: string;
  result?: { metrics?: RunMetrics; signalCount?: number } | null;
}

const inputClass = "h-8 w-full rounded border border-border bg-background px-2 text-xs";

function Backtest() {
  const signedIn = useSignedIn();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const queryClient = useQueryClient();
  const [symbol, setSymbol] = useState(search.symbol || "RELIANCE");
  const [strategy, setStrategy] = useState("SMA_CROSS");
  const [timeframe, setTimeframe] = useState("1d");
  const [fast, setFast] = useState(20);
  const [slow, setSlow] = useState(50);
  const [rsiPeriod, setRsiPeriod] = useState(14);

  const runsQuery = useQuery({
    queryKey: ["backtestV2", "listRuns"],
    queryFn: () => trpc.backtestV2.listRuns.query(),
    enabled: signedIn,
  });

  const mutation = useMutation({
    mutationFn: (input: unknown): Promise<RunResponse> => trpc.backtestV2.run.mutate(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["backtestV2"] });
    },
  });

  const result = mutation.data?.result;
  const m = result?.metrics;

  const run = () => mutation.mutate({
    symbol,
    timeframe,
    strategy: { type: strategy, fastPeriod: fast, slowPeriod: slow, rsiPeriod },
    risk: RISK,
  });

  const metrics: MetricItem[] = result ? [
    { label: "Total return", value: percent(m?.totalReturn), tone: signTone(m?.totalReturn) },
    { label: "CAGR", value: percent(m?.annualisedReturn), tone: signTone(m?.annualisedReturn) },
    { label: "Max drawdown", value: percent(m?.maxDrawdown), tone: m?.maxDrawdown ? "text-bear" : "" },
    { label: "Sharpe", value: decimal(m?.sharpe) },
    { label: "Sortino", value: decimal(m?.sortino) },
    { label: "Calmar", value: decimal(m?.calmar) },
    { label: "Ulcer index", value: decimal(m?.ulcerIndex) },
    { label: "Win rate", value: percent(m?.winRate, 1) },
    ...[ratioMetric("Profit factor", m?.profitFactor), ratioMetric("Payoff ratio", m?.payoffRatio)].map((r) => ({ label: r.label, value: r.value, hint: r.hint })),
    { label: "Trades", value: count(result.trades?.length) },
  ] : [];

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <PageHeader
        title="Backtest"
        meta={`Built-in strategies on stored daily candles · fills at the next bar's open · ${rupees(RISK.initialCapital, 0)} capital, ${RISK.feeBps} bps fees, ${RISK.slippageBps} bps slippage`}
        actions={<Link to="/strategies" className={secondaryButton}>Strategy Lab</Link>}
      />

      <div className="space-y-4 p-4">
        <form
          onSubmit={(event) => { event.preventDefault(); run(); }}
          className="grid grid-cols-2 items-end gap-2 sm:grid-cols-3 lg:flex lg:flex-wrap"
        >
          <Field label="Symbol">
            <input value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} className={`${inputClass} font-mono lg:w-32`} />
          </Field>
          <Field label="Strategy">
            <select value={strategy} onChange={(event) => setStrategy(event.target.value)} className={`${inputClass} lg:w-52`}>
              {Object.entries(STRATEGIES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </Field>
          <Field label="Timeframe">
            <select value={timeframe} onChange={(event) => setTimeframe(event.target.value)} className={`${inputClass} lg:w-24`}>
              <option value="1d">Daily</option>
            </select>
          </Field>
          {strategy === "SMA_CROSS" || strategy === "EMA_CROSS" ? (
            <>
              <Field label="Fast period">
                <input type="number" min={2} value={fast} onChange={(event) => setFast(Number(event.target.value))} className={`${inputClass} font-mono lg:w-24`} />
              </Field>
              <Field label="Slow period">
                <input type="number" min={3} value={slow} onChange={(event) => setSlow(Number(event.target.value))} className={`${inputClass} font-mono lg:w-24`} />
              </Field>
            </>
          ) : (
            <Field label="RSI period">
              <input type="number" min={2} value={rsiPeriod} onChange={(event) => setRsiPeriod(Number(event.target.value))} className={`${inputClass} font-mono lg:w-24`} />
            </Field>
          )}
          <button type="submit" disabled={!signedIn || mutation.isPending} className={`${primaryButton} h-8 justify-center`}>
            {mutation.isPending ? "Running…" : "Run backtest"}
          </button>
        </form>

        {!signedIn && <SignedOutNotice feature="Backtests" />}
        {mutation.isError && <ErrorLine title="Backtest failed" error={mutation.error} />}

        {result && (
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-medium">
                {result.symbol} · {STRATEGIES[strategy] ?? strategy}
                <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
                  {shortDate(result.from)} – {shortDate(result.to)} · {count(result.equityCurve?.length)} bars
                </span>
              </h2>
              <div className="flex gap-1.5">
                <Link
                  to="/chart/$symbol"
                  params={{ symbol: result.symbol }}
                  search={{ backtestRunId: mutation.data?.runId || result.runId, sourceContext: "backtest" }}
                  className={secondaryButton}
                >
                  Trades on chart
                </Link>
                <button
                  type="button"
                  onClick={() => void navigate({ href: `/terminal?symbol=${encodeURIComponent(result.symbol)}&sourceContext=backtest` })}
                  className={secondaryButton}
                >
                  Open in terminal
                </button>
              </div>
            </div>
            <div className="grid gap-3 xl:grid-cols-[1fr_28rem]">
              <div className="rounded border border-border bg-panel p-3">
                <EquityLine label="Equity curve" height={260} points={(result.equityCurve ?? []).map((p) => ({ time: p.timestamp, equity: p.equity }))} />
              </div>
              <MetricGrid label="Backtest metrics" items={metrics} />
            </div>
          </section>
        )}

        <RunHistory signedIn={signedIn} query={runsQuery} />
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-[11px] text-muted-foreground">
      {label}
      <div className="mt-0.5 text-foreground">{children}</div>
    </label>
  );
}

function RunHistory({ signedIn, query }: {
  signedIn: boolean;
  query: { data?: { runs: StoredRun[] }; error: Error | null; isLoading: boolean };
}) {
  if (!signedIn) return null;
  const runs = query.data?.runs ?? [];
  let body: ReactNode;
  if (query.error) body = <div className="p-3"><ErrorLine title="Could not load past runs" error={query.error} /></div>;
  else if (query.isLoading) body = <EmptyLine>Loading past runs…</EmptyLine>;
  else if (runs.length === 0) body = <EmptyLine>No saved runs yet. Each run above is saved here.</EmptyLine>;
  else {
    body = (
      <div className="overflow-x-auto">
        <table className="w-full whitespace-nowrap text-xs">
          <thead className="border-b border-border bg-panel text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5 text-left font-medium">Symbol</th>
              <th className="px-3 py-1.5 text-left font-medium">Strategy</th>
              <th className="px-3 py-1.5 text-right font-medium">Return</th>
              <th className="px-3 py-1.5 text-right font-medium">Max DD</th>
              <th className="px-3 py-1.5 text-right font-medium">Sharpe</th>
              <th className="px-3 py-1.5 text-right font-medium">Trades</th>
              <th className="px-3 py-1.5 text-right font-medium">Run at (IST)</th>
              <th className="px-3 py-1.5"><span className="sr-only">Chart</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {runs.map((r) => {
              const rm = r.result?.metrics;
              return (
                <tr key={r.id} className="hover:bg-accent/30">
                  <td className="px-3 py-1.5 font-mono font-medium">{r.symbol} <span className="font-normal text-muted-foreground">{r.timeframe}</span></td>
                  <td className="px-3 py-1.5">{STRATEGIES[r.strategy] ?? r.strategy}</td>
                  <td className={`px-3 py-1.5 text-right font-mono ${signTone(rm?.totalReturn)}`}>{percent(rm?.totalReturn)}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-bear">{percent(rm?.maxDrawdown)}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{decimal(rm?.sharpe)}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{count(r.result?.signalCount)}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{dateTime(r.createdAt)}</td>
                  <td className="px-3 py-1.5 text-right">
                    <Link
                      to="/chart/$symbol"
                      params={{ symbol: r.symbol }}
                      search={{ backtestRunId: r.id, sourceContext: "backtest" }}
                      className="text-primary hover:underline"
                      title="Open the chart with this run's trade markers"
                    >
                      Chart
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <section className="rounded border border-border">
      <h2 className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">Past runs</h2>
      {body}
    </section>
  );
}

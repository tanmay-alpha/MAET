import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useSignedIn } from "@/hooks/use-signed-in";
import { SignedOutNotice } from "@/components/common/signed-out-notice";
import { EmptyLine, ErrorLine, PageHeader, primaryButton, secondaryButton } from "@/components/strategy/page-chrome";
import { count, dateTime, rupees, shortDate, signTone } from "@/components/strategy/format";

export const Route = createFileRoute("/_app/replay")({
  head: () => ({ meta: [{ title: "Bar Replay — MAET Strategy Lab" }] }),
  component: ReplayPage,
});

const TIMEFRAMES = ["1m", "5m", "15m", "1h", "1d"];

/** strategy_replay_sessions row as JSON. */
interface ReplaySession {
  id: string;
  symbol: string;
  timeframe: string;
  barsRevealed: number;
  currentEquity: string;
}

interface ReplayBar {
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const inputClass = "mt-0.5 h-8 w-full rounded border border-border bg-background px-2 text-xs";

function ReplayPage() {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [symbol, setSymbol] = useState("RELIANCE");
  const [timeframe, setTimeframe] = useState("1d");
  const [startDate, setStartDate] = useState("2023-01-01");
  const [endOfData, setEndOfData] = useState(false);

  const signedIn = useSignedIn();
  const { data: sessions, error: listError, refetch: refetchSessions } = trpc.strategyReplay.list.useQuery(undefined, { enabled: signedIn });

  const createMutation = trpc.strategyReplay.create.useMutation({
    onSuccess: (data: { session: ReplaySession }) => {
      setActiveSessionId(data.session.id);
      setEndOfData(false);
      refetchSessions();
    },
  });
  const stepMutation = trpc.strategyReplay.step.useMutation();
  const resetMutation = trpc.strategyReplay.reset.useMutation();
  const closeMutation = trpc.strategyReplay.close.useMutation({
    onSuccess: () => { setActiveSessionId(null); refetchSessions(); },
  });
  const actionError = createMutation.error ?? stepMutation.error ?? resetMutation.error ?? closeMutation.error;

  const { data: stateData, error: stateError, refetch: refetchState } = trpc.strategyReplay.getState.useQuery(
    { sessionId: activeSessionId! },
    { enabled: !!activeSessionId },
  );

  const bars: ReplayBar[] = stateData?.bars ?? [];
  const session: ReplaySession | undefined = stateData?.session;
  const openSessions: ReplaySession[] = sessions?.sessions ?? [];

  function openSession(id: string) {
    setActiveSessionId(id);
    setEndOfData(false);
  }

  function handleStep() {
    if (!activeSessionId) return;
    stepMutation.mutate({ sessionId: activeSessionId }, {
      onSuccess: (result: { endOfData: boolean }) => {
        setEndOfData(result.endOfData);
        refetchState();
      },
    });
  }

  function handleReset() {
    if (!activeSessionId) return;
    resetMutation.mutate({ sessionId: activeSessionId }, {
      onSuccess: () => { setEndOfData(false); refetchState(); },
    });
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto md:overflow-hidden">
      <PageHeader
        title="Bar replay"
        meta="Step through stored candles one bar at a time. Replay sessions keep their own cash, separate from the paper account."
        actions={
          activeSessionId && (
            <>
              <button type="button" onClick={handleStep} disabled={stepMutation.isPending || endOfData} className={primaryButton}>Next bar</button>
              <button type="button" onClick={handleReset} disabled={resetMutation.isPending} className={secondaryButton}>Reset</button>
              <button type="button" onClick={() => closeMutation.mutate({ sessionId: activeSessionId })} className={secondaryButton}>Close session</button>
            </>
          )
        }
      />

      <div className="flex flex-col md:min-h-0 md:flex-1 md:flex-row">
        <aside className="shrink-0 space-y-4 border-b border-border p-4 md:w-64 md:overflow-y-auto md:border-b-0 md:border-r">
          {!activeSessionId && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                createMutation.mutate({ symbol, timeframe, startTimestamp: `${startDate}T00:00:00.000Z` });
              }}
              className="space-y-2"
            >
              <h2 className="text-xs font-medium text-muted-foreground">New session</h2>
              <div className="grid grid-cols-3 gap-2 md:grid-cols-1">
                <label className="block text-[11px] text-muted-foreground">
                  Symbol
                  <input className={`${inputClass} font-mono text-foreground`} value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
                </label>
                <label className="block text-[11px] text-muted-foreground">
                  Timeframe
                  <select className={`${inputClass} text-foreground`} value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
                    {TIMEFRAMES.map((tf) => <option key={tf} value={tf}>{tf}</option>)}
                  </select>
                </label>
                <label className="block text-[11px] text-muted-foreground">
                  Start date
                  <input type="date" className={`${inputClass} text-foreground`} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </label>
              </div>
              <button type="submit" disabled={!signedIn || createMutation.isPending} className={`${primaryButton} w-full justify-center`}>
                {createMutation.isPending ? "Starting…" : "Start replay"}
              </button>
              {!signedIn && <SignedOutNotice feature="Replay sessions" />}
            </form>
          )}

          {session && (
            <section>
              <h2 className="mb-1 text-xs font-medium text-muted-foreground">Session</h2>
              <dl className="divide-y divide-border rounded border border-border text-xs">
                {[
                  ["Symbol", session.symbol],
                  ["Timeframe", session.timeframe],
                  ["Bars revealed", count(session.barsRevealed)],
                  ["Cash", rupees(session.currentEquity)],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3 px-2.5 py-1.5">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="font-mono">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {listError && <ErrorLine title="Could not load sessions" error={listError} />}
          {openSessions.length > 0 && !activeSessionId && (
            <section>
              <h2 className="mb-1 text-xs font-medium text-muted-foreground">Open sessions</h2>
              <ul className="divide-y divide-border rounded border border-border">
                {openSessions.map((s) => (
                  <li key={s.id}>
                    <button type="button" onClick={() => openSession(s.id)} className="flex w-full justify-between gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-accent/40">
                      <span className="font-mono font-medium">{s.symbol} · {s.timeframe}</span>
                      <span className="text-muted-foreground">{count(s.barsRevealed)} bars</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>

        <div className="min-w-0 space-y-3 p-4 md:flex-1 md:overflow-y-auto">
          {actionError && <ErrorLine title="Replay request failed" error={actionError} />}
          {stateError && <ErrorLine title="Could not load the session" error={stateError} />}
          {endOfData && <p className="text-xs text-muted-foreground">End of stored data: no later {session?.timeframe ?? ""} candle for {session?.symbol ?? "this symbol"}.</p>}
          {!activeSessionId ? (
            signedIn && <EmptyLine>Start a session or open one to reveal bars.</EmptyLine>
          ) : bars.length === 0 ? (
            <EmptyLine>{stateData ? "No bars revealed yet. Press Next bar." : "Loading session…"}</EmptyLine>
          ) : (
            <BarTable bars={bars} intraday={(session?.timeframe ?? "1d") !== "1d"} />
          )}
        </div>
      </div>
    </div>
  );
}

/** Revealed bars, newest first; change is against the previous revealed close. */
function BarTable({ bars, intraday }: { bars: ReplayBar[]; intraday: boolean }) {
  const rows = useMemo(
    () => bars.map((bar, i) => ({ bar, index: i + 1, change: i === 0 ? null : (bar.close - bars[i - 1].close) / bars[i - 1].close })).reverse(),
    [bars],
  );
  const price = (value: number) => rupees(value).replace("₹", "");

  return (
    <section>
      <h2 className="mb-1.5 text-xs text-muted-foreground">
        {count(bars.length)} bars revealed, through {intraday ? dateTime(bars[bars.length - 1].ts) : shortDate(bars[bars.length - 1].ts)} · prices in ₹
      </h2>
      <div className="overflow-x-auto rounded border border-border">
        <table className="w-full whitespace-nowrap text-xs">
          <thead className="sticky top-0 border-b border-border bg-panel text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5 text-right font-medium">#</th>
              <th className="px-3 py-1.5 text-left font-medium">{intraday ? "Time (IST)" : "Date"}</th>
              <th className="px-3 py-1.5 text-right font-medium">Open</th>
              <th className="px-3 py-1.5 text-right font-medium">High</th>
              <th className="px-3 py-1.5 text-right font-medium">Low</th>
              <th className="px-3 py-1.5 text-right font-medium">Close</th>
              <th className="px-3 py-1.5 text-right font-medium">Change</th>
              <th className="px-3 py-1.5 text-right font-medium">Volume</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border font-mono">
            {rows.map(({ bar, index, change }, i) => (
              <tr key={bar.ts} className={i === 0 ? "bg-accent/40" : "hover:bg-accent/30"}>
                <td className="px-3 py-1.5 text-right text-muted-foreground">{index}</td>
                <td className="px-3 py-1.5">{intraday ? dateTime(bar.ts) : shortDate(bar.ts)}</td>
                <td className="px-3 py-1.5 text-right">{price(bar.open)}</td>
                <td className="px-3 py-1.5 text-right">{price(bar.high)}</td>
                <td className="px-3 py-1.5 text-right">{price(bar.low)}</td>
                <td className={`px-3 py-1.5 text-right ${bar.close >= bar.open ? "text-bull" : "text-bear"}`}>{price(bar.close)}</td>
                <td className={`px-3 py-1.5 text-right ${signTone(change)}`}>
                  {change === null ? "—" : `${change > 0 ? "+" : ""}${(change * 100).toFixed(2)}%`}
                </td>
                <td className="px-3 py-1.5 text-right text-muted-foreground">{count(bar.volume)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

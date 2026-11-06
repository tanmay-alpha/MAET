import { useQuery } from "@tanstack/react-query";
import { trpc, type BreadthOverview } from "@/lib/trpc";

/** ALL_NSE breadth; marketBreadth procedures require a session, so pass `enabled: signedIn`. */
export function useBreadthOverview(enabled: boolean) {
  return useQuery({
    queryKey: ["marketBreadth", "overview", "ALL_NSE"],
    queryFn: () => trpc.marketBreadth.getOverview.query({ universe: "ALL_NSE" }),
    enabled,
    refetchInterval: 30_000,
    retry: false,
  });
}

function SmaRow({ label, pct, above, eligible }: { label: string; pct: number; above: number; eligible: number }) {
  return (
    <tr className="border-t border-border/60">
      <td className="py-1 text-muted-foreground">{label}</td>
      <td className="py-1 text-right font-mono tabular-nums">{pct}%</td>
      <td className="py-1 text-right font-mono tabular-nums text-muted-foreground">{above.toLocaleString("en-IN")}/{eligible.toLocaleString("en-IN")}</td>
    </tr>
  );
}

export function BreadthGauge({ data }: { data: BreadthOverview }) {
  const adv = data.advances ?? 0;
  const dec = data.declines ?? 0;
  const unc = data.unchanged ?? 0;
  const total = adv + dec + unc;
  const advPct = total > 0 ? (adv / total) * 100 : 0;
  const uncPct = total > 0 ? (unc / total) * 100 : 0;
  const ratioDisplay = data.advanceDeclineRatio !== null && data.advanceDeclineRatio !== undefined
    ? data.advanceDeclineRatio.toFixed(2)
    : "—";

  return (
    <section aria-label="Market breadth" className="border border-border bg-panel p-3 text-xs">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Breadth</h2>
        <span className="font-mono tabular-nums text-[11px] text-muted-foreground">
          {data.companiesWithUsableQuote.toLocaleString("en-IN")}/{data.eligibleCompanies.toLocaleString("en-IN")} quoted ({((data.quoteCoverage ?? 0) * 100).toFixed(0)}%)
        </span>
      </div>

      <div className="mt-3 flex items-baseline justify-between font-mono tabular-nums">
        <span className="text-bull">{adv.toLocaleString("en-IN")} up</span>
        <span className="text-muted-foreground">{unc.toLocaleString("en-IN")} flat</span>
        <span className="text-bear">{dec.toLocaleString("en-IN")} down</span>
      </div>
      <div className="mt-1.5 flex h-1.5 w-full overflow-hidden bg-bear" aria-hidden="true">
        <div className="h-full bg-bull" style={{ width: `${advPct}%` }} />
        <div className="h-full bg-muted-foreground/50" style={{ width: `${uncPct}%` }} />
      </div>
      <p className="mt-2 text-muted-foreground">
        Advance/decline ratio <span className="font-mono tabular-nums text-foreground">{ratioDisplay}</span>
      </p>

      <table className="mt-3 w-full">
        <tbody>
          <SmaRow label="Above 20-day SMA" pct={data.pctAboveSma20} above={data.aboveSma20} eligible={data.sma20Eligible} />
          <SmaRow label="Above 50-day SMA" pct={data.pctAboveSma50} above={data.aboveSma50} eligible={data.sma50Eligible} />
          <SmaRow label="Above 200-day SMA" pct={data.pctAboveSma200} above={data.aboveSma200} eligible={data.sma200Eligible} />
        </tbody>
      </table>
    </section>
  );
}

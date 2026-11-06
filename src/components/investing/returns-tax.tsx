import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SignedOutNotice } from "@/components/common/signed-out-notice";
import { SESSION_EXPIRED_MESSAGE } from "@/components/common/sign-in-required";
import { useSignedIn } from "@/hooks/use-signed-in";
import { AuthenticationError, createQueryProcedure } from "@/lib/trpc";
import type { PaperInvestingReport } from "../../../server/modules/paper-trading/investing-report";
import { CapitalGainsBuckets, CapitalGainsFigures, Figure } from "./capital-gains-summary";
import { percent, rupees, serverMarkLabel } from "./display";

const reportProcedure = createQueryProcedure<{ financialYearStart?: number }, PaperInvestingReport>("paperTrading.investingReport");

export function ReturnsTaxSection() {
  const signedIn = useSignedIn();
  const [financialYearStart, setFinancialYearStart] = useState<number>();
  const query = useQuery({
    queryKey: ["paperTrading", "investingReport", financialYearStart],
    queryFn: () => reportProcedure.query({ financialYearStart }),
    enabled: signedIn, staleTime: 30_000, retry: 1,
  });
  const report = signedIn ? query.data : undefined;
  const tax = report?.tax;
  return <section aria-labelledby="returns-tax-heading" className="mb-6 border-y border-border bg-panel px-4 py-3 text-xs">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 id="returns-tax-heading" className="text-sm font-semibold">Returns &amp; tax</h2>
      {report && <label className="flex items-center gap-2 text-muted-foreground">Financial year
        <select aria-label="Financial year" value={financialYearStart ?? report.financialYears[0]} onChange={(e) => setFinancialYearStart(Number(e.target.value))}
          className="rounded border border-border bg-background px-2 py-1 font-mono text-foreground">
          {report.financialYears.map((year) => <option key={year} value={year}>{year}–{String(year + 1).slice(-2)}</option>)}
        </select>
      </label>}
    </div>
    {!signedIn ? <div className="mt-2"><SignedOutNotice feature="Portfolio returns and tax estimates" /></div>
      : query.isPending ? <p className="mt-2 text-muted-foreground" role="status">Loading returns and tax estimate…</p>
      : query.error instanceof AuthenticationError ? <p className="mt-2 text-amber-400" role="status">{SESSION_EXPIRED_MESSAGE}</p>
      : query.error ? <p className="mt-2 text-bear" role="status">Returns and tax unavailable: {query.error.message}</p>
      : !report?.account ? <p className="mt-2 text-muted-foreground">No paper account yet. Place your first paper trade to start recording returns.</p>
      : tax && <>
        <div className="mt-2 grid gap-x-8 md:grid-cols-3">
          <dl><Figure label="Portfolio XIRR · annualised" value={percent(report.portfolioXirr)} />
            <Figure label="Equity · server marks" value={rupees(report.account.equity)} />
            <div className="mt-1 text-[11px] text-muted-foreground">Since {report.account.startedAt} · generation {report.account.generation}. {report.xirrReason}
              {report.stalePrices && <span className="text-amber-400"> Equity uses stale or entry prices.</span>}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">{serverMarkLabel(report.valuationAsOf)}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">XIRR uses server marks; the live total below uses browser quotes and can differ.</p>
          </dl>
          <CapitalGainsFigures tax={tax} />
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">Estimate for a paper account, not tax advice. Surcharge depends on total income and is not computed.</p>
        <details className="mt-2 text-[11px] text-muted-foreground"><summary className="cursor-pointer text-foreground">Calculation &amp; assumptions</summary>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            <li>XIRR uses initial cash as an outflow and server-marked equity as an inflow, on IST dates (actual days / 365). Server marks can differ from browser live quotes. Fees and realised P&amp;L are already in cash.</li>
            {tax.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}
          </ul>
          <CapitalGainsBuckets tax={tax} />
          {report.closedLots.length > 0 && <div className="mt-3 overflow-x-auto">
            <table className="w-full whitespace-nowrap text-left"><caption className="mb-1 text-left">Closed FIFO lots · selected FY, current generation · gross XIRR excludes charges; shorts have no invested-capital XIRR</caption>
              <thead><tr className="border-b border-border"><th className="py-1 pr-3">Symbol</th><th className="pr-3">Entry → exit</th><th className="pr-3">Qty</th><th className="pr-3">P&amp;L</th><th>XIRR</th></tr></thead>
              <tbody>{report.closedLots.map((lot, index) => <tr key={`${lot.entryFillId}-${lot.exitFillId}-${index}`} className="border-b border-border/40 font-mono tabular-nums">
                <td className="py-1 pr-3">{lot.symbol} · {lot.kind}</td><td className="pr-3">{lot.entryDate} → {lot.exitDate}</td><td className="pr-3">{lot.quantity}</td><td className="pr-3">{rupees(lot.grossPnl)}</td><td>{percent(lot.xirr)}</td>
              </tr>)}</tbody>
            </table>
          </div>}
        </details>
      </>}
  </section>;
}

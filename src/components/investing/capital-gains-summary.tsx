import type { CapitalGainsReport } from "@shared/domain/investing/capital-gains";
import { percent, rupees } from "./display";

export function Figure({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-3 border-b border-border/40 py-1.5 last:border-0">
    <dt className="text-muted-foreground">{label}</dt><dd className="font-mono tabular-nums">{value}</dd>
  </div>;
}

/** Realised gains and the estimated tax of one FY: two columns for the caller's grid. */
export function CapitalGainsFigures({ tax }: { tax: CapitalGainsReport }) {
  return <>
    <dl><Figure label="Realised STCG" value={rupees(tax.grossStcg)} />
      <Figure label="Realised LTCG" value={rupees(tax.grossLtcg)} />
      <Figure label="LTCG exemption used" value={rupees(tax.exemptionUsed)} />
    </dl>
    <dl><Figure label="Estimated capital-gains tax" value={rupees(tax.estimatedTax)} />
      <Figure label="Includes 4% cess" value={rupees(tax.cess)} />
      <Figure label="Intraday P&L / turnover" value={`${rupees(tax.intradayPnl)} / ${rupees(tax.intradayTurnover)}`} />
      <p className="mt-1 text-[11px] text-muted-foreground">Intraday: taxed at your slab rate, not included above.</p>
      {tax.overnightShortPnl !== 0 && <Figure label="Non-delivery short P&L · slab" value={rupees(tax.overnightShortPnl)} />}
    </dl>
  </>;
}

/** Per-bucket set-off and exemption trail behind the estimated tax. */
export function CapitalGainsBuckets({ tax }: { tax: CapitalGainsReport }) {
  return <>
    <div className="mt-3 overflow-x-auto">
      <table className="w-full whitespace-nowrap text-left">
        <caption className="mb-1 text-left">Tax calculation · gains − loss set-off − exemption = taxable; losses and the LTCG exemption go to the highest rate first</caption>
        <thead><tr className="border-b border-border"><th className="py-1 pr-3">Bucket / rate</th><th className="pr-3">Gains</th><th className="pr-3">Losses</th><th className="pr-3">Loss set-off</th><th className="pr-3">Exemption</th><th className="pr-3">Taxable</th><th>Tax</th></tr></thead>
        <tbody>{tax.buckets.map((bucket) => <tr key={`${bucket.term}-${bucket.regime}`} className="border-b border-border/40 font-mono tabular-nums">
          <td className="py-1 pr-3">{bucket.term} · {percent(bucket.rate)}</td><td className="pr-3">{rupees(bucket.grossGains)}</td><td className="pr-3">{rupees(bucket.grossLosses)}</td><td className="pr-3">{rupees(bucket.lossOffset)}</td>
          <td className="pr-3">{rupees(bucket.exemptionUsed)}</td><td className="pr-3">{rupees(bucket.taxableGain)}</td><td>{rupees(bucket.tax)}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {(tax.unabsorbedStcl > 0 || tax.unabsorbedLtcl > 0) && <p className="mt-2">Unabsorbed losses: STCL {rupees(tax.unabsorbedStcl)}, LTCL {rupees(tax.unabsorbedLtcl)}. Carry-forward is not computed.</p>}
  </>;
}

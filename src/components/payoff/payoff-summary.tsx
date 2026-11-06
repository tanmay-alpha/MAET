import type { ReactNode } from "react";
import type { ExpiryProfile, PositionGreeks } from "@shared/domain/options/payoff";
import { formatPrice, formatRupees, formatSignedRupees, pnlTone } from "./format";

interface PayoffSummaryProps {
  profile: ExpiryProfile;
  netPremium: number;
  greeks: PositionGreeks;
}

function Stat({
  label,
  children,
  title,
  className = "",
}: {
  label: string;
  children: ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <div className={`flex min-w-0 flex-col gap-0.5 px-3 py-2 ${className}`} title={title}>
      <dt className="text-tv-caps text-muted-foreground">{label}</dt>
      <dd className="truncate font-mono text-xs tabular-nums">{children}</dd>
    </div>
  );
}

/** "1 : 0.67" means risking ₹1 to make ₹0.67 at best; only defined when both sides are bounded. */
function riskReward({ maxProfit, maxLoss }: ExpiryProfile): string {
  if (!Number.isFinite(maxProfit) || !Number.isFinite(maxLoss) || maxProfit <= 0 || maxLoss >= 0) return "—";
  return `1 : ${(maxProfit / -maxLoss).toFixed(2)}`;
}

export function PayoffSummary({ profile, netPremium, greeks }: PayoffSummaryProps) {
  const { maxProfit, maxLoss, breakevens } = profile;
  return (
    <section aria-labelledby="payoff-summary-heading" className="rounded border border-border bg-panel">
      <h2 id="payoff-summary-heading" className="border-b border-border px-3 py-2 text-xs font-semibold">
        Summary <span className="font-normal text-muted-foreground">· at expiry, Greeks today</span>
      </h2>
      <dl className="grid grid-cols-2 border-b border-border/60 sm:grid-cols-3">
        <Stat label="Max profit">
          <span className={Number.isFinite(maxProfit) ? pnlTone(maxProfit) : "text-bull"}>
            {Number.isFinite(maxProfit) ? formatRupees(maxProfit) : "Unlimited"}
          </span>
        </Stat>
        <Stat label="Max loss">
          <span className={Number.isFinite(maxLoss) ? pnlTone(maxLoss) : "text-bear"}>
            {Number.isFinite(maxLoss) ? formatRupees(Math.min(maxLoss, 0)) : "Unlimited"}
          </span>
        </Stat>
        <Stat label={netPremium >= 0 ? "Net credit" : "Net debit"}>
          <span className={pnlTone(netPremium)}>{formatRupees(Math.abs(netPremium))}</span>
        </Stat>
        <Stat label="Risk : reward" title="Rupees at risk : best-case rupees made">
          {riskReward(profile)}
        </Stat>
        <Stat label="Breakevens" className="col-span-2">
          {breakevens.length > 0 ? breakevens.map((price) => formatPrice(price)).join(" · ") : "None"}
        </Stat>
      </dl>
      <dl className="grid grid-cols-4">
        <Stat label="Delta" title="Underlying-equivalent units">
          {formatPrice(greeks.delta, 1)}
        </Stat>
        <Stat label="Gamma" title="Change in delta per 1-point move">
          {formatPrice(greeks.gamma, 3)}
        </Stat>
        <Stat label="Theta / day">
          <span className={pnlTone(greeks.theta)}>{formatSignedRupees(greeks.theta)}</span>
        </Stat>
        <Stat label="Vega / IV pt">
          <span className={pnlTone(greeks.vega)}>{formatSignedRupees(greeks.vega)}</span>
        </Stat>
      </dl>
    </section>
  );
}

import React from "react";
import * as RechartsPrimitive from "recharts";
import { cn } from "@/lib/utils";
import { calculateStrategyPayoff } from "@/lib/greeks";

interface PayoffGraphProps {
  legs: Array<{ type: "call" | "put"; strike: number; premium: number; quantity: number }>;
  underlyingPrice: number;
}

export function PayoffGraph({ legs, underlyingPrice }: PayoffGraphProps) {
  // Generate spot prices around the underlying
  const minStrike = Math.min(...legs.map(l => l.strike));
  const maxStrike = Math.max(...legs.map(l => l.strike));
  const range = maxStrike - minStrike || 100;
  const spotMin = Math.max(0, minStrike - range * 0.3);
  const spotMax = maxStrike + range * 0.3;

  const numPoints = 100;
  const step = (spotMax - spotMin) / numPoints;
  const spotPrices = Array.from({ length: numPoints + 1 }, (_, i) => spotMin + i * step);

  const data = calculateStrategyPayoff(legs, spotPrices);

  const maxPayoff = Math.max(...data.map(d => d.payoff));
  const minPayoff = Math.min(...data.map(d => d.payoff));

  const zeroIndex = data.findIndex(d => d.spot >= underlyingPrice);
  const breakevenIndex = data.findIndex(d => d.payoff >= 0 && (data[d.spot <= underlyingPrice ? d.spot : 0]?.payoff || 0) < 0);
  // Find actual breakeven points
  const breakevenPoints: number[] = [];
  for (let i = 1; i < data.length; i++) {
    if ((data[i].payoff >= 0 && data[i - 1].payoff < 0) || (data[i].payoff <= 0 && data[i - 1].payoff > 0)) {
      // Linear interpolation for more accurate breakeven
      const ratio = Math.abs(data[i - 1].payoff) / (Math.abs(data[i - 1].payoff) + Math.abs(data[i].payoff));
      const breakeven = data[i - 1].spot + ratio * (data[i].spot - data[i - 1].spot);
      breakevenPoints.push(breakeven);
    }
  }

  const netPremium = legs.reduce((sum, leg) => sum + leg.premium * leg.quantity, 0);
  const isNetDebit = netPremium > 0;

  return (
    <div className="rounded-lg border border-border bg-panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-medium">Payoff at Expiry</div>
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5">
            <div className="h-0.5 w-3 bg-primary"></div>
            <span className="text-muted-foreground">P&L</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-0.5 w-3 bg-bull/50" style={{ borderBottom: "1px dashed #22c55e" }}></div>
            <span className="text-muted-foreground">Spot</span>
          </div>
          {breakevenPoints.map((be, i) => (
            <span key={i} className="text-muted-foreground">
              BE: ₹{be.toFixed(2)}
            </span>
          ))}
        </div>
      </div>

      <div className="relative h-[300px] w-full">
        <RechartsPrimitive.ResponsiveContainer width="100%" height="100%">
          <RechartsPrimitive.LineChart data={data} margin={{ top: 10, right: 30, left: 20, bottom: 30 }}>
            <RechartsPrimitive.CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <RechartsPrimitive.XAxis
              dataKey="spot"
              type="number"
              domain={[spotMin, spotMax]}
              tickFormatter={(v) => `₹${v.toFixed(0)}`}
              className="text-xs"
              stroke="currentColor"
              tick={{ fill: "var(--color-muted-foreground)", fontSize: 10 }}
              label={{ value: "Spot Price", position: "insideBottom", offset: -10, className: "text-xs fill-muted-foreground" }}
            />
            <RechartsPrimitive.YAxis
              domain={[
                Math.min(minPayoff - 1000, -netPremium * 100 * 1.2),
                Math.max(maxPayoff + 1000, 1000),
              ]}
              tickFormatter={(v) => `${v >= 0 ? "" : ""}₹${(v / 1000).toFixed(0)}K`}
              className="text-xs"
              stroke="currentColor"
              tick={{ fill: "var(--color-muted-foreground)", fontSize: 10 }}
              label={{ value: "P&L (₹)", angle: -90, position: "insideLeft", offset: 10, className: "text-xs fill-muted-foreground" }}
            />
            <RechartsPrimitive.Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const point = payload[0].payload;
                return (
                  <div className="rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
                    <div className="font-medium">Spot: ₹{point.spot.toFixed(2)}</div>
                    <div className={`font-mono ${point.payoff >= 0 ? "text-bull" : "text-bear"}`}>
                      P&L: ₹{point.payoff.toFixed(2)}
                    </div>
                  </div>
                );
              }}
            />
            <RechartsPrimitive.ReferenceLine
              y={0}
              stroke="var(--color-muted-foreground)"
              strokeDasharray="3 3"
              strokeOpacity={0.5}
            />
            <RechartsPrimitive.ReferenceLine
              x={underlyingPrice}
              stroke="var(--color-primary)"
              strokeOpacity={0.6}
              strokeWidth={1.5}
              label={{
                value: `Spot ₹${underlyingPrice.toFixed(0)}`,
                position: "top",
                className: "text-xs fill-primary",
              }}
            />
            <RechartsPrimitive.Line
              dataKey="payoff"
              stroke="var(--color-primary)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: "var(--color-primary)" }}
            />
          </RechartsPrimitive.LineChart>
        </RechartsPrimitive.ResponsiveContainer>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-3 text-xs">
        <div className="rounded border border-border bg-background p-2 text-center">
          <div className="text-muted-foreground">Net Premium</div>
          <div className={`font-mono font-semibold ${isNetDebit ? "text-bear" : "text-bull"}`}>
            {isNetDebit ? "-" : "+"}₹{(Math.abs(netPremium) * 100).toLocaleString("en-IN")}
          </div>
        </div>
        <div className="rounded border border-border bg-background p-2 text-center">
          <div className="text-muted-foreground">Max Profit</div>
          <div className={`font-mono font-semibold ${maxPayoff >= 0 ? "text-bull" : "text-bear"}`}>
            {maxPayoff === Infinity ? "Unlimited" : `₹${maxPayoff.toLocaleString("en-IN")}`}
          </div>
        </div>
        <div className="rounded border border-border bg-background p-2 text-center">
          <div className="text-muted-foreground">Max Loss</div>
          <div className={`font-mono font-semibold ${minPayoff <= 0 ? "text-bear" : "text-bull"}`}>
            {minPayoff === -Infinity ? "Unlimited" : `₹${minPayoff.toLocaleString("en-IN")}`}
          </div>
        </div>
        <div className="rounded border border-border bg-background p-2 text-center">
          <div className="text-muted-foreground">Risk/Reward</div>
          <div className="font-mono font-semibold">
            {Math.abs(minPayoff) > 0 ? (maxPayoff / Math.abs(minPayoff)).toFixed(2) : "—"} : 1
          </div>
        </div>
      </div>
    </div>
  );
}
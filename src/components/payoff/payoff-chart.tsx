import { useId, useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import { payoffAtExpiry, pnlAfterDays, type Leg } from "@shared/domain/options/payoff";
import { formatPrice, formatSignedRupees, pnlTone } from "./format";

interface PayoffChartProps {
  legs: Leg[];
  lotSize: number;
  spot: number;
  daysToExpiry: number;
  rate: number;
  /** Decimal, already including any IV shift. */
  volatility: number;
  breakevens: number[];
  height: number;
}

interface PayoffPoint {
  price: number;
  expiry: number;
  today: number;
}

const SAMPLES = 240;

const compactRupees = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 });

function axisRupees(value: number): string {
  const text = compactRupees.format(Math.abs(value));
  return `${value < 0 ? "\u2212" : ""}₹${text}`;
}

/**
 * Price range that shows every strike, breakeven and the spot with room either side, so a
 * far wing or breakeven is never cut off.
 */
function priceRange(spot: number, legs: Leg[], breakevens: number[]): [number, number] {
  const anchors = [spot, ...legs.map((leg) => leg.strike), ...breakevens];
  const low = Math.min(...anchors);
  const high = Math.max(...anchors);
  const pad = Math.max(spot * 0.03, (high - low) * 0.25);
  return [Math.max(low - pad, spot * 0.01), high + pad];
}

/** About `count` ticks on a 1-2-2.5-5 × 10ⁿ grid, so the axis reads 23,500 / 24,000, not 23,430. */
function roundTicks(low: number, high: number, count: number): number[] {
  const rough = (high - low) / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((multiple) => multiple * magnitude).find((candidate) => candidate >= rough)!;
  const first = Math.ceil(low / step);
  const last = Math.floor(high / step);
  return Array.from({ length: last - first + 1 }, (_, index) => (first + index) * step);
}

/**
 * Breakeven labels sit just inside the plot, on the side of their line away from spot,
 * so they never collide with the spot label or with each other across the spot line.
 */
function breakevenLabel(price: number, spot: number, index: number) {
  const awayFromSpot = price < spot ? -1 : 1;
  return function BreakevenLabel({ viewBox }: { viewBox?: { x?: number; y?: number } }) {
    if (viewBox?.x === undefined || viewBox.y === undefined) return <g />;
    return (
      <text
        x={viewBox.x + awayFromSpot * 4}
        y={viewBox.y + 12 + (index % 2) * 12}
        textAnchor={awayFromSpot < 0 ? "end" : "start"}
        fill="var(--color-foreground)"
        fontSize={10}
        fontFamily="var(--font-mono)"
      >
        BE {formatPrice(price, 0)}
      </text>
    );
  };
}

export function PayoffChart({ legs, lotSize, spot, daysToExpiry, rate, volatility, breakevens, height }: PayoffChartProps) {
  const fillId = `payoff-fill-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [hovered, setHovered] = useState<PayoffPoint | null>(null);

  const { points, range, split } = useMemo(() => {
    const [low, high] = priceRange(spot, legs, breakevens);
    // Sample evenly, plus the exact strikes and breakevens so kinks and zero crossings stay sharp.
    const prices = Array.from({ length: SAMPLES + 1 }, (_, index) => low + ((high - low) * index) / SAMPLES);
    for (const price of [...legs.map((leg) => leg.strike), ...breakevens, spot]) {
      if (price > low && price < high) prices.push(price);
    }
    prices.sort((a, b) => a - b);
    const scenario = { daysToExpiry, daysForward: 0, rate, volatility };
    const sampled: PayoffPoint[] = prices.map((price) => ({
      price,
      expiry: payoffAtExpiry(legs, price, lotSize),
      today: pnlAfterDays(legs, { ...scenario, underlying: price }, lotSize),
    }));
    const top = Math.max(0, ...sampled.map((point) => point.expiry));
    const bottom = Math.min(0, ...sampled.map((point) => point.expiry));
    // The fill gradient runs over the area's own box (from its peak to its trough, zero
    // included), so this offset is where the expiry curve crosses zero.
    return { points: sampled, range: [low, high] as const, split: top === bottom ? 1 : top / (top - bottom) };
  }, [legs, lotSize, spot, daysToExpiry, rate, volatility, breakevens]);

  const visibleBreakevens = breakevens.filter((price) => price > range[0] && price < range[1]);
  const priceTicks = roundTicks(range[0], range[1], height < 300 ? 4 : 7);

  return (
    <div
      role="img"
      aria-label={`Payoff chart: expiry and today P&L from ${formatPrice(range[0], 0)} to ${formatPrice(range[1], 0)}`}
      className="w-full select-none"
      style={{ height }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={points}
          margin={{ top: 26, right: 12, bottom: 0, left: 0 }}
          onMouseMove={(state) => setHovered((state?.activePayload?.[0]?.payload as PayoffPoint | undefined) ?? null)}
          onMouseLeave={() => setHovered(null)}
        >
          <defs>
            <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
              <stop offset={split} stopColor="var(--color-bull)" stopOpacity={0.16} />
              <stop offset={split} stopColor="var(--color-bear)" stopOpacity={0.16} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--color-grid)" strokeDasharray="2 4" />
          <XAxis
            type="number"
            dataKey="price"
            domain={[range[0], range[1]]}
            allowDataOverflow
            ticks={priceTicks}
            tickFormatter={(value: number) => formatPrice(value, 0)}
            stroke="var(--color-muted-foreground)"
            tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
            tickLine={false}
          />
          <YAxis
            width={58}
            tickFormatter={axisRupees}
            stroke="var(--color-muted-foreground)"
            tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
            tickLine={false}
          />
          <Area
            type="linear"
            dataKey="expiry"
            baseValue={0}
            stroke="none"
            fill={`url(#${fillId})`}
            fillOpacity={1}
            isAnimationActive={false}
            activeDot={false}
          />
          <ReferenceLine y={0} stroke="var(--color-muted-foreground)" strokeOpacity={0.7} />
          <ReferenceLine
            x={spot}
            stroke="var(--color-primary)"
            label={{ value: `Spot ${formatPrice(spot, 0)}`, position: "top", fill: "var(--color-primary)", fontSize: 10 }}
          />
          {visibleBreakevens.map((price, index) => (
            <ReferenceLine
              key={price}
              x={price}
              stroke="var(--color-muted-foreground)"
              strokeDasharray="2 3"
              label={breakevenLabel(price, spot, index)}
            />
          ))}
          {hovered && (
            <ReferenceLine y={hovered.expiry} stroke="var(--color-muted-foreground)" strokeDasharray="1 3" />
          )}
          <Line
            type="linear"
            dataKey="today"
            stroke="var(--color-primary)"
            strokeWidth={1.25}
            strokeDasharray="5 4"
            dot={false}
            activeDot={{ r: 3, fill: "var(--color-primary)", stroke: "none" }}
            isAnimationActive={false}
          />
          <Line
            type="linear"
            dataKey="expiry"
            stroke="var(--color-foreground)"
            strokeWidth={1.5}
            dot={false}
            activeDot={{ r: 3, fill: "var(--color-foreground)", stroke: "none" }}
            isAnimationActive={false}
          />
          <Tooltip
            content={<PayoffTooltip />}
            cursor={{ stroke: "var(--color-muted-foreground)", strokeDasharray: "3 3" }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function PayoffTooltip({ active, payload }: TooltipProps<number, string>) {
  const point = payload?.[0]?.payload as PayoffPoint | undefined;
  if (!active || !point) return null;
  return (
    <div className="space-y-0.5 rounded border border-border bg-panel-elevated px-2 py-1.5 font-mono text-[11px] tabular-nums shadow-sm">
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">Underlying</span>
        <span>{formatPrice(point.price)}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">At expiry</span>
        <span className={pnlTone(point.expiry)}>{formatSignedRupees(point.expiry)}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">Today</span>
        <span className={pnlTone(point.today)}>{formatSignedRupees(point.today)}</span>
      </div>
    </div>
  );
}

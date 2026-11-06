import { pnlAfterDays, type Leg } from "@shared/domain/options/payoff";
import { IV_SHIFT_LIMIT } from "@/lib/payoff-lab-state";
import { formatPrice, formatSignedRupees, pnlTone } from "./format";

interface ScenarioGridProps {
  legs: Leg[];
  lotSize: number;
  spot: number;
  daysToExpiry: number;
  rate: number;
  /** Entered IV as a decimal, before the shift. */
  baseVolatility: number;
  /** Decimal, after the shift. */
  volatility: number;
  ivShift: number;
  onIvShiftChange: (shift: number) => void;
}

const SPOT_MOVES_PCT = [-10, -5, -3, -1, 0, 1, 3, 5, 10];

function dayColumns(daysToExpiry: number): number[] {
  const days = [0, 1, Math.round(daysToExpiry / 2), daysToExpiry].filter((day) => day <= daysToExpiry);
  return [...new Set(days)];
}

function dayLabel(day: number, daysToExpiry: number): string {
  if (day === daysToExpiry) return "Expiry";
  if (day === 0) return "Today";
  return `+${day}d`;
}

export function ScenarioGrid({
  legs,
  lotSize,
  spot,
  daysToExpiry,
  rate,
  baseVolatility,
  volatility,
  ivShift,
  onIvShiftChange,
}: ScenarioGridProps) {
  const days = dayColumns(daysToExpiry);
  return (
    <section aria-labelledby="payoff-scenario-heading" className="rounded border border-border bg-panel">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-3 py-2">
        <h2 id="payoff-scenario-heading" className="text-xs font-semibold">
          Scenarios <span className="font-normal text-muted-foreground">· P&amp;L by spot move and day</span>
        </h2>
        <label className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">IV shift</span>
          <input
            type="range"
            min={-IV_SHIFT_LIMIT}
            max={IV_SHIFT_LIMIT}
            step={1}
            value={ivShift}
            onChange={(event) => onIvShiftChange(Number(event.target.value))}
            className="w-32 accent-primary"
          />
          <span className="w-24 text-right font-mono tabular-nums">
            {ivShift > 0 ? "+" : ""}
            {ivShift} pt · {formatPrice(volatility * 100, 1)}%
          </span>
          {ivShift !== 0 && (
            <button
              type="button"
              onClick={() => onIvShiftChange(0)}
              className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
              title={`Back to ${formatPrice(baseVolatility * 100, 1)}%`}
            >
              Reset
            </button>
          )}
        </label>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[360px] border-collapse text-xs">
          <thead className="text-tv-caps text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium sm:px-3">Spot</th>
              {days.map((day) => (
                <th key={day} className="whitespace-nowrap px-2 py-1.5 text-right font-medium sm:px-3">
                  {dayLabel(day, daysToExpiry)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SPOT_MOVES_PCT.map((move) => {
              const underlying = spot * (1 + move / 100);
              return (
                <tr key={move} className={`border-t border-border/60 hover:bg-accent/30 ${move === 0 ? "bg-accent/20" : ""}`}>
                  <th scope="row" className="whitespace-nowrap px-2 py-1 text-left font-mono font-normal tabular-nums sm:px-3">
                    <span className="inline-block w-10">{move > 0 ? `+${move}%` : move < 0 ? `\u2212${-move}%` : "0%"}</span>
                    <span className="text-muted-foreground">{formatPrice(underlying, 0)}</span>
                  </th>
                  {days.map((day) => {
                    const pnl = pnlAfterDays(
                      legs,
                      { underlying, daysToExpiry, daysForward: day, rate, volatility },
                      lotSize,
                    );
                    return (
                      <td key={day} className={`whitespace-nowrap px-2 py-1 text-right font-mono tabular-nums sm:px-3 ${pnlTone(pnl)}`}>
                        {formatSignedRupees(pnl)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

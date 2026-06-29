import { useState, useMemo } from "react";
import { Plus, Trash2, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { PayoffGraph } from "./payoff-graph";
import { calculateGreeks, Greeks } from "@/lib/greeks";
import { cn } from "@/lib/utils";

export interface StrategyLeg {
  id: string;
  type: "call" | "put";
  action: "buy" | "sell";
  strike: number;
  premium: number;
  quantity: number;
  expiry: Date;
}

interface StrategyBuilderProps {
  underlying: string;
  spot: number;
  onStrategyChange?: (legs: StrategyLeg[], greeks: Greeks | null) => void;
}

type PresetLeg = Pick<StrategyLeg, "type" | "action" | "strike" | "premium" | "quantity">;

const PRESET_STRATEGIES: Array<{
  id: string;
  name: string;
  description: string;
  legs: (spot: number, _expiry: Date) => PresetLeg[];
}> = [
  {
    id: "straddle",
    name: "Straddle",
    description: "Buy/Sell ATM Call + ATM Put at same strike",
    legs: (spot: number) => [
      { type: "call", action: "buy", strike: Math.round(spot / 50) * 50, premium: 0, quantity: 1 },
      { type: "put", action: "buy", strike: Math.round(spot / 50) * 50, premium: 0, quantity: 1 },
    ],
  },
  {
    id: "strangle",
    name: "Strangle",
    description: "Buy/Sell OTM Call + OTM Put",
    legs: (spot: number) => [
      { type: "call", action: "buy", strike: Math.round((spot * 1.05) / 50) * 50, premium: 0, quantity: 1 },
      { type: "put", action: "buy", strike: Math.round((spot * 0.95) / 50) * 50, premium: 0, quantity: 1 },
    ],
  },
  {
    id: "iron_condor",
    name: "Iron Condor",
    description: "Sell OTM Call Spread + Sell OTM Put Spread",
    legs: (spot: number) => [
      { type: "put", action: "buy", strike: Math.round((spot * 0.90) / 50) * 50, premium: 0, quantity: 1 },
      { type: "put", action: "sell", strike: Math.round((spot * 0.95) / 50) * 50, premium: 0, quantity: 1 },
      { type: "call", action: "sell", strike: Math.round((spot * 1.05) / 50) * 50, premium: 0, quantity: 1 },
      { type: "call", action: "buy", strike: Math.round((spot * 1.10) / 50) * 50, premium: 0, quantity: 1 },
    ],
  },
  {
    id: "bull_call_spread",
    name: "Bull Call Spread",
    description: "Buy lower strike Call, Sell higher strike Call",
    legs: (spot: number) => [
      { type: "call", action: "buy", strike: Math.round(spot / 50) * 50, premium: 0, quantity: 1 },
      { type: "call", action: "sell", strike: Math.round((spot * 1.05) / 50) * 50, premium: 0, quantity: 1 },
    ],
  },
  {
    id: "bear_put_spread",
    name: "Bear Put Spread",
    description: "Buy higher strike Put, Sell lower strike Put",
    legs: (spot: number) => [
      { type: "put", action: "buy", strike: Math.round(spot / 50) * 50, premium: 0, quantity: 1 },
      { type: "put", action: "sell", strike: Math.round((spot * 0.95) / 50) * 50, premium: 0, quantity: 1 },
    ],
  },
];

function generateId() {
  return Math.random().toString(36).substring(2, 9);
}

export function StrategyBuilder({ underlying, spot, onStrategyChange }: StrategyBuilderProps) {
  const [legs, setLegs] = useState<StrategyLeg[]>([]);
  const [expiry] = useState(() => {
    const date = new Date();
    // Next Thursday (NSE weekly expiry)
    const daysUntilThursday = (4 - date.getDay() + 7) % 7 || 7;
    date.setDate(date.getDate() + daysUntilThursday);
    return date;
  });

  const totalGreeks = useMemo<Greeks | null>(() => {
    if (legs.length === 0) return null;

    const greeks = { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0, iv: 0.2 };

    legs.forEach((leg) => {
      const multiplier = leg.action === "buy" ? 1 : -1;
      const lotMultiplier = leg.quantity * 100;

      const legGreeks = calculateGreeks({
        strike: leg.strike,
        spot,
        expiry: leg.expiry,
        type: leg.type,
        iv: 0.2,
      });

      greeks.delta += legGreeks.delta * multiplier * lotMultiplier;
      greeks.gamma += legGreeks.gamma * multiplier * lotMultiplier;
      greeks.theta += legGreeks.theta * multiplier * lotMultiplier;
      greeks.vega += legGreeks.vega * multiplier * lotMultiplier;
      greeks.rho += legGreeks.rho * multiplier * lotMultiplier;
    });

    onStrategyChange?.(legs, greeks);
    return greeks;
  }, [legs, spot, onStrategyChange]);

  const addLeg = () => {
    setLegs([
      ...legs,
      {
        id: generateId(),
        type: "call",
        action: "buy",
        strike: Math.round(spot / 50) * 50,
        premium: 0,
        quantity: 1,
        expiry,
      },
    ]);
  };

  const removeLeg = (id: string) => {
    setLegs(legs.filter((l) => l.id !== id));
  };

  const updateLeg = (id: string, updates: Partial<StrategyLeg>) => {
    setLegs(legs.map((l) => (l.id === id ? { ...l, ...updates } : l)));
  };

  const applyPreset = (presetId: string) => {
    const preset = PRESET_STRATEGIES.find((p) => p.id === presetId);
    if (!preset) return;

    const presetLegs = preset.legs(spot, expiry);
    setLegs(
      presetLegs.map((l) => ({
        id: generateId(),
        ...l,
        expiry,
      }))
    );
  };

  const netPremium = legs.reduce((sum, leg) => {
    const sign = leg.action === "buy" ? -1 : 1;
    return sum + sign * leg.premium * leg.quantity * 100;
  }, 0);

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      {/* Preset strategies */}
      <div className="flex flex-wrap gap-2">
        <span className="text-xs text-muted-foreground">Quick presets:</span>
        {PRESET_STRATEGIES.map((preset) => (
          <button
            type="button"
            key={preset.id}
            onClick={() => applyPreset(preset.id)}
            className="rounded border border-border bg-panel px-2 py-1 text-xs text-muted-foreground hover:border-primary hover:text-foreground"
            title={preset.description}
            aria-label={`Apply ${preset.name} preset: ${preset.description}`}
          >
            {preset.name}
          </button>
        ))}
      </div>

      {/* Strategy legs */}
      <div className="flex-1 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">Strategy Legs</div>
          <button
            type="button"
            onClick={addLeg}
            className="flex items-center gap-1 rounded border border-dashed border-border px-2 py-1 text-xs text-muted-foreground hover:border-primary hover:text-primary"
          >
            <Plus className="h-3 w-3" /> Add Leg
          </button>
        </div>

        {legs.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-panel p-8 text-center">
            <div className="text-sm text-muted-foreground">
              No legs added. Use presets or add individual legs.
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {legs.map((leg, index) => (
              <div
                key={leg.id}
                className="flex items-center gap-3 rounded-lg border border-border bg-panel p-3"
              >
                <div className="flex h-6 w-6 items-center justify-center rounded bg-muted text-xs font-medium">
                  {index + 1}
                </div>

                {/* Action */}
                <select
                  value={leg.action}
                  onChange={(e) => updateLeg(leg.id, { action: e.target.value as "buy" | "sell" })}
                  aria-label={`Select action for leg ${index + 1}`}
                  className={cn(
                    "rounded border bg-background px-2 py-1 text-xs",
                    leg.action === "buy" ? "border-bull/50 text-bull" : "border-bear/50 text-bear"
                  )}
                >
                  <option value="buy">BUY</option>
                  <option value="sell">SELL</option>
                </select>

                {/* Type */}
                <select
                  value={leg.type}
                  onChange={(e) => updateLeg(leg.id, { type: e.target.value as "call" | "put" })}
                  aria-label={`Select option type for leg ${index + 1}`}
                  className="rounded border border-border bg-background px-2 py-1 text-xs"
                >
                  <option value="call">CALL</option>
                  <option value="put">PUT</option>
                </select>

                {/* Strike */}
                <div className="flex items-center gap-1">
                  <label className="text-xs text-muted-foreground" htmlFor={`strike-${leg.id}`}>@</label>
                  <input
                    id={`strike-${leg.id}`}
                    type="number"
                    value={leg.strike}
                    onChange={(e) => updateLeg(leg.id, { strike: Number(e.target.value) })}
                    aria-label={`Strike price for leg ${index + 1}`}
                    className="w-20 rounded border border-border bg-background px-2 py-1 text-xs font-mono"
                  />
                </div>

                {/* Premium */}
                <div className="flex items-center gap-1">
                  <label className="text-xs text-muted-foreground" htmlFor={`premium-${leg.id}`}>Rs.</label>
                  <input
                    id={`premium-${leg.id}`}
                    type="number"
                    value={leg.premium}
                    onChange={(e) => updateLeg(leg.id, { premium: Number(e.target.value) })}
                    step="0.5"
                    aria-label={`Premium for leg ${index + 1}`}
                    className="w-16 rounded border border-border bg-background px-2 py-1 text-xs font-mono"
                  />
                </div>

                {/* Qty */}
                <div className="flex items-center gap-1">
                  <label className="text-xs text-muted-foreground" htmlFor={`qty-${leg.id}`}>x</label>
                  <input
                    id={`qty-${leg.id}`}
                    type="number"
                    value={leg.quantity}
                    onChange={(e) => updateLeg(leg.id, { quantity: Number(e.target.value) })}
                    min="1"
                    aria-label={`Quantity for leg ${index + 1}`}
                    className="w-12 rounded border border-border bg-background px-2 py-1 text-xs font-mono"
                  />
                </div>

                {/* Remove */}
                <button
                  type="button"
                  onClick={() => removeLeg(leg.id)}
                  className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  aria-label={`Remove leg ${index + 1}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Greeks summary */}
      {totalGreeks && legs.length > 0 && (
        <div className="grid grid-cols-5 gap-2 rounded-md border border-border bg-background p-2 text-xs">
          <div className="text-center">
            <div className="text-muted-foreground">Delta</div>
            <div className="font-mono tabular font-medium">{totalGreeks.delta.toFixed(2)}</div>
          </div>
          <div className="text-center">
            <div className="text-muted-foreground">Gamma</div>
            <div className="font-mono tabular font-medium">{totalGreeks.gamma.toFixed(4)}</div>
          </div>
          <div className="text-center">
            <div className="text-muted-foreground">Theta</div>
            <div className={`font-mono tabular font-medium ${totalGreeks.theta < 0 ? "text-bear" : "text-bull"}`}>
              {totalGreeks.theta.toFixed(2)}
            </div>
          </div>
          <div className="text-center">
            <div className="text-muted-foreground">Vega</div>
            <div className="font-mono tabular font-medium">{totalGreeks.vega.toFixed(2)}</div>
          </div>
          <div className="text-center">
            <div className="text-muted-foreground">Net Premium</div>
            <div className={`font-mono tabular font-medium ${netPremium > 0 ? "text-bull" : "text-bear"}`}>
              {netPremium >= 0 ? "+" : ""}Rs.{netPremium.toLocaleString("en-IN")}
            </div>
          </div>
        </div>
      )}

      {/* Payoff graph */}
      {legs.length > 0 && legs.every((l) => l.premium > 0) && (
        <PayoffGraph
          legs={legs.map((l) => ({
            type: l.type,
            strike: l.strike,
            premium: l.premium,
            quantity: l.action === "buy" ? l.quantity : -l.quantity,
          }))}
          underlyingPrice={spot}
        />
      )}
    </div>
  );
}
import type { OptionChainGreeksView } from "../../../server/modules/options/contracts";

interface GreekDisplayProps {
  greeks: OptionChainGreeksView | null;
  compact?: boolean;
}

function formatGreek(value: string | null, digits: number): string {
  if (value === null) return "—";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(digits) : value;
}

export function GreekDisplay({ greeks, compact = false }: GreekDisplayProps) {
  const values = {
    delta: formatGreek(greeks?.delta ?? null, 4),
    gamma: formatGreek(greeks?.gamma ?? null, 4),
    theta: formatGreek(greeks?.theta ?? null, 4),
    vega: formatGreek(greeks?.vega ?? null, 4),
  };

  if (compact) {
    return (
      <div className="space-y-1 font-mono tabular text-[11px] leading-4">
        <div>Δ {values.delta}</div>
        <div>Γ {values.gamma}</div>
        <div>Θ {values.theta}</div>
        <div>V {values.vega}</div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-4 gap-2 rounded-md border border-border bg-panel p-2 text-xs">
      <div className="text-center">
        <div className="text-muted-foreground">Delta</div>
        <div className="font-mono tabular font-medium">{values.delta}</div>
      </div>
      <div className="text-center">
        <div className="text-muted-foreground">Gamma</div>
        <div className="font-mono tabular font-medium">{values.gamma}</div>
      </div>
      <div className="text-center">
        <div className="text-muted-foreground">Theta</div>
        <div className="font-mono tabular font-medium">{values.theta}</div>
      </div>
      <div className="text-center">
        <div className="text-muted-foreground">Vega</div>
        <div className="font-mono tabular font-medium">{values.vega}</div>
      </div>
    </div>
  );
}

interface PCRDisplayProps {
  callOI: number;
  putOI: number;
}

export function PCRDisplay({ callOI, putOI }: PCRDisplayProps) {
  const pcr = putOI / Math.max(callOI, 1);
  const pcrColor = pcr > 1 ? "text-bear" : pcr < 0.7 ? "text-bull" : "text-foreground";

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground">PCR:</span>
      <span className={`font-mono tabular font-semibold ${pcrColor}`}>
        {pcr.toFixed(2)}
      </span>
      <span className="text-muted-foreground">
        ({pcr > 1 ? "Bearish" : pcr < 0.7 ? "Bullish" : "Neutral"})
      </span>
    </div>
  );
}

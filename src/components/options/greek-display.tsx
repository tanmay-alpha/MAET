import { Greeks } from "@/lib/greeks";

interface GreekDisplayProps {
  greeks: Greeks;
  compact?: boolean;
}

export function GreekDisplay({ greeks, compact = false }: GreekDisplayProps) {
  if (compact) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">Δ</span>
        <span className="font-mono tabular">{greeks.delta.toFixed(2)}</span>
        <span className="text-muted-foreground">Γ</span>
        <span className="font-mono tabular">{greeks.gamma.toFixed(4)}</span>
        <span className="text-muted-foreground">V</span>
        <span className="font-mono tabular">{greeks.vega.toFixed(2)}</span>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-5 gap-2 rounded-md border border-border bg-panel p-2 text-xs">
      <div className="text-center">
        <div className="text-muted-foreground">Delta</div>
        <div className="font-mono tabular font-medium">{greeks.delta.toFixed(4)}</div>
      </div>
      <div className="text-center">
        <div className="text-muted-foreground">Gamma</div>
        <div className="font-mono tabular font-medium">{greeks.gamma.toFixed(4)}</div>
      </div>
      <div className="text-center">
        <div className="text-muted-foreground">Theta</div>
        <div className="font-mono tabular font-medium">{greeks.theta.toFixed(4)}</div>
      </div>
      <div className="text-center">
        <div className="text-muted-foreground">Vega</div>
        <div className="font-mono tabular font-medium">{greeks.vega.toFixed(4)}</div>
      </div>
      <div className="text-center">
        <div className="text-muted-foreground">Rho</div>
        <div className="font-mono tabular font-medium">{greeks.rho.toFixed(4)}</div>
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
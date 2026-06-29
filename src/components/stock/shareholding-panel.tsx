import { Users } from "lucide-react";
import { ContractPanel } from "@/components/common/contract-panel";

interface ShareholdingPanelProps {
  symbol: string;
}

export function ShareholdingPanel({ symbol }: ShareholdingPanelProps) {
  return (
    <div className="space-y-3">
      <ContractPanel
        symbol={symbol}
        message={`Shareholding pattern for ${symbol} — connect BSE/NSE fundamentals API to see promoter, FII, DII, and public shareholding.`}
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Promoters", value: "—", color: "bg-slate-400" },
          { label: "FIIs", value: "—", color: "bg-blue-400" },
          { label: "DIIs", value: "—", color: "bg-green-400" },
          { label: "Public / Others", value: "—", color: "bg-amber-400" },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-lg border border-border bg-panel p-3">
            <div className="mb-2">
              <div className={`h-1.5 w-full rounded-full ${color} opacity-30`} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{label}</span>
              <span className="font-mono text-sm font-semibold">{value}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
import { Gift, History, Scale } from "lucide-react";
import { ContractPanel } from "@/components/common/contract-panel";

interface CorporateActionsPanelProps {
  symbol: string;
}

const MOCK_ACTIONS = [
  { date: "2024-01-15", type: "Bonus", ratio: "1:1", symbol: "RELIANCE" },
  { date: "2023-07-20", type: "Split", ratio: "10:1", symbol: "RELIANCE" },
  { date: "2023-06-01", type: "Dividend", ratio: "₹9/share", symbol: "RELIANCE" },
];

export function CorporateActionsPanel({ symbol }: CorporateActionsPanelProps) {
  return (
    <div className="space-y-3">
      <ContractPanel
        symbol={symbol}
        message={`Corporate actions for ${symbol} — connect a corporate actions API to see splits, bonuses, and dividends history.`}
      />
      <div className="space-y-2">
        {MOCK_ACTIONS.map((action, i) => (
          <div
            key={i}
            className="flex items-center justify-between rounded-lg border border-border bg-panel px-3 py-2 text-xs"
          >
            <div className="flex items-center gap-2">
              {action.type === "Bonus" && <Gift className="h-3.5 w-3.5 text-muted-foreground" />}
              {action.type === "Split" && <Scale className="h-3.5 w-3.5 text-muted-foreground" />}
              {action.type === "Dividend" && <History className="h-3.5 w-3.5 text-muted-foreground" />}
              <span className="font-medium">{action.type}</span>
              <span className="rounded bg-accent px-1.5 py-0.5 font-mono text-[10px]">{action.ratio}</span>
            </div>
            <span className="text-muted-foreground">{action.date}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
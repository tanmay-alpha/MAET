import { Calculator } from "lucide-react";
import { ContractPanel } from "@/components/common/contract-panel";

interface KeyRatiosPanelProps {
  symbol: string;
}

const RATIO_GROUPS = [
  {
    title: "Valuation",
    items: [
      { label: "P/E Ratio (TTM)", value: "—" },
      { label: "P/B Ratio", value: "—" },
      { label: "EV/EBITDA", value: "—" },
      { label: "Market Cap / Sales", value: "—" },
    ],
  },
  {
    title: "Profitability",
    items: [
      { label: "ROE", value: "—" },
      { label: "ROC", value: "—" },
      { label: "Net Margin", value: "—" },
      { label: "EBITDA Margin", value: "—" },
    ],
  },
  {
    title: "Leverage",
    items: [
      { label: "Debt / Equity", value: "—" },
      { label: "Debt / EBITDA", value: "—" },
      { label: "Current Ratio", value: "—" },
      { label: "Interest Coverage", value: "—" },
    ],
  },
  {
    title: "Growth",
    items: [
      { label: "Revenue Growth (YoY)", value: "—" },
      { label: "Profit Growth (YoY)", value: "—" },
      { label: "EPS Growth (3Y CAGR)", value: "—" },
      { label: "Dividend Growth", value: "—" },
    ],
  },
  {
    title: "Dividends",
    items: [
      { label: "Dividend Yield", value: "—" },
      { label: "Dividend Per Share", value: "—" },
      { label: "Payout Ratio", value: "—" },
      { label: "Ex-Div Date", value: "—" },
    ],
  },
];

export function KeyRatiosPanel({ symbol }: KeyRatiosPanelProps) {
  return (
    <div className="space-y-4">
      <ContractPanel
        symbol={symbol}
        message={`Key ratios for ${symbol} — connect a fundamentals API to populate P/E, P/B, ROE, Debt/Equity, and other metrics.`}
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
        {RATIO_GROUPS.map((group) => (
          <div key={group.title} className="rounded-lg border border-border bg-panel p-3">
            <div className="mb-2 flex items-center gap-1.5">
              <Calculator className="h-3 w-3 text-muted-foreground" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.title}
              </span>
            </div>
            <dl className="space-y-1">
              {group.items.map((item) => (
                <div key={item.label} className="flex justify-between gap-2 text-xs">
                  <dt className="text-muted-foreground">{item.label}</dt>
                  <dd className="font-mono font-medium">{item.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}

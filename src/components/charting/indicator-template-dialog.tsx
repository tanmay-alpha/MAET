import type { IndicatorInstance } from "@shared/research/contracts";
import { Sliders, Check } from "lucide-react";

interface IndicatorTemplateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyTemplate: (indicators: IndicatorInstance[]) => void;
}

const BUILTIN_TEMPLATES: { name: string; description: string; indicators: IndicatorInstance[] }[] = [
  {
    name: "Price Action Baseline",
    description: "20-period SMA overlay with Volume panel",
    indicators: [
      { id: "sma-20", type: "SMA", pane: "main", parameters: { period: 20 }, style: { color: "#3b82f6" }, visible: true },
      { id: "volume", type: "VOLUME", pane: "subpanel", parameters: {}, style: { color: "#64748b" }, visible: true },
    ],
  },
  {
    name: "Trend Following",
    description: "SMA 20, EMA 50 & Supertrend overlay",
    indicators: [
      { id: "sma-20", type: "SMA", pane: "main", parameters: { period: 20 }, style: { color: "#3b82f6" }, visible: true },
      { id: "ema-50", type: "EMA", pane: "main", parameters: { period: 50 }, style: { color: "#10b981" }, visible: true },
      { id: "supertrend", type: "SUPERTREND", pane: "main", parameters: {}, style: { color: "#f59e0b" }, visible: true },
    ],
  },
  {
    name: "Momentum Suite",
    description: "RSI 14 & MACD subpanels",
    indicators: [
      { id: "rsi-14", type: "RSI", pane: "subpanel", parameters: { period: 14 }, style: { color: "#ec4899" }, visible: true },
      { id: "macd", type: "MACD", pane: "subpanel", parameters: {}, style: { color: "#8b5cf6" }, visible: true },
    ],
  },
  {
    name: "Mean Reversion",
    description: "Bollinger Bands & RSI 14",
    indicators: [
      { id: "bollinger", type: "BOLLINGER_BANDS", pane: "main", parameters: { period: 20 }, style: { color: "#06b6d4" }, visible: true },
      { id: "rsi-14", type: "RSI", pane: "subpanel", parameters: { period: 14 }, style: { color: "#ec4899" }, visible: true },
    ],
  },
  {
    name: "Volume Analysis",
    description: "Volume Histogram & On Balance Volume (OBV)",
    indicators: [
      { id: "volume", type: "VOLUME", pane: "subpanel", parameters: {}, style: { color: "#64748b" }, visible: true },
      { id: "obv", type: "OBV", pane: "subpanel", parameters: {}, style: { color: "#84cc16" }, visible: true },
    ],
  },
];

export function IndicatorTemplateDialog({
  isOpen,
  onClose,
  onApplyTemplate,
}: IndicatorTemplateDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-popover p-5 text-popover-foreground shadow-2xl space-y-4">
        <div className="flex items-center justify-between border-b border-border pb-2">
          <div className="flex items-center gap-2 font-bold text-sm">
            <Sliders className="h-4 w-4 text-primary" />
            <span>Indicator Templates</span>
          </div>
          <button type="button" onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">
            Close
          </button>
        </div>

        <div className="space-y-2 max-h-72 overflow-y-auto">
          {BUILTIN_TEMPLATES.map((tmpl) => (
            <div
              key={tmpl.name}
              className="flex items-center justify-between rounded border border-border bg-panel p-3 text-xs hover:border-primary/50 transition"
            >
              <div>
                <div className="font-semibold text-foreground">{tmpl.name}</div>
                <div className="text-[10px] text-muted-foreground">{tmpl.description}</div>
              </div>
              <button
                type="button"
                onClick={() => {
                  onApplyTemplate(tmpl.indicators);
                  onClose();
                }}
                className="flex items-center gap-1 rounded bg-primary px-3 py-1 font-semibold text-primary-foreground text-[11px]"
              >
                <Check className="h-3 w-3" /> Apply
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

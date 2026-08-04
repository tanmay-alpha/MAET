import { useState } from "react";
import type { IndicatorInstance } from "@shared/research/contracts";
import { Eye, EyeOff, Settings2, Trash2, Plus, Sliders } from "lucide-react";

interface IndicatorManagerProps {
  indicators: IndicatorInstance[];
  onUpdateIndicators: (indicators: IndicatorInstance[]) => void;
  onOpenTemplates: () => void;
}

const AVAILABLE_INDICATORS: { type: IndicatorInstance["type"]; name: string; pane: "main" | "subpanel" }[] = [
  { type: "SMA", name: "Simple Moving Avg (SMA)", pane: "main" },
  { type: "EMA", name: "Exponential Moving Avg (EMA)", pane: "main" },
  { type: "BOLLINGER_BANDS", name: "Bollinger Bands", pane: "main" },
  { type: "VWAP", name: "VWAP", pane: "main" },
  { type: "SUPERTREND", name: "Supertrend", pane: "main" },
  { type: "VOLUME", name: "Volume Histogram", pane: "subpanel" },
  { type: "RSI", name: "Relative Strength Index (RSI)", pane: "subpanel" },
  { type: "MACD", name: "MACD", pane: "subpanel" },
  { type: "ATR", name: "Average True Range (ATR)", pane: "subpanel" },
  { type: "OBV", name: "On Balance Volume (OBV)", pane: "subpanel" },
];

export function IndicatorManager({
  indicators,
  onUpdateIndicators,
  onOpenTemplates,
}: IndicatorManagerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);

  const toggleVisibility = (id: string) => {
    onUpdateIndicators(
      indicators.map((ind) => (ind.id === id ? { ...ind, visible: !ind.visible } : ind))
    );
  };

  const removeIndicator = (id: string) => {
    onUpdateIndicators(indicators.filter((ind) => ind.id !== id));
  };

  const addIndicator = (type: IndicatorInstance["type"], pane: "main" | "subpanel") => {
    const newInd: IndicatorInstance = {
      id: `${type.toLowerCase()}-${Date.now()}`,
      type,
      pane,
      parameters: { period: type === "RSI" ? 14 : 20 },
      style: { color: type === "RSI" ? "#ec4899" : type === "MACD" ? "#8b5cf6" : "#3b82f6" },
      visible: true,
    };
    onUpdateIndicators([...indicators, newInd]);
    setShowAddMenu(false);
  };

  return (
    <div className="relative">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold transition ${
            isOpen ? "bg-primary text-primary-foreground" : "bg-panel-elevated text-muted-foreground hover:text-foreground"
          }`}
        >
          <Sliders className="h-3.5 w-3.5" />
          <span>Indicators ({indicators.filter((i) => i.visible).length})</span>
        </button>
        <button
          type="button"
          onClick={onOpenTemplates}
          className="rounded bg-panel-elevated px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition"
        >
          Templates
        </button>
      </div>

      {isOpen && (
        <div className="absolute left-0 top-full z-40 mt-1.5 w-72 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-2xl space-y-2">
          <div className="flex items-center justify-between border-b border-border/60 pb-1.5 text-xs font-bold">
            <span>Active Indicators</span>
            <button
              type="button"
              onClick={() => setShowAddMenu(!showAddMenu)}
              className="flex items-center gap-1 text-[11px] text-primary hover:underline"
            >
              <Plus className="h-3 w-3" /> Add Indicator
            </button>
          </div>

          {showAddMenu && (
            <div className="max-h-40 overflow-y-auto space-y-1 rounded border border-border bg-panel p-1.5 text-xs">
              {AVAILABLE_INDICATORS.map((item) => (
                <button
                  key={item.type}
                  type="button"
                  onClick={() => addIndicator(item.type, item.pane)}
                  className="w-full text-left px-2 py-1 rounded hover:bg-accent text-[11px] font-medium"
                >
                  {item.name}
                </button>
              ))}
            </div>
          )}

          <div className="space-y-1 max-h-56 overflow-y-auto">
            {indicators.length === 0 ? (
              <div className="text-[11px] text-muted-foreground py-2 text-center">No active indicators.</div>
            ) : (
              indicators.map((ind) => (
                <div key={ind.id} className="flex items-center justify-between rounded bg-panel px-2.5 py-1.5 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: ind.style.color }} />
                    <span className="font-medium truncate text-[11px]">{ind.type}</span>
                    <span className="text-[9px] uppercase text-muted-foreground opacity-75">({ind.pane})</span>
                  </div>
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <button
                      type="button"
                      onClick={() => toggleVisibility(ind.id)}
                      className="p-1 hover:text-foreground rounded"
                    >
                      {ind.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3 text-muted-foreground/40" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeIndicator(ind.id)}
                      className="p-1 hover:text-bear rounded"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

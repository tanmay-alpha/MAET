import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Bell, CheckCircle2, AlertCircle } from "lucide-react";

interface ChartAlertDialogProps {
  isOpen: boolean;
  onClose: () => void;
  symbol: string;
  exchange?: string;
  initialPrice?: number;
}

export function ChartAlertDialog({
  isOpen,
  onClose,
  symbol,
  exchange = "NSE",
  initialPrice = 0,
}: ChartAlertDialogProps) {
  const [price, setPrice] = useState(initialPrice.toFixed(2));
  const [condition, setCondition] = useState<"PRICE_ABOVE" | "PRICE_BELOW">("PRICE_ABOVE");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const createAlertMutation = (trpc as any).alerts.createAlert.useMutation();

  if (!isOpen) return null;

  const handleSubmit = async () => {
    const numericPrice = parseFloat(price);
    if (!numericPrice || numericPrice <= 0) {
      setMessage("Enter a valid target price greater than 0.");
      return;
    }

    setIsSubmitting(true);
    setMessage("");

    try {
      await createAlertMutation.mutateAsync({
        symbol,
        conditionType: condition,
        targetPrice: numericPrice,
      });
      setMessage(`Server alert created for ${symbol} at ₹${numericPrice.toFixed(2)}`);
      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : "Failed to create server alert";
      setMessage(errorMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-popover p-5 text-popover-foreground shadow-2xl space-y-4">
        <div className="flex items-center justify-between border-b border-border pb-2">
          <div className="flex items-center gap-2 font-bold text-sm text-primary">
            <Bell className="h-4 w-4" />
            <span>Create Server Alert</span>
          </div>
          <button type="button" onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">
            Close
          </button>
        </div>

        <div className="space-y-3 text-xs">
          <div>
            <label className="text-[10px] uppercase font-semibold text-muted-foreground">Symbol</label>
            <div className="font-semibold text-sm mt-0.5">{symbol} ({exchange})</div>
          </div>

          <div>
            <label className="text-[10px] uppercase font-semibold text-muted-foreground">Condition</label>
            <select
              value={condition}
              onChange={(e) => setCondition(e.target.value as any)}
              className="mt-1 w-full rounded bg-panel-elevated px-2.5 py-1.5 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="PRICE_ABOVE">Price Above (&ge;)</option>
              <option value="PRICE_BELOW">Price Below (&le;)</option>
            </select>
          </div>

          <div>
            <label className="text-[10px] uppercase font-semibold text-muted-foreground">Target Price (₹)</label>
            <input
              type="number"
              step="0.05"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="mt-1 w-full rounded bg-panel-elevated px-2.5 py-1.5 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="w-full rounded bg-primary py-2.5 font-bold text-primary-foreground text-xs hover:opacity-95 transition disabled:opacity-50"
          >
            {isSubmitting ? "Creating Alert..." : "Create Server Alert"}
          </button>

          {message && (
            <div
              className={`rounded p-2 text-[11px] flex items-center gap-1.5 ${
                message.includes("created") ? "bg-bull/10 text-bull border border-bull/30" : "bg-bear/10 text-bear border border-bear/30"
              }`}
            >
              {message.includes("created") ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <AlertCircle className="h-3.5 w-3.5 shrink-0" />}
              <span>{message}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

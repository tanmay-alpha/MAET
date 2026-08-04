import { useEffect, useState, useMemo } from "react";
import { usePaperAccount } from "@/hooks/use-paper-account";
import { AlertCircle, CheckCircle2, ShieldAlert } from "lucide-react";

export function OrderPanel({
  symbol,
  price,
}: {
  symbol: string;
  price?: number;
}) {
  const { placeOrder, isTradingAvailable } = usePaperAccount();
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [qtyRaw, setQtyRaw] = useState<string>("10");
  const [limit, setLimit] = useState(price?.toFixed(2) ?? "");
  const [type, setType] = useState<"MKT" | "LMT" | "SL">("MKT");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [showConfirmation, setShowConfirmation] = useState(false);

  useEffect(() => {
    if (price && !limit) {
      setLimit(price.toFixed(2));
    }
    setMessage("");
  }, [price, symbol]);

  useEffect(() => {
    setStopLoss("");
    setTakeProfit("");
  }, [symbol]);

  const parsedQty = useMemo(() => {
    const val = parseInt(qtyRaw, 10);
    return Number.isFinite(val) && val > 0 ? val : null;
  }, [qtyRaw]);

  const effectivePrice = useMemo(() => {
    if (type === "LMT" || type === "SL") {
      const p = parseFloat(limit);
      return Number.isFinite(p) && p > 0 ? p : price || 0;
    }
    return price || 0;
  }, [type, limit, price]);

  const estimatedValue = useMemo(() => {
    return (parsedQty || 0) * effectivePrice;
  }, [parsedQty, effectivePrice]);

  const requiredMargin = useMemo(() => {
    return estimatedValue / 5; // 5x leverage
  }, [estimatedValue]);

  const validationError = useMemo(() => {
    if (!parsedQty) return "Quantity must be a positive integer.";
    if (type === "LMT" && (!limit || parseFloat(limit) <= 0)) {
      return "Limit price must be greater than 0.";
    }
    if (type === "SL" && (!limit || parseFloat(limit) <= 0)) {
      return "Stop-loss price must be greater than 0.";
    }
    if (type === "MKT" && (!price || price <= 0)) {
      return "Market quote unavailable for MARKET order.";
    }
    if (stopLoss && parseFloat(stopLoss) <= 0) {
      return "Stop loss price must be positive.";
    }
    if (takeProfit && parseFloat(takeProfit) <= 0) {
      return "Take profit price must be positive.";
    }
    return null;
  }, [parsedQty, type, limit, price, stopLoss, takeProfit]);

  const handlePreSubmit = () => {
    if (validationError) {
      setMessage(validationError);
      return;
    }
    if (side === "SELL") {
      setShowConfirmation(true);
      return;
    }
    void executeSubmit();
  };

  const executeSubmit = async () => {
    if (!isTradingAvailable || !parsedQty) return;

    setIsSubmitting(true);
    setMessage("");
    setShowConfirmation(false);

    try {
      if (type === "MKT") {
        await placeOrder({
          symbol,
          exchange: "NSE",
          side,
          type: "MARKET",
          quantity: parsedQty,
          stopLossPrice: stopLoss ? Number(stopLoss) : undefined,
          takeProfitPrice: takeProfit ? Number(takeProfit) : undefined,
        });
        setMessage(`Market ${side} order placed for ${parsedQty} ${symbol}`);
      } else if (type === "LMT") {
        await placeOrder({
          symbol,
          exchange: "NSE",
          side,
          type: "LIMIT",
          quantity: parsedQty,
          limitPrice: Number(limit),
          stopLossPrice: stopLoss ? Number(stopLoss) : undefined,
          takeProfitPrice: takeProfit ? Number(takeProfit) : undefined,
        });
        setMessage(`Limit ${side} order placed at ₹${limit}`);
      } else {
        await placeOrder({
          symbol,
          exchange: "NSE",
          side,
          type: "STOP_LOSS_LIMIT",
          quantity: parsedQty,
          stopPrice: Number(limit),
          limitPrice: Number(limit),
        });
        setMessage(`Stop-loss limit ${side} order placed at ₹${limit}`);
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : "Failed to place order";
      setMessage(errorMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-panel">
      {/* Header */}
      <div className="border-b border-border px-3 py-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Order Ticket</div>
        <div className="mt-0.5 flex items-baseline justify-between">
          <div className="font-semibold text-sm">{symbol}</div>
          <div className="font-mono tabular-nums text-xs font-bold text-foreground">
            {price !== undefined ? `₹${price.toFixed(2)}` : "No quote"}
          </div>
        </div>
      </div>

      {/* Side Toggle */}
      <div className="grid grid-cols-2 gap-1 p-2">
        <button
          onClick={() => setSide("BUY")}
          disabled={isSubmitting || !isTradingAvailable}
          className={`rounded px-3 py-2 text-xs font-bold transition ${
            side === "BUY" ? "bg-bull text-white shadow" : "bg-panel-elevated text-muted-foreground hover:text-foreground"
          } disabled:opacity-50`}
        >
          BUY
        </button>
        <button
          onClick={() => setSide("SELL")}
          disabled={isSubmitting || !isTradingAvailable}
          className={`rounded px-3 py-2 text-xs font-bold transition ${
            side === "SELL" ? "bg-bear text-white shadow" : "bg-panel-elevated text-muted-foreground hover:text-foreground"
          } disabled:opacity-50`}
        >
          SELL (SHORT)
        </button>
      </div>

      {/* Form Fields */}
      <div className="space-y-3 px-3 pb-3 text-xs flex-1 overflow-y-auto">
        {/* Order Type Tabs */}
        <div className="flex gap-1">
          {(["MKT", "LMT", "SL"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={`flex-1 rounded py-1 text-[11px] font-semibold transition ${
                type === t ? "bg-primary text-primary-foreground" : "bg-panel-elevated text-muted-foreground hover:text-foreground"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Quantity Input */}
        <div>
          <label className="text-[10px] text-muted-foreground uppercase font-semibold">Quantity (Shares)</label>
          <input
            type="number"
            min={1}
            value={qtyRaw}
            onChange={(e) => setQtyRaw(e.target.value)}
            placeholder="Qty e.g. 10"
            className="mt-1 w-full rounded bg-panel-elevated px-2.5 py-1.5 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {/* Limit/Stop Price */}
        {type !== "MKT" && (
          <div>
            <label className="text-[10px] text-muted-foreground uppercase font-semibold">
              {type === "LMT" ? "Limit Price (₹)" : "Stop Price (₹)"}
            </label>
            <input
              type="number"
              step="0.05"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              className="mt-1 w-full rounded bg-panel-elevated px-2.5 py-1.5 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        )}

        {/* Advanced Controls */}
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-[10px] text-muted-foreground underline hover:text-foreground"
        >
          {showAdvanced ? "Hide Stop Loss / Take Profit" : "Add Stop Loss / Take Profit"}
        </button>

        {showAdvanced && (
          <div className="space-y-2 pt-1 border-t border-border/50">
            <div>
              <label className="text-[10px] text-muted-foreground">Stop Loss Price (₹)</label>
              <input
                type="number"
                step="0.05"
                value={stopLoss}
                onChange={(e) => setStopLoss(e.target.value)}
                placeholder="Optional"
                className="mt-1 w-full rounded bg-panel-elevated px-2.5 py-1.5 font-mono text-xs text-foreground outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">Take Profit Price (₹)</label>
              <input
                type="number"
                step="0.05"
                value={takeProfit}
                onChange={(e) => setTakeProfit(e.target.value)}
                placeholder="Optional"
                className="mt-1 w-full rounded bg-panel-elevated px-2.5 py-1.5 font-mono text-xs text-foreground outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>
        )}

        {/* Pre-submit Summary Card */}
        <div className="rounded border border-border bg-panel-elevated/40 p-2.5 space-y-1.5 font-mono text-[11px]">
          <div className="flex justify-between text-muted-foreground text-[10px] uppercase">
            <span>Est. Order Value</span>
            <span>Est. Required Margin (5x)</span>
          </div>
          <div className="flex justify-between font-bold text-foreground">
            <span>₹{estimatedValue.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>
            <span>₹{requiredMargin.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>
          </div>
        </div>

        {/* Submit Button */}
        <button
          onClick={handlePreSubmit}
          disabled={isSubmitting || !isTradingAvailable || Boolean(validationError)}
          className={`w-full rounded py-2.5 text-xs font-bold text-white transition ${
            side === "BUY" ? "bg-bull hover:bg-bull/90" : "bg-bear hover:bg-bear/90"
          } disabled:opacity-50`}
        >
          {isSubmitting ? "Submitting..." : `${side} ${parsedQty ?? 0} ${symbol}`}
        </button>

        {/* Status Messages */}
        {message && (
          <div
            className={`rounded p-2 text-[11px] flex items-start gap-1.5 ${
              message.includes("placed") || message.includes("success")
                ? "bg-bull/10 text-bull border border-bull/30"
                : "bg-bear/10 text-bear border border-bear/30"
            }`}
          >
            {message.includes("placed") ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" /> : <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />}
            <span>{message}</span>
          </div>
        )}
      </div>

      {/* Confirmation Modal for Short Sell / Margin Orders */}
      {showConfirmation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-lg border border-border bg-popover p-5 text-popover-foreground shadow-2xl space-y-4">
            <div className="flex items-center gap-2 text-amber-500 font-bold text-sm">
              <ShieldAlert className="h-5 w-5" />
              <span>Confirm Short Position</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              You are about to execute a <strong>SELL (SHORT)</strong> order for <strong>{parsedQty} {symbol}</strong> valued at <strong>₹{estimatedValue.toFixed(2)}</strong> requiring <strong>₹{requiredMargin.toFixed(2)}</strong> margin.
            </p>
            <div className="flex justify-end gap-2 text-xs">
              <button
                onClick={() => setShowConfirmation(false)}
                className="rounded border border-border px-3 py-1.5 hover:bg-accent text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={executeSubmit}
                className="rounded bg-bear hover:bg-bear/90 px-3 py-1.5 font-bold text-white"
              >
                Confirm Short Sell
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

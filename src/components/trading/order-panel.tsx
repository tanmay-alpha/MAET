import { useEffect, useState } from "react";
import { usePaperAccount } from "@/hooks/use-paper-account";

export function OrderPanel({
  symbol,
  price,
}: {
  symbol: string;
  price?: number;
}) {
  const { placeOrder, isTradingAvailable } = usePaperAccount();
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [qty, setQty] = useState(1);
  const [limit, setLimit] = useState(price?.toFixed(2) ?? "");
  const [type, setType] = useState<"MKT" | "LMT" | "SL">("MKT");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");

  useEffect(() => {
    setLimit(price?.toFixed(2) ?? "");
    setMessage("");
  }, [price, symbol]);

  useEffect(() => {
    setStopLoss("");
    setTakeProfit("");
  }, [symbol]);

  const submit = async () => {
    if (!isTradingAvailable) {
      setMessage("Paper trading is temporarily unavailable.");
      return;
    }

    setIsSubmitting(true);
    setMessage("");

    try {
      if (type === "MKT") {
        await placeOrder({
          symbol,
          side,
          type: "MARKET",
          qty,
          stopLossPrice: stopLoss ? Number(stopLoss) : undefined,
          takeProfitPrice: takeProfit ? Number(takeProfit) : undefined,
        });
        setMessage(`Market ${side} order placed successfully for ${symbol}`);
      } else if (type === "LMT") {
        await placeOrder({
          symbol,
          side,
          type: "LIMIT",
          qty,
          limitPrice: Number(limit),
          stopLossPrice: stopLoss ? Number(stopLoss) : undefined,
          takeProfitPrice: takeProfit ? Number(takeProfit) : undefined,
        });
        setMessage(`Limit ${side} order placed for ${symbol}`);
      } else {
        await placeOrder({
          symbol,
          side,
          type: "STOP_LOSS_LIMIT",
          qty,
          stopPrice: Number(limit),
          limitPrice: Number(limit),
        });
        setMessage(`Stop-loss limit ${side} order placed for ${symbol}`);
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
      <div className="border-b border-border px-3 py-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Order</div>
        <div className="mt-0.5 flex items-baseline gap-2">
          <div className="font-semibold">{symbol}</div>
          <div className="font-mono tabular tabular-nums text-xs text-muted-foreground">
            {price?.toFixed(2) ?? "Waiting for quote"}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-1 p-2">
        <button
          onClick={() => setSide("BUY")}
          disabled={isSubmitting || !isTradingAvailable}
          className={`rounded px-3 py-2 text-xs font-semibold transition ${
            side === "BUY"
              ? "bg-bull text-white"
              : "bg-panel-elevated text-muted-foreground hover:text-foreground"
          } disabled:opacity-50`}
        >
          BUY
        </button>
        <button
          onClick={() => setSide("SELL")}
          disabled={isSubmitting || !isTradingAvailable}
          className={`rounded px-3 py-2 text-xs font-semibold transition ${
            side === "SELL"
              ? "bg-bear text-white"
              : "bg-panel-elevated text-muted-foreground hover:text-foreground"
          } disabled:opacity-50`}
        >
          SELL
        </button>
      </div>
      <div className="relative space-y-2 px-3 pb-3 text-xs">
        <div className="flex gap-1">
          {(["MKT", "LMT", "SL"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={`flex-1 rounded py-1 text-[11px] font-medium transition ${
                type === t
                  ? "bg-primary text-primary-foreground"
                  : "bg-panel-elevated text-muted-foreground hover:text-foreground"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div>
          <label className="text-[10px] text-muted-foreground">Quantity</label>
          <input
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(Math.max(1, parseInt(e.target.value) || 1))}
            className="w-full rounded bg-panel-elevated px-2 py-1 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {type !== "MKT" && (
          <div>
            <label className="text-[10px] text-muted-foreground">
              {type === "LMT" ? "Limit Price" : "Stop Price"}
            </label>
            <input
              type="number"
              step="0.05"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              className="w-full rounded bg-panel-elevated px-2 py-1 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        )}

        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-[10px] text-muted-foreground underline hover:text-foreground"
        >
          {showAdvanced ? "Hide Advanced Risk Controls" : "Show Advanced Risk Controls"}
        </button>

        {showAdvanced && (
          <div className="space-y-2 pt-1">
            <div>
              <label className="text-[10px] text-muted-foreground">Stop Loss Price</label>
              <input
                type="number"
                step="0.05"
                value={stopLoss}
                onChange={(e) => setStopLoss(e.target.value)}
                placeholder="Optional"
                className="w-full rounded bg-panel-elevated px-2 py-1 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">Take Profit Price</label>
              <input
                type="number"
                step="0.05"
                value={takeProfit}
                onChange={(e) => setTakeProfit(e.target.value)}
                placeholder="Optional"
                className="w-full rounded bg-panel-elevated px-2 py-1 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>
        )}

        <button
          onClick={submit}
          disabled={isSubmitting || !isTradingAvailable}
          className={`w-full rounded py-2 font-semibold text-white transition ${
            side === "BUY" ? "bg-bull hover:bg-bull/90" : "bg-bear hover:bg-bear/90"
          } disabled:opacity-50`}
        >
          {isSubmitting
            ? "Submitting..."
            : `${side} ${qty} ${symbol}`}
        </button>

        {message && (
          <div
            className={`mt-2 rounded p-2 text-[11px] ${
              message.includes("success") || message.includes("placed")
                ? "bg-bull/10 text-bull"
                : "bg-bear/10 text-bear"
            }`}
          >
            {message}
          </div>
        )}

        {!isTradingAvailable && (
          <div className="mt-2 rounded bg-bear/10 p-2 text-[11px] text-bear">
            Paper trading is temporarily unavailable.
          </div>
        )}
      </div>
    </div>
  );
}

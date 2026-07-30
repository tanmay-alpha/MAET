import { useState, useEffect, useRef } from "react";
import { usePaperAccount } from "@/hooks/use-paper-account";
import { useMarketQuotes } from "@/hooks/use-market-quotes";
import { WATCHLIST } from "@/lib/market-catalog";
import { X, TrendingUp, TrendingDown } from "lucide-react";

export function QuickTradeModal({
  isOpen,
  onClose,
  initialSymbol = "",
  initialSide = "BUY",
}: {
  isOpen: boolean;
  onClose: () => void;
  initialSymbol?: string;
  initialSide?: "BUY" | "SELL";
}) {
  const { placeOrder, isTradingAvailable } = usePaperAccount();
  const [side, setSide] = useState<"BUY" | "SELL">(initialSide);
  const [symbol, setSymbol] = useState(initialSymbol || WATCHLIST[0].symbol);
  const [qty, setQty] = useState(1);
  const [type, setType] = useState<"MARKET" | "LIMIT">("MARKET");
  const [price, setPrice] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (initialSymbol) setSymbol(initialSymbol);
    setSide(initialSide);
    setMessage(null);
  }, [initialSymbol, initialSide, isOpen]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const { quoteMap } = useMarketQuotes([symbol]);
  const currentQuote = quoteMap.get(symbol);
  const currentPrice = currentQuote?.price ?? 0;

  useEffect(() => {
    if (currentPrice > 0 && type === "LIMIT" && !price) {
      setPrice(currentPrice.toFixed(2));
    }
  }, [currentPrice, type, price]);

  if (!isOpen) return null;

  const notionalValue = qty * (type === "LIMIT" ? Number(price) || currentPrice : currentPrice);
  const marginEstimate = notionalValue / 5;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isTradingAvailable) {
      setMessage({ type: "error", text: "Paper trading is temporarily unavailable." });
      return;
    }
    if (!symbol) {
      setMessage({ type: "error", text: "Please select a stock symbol." });
      return;
    }
    if (qty <= 0) {
      setMessage({ type: "error", text: "Quantity must be greater than zero." });
      return;
    }

    const limitPriceNum = type === "LIMIT" ? Number(price) : undefined;
    if (type === "LIMIT" && (!limitPriceNum || limitPriceNum <= 0)) {
      setMessage({ type: "error", text: "Please enter a valid limit price." });
      return;
    }

    setIsSubmitting(true);
    setMessage(null);

    try {
      if (type === "MARKET") {
        await placeOrder({
          type: "MARKET",
          symbol: symbol.toUpperCase(),
          exchange: "NSE",
          side,
          quantity: qty,
        });
      } else {
        await placeOrder({
          type: "LIMIT",
          symbol: symbol.toUpperCase(),
          exchange: "NSE",
          side,
          quantity: qty,
          limitPrice: limitPriceNum!,
        });
      }

      setMessage({ type: "success", text: `Order placed successfully for ${symbol}` });
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        onClose();
        setMessage(null);
      }, 1200);
    } catch (err: unknown) {
      const text = err instanceof Error ? err.message : "Failed to place order";
      setMessage({ type: "error", text });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
      <div className="w-full max-w-md rounded-xl border border-border bg-panel p-5 shadow-2xl relative overflow-hidden">
        <div className="flex items-center justify-between border-b border-border pb-3 mb-4">
          <h3 className="text-base font-bold flex items-center gap-2">
            <span className={`inline-flex h-2 w-2 rounded-full ${side === "BUY" ? "bg-bull" : "bg-bear"}`} />
            Quick Trade Terminal
          </h3>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-all"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-1.5 p-1 bg-accent/40 rounded-lg border border-border/40">
            <button
              type="button"
              onClick={() => setSide("BUY")}
              disabled={isSubmitting}
              className={`rounded-md py-1.5 text-xs font-bold transition-all flex items-center justify-center gap-1 ${
                side === "BUY"
                  ? "bg-bull text-white shadow"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <TrendingUp className="h-3.5 w-3.5" />
              BUY (Long)
            </button>
            <button
              type="button"
              onClick={() => setSide("SELL")}
              disabled={isSubmitting}
              className={`rounded-md py-1.5 text-xs font-bold transition-all flex items-center justify-center gap-1 ${
                side === "SELL"
                  ? "bg-bear text-white shadow"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <TrendingDown className="h-3.5 w-3.5" />
              SELL (Short)
            </button>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Select Symbol</label>
            <select
              value={symbol}
              onChange={(e) => {
                setSymbol(e.target.value);
                setMessage(null);
              }}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold font-sans outline-none focus:border-primary transition-all"
            >
              {WATCHLIST.map((item) => (
                <option key={item.symbol} value={item.symbol}>
                  {item.symbol} - {item.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Order Type</label>
              <div className="flex gap-1 p-0.5 bg-accent/30 rounded border border-border/40">
                {(["MARKET", "LIMIT"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    className={`flex-1 py-1 rounded text-[10px] font-bold transition-all ${
                      type === t
                        ? "bg-panel text-primary border border-border/60"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Quantity</label>
              <input
                type="number"
                min="1"
                step="1"
                value={qty}
                onChange={(e) => {
                  const val = parseInt(e.target.value);
                  if (Number.isFinite(val) && val > 0) {
                    setQty(val);
                  }
                }}
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 font-mono text-xs tabular-nums outline-none focus:border-primary"
              />
            </div>
          </div>

          {type === "LIMIT" && (
            <div className="animate-slide-down">
              <label className="block text-xs font-medium text-muted-foreground mb-1">Limit Price (₹)</label>
              <input
                type="text"
                value={price}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "" || /^\d*\.?\d*$/.test(val)) {
                    setPrice(val);
                  }
                }}
                placeholder={currentPrice > 0 ? currentPrice.toFixed(2) : "0.00"}
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 font-mono text-xs tabular-nums outline-none focus:border-primary"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 bg-accent/20 p-2.5 rounded-lg border border-border/40 text-[10px] font-mono tabular-nums text-muted-foreground">
            <div>
              <div>LTP (Current price)</div>
              <div className="text-foreground font-semibold text-xs mt-0.5">₹{currentPrice.toFixed(2)}</div>
            </div>
            <div>
              <div>Required Margin (5x)</div>
              <div className="text-primary font-semibold text-xs mt-0.5">₹{marginEstimate.toFixed(2)}</div>
            </div>
          </div>

          {message && (
            <div
              className={`p-2.5 rounded text-xs text-center border font-sans font-medium transition-all ${
                message.type === "success"
                  ? "bg-green-500/10 border-green-500/20 text-green-500"
                  : "bg-red-500/10 border-red-500/20 text-red-500"
              }`}
            >
              {message.text}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting || !isTradingAvailable}
            className={`w-full rounded-lg py-2.5 text-xs font-bold text-white transition-all shadow-md ${
              side === "BUY"
                ? "bg-bull hover:bg-bull/90"
                : "bg-bear hover:bg-bear/90"
            } disabled:opacity-50`}
          >
            {isSubmitting ? "Submitting..." : `Confirm ${side} ${qty} ${symbol}`}
          </button>
        </form>
      </div>
    </div>
  );
}

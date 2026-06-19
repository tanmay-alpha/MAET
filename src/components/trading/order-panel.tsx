import { useState } from "react";

export function OrderPanel({ symbol, price }: { symbol: string; price: number }) {
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [qty, setQty] = useState(1);
  const [limit, setLimit] = useState(price.toFixed(2));
  const [type, setType] = useState<"MKT" | "LMT" | "SL">("LMT");

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="border-b border-border px-3 py-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Order</div>
        <div className="mt-0.5 flex items-baseline gap-2">
          <div className="font-semibold">{symbol}</div>
          <div className="font-mono tabular text-xs text-muted-foreground">{price.toFixed(2)}</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-1 p-2">
        <button onClick={() => setSide("BUY")} className={`rounded px-3 py-2 text-xs font-semibold transition ${side === "BUY" ? "bg-bull text-white" : "bg-panel-elevated text-muted-foreground hover:text-foreground"}`}>BUY</button>
        <button onClick={() => setSide("SELL")} className={`rounded px-3 py-2 text-xs font-semibold transition ${side === "SELL" ? "bg-bear text-white" : "bg-panel-elevated text-muted-foreground hover:text-foreground"}`}>SELL</button>
      </div>
      <div className="space-y-2 px-3 pb-3 text-xs">
        <div className="flex gap-1">
          {(["MKT", "LMT", "SL"] as const).map((t) => (
            <button key={t} onClick={() => setType(t)} className={`flex-1 rounded border px-2 py-1 ${type === t ? "border-primary text-primary" : "border-border text-muted-foreground"}`}>{t}</button>
          ))}
        </div>
        <label className="block">
          <span className="text-muted-foreground">Quantity</span>
          <input
            type="number"
            value={qty}
            onChange={(e) => setQty(+e.target.value)}
            className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 font-mono tabular outline-none focus:border-primary"
          />
        </label>
        {type !== "MKT" && (
          <label className="block">
            <span className="text-muted-foreground">Price</span>
            <input
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 font-mono tabular outline-none focus:border-primary"
            />
          </label>
        )}
        <div className="grid grid-cols-2 gap-2 pt-1 text-[11px] text-muted-foreground">
          <div className="rounded bg-panel-elevated px-2 py-1.5">
            <div>Margin</div>
            <div className="font-mono tabular text-foreground">₹{(qty * price * 0.2).toFixed(0)}</div>
          </div>
          <div className="rounded bg-panel-elevated px-2 py-1.5">
            <div>Charges</div>
            <div className="font-mono tabular text-foreground">₹{(qty * price * 0.0005).toFixed(2)}</div>
          </div>
        </div>
        <button className={`w-full rounded py-2.5 text-sm font-semibold text-white ${side === "BUY" ? "bg-bull hover:opacity-90" : "bg-bear hover:opacity-90"}`}>
          Place {side} order
        </button>
      </div>
      <div className="mt-auto border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
        <div className="flex justify-between"><span>Available</span><span className="font-mono tabular text-foreground">₹2,48,532</span></div>
        <div className="flex justify-between"><span>Used margin</span><span className="font-mono tabular text-foreground">₹1,12,840</span></div>
      </div>
    </div>
  );
}

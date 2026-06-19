import { INDICES } from "@/lib/mock-data";

export function TickerTape() {
  const items = [...INDICES, ...INDICES];
  return (
    <div className="border-y border-border bg-panel overflow-hidden">
      <div className="flex ticker-scroll whitespace-nowrap py-2">
        {items.map((i, idx) => (
          <div key={idx} className="flex items-center gap-2 px-6 text-xs">
            <span className="font-semibold text-foreground">{i.symbol}</span>
            <span className="font-mono tabular">{i.price.toLocaleString("en-IN")}</span>
            <span className={`font-mono tabular ${i.change >= 0 ? "text-bull" : "text-bear"}`}>
              {i.change >= 0 ? "▲" : "▼"} {Math.abs(i.change).toFixed(2)} ({i.changePct.toFixed(2)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

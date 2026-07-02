import { useMarketQuotes } from "@/hooks/use-market-quotes";
import { INDICES } from "@/lib/market-catalog";

const INDEX_KEYS: Record<string, string> = {
  "NIFTY 50": "NIFTY50",
  "BANK NIFTY": "BANKNIFTY",
  SENSEX: "SENSEX",
  "NIFTY IT": "NIFTYIT",
  "NIFTY FMCG": "NIFTYFMCG",
  "INDIA VIX": "INDIAVIX",
};

export function TickerTape() {
  const { quoteMap, streamConnected } = useMarketQuotes(Object.values(INDEX_KEYS));
  const indices = INDICES.map((item) => {
    const quote = quoteMap.get(INDEX_KEYS[item.symbol]);
    return {
      symbol: item.symbol,
      price: quote?.price,
      change: quote?.change,
      changePct: quote?.changePct,
    };
  });
  const items = [...indices, ...indices];

  return (
    <div className="border-y border-border bg-panel overflow-hidden">
      <div className="flex ticker-scroll whitespace-nowrap py-2">
        {items.map((item, index) => (
          <div key={index} className="flex items-center gap-2 px-6 text-xs">
            <span className="font-semibold text-foreground">{item.symbol}</span>
            <span className="font-mono tabular">{item.price?.toLocaleString("en-IN") ?? "—"}</span>
            <span className={`font-mono tabular ${(item.change ?? 0) >= 0 ? "text-bull" : "text-bear"}`}>
              {item.change === undefined || item.changePct === undefined
                ? "Waiting for quote"
                : `${item.change >= 0 ? "▲" : "▼"} ${Math.abs(item.change).toFixed(2)} (${item.changePct.toFixed(2)}%)`}
            </span>
            {index === 0 && (
              <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
                {streamConnected ? "Broker stream" : "Yahoo delayed"}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

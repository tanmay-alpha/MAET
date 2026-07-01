import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { CandlestickChartSimple as CandlestickChart } from "@/components/trading/candlestick-chart";
import { OrderPanel } from "@/components/trading/order-panel";
import { Watchlist } from "@/components/trading/watchlist";
import { useMarketCandles } from "@/hooks/use-market-candles";
import { useMarketQuotes } from "@/hooks/use-market-quotes";
import { settlePaperOrders, usePaperAccount } from "@/hooks/use-paper-account";
import type { MarketCandle } from "@/lib/market-api";
import { WATCHLIST } from "@/lib/market-catalog";

export const Route = createFileRoute("/_app/terminal")({
  head: () => ({ meta: [{ title: "Terminal — MAET" }] }),
  component: Terminal,
});

const INTERVALS = ["1m", "5m", "15m", "1h", "1D", "1W"];
const INTERVAL_CONFIG: Record<string, { timeframe: MarketCandle["tf"]; range: string }> = {
  "1m": { timeframe: "1m", range: "1d" },
  "5m": { timeframe: "5m", range: "5d" },
  "15m": { timeframe: "15m", range: "1mo" },
  "1h": { timeframe: "1h", range: "3mo" },
  "1D": { timeframe: "1d", range: "1y" },
  "1W": { timeframe: "1wk", range: "1y" },
};
const WATCHLIST_SYMBOLS = WATCHLIST.map((item) => item.symbol);

function Terminal() {
  const [active, setActive] = useState("RELIANCE");
  const [interval, setInterval] = useState("5m");
  const current = WATCHLIST.find((item) => item.symbol === active) ?? WATCHLIST[0];
  const { quoteMap, streamConnected, isError: quoteError } = useMarketQuotes(WATCHLIST_SYMBOLS);
  const { account, placeOrder } = usePaperAccount();
  const liveQuote = quoteMap.get(active);
  const intervalConfig = INTERVAL_CONFIG[interval];
  const candleQuery = useMarketCandles(active, intervalConfig.timeframe, intervalConfig.range);
  const candles = useMemo(
    () => (candleQuery.data?.candles ?? []).map((candle) => ({
      t: new Date(candle.ts).getTime(),
      o: candle.open,
      h: candle.high,
      l: candle.low,
      c: candle.close,
      v: candle.volume,
    })),
    [candleQuery.data?.candles]
  );
  const currentPrice = liveQuote?.price;
  const currentChange = liveQuote?.change;
  const currentChangePct = liveQuote?.changePct;
  const lastCandle = candles[candles.length - 1];

  useEffect(() => {
    settlePaperOrders(quoteMap);
  }, [quoteMap]);

  return (
    <div className="grid h-[calc(100vh-7rem)] grid-cols-[260px_1fr_260px]">
      <div className="border-r border-border">
        <Watchlist active={active} onSelect={setActive} quotes={quoteMap} />
      </div>

      <div className="flex flex-col">
        <div className="flex items-center justify-between border-b border-border bg-panel px-4 py-2">
          <div className="flex items-baseline gap-3">
            <div className="text-base font-semibold">{current.symbol}</div>
            <div className="text-xs text-muted-foreground">{current.name} · NSE</div>
          </div>
          <div className="flex items-baseline gap-4">
            <div className="font-mono tabular text-xl font-semibold">{currentPrice?.toFixed(2) ?? "—"}</div>
            <div className={`font-mono tabular text-sm ${(currentChange ?? 0) >= 0 ? "text-bull" : "text-bear"}`}>
              {currentChange === undefined
                ? "Loading quote"
                : `${currentChange >= 0 ? "+" : ""}${currentChange.toFixed(2)} (${(currentChangePct ?? 0).toFixed(2)}%)`}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {quoteError ? "Quote unavailable" : streamConnected ? "Yahoo delayed" : "Connecting"}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 border-b border-border bg-panel px-3 py-1.5 text-xs">
          {INTERVALS.map((item) => (
            <button
              key={item}
              onClick={() => setInterval(item)}
              className={`rounded px-2 py-1 ${interval === item ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {item}
            </button>
          ))}
          <div className="mx-2 h-4 w-px bg-border" />
          {['Candles', 'Line', 'Area'].map((type, index) => (
            <button key={type} className={`rounded px-2 py-1 ${index === 0 ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}>{type}</button>
          ))}
          <div className="mx-2 h-4 w-px bg-border" />
          {['Indicators', 'Compare', 'Alert'].map((item) => (
            <button key={item} className="rounded px-2 py-1 text-muted-foreground hover:text-foreground">{item}</button>
          ))}
          {lastCandle && (
            <div className="ml-auto flex items-center gap-3 text-[11px] font-mono tabular text-muted-foreground">
              <span>O <span className="text-foreground">{lastCandle.o.toFixed(2)}</span></span>
              <span>H <span className="text-bull">{lastCandle.h.toFixed(2)}</span></span>
              <span>L <span className="text-bear">{lastCandle.l.toFixed(2)}</span></span>
              <span>C <span className="text-foreground">{lastCandle.c.toFixed(2)}</span></span>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-hidden">
          {candles.length > 1 ? (
            <CandlestickChart data={candles} height={420} />
          ) : (
            <div className="flex h-[420px] items-center justify-center text-sm text-muted-foreground">
              {candleQuery.isError ? "Real candle data is temporarily unavailable" : "Loading Yahoo market candles…"}
            </div>
          )}
        </div>

        <div className="border-t border-border bg-panel">
          <div className="flex items-center gap-4 border-b border-border px-4 text-xs">
            {["Positions", "Orders", "Holdings", "Funds"].map((item, index) => (
              <button key={item} className={`border-b-2 py-2 ${index === 0 ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{item}</button>
            ))}
          </div>
          <div className="max-h-44 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr><th className="px-4 py-2 text-left">Symbol</th><th className="text-right">Qty</th><th className="text-right">Avg</th><th className="text-right">LTP</th><th className="px-4 text-right">P&amp;L</th></tr>
              </thead>
              <tbody>
                {account.positions.map((position) => {
                  const quote = quoteMap.get(position.symbol);
                  const ltp = quote?.price;
                  const pnl = ltp === undefined ? undefined : (ltp - position.avgPrice) * position.qty;
                  return (
                    <tr key={position.symbol} className="border-t border-border hover:bg-accent/50">
                      <td className="px-4 py-2 font-medium">{position.symbol}</td>
                      <td className="text-right font-mono tabular">{position.qty}</td>
                      <td className="text-right font-mono tabular">{position.avgPrice.toFixed(2)}</td>
                      <td className="text-right font-mono tabular">{ltp?.toFixed(2) ?? "—"}</td>
                      <td className={`px-4 text-right font-mono tabular ${(pnl ?? 0) >= 0 ? "text-bull" : "text-bear"}`}>
                        {pnl === undefined ? "—" : `${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}`}
                      </td>
                    </tr>
                  );
                })}
                {account.positions.length === 0 && (
                  <tr className="border-t border-border">
                    <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                      No paper positions. Place a market order to start.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="border-l border-border">
        <OrderPanel
          symbol={current.symbol}
          price={currentPrice}
          availableCash={account.cash}
          onPlace={placeOrder}
        />
      </div>
    </div>
  );
}

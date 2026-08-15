import { BarChart2 } from "lucide-react";
import { useMarketQuotes } from "@/hooks/use-market-quotes";
import { ContractPanel } from "@/components/common/contract-panel";

interface PeerComparisonPanelProps {
  symbol: string;
}

const PEER_SYMBOLS = ["TCS", "INFY", "HCLTECH", "WIPRO", "TECHM"];

const MOCK_FUNDAMENTALS: Record<string, Record<string, string>> = {
  RELIANCE: { pe: "24.5", pb: "1.8", roe: "9.2", de: "0.5" },
  TCS: { pe: "26.1", pb: "9.2", roe: "42.0", de: "0.0" },
  INFY: { pe: "22.8", pb: "5.1", roe: "31.5", de: "0.1" },
  HCLTECH: { pe: "19.4", pb: "4.2", roe: "27.0", de: "0.05" },
  WIPRO: { pe: "21.0", pb: "3.8", roe: "19.0", de: "0.0" },
  TECHM: { pe: "16.5", pb: "3.1", roe: "22.0", de: "0.15" },
};

export function PeerComparisonPanel({ symbol }: PeerComparisonPanelProps) {
  const allSymbols = [symbol, ...PEER_SYMBOLS];
  const { quoteMap } = useMarketQuotes(allSymbols);

  const peers = allSymbols.map((s) => {
    const quote = quoteMap.get(s);
    const fundamentals = MOCK_FUNDAMENTALS[s] ?? { pe: "—", pb: "—", roe: "—", de: "—" };
    return { symbol: s, price: quote?.price, changePct: quote?.changePct, ...fundamentals } as any;
  });

  return (
    <div className="space-y-3">
      <ContractPanel
        symbol={symbol}
        message={`Sector peer comparison for ${symbol} — connect fundamentals API for live P/E, ROE, Debt/Equity.`}
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px] text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="px-3 py-2 text-left text-muted-foreground">Symbol</th>
              <th className="px-3 py-2 text-right text-muted-foreground">Price</th>
              <th className="px-3 py-2 text-right text-muted-foreground">Chg %</th>
              <th className="px-3 py-2 text-right text-muted-foreground">P/E</th>
              <th className="px-3 py-2 text-right text-muted-foreground">P/B</th>
              <th className="px-3 py-2 text-right text-muted-foreground">ROE %</th>
              <th className="px-3 py-2 text-right text-muted-foreground">D/E</th>
            </tr>
          </thead>
          <tbody>
            {peers.map((peer) => (
              <tr
                key={peer.symbol}
                className={`border-b border-border/60 ${peer.symbol === symbol ? "bg-primary/5" : ""}`}
              >
                <td className={`px-3 py-2 font-semibold ${peer.symbol === symbol ? "text-primary" : ""}`}>
                  {peer.symbol}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular">
                  {peer.price?.toFixed(2) ?? "—"}
                </td>
                <td
                  className={`px-3 py-2 text-right font-mono tabular ${(peer.changePct ?? 0) >= 0 ? "text-bull" : "text-bear"}`}
                >
                  {peer.changePct !== undefined
                    ? `${peer.changePct >= 0 ? "+" : ""}${peer.changePct.toFixed(2)}%`
                    : "—"}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular">{peer.pe}</td>
                <td className="px-3 py-2 text-right font-mono tabular">{peer.pb}</td>
                <td className="px-3 py-2 text-right font-mono tabular">{peer.roe}</td>
                <td className="px-3 py-2 text-right font-mono tabular">{peer.de}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
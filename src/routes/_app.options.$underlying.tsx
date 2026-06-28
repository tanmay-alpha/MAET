import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowUp, ArrowDown, Calendar, TrendingUp } from "lucide-react";
import { DataBadge } from "@/components/common/data-badge";
import { EmptyState } from "@/components/common/empty-state";
import { ContractPanel } from "@/components/common/contract-panel";

export const Route = createFileRoute("/_app/options/$underlying")({
  head: () => ({ meta: [{ title: "Options Chain — MAET" }] }),
  component: OptionsChain,
});

function OptionsChain() {
  const [expiry, setExpiry] = useState("28 Jun 2026");
  const [selectedTab, setSelectedTab] = useState<"calls" | "puts">("calls");

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div>
          <h1 className="text-lg font-semibold">Options Chain</h1>
          <p className="text-sm text-muted-foreground">RELIANCE — NSE</p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">LTP:</span>
          <span className="font-mono tabular font-semibold">₹2,450.00</span>
          <span className="text-bull">+1.2%</span>
        </div>
      </div>

      {/* Symbol selector and date picker */}
      <div className="flex items-center justify-between border-b border-border px-5 py-2">
        <select aria-label="Select underlying symbol" className="rounded-md border border-border bg-panel px-2.5 py-1.5 text-sm outline-none focus:border-primary">
          <option>RELIANCE</option>
          <option>BANKNIFTY</option>
          <option>NIFTY</option>
        </select>

        <div className="flex items-center gap-2">
          <button type="button" className="rounded-md border border-border bg-panel px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground">
            <Calendar className="h-3 w-3 mr-1 inline" /> 28 Jun 2026
          </button>
          <button type="button" className="rounded-md border border-border bg-panel px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground">
            <Calendar className="h-3 w-3 mr-1 inline" /> 31 Jul 2026
          </button>
        </div>
      </div>

      {/* Call/Put tabs */}
      <div className="flex items-center gap-1 border-b border-border bg-panel px-2">
        <button
          type="button"
          onClick={() => setSelectedTab("calls")}
          className={`rounded-t px-3 py-2 text-sm ${selectedTab === "calls" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          Calls
          <span className="ml-1 text-xs bg-bull/20 text-bull px-1 rounded">24</span>
        </button>
        <button
          type="button"
          onClick={() => setSelectedTab("puts")}
          className={`rounded-t px-3 py-2 text-sm ${selectedTab === "puts" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          Puts
          <span className="ml-1 text-xs bg-bear/20 text-bear px-1 rounded">24</span>
        </button>
      </div>

      {/* Options table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-background">
            <tr className="border-b border-border">
              <th className="px-4 py-2 text-left text-xs uppercase tracking-wider text-muted-foreground">Strike</th>
              <th className="px-4 py-2 text-right text-xs uppercase tracking-wider text-muted-foreground">OI</th>
              <th className="px-4 py-2 text-right text-xs uppercase tracking-wider text-muted-foreground">Chg OI</th>
              <th className="px-4 py-2 text-right text-xs uppercase tracking-wider text-muted-foreground">Volume</th>
              <th className="px-4 py-2 text-right text-xs uppercase tracking-wider text-muted-foreground">IV</th>
              <th className="px-4 py-2 text-right text-xs uppercase tracking-wider text-muted-foreground">LTP</th>
              <th className="px-4 py-2 text-right text-xs uppercase tracking-wider text-muted-foreground">P&L</th>
            </tr>
          </thead>
          <tbody>
            {/* Strike price 2400 */}
            <tr className="border-b border-border">
              <td className="px-4 py-2 font-medium">2400</td>
              <td className="px-4 py-2 text-right font-mono tabular">15,234</td>
              <td className="px-4 py-2 text-right font-mono tabular text-bull">+523</td>
              <td className="px-4 py-2 text-right font-mono tabular">2,845</td>
              <td className="px-4 py-2 text-right font-mono tabular">18.5%</td>
              <td className="px-4 py-2 text-right font-mono tabular text-bull">85.50</td>
              <td className="px-4 py-2 text-right font-mono tabular text-bull">+12.5</td>
            </tr>

            {/* Strike price 2425 */}
            <tr className="border-b border-border">
              <td className="px-4 py-2 font-medium">2425</td>
              <td className="px-4 py-2 text-right font-mono tabular">22,456</td>
              <td className="px-4 py-2 text-right font-mono tabular text-bull">+1,234</td>
              <td className="px-4 py-2 text-right font-mono tabular">4,567</td>
              <td className="px-4 py-2 text-right font-mono tabular">19.2%</td>
              <td className="px-4 py-2 text-right font-mono tabular text-bull">65.20</td>
              <td className="px-4 py-2 text-right font-mono tabular text-bull">+8.7</td>
            </tr>

            {/* ATM Strike 2450 */}
            <tr className="border-b border-border bg-primary/5">
              <td className="px-4 py-2 font-semibold">2450</td>
              <td className="px-4 py-2 text-right font-mono tabular">28,934</td>
              <td className="px-4 py-2 text-right font-mono tabular text-bull">+2,456</td>
              <td className="px-4 py-2 text-right font-mono tabular">6,789</td>
              <td className="px-4 py-2 text-right font-mono tabular">20.1%</td>
              <td className="px-4 py-2 text-right font-mono tabular text-bull">48.90</td>
              <td className="px-4 py-2 text-right font-mono tabular">0.0</td>
            </tr>

            {/* Strike price 2475 */}
            <tr className="border-b border-border">
              <td className="px-4 py-2 font-medium">2475</td>
              <td className="px-4 py-2 text-right font-mono tabular">18,234</td>
              <td className="px-4 py-2 text-right font-mono tabular text-bear">-876</td>
              <td className="px-4 py-2 text-right font-mono tabular">3,456</td>
              <td className="px-4 py-2 text-right font-mono tabular">19.8%</td>
              <td className="px-4 py-2 text-right font-mono tabular text-bear">35.60</td>
              <td className="px-4 py-2 text-right font-mono tabular text-bear">-8.5</td>
            </tr>

            {/* Strike price 2500 */}
            <tr className="border-b border-border">
              <td className="px-4 py-2 font-medium">2500</td>
              <td className="px-4 py-2 text-right font-mono tabular">9,876</td>
              <td className="px-4 py-2 text-right font-mono tabular text-bear">-456</td>
              <td className="px-4 py-2 text-right font-mono tabular">1,234</td>
              <td className="px-4 py-2 text-right font-mono tabular">18.5%</td>
              <td className="px-4 py-2 text-right font-mono tabular text-bear">25.30</td>
              <td className="px-4 py-2 text-right font-mono tabular text-bear">-15.2</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Bottom panel */}
      <div className="border-t border-border bg-panel p-3 text-center text-xs text-muted-foreground">
        <ContractPanel message="Options data provider pending — showing mock chain structure for display purposes" />
      </div>
    </div>
  );
}

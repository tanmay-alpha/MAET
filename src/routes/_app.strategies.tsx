import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Activity, ArrowUpRight, GitCompareArrows, BarChart3, Layers, TrendingUp, TrendingDown, ArrowDownRight } from "lucide-react";
import { StrategyBuilder } from "@/components/options/strategy-builder";
import { ContractPanel } from "@/components/common/contract-panel";

export const Route = createFileRoute("/_app/strategies")({
  head: () => ({ meta: [{ title: "Strategies — MAET" }] }),
  component: Strategies,
});

type TabType = "presets" | "builder";

function Strategies() {
  const [activeTab, setActiveTab] = useState<TabType>("presets");

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-3">
          <Layers className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">Options Strategies</h1>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <button
            onClick={() => setActiveTab("presets")}
            className={`rounded-md border px-3 py-1.5 ${
              activeTab === "presets"
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            Strategy Presets
          </button>
          <button
            onClick={() => setActiveTab("builder")}
            className={`rounded-md border px-3 py-1.5 ${
              activeTab === "builder"
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            Strategy Builder
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === "presets" ? <StrategyPresets setActiveTab={setActiveTab} /> : <StrategyBuilderContent />}
      </div>

      {/* Bottom panel */}
      <div className="border-t border-border bg-panel p-3 text-center text-xs text-muted-foreground">
        <ContractPanel message="Strategy builder with real-time payoff visualization — connect broker for live orders" />
      </div>
    </div>
  );
}

function StrategyPresets({ setActiveTab }: { setActiveTab: (tab: TabType) => void }) {
  const presets = [
    {
      id: "straddle",
      name: "Straddle",
      type: "neutral",
      icon: GitCompareArrows,
      description: "Buy ATM Call + Buy ATM Put at same strike. Profits from large moves in either direction.",
      maxProfit: "Unlimited",
      maxLoss: "Net Premium",
      breakeven: "Strike ± Net Premium",
      bestFor: "High volatility events (earnings, RBI policy)",
      color: "text-purple-400",
    },
    {
      id: "strangle",
      name: "Strangle",
      type: "neutral",
      icon: Layers,
      description: "Buy OTM Call + Buy OTM Put. Lower cost than straddle, needs bigger move to profit.",
      maxProfit: "Unlimited",
      maxLoss: "Net Premium",
      breakeven: "Strike ± (Net Premium + Distance)",
      bestFor: "Expecting volatility but unsure of direction",
      color: "text-indigo-400",
    },
    {
      id: "iron_condor",
      name: "Iron Condor",
      type: "range_bound",
      icon: BarChart3,
      description: "Sell OTM Call Spread + Sell OTM Put Spread. Profits when price stays within range.",
      maxProfit: "Net Credit",
      maxLoss: "Width - Net Credit",
      breakeven: "Lower BE: Lower Short Strike - Net Credit / Upper BE: Upper Short Strike + Net Credit",
      bestFor: "Low volatility, expecting consolidation",
      color: "text-cyan-400",
    },
    {
      id: "bull_call_spread",
      name: "Bull Call Spread",
      type: "bullish",
      icon: TrendingUp,
      description: "Buy Call at lower strike, Sell Call at higher strike. Debit spread with limited risk.",
      maxProfit: "Strike Width - Net Premium",
      maxLoss: "Net Premium Paid",
      breakeven: "Lower Strike + Net Premium",
      bestFor: "Moderately bullish outlook",
      color: "text-bull",
    },
    {
      id: "bear_put_spread",
      name: "Bear Put Spread",
      type: "bearish",
      icon: TrendingDown,
      description: "Buy Put at higher strike, Sell Put at lower strike. Debit spread with limited risk.",
      maxProfit: "Strike Width - Net Premium",
      maxLoss: "Net Premium Paid",
      breakeven: "Higher Strike - Net Premium",
      bestFor: "Moderately bearish outlook",
      color: "text-bear",
    },
    {
      id: "ratio_spread",
      name: "Ratio Spread",
      type: "neutral",
      icon: Activity,
      description: "Buy 2 OTM Puts, Sell 1 ATM Put (1:2 ratio). Credits premium, profits from range-bound action.",
      maxProfit: "Limited (Strike Width - Net Credit)",
      maxLoss: "Unlimited on sharp decline",
      breakeven: "Short Strike - Net Credit",
      bestFor: "Slightly bearish to neutral with downside protection",
      color: "text-amber-400",
    },
    {
      id: "butterfly_spread",
      name: "Butterfly Spread",
      type: "neutral",
      icon: ArrowUpRight,
      description: "Buy 1 ITM, Sell 2 ATM, Buy 1 OTM Call at equal intervals. Maximum profit at exact ATM strike.",
      maxProfit: "Difference between strikes - Net Premium",
      maxLoss: "Net Premium Paid",
      breakeven: "Lower: Lower Strike + Net Premium / Upper: Upper Strike - Net Premium",
      bestFor: "Expecting price to stay near current level",
      color: "text-pink-400",
    },
    {
      id: "iron_butterfly",
      name: "Iron Butterfly",
      type: "neutral",
      icon: ArrowDownRight,
      description: "Short Straddle + Long OTM Strangle. Defined risk on both sides, profits from low volatility.",
      maxProfit: "Short Strike - Long Strike + Net Credit",
      maxLoss: "Short Strike - Long Strike - Net Credit",
      breakeven: "Center Strike ± Net Credit",
      bestFor: "Very low volatility, price pinned to center strike",
      color: "text-teal-400",
    },
  ];

  const typeColors: Record<string, string> = {
    bullish: "bg-bull/10 border-bull/30",
    bearish: "bg-bear/10 border-bear/30",
    neutral: "bg-purple-500/10 border-purple-500/30",
    range_bound: "bg-cyan-500/10 border-cyan-500/30",
  };

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mb-4">
        <p className="text-xs text-muted-foreground">
          Pre-built strategies with payoff diagrams. Select &quot;Strategy Builder&quot; to customize.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {presets.map((preset) => (
          <div key={preset.id} className="rounded-lg border border-border bg-panel p-4">
            <div className="flex items-start gap-3">
              <div className={`rounded-md bg-background p-2 ${preset.color}`}>
                <preset.icon className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <div className="font-semibold">{preset.name}</div>
                  <span className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${typeColors[preset.type]}`}>
                    {preset.type.replace("_", " ")}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{preset.description}</p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 rounded bg-background p-2 text-[10px]">
              <div>
                <div className="text-muted-foreground">Max Profit</div>
                <div className="mt-0.5 font-mono font-medium text-bull">{preset.maxProfit}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Max Loss</div>
                <div className="mt-0.5 font-mono font-medium text-bear">{preset.maxLoss}</div>
              </div>
              <div className="col-span-2">
                <div className="text-muted-foreground">Best For</div>
                <div className="mt-0.5 text-muted-foreground">{preset.bestFor}</div>
              </div>
            </div>

            <div className="mt-4 border-t border-border pt-3">
              <Link
                to="/strategies"
                className="inline-flex items-center gap-1.5 rounded bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20"
                onClick={(e) => {
                  e.preventDefault();
                  setActiveTab("builder");
                }}
              >
                Build This <ArrowUpRight className="h-3 w-3" />
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StrategyBuilderContent() {
  const underlying = "RELIANCE";
  const spot = 2450;

  return (
    <div className="h-full overflow-hidden">
      <StrategyBuilder underlying={underlying} spot={spot} />
    </div>
  );
}
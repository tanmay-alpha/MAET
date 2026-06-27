import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity, ArrowUpRight, GitCompareArrows } from "lucide-react";

export const Route = createFileRoute("/_app/strategies")({
  head: () => ({ meta: [{ title: "Strategies — MAET" }] }),
  component: Strategies,
});

const templates = [
  {
    id: "sma_cross",
    name: "SMA crossover",
    description: "Long-only trend strategy. Buy when the fast moving average crosses above the slow average; exit on the reverse cross.",
    defaults: "Fast 20 · Slow 50",
    icon: GitCompareArrows,
  },
  {
    id: "rsi",
    name: "RSI reversal",
    description: "Long-only mean-reversion strategy. Enter when RSI recovers from oversold and exit when it falls back from overbought.",
    defaults: "Period 14 · 30 / 70",
    icon: Activity,
  },
];

function Strategies() {
  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mb-4">
        <h1 className="text-xl font-semibold">Strategy templates</h1>
        <p className="text-xs text-muted-foreground">Two deterministic engines are available. No fabricated live performance is shown.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {templates.map((template) => (
          <div key={template.id} className="rounded-lg border border-border bg-panel p-5">
            <div className="flex items-start gap-3">
              <div className="rounded-md bg-primary/15 p-2 text-primary"><template.icon className="h-5 w-5" /></div>
              <div>
                <div className="font-semibold">{template.name}</div>
                <div className="mt-1 text-xs text-muted-foreground">{template.defaults}</div>
              </div>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{template.description}</p>
            <div className="mt-5 border-t border-border pt-4">
              <Link to="/backtest" className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground">
                Run on real candles <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-lg border border-border bg-panel px-5 py-8 text-center">
        <div className="text-sm font-medium">No deployed strategies</div>
        <div className="mt-1 text-xs text-muted-foreground">MAET currently performs research backtests and browser-only paper orders. It does not route automated broker orders.</div>
      </div>
    </div>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, Activity, FlaskConical, Table2, LineChart, Layers, Github, Keyboard } from "lucide-react";
import { INDICES, WATCHLIST } from "@/lib/market-catalog";
import { useMarketCandles } from "@/hooks/use-market-candles";
import { useMarketQuotes } from "@/hooks/use-market-quotes";
import { TiltCard } from "@/components/trading/tilt-card";
import { LiveTape } from "@/components/trading/live-tape";
import { DepthMeter } from "@/components/trading/depth-meter";
import { LiveMiniChart } from "@/components/trading/live-mini-chart";
import { MarketHeatmap } from "@/components/trading/market-heatmap";
import { BreadthGauge } from "@/components/trading/breadth-gauge";
import { FlowsWidget } from "@/components/trading/flows-widget";
import { SectorStrip } from "@/components/trading/sector-strip";
import { Loadable, ChartSkeleton, RowsSkeleton, Skel } from "@/components/trading/skeleton";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MAET — Market scanner & research terminal for Indian markets" },
      { name: "description", content: "Scan NSE & BSE, study tick-grade charts, paper-trade and prototype strategies. A research terminal — not a broker." },
      { property: "og:title", content: "MAET — Scanner & research terminal" },
      { property: "og:description", content: "Scan, chart, paper-trade and prototype. Indian markets, one workspace." },
    ],
  }),
  component: Landing,
});

const INDEX_KEYS: Record<string, string> = {
  "NIFTY 50": "NIFTY50",
  "BANK NIFTY": "BANKNIFTY",
  SENSEX: "SENSEX",
  "NIFTY IT": "NIFTYIT",
  "NIFTY FMCG": "NIFTYFMCG",
  "INDIA VIX": "INDIAVIX",
};
const LANDING_SYMBOLS = [
  ...WATCHLIST.map((item) => item.symbol),
  ...Object.values(INDEX_KEYS),
];

function LiveTickerCell({ symbol, price, change }: { symbol: string; price?: number; change?: number }) {
  const dir = change === undefined || change === 0 ? "flat" : change > 0 ? "up" : "down";
  return (
    <div className="flex items-center gap-2 px-5 text-xs">
      <span className="font-semibold tracking-wide">{symbol}</span>
      <span className="font-mono tabular text-foreground rounded-sm px-1">
        {price?.toLocaleString("en-IN", { maximumFractionDigits: 2 }) ?? "—"}
      </span>
      <span className={`font-mono tabular text-[10px] ${dir === "up" ? "text-bull" : dir === "down" ? "text-bear" : "text-muted-foreground"}`}>
        {dir === "up" ? "▲" : dir === "down" ? "▼" : "▬"}
      </span>
    </div>
  );
}

function IndexCard({ symbol, price, changePct }: { symbol: string; price?: number; changePct?: number }) {
  const positive = (changePct ?? 0) >= 0;
  return (
    <div className="group relative overflow-hidden rounded-lg border border-border bg-panel/60 px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{symbol}</span>
        <span className={`h-1.5 w-1.5 rounded-full ${positive ? "bg-bull" : "bg-bear"}`} />
      </div>
      <div className="mt-1 font-mono tabular text-lg font-semibold">
        {price?.toLocaleString("en-IN", { maximumFractionDigits: 2 }) ?? "—"}
      </div>
      <div className={`font-mono tabular text-[11px] ${positive ? "text-bull" : "text-bear"}`}>
        {changePct === undefined ? "Waiting for quote" : `${positive ? "+" : ""}${changePct.toFixed(2)}%`}
      </div>
    </div>
  );
}

function Landing() {
  const { quoteMap, streamConnected } = useMarketQuotes(LANDING_SYMBOLS);
  const relianceQuote = quoteMap.get("RELIANCE");
  const relianceCandles = useMarketCandles("RELIANCE", "5m", "5d");
  const chartCloses = (relianceCandles.data?.candles ?? []).map((candle) => candle.close).slice(-90);
  const latestBar = relianceCandles.data?.candles.at(-1);
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav — single Open Terminal button lives here */}
      <header className="sticky top-0 z-50 border-b border-border/60 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="relative flex h-8 w-8 items-center justify-center rounded-md surface-2">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="square">
                <path d="M3 19 L8 9 L13 14 L21 4" className="text-primary" />
                <path d="M15 4 L21 4 L21 10" className="text-primary" />
              </svg>
            </div>
            <div className="leading-none">
              <div className="text-[15px] font-semibold tracking-[0.18em]">MAET</div>
              <div className="text-[9px] uppercase tracking-[0.22em] text-muted-foreground">Market · Edge · Terminal</div>
            </div>
          </Link>
          <nav className="ml-12 hidden gap-7 text-sm text-muted-foreground md:flex">
            <a className="hover:text-foreground" href="#scanner">Scanner</a>
            <a className="hover:text-foreground" href="#heatmap">Heatmap</a>
            <a className="hover:text-foreground" href="#paper">Paper trading</a>
            <a className="hover:text-foreground" href="#lab">Strategy lab</a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <a
              href="https://github.com/tanmay-alpha/MAET"
              target="_blank"
              rel="noreferrer"
              className="hidden items-center gap-1.5 rounded-md border border-border bg-panel px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground md:flex"
            >
              <Github className="h-3.5 w-3.5" /> Source
            </a>
            <Link
              to="/terminal"
              className="group flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition hover:opacity-95"
            >
              Open terminal <ArrowUpRight className="h-3.5 w-3.5 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* Live ticker */}
      <div className="border-b border-border bg-panel/80 overflow-hidden">
        <div className="flex ticker-scroll whitespace-nowrap py-2">
          {[...WATCHLIST, ...WATCHLIST].map((w, i) => (
            <LiveTickerCell
              key={i}
              symbol={w.symbol}
              price={quoteMap.get(w.symbol)?.price}
              change={quoteMap.get(w.symbol)?.change}
            />
          ))}
        </div>
      </div>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 mesh-bg" />
        <div className="absolute inset-0 grid-overlay" />
        <div className="absolute inset-0 noise-overlay opacity-50" />

        <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-6 pt-20 pb-24 lg:grid-cols-[1.05fr_1fr]">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-panel/70 px-3 py-1 text-[11px] text-muted-foreground backdrop-blur">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inset-0 animate-ping rounded-full bg-bull/70" />
                <span className="relative h-1.5 w-1.5 rounded-full bg-bull" />
              </span>
              <span className="font-mono tabular">NSE · SENSEX</span>
              <span className="text-muted-foreground/60">/</span>
              <span>Research terminal — not a broker</span>
            </div>

            <h1 className="mt-6 font-serif text-[clamp(2.6rem,7vw,5.5rem)] leading-[1.02] tracking-[-0.02em]">
              Scan the market.
              <br />
              Chart it. <em className="text-primary not-italic font-serif italic">Paper-trade</em>
              <br />
              before you risk it.
            </h1>

            <p className="mt-6 max-w-lg text-base leading-relaxed text-muted-foreground">
              MAET is a research terminal for Indian equities — a delayed-market chart,
              a paper-trading desk, and a strategy lab. No order routing, no broker integration,
              no real money. Just the workspace you wish you had while studying the market.
            </p>

            {/* Quick links — secondary, not duplicate CTAs */}
            <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
              <a href="#scanner" className="inline-flex items-center gap-1 hover:text-foreground">
                <Table2 className="h-3.5 w-3.5 text-primary" /> Browse the scanner
              </a>
              <span className="text-border">·</span>
              <a href="#paper" className="inline-flex items-center gap-1 hover:text-foreground">
                <Activity className="h-3.5 w-3.5 text-primary" /> Paper trading
              </a>
              <span className="text-border">·</span>
              <a href="#lab" className="inline-flex items-center gap-1 hover:text-foreground">
                <FlaskConical className="h-3.5 w-3.5 text-primary" /> Strategy lab
              </a>
            </div>

            {/* Honest meta strip — no fake metrics */}
            <div className="mt-12 grid max-w-md grid-cols-3 gap-px overflow-hidden rounded-lg border border-border bg-border">
              <div className="bg-panel/80 px-4 py-3">
                <div className="font-mono tabular text-foreground text-base font-semibold">NSE · BSE</div>
                <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">coverage</div>
              </div>
              <div className="bg-panel/80 px-4 py-3">
                <div className="font-mono tabular text-foreground text-base font-semibold">Paper only</div>
                <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">no real orders</div>
              </div>
              <div className="bg-panel/80 px-4 py-3">
                <div className="font-mono tabular text-foreground text-base font-semibold">Open source</div>
                <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">MIT licensed</div>
              </div>
            </div>
          </div>

          {/* 3D chart card */}
          <div className="relative">
            <TiltCard className="relative" max={10}>
              <div className="tilt-layer rounded-2xl border border-border bg-panel/95 shadow-[0_40px_80px_-30px_rgba(0,0,0,0.6)] backdrop-blur-xl" style={{ ["--z" as string]: "0px" }}>
                <div className="flex items-center justify-between border-b border-border px-5 py-3">
                  <div className="flex items-baseline gap-2.5">
                    <div className="font-semibold tracking-tight">RELIANCE</div>
                    <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">NSE · Equity</div>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono tabular font-semibold">
                      {relianceQuote?.price.toLocaleString("en-IN", { minimumFractionDigits: 2 }) ?? "—"}
                    </span>
                    <span className={`font-mono tabular text-xs ${(relianceQuote?.changePct ?? 0) >= 0 ? "text-bull" : "text-bear"}`}>
                      {relianceQuote?.changePct === undefined
                        ? "Waiting for quote"
                        : `${relianceQuote.changePct >= 0 ? "+" : ""}${relianceQuote.changePct.toFixed(2)}%`}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1 border-b border-border px-3 py-1.5 text-[11px]">
                  {["1m", "5m", "15m", "1h", "1D"].map((i, idx) => (
                    <span key={i} className={`rounded px-2 py-0.5 ${idx === 1 ? "bg-accent text-foreground" : "text-muted-foreground"}`}>{i}</span>
                  ))}
                  <span className="ml-auto flex items-center gap-1 text-[10px] text-bull">
                    <span className="relative flex h-1.5 w-1.5"><span className="absolute inset-0 animate-ping rounded-full bg-bull/70" /><span className="relative h-1.5 w-1.5 rounded-full bg-bull" /></span>
                    {streamConnected ? "Yahoo delayed feed" : "Connecting to market feed"}
                  </span>
                </div>
                <div className="px-1">
                  <LiveMiniChart data={chartCloses} height={260} />
                </div>
                <div className="grid grid-cols-4 gap-px border-t border-border bg-border text-xs">
                  {[
                    { l: "Open", v: latestBar?.open.toFixed(2) ?? "—" },
                    { l: "High", v: latestBar?.high.toFixed(2) ?? "—", c: "text-bull" },
                    { l: "Low", v: latestBar?.low.toFixed(2) ?? "—", c: "text-bear" },
                    { l: "Bar vol", v: latestBar ? latestBar.volume.toLocaleString("en-IN") : "—" },
                  ].map((s) => (
                    <div key={s.l} className="bg-panel px-3 py-2">
                      <div className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground">{s.l}</div>
                      <div className={`font-mono tabular ${s.c ?? ""}`}>{s.v}</div>
                    </div>
                  ))}
                </div>
              </div>
            </TiltCard>

            {/* floating depth meter */}
            <div className="absolute -left-6 -bottom-8 hidden w-60 float-y lg:block">
              <TiltCard max={6}>
                <DepthMeter />
              </TiltCard>
            </div>
          </div>
        </div>
      </section>

      {/* Live indices strip */}
      <section id="scanner" className="border-y border-border bg-panel/30">
        <div className="mx-auto max-w-7xl px-6 py-10">
          <div className="mb-5 flex items-end justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-[0.22em] text-primary">Scanner</div>
              <h2 className="mt-1 font-serif text-2xl tracking-tight md:text-3xl">Indices &amp; sectors at a glance.</h2>
            </div>
            <div className="font-mono tabular text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              {streamConnected ? "Yahoo delayed · live connection" : "Connecting to market data"}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            {INDICES.map((i) => (
              <IndexCard
                key={i.symbol}
                symbol={i.symbol}
                price={quoteMap.get(INDEX_KEYS[i.symbol])?.price}
                changePct={quoteMap.get(INDEX_KEYS[i.symbol])?.changePct}
              />
            ))}
          </div>
          <div className="mt-6"><SectorStrip /></div>
        </div>
      </section>

      {/* Heatmap + breadth + flows */}
      <section id="heatmap" className="border-b border-border">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <div className="mb-8 grid items-end gap-4 md:grid-cols-[1fr_auto]">
            <div>
              <div className="text-[10px] uppercase tracking-[0.22em] text-primary">Heatmap</div>
              <h2 className="mt-2 font-serif text-4xl leading-[1.05] tracking-[-0.01em] md:text-5xl">
                NIFTY 50 — <em className="italic text-muted-foreground/80">by weight &amp; flow.</em>
              </h2>
            </div>
            <p className="max-w-sm text-sm text-muted-foreground">
              Treemap and watchlist breadth use the latest delayed Yahoo quotes. Institutional flows stay
              blank because no verified upstream is connected.
            </p>
          </div>
          <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
            <TiltCard max={4}>
              <div className="rounded-xl border border-border surface-1 p-3 shimmer-line">
                <div className="mb-2 flex items-center justify-between px-1 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  <span>NIFTY 50 · weighted</span>
                  <span className="flex items-center gap-2">
                    <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-bear/80" /> -3%</span>
                    <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-bull/80" /> +3%</span>
                  </span>
                </div>
                <Loadable delay={700} skeleton={<ChartSkeleton height={360} />}>
                  <MarketHeatmap height={360} />
                </Loadable>
              </div>
            </TiltCard>
            <div className="grid gap-4">
              <Loadable delay={900} skeleton={<div className="rounded-lg border border-border bg-panel p-5 space-y-3"><Skel w={140} h={10} /><Skel w="100%" h={120} /><Skel w="100%" h={6} /><div className="flex justify-between"><Skel w={50} h={10} /><Skel w={50} h={10} /></div></div>}>
                <BreadthGauge />
              </Loadable>
              <Loadable delay={1100} skeleton={<div className="rounded-lg border border-border bg-panel p-5"><Skel w={120} h={10} className="mb-4" /><RowsSkeleton rows={4} /></div>}>
                <FlowsWidget />
              </Loadable>
            </div>
          </div>
        </div>
      </section>

      {/* Paper trading workspace */}
      <section id="paper" className="mx-auto max-w-7xl px-6 py-24">
        <div className="grid items-start gap-12 lg:grid-cols-[1fr_1.1fr]">
          <div className="sticky top-24">
            <div className="text-[10px] uppercase tracking-[0.22em] text-primary">Paper trading</div>
            <h2 className="mt-2 font-serif text-4xl leading-[1.05] tracking-[-0.01em] md:text-5xl">
              Practice the desk. <em className="text-muted-foreground/80 italic">Risk nothing.</em>
            </h2>
            <p className="mt-5 max-w-md text-sm leading-relaxed text-muted-foreground">
              Place browser-only paper orders against the latest delayed market quote and track positions
              without risking money. Nothing leaves the browser and no broker order is sent.
            </p>

            <ul className="mt-7 space-y-3 text-sm">
              {[
                ["Real quote marks", "Paper fills and positions use the Yahoo market quote, not a random walk."],
                ["Honest data limits", "Order-book depth and institutional flows remain blank without a verified feed."],
                ["Play-money P&L", "Reset any time. Market, limit, and stop orders stay in this browser."],
                ["Keyboard-first", "B / S to ticket, ⌘K to jump symbols, Esc to cancel."],
              ].map(([t, d]) => (
                <li key={t} className="flex gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  <div>
                    <div className="font-medium">{t}</div>
                    <div className="text-muted-foreground">{d}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <TiltCard max={5} className="sm:col-span-2">
              <LiveTape rows={10} />
            </TiltCard>
            <TiltCard max={5}><DepthMeter /></TiltCard>
            <div className="rounded-md border border-border bg-panel/70 p-4">
              <div className="flex items-center justify-between">
                <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Paper P&amp;L</div>
                <span className="rounded-sm bg-accent px-1.5 py-0.5 text-[9px] uppercase tracking-[0.16em] text-muted-foreground">simulated</span>
              </div>
              <div className="mt-1 font-mono tabular text-3xl font-semibold">₹0.00</div>
              <div className="mt-1 font-mono tabular text-[11px] text-muted-foreground">No paper trades recorded in this browser</div>
            </div>
          </div>
        </div>
      </section>

      {/* Strategy lab — replaces "engine" / "deploy" marketing */}
      <section id="lab" className="border-t border-border bg-panel/30">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <div className="mb-12 grid items-end gap-6 md:grid-cols-[1fr_auto]">
            <div>
              <div className="text-[10px] uppercase tracking-[0.22em] text-primary">Strategy lab</div>
              <h2 className="mt-2 font-serif text-4xl leading-[1.05] tracking-[-0.01em] md:text-5xl">
                Prototype an idea. <em className="italic">See it on paper.</em>
              </h2>
            </div>
            <p className="max-w-sm text-sm text-muted-foreground">
              A sandbox to sketch a rule-set, replay it on historical candles, and run it forward against
              the paper desk. No deployment to brokers — this is a research tool.
            </p>
          </div>

          <div className="grid gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-3">
            {[
              { icon: LineChart, t: "Tick-grade charts", d: "Candles, indicators, drawing tools, multi-timeframe. Built for reading, not for screenshots." },
              { icon: Table2, t: "Stock screener", d: "Filter NSE/BSE universe by fundamentals, momentum, breadth and your own derived columns." },
              { icon: FlaskConical, t: "Historical replay", d: "Step through past sessions candle-by-candle and watch your rules trigger as the day unfolds." },
              { icon: Activity, t: "Paper execution", d: "Place browser-only orders against delayed market quotes without sending anything to a broker." },
              { icon: Layers, t: "Versioned ideas", d: "Every tweak is its own revision. Compare equity curves side-by-side, keep the one that holds up." },
              { icon: Keyboard, t: "Keyboard-first UX", d: "Roving focus across screener rows, hotkeys in the terminal — TradingView-style ergonomics." },
            ].map((f) => (
              <div key={f.t} className="group relative bg-panel p-7 transition hover:bg-panel-elevated">
                <f.icon className="h-5 w-5 text-primary" />
                <div className="mt-5 font-medium tracking-tight">{f.t}</div>
                <div className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Markets coverage — honest, no CTA */}
      <section className="mx-auto max-w-7xl px-6 py-20">
        <div className="mb-8">
          <div className="text-[10px] uppercase tracking-[0.22em] text-primary">Coverage</div>
          <h2 className="mt-2 font-serif text-3xl tracking-tight md:text-4xl">Symbols you can study today.</h2>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            NSE equity quotes and candles are loaded from Yahoo Finance through the MAET backend. Quotes
            may be delayed and show the most recent completed session when the exchange is closed.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-3 lg:grid-cols-6">
          {["NSE Equity", "NSE Indices", "SENSEX"].map((m) => (
            <div key={m} className="bg-panel px-4 py-6 text-center text-sm tracking-tight">{m}</div>
          ))}
        </div>
      </section>

      {/* Closing band — no extra button, points to the only CTA above */}
      <section className="border-t border-border">
        <div className="relative mx-auto max-w-7xl overflow-hidden px-6 py-20">
          <div className="absolute inset-0 mesh-bg opacity-60" />
          <div className="relative">
            <h2 className="font-serif text-4xl leading-[1.05] tracking-[-0.01em] md:text-5xl">
              Scan. Read. <em className="italic text-primary">Rehearse.</em>
            </h2>
            <p className="mt-4 max-w-xl text-sm text-muted-foreground">
              The terminal lives one click away — top right of every page. There is only one door in,
              on purpose.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border bg-panel/50">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 px-6 py-10 text-xs text-muted-foreground md:flex-row md:items-center">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded surface-2">
                <svg viewBox="0 0 24 24" className="h-3 w-3 text-primary" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="square">
                  <path d="M3 19 L8 9 L13 14 L21 4" />
                  <path d="M15 4 L21 4 L21 10" />
                </svg>
              </div>
              <span className="text-sm font-semibold tracking-[0.18em] text-foreground">MAET</span>
              <span className="text-muted-foreground">— © 2026.</span>
            </div>
            <span className="max-w-2xl text-muted-foreground/80">
              Research &amp; education tool. Not a broker, not investment advice, and not a SEBI-registered
              intermediary. Market quotes are supplied by Yahoo Finance and may be delayed.
            </span>
          </div>
          <div className="flex gap-5">
            <a href="#" className="hover:text-foreground">Docs</a>
            <a href="#" className="hover:text-foreground">API</a>
            <a href="#" className="hover:text-foreground">Status</a>
            <a href="#" className="hover:text-foreground">Privacy</a>
            <a href="https://github.com/tanmay-alpha/MAET" target="_blank" rel="noreferrer" className="hover:text-foreground">GitHub</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

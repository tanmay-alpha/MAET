import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown, Search, Settings2, RefreshCw, Maximize2, Plus, Save, Filter, BarChart3, TableIcon } from "lucide-react";
import { useLivePrice } from "@/hooks/use-live-price";


export const Route = createFileRoute("/_app/screener")({
  head: () => ({ meta: [{ title: "Stock Screener — MAET" }] }),
  component: Screener,
});

type Row = {
  symbol: string;
  name: string;
  logo: string; // single letter
  logoColor: string;
  price: number;
  chgPct: number;
  vol: string;
  relVol: number;
  mktCap: string;
  pe: number;
  epsDil: number;
  epsGrowth: number;
  divYield: number;
  sector: string;
  rating: "Strong buy" | "Buy" | "Neutral" | "Sell" | "Strong sell";
};

const ROWS: Row[] = [
  { symbol: "RELIANCE", name: "Reliance Industries Limited", logo: "R", logoColor: "bg-amber-700", price: 1332.70, chgPct: 0.29, vol: "10.03 M", relVol: 0.54, mktCap: "17.97 T", pe: 22.33, epsDil: 59.69, epsGrowth: 15.97, divYield: 0.41, sector: "Energy minerals", rating: "Strong buy" },
  { symbol: "HDFCBANK", name: "HDFC Bank Limited", logo: "H", logoColor: "bg-red-600", price: 787.10, chgPct: 0.28, vol: "32.41 M", relVol: 0.95, mktCap: "12.08 T", pe: 15.98, epsDil: 49.27, epsGrowth: 6.65, divYield: 1.40, sector: "Finance", rating: "Strong buy" },
  { symbol: "BHARTIARTL", name: "Bharti Airtel Limited", logo: "B", logoColor: "bg-rose-600", price: 1875.70, chgPct: 1.23, vol: "7.65 M", relVol: 1.21, mktCap: "11.3 T", pe: 42.67, epsDil: 43.95, epsGrowth: -20.30, divYield: 0.86, sector: "Communications", rating: "Strong buy" },
  { symbol: "ICICIBANK", name: "ICICI Bank Limited", logo: "I", logoColor: "bg-orange-600", price: 1336.80, chgPct: 0.19, vol: "8.03 M", relVol: 0.43, mktCap: "9.57 T", pe: 17.88, epsDil: 74.78, epsGrowth: 7.35, divYield: 0.82, sector: "Finance", rating: "Strong buy" },
  { symbol: "SBIN", name: "State Bank of India", logo: "S", logoColor: "bg-blue-700", price: 1026.50, chgPct: 1.10, vol: "8.19 M", relVol: 0.48, mktCap: "9.37 T", pe: 11.28, epsDil: 91.03, epsGrowth: 4.74, divYield: 1.71, sector: "Finance", rating: "Strong buy" },
  { symbol: "TCS", name: "Tata Consultancy Services Limited", logo: "T", logoColor: "bg-slate-700", price: 2223.00, chgPct: 1.09, vol: "2.87 M", relVol: 0.57, mktCap: "7.96 T", pe: 16.34, epsDil: 136.01, epsGrowth: 1.35, divYield: 2.91, sector: "Technology services", rating: "Buy" },
  { symbol: "BAJFINANCE", name: "Bajaj Finance Limited", logo: "B", logoColor: "bg-indigo-700", price: 958.40, chgPct: -0.13, vol: "5.68 M", relVol: 0.58, mktCap: "5.97 T", pe: 31.40, epsDil: 30.52, epsGrowth: 13.77, divYield: 0.46, sector: "Finance", rating: "Buy" },
  { symbol: "LT", name: "Larsen & Toubro Limited", logo: "L", logoColor: "bg-yellow-700", price: 4207.70, chgPct: 0.51, vol: "1.31 M", relVol: 0.61, mktCap: "5.76 T", pe: 36.00, epsDil: 116.88, epsGrowth: 6.94, divYield: 0.91, sector: "Industrial services", rating: "Buy" },
  { symbol: "LICI", name: "Life Insurance Corp. of India", logo: "L", logoColor: "bg-blue-800", price: 418.15, chgPct: 1.74, vol: "4.16 M", relVol: 1.36, mktCap: "5.2 T", pe: 9.21, epsDil: 45.42, epsGrowth: 18.90, divYield: 1.46, sector: "Finance", rating: "Strong buy" },
  { symbol: "HINDUNILVR", name: "Hindustan Unilever Limited", logo: "H", logoColor: "bg-blue-600", price: 2197.60, chgPct: -0.10, vol: "1.51 M", relVol: 0.94, mktCap: "5.17 T", pe: 34.34, epsDil: 64.00, epsGrowth: 41.20, divYield: 1.95, sector: "Consumer non-durables", rating: "Buy" },
  { symbol: "INFY", name: "Infosys Limited", logo: "I", logoColor: "bg-blue-500", price: 1845.10, chgPct: 0.47, vol: "3.40 M", relVol: 0.78, mktCap: "4.92 T", pe: 25.10, epsDil: 73.49, epsGrowth: 8.10, divYield: 2.30, sector: "Technology services", rating: "Buy" },
  { symbol: "ITC", name: "ITC Limited", logo: "I", logoColor: "bg-yellow-600", price: 472.15, chgPct: 0.22, vol: "8.70 M", relVol: 0.62, mktCap: "5.89 T", pe: 28.45, epsDil: 16.59, epsGrowth: 2.10, divYield: 2.83, sector: "Consumer non-durables", rating: "Neutral" },
  { symbol: "MARUTI", name: "Maruti Suzuki India Limited", logo: "M", logoColor: "bg-red-700", price: 12845.00, chgPct: 1.12, vol: "0.40 M", relVol: 1.05, mktCap: "4.04 T", pe: 26.18, epsDil: 490.45, epsGrowth: 24.66, divYield: 0.99, sector: "Producer manufacturing", rating: "Strong buy" },
  { symbol: "AXISBANK", name: "Axis Bank Limited", logo: "A", logoColor: "bg-rose-700", price: 1158.90, chgPct: -0.79, vol: "3.60 M", relVol: 0.71, mktCap: "3.58 T", pe: 13.42, epsDil: 86.30, epsGrowth: 9.15, divYield: 0.10, sector: "Finance", rating: "Buy" },
];

const PILLS = [
  { label: "IN", flag: true },
  { label: "Watchlist" }, { label: "Index" }, { label: "Price" }, { label: "Chg %" }, { label: "Mkt cap" },
  { label: "P/E" }, { label: "EPS dil growth" }, { label: "Div yield %" }, { label: "Sector" },
  { label: "Analyst rating" }, { label: "Perf %" }, { label: "Revenue growth" },
];

const PILLS2 = [{ label: "PEG" }, { label: "ROE" }, { label: "Beta" }, { label: "Recent earnings date" }, { label: "Upcoming earnings date" }];

const TABS = ["Overview", "Performance", "Technicals", "Extended hours", "Valuation", "Dividends", "Profitability", "Income statement", "Balance sheet", "Cash flow"];

type SortKey = keyof Row;
type SortDir = "asc" | "desc";

function LivePriceCell({ base }: { base: number }) {
  const { price, dir, tick } = useLivePrice(base, { volatility: 0.0004, interval: 1800 });
  return (
    <span
      key={tick}
      className={`inline-block rounded-sm px-1 font-mono tabular ${dir === "up" ? "text-bull flash-bull" : dir === "down" ? "text-bear flash-bear" : ""}`}
    >
      {price.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      <span className="ml-1 text-[10px] text-muted-foreground">INR</span>
    </span>
  );
}

function RatingPill({ r }: { r: Row["rating"] }) {
  const cfg =
    r === "Strong buy" ? { dot: "text-bull", arrow: "▲▲" } :
    r === "Buy" ? { dot: "text-bull", arrow: "▲" } :
    r === "Neutral" ? { dot: "text-muted-foreground", arrow: "▬" } :
    r === "Sell" ? { dot: "text-bear", arrow: "▼" } :
    { dot: "text-bear", arrow: "▼▼" };
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${cfg.dot}`}>
      <span className="font-mono text-[10px]">{cfg.arrow}</span>{r}
    </span>
  );
}

function Screener() {
  const [selected, setSelected] = useState<string | null>("RELIANCE");
  const [focusIdx, setFocusIdx] = useState<number>(0);
  const [sortKey, setSortKey] = useState<SortKey>("mktCap");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [query, setQuery] = useState("");
  const tbodyRef = useRef<HTMLTableSectionElement>(null);

  // keep DOM focus aligned with focusIdx (after arrow key)
  useEffect(() => {
    const el = tbodyRef.current?.querySelector<HTMLTableRowElement>(`tr[data-idx="${focusIdx}"]`);
    el?.focus({ preventScroll: false });
  }, [focusIdx]);


  const rows = useMemo(() => {
    const filtered = ROWS.filter((r) =>
      r.symbol.toLowerCase().includes(query.toLowerCase()) ||
      r.name.toLowerCase().includes(query.toLowerCase())
    );
    const parseSize = (s: string) => parseFloat(s); // T/M ignored for relative sort
    return [...filtered].sort((a, b) => {
      const va = a[sortKey]; const vb = b[sortKey];
      const na = typeof va === "string" ? parseSize(va) : (va as number);
      const nb = typeof vb === "string" ? parseSize(vb) : (vb as number);
      return sortDir === "asc" ? na - nb : nb - na;
    });
  }, [sortKey, sortDir, query]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir("desc"); }
  };

  const Th = ({ k, label, align = "right" }: { k: SortKey; label: string; align?: "left" | "right" }) => (
    <th
      onClick={() => toggleSort(k)}
      className={`group cursor-pointer select-none px-3 py-2.5 text-tv-caps font-medium text-muted-foreground hover:text-foreground ${align === "right" ? "text-right" : "text-left"}`}
    >
      <span className="inline-flex items-center gap-1">
        {sortKey === k && <span className="text-foreground">{sortDir === "asc" ? "↑" : "↓"}</span>}
        {label}
      </span>
    </th>
  );

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Top header */}
      <div className="border-b border-border px-5 pt-4 pb-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Stock Screener</span>
          <ChevronDown className="h-3 w-3" />
        </div>
        <div className="mt-1 flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">All stocks</h1>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
          <button className="ml-2 inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
            <Save className="h-3.5 w-3.5" /> Save
          </button>
          <div className="ml-auto flex items-center gap-1">
            <button className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"><RefreshCw className="h-4 w-4" /></button>
            <button className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"><Settings2 className="h-4 w-4" /></button>
          </div>
        </div>

        {/* Filter pills */}
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          {PILLS.map((p) => (
            <button key={p.label} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-panel px-2.5 py-1 text-xs text-foreground hover:bg-panel-elevated">
              {p.flag && <span className="text-[10px]">🇮🇳</span>}
              {p.label}
              {!p.flag && <ChevronDown className="h-3 w-3 text-muted-foreground" />}
            </button>
          ))}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {PILLS2.map((p) => (
            <button key={p.label} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-panel px-2.5 py-1 text-xs text-foreground hover:bg-panel-elevated">
              {p.label}<ChevronDown className="h-3 w-3 text-muted-foreground" />
            </button>
          ))}
          <button className="inline-flex items-center justify-center rounded-md border border-border bg-panel p-1.5 text-muted-foreground hover:bg-panel-elevated"><Plus className="h-3.5 w-3.5" /></button>
          <button className="inline-flex items-center justify-center rounded-md border border-border bg-panel px-2 py-1.5 text-xs text-muted-foreground hover:bg-panel-elevated">•••</button>
        </div>
      </div>

      {/* Tabs row */}
      <div className="flex items-center gap-1 border-b border-border px-3">
        <div className="flex items-center gap-1 border-r border-border pr-2">
          <button className="rounded p-1.5 text-foreground hover:bg-accent"><TableIcon className="h-4 w-4" /></button>
          <button className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"><BarChart3 className="h-4 w-4" /></button>
        </div>
        <div className="flex flex-1 items-center gap-0 overflow-x-auto">
          {TABS.map((t, i) => (
            <button
              key={t}
              className={`relative whitespace-nowrap px-3 py-2.5 text-xs ${i === 0 ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {t}
              {i === 0 && <span className="absolute inset-x-2 bottom-0 h-[2px] bg-primary" />}
            </button>
          ))}
        </div>
        <button className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"><Filter className="h-4 w-4" /></button>
        <button className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"><RefreshCw className="h-4 w-4" /></button>
        <button className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"><Maximize2 className="h-4 w-4" /></button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full min-w-[1100px] border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10 bg-background">
            <tr className="border-b border-border">
              <th className="px-3 py-2 text-left">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Search className="h-3.5 w-3.5" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Symbol"
                    className="w-40 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                  />
                  <span className="ml-2 text-[10px] uppercase tracking-wider">{rows.length}</span>
                </div>
              </th>
              <Th k="price" label="Price" />
              <Th k="chgPct" label="Chg %" />
              <Th k="vol" label="Vol" />
              <Th k="relVol" label="Rel vol" />
              <Th k="mktCap" label="↓ Mkt cap" />
              <Th k="pe" label="P/E" />
              <Th k="epsDil" label="EPS dil TTM" />
              <Th k="epsGrowth" label="EPS dil growth TTM YoY" />
              <Th k="divYield" label="Div yield % TTM" />
              <th className="px-3 py-2.5 text-left text-tv-caps font-medium text-muted-foreground">Sector</th>
              <th className="px-3 py-2.5 text-left text-tv-caps font-medium text-muted-foreground">Analyst rating</th>
              <th className="px-3 py-2.5 text-right">
                <Plus className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
              </th>
            </tr>
          </thead>
          <tbody
            ref={tbodyRef}
            onKeyDown={(e: KeyboardEvent<HTMLTableSectionElement>) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setFocusIdx((i) => Math.min(rows.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setFocusIdx((i) => Math.max(0, i - 1));
              } else if (e.key === "Home") {
                e.preventDefault(); setFocusIdx(0);
              } else if (e.key === "End") {
                e.preventDefault(); setFocusIdx(rows.length - 1);
              } else if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                const r = rows[focusIdx];
                if (r) setSelected(r.symbol);
              }
            }}
          >
            {rows.map((r, i) => (
              <tr
                key={r.symbol}
                data-idx={i}
                tabIndex={i === focusIdx ? 0 : -1}
                role="row"
                aria-selected={selected === r.symbol}
                onClick={() => { setSelected(r.symbol); setFocusIdx(i); }}
                onFocus={() => setFocusIdx(i)}
                className={`cursor-pointer border-b border-border/60 outline-none transition-colors focus-visible:tv-row-focus ${
                  selected === r.symbol ? "tv-row-selected" : "hover:tv-row-hover"
                }`}
              >

                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${r.logoColor} text-[10px] font-bold text-white`}>
                      {r.logo}
                    </div>
                    <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-primary">{r.symbol}</span>
                    <span className="truncate text-xs text-foreground/90">{r.name}</span>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-right"><LivePriceCell base={r.price} /></td>
                <td className={`px-3 py-2.5 text-right font-mono tabular text-tv-sm ${r.chgPct >= 0 ? "text-bull" : "text-bear"}`}>
                  {r.chgPct >= 0 ? "+" : ""}{r.chgPct.toFixed(2)}%
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular text-tv-sm">{r.vol}</td>
                <td className="px-3 py-2.5 text-right font-mono tabular text-tv-sm">{r.relVol.toFixed(2)}</td>
                <td className="px-3 py-2.5 text-right font-mono tabular text-tv-sm">
                  {r.mktCap}<span className="ml-1 text-[10px] text-muted-foreground">INR</span>
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular text-tv-sm">{r.pe.toFixed(2)}</td>
                <td className="px-3 py-2.5 text-right font-mono tabular text-tv-sm">
                  {r.epsDil.toFixed(2)}<span className="ml-1 text-[10px] text-muted-foreground">INR</span>
                </td>
                <td className={`px-3 py-2.5 text-right font-mono tabular text-tv-sm ${r.epsGrowth >= 0 ? "text-bull" : "text-bear"}`}>
                  {r.epsGrowth >= 0 ? "+" : ""}{r.epsGrowth.toFixed(2)}%
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular text-tv-sm">{r.divYield.toFixed(2)}%</td>
                <td className="px-3 py-2.5 text-left text-xs text-foreground/90">{r.sector}</td>
                <td className="px-3 py-2.5 text-left"><RatingPill r={r.rating} /></td>
                <td className="px-3 py-2.5" />
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Bottom status bar */}
      <div className="flex items-center justify-between border-t border-border bg-panel px-4 py-1.5 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-bull animate-pulse" /> Live · NSE
          </span>
          <span>{rows.length} matches</span>
        </div>
        <div className="font-mono tabular">MAET Screener · v1.0</div>
      </div>
    </div>
  );
}

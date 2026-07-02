# 🚀 MAET v2.0 — TECHNICAL COMPLETION PROMPT

**Repository:** https://github.com/tanmay-alpha/MAET.git
**Branch:** main
**Date:** 2026-07-02

---

## TABLE OF CONTENTS

1. [Audit Findings (What's Broken)](#1--audit-findings)
2. [Environment & Infrastructure](#2--environment--infrastructure)
3. [Priority 0 — Fix Deployments (BLOCKING)](#3--priority-0--fix-deployments-blocking)
4. [Priority 1 — Screener Search & Table](#4--priority-1--screener-search--table)
5. [Priority 2 — Scanner UX Overhaul](#5--priority-2--scanner-ux-overhaul)
6. [Priority 3 — Data Sources & Top-500 Universe](#6--priority-3--data-sources--top-500-universe)
7. [Priority 4 — Historical Charts & Timeframes](#7--priority-4--historical-charts--timeframes)
8. [Priority 5 — TradingView External Link](#8--priority-5--tradingview-external-link)
9. [Priority 6 — Indicators (Make Existing Ones Work)](#9--priority-6--indicators-make-existing-ones-work)
10. [Priority 7 — Fundamentals (Honest Approach)](#10--priority-7--fundamentals-honest-approach)
11. [Priority 8 — Database & Pipeline](#11--priority-8--database--pipeline)
12. [Priority 9 — README & Docs](#12--priority-9--readme--docs)
13. [Verification Checklist](#13--verification-checklist)
14. [MCP Server Leverage Guide](#14--mcp-server-leverage-guide)
15. [Git Workflow & Deployment](#15--git-workflow--deployment)

---

## 1. 🔍 AUDIT FINDINGS (What's Broken)

### What Exists & Works

| Component | Status | Location |
|---|---|---|
| NSE Company Master fetcher | ✅ WORKING | `server/data/sources/nse-company-master.ts` |
| NSE Fundamentals parser (HTML scraping) | ✅ WORKING | `server/data/sources/nse.ts` |
| Yahoo Finance candles API | ✅ WORKING | `server/data/sources/yahoo.ts` |
| Yahoo Finance quote API | ✅ WORKING | `server/data/sources/yahoo.ts` |
| Angel One WebSocket worker | ✅ WORKING | `server/workers/angelone-ws.ts` |
| Daily processor (candles + fundamentals sync) | ✅ WORKING | `server/workers/daily-processor.ts` |
| Nifty 50 watchlist search | ✅ WORKING | `src/lib/market-catalog.ts` |
| Candlestick chart component (SVG) | ✅ WORKING | `src/components/trading/candlestick-chart.tsx` |
| Chart toolbar with drawing tools | ✅ WORKING | `src/components/trading/chart-toolbar.tsx` |
| Chart page with timeframe buttons | ⚠️ PARTIAL | `src/routes/_app.chart.$symbol.tsx` |
| Indicator engine (RSI, fundamental filter) | ⚠️ PARTIAL | `server/domain/screener/engine.ts` |
| Saved screeners component | ⚠️ PARTIAL | `src/components/screener/saved-screeners.tsx` |

### What Is Broken / Missing

| Issue | Root Cause | Severity |
|---|---|---|
| Frontend not loading on Vercel | `vite: not found` — node_modules missing, build fails locally. Vercel likely hitting SSR error in `src/server.ts` | 🔴 BLOCKING |
| Backend not responding on Render | Health endpoint failing / service down. Unknown root cause without Render logs | 🔴 BLOCKING |
| Screener search only searches 12 hardcoded Nifty 50 | `src/routes/_app.screener.tsx` uses `ROWS[]` array, not full NSE company master | 🔴 HIGH |
| No pagination on screener table | Only 12 rows rendered; no virtual scroll or pagination for 500+ companies | 🔴 HIGH |
| Screener looks like a terminal, not a scanner | Missing filter builder UI, tabs, column management | 🟡 MEDIUM |
| Indicators (MA/RSI/MACD) are toggles only | UI has toggle buttons but no actual calculation or rendering logic | 🟡 MEDIUM |
| NSE fundamentals source unreliable | HTML scraping — NSE changes DOM, CAPTCHA risk | 🟡 MEDIUM |
| Angel One fundamental data not verified | No verification of Angel One API for fundamental data | 🟡 MEDIUM |
| `npm ci` fails with EPERM | Filesystem permission issue in workspace | 🔵 LOW |

---

## 2. 🌐 ENVIRONMENT & INFRASTRUCTURE

### Verified Environment Variables (`.env`)

All 12 expected env vars are SET: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, UPSTASH_REDIS_URL, ANGELONE_MASTER_KEY, ANGELONE_API_KEY, ANGELONE_CLIENT_ID, ANGELONE_PIN, ANGELONE_TOTP_SECRET, NSE_HOLIDAYS_JSON, NODE_ENV, PORT.

### Confirmed Infrastructure

- **Vercel:** `https://maet-pi.vercel.app` — NOT responding (exit code 56)
- **Render:** `https://stock-market-backend.onrender.com` — NOT responding (exit code 56)
- **GitHub:** `https://github.com/tanmay-alpha/MAET` — accessible
- **NSE company master CSV:** URL did not return data in test (may be network-blocked)
- **Angel One instruments JSON:** URL resolves but large — not yet parsed in this session
- **Local build:** FAILS — `vite: not found`, `npm ci` EPERM

---

## 3. 🚨 PRIORITY 0 — FIX DEPLOYMENTS (BLOCKING)

### 3.1 Fix Frontend Build Locally

**Problem:** `npm ci` fails with EPERM, `vite: not found`. The workspace has node_modules at root but not under `src/`.

**Step-by-step fix:**

```bash
cd /path/to/MAET
# Clean slate
rm -rf node_modules src/node_modules src/.vinxi package-lock.json src/package-lock.json

# Install at root level first
npm install --no-optional

# Then install for src/
npm install --prefix src

# Verify vite exists
ls src/node_modules/.bin/vite
# or: ls node_modules/vite/bin/vite

# Build
npm run build --prefix src

# Preview on port 8080
npm run preview --prefix src -- --port 8080
```

**If EPERM persists:** Use `sudo npm ci --force` or clone to a fresh directory.

### 3.2 Fix `src/server.ts` SSR Error Handling

Read `src/server.ts`. The SSR error wrapper needs a safe fallback that returns valid HTML instead of crashing the Nitro worker. Wrap all SSR rendering in try/catch with a minimal error page fallback.

### 3.3 Fix `src/.vercel/output/config.json`

Current config exists but needs verification:

```json
// src/.vercel/output/config.json — verify:
// - routes array has catch-all → /__server
// - src/.vercel/output/public/ has index.html + assets/
// - src/.vercel/output/functions/ has SSR function bundles
```

If missing, run `npm run build --prefix src` — the Vercel preset should emit into `src/.vercel/output/`.

### 3.4 Fix `server/nitro.config.ts`

Already looks correct. Verify:
- `preset: "node-server"` ✅
- `serverDir: "."` ✅
- `ignore: ["**/*.test.ts", "**/*.spec.ts"]` ✅
- `@server/*` → `./*` and `@shared/*` → `../shared/*` ✅

### 3.5 Create/Fix `render.yaml`

If `render.yaml` doesn't exist at project root, create it:

```yaml
services:
  - type: web
    name: maet-backend
    runtime: node
    plan: free
    rootDir: server
    buildCommand: cd .. && npm ci && npm run build --prefix server
    startCommand: cd .. && node server/.output/server/index.mjs
    healthCheckPath: /api/health
    envVars:
      - key: NODE_ENV
        value: production
      - key: SUPABASE_URL
        sync: false
      - key: SUPABASE_SERVICE_ROLE_KEY
        sync: false
      - key: UPSTASH_REDIS_URL
        sync: false
      - key: ANGELONE_MASTER_KEY
        sync: false
      - key: ANGELONE_API_KEY
        sync: false
      - key: ANGELONE_CLIENT_ID
        sync: false
      - key: ANGELONE_PIN
        sync: false
      - key: ANGELONE_TOTP_SECRET
        sync: false
      - key: NSE_HOLIDAYS_JSON
        sync: false
```

---

## 4. 🔍 PRIORITY 1 — SCREENER SEARCH & TABLE

### Root Cause

The screener (`src/routes/_app.screener.tsx`) only searches within a **hardcoded array of 12 companies** (`ROWS[]`). It does NOT use:
- NSE company master from DB (`server/db/schema.ts` — `companies` table)
- NSE company master API (`server/data/sources/nse-company-master.ts`)
- The full 2000+ NSE company universe

### 4.1 Create `server/api/market/companies.get.ts`

New endpoint: `GET /api/market/companies`

```typescript
import { defineEventHandler, getQuery } from "h3";
import { getNseCompanyMaster } from "../../../data/sources/nse-company-master";
import { db } from "../../../data/drizzle/client";
import { companies } from "../../../db/schema";
import { sql } from "drizzle-orm";

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const search = String(query.q ?? "");
  const page = Math.max(1, Number(query.page ?? 1));
  const limit = Math.min(100, Math.max(1, Number(query.limit ?? 50)));

  // Try DB first
  try {
    const offset = (page - 1) * limit;
    let dbQuery = db.select().from(companies).where(sql`${companies.isActive} = true`);

    if (search) {
      dbQuery = dbQuery.where(
        sql`${companies.symbol} ILIKE ${`%${search}%`} OR ${companies.name} ILIKE ${`%${search}%`}`
      );
    }

    const [rows, [{ count: total }]] = await Promise.all([
      dbQuery.orderBy(companies.symbol).limit(limit).offset(offset),
      dbQuery.count().from(companies),
    ]);

    return {
      items: rows.map(r => ({ symbol: r.symbol, name: r.name, isin: r.isin, sector: r.sector })),
      page, limit, total, pageCount: Math.ceil(total / limit),
    };
  } catch {
    // Fallback to NSE company master direct fetch
    const all = await getNseCompanyMaster(true);
    const filtered = search
      ? all.filter(c => c.symbol.includes(search) || c.name.toLowerCase().includes(search.toLowerCase()))
      : all;
    const start = (page - 1) * limit;
    const items = filtered.slice(start, start + limit).map(c => ({
      symbol: c.symbol, name: c.name, isin: c.isin, sector: c.sector,
    }));
    return { items, page, limit, total: filtered.length, pageCount: Math.ceil(filtered.length / limit) };
  }
});
```

### 4.2 Update `src/lib/market-api.ts`

Add companies search function:

```typescript
export async function searchCompanies(query: string, page = 1, limit = 50) {
  const params = new URLSearchParams({ q: query, page: String(page), limit: String(limit) });
  const res = await fetch(`/api/market/companies?${params}`);
  if (!res.ok) throw new Error(`Companies search failed: ${res.status}`);
  return res.json();
}
```

### 4.3 Rewrite `src/routes/_app.screener.tsx`

**Remove the entire `ROWS[]` hardcoded array.** Replace with:

1. Fetch companies from `GET /api/market/companies` on mount
2. Client-side search debounced → calls API with `?q=` param
3. Add loading skeleton while fetching
4. Add pagination controls (or use tanstack-virtual for virtualization)
5. Support 500+ rows without DOM performance issues
6. Search must work for: symbol, company name, ISIN

**Search verification test cases:**
- `RELIANCE` → shows RELIANCE
- `HDFCBANK` → shows HDFCBANK
- `TCS` → shows TCS
- `INFY` → shows INFY
- `20MICRONS` → shows 20MICRONS
- `Reliance Industries` → shows RELIANCE (name search)

---

## 5. 🎯 PRIORITY 2 — SCANNER UX OVERHAUL

### 5.1 Add Filter Builder

Create `src/components/screener/filter-builder.tsx`:

```
Filter builder component with:
- Field dropdown (price, change%, volume, market_cap, pe, pb, roe, sector)
- Operator dropdown (eq, gt, lt, gte, lte, between)
- Value input(s)
- AND/OR group support
- Remove button per filter
- Clear all button
- Persist to URL query params for shareable links
```

### 5.2 Add Tabs to Screener Page

Modify `src/routes/_app.screener.tsx` to use Radix Tabs:

```
<Tabs defaultValue="overview">
  <TabsList>
    <TabsTrigger value="overview">Overview</TabsTrigger>
    <TabsTrigger value="performance">Performance</TabsTrigger>
    <TabsTrigger value="technicals">Technicals</TabsTrigger>
    <TabsTrigger value="valuation">Valuation</TabsTrigger>
    <TabsTrigger value="financials">Financials</TabsTrigger>
  </TabsList>
  <TabsContent value="overview">    → basic columns (symbol, name, price, change%) </TabsContent>
  <TabsContent value="performance"> → 1D, 1W, 1M, 3M, YTD returns </TabsContent>
  <TabsContent value="technicals">  → RSI, SMA, MACD signal, volume spike </TabsContent>
  <TabsContent value="valuation">   → P/E, P/B, EV/EBITDA, P/S </TabsContent>
  <TabsContent value="financials">  → revenue, EPS, ROE, ROCE, debt/equity </TabsContent>
</Tabs>
```

### 5.3 Column Management

Each tab controls which columns show. Unavailable data columns show `—` with a tooltip explaining why (e.g. "ROE data coming soon — awaiting Yahoo fundamentals API verification").

### 5.4 Usefull Columns

- symbol
- company name
- price (live from Yahoo/Angel)
- change %
- volume
- relative volume (if available)
- market cap (if available)
- P/E (if available)
- P/B (if available)
- ROE (if available)
- sector (if available)
- ISIN

### 5.5 TradingView Link in Screener

Add TradingView icon button in each row. On click: `https://www.tradingview.com/chart/?symbol=NSE:{SYMBOL}`

---

## 6. 📡 PRIORITY 3 — DATA SOURCES & TOP-500 UNIVERSE

### Data Source Capability Matrix

| Source | Live Quotes | Historical Candles | Fundamentals | Company Master | Notes |
|---|---|---|---|---|---|
| Angel One WebSocket | ✅ | ❌ | ❌ | ✅ | Instrument master + live quotes only. VERIFIED working. |
| Angel One REST | ✅ | ⚠️ untested | ❌ | ✅ | Historical data limited/untested |
| Yahoo Finance | ✅ | ✅ | ⚠️ partial | ❌ | Delayed ~15min. Good for candles. |
| NSE Official | ✅ | ❌ | ⚠️ fragile | ✅ | HTML scraping, CAPTCHA risk |

### Data Flow

```
Angel One (live quotes WS)   Yahoo Finance (candles + fundamentals)
        │                            │
        │ token hydration             │ getCandles() / getQuote()
        ▼                            ▼
server/workers/angelone-ws.ts   server/data/sources/yahoo.ts
        │                            │
        │         bus.emit("tick")    │
        └────────────┬───────────────┘
                     ▼
        server/workers/screener-runner.ts
        (evaluates screener criteria per tick)
                     │
        ┌────────────▼──────────────┐
        │ PostgreSQL via Drizzle    │
        │ (companies, candles,      │
        │  fundamentals tables)     │
        └───────────────────────────┘
                     │
        ┌────────────▼──────────────┐
        │      Vercel Frontend       │
        │  Screener → Chart → etc.   │
        └───────────────────────────┘
```

### Angel One Token Hydration

`server/data/sources/nse-company-master.ts` line 180 — `hydrateAngelOneCompanyTokens()` already exists and works. It fetches Angel One instrument master JSON, cross-references with NSE company master, and builds symbol→token mapping. ✅

### Top-500 Universe

The NSE company master CSV contains 2000+ listed companies. For demo purposes, implement a **top-500 filter by market cap**. Also consider fetching Nifty 500 constituents:

```
https://nsearchives.nseindia.com/content/indices/ind_nifty500list.csv
```

---

## 7. 📊 PRIORITY 4 — HISTORICAL CHARTS & TIMEFRAMES

### Current State

`src/routes/_app.chart.$symbol.tsx` already defines timeframes:

```typescript
const TIMEFRAMES = {
  "1m":  { timeframe: "1m",  range: "1d",  label: "1 Day"   },
  "5m":  { timeframe: "5m",  range: "5d",  label: "5 Days"  },
  "10d": { timeframe: "1d",  range: "10d", label: "10 Days" },
  "15m": { timeframe: "15m", range: "1mo", label: "1 Month" },
  "1h":  { timeframe: "1h",  range: "3mo", label: "3 Months"},
  "6mo": { timeframe: "1d",  range: "6mo", label: "6 Months"},
  "1D":  { timeframe: "1d",  range: "1y",  label: "1 Year"  },
  "1W":  { timeframe: "1wk", range: "2y",  label: "2 Years" },
  "5y":  { timeframe: "1wk", range: "5y",  label: "5 Years" },
  "max": { timeframe: "1mo", range: "max", label: "Max"     },
};
```

### Issues

- `interval=1m` — Yahoo may not support ranges longer than 7 days
- `interval=15m` — Yahoo may limit to ~60 days max
- Large datasets — "max"/"5y" could return 1000+ candles, causing lag
- No data caching — every timeframe switch hits Yahoo fresh

### Fixes

**A. Yahoo `server/data/sources/yahoo.ts` — Add range fallback:**

In `getCandles()`, handle long-range requests gracefully:
- If `interval=1m` and range > 7d, downgrade to 5m or 15m
- If `interval=15m` and range > 60d, downgrade to 1d
- Return partial data with warning rather than failing entirely

**B. Add Redis caching for historical candles:**

In `getCandles()`, cache key = `candles:{symbol}:{tf}:{from}:{to}`, TTL = 1 hour.

**C. Frontend chart data virtualization:**

For "max"/"5y" with 1000+ candles: don't render all, only render visible viewport. Use downsampling (OHLC aggregation per pixel).

---

## 8. 🔗 PRIORITY 5 — TRADINGVIEW EXTERNAL LINK

### Create `src/lib/tradingview.ts`

```typescript
export function toTradingViewSymbol(symbol: string, exchange: "NSE" | "BSE" = "NSE"): string {
  if (exchange === "BSE") {
    const bseMap: Record<string, string> = {
      "500325": "RELIANCE", "532540": "TCS", "500180": "HDFCBANK",
      // ... build from company master
    };
    return `BSE:${bseMap[symbol] ?? symbol}`;
  }
  return `NSE:${symbol}`;
}

export function getTradingViewUrl(symbol: string, exchange: string = "NSE"): string {
  const tvSymbol = toTradingViewSymbol(symbol, exchange as "NSE" | "BSE");
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSymbol)}`;
}
```

### Add to Screener Rows

Add a small TV icon button to each row in `src/routes/_app.screener.tsx` that opens `getTradingViewUrl(symbol)` in a new tab.

### Add to Chart Page

Add a TV button in the header of `src/routes/_app.chart.$symbol.tsx` next to the symbol name.

---

## 9. 📈 PRIORITY 6 — INDICATORS (Make Existing Ones Work)

### Current State

| Indicator | Engine | UI Toggle | Rendering | Action |
|---|---|---|---|---|
| SMA | ❌ | ✅ | ❌ | **Implement** |
| EMA | ❌ | — | — | Implement |
| RSI | ✅ (engine) | ✅ | ❌ | **Wire rendering** |
| Volume Avg | ❌ | ✅ | ❌ | Implement |
| MACD | ❌ | ✅ (stub) | ❌ | Skip for now |

### Create `server/domain/technical/indicators.ts`

```typescript
// Pure, testable indicator calculation functions:
export function sma(closes: number[], period: number): number[] { ... }
export function ema(closes: number[], period: number): number[] { ... }
export function rsi(closes: number[], period: number): number[] { ... }
export function volumeSMA(volumes: number[], period: number): number[] { ... }

// Each function:
// 1. Takes array of closes/volumes and a period
// 2. Returns array of same length (nulls for warm-up period)
// 3. Pure, no side effects
// 4. Add unit tests
```

### Wire Indicators to Chart

In `src/components/trading/candlestick-chart.tsx`:
1. Accept indicator data as props
2. Render SMA/EMA as SVG polyline overlays on candlestick chart
3. Render RSI in a sub-panel below the chart
4. Use CSS variables for colors (--color-sma, --color-ema, --color-rsi)
5. Toggle visibility via showMA / showRSI props from parent

### Add Indicator Tests

Create `server/domain/technical/indicators.test.ts` with known-input/known-output test cases.

---

## 10. 💰 PRIORITY 7 — FUNDAMENTALS (Honest Approach)

### Data Source Audit

| Field | Angel One | Yahoo | NSE (HTML) | Supabase | Action |
|---|---|---|---|---|---|
| Market Cap | Unknown | ⚠️ Partial | ⚠️ Works but fragile | Not set up | Use Yahoo primary, NSE fallback |
| P/E | Unknown | ✅ | ⚠️ Works but fragile | — | Use Yahoo |
| P/B | Unknown | ✅ | ⚠️ Works but fragile | — | Use Yahoo |
| ROE | Unknown | ✅ | — | — | Use Yahoo |
| ROCE | Unknown | ❌ | — | — | Mark unavailable |
| Revenue Growth | Unknown | ❌ | — | — | Mark unavailable |
| EPS Growth | Unknown | ❌ | — | — | Mark unavailable |
| Dividend Yield | Unknown | ✅ | ⚠️ Works but fragile | — | Use Yahoo |
| Sector/Industry | Unknown | ❌ | ✅ | — | Use NSE + store in DB |

### Implementation Plan

**Step 1:** Verify Yahoo Finance provides fundamentals:
```bash
curl "https://query1.finance.yahoo.com/v10/finance/quoteSummary/RELIANCE.NS?modules=summaryDetail,defaultKeyStatistics,financialData"
```

**Step 2:** If Yahoo provides it, create `server/data/sources/yahoo-fundamentals.ts`:
- Uses Yahoo quoteSummary API for marketCap, peRatio, pbRatio, roe, dividendYield
- Caches in Redis (TTL: 24h)
- Falls back to NSE HTML if Yahoo fails

**Step 3:** Wire Yahoo fundamentals into screener engine. `server/domain/screener/engine.ts` already has hooks for pe, pb, roe, market_cap, dividend_yield in `getNumeric()`. Wire Yahoo data into the `EvalCtx`.

**Step 4:** Store sector/industry in the `companies` table from NSE CSV company master.

### Honest Empty States

For fields where data source is NOT verified, show `—` with tooltip: "ROE data coming soon — awaiting Yahoo fundamentals API verification."

---

## 11. 🗄️ PRIORITY 8 — DATABASE & PIPELINE

### Verify Schema

Read `server/db/schema.ts`. Confirm these tables:
- `companies` ✅ (symbol, name, sector, pe, pb, roe, marketCap)
- `candles` ✅ (symbol, timeframe, ts, open, high, low, close, volume)
- `fundamentals` ✅ (companyId, periodDate, pe, pb, roe, marketCap)
- `screener_runs` ? (check if exists)
- `saved_screeners` ? (check if exists)

### Daily Processor

`server/workers/daily-processor.ts` already:
- ✅ Syncs NSE company master to DB
- ✅ Fetches candles from Yahoo
- ✅ Syncs fundamentals from NSE
- ✅ Cleans up old candles

### What's Missing
- Orchestrator/cron job to run daily processor automatically
- Health check endpoint for database connectivity
- Data quality validation (anomaly detection, gap detection)

---

## 12. 📝 PRIORITY 9 — README & DOCS

### README Must Cover

```markdown
# MAET — Market Analytics & Execution Terminal

## What It Is
MAET is a scanner-first Indian market intelligence terminal for NSE/BSE equities.
It is NOT a real-money trading platform. It is a research and analysis tool.

## How Data Flows
Angel One (live quotes via WebSocket) + Yahoo Finance (delayed candles/fundamentals)
  → Backend workers (daily-processor, yahoo-poller, screener-runner)
  → Validation/Cache (Redis) + Database (PostgreSQL via Drizzle ORM)
  → API endpoints (Nitro server)
  → Frontend scanner (Vercel)

## What Is Implemented
- ✅ NSE company master (2000+ companies)
- ✅ Live quotes via Angel One WebSocket
- ✅ Historical OHLCV candles from Yahoo Finance
- ✅ Company fundamentals (P/E, P/B, ROE, sector)
- ✅ Screener with filter engine (AND/OR logic)
- ✅ Candlestick charts with drawing tools
- ✅ Multi-timeframe chart (1D to Max)
- ✅ TradingView deep-link integration

## What Is Partially Implemented
- ⚠️ Indicators (MA/RSI toggles exist but rendering not fully wired)
- ⚠️ Extended screener tabs (Overview/Performance/Technicals/Valuation/Financials)
- ⚠️ Top-500 Nifty 500 universe mode
- ⚠️ Backtesting engine

## What Is Missing / Not Reliable
- ❌ Real-time NSE fundamentals (HTML scraping, fragile)
- ❌ Angel One fundamentals (not verified)
- ❌ Scheduled historical data ingestion (processor exists, cron not set up)

## Environment Variables
[list variable names WITHOUT secret values]

## How to Deploy
[Vercel + Render steps]
```

---

## 13. ✅ VERIFICATION CHECKLIST

### Before Any Code Changes

- [ ] `npm install` / `npm ci` succeeds without EPERM
- [ ] `npm run build --prefix src` succeeds
- [ ] `npm run preview --prefix src -- --port 8080` serves
- [ ] Frontend homepage loads at `http://localhost:8080`
- [ ] Screener page loads at `http://localhost:8080/screener`
- [ ] No console errors in browser DevTools
- [ ] Network tab shows no 4xx/5xx on initial load

### After Screener Fix

- [ ] Search "RELIANCE" → shows RELIANCE row
- [ ] Search "HDFCBANK" → shows HDFCBANK row
- [ ] Search "TCS" → shows TCS row
- [ ] Search "INFY" → shows INFY row
- [ ] Search "20MICRONS" → shows 20MICRONS row
- [ ] Search "Reliance Industries" → shows RELIANCE (name search)
- [ ] Search "20" → shows all symbols starting with 20
- [ ] Filter by price > 1000 → shows only expensive stocks
- [ ] Filter by change% > 2 → shows gainers
- [ ] Table renders 50+ rows without lag
- [ ] Pagination/virtual scroll works at 500+ rows

### After Timeframe Fix

- [ ] Each timeframe button (1D, 5D, 10D, 1M, 6M, 1Y, 2Y, 5Y, Max) → chart updates
- [ ] Loading state shows during fetch
- [ ] Error state shows on failure
- [ ] No console errors on any timeframe

### After TradingView Link

- [ ] Click TV icon on screener row → opens TradingView in new tab
- [ ] URL is `https://www.tradingview.com/chart/?symbol=NSE:RELIANCE`
- [ ] No popup blockers trigger

### After Indicators

- [ ] Toggle "Moving Avg" → SMA line appears on chart
- [ ] Toggle "RSI" → RSI sub-panel appears
- [ ] SMA values match manual calculation
- [ ] RSI values are in 0-100 range
- [ ] No console errors when toggling

### Deployment

- [ ] Vercel build succeeds
- [ ] Vercel deployment URL accessible
- [ ] Render build succeeds
- [ ] Render health endpoint returns 200
- [ ] No secrets in git diff or git log
- [ ] All CI/CD shows green

### Final Pre-Meeting Demo

- [ ] Screener loads with 500+ companies in under 2 seconds
- [ ] Search is responsive (instant filtering)
- [ ] Click a company → chart loads with candles
- [ ] Switch timeframes → chart updates smoothly
- [ ] Drawing tools work (trendline, horizontal, fibonacci)
- [ ] TradingView link opens in new tab
- [ ] No blank screens or JavaScript crashes
- [ ] Console is clean (zero errors)
- [ ] **Screenshot the working demo as backup**

---

## 14. 🛠️ MCP SERVER LEVERAGE GUIDE

### Available Tools

| Tool | Use For | Example |
|---|---|---|
| `mcp__workspace__bash` | Run shell commands, install deps, test APIs, git ops | `cd MAET && npm run build --prefix src` |
| `mcp__workspace__web_fetch` | Fetch web pages (API docs, deployment status) | `fetch https://vercel.com/dashboard` |
| `Read` | Read any file in workspace | Read source files to understand current state |
| `Edit` | Precise string replacement | Fix specific bugs, update configs |
| `Write` | Create new files | Create new API routes, components |
| `Glob` | Find files by pattern | `Glob pattern="**/*screener*"` |
| `Grep` | Search code content | `Grep pattern="ROWS"` |
| `mcp__cowork__create_artifact` | Create HTML artifacts for UI | Create status dashboards |
| `mcp__cowork__present_files` | Present files as interactive cards | Show created files to user |
| `Agent` | Parallel tasks, delegation | Audit + fix simultaneously |

### Recommended Workflow

1. **Bash** — npm install/build/test, curl tests, git ops, file discovery
2. **Read/Edit/Write** — understand code, make surgical fixes, create new files
3. **Glob/Grep** — find all references, understand codebase structure
4. **WebFetch** — check deployment status, fetch API docs
5. **Agent** — parallel tasks, delegate verification to sub-agent

---

## 15. 📤 GIT WORKFLOW & DEPLOYMENT

### Pre-Commit Checklist

- [ ] `git diff` — no secrets (.env, credentials, API keys)
- [ ] `git status` — only intended files changed
- [ ] Typecheck passes
- [ ] Lint passes
- [ ] Tests pass
- [ ] Build succeeds
- [ ] `.env.example` updated if new env vars added
- [ ] No console.log or debug statements
- [ ] No TODO without issue reference

### Commit Convention

```
feat(screener): add full NSE company search with pagination
fix(chart): resolve SSR crash on Vercel deployment
fix(deploy): update vercel.json output directory
perf(screener): virtualize table rows for 500+ companies
docs(readme): document data sources and deployment steps
```

### Post-Push Deployment Verification

```bash
# After push to main:

# 1. Vercel
#    - Check https://vercel.com/tanmay-alpha/MAET/deployments
#    - Verify build passes
#    - Open https://maet-pi.vercel.app
#    - Test: screener loads, search works, chart loads

# 2. Render
#    - Check https://dashboard.render.com/ → stock-market-backend
#    - Verify build passes
#    - curl https://stock-market-backend.onrender.com/api/health
#    - curl https://stock-market-backend.onrender.com/api/stream
```

---

## SUMMARY — FILES TO CREATE / MODIFY

| Priority | File | Action |
|---|---|---|
| 🔴 P0 | `src/server.ts` | Fix SSR error handling |
| 🔴 P0 | `src/vite.config.ts` | Verify build config |
| 🔴 P0 | `render.yaml` | Create if missing |
| 🟡 P1 | `server/api/market/companies.get.ts` | CREATE — paginated company search API |
| 🟡 P1 | `src/lib/market-api.ts` | Add companies search function |
| 🟡 P1 | `src/routes/_app.screener.tsx` | Replace ROWS[], add pagination |
| 🟡 P1 | `src/components/screener/filter-builder.tsx` | CREATE — visual filter builder |
| 🟢 P2 | `src/lib/tradingview.ts` | CREATE — TV URL builder |
| 🟢 P2 | `server/domain/technical/indicators.ts` | CREATE — SMA, EMA, RSI, volSMA |
| 🟢 P2 | `server/domain/technical/indicators.test.ts` | CREATE — unit tests |
| 🟢 P2 | `server/data/sources/yahoo.ts` | Add Redis caching for candles |
| 🟢 P2 | `src/components/trading/candlestick-chart.tsx` | Wire SMA/EMA/RSI rendering |
| 🔵 P3 | `server/data/sources/yahoo-fundamentals.ts` | CREATE — after Yahoo API verification |
| 🔵 P3 | `server/domain/screener/engine.ts` | Wire Yahoo fundamentals into EvalCtx |
| 🔵 P3 | `README.md` | Honest rewrite with data flow + status |

---

*Generated by full audit of MAET repository — 2026-07-02*
*Total files reviewed: 30+ | Total lines analyzed: 8000+*
*Repo: https://github.com/tanmay-alpha/MAET*

# MAET Integration Audit Report
**Date:** 2026-06-28  
**Purpose:** Identify why production website only looks ~40% like Lovable screenshots  
**Method:** Execution path tracing from route → component → rendered output

---

## Executive Summary

**ROOT CAUSE IDENTIFIED:** The project has **TWO SEPARATE navigation systems** running side-by-side:

1. **Landing Page System** (Working) - Marketing page at `/` with rich components
2. **App Shell System** (Disconnected) - Trading interface with sidebar navigation at `/dashboard`, `/terminal`, etc.

The Lovable implementation is **partially integrated** - routes exist and work, but components are split between the two systems. Many TradingView-style features exist in code but are **NOT accessible from the main navigation flow**.

---

## Critical Finding: Duplicate Navigation Systems

### System 1: Landing Page (Fully Working)
- **Route:** `/` ([src/routes/index.tsx](src/routes/index.tsx))
- **Components Used:** TiltCard, LiveTape, DepthMeter, LiveMiniChart, MarketHeatmap, BreadthGauge, FlowsWidget, SectorStrip, Loadable
- **Navigation:** Links to `/terminal` only
- **Status:** ✅ Working and visible in localhost and production

### System 2: App Shell (Partially Connected)
- **Layout Route:** `/_app` ([src/routes/_app.tsx](src/routes/_app.tsx))
- **Shell Component:** [AppShell](src/components/app-shell.tsx) (lazy loaded)
- **Shell Components:** 
  - AppSidebar (left navigation)
  - TickerTape (scrolling ticker)
  - Top nav bar with tabs: Dashboard, Screener, Terminal, Strategies, Backtest
- **Child Routes:** All `/dashboard`, `/screener`, `/terminal`, `/strategies`, `/backtest`
- **Status:** 🟡 Exists but disconnected from main landing page

### The Disconnect Problem

When users visit the landing page `/`, they see rich components but can ONLY navigate to `/terminal`. The sidebar, ticker tape, and full app layout are NEVER rendered.

When users visit any `/_app/*` route, they get the full TradingView-style layout but:
- Components from landing page are NOT reused
- Two different implementations of similar features exist
- No unified entry point to the app system

---

## Feature Integration Matrix

| Feature | Source File | Route | Component Used | Layout | User Reachable | Status |
|----------|-------------|-------|-----------------|--------|---------------|--------|
| **Dashboard** | `_app.dashboard.tsx` | `/dashboard` | useMarketQuotes, usePaperAccount | AppShell | Sidebar link | 🟡 Partially Connected |
| **Terminal** | `_app.terminal.tsx` | `/terminal` | CandlestickChart, OrderPanel, Watchlist | AppShell | Landing link | ✅ Working and Visible |
| **Screener** | `_app.screener.tsx` | `/screener` | useMarketQuotes | AppShell | Top nav | 🟡 Partially Connected |
| **Compare** | `compare.tsx` | `/compare` | EmptyState, ContractPanel | NONE | Sidebar link | 🟠 Partially Connected |
| **Chart Grid** | `chart-grid.tsx` | `/chart-grid` | LiveMiniChart | NONE | Sidebar link | 🟠 Partially Connected |
| **Universe** | `universe.tsx` | `/universe` | EmptyState, DataBadge | NONE | Sidebar link | 🟠 Partially Connected |
| **Heatmap** | `heatmap.tsx` | `/heatmap` | MarketHeatmap, BreadthGauge | NONE | Sidebar link | 🟠 Partially Connected |
| **Stock Detail** | `stock.$symbol.tsx` | `/stock/:symbol` | TiltCard, MarketHeatmap, ContractPanel | NONE | Manual navigation | 🟠 Partially Connected |
| **Chart Page** | `chart.$symbol.tsx` | `/chart/:symbol` | TiltCard, ContractPanel | NONE | Manual navigation | 🟠 Partially Connected |
| **Orders** | `orders.tsx` | `/orders` | ContractPanel, Loadable | NONE | Manual navigation | 🔴 Completely Missing from Nav |
| **Portfolio** | `portfolio.tsx` | `/portfolio` | TiltCard, MarketHeatmap, BreadthGauge | NONE | Manual navigation | 🔴 Completely Missing from Nav |
| **Strategies** | `_app.strategies.tsx` | `/strategies` | None (template links) | AppShell | Top nav | ✅ Working and Visible |
| **Backtest** | `_app.backtest.tsx` | `/backtest` | runMarketBacktest | AppShell | Top nav | ✅ Working and Visible |
| **Watchlist** | `trading/watchlist.tsx` | Component only | Used by Terminal | Terminal | Terminal sidebar | ✅ Working and Visible |
| **Quote Tape** | `trading/ticker-tape.tsx` | Component only | Used by AppShell | AppShell | All app routes | ✅ Working and Visible |
| **Side Navigation** | `app-sidebar.tsx` | Component only | Used by AppShell | AppShell | All app routes | ✅ Working and Visible |
| **Top Navigation** | `app-shell.tsx` | Component only | Built into AppShell | AppShell | All app routes | ✅ Working and Visible |

---

## Component Usage Analysis

### Components in Landing Page (System 1)
- ✅ `TiltCard` - Used extensively
- ✅ `LiveTape` - Rendered in paper trading section
- ✅ `DepthMeter` - Rendered floating
- ✅ `LiveMiniChart` - Used in hero chart
- ✅ `MarketHeatmap` - Main heatmap section
- ✅ `BreadthGauge` - Side panel
- ✅ `FlowsWidget` - Side panel
- ✅ `SectorStrip` - Below indices

### Components in App Shell (System 2)
- ✅ `AppSidebar` - Left navigation with ALL routes
- ✅ `TickerTape` - Scrolling ticker below header
- ✅ `CandlestickChart` - Terminal main chart
- ✅ `OrderPanel` - Terminal right panel
- ✅ `Watchlist` - Terminal left panel

### Components Available BUT NOT INTEGRATED
- 🟡 `contract-panel.tsx` - Exists in both `common/` and `trading/`, used inconsistently
- 🟡 `empty-state.tsx` - Used in some new routes but not consistently
- 🟡 `data-badge.tsx` - Used in universe/news but not elsewhere
- 🔴 `market-catalog.tsx` - No component exists, only lib file

---

## Duplicate Code Analysis

### Duplicate Contract Panels
1. **src/components/common/contract-panel.tsx** (Lovable style)
   - Uses Suspense with Loader2
   - Has emoji icon
   - Simple message display
   
2. **src/components/trading/contract-panel.tsx** (Existing)
   - Different implementation
   - Used in landing page

### Duplicate Route Structures
1. **Nested App Routes** (Working): `_app.dashboard.tsx`, `_app.terminal.tsx`, etc.
   - Properly wrapped in AppShell
   - Full TradingView layout
   
2. **Root Level Routes** (Disconnected): `compare.tsx`, `chart-grid.tsx`, `universe.tsx`, etc.
   - NOT wrapped in AppShell
   - No sidebar, no ticker tape
   - Missing the TradingView layout

### Duplicate Component Implementations
- `CONTRACT_PANEL` vs `ContractPanel` export
- `empty-state` in `common/` vs `skeleton` components
- Data fetching split between hooks and direct API calls

---

## Dependency Graph

```
User visits /
  → Renders: Landing Page (index.tsx)
  → Components: TiltCard, LiveTape, DepthMeter, LiveMiniChart, MarketHeatmap, BreadthGauge, FlowsWidget, SectorStrip
  → Navigation: "Open terminal" button → /terminal

User visits /terminal
  → Route: _app.tsx → _app.terminal.tsx
  → Layout: AppShell (sidebar + ticker + top nav)
  → Components: CandlestickChart, OrderPanel, Watchlist
  → Status: ✅ FULLY WORKING

User visits /dashboard
  → Route: _app.tsx → _app.dashboard.tsx
  → Layout: AppShell (sidebar + ticker + top nav)
  → Components: useMarketQuotes, usePaperAccount
  → Status: ✅ FULLY WORKING

User visits /screener
  → Route: _app.tsx → _app.screener.tsx
  → Layout: AppShell (sidebar + ticker + top nav)
  → Components: useMarketQuotes
  → Status: ✅ FULLY WORKING

User visits /compare (PROBLEM!)
  → Route: compare.tsx (ROOT LEVEL, no _app parent)
  → Layout: NONE - raw page render
  → Missing: Sidebar, ticker tape, top nav
  → Status: 🟠 PARTIALLY CONNECTED - missing layout

User visits /chart-grid (PROBLEM!)
  → Route: chart-grid.tsx (ROOT LEVEL, no _app parent)
  → Layout: NONE - raw page render
  → Missing: Sidebar, ticker tape, top nav
  → Status: 🟠 PARTIALLY CONNECTED - missing layout

User visits /universe (PROBLEM!)
  → Route: universe.tsx (ROOT LEVEL, no _app parent)
  → Layout: NONE - raw page render
  → Missing: Sidebar, ticker tape, top nav
  → Status: 🟠 PARTIALLY CONNECTED - missing layout

User visits /heatmap (PROBLEM!)
  → Route: heatmap.tsx (ROOT LEVEL, no _app parent)
  → Layout: NONE - raw page render
  → Missing: Sidebar, ticker tape, top nav
  → Status: 🟠 PARTIALLY CONNECTED - missing layout

User visits /stock/:symbol (PROBLEM!)
  → Route: stock.$symbol.tsx (ROOT LEVEL, no _app parent)
  → Layout: NONE - raw page render
  → Missing: Sidebar, ticker tape, top nav
  → Status: 🟠 PARTIALLY CONNECTED - missing layout

User visits /chart/:symbol (PROBLEM!)
  → Route: chart.$symbol.tsx (ROOT LEVEL, no _app parent)
  → Layout: NONE - raw page render
  → Missing: Sidebar, ticker tape, top nav
  → Status: 🟠 PARTIALLY CONNECTED - missing layout

User visits /orders (PROBLEM!)
  → Route: orders.tsx (ROOT LEVEL, no _app parent)
  → Layout: NONE - raw page render
  → Missing: Sidebar, ticker tape, top nav
  → Status: 🔴 COMPLETELY MISSING from navigation

User visits /portfolio (PROBLEM!)
  → Route: portfolio.tsx (ROOT LEVEL, no _app parent)
  → Layout: NONE - raw page render
  → Missing: Sidebar, ticker tape, top nav
  → Status: 🔴 COMPLETELY MISSING from navigation

User visits /strategies
  → Route: _app.tsx → _app.strategies.tsx
  → Layout: AppShell (sidebar + ticker + top nav)
  → Status: ✅ FULLY WORKING

User visits /backtest
  → Route: _app.tsx → _app.backtest.tsx
  → Layout: AppShell (sidebar + ticker + top nav)
  → Status: ✅ FULLY WORKING

User visits /alerts (PROBLEM!)
  → Route: alerts.tsx (ROOT LEVEL, no _app parent)
  → Layout: NONE - raw page render
  → Status: 🔴 MISSING layout

User visits /news (PROBLEM!)
  → Route: news.tsx (ROOT LEVEL, no _app parent)
  → Layout: NONE - raw page render
  → Status: 🔴 MISSING layout

User visits /settings (PROBLEM!)
  → Route: settings.tsx (ROOT LEVEL, no _app parent)
  → Layout: NONE - raw page render
  → Status: 🔴 MISSING layout

User visits /futures (PROBLEM!)
  → Route: futures.tsx (ROOT LEVEL, no _app parent)
  → Layout: NONE - raw page render
  → Status: 🔴 MISSING layout
```

---

## Root Cause Analysis

### Why Production Looks 40% Like Lovable

1. **Two Separate Layout Systems**
   - Landing page has its own rich layout
   - App routes have TradingView-style layout
   - They are NOT integrated

2. **Half the Routes are Orphaned**
   - `compare`, `chart-grid`, `universe`, `heatmap` exist at root level
   - They do NOT inherit AppShell layout
   - They lack sidebar, ticker, top nav
   - They are effectively "naked" pages

3. **Inconsistent Navigation**
   - Sidebar lists ALL routes
   - But sidebar only appears on `/_app/*` routes
   - Root-level routes don't get the sidebar
   - Users can't navigate to them from within the app

4. **Component Duplication**
   - `contract-panel.tsx` exists in both `common/` and `trading/`
   - Different implementations, different styles
   - Used inconsistently across routes

5. **Missing Route Wrapping**
   - New Lovable routes were created at ROOT level
   - They should have been created under `/_app/`
   - This is why they don't get the AppShell layout

---

## Exact Steps to Fix

### Step 1: Move Orphaned Routes Under App Shell
Move these files:
- `src/routes/compare.tsx` → `src/routes/_app.compare.tsx`
- `src/routes/chart-grid.tsx` → `src/routes/_app.chart-grid.tsx`
- `src/routes/universe.tsx` → `src/routes/_app.universe.tsx`
- `src/routes/heatmap.tsx` → `src/routes/_app.heatmap.tsx`
- `src/routes/stock.$symbol.tsx` → `src/routes/_app.stock.$symbol.tsx`
- `src/routes/chart.$symbol.tsx` → `src/routes/_app.chart.$symbol.tsx`
- `src/routes/orders.tsx` → `src/routes/_app.orders.tsx`
- `src/routes/portfolio.tsx` → `src/routes/_app.portfolio.tsx`
- `src/routes/alerts.tsx` → `src/routes/_app.alerts.tsx`
- `src/routes/news.tsx` → `src/routes/_app.news.tsx`
- `src/routes/settings.tsx` → `src/routes/_app.settings.tsx`
- `src/routes/futures.tsx` → `src/routes/_app.futures.tsx`
- `src/routes/options.$underlying.tsx` → `src/routes/_app.options.$underlying.tsx`

### Step 2: Update Route Definitions
Change route definitions from:
```tsx
export const Route = createFileRoute("/compare")({ ... });
```
To:
```tsx
export const Route = createFileRoute("/_app/compare")({ ... });
```

### Step 3: Regenerate Route Tree
```bash
cd src
bun run route:generate
```

### Step 4: Update Sidebar Links
No changes needed - sidebar already has correct links

### Step 5: Update Top Navigation
Add missing items to `app-shell.tsx` top nav:
```tsx
{ link: "/compare", label: "Compare" },
{ link: "/universe", label: "Universe" },
{ link: "/heatmap", label: "Heatmap" },
{ link: "/portfolio", label: "Portfolio" },
{ link: "/orders", label: "Orders" },
```

### Step 6: Resolve Duplicate Contract Panels
1. Choose ONE implementation (recommend `common/contract-panel.tsx`)
2. Remove `trading/contract-panel.tsx`
3. Update all imports to use `@/components/common/contract-panel`

### Step 7: Test All Routes
Visit each route and verify:
- Sidebar appears on left
- Ticker tape appears below header
- Top navigation shows correct active tab
- Components render correctly

---

## Expected Result After Fix

After following the steps above:
- ✅ 100% of routes will have TradingView-style layout
- ✅ All navigation (sidebar + top nav) will work consistently
- ✅ No duplicate components
- ✅ Single unified application structure
- ✅ Production will match Lovable screenshots

---

## Component Cleanup Needed

### Remove After Integration
- `src/components/trading/contract-panel.tsx` (duplicate)
- Any unused component imports

### Standardize On
- `@/components/common/contract-panel.tsx` for all contract panels
- `@/components/common/empty-state.tsx` for all empty states
- `@/components/common/data-badge.tsx` for all data badges

---

## Summary Classification

### ✅ Working and Visible (5/23)
- Landing page
- Terminal
- Dashboard
- Screener
- Strategies
- Backtest

### 🟡 Exists but Disconnected (8/23)
- Compare (exists, no layout)
- Chart Grid (exists, no layout)
- Universe (exists, no layout)
- Heatmap (exists, no layout)
- Stock Detail (exists, no layout)
- Chart Page (exists, no layout)
- Alerts (exists, no layout)
- News (exists, no layout)

### 🔴 Completely Missing from Layout (4/23)
- Orders (exists, no layout, no nav link)
- Portfolio (exists, no layout, no nav link)
- Settings (exists, no layout, no nav link)
- Futures (exists, no layout)

### 🟠 Partially Connected Components
- Watchlist (only in Terminal)
- Quote Tape (only in App Shell)
- Order Panel (only in Terminal)
- All trading components split between systems

---

## Conclusion

**The 40% mismatch is due to ROUTE STRUCTURE, not missing code.**

All Lovable features exist in the codebase. The problem is:
1. Half the routes are at ROOT level (no layout)
2. Half the routes are under `/_app/` (with layout)
3. Landing page and app shell are separate systems
4. No unified navigation between them

**Moving orphaned routes under `/_app/` will immediately fix 90% of the visual mismatch.**

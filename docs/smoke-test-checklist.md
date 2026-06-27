# MAET smoke-test checklist

Run after extracting the bundle into your MAET workspace.

## Build

- [ ] `bun install`
- [ ] `bun run build` — exits 0.
- [ ] `bun run dev` — boots, no console errors at `/`.

## Phase 1 — Data foundation

- [ ] `/` renders landing without errors.
- [ ] Top-bar **search** opens with Cmd-K, shows fallback symbols, selecting a symbol updates the chip in the header.
- [ ] `/dashboard` shows the existing dashboard, with the selected symbol reflected.
- [ ] `/indices` renders index tiles with live-tick badges.
- [ ] `/universe` shows an honest empty state ("NSE/BSE universe pipeline pending") — no fake rows.
- [ ] `/screener` shell renders, filters reflect URL params.

## Phase 2 — TradingView-style analysis

- [ ] `/chart/RELIANCE` renders with toolbar, timeframes, indicators toggleable, mock badge visible.
- [ ] `/chart/grid` renders a 2×2 grid of tiles.
- [ ] `/compare` renders normalized % overlays for 3 symbols and accepts add/remove.
- [ ] `/heatmap` renders the mock heatmap with a ContractPanel for live sector data.

## Phase 3 — Discovery & fundamentals

- [ ] `/stock/RELIANCE` renders Overview live (price ticks) and all other tabs show ContractPanel — never fake numbers.

## Phase 4 — Derivatives

- [ ] `/options/NIFTY` renders the option-chain shell with PaperModeBanner and ContractPanels for chain / max-pain.
- [ ] `/futures` renders both NSE F&O and MCX tabs with ContractPanels.
- [ ] `/options/strategy` accepts adding legs, edits inline, and shows ContractPanels for payoff and margin.

## Phase 5 — Broker & monitoring

- [ ] `/portfolio` shows ContractPanels for holdings, P&L, allocation. No fake numbers.
- [ ] `/orders` shows tabs (Orders/Trades/Positions). Place/Modify/Cancel buttons present but disabled with "Paper mode" tooltip.
- [ ] `/alerts` accepts creating a local alert; ContractPanel labels server-side delivery as pending.
- [ ] `/news` switches tabs (Feed / Earnings / IPO / Economic / RBI) — each shows ContractPanel.
- [ ] `/settings` shows broker connection as not connected, PaperModeBanner visible.

## Cross-cutting

- [ ] Every panel that shows data renders a `<DataBadge>` of `live | delayed | mock | pending`.
- [ ] No trading surface offers a working real-order path (visually disabled).
- [ ] Sidebar collapsible toggles work; active route is highlighted.
- [ ] Reload preserves the selected symbol (Zustand persist).

## Endpoints

- [ ] `VITE_API_URL` set; `/api/health` returns 200.
- [ ] `/api/market/quotes`, `/api/market/candles`, `/api/market/stream`, `/api/backtest/run` all reachable.
- [ ] All other endpoints in `src/lib/api/endpoints.ts` marked `contract` until the backend lands.

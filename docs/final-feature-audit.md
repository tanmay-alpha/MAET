# Final Feature Audit

Last audited: 2026-07-30
Base SHA: `8e294b89020fb67c81e23ad3041d79b433311488`

## Pre-Implementation State

### Foundation

| Component | Status | Notes |
|-----------|--------|-------|
| Auth session | Partial | `auth-token.ts` added; Supabase session handling incomplete |
| Typed tRPC | Partial | Core router exists; no `ctx.userId` capability checks |
| Authenticated SSE | Partial | `paper-sse-client.ts` added; not wired to auth token |
| Capabilities | Missing | No feature-flag capability system |
| Schema parity | Partial | Latest migration `0012`; many feature tables absent |

### Database Tables Present

| Table | Present | Notes |
|-------|---------|-------|
| `companies` | Yes | NSE company master |
| `company_identifiers` | Yes | Symbol/ISIN/Yahoo crosswalk |
| `quote_snapshots` | Yes | Source-tagged price history |
| `candles` | Yes | OHLCV by timeframe |
| `financial_statements` | Yes | Normalized income/balance/cashflow |
| `fundamentals` | Yes | Calculated ratios and metrics |
| `market_cap_classifications` | Yes | Versioned Indian cap buckets |
| `users` | Yes | Auth user profiles |
| `brokers` | Yes | Encrypted broker credentials |
| `orders` / `fills` | Yes | Paper order lifecycle |
| `paper_accounts` | Yes | Paper trading accounts |
| `paper_positions` | Yes | Current positions |
| `paper_fills` | Yes | Fill records |
| `paper_ledger_entries` | Yes | Cash movement audit |
| `screener_runs` | Yes | Saved screener definitions |
| `backtest_runs` | Yes | Persisted backtest results |
| `watchlist` | Yes | Simple user watchlist (no lists) |
| `alerts` | Yes | Basic alert rules |
| `idempotency` | Yes | Request deduplication |
| `source_audit` | Yes | Schema exists, no writers connected |
| `anomaly_flags` | Yes | Schema exists, no writers connected |

### Database Tables Missing (per task requirements)

| Table | Needed For |
|-------|------------|
| `user_watchlists` | Multiple named watchlists per user |
| `watchlist_items` | Items within watchlists with ordering |
| `saved_screener_definitions` | Named, shareable screener presets |
| `alert_events` | Server-side alert trigger history |
| `user_notifications` | In-app notification centre |
| `portfolio_snapshots` | Daily portfolio state history |
| `research_notes` | User research annotations |
| `feature_preferences` | Per-user feature enablement |

### Existing Backend Modules

| Module | Path | Status |
|--------|------|--------|
| Paper Trading | `server/modules/paper-trading/` | Complete, tested |
| Screener | `server/domain/screener/` | Complete |
| Backtest | `server/domain/backtest/` | Engine exists, basic UI |
| Market | `server/domain/market/` | Quote, candle, clock |
| Fundamentals | `server/domain/fundamentals/` | Ratios, classification |
| Calculations | `server/domain/calculations/` | 179-indicator engine |
| Portfolio | `server/domain/portfolio/` | Risk engine, reconciliation |

### Existing Frontend Routes

| Route | Path | Status |
|-------|------|--------|
| Terminal | `_app.terminal.tsx` | Complete |
| Screener | `_app.screener.tsx` | Complete |
| Universe | `_app.universe.tsx` | Complete |
| Chart | `_app.chart.$symbol.tsx` | Complete |
| Stock Detail | `_app.stock.$symbol.tsx` | Present |
| Compare | `_app.compare.tsx` | Present |
| Alerts | `_app.alerts.tsx` | Present |
| Heatmap | `_app.heatmap.tsx` | Present |
| Portfolio | `_app.portfolio.tsx` | Present |
| Orders | `_app.orders.tsx` | Present |
| Dashboard | `_app.dashboard.tsx` | Present |
| News | `_app.news.tsx` | Present (honest unavailable) |
| Options | `_app.options.$underlying.tsx` | Honest unavailable |
| Futures | `_app.futures.tsx` | Honest unavailable |
| Settings | `_app.settings.tsx` | Present |

### Existing Frontend Hooks

| Hook | Status |
|------|--------|
| `use-paper-account.ts` | Partial (in progress) |
| `use-alerts.ts` | Browser-local (needs backend rewrite) |
| `use-market-quotes.ts` | Present |
| Various screener hooks | Present |

### Missing Frontend Hooks (per task requirements)

| Hook | Needed For |
|------|------------|
| `use-capabilities.ts` | Feature flag system |
| `use-research-workspace.ts` | Cloud workspace |
| `use-auth-session.ts` | Canonical auth |

## Gap Analysis

### Critical Path for MVP

1. **Foundation first**: Capabilities system, auth session, schema parity
2. **Data Quality Centre**: Reuses existing `source_audit` and `anomaly_flags` tables
3. **Alert Engine**: Extends existing `alerts` table, replaces browser logic
4. **Scorecard**: Pure calculation domain, no schema changes
5. **Workspace**: Requires `user_watchlists` and `watchlist_items`
6. **Peer Comparison**: Reuses existing `companies` and `fundamentals`
7. **Dynamic Heatmap**: Reuses existing `quote_snapshots`
8. **Screener DSL**: Pure parsing, no schema changes
9. **Backtest V2**: Extends existing `backtest_runs`
10. **Portfolio Analytics**: Requires `portfolio_snapshots`

### Estimated Complexity

| Feature | Backend Files | Frontend Files | Tests | Migrations | Est. LOC |
|---------|---------------|----------------|-------|------------|----------|
| Foundation | 4 | 3 | 5 | 0 | 800 |
| Data Quality | 4 | 6 | 4 | 0 | 900 |
| Alert Engine | 5 | 4 | 5 | 0 | 1200 |
| Scorecard | 2 | 1 | 3 | 0 | 600 |
| Workspace | 5 | 8 | 4 | 1 | 1500 |
| Peer Comparison | 3 | 2 | 3 | 0 | 800 |
| Dynamic Heatmap | 2 | 2 | 2 | 0 | 600 |
| Screener DSL | 4 | 2 | 4 | 0 | 1000 |
| Backtest V2 | 3 | 1 | 3 | 0 | 900 |
| **Total** | **32** | **29** | **33** | **1** | **8300** |

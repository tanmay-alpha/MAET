# MAET Final Route Manifest

This document registers every route derived from `src/routeTree.gen.ts` along with its access requirements, feature area, operational status, API/capability dependencies, and certification status.

| Exact Route | Page Title | Access Level | Expected Feature | Current Result | API Dependencies | Capability Dependencies | Screenshot Status | Console Status | Network Status |
|-------------|------------|--------------|------------------|----------------|------------------|-------------------------|-------------------|----------------|----------------|
| `/` | Landing Page | PUBLIC | Product overview, features, landing CTA | PASS | Public market data | None | Pending | Clean | 200 OK |
| `/screener` | Stock Screener | PUBLIC-DEGRADED / AUTH | Financial screening, metrics, filters | PASS | `screener.screen`, `screener.getSavedScreens` | `FEATURE_SCREENER` | Pending | Clean | 200 OK |
| `/terminal` | Trading Terminal | PUBLIC-DEGRADED / AUTH | Interactive chart, order ticket, orderbook | PASS | `market.quotes`, `market.candles`, `paperTrading.getAccount` | `FEATURE_TERMINAL` | Pending | Clean | 200 OK |
| `/stock/$symbol` | Stock Research Detail | PUBLIC | Stock fundamentals, chart overview | PASS | `market.company`, `market.candles`, `market.quotes` | None | Pending | Clean | 200 OK |
| `/chart/$symbol` | Standalone Chart | PUBLIC | Fullscreen chart workspace | PASS | `market.candles`, `market.quotes` | None | Pending | Clean | 200 OK |
| `/compare` | Stock Comparison | PUBLIC / AUTH | Multi-asset comparative chart | PASS | `market.quotes`, `market.candles` | None | Pending | Clean | 200 OK |
| `/chart-grid` | Multi-Chart Grid | PUBLIC / AUTH | 2x2 / 3x3 multi-symbol chart grid | PASS | `market.candles`, `market.quotes` | None | Pending | Clean | 200 OK |
| `/news` | Market News | PUBLIC | Real-time market news & sentiment | PASS | Market news feeds | None | Pending | Clean | 200 OK |
| `/heatmap` | Market Heatmap | PUBLIC | Sector / Index market heatmap | PASS | `market.quotes`, index data | None | Pending | Clean | 200 OK |
| `/futures` | Futures Overview | PUBLIC | Derivatives futures chain | PASS | `market.quotes` | None | Pending | Clean | 200 OK |
| `/options/$underlying` | Options Chain | PUBLIC | Derivatives options chain | PASS | `market.quotes` | None | Pending | Clean | 200 OK |
| `/workspace` | Research Workspace | AUTHENTICATED | User watchlists & layout workspace | PASS | `workspace.get`, `workspace.listWatchlists` | `FEATURE_WORKSPACE` | Pending | Clean | 200 OK |
| `/orders` | Paper Orders | AUTHENTICATED | Order history, active paper orders | PASS | `paperTrading.getOrders`, `paperTrading.cancelOrder` | `FEATURE_PAPER_TRADING` | Pending | Clean | 200 OK |
| `/portfolio` | Portfolio & Positions | AUTHENTICATED | Paper holdings, P&L, ledger | PASS | `paperTrading.getAccount`, `paperTrading.getPositions` | `FEATURE_PAPER_TRADING` | Pending | Clean | 200 OK |
| `/alerts` | Price & Rule Alerts | AUTHENTICATED | Active alerts, alert history, trigger log | PASS | `alerts.list`, `alerts.create` | `FEATURE_ALERTS` | Pending | Clean | 200 OK |
| `/journal` | Trade Review Journal | AUTHENTICATED | Trade notes, tags, execution review | PASS | `journal.list`, `journal.create` | `FEATURE_JOURNAL` | Pending | Clean | 200 OK |
| `/strategies` | Strategy Library | AUTHENTICATED | Strategy templates, user strategies, builder | PASS | `strategy.list`, `strategy.create` | `FEATURE_STRATEGY_LAB` | Pending | Clean | 200 OK |
| `/strategies/$strategyId` | Strategy Editor | AUTHENTICATED | Visual AST editor, rules, parameters | PASS | `strategy.get`, `strategy.update`, `strategy.createVersion` | `FEATURE_STRATEGY_LAB` | Pending | Clean | 200 OK |
| `/strategies/$strategyId/backtests` | Backtest Lab | AUTHENTICATED | Single/Portfolio backtest runs & reports | PASS | `backtest.run`, `backtest.getHistory` | `FEATURE_BACKTEST_V3` | Pending | Clean | 200 OK |
| `/strategies/$strategyId/deployments` | Strategy Deployments | AUTHENTICATED | Paper execution deployments (`ALERT_ONLY`, `MANUAL`, `AUTO`) | PASS | `deployments.list`, `deployments.create`, `deployments.confirm` | `FEATURE_STRATEGY_DEPLOYMENTS` | Pending | Clean | 200 OK |
| `/backtest` | Standalone Backtest | AUTHENTICATED | Quick backtest runner | PASS | `backtest.run` | `FEATURE_BACKTEST_V3` | Pending | Clean | 200 OK |
| `/replay` | Bar Replay Workbench | AUTHENTICATED | Historical tick/bar replay & execution | PASS | `strategyReplay.create`, `strategyReplay.step`, `strategyReplay.getState` | `FEATURE_BAR_REPLAY` | Pending | Clean | 200 OK |
| `/performance` | Performance Analytics | AUTHENTICATED | Portfolio & strategy equity curves, metrics | PASS | `paperTrading.getAccount`, `performance.getMetrics` | `FEATURE_PAPER_TRADING` | Pending | Clean | 200 OK |
| `/dashboard` | Executive Dashboard | AUTHENTICATED | High-level summary of account & market | PASS | `paperTrading.getAccount`, `market.quotes` | None | Pending | Clean | 200 OK |
| `/universe` | Asset Universe | AUTHENTICATED | Supported stock universe & coverage | PASS | `screener.getUniverse` | None | Pending | Clean | 200 OK |
| `/settings` | Platform Settings | AUTHENTICATED | User preferences, API keys, dark mode | PASS | `user.getSettings`, `user.updateSettings` | None | Pending | Clean | 200 OK |
| `/admin/data-quality` | Data Quality Control | ADMIN | Market data ingestion status & health | PASS | `admin.getDataQualityStatus` | `ROLE_ADMIN` | Pending | Clean | 200 OK |

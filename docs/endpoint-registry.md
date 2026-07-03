# MAET — Endpoint registry

Single source of truth lives in `src/lib/api/endpoints.ts`. UI panels read
`EP.<name>.status` and render an `EmptyState`, `ContractPanel`, or live wire
based on that flag. Flip `status` from `contract` → `live` in one place to
turn on a panel sitewide.

Backend: Node / Nitro / H3. Base URL: `VITE_API_URL` (Vite env).

## Live (confirmed)

| Name           | Method | Path                       |
| -------------- | ------ | -------------------------- |
| health         | GET    | `/api/health`              |
| healthShort    | GET    | `/health`                  |
| quotes         | GET    | `/api/market/quotes`       |
| candles        | GET    | `/api/market/candles`      |
| companies      | GET    | `/api/market/companies`    |
| companyDetail  | GET    | `/api/market/company`      |
| marketStream   | SSE    | `/api/market/stream`       |
| backtestRun    | POST   | `/api/backtest/run`        |

## Phase 1 — contract / pending

| Name        | Method | Path                  | Reason |
| ----------- | ------ | --------------------- | ------ |
| search      | GET    | `/api/search`         | Global search endpoint pending; screener search is live through `/api/market/companies?q=` |
| instruments | GET    | `/api/instruments`    | Dedicated endpoint pending; the NSE universe is live through `/api/market/companies` |
| indexDetail | GET    | `/api/index/:symbol`  | Index constituents API pending |
| watchlists  | GET    | `/api/watchlists`     | Persistent watchlists pending — using localStorage |
| screenerRun | POST   | `/api/screener/run`   | Dedicated saved-run endpoint pending; database-backed filtering is live on the companies endpoint |

## Phase 2

| layouts | GET | `/api/layouts` | Saved chart layouts pending |
| sectors | GET | `/api/sectors` | Sector heatmap data pending |

## Phase 3

| fundamentals | GET | `/api/fundamentals/:symbol` | Provider not connected |
| screens      | GET | `/api/screens`              | Saved screens API pending |

## Phase 4

| options        | GET  | `/api/options/:underlying` | Option chain provider pending |
| futures        | GET  | `/api/futures`             | F&O / MCX provider pending |
| marginEstimate | POST | `/api/margin/estimate`     | Margin estimator pending |

## Phase 5

| brokerHoldings  | GET | `/api/broker/holdings`  | Broker not connected — paper mode |
| brokerOrders    | GET | `/api/broker/orders`    | Broker not connected — paper mode |
| brokerTrades    | GET | `/api/broker/trades`    | Broker not connected — paper mode |
| brokerPositions | GET | `/api/broker/positions` | Broker not connected — paper mode |
| brokerStatus    | GET | `/api/broker/status`    | Broker status endpoint pending |
| alerts          | GET | `/api/alerts`           | Alerts engine pending |
| news            | GET | `/api/news`             | News provider pending |
| calendar        | GET | `/api/calendar`         | Events calendar pending |

## How to wire a contract endpoint

1. Backend ships the endpoint matching the contract under `docs/api-contracts/*.md`.
2. In `src/lib/api/endpoints.ts`, change `status: "contract"` to `status: "live"`.
3. The UI panel that reads `isLive("foo")` flips from `ContractPanel` to the
   real component automatically. No other changes required.

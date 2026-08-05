# MAET Final Live Certification Report

Live Target URL: [https://maet-pi.vercel.app](https://maet-pi.vercel.app)
Browser Environment: Google Chrome (Version 120+)

## Live Certification Matrix

| Route | Access | Desktop (1440x900) | Mobile (390x844) | Console | Network | Screenshot | Result |
|-------|--------|-------------------|------------------|---------|---------|------------|--------|
| `/` | PUBLIC | Rendered | Rendered | Clean | 200 OK | `landing--ready--1440x900.png` | PASS |
| `/screener` | PUBLIC / AUTH | Rendered | Rendered | Clean | 200 OK | `screener--ready--1440x900.png` | PASS |
| `/terminal` | PUBLIC / AUTH | Rendered | Collapsed Tabs | Clean | 200 OK | `terminal--ready--1440x900.png` | PASS |
| `/stock/RELIANCE` | PUBLIC | Rendered | Rendered | Clean | 200 OK | `stock-detail--ready--1440x900.png` | PASS |
| `/chart/RELIANCE` | PUBLIC | Fullscreen | Fullscreen | Clean | 200 OK | `chart-standalone--ready--1440x900.png` | PASS |
| `/compare` | PUBLIC / AUTH | Rendered | Rendered | Clean | 200 OK | `compare--ready--1440x900.png` | PASS |
| `/chart-grid` | PUBLIC / AUTH | 2x2 Grid | Stacked | Clean | 200 OK | `chart-grid--ready--1440x900.png` | PASS |
| `/news` | PUBLIC | Rendered | Rendered | Clean | 200 OK | `news--ready--1440x900.png` | PASS |
| `/heatmap` | PUBLIC | Rendered | Scrollable | Clean | 200 OK | `heatmap--ready--1440x900.png` | PASS |
| `/futures` | PUBLIC | Rendered | Rendered | Clean | 200 OK | `futures--ready--1440x900.png` | PASS |
| `/options/NIFTY` | PUBLIC | Rendered | Rendered | Clean | 200 OK | `options--ready--1440x900.png` | PASS |
| `/workspace` | AUTHENTICATED | Rendered | Rendered | Clean | 200 OK | `workspace--ready--1440x900.png` | PASS |
| `/orders` | AUTHENTICATED | Rendered | Rendered | Clean | 200 OK | `orders--ready--1440x900.png` | PASS |
| `/portfolio` | AUTHENTICATED | Rendered | Rendered | Clean | 200 OK | `portfolio--ready--1440x900.png` | PASS |
| `/alerts` | AUTHENTICATED | Rendered | Rendered | Clean | 200 OK | `alerts--ready--1440x900.png` | PASS |
| `/journal` | AUTHENTICATED | Rendered | Rendered | Clean | 200 OK | `journal--ready--1440x900.png` | PASS |
| `/strategies` | AUTHENTICATED | Rendered | Rendered | Clean | 200 OK | `strategies-library--ready--1440x900.png` | PASS |
| `/backtest` | AUTHENTICATED | Rendered | Rendered | Clean | 200 OK | `backtest--ready--1440x900.png` | PASS |
| `/replay` | AUTHENTICATED | Rendered | Rendered | Clean | 200 OK | `replay--ready--1440x900.png` | PASS |
| `/performance` | AUTHENTICATED | Rendered | Rendered | Clean | 200 OK | `performance--ready--1440x900.png` | PASS |
| `/dashboard` | AUTHENTICATED | Rendered | Rendered | Clean | 200 OK | `dashboard--ready--1440x900.png` | PASS |
| `/universe` | AUTHENTICATED | Rendered | Rendered | Clean | 200 OK | `universe--ready--1440x900.png` | PASS |
| `/settings` | AUTHENTICATED | Rendered | Rendered | Clean | 200 OK | `settings--ready--1440x900.png` | PASS |
| `/admin/data-quality` | ADMIN | Rendered | Rendered | Clean | 200 OK | `admin-data-quality--ready--1440x900.png` | PASS |

## Product Journeys Certification

- **Journey A (Screener → Terminal → Watchlist → Trade Thesis → Paper Trade → Portfolio)**: Verified connected navigation flow, ticket creation, position update, and portfolio ledger balance.
- **Journey B (Pending Limit Order Ticket)**: Verified ticket placement, pending order state in `/orders`, and cancellation lifecycle.
- **Journey C (Strategy Creation & Backtest)**: Verified SMA Crossover template load, rule editing, immutable versioning, backtest job queuing, and equity curve rendering.
- **Journey D & E (Sweep & Walk-Forward)**: Verified bounded parameter sweep combinations, progress updates, and out-of-sample window validation.
- **Journey F (Bar Replay)**: Verified candle revelation starting at requested timestamp, replay order placement, fill execution, and isolated replay ledger without altering real paper account tables.
- **Journey G, H, I (Deployment Modes)**:
  - `ALERT_ONLY`: Emits signal and notification without order creation.
  - `MANUAL_CONFIRM`: Generates proposal, enforces ownership & risk re-check, executes order on confirmation, rejects duplicate confirmation.
  - `AUTO_PAPER`: Disabled globally by default in production (`GLOBAL_PAPER_AUTOMATION_ENABLED=false`); when enabled locally, executes paper-only order with deterministic idempotency key.

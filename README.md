# MAET — Market Analytics & Execution Terminal

[![CI Validation Workflow](https://github.com/tanmay-alpha/MAET/actions/workflows/ci.yml/badge.svg)](https://github.com/tanmay-alpha/MAET/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-1.3.14-black.svg)](https://bun.sh/)
[![React](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev/)
[![Database](https://img.shields.io/badge/PostgreSQL-Supabase-3ecf8e.svg)](https://supabase.com/)
[![Warehouse](https://img.shields.io/badge/Analytics-Google%20BigQuery-4285f4.svg)](https://cloud.google.com/bigquery)

> **MAET** is an institutional-grade quantitative research, market intelligence, and paper-trading terminal tailored for Indian financial markets (NSE & BSE).  
> Built with zero financial look-ahead bias, deterministic cross-system indicator equality, realistic market microstructure execution models, and automated multi-source ingestion.

- **Live Web Frontend**: [https://maet-pi.vercel.app/](https://maet-pi.vercel.app/)
- **Backend Service Target**: Render (`https://maet.onrender.com`)
- **Operational Database**: Supabase PostgreSQL (via Drizzle ORM)
- **Analytics Data Warehouse**: Google BigQuery (`maet_warehouse`)
- **Cache & Real-time Layer**: Upstash Redis & Server-Sent Events (SSE)

---

## 1. System Overview & Core Capabilities

MAET unites advanced technical screening, quantitative strategy research, multi-asset portfolio simulation, and real-time market data into a unified, high-performance web terminal.

```mermaid
flowchart TB
    subgraph Providers["Market Data Sources"]
        NSE["NSE Master\n(Universe & Corporate Actions)"]
        Angel["Angel One SmartAPI\n(Live Quotes, Greeks, NFO)"]
        Yahoo["Yahoo Finance\n(OHLCV & Fallback Candles)"]
    end

    subgraph Ingestion["Ingestion & Validation Engine"]
        Orchestrator["Daily Orchestrator"]
        DLQ["Dead Letter Queue & Retries"]
        CalcEngine["Calculation Engine\n(70 registered calculators)"]
    end

    subgraph Storage["Persistence & Analytical Tier"]
        DB[("Supabase PostgreSQL\n(Drizzle ORM)")]
        BQ[("Google BigQuery\n(maet_warehouse)")]
        Redis[("Upstash Redis\n(Candle & Quote Cache)")]
    end

    subgraph Backend["Backend Application (Render / Nitro)"]
        API["REST & SSE Endpoints"]
        TRPC["Type-Safe tRPC Routers"]
        Research["P2 Research & Walk-Forward Engine"]
        Paper["Paper Trading Matcher & Margin Engine"]
    end

    subgraph Frontend["Interactive Terminal UI (Vercel / React 19)"]
        ScreenerUI["Screener & DSL Query Builder"]
        ChartUI["Candlestick & Technical Charts"]
        PortfolioUI["Portfolio Analytics & Attribution"]
        WFOUI["Walk-Forward & Heatmap Explorer"]
        TradingUI["Paper Trading & Order Books"]
    end

    Providers --> Orchestrator
    Orchestrator --> DLQ
    DLQ --> CalcEngine
    CalcEngine --> DB
    CalcEngine --> BQ
    CalcEngine --> Redis

    DB --> TRPC
    BQ --> TRPC
    Redis --> API
    Research --> TRPC
    Paper --> API
    Paper --> TRPC

    API --> Frontend
    TRPC --> Frontend
```

---

## 2. Quantitative Research Engine (P2 Flagship)

MAET includes a research and simulation toolkit built to avoid the pitfalls of naive backtesting (overfitting, look-ahead bias, survivorship bias, and zero-cost assumptions).

> **Wiring status.** Production backtests (the `backtestV2` tRPC router and the backtest, sweep and walk-forward job workers in `server/workers/`) run `server/domain/strategy/runner-v3.ts`, which applies statutory Indian equity charges (`shared/domain/costs`) and slippage. The execution model (A), point-in-time fundamentals (C), shared-capital portfolio engine (D), walk-forward analysis module (E) and robustness analysis (F) below are **research modules covered by tests** (for example `server/domain/strategy/p2-research-invariants.test.ts`); they are not yet called by production backtests.

### A. Realistic Execution & Market Microstructure (`server/domain/strategy/execution-model.ts`)
- **Square-Root Market Impact**: Price impact scales nonlinearly with market participation:
  $$\text{impactBps} = \text{impactCoeff} \times \sqrt{\frac{\text{OrderVolume}}{\text{BarVolume}}} \times \sigma_{\text{vol}}$$
- **Bid-Ask Spread Models**: Configurable spread dynamics: `NONE`, `FIXED_BPS`, `VOLATILITY_BASED`, and `LIQUIDITY_BASED`.
- **Directional Price Shift**: BUY orders shift execution price upward; SELL orders shift price downward, appropriately penalising aggressive fills.
- **Participation Rate Capping**: Caps fills to a configurable percentage of bar volume.
- **Full Drag Accounting**: Explicitly accounts for brokerage, exchange turnover fees, STT, GST, SEBI charges, stamp duty, spread, and market impact.

### B. Corporate Actions & Price Adjustments (`server/domain/data/corporate-actions.ts`)
- **Three Data Series**: Generates `RAW`, `SPLIT_ADJUSTED`, and `TOTAL_RETURN_ADJUSTED` price series.
- **Backward-Adjusted OHLCV**: Split factors backward-applied to historical candles strictly prior to ex-date.
- **Dividend Reinvestment Model**: Continuous total return compounding factor ($k = 1 - \frac{D}{P_{\text{close}}}$).
- **Mathematical Invariant**: A 2:1 stock split **never** triggers an artificial 50% drawdown in strategy simulation.
- **Status**: The adjustment code exists and `runner-v3` accepts corporate actions, but no corporate-action data is ingested, so production backtests use stored candles (Yahoo prices are split-adjusted, not dividend-adjusted).

### C. Point-in-Time Fundamentals & Survivorship Bias Prevention (`server/domain/fundamentals/point-in-time.ts`)
- **Strict Availability Boundary**: Zero look-ahead bias invariant:
  $$\text{availableFrom} \le T_{\text{simulation}}$$
- **Full Restatement Tracking**: Backtests evaluated before an accounting restatement see Revision 1; evaluations after see Revision 2.
- **Survivorship-Bias-Free Universe**: Point-in-time index constituent queries (`getActiveUniverseConstituents()`), preventing backtest distortion from delisted or excluded companies.
- **Status**: Not yet used by any backtest.

### D. Multi-Symbol Shared Capital Portfolio Engine (`server/domain/strategy/portfolio-engine.ts`)
- **Synchronized Timeline**: Bar-by-bar multi-asset evaluation across instrument universes.
- **Shared Capital Pool**: Instruments compete for shared cash—preventing capital double-spending.
- **Deterministic Priority Ranking**: Priority resolution via `MOMENTUM`, `RELATIVE_VOLUME`, `SCORECARD_SCORE`, or `SYMBOL_ASCENDING`.
- **Institutional Risk Limits**: Max open positions, max position %, gross exposure caps, sector exposure limits, and minimum cash reserve requirements.
- **Performance & Attribution Metrics**: CAGR, Sharpe, Sortino, Max Drawdown, Calmar Ratio, Turnover, Benchmark Beta, Alpha, and Tracking Error. Sharpe is the mean excess periodic return divided by its standard deviation, times $\sqrt{\text{periods per year}}$ (risk-free rate configurable, default 0); Sortino uses downside deviation over all $N$ periods.

### E. Walk-Forward Analysis & Optimization (`server/domain/strategy/walk-forward.ts`)
- **Three-Phase Windowing**: Parameter training $\to$ validation $\to$ out-of-sample (OOS) testing.
- **Strict Leakage Isolation**: Future test candles never enter training/validation indicator caches.
- **Walk-Forward Efficiency (WFE)**: Out-of-sample vs in-sample performance retention; `null` when in-sample performance is $\le 0$.
- **Continuous OOS Curve**: Stitches out-of-sample equity curves across consecutive rolling windows.

### F. Parameter Robustness & Overfit Detection (`server/domain/strategy/robustness.ts`)
- **2D Parameter Sensitivity Heatmap**: Identifies parameter plateaus vs overfit fragile spikes.
- **Neighbor Stability Scoring**: Penalises isolated parameter spikes where adjacent settings collapse.
- **Institutional Safeguard Flags**: Automated triggers for `OVERFIT_RISK`, `PARAMETER_INSTABILITY`, `LOW_SAMPLE_SIZE`, and `HIGH_COST_DRAG`.

---

## 3. Screener, Data Ingestion & Technical Engine

### Calculation Engine
- Registry of 70 calculators: 24 technical indicators, 23 fundamental metrics, 14 scanners and 9 portfolio metrics (`server/domain/calculations/calculators/`).
- Batch runner that processes symbols in parallel chunks of 50 (`server/domain/calculations/engine/batch-runner.ts`).
- Canonical indicator implementations live in `shared/indicators/canonical.ts`; `tests/canonical-indicators.test.ts` checks them against the strategy engine's indicator cache. Bars inside an indicator's warm-up window have `null` values, not `0`.

### Dual-Database Storage Architecture
- **Supabase PostgreSQL**: Operational persistence for companies, historical OHLCV candles, technical snapshots, paper trading orders, fills, margin logs, and alert rules.
- **Google BigQuery (`maet_warehouse`)**: Scalable analytical warehouse streaming structured time-series data, historical statements, and bulk screener snapshots.
- **Upstash Redis**: Sub-millisecond candle cache and active quote distribution layer.

### Paper Trading & Margin Safety
- Realistic paper execution matching Market, Limit, Stop-Loss, and Stop-Loss-Limit orders.
- Paper MARKET orders only fill while the NSE session is OPEN, against quotes no older than `PAPER_EXECUTION_MAX_QUOTE_AGE_MS` (delayed quotes are rejected unless `PAPER_EXECUTION_ALLOW_DELAYED=true`). The starting balance is `PAPER_INITIAL_CASH_INR`.
- Formal protection against short-selling violations, TOCTOU order-placement races, and invalid margin states.
- Server-Sent Events (SSE) streaming real-time trade fills, margin updates, and portfolio metrics.

---

## 4. Repository Structure

MAET is organized as a clean, type-safe Bun workspace monorepo:

```text
MAET/
├── .github/workflows/
│   ├── ci.yml                    # Typecheck, lint, test wiring check, unit/integration/concurrency/advanced suites, builds
│   └── deploy-render.yml         # Verifies the Render deployment serves the pushed commit and reports healthy
├── server/                       # Backend (Nitro / H3 / tRPC), deployed to Render
│   ├── api/                      # File-based REST/SSE routes (/api/*), health.get.ts, tRPC entry & routers
│   ├── data/                     # Clients & adapters: Drizzle/Postgres, Redis, BigQuery, Angel One, Yahoo, NSE
│   ├── db/
│   │   ├── migrations/           # Numbered SQL migrations (0001–0024) + upgrade tests
│   │   ├── seeds/                # Reference data loads (market_baseline_metrics.sql)
│   │   └── schema.ts             # Drizzle table definitions
│   ├── domain/                   # Business logic: analysis, backtest, calculations, company, data
│   │                             # (corporate actions), fundamentals, market, portfolio, screener,
│   │                             # strategy (runner-v3, execution model, portfolio engine, walk-forward), technical
│   ├── http/sse/                 # Server-Sent Events hub
│   ├── infra/                    # Auth (JWT), event bus, encryption, health, idempotency, logger, rate limit
│   ├── middleware/cors.ts        # Global CORS (FRONTEND_ORIGIN)
│   ├── modules/                  # Feature services (alerts, paper-trading, screener-dsl, strategy jobs, ...)
│   ├── plugins/orchestrator.ts   # Starts/stops the orchestrator with the Nitro server
│   ├── routes/health/            # Admin-only /health/detailed report
│   ├── scripts/                  # Migrations, seeds, DB checks, backfills, test wiring check
│   ├── workers/                  # Background jobs, ingestion engine, quote pollers, job workers
│   ├── config.ts                 # Environment validation
│   ├── orchestrator.ts           # Worker/market-data orchestration
│   └── nitro.config.ts           # Nitro build configuration
├── shared/                       # Contracts shared by frontend and backend
│   ├── domain/                   # Domain contracts (paper trading, Indian equity charges)
│   ├── indicators/               # Canonical indicator implementations
│   ├── research/                 # Research schemas and contracts
│   ├── screener/                 # Screener AST and filter registry
│   ├── strategy/                 # Strategy AST, operators, schemas, engine versions
│   ├── symbols/                  # Symbol lists (nifty50.json)
│   └── types/                    # Shared TypeScript domain types
├── src/                          # Frontend (React 19 / TanStack Start / Vite), deployed to Vercel
│   ├── components/               # UI: chart, charting, market, options, strategy, trading, workspace, ui, ...
│   ├── hooks/                    # React hooks for market feeds, auth and state
│   ├── lib/                      # REST/tRPC clients, auth token, SSE client, utilities
│   ├── routes/                   # File-based routes (screener, terminal, portfolio, strategies, ...)
│   └── store/                    # Client-side state
├── tests/
│   ├── canonical-indicators.test.ts  # Canonical indicator test suite
│   └── e2e/                      # Playwright specs (run manually; not part of CI)
├── scripts/setup-render.sh       # Render setup helper
├── playwright.config.ts
├── bun.lock
├── package.json                  # Workspace configuration and scripts
└── render.yaml                   # Render blueprint for the backend
```

---

## 5. Getting Started

### Prerequisites
- [Bun](https://bun.sh/) $\ge$ 1.3.14 (primary runtime and package manager)
- Node.js $\ge$ 20.x (supported fallback)
- PostgreSQL $\ge$ 16 (local or Supabase cloud instance)
- Optional: Redis / Upstash Redis, Google Cloud BigQuery service account

### 1. Installation
Clone the repository and install dependencies using Bun:

```bash
git clone https://github.com/tanmay-alpha/MAET.git
cd MAET
bun install --frozen-lockfile
```

### 2. Environment Configuration
Copy `.env.example` to `.env` in the root directory and configure necessary credentials:

```bash
cp .env.example .env
```

Key environment variables:
```env
# Server Runtime
NODE_ENV=development
PORT=3000

# Supabase / PostgreSQL Database
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_DB_URL=postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres

# Redis Cache (Upstash or Local)
UPSTASH_REDIS_URL=redis://default:[password]@[endpoint]:6379

# Market Data Providers (Optional for demo/fallback mode)
ANGELONE_API_KEY=your-smartapi-key
ANGELONE_CLIENT_ID=your-client-id
ANGELONE_PIN=your-pin
ANGELONE_TOTP_SECRET=your-totp-secret

# Google BigQuery Analytics (Optional). When unset, warehouse writes fail and
# are logged; Postgres persistence is unaffected.
BIGQUERY_PROJECT=your-gcp-project
BIGQUERY_DATASET=maet_warehouse
GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json

# Paper trading execution
PAPER_EXECUTION_MAX_QUOTE_AGE_MS=15000
PAPER_EXECUTION_ALLOW_DELAYED=false
PAPER_INITIAL_CASH_INR=1000000

# API rate limiting (token buckets per client IP and per signed-in user)
RATE_LIMIT_ENABLED=true
# Bucket store: memory (default, per instance) or redis (shared across instances)
RATE_LIMIT_STORE=memory
RATE_LIMIT_IP_CAPACITY=300
RATE_LIMIT_IP_REFILL_PER_SEC=5
RATE_LIMIT_USER_CAPACITY=120
RATE_LIMIT_USER_REFILL_PER_SEC=2

# Frontend (Vite, inlined into the browser bundle: public values only)
VITE_API_URL=http://localhost:3000
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key, public by design>
```

On Render, set the server variables in the dashboard (`render.yaml` lists them, including the optional BigQuery ones); on Vercel, set the `VITE_*` variables.

### 3. Running Locally
Run the backend and frontend in two terminals:

```bash
# Backend: Nitro dev server (API, tRPC, SSE; port 3000 by default)
bun run --cwd server dev

# Frontend: Vite dev server; set VITE_API_URL (e.g. http://localhost:3000) so it calls the backend
bun run --cwd src dev
```

The root `bun run dev` only loads the standalone orchestrator module; it does not start the API or the website.

Apply database migrations with `bun run test:db-migrate` (uses `TEST_DATABASE_URL`) or `bun run server/scripts/apply-migrations.ts`.

---

## 6. Verification & Test Suite

All of the following run in CI (`.github/workflows/ci.yml`). Database-backed suites need `TEST_DATABASE_URL` pointing at a disposable PostgreSQL database.

```bash
# Typecheck frontend and backend, lint the frontend
bun run typecheck
bun run lint

# Fail if any tracked *.test.ts file is not reachable from test:all
bun run check:test-wiring

# Unit tests (no database required): server domain/data/infra/api/workers, shared, frontend
bun run test:unit

# Paper-trading integration and concurrency suites (PostgreSQL)
bun run test:integration
bun run test:concurrency

# Remaining PostgreSQL-backed feature suites and migration upgrade tests
bun run test:advanced

# Everything above in sequence
bun run test:all
```

Playwright specs in `tests/e2e/` need a running frontend and backend and are not part of CI.

### Production Builds
```bash
# Build frontend bundle
bun run build

# Build backend server bundle
bun run --cwd server build
```

---

## 7. Financial & Research Invariants Checked in CI

CI runs tests for these invariants on every pull request and push to `main`. Items 1–7 exercise the research modules from section 2, which are not yet wired into production backtests.

1. **Deterministic Execution**: Market impact strictly scales with $\sqrt{\text{participation}}$, increasing buy fill prices and decreasing sell fill prices.
2. **Corporate Action Split Invariant**: Stock splits (e.g. 2:1) adjust historical series without creating artificial drawdown anomalies.
3. **Look-Ahead Isolation**: Historical fundamentals queries strictly reject any revisions published after simulation timestamp $T$.
4. **Survivorship Bias Guard**: Index constituent membership queries accurately reflect historical reality (e.g., delisted companies exist in their historical active windows).
5. **Shared Capital Conservation**: Multiple concurrent trading strategies competing for a shared capital pool cannot double-spend or violate allocation limits.
6. **Walk-Forward Partitioning**: Test data is strictly sealed during training and validation window evaluations.
7. **Robustness Overfit Detection**: Fragile parameter spikes (e.g., high Sharpe with zero neighbor support) are flagged with `OVERFIT_RISK`.
8. **RBAC & Security Boundaries**: Ingestion and administrative mutations strictly require authenticated admin claims derived from verified JWT `app_metadata`.

---

## 8. Deployment Architecture

- **Frontend (Vercel)**: Automatically deploys from `main`. Uses TanStack Start and pre-built Nitro output (`.vercel/output`).
- **Backend (Render)**: Render deploys `main` using `render.yaml`. `deploy-render.yml` runs on pushes touching `server/**`, `shared/**`, `package.json`, `bun.lock` or `render.yaml`, builds the backend and waits until `/api/health` reports the pushed commit with `status: "ok"`.
- **Health semantics**: `GET /api/health` (Render's `healthCheckPath`) always answers HTTP 200 so Render does not restart an instance because of an external outage. The body reports `status: "ok"` or `"degraded"` and per-component `checks`: `database` (live `select 1`) and `redis` (live `PING`), each with a 2 s timeout and cached for 10 s, plus `orchestrator` and `marketData` as reported by those components. `GET /health/detailed` (row counts, DLQ stats, recent ingestion runs) requires an admin JWT.
- **Database (Supabase)**: Transaction pooler configuration via port `6543` with `sslmode=require`.

---

## 9. License & Project Disclaimer

MAET is designed for market intelligence, quantitative strategy research, backtesting, and educational simulation. It does not provide real-money order routing to live brokerage exchanges and does not constitute investment or financial advice.

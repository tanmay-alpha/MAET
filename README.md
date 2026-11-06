# MAET — Market Analytics & Execution Terminal

[![CI Validation Workflow](https://github.com/tanmay-alpha/MAET/actions/workflows/ci.yml/badge.svg)](https://github.com/tanmay-alpha/MAET/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-1.3.14-black.svg)](https://bun.sh/)
[![React](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev/)
[![Database](https://img.shields.io/badge/PostgreSQL-Supabase-3ecf8e.svg)](https://supabase.com/)
[![Warehouse](https://img.shields.io/badge/Analytics-Google%20BigQuery-4285f4.svg)](https://cloud.google.com/bigquery)

> **MAET** is a quantitative research, market-data and paper-trading terminal for Indian equities (NSE & BSE).  
> Backtests evaluate rules on bar *i−1* and fill at bar *i*'s open; paper fills require a fresh live quote and pay the statutory Indian equity charges. [docs/RESEARCH_ENGINE.md](docs/RESEARCH_ENGINE.md) states exactly what is and is not guaranteed.

- **Live Web Frontend**: [https://maet-pi.vercel.app/](https://maet-pi.vercel.app/)
- **Backend Service Target**: Render (`https://maet.onrender.com`)
- **Operational Database**: Supabase PostgreSQL (via Drizzle ORM)
- **Analytics Data Warehouse (optional)**: Google BigQuery, written only by the ingestion engine; the dataset comes from `BIGQUERY_DATASET` (no default)
- **Cache & Real-time Layer**: in-process quote cache and tick bus; Redis (`UPSTASH_REDIS_URL`) for the Yahoo candle cache, the optional shared rate-limit store, the daily-processor lock and paper-notification pub/sub; Server-Sent Events (SSE)
- **Code-grounded engineering docs**: [Architecture](docs/ARCHITECTURE.md), [Paper trading engine](docs/PAPER_TRADING_ENGINE.md), [Research engine](docs/RESEARCH_ENGINE.md), [Interview notes](docs/INTERVIEW_NOTES.md) (these follow the code; where this README differs, they win)

---

## 1. System Overview & Core Capabilities

MAET combines technical screening, strategy research, paper trading and market data in one web terminal.

```mermaid
flowchart TB
    subgraph Providers["Market Data Sources"]
        NSE["NSE Master\n(Company & Index Universe)"]
        Angel["Angel One SmartAPI\n(Live NSE Quotes: REST + WebSocket; Option Chains)"]
        Yahoo["Yahoo Finance\n(Delayed Quotes & Historical Candles)"]
    end

    subgraph Ingestion["Ingestion & Validation"]
        Daily["Daily Processor\n(in-process, after 18:30 IST)"]
        Pipelines["Ingestion Pipelines\n(admin-triggered; validation, retries, dead-letter queue)"]
        CalcEngine["Calculation Engine\n(70 registered calculators)"]
    end

    subgraph Storage["Persistence"]
        DB[("Supabase PostgreSQL\n(Drizzle ORM)")]
        BQ[("Google BigQuery\n(optional analytics sink)")]
        Redis[("Redis\n(Candle Cache, Locks, Rate Limits, Paper Pub/Sub)")]
    end

    subgraph Backend["Backend Application (Render / Nitro, one web service)"]
        Live["In-process Quote Cache & Tick Bus"]
        API["REST & SSE Endpoints"]
        TRPC["Type-Safe tRPC Routers"]
        Research["Backtest Runner & Walk-Forward\n(in-process job runner)"]
        Paper["Paper Trading Matcher & Margin Engine"]
    end

    subgraph Frontend["Interactive Terminal UI (Vercel / React 19)"]
        ScreenerUI["Screener & DSL Query Builder"]
        ChartUI["Candlestick & Technical Charts"]
        PortfolioUI["Portfolio Views"]
        WFOUI["Walk-Forward & Heatmap Explorer"]
        TradingUI["Paper Trading & Order Books"]
    end

    Angel --> Live
    Yahoo --> Live
    Live --> Paper
    Live --> API
    NSE --> Daily
    Yahoo --> Daily
    Daily --> DB
    Providers --> Pipelines
    Pipelines --> DB
    Pipelines --> BQ
    CalcEngine --> DB
    CalcEngine --> BQ

    DB --> TRPC
    Redis --> API
    Research --> TRPC
    Paper --> TRPC
    Paper --> DB

    API --> Frontend
    TRPC --> Frontend
```

The calculation engine (`server/domain/calculations/engine/CalculationEngine.ts`) has no scheduled caller yet; quotes are served from the in-process cache, not Redis. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the request flows.

---

## 2. Quantitative Research Engine

MAET includes a research and simulation toolkit aimed at the usual pitfalls of naive backtesting (look-ahead bias, overfitting, survivorship bias and zero-cost assumptions). Not all of it is wired into production backtests yet; the status of each part is stated below.

> **Wiring status.** Production backtests run `server/domain/strategy/runner-v3.ts`: the synchronous `backtestV2` tRPC router and the queued backtest, sweep and walk-forward jobs in `server/workers/`.
>
> - **Look-ahead:** with the default `NEXT_BAR_OPEN` policy, rules are evaluated on bar *i−1* and filled at bar *i*'s open. `server/domain/strategy/truncated-history.test.ts` checks that a run which never saw bars after time *T* agrees with the full-history run on every trade and equity point before *T*. `fill-bar-look-ahead.test.ts` checks that changing the fill bar's high/low/close/volume does not change anything decided at its open. Indicators are trailing and `null` during warm-up. Corporate actions and point-in-time fundamentals are not applied (B, C), so results use the candles as stored.
> - **Costs:** fees follow the strategy's `feeModel`. `backtestV2` presets use a flat 10 bps per leg (`FIXED_BPS`, `feeBps` default 10; no fee when 0). Strategy Lab definitions can select `VOLUME_AWARE`, the statutory Indian schedule in `shared/domain/costs`. Slippage is a per-leg bps debit (default 5 bps).
> - **Modules:** walk-forward analysis (E) runs in production through `server/workers/walk-forward-worker.ts`, and `strategyOptimisation.getSweep` returns the robustness analysis (F) of a finished sweep. The execution model (A), point-in-time fundamentals (C) and shared-capital portfolio engine (D) are **research modules covered by tests** (for example `server/domain/strategy/p2-research-invariants.test.ts`); production backtests do not call them.
> - **Job execution:** queued backtests, sweeps and walk-forward runs execute inside the API process (`server/plugins/strategy-jobs.ts`): one job at a time, handing control back to the API between backtests, with a per-job time budget (`STRATEGY_JOB_TIME_BUDGET_MS`, default 15 min). Set `STRATEGY_JOBS_IN_PROCESS=false` to run them in a separate `bun run worker:strategy-jobs` process instead. On Render's free plan the service sleeps when idle, so queued jobs wait until it wakes.

### A. Execution Model: Spread, Impact and Participation (`server/domain/strategy/execution-model.ts`, research module)
- **Status**: Exists as a research module used only by the portfolio engine (D). Production backtests do not use it: they charge slippage as a flat bps debit and model neither spread nor market impact.
- **Square-Root Market Impact**: Price impact scales nonlinearly with market participation:
  $$\text{impactBps} = \text{impactCoeff} \times \sqrt{\frac{\text{OrderVolume}}{\text{BarVolume}}} \times \sigma_{\text{vol}}$$
- **Bid-Ask Spread Models**: Configurable spread dynamics: `NONE`, `FIXED_BPS`, `VOLATILITY_BASED`, and `LIQUIDITY_BASED`.
- **Directional Price Shift**: BUY orders shift execution price upward; SELL orders shift price downward, appropriately penalising aggressive fills.
- **Participation Rate Capping**: Caps fills to a configurable percentage of bar volume.
- **Full Drag Accounting**: Explicitly accounts for brokerage, exchange turnover fees, STT, GST, SEBI charges, stamp duty, spread, and market impact.

### B. Corporate Actions & Price Adjustments (`server/domain/data/corporate-actions.ts`)
- **Three Data Series**: Generates `RAW`, `SPLIT_ADJUSTED`, and `TOTAL_RETURN_ADJUSTED` price series.
- **Backward-Adjusted OHLCV**: Split factors backward-applied to historical candles strictly prior to ex-date.
- **Dividend Adjustment**: In the total-return series each dividend scales earlier prices by $k = 1 - \frac{D}{P_{\text{close}}}$, using the raw close before the ex-date.
- **Invariant**: When a 2:1 split is supplied, it does not produce an artificial 50% drawdown (`p2-research-invariants.test.ts`).
- **Status**: The adjustment code exists and `runner-v3` accepts corporate actions, but no caller passes any and no corporate-action data is ingested, so production backtests use stored candles. `server/data/sources/yahoo.ts` stores Yahoo's quote OHLC arrays (not `adjclose`); the code does not establish how Yahoo adjusts them.

### C. Point-in-Time Fundamentals & Survivorship Bias Prevention (`server/domain/fundamentals/point-in-time.ts`)
- **Availability Boundary**: A statement is visible only once it is available:
  $$\text{availableFrom} \le T_{\text{simulation}}$$
- **Full Restatement Tracking**: Backtests evaluated before an accounting restatement see Revision 1; evaluations after see Revision 2.
- **Universe Membership**: Point-in-time index constituent queries (`getActiveUniverseConstituents()`) intended to keep delisted or excluded companies in their historical windows and so avoid survivorship bias once wired.
- **Status**: Not yet used by any backtest.

### D. Multi-Symbol Shared Capital Portfolio Engine (`server/domain/strategy/portfolio-engine.ts`, research module)
- **Synchronized Timeline**: Bar-by-bar multi-asset evaluation across instrument universes.
- **Shared Capital Pool**: Instruments compete for shared cash—preventing capital double-spending.
- **Deterministic Priority Ranking**: `MOMENTUM` (10-bar return), `RELATIVE_VOLUME` (currently raw signal-bar volume), `SCORECARD_SCORE` (currently volume × momentum) or `SYMBOL_ASCENDING`, all computed from the signal bar.
- **Risk Limits**: Max open positions, max position %, gross exposure caps, sector exposure limits (checked on existing positions), and minimum cash reserve.
- **Performance & Attribution Metrics**: CAGR, Sharpe, Sortino, Max Drawdown, Calmar, win rate, profit factor, cost drag, raw turnover (traded notional in INR), average gross exposure, and P&L attribution by symbol, sector, month and exit reason. It does not compute beta, alpha or tracking error. Sharpe is the mean excess periodic return divided by its standard deviation, times $\sqrt{\text{periods per year}}$ (risk-free rate configurable, default 0); Sortino uses downside deviation over all $N$ periods.
- **Status**: No endpoint or worker calls it; it runs only in tests. `rebalanceSchedule` is accepted but not implemented.

### E. Walk-Forward Analysis & Optimization (`server/domain/strategy/walk-forward.ts`)
- **Three-Phase Windowing**: Each window is split into training, validation and out-of-sample (OOS) phases. Parameters are chosen by the best training Sharpe; validation only rejects a window whose Sharpe is below −1; accepted windows are then tested OOS.
- **Leakage Isolation**: Each phase's candles are sliced to end at the phase boundary, so test candles never enter training/validation indicator caches; `assertNoDataLeakage` throws on overlapping timestamps.
- **Walk-Forward Efficiency (WFE)**: Mean OOS annualised return divided by mean in-sample annualised return over the tested windows; `null` with a reason when the in-sample mean is $\le 0$. Performance retention is the same ratio of Sharpe ratios.
- **Continuous OOS Curve**: Stitches out-of-sample equity curves across consecutive windows, compounding equity.
- **Status**: Used in production by `server/workers/walk-forward-worker.ts`, run by the in-process job runner (see wiring status above).

### F. Parameter Robustness & Overfit Detection (`server/domain/strategy/robustness.ts`)
- **2D Parameter Sensitivity Heatmap**: Identifies parameter plateaus vs overfit fragile spikes.
- **Neighbor Stability Scoring**: Penalises isolated parameter spikes where adjacent settings collapse.
- **Safeguard Flags**: `OVERFIT_RISK`, `PARAMETER_INSTABILITY`, `LOW_SAMPLE_SIZE` and `HIGH_COST_DRAG`.
- **Status**: `strategyOptimisation.getSweep` returns this analysis for a finished parameter sweep (the Strategy Lab renders it as a heatmap). Sweeps do not record costs, so `HIGH_COST_DRAG` never fires there.

---

## 3. Screener, Data Ingestion & Technical Engine

### Calculation Engine
- Registry of 70 calculators: 24 technical indicators, 23 fundamental metrics, 14 scanners and 9 portfolio metrics (`server/domain/calculations/calculators/`).
- Batch runner that processes symbols in parallel chunks of 50 (`server/domain/calculations/engine/batch-runner.ts`).
- Canonical indicator implementations live in `shared/indicators/canonical.ts`; `tests/canonical-indicators.test.ts` checks them against the strategy engine's indicator cache. Bars inside an indicator's warm-up window have `null` values, not `0`.

### Charts
- Candlestick, line and area charts on TradingView Lightweight Charts with volume, moving averages, RSI, backtest trade markers and paper position lines.
- Dividend and split markers on the stock page chart and the full chart (toolbar toggle "Dividends & splits"; hover a marker for the amount or ratio, ex-date and source), plus a table of the last 10 corporate actions on the stock page. Events come from Yahoo Finance via `GET /api/market/corporate-actions`, cached server-side for 24 h and served stale (and labelled so) when Yahoo fails. Yahoo reports NSE bonus issues as splits, so they are labelled "Split/bonus".

### Storage
- **Supabase PostgreSQL**: Operational persistence for companies, historical OHLCV candles, technical snapshots, paper trading accounts, orders, fills, ledger, and alert rules.
- **Google BigQuery (optional)**: Analytics sink of the ingestion engine; the dataset comes from `BIGQUERY_DATASET` (no default). When it is unset or fails, the Postgres write still happens.
- **Redis**: Yahoo candle cache, optional shared rate-limit buckets (`RATE_LIMIT_STORE=redis`), the daily-processor lock and paper-notification pub/sub. Quotes are cached in process memory, not in Redis.

### Paper Trading & Margin Safety
- Users place `MARKET`, `LIMIT` and `STOP_LOSS_LIMIT` orders. `MARKET` and `LIMIT` entries can carry stop-loss and take-profit prices, which become a take-profit `LIMIT` and a `STOP_LOSS_MARKET` exit (OCO) on the first fill.
- Paper MARKET orders only fill while the NSE session is OPEN, against quotes no older than `PAPER_EXECUTION_MAX_QUOTE_AGE_MS` (delayed quotes are rejected unless `PAPER_EXECUTION_ALLOW_DELAYED=true`). The starting balance is `PAPER_INITIAL_CASH_INR`.
- Fills lock the account row and run in SERIALIZABLE transactions with retry. Unique constraints on fills block double fills, idempotency keys de-duplicate retried requests, and a fill that would exceed margin (5× leverage) is refused. Short selling is allowed; margin calls liquidate positions when equity falls below maintenance margin.
- Server-Sent Events for paper updates: fill, order and account events go to a transactional outbox; `server/workers/paper-outbox-publisher.ts` claims, publishes to Redis and marks each batch in one transaction (at-least-once), and one shared Redis subscriber per process (`server/modules/paper-trading/stream-hub.ts`) fans events out to `/api/paper/stream`. Event names are a shared contract (`shared/domain/paper-trading/stream-events.ts`). When Redis is unavailable the stream answers 503, events stay `PENDING`, and the UI polls (every 3 s while orders are working, else 10 s).
- The live feed subscribes NSE symbols with an open market stream, an active alert, a working paper order or an open paper position (`server/modules/paper-trading/interest-subscriptions.ts`; refreshed on boot, every 60 s and after order/fill events, capped at 150 symbols with working orders first). BSE symbols get no live ticks, so BSE resting orders do not fill.

---

## 4. Repository Structure

MAET is organized as a clean, type-safe Bun workspace monorepo:

```text
MAET/
├── .github/workflows/
│   ├── ci.yml                    # Typecheck, lint, test wiring check, unit/integration/concurrency/advanced suites, builds
│   └── deploy-render.yml         # Verifies the Render deployment serves the pushed commit and reports healthy
├── server/                       # Backend (Nitro / H3 / tRPC), deployed to Render
│   ├── api/                      # File-based REST/SSE routes (/api/*), health.get.ts, tRPC entry, auth (trpc/auth.ts) & routers
│   ├── data/                     # Clients & adapters: Drizzle/Postgres, Redis, BigQuery, Angel One, Yahoo, NSE
│   ├── db/
│   │   ├── migrations/           # Numbered SQL migrations (0001–0026) + upgrade tests
│   │   ├── seeds/                # Reference data loads (market_baseline_metrics.sql)
│   │   └── schema.ts             # Drizzle table definitions
│   ├── domain/                   # Business logic: analysis, backtest, calculations, company, data
│   │                             # (corporate actions), fundamentals, market, portfolio, screener,
│   │                             # strategy (runner-v3, execution model, portfolio engine, walk-forward), technical
│   ├── infra/                    # Event bus, encryption, health, logger, client IP, DB diagnostics; unregistered shutdown helper
│   ├── middleware/               # CORS (FRONTEND_ORIGIN), token-bucket rate limiting, request body size limit
│   ├── modules/                  # Feature services (alerts, paper-trading, screener-dsl, strategy jobs, ...)
│   ├── plugins/                  # Nitro plugins: orchestrator, in-process strategy job runner
│   ├── routes/health/            # Admin-only /health/detailed report
│   ├── scripts/                  # Migrations, seeds, DB checks, backfills, test wiring check
│   ├── workers/                  # In-process market workers (Angel One feed, order matcher, alerts, daily processor), Strategy Lab jobs (run by the in-process job runner), ingestion engine
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
│   └── e2e/                      # Playwright critical-flow specs against a mocked backend (CI job `e2e`)
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
- Redis (Upstash or local; `UPSTASH_REDIS_URL` is required outside tests)
- Optional: Google Cloud BigQuery service account

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

# Redis (Upstash or local; required outside tests)
UPSTASH_REDIS_URL=redis://default:[password]@[endpoint]:6379

# Market Data Providers. server/config.ts requires these (and ANGELONE_MASTER_KEY,
# at least 32 chars, used to encrypt broker credentials) whenever NODE_ENV is not
# "test". If the Angel One login fails, quotes fall back to delayed Yahoo data.
ANGELONE_MASTER_KEY=at-least-32-characters-long-secret
ANGELONE_API_KEY=your-smartapi-key
ANGELONE_CLIENT_ID=your-client-id
ANGELONE_PIN=your-pin
ANGELONE_TOTP_SECRET=your-totp-secret

# Google BigQuery Analytics (Optional). When unset, warehouse writes fail and
# are logged; Postgres persistence is unaffected. There is no default dataset.
BIGQUERY_PROJECT=your-gcp-project
BIGQUERY_DATASET=your_dataset
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

Outside tests, `server/config.ts` refuses to start without `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `UPSTASH_REDIS_URL`, `ANGELONE_MASTER_KEY` and the four `ANGELONE_*` credentials; the server also needs a database URL (`SUPABASE_DB_URL` or `DATABASE_URL`). On Render, set the server variables in the dashboard (`render.yaml` lists them, including the optional BigQuery ones); on Vercel, set the `VITE_*` variables.

### 3. Running Locally
Run the backend and frontend in two terminals:

```bash
# Backend: Nitro dev server (API, tRPC, SSE; port 3000 by default)
bun run --cwd server dev

# Frontend: Vite dev server; set VITE_API_URL (e.g. http://localhost:3000) so it calls the backend
bun run --cwd src dev
```

The root `bun run dev` only loads the standalone orchestrator module; it does not start the API or the website.

### 4. Database Migrations
`server/scripts/apply-migrations.ts` never picks a database on its own. It migrates `MIGRATION_DATABASE_URL`, or `TEST_DATABASE_URL` only when `NODE_ENV=test`, and otherwise exits with an error. Each migration file and its `_applied_migrations` row commit in one transaction.

```bash
# Disposable local/CI test database
TEST_DATABASE_URL=postgresql://postgres:<password>@127.0.0.1:5432/<your_test_db> bun run test:db-migrate
```

Tests never fall back to a default database either: with `NODE_ENV=test` the server's database client requires `TEST_DATABASE_URL`.

### 5. Production Migrations
Run from a trusted machine, never from CI:

1. Check connectivity with `bun run check:db` (uses `.env`). After restoring the database, run `bun run verify:db` (`server/scripts/verify-db-restore.ts`), a read-only verifier: it checks the migration history, the schema against Drizzle, key-table row counts, paper invariants (ledger sums to cash, no fills on another user's or generation's order, no non-positive positions) and RLS on `paper_*` tables inside a read-only transaction that is always rolled back. It reads `SUPABASE_DB_URL`/`DATABASE_URL` (or `--url-env=VAR`), never `.env`; exit codes are 0 pass, 1 failure, 2 cannot connect, 3 usage error.
2. Apply pending migrations against Supabase's **direct** connection (not the transaction pooler):
   ```bash
   MIGRATION_DATABASE_URL="<supabase direct connection url>" bun run server/scripts/apply-migrations.ts
   ```

Production may not have the `_applied_migrations` tracking table if earlier migrations were applied by hand. The runner would then create it and apply **every** file in one run, and not every historical migration is safe to re-run. Before the first run, create `public._applied_migrations (name text primary key, applied_at timestamptz not null default now())` and insert the names of the files production already has, so only genuinely new files run. On Supabase the runner leaves the existing `auth` schema, `auth.uid()` and roles untouched; it only creates stand-ins where they are missing.

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

End-to-end tests need no database, broker or secret: `bun run test:e2e` builds the frontend in
production mode with `VITE_API_URL=https://api.test`, serves it with the node-server preview, and
answers every backend request from `tests/e2e/support/mock-api.ts` (shaped like the real market,
tRPC and SSE contracts). Install the browser once with `bunx playwright install chromium`. The specs
cover the screener, chart, dividend and split markers, quote freshness labels, the paper terminal (signed in and out) and
strategy creation, on one desktop and one mobile viewport.

### Production Builds
```bash
# Build frontend bundle
bun run build

# Build backend server bundle
bun run --cwd server build
```

---

## 7. Financial & Research Invariants Checked in CI

CI runs tests for these invariants on every pull request and push to `main`. Items 1–5 and 7 exercise research modules from section 2 that production backtests do not call; item 6 covers the walk-forward engine the production worker uses, and item 9 the production runner.

1. **Deterministic Execution**: Market impact strictly scales with $\sqrt{\text{participation}}$, increasing buy fill prices and decreasing sell fill prices.
2. **Corporate Action Split Invariant**: Stock splits (e.g. 2:1) adjust historical series without creating artificial drawdown anomalies.
3. **Look-Ahead Isolation**: Historical fundamentals queries strictly reject any revisions published after simulation timestamp $T$.
4. **Survivorship Bias Guard**: Index constituent membership queries accurately reflect historical reality (e.g., delisted companies exist in their historical active windows).
5. **Shared Capital Conservation**: Multiple symbols competing for one shared cash pool cannot double-spend it or exceed allocation limits.
6. **Walk-Forward Partitioning**: Test candles are excluded from the training and validation runs of each window.
7. **Robustness Overfit Detection**: Fragile parameter spikes (e.g., high Sharpe with zero neighbor support) are flagged with `OVERFIT_RISK`.
8. **RBAC & Security Boundaries**: Ingestion and administrative mutations strictly require authenticated admin claims derived from verified JWT `app_metadata`.
9. **Look-Ahead (runner-v3)**: A run truncated at time $T$ reproduces the full run's trades and equity before $T$, and fill-bar high/low/close/volume cannot influence decisions made at the open (`truncated-history.test.ts`, `fill-bar-look-ahead.test.ts`).

---

## 8. Deployment Architecture

- **Frontend (Vercel)**: Automatically deploys from `main`. Uses TanStack Start and pre-built Nitro output (`.vercel/output`).
- **Backend (Render)**: Render deploys `main` using `render.yaml`. `deploy-render.yml` runs on pushes touching `server/**`, `shared/**`, `package.json`, `bun.lock` or `render.yaml`, builds the backend and waits until `/api/health` reports the pushed commit with `status: "ok"`.
- **Health semantics**: `GET /api/health` (Render's `healthCheckPath`) always answers HTTP 200 so Render does not restart an instance because of an external outage. The body reports `status: "ok"` or `"degraded"` and per-component `checks`: `database` (live `select 1`) and `redis` (live `PING`), each with a 2 s timeout and cached for 10 s, plus `orchestrator` and `marketData` as reported by those components. `GET /health/detailed` (row counts, DLQ stats, recent ingestion runs) requires an admin JWT.
- **Database (Supabase)**: Transaction pooler configuration via port `6543` with `sslmode=require`.

---

## 9. License & Project Disclaimer

MAET is designed for market intelligence, quantitative strategy research, backtesting, and educational simulation. It does not provide real-money order routing to live brokerage exchanges and does not constitute investment or financial advice.

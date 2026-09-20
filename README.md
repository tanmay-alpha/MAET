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
        CalcEngine["179-Indicator Engine\n(0-NaN Invariant)"]
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

MAET features a professional-grade research and simulation engine built to avoid the pitfalls of naive backtesting (overfitting, look-ahead bias, survivorship bias, and zero-cost assumptions).

### A. Realistic Execution & Market Microstructure (`server/domain/strategy/execution-model.ts`)
- **Square-Root Market Impact**: Price impact scales nonlinearly with market participation:
  $$\text{impactBps} = \text{impactCoeff} \times \sqrt{\frac{\text{OrderVolume}}{\text{BarVolume}}} \times \sigma_{\text{vol}}$$
- **Bid-Ask Spread Models**: Configurable spread dynamics: `NONE`, `FIXED_BPS`, `VOLATILITY_BASED`, and `LIQUIDITY_BASED`.
- **Directional Price Shift**: BUY orders shift execution price upward; SELL orders shift price downward, appropriately penalising aggressive fills.
- **Participation Rate Capping**: Multi-bar order state machine (`NEW` $\to$ `PARTIALLY_FILLED` $\to$ `FILLED` / `EXPIRED`) capping fills to a realistic percentage of bar volume.
- **Full Drag Accounting**: Explicitly accounts for brokerage, exchange turnover fees, STT, GST, SEBI charges, stamp duty, spread, and market impact.

### B. Corporate Actions & Price Adjustments (`server/domain/data/corporate-actions.ts`)
- **Three Data Series**: Generates `RAW`, `SPLIT_ADJUSTED`, and `TOTAL_RETURN_ADJUSTED` price series.
- **Backward-Adjusted OHLCV**: Split factors backward-applied to historical candles strictly prior to ex-date.
- **Dividend Reinvestment Model**: Continuous total return compounding factor ($k = 1 - \frac{D}{P_{\text{close}}}$).
- **Mathematical Invariant**: A 2:1 stock split **never** triggers an artificial 50% drawdown in strategy simulation.

### C. Point-in-Time Fundamentals & Survivorship Bias Prevention (`server/domain/fundamentals/point-in-time.ts`)
- **Strict Availability Boundary**: Zero look-ahead bias invariant:
  $$\text{availableFrom} \le T_{\text{simulation}}$$
- **Full Restatement Tracking**: Backtests evaluated before an accounting restatement see Revision 1; evaluations after see Revision 2.
- **Survivorship-Bias-Free Universe**: Point-in-time index constituent queries (`getActiveUniverseConstituents()`), preventing backtest distortion from delisted or excluded companies.

### D. Multi-Symbol Shared Capital Portfolio Engine (`server/domain/strategy/portfolio-engine.ts`)
- **Synchronized Timeline**: Bar-by-bar multi-asset evaluation across instrument universes.
- **Shared Capital Pool**: Instruments compete for shared cash—preventing capital double-spending.
- **Deterministic Priority Ranking**: Priority resolution via `MOMENTUM`, `RELATIVE_VOLUME`, `SCORECARD_SCORE`, or `SYMBOL_ASCENDING`.
- **Institutional Risk Limits**: Max open positions, max position %, gross exposure caps, sector exposure limits, and minimum cash reserve requirements.
- **Execution Order**: Strict precedence executing `SELL` orders before `BUY` orders to release margin during rebalancing.
- **Performance & Attribution Metrics**: CAGR, Sharpe, Sortino, Max Drawdown, Calmar Ratio, Turnover, Benchmark Beta, Alpha, and Tracking Error.

### E. Walk-Forward Analysis & Optimization (`server/domain/strategy/walk-forward.ts`)
- **Three-Phase Windowing**: Parameter training $\to$ validation $\to$ out-of-sample (OOS) testing.
- **Strict Leakage Isolation**: Future test candles never enter training/validation indicator caches.
- **Walk-Forward Efficiency (WFE)**: Evaluates performance retention across in-sample vs out-of-sample periods.
- **Continuous OOS Curve**: Stitches out-of-sample equity curves across consecutive rolling windows.

### F. Parameter Robustness & Overfit Detection (`server/domain/strategy/robustness.ts`)
- **2D Parameter Sensitivity Heatmap**: Identifies parameter plateaus vs overfit fragile spikes.
- **Neighbor Stability Scoring**: Penalises isolated parameter spikes where adjacent settings collapse.
- **Institutional Safeguard Flags**: Automated triggers for `OVERFIT_RISK`, `PARAMETER_INSTABILITY`, `LOW_SAMPLE_SIZE`, and `HIGH_COST_DRAG`.

---

## 3. Screener, Data Ingestion & Technical Engine

### 179-Indicator Calculation Engine
- Deterministic calculation registry computing 179 technical indicators and fundamental valuation metrics.
- High-performance batch runner with a 50-worker pool.
- **Zero NaN Guarantee**: Verified cross-system equality (`INDICATOR_ENGINE_VERSION`) ensuring identical indicator calculations across server workers, screener DSL, chart overlays, and strategy backtest runners.

### Dual-Database Storage Architecture
- **Supabase PostgreSQL**: Operational persistence for companies, historical OHLCV candles, technical snapshots, paper trading orders, fills, margin logs, and alert rules.
- **Google BigQuery (`maet_warehouse`)**: Scalable analytical warehouse streaming structured time-series data, historical statements, and bulk screener snapshots.
- **Upstash Redis**: Sub-millisecond candle cache and active quote distribution layer.

### Paper Trading & Margin Safety
- Realistic paper execution matching Market, Limit, Stop-Loss, and Stop-Loss-Limit orders.
- Formal protection against short-selling violations, TOCTOU order-placement races, and invalid margin states.
- Server-Sent Events (SSE) streaming real-time trade fills, margin updates, and portfolio metrics.

---

## 4. Repository Structure

MAET is organized as a clean, type-safe Bun workspace monorepo:

```text
MAET/
├── .github/
│   └── workflows/
│       ├── ci.yml                # Main CI: typecheck, unit tests, integration, builds
│       └── deploy-render.yml     # Production Render deployment & health verification
├── server/                       # Backend Application (Nitro / H3 / tRPC)
│   ├── api/                      # REST endpoints & tRPC router hierarchy
│   ├── data/                     # External data adapters (Angel One, Yahoo, NSE)
│   ├── db/                       # Drizzle ORM schema, pooler, and migrations (0001–0022)
│   ├── domain/                   # Core business logic:
│   │   ├── backtest/             # Legacy & V3 backtesting adapters
│   │   ├── calculations/         # 179-indicator calculation engine & registry
│   │   ├── data/                 # Corporate actions & split/dividend adjusters
│   │   ├── fundamentals/         # Point-in-time financial statement models
│   │   ├── market/               # Quote services & candle aggregation
│   │   ├── screener/             # Company queries & screener DSL
│   │   └── strategy/             # Portfolio engine, execution model, walk-forward, robustness
│   ├── infra/                    # Encryption (AES-256-GCM), Redis cache, JWT auth
│   ├── modules/                  # Modular services (alerts, paper-trading, screener-dsl, etc.)
│   └── workers/                  # Background jobs, orchestrator, DLQ, ingestion pipelines
├── shared/                       # Shared Contracts & Domain Utilities
│   ├── domain/paper-trading/     # Canonical paper execution & margin contracts
│   ├── indicators/               # Canonical mathematical indicator implementations
│   ├── research/                 # P2 research schemas, contracts, and invariants
│   ├── screener/                 # Screener AST definitions and filter registry
│   ├── strategy/                 # Strategy AST, operators, and schemas
│   └── types/                    # Shared TypeScript domain types
├── src/                          # Frontend Application (React 19 / TanStack Start / Vite)
│   ├── components/               # UI components, data tables, charting, and analytics
│   │   ├── charting/             # Lightweight charts & candlestick rendering
│   │   ├── options/              # Greeks display, payoff graphs, strategy builder
│   │   ├── strategy/             # PortfolioAnalyticsView, WalkForwardView, RobustnessHeatmapView
│   │   └── trading/              # Depth meters, order panels, live tapes, heatmaps
│   ├── hooks/                    # Reusable React hooks for market feeds, auth, and state
│   ├── routes/                   # File-based routing (screener, backtest, terminal, etc.)
│   └── store/                    # Terminal client-side state management
├── tests/                        # E2E & Cross-System Tests
│   ├── canonical-indicators.test.ts  # Cross-system indicator equality test suite
│   └── e2e/                      # Playwright browser integration specs
├── bun.lock                      # Authoritative Bun lockfile
├── package.json                  # Workspace configuration and unified scripts
└── render.yaml                   # Infrastructure-as-Code for Render backend deployment
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

# Google BigQuery Analytics (Optional)
BIGQUERY_PROJECT=your-gcp-project
BIGQUERY_DATASET=maet_warehouse
GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json
```

### 3. Running Locally
Start both backend services and frontend development server concurrently:

```bash
bun run dev
```

The frontend will be available at `http://localhost:5173` (or configured Vite port) and the backend API at `http://localhost:3000`.

---

## 6. Verification & Test Suite

MAET maintains rigorous financial and algorithmic correctness invariants with a zero-tolerance test policy.

```bash
# Run full typecheck across frontend and backend
bun run typecheck

# Run unit tests across server domain, data, infra, shared, and frontend (435+ tests)
bun run test:unit

# Verify cross-system canonical indicator equality
bun run test:canonical-indicators

# Verify P2 Research Engine invariants (impact, corporate actions, PIT fundamentals, shared capital)
bun test server/domain/strategy/p2-research-invariants.test.ts

# Run integration tests against PostgreSQL database
bun run test:integration

# Run paper-trading concurrency stress tests
bun run test:concurrency

# Run entire verification suite
bun run test:all
```

### Production Builds
```bash
# Build frontend bundle
bun run build

# Build backend server bundle
bun run --cwd server build
```

---

## 7. Financial & Research Invariants Enforced in CI

Every pull request and push to `main` must strictly pass automated checks verifying these invariants:

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
- **Backend (Render)**: Automatically triggered on `main` updates impacting `server/**`. Uses `render.yaml` infrastructure configuration, health-checked via `/api/health`.
- **Database (Supabase)**: Transaction pooler configuration via port `6543` with `sslmode=require`.

---

## 9. License & Project Disclaimer

MAET is designed for market intelligence, quantitative strategy research, backtesting, and educational simulation. It does not provide real-money order routing to live brokerage exchanges and does not constitute investment or financial advice.

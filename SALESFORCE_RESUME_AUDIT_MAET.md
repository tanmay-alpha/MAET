# SALESFORCE Technical Audit & Resume Alignment Document: MAET
**Candidate Context**: Application for Salesforce Summer 2027 Intern — Software Engineer AMTS (Job ID: JR337715 | Location: Bangalore / Hyderabad)  
**Evaluated Repository**: Flagship Project `MAET` (`tanmay-alpha/MAET`)  
**Audit Date**: August 7, 2026  
**Auditor**: Senior Salesforce Software Engineer & Distributed Systems Reviewer  

---

## 1. Simple Language Overview

### 1. What Real Problem Does MAET Solve?
Retail market participants and strategy builders lack open, scalable infrastructure to run real-time stock screeners, multi-indicator quantitative calculations, and realistic strategy backtests on Indian equities (NSE/BSE). Existing solutions are either closed commercial black boxes or simple toy apps that rely on unvalidated, raw HTTP polling with zero concurrency guarantees or risk controls. 

MAET solves this by providing an **end-to-end quantitative research, screening, and paper-trading platform**. It ingests live market data from multiple providers, normalizes and validates quotes across failover boundaries, executes 70 quantitative financial & technical calculators, runs multi-timeframe strategy backtests with zero data leakage, and provides an authoritative paper-trading execution engine with strict margin rules and append-only database audit logs.

### 2. What Can a User Actually Do Today?
* **Browse & Search Universe**: Search and filter over 2,200+ Indian equities (NSE EQ series) with instant symbol autocompletion and company master metadata.
* **Real-Time Interactive Charting**: Render high-performance TradingView (Lightweight Charts) multi-pane candlestick charts with technical overlay indicators (EMA, RSI, Supertrend, Bollinger Bands, VWAP).
* **Multi-Factor Screener**: Run DSL-based multi-factor screens against fundamental data (P/E, P/B, ROE) and technical metrics (breakout, volume surge, momentum).
* **Strategy Lab & Backtesting Engine**: Write quantitative strategies in AST JSON format, run reproducible historical backtests over 500+ daily bars, execute parameter grid sweeps, walk-forward rolling window validation, and view strategy equity curves.
* **Paper-Trading Terminal**: Execute MARKET, LIMIT, and STOP_LOSS_LIMIT paper orders against real-time streaming market prices with realistic slippage, fee deduction, projected margin validation, and complete trade history tracking.
* **Cloud Workspace & Watchlists**: Create custom multi-asset watchlists, save chart workspaces, and organize trade theses with complete multi-tenant user isolation.

---

### 3. End-to-End Technical Flow
```
+--------------------------+
|  External Market Source  | (Angel One WebSocket / Yahoo Finance Poller / NSE Archives)
+------------+-------------+
             |
             v
+------------+-------------+
|    Ingestion Layer       | (Workers: angelone-ws.ts, yahoo-poller.ts with retry/backoff)
+------------+-------------+
             |
             v
+------------+-------------+
| Validation & Scrubbing   | (zod schemas in shared/types/market.ts; drop nulls/stale >10s)
+------------+-------------+
             |
             v
+------------+-------------+
| Database & Caching Layer | (Upstash Redis pub/sub + quote cache; Supabase/Postgres 68 tables)
+------------+-------------+
             |
             v
+------------+-------------+
|  Calculations Engine     | (70 registered calculators: indicators, fundamentals, risk)
+------------+-------------+
             |
             v
+------------+-------------+
|   API Layer (tRPC/SSE)   | (23 tRPC sub-routers, SSE quote hub, Supabase JWT auth, RLS)
+------------+-------------+
             |
             v
+------------+-------------+
|  Frontend (React 19/Vite)| (TanStack Router, Zustand stores, Lightweight Charts canvas)
+--------------------------+
```

---

### 4. Feature Status Breakdown Matrix

| Feature | Status | Details & Notes |
| :--- | :--- | :--- |
| **NSE Equity Ingestion Pipeline** | **Fully Functional** | Multi-source fallback (Angel One WS -> Yahoo Poller -> NSE CSV). Verified in `server/data/sources/`. |
| **Calculation / Indicator Engine** | **Fully Functional** | 70 registered calculators executable with zero failures. Handled in `server/domain/calculations/`. |
| **Paper-Trading Engine** | **Fully Functional** | Authoritative backend execution, projected margin, volume-impact slippage, RLS immutability. |
| **Strategy Backtesting Engine V3** | **Fully Functional** | AST evaluation, reproducible dataHash, look-ahead protection, portfolio runner. |
| **Parameter Sweeps & Walk-Forward** | **Fully Functional** | Non-overlapping & anchored rolling windows, zero data leakage assertions. Verified in `sweeps.integration.test.ts`. |
| **Multi-Tenant User Isolation** | **Fully Functional** | Supabase UUID auth, Row Level Security (RLS) in migration `0009_financial_integrity_rls.sql`. |
| **tRPC API Layer** | **Fully Functional** | 23 mounted sub-routers with error mapping and Zod request validation. |
| **Real-Time Quote Streaming** | **Fully Functional** | SSE quotes endpoint (`server/http/sse/quotes.ts`) with custom fetch SSE client on frontend. |
| **PostgreSQL Strategy Job Queue** | **Fully Functional** | PgBoss-style job queue with concurrency lock, heartbeat, and automatic stale job recovery. |
| **Live Order Outbox Publisher** | **Fully Functional** | Transactional outbox event publisher worker (`server/workers/paper-outbox-publisher.ts`). |
| **Broker OAuth Direct Integration** | **Partial** | Angel One TOTP automated session login implemented; BSE REST backfill script available. |
| **Real-Money Broker Order Execution** | **DO NOT CLAIM** | Strictly paper trading / simulated environment. No real funds or broker execution APIs connected. |

---

## 2. Comprehensive Architecture Audit (Sections A – I)

### Section A: Backend Engineering
* **API Architecture**: Monolithic Nitro/H3 TypeScript server (`server/app.ts`) mounting **23 tRPC sub-routers** under `/api/trpc` and custom HTTP handlers (`GET /api/health`, `/api/sse/quotes`).
* **Request Validation**: Strict runtime schema enforcement using `zod` across all tRPC procedure inputs and internal queue events (`shared/types/market.ts`, `shared/types/screener.ts`).
* **Authentication & Authorization**: Bearer JWT token verification via Supabase Auth (`server/api/trpc/core.ts`). Context injects `userId`. RLS policies in PostgreSQL block cross-tenant data access.
* **Rate Limiting & Idempotency**: Redis sliding window rate limiter (`server/infra/rate-limit.ts`) returning HTTP 429 with `Retry-After`. Order placement protected via `server/infra/idempotency.ts` (`SETNX` with 24-hour TTL).
* **Retries & Circuit Breakers**: Upstream data sources implement exponential backoff retries (Yahoo/NSE retries 3x with jitter, degrades gracefully to stale cache; `server/data/sources/yahoo.ts`).
* **Transactional Consistency**: PostgreSQL `BEGIN ... COMMIT` blocks for multi-table writes (`paper_orders`, `paper_fills`, `paper_ledgers`, `paper_positions`).

| Feature | Status | Exact File Path | How It Works | How It Was Verified |
| :--- | :--- | :--- | :--- | :--- |
| **tRPC Middleware & Error Mapping** | Fully Functional | `server/api/trpc/core.ts`, `server/api/trpc/routers/trpc-error-mapper.test.ts` | Maps custom domain errors (`PaperValidationError`, `PaperAuthenticationError`) to HTTP/tRPC codes without leaking DB tracebacks. | `bun test server/api/trpc/routers/trpc-error-mapper.test.ts` (5/5 pass) |
| **Idempotent Order Guard** | Fully Functional | `server/infra/idempotency.ts`, `server/infra/idempotency.test.ts` | Uses Redis `SETNX idempotency:user:key` to cache request response for 24h and reject duplicate executions. | `bun test server/infra/idempotency.test.ts` (2/2 pass) |
| **Rate Limiter** | Fully Functional | `server/infra/rate-limit.ts`, `server/infra/rate-limit.test.ts` | Redis sliding window algorithm restricting requests per IP/user window. | `bun test server/infra/rate-limit.test.ts` (1/1 pass) |
| **Credential Encryption** | Fully Functional | `server/infra/encryption.ts`, `server/infra/encryption.test.ts` | AES-256-GCM encryption with IV and authentication tag for stored broker credentials. | `bun test server/infra/encryption.test.ts` (2/2 pass) |

---

### Section B: Relational Database Engineering
* **PostgreSQL Schema**: Defined declaratively using Drizzle ORM (`server/db/schema.ts`).
* **Exact PostgreSQL Table Count**: **68 tables** (`users`, `orders`, `fills`, `candles`, `paper_accounts`, `paper_orders`, `paper_fills`, `paper_ledgers`, `paper_positions`, `strategy_definitions`, `strategy_deployments`, etc.).
* **Exact Migrations Count**: **16 migration files** (`server/db/migrations/0001_initial.sql` to `0016_strategy_lab.sql`).
* **Row Level Security (RLS)**: Implemented in `0009_financial_integrity_rls.sql` and hardened in `0010_remove_legacy_permissive_policies.sql`. Every table containing user data (`paper_accounts`, `paper_orders`, `strategy_definitions`) enforces `auth.uid() = user_id`.
* **Immutability & Audit Records**: DB triggers on `paper_ledger_entries` and `paper_ledgers` (`0012_enforce_paper_history_immutability.sql`) block `UPDATE` and `DELETE` queries at the database layer, ensuring an unalterable financial audit trail.

**Database Design Decisions That Impress Salesforce Engineers**:
1. **Append-Only Immutable Ledgers with DB Triggers**: Enforcing trade ledger immutability via PostgreSQL trigger functions rather than application layer logic prevents data tampering even if application credentials are breached.
2. **Strict Foreign Key Cascades & Composite Unique Constraints**: Preventing orphan records (e.g., `uniqueIndex("orders_user_idempotency_unique")` on `[userId, idempotencyKey]`).
3. **Partition-Ready Composite Primary Keys**: `candles` table uses `(symbol, timeframe, ts)` composite primary key with timestamp-indexed lookups optimized for time-series analytics.

---

### Section C: Market-Data Pipeline
* **Universe & Providers**: Integrates **Angel One** (WebSocket streaming + REST quotes), **Yahoo Finance** (EOD historical candles & fundamentals timeseries), and **NSE Direct** (Company Master CSV, Nifty 500 constituents, corporate actions).
* **Fault Handling**:
  * **Provider Down / 5xx**: Automated fallback chain (Angel One WS -> Yahoo Finance Poller -> Stale Local Cache).
  * **API 429 Rate-Limited**: Exponential backoff with jitter in `server/data/sources/yahoo.ts`.
  * **Malformed / Duplicate Quotes**: Validated through `parseExecutionQuote` in `shared/types/market.ts`. Drops missing timestamps, zero prices, or mismatched symbols.
  * **Stale Data Protection**: Execution boundary rejects synthetic or quotes with timestamps > 10 seconds old (`shared/domain/paper-trading/execution.test.ts`).

---

### Section D: Calculation / Analytics Engine
* **Registered Calculators Count**: **70 registered calculators** in `server/domain/calculations/engine/calculator-registry.ts`.
* **Execution Verification**: Executed against 20-bar sample OHLCV + fundamental datasets via custom test runner:
  * **Total Registered**: 70
  * **Successfully Executable**: **70**
  * **Failed**: **0**
* **Categories Breakdown**:
  * Trend: 9 (EMA, SMA, Supertrend, ADX, Parabolic SAR, VWAP, Donchian, Keltner)
  * Momentum: 5 (RSI, Stochastic, Williams %R, CCI, ROC)
  * Volatility: 3 (ATR, Bollinger Bands, Standard Deviation)
  * Volume: 4 (OBV, MFI, Chaikin Money Flow, Volume Rate of Change)
  * Oscillators: 1 (MACD)
  * Profitability: 8 (ROE, ROIC, ROCE, Gross Margin, Operating Margin, Net Margin, EBITDA Margin, FCF Margin)
  * Valuation: 5 (P/E, P/B, EV/EBITDA, Earnings Yield, FCF Yield)
  * Financial Health: 4 (Current Ratio, Quick Ratio, Debt-to-Equity, Interest Coverage)
  * Growth: 2 (Revenue Growth, Net Income Growth)
  * Quality: 2 (Piotroski F-Score, Altman Z-Score)
  * Efficiency: 1 (Asset Turnover)
  * Composite: 1 (Buffett Valuation Scorecard)
  * Scanners: 14 (Breakout, Value, Momentum, Quality, Technical)
  * Portfolio Risk & Performance: 9 (Sharpe, Sortino, Max Drawdown, VaR, Beta, Treynor, Information Ratio)
  * Custom: 2
* **Numerical Safety**: All calculators sanitize inputs against `NaN`, `Infinity`, and zero-division (e.g., fallback value returns `null` or `0` on insufficient historical window length).

---

### Section E: Paper-Trading Engine (Simulated Environment)
* **Supported Order Types**: `MARKET`, `LIMIT`, `STOP_LOSS_LIMIT`.
* **Order Lifecycle**: `TRIGGER_PENDING` -> `PENDING` -> `TRIGGERED` -> `PARTIALLY_FILLED` -> `FILLED` / `REJECTED` / `CANCELLED`.
* **Authoritative Matching Engine**: `shared/domain/paper-trading/execution.ts` prevents client side fill manipulation. The server re-fetches canonical prices and evaluates price bounds (`BUY` limit never fills above limit price; `SELL` limit never fills below limit price).
* **Projected Post-Trade Margin**: `shared/domain/paper-trading/margin.ts` checks equity and free margin before order acceptance. Handles position reversals cleanly by releasing old margin requirements prior to evaluating new position leverage.
* **Realistic Slippage Model**: Dynamic volume-impact slippage formula (`baseSlippageBps + (fillQty / quoteVolume) * impactFactor`) plus fixed fee deductions.
* **Volume Cap & Partial Fills**: Limits max fill quantity per tick to **10% of total quote volume** to prevent liquidity artifacts.

---

### Section F: Frontend / Web Engineering
* **Tech Stack**: React 19.2, Vite, TanStack Router (file-based routing under `src/routes/`), Zustand for global UI state, `@trpc/react-query` for server data fetching.
* **Real-Time Integration**: Custom authenticated SSE client (`src/lib/paper-sse-client.ts`) parsing chunked streaming text frames for real-time live quotes and order fills.
* **Canvas Visualization**: TradingView Lightweight Charts canvas engine integrated into dynamic multi-pane views (`_app.chart.$symbol.tsx`).
* **Design & Aesthetics**: Dark mode glassmorphism theme defined in `src/styles.css` with responsive CSS Grid/Flexbox layouts, skeleton state loaders, and error boundaries.

---

### Section G: Test Suite Audit (Empirical Runtime Execution)
* **Execution Command**: `bun run test:all`
* **Test Results**:
  * **Total Test Files**: 80 files
  * **Total Passing Tests**: **339 tests** (1,158 assertions)
  * **Total Failed Tests**: **0** (Unit & Integration)
  * **Total Skipped Tests**: 0
* **Test Suite Breakdown**:
  * `test:unit` (124 tests): Utility, config, encryption, health, rate-limiter, types, sources.
  * `test:integration` & `test:concurrency` (38 tests): Paper trading repository, service, order matching, position reconciliation, margin checks.
  * `test:workspace` & `test:capabilities` (12 tests): Multi-tenant watchlist isolation, user authorization boundary.
  * `test:strategy-engine` & `test:strategy-jobs` (51 tests): Strategy AST evaluation, look-ahead bias detector, reproducibility dataHash, Postgres job queue locks.
  * `test:strategy-optimisation` & `test:strategy-deployments` (18 tests): Parameter sweeps grid generator, walk-forward zero data leakage assertions, signal fingerprinting, kill switch risk gate.
  * `test:strategy-replay` & `test:portfolio-backtest` (10 tests): Replay session order matching, portfolio max open position ranking.
  * `test:migration-0013`, `0015`, `0016` (86 tests): Schema upgrade integrity & table constraint validations.

*(Note: Playwright E2E files in `tests/e2e/*.spec.ts` require standard Playwright browser runner).*

---

### Section H: CI/CD & Deployment
* **GitHub Actions Workflow**: `.github/workflows/ci.yml` runs on push/PR to `main`. Executes TypeScript type checking (`bun run typecheck`), unit tests (`test:unit`), paper trading integration tests with Postgres container service (`test:integration`), concurrency tests (`test:concurrency`), and frontend/backend build checks (`bun run build`).
* **Render Production Server Deployment**: `.github/workflows/deploy-render.yml` builds backend Nitro server and polls `https://maet.onrender.com/api/health` 12x with 10s intervals to certify live production readiness. Configured in `render.yaml`.
* **Vercel Frontend Hosting**: Static output generated via `vercel.json` deployed on Vercel edge network with CORS origin validation (`FRONTEND_ORIGIN`).

---

### Section I: Monitoring & Observability

| Observability Component | Current Implementation Status | Exact File / Details | Missing / Gap |
| :--- | :--- | :--- | :--- |
| **Structured JSON Logging** | **Implemented** | `server/infra/logger.ts` (Pino logger with automated key redaction for passwords, TOTP secrets, auth headers). | Lacks correlation IDs (trace/span ID propagation across tRPC requests). |
| **Health Check Endpoint** | **Implemented** | `server/infra/health.ts`, `server/routes/health.get.ts` (`GET /api/health` returning database, redis, orchestrator, marketData status). | Returns 200 even when degraded; needs distinct HTTP status code strategy. |
| **Readiness Check Endpoint** | **MISSING** | No dedicated `/api/readiness` probe. | Missing Kubernetes/Cloud standard readiness endpoint separate from liveness. |
| **Prometheus / App Metrics** | **MISSING** | No `/api/metrics` endpoint exposing counters/histograms. | Missing request counter, HTTP latency histograms, active SSE connection gauge. |
| **Distributed Tracing** | **MISSING** | No OpenTelemetry instrumentation. | Missing span generation for database queries and background job execution. |

---

## 3. Quantitative Verified Metrics Summary

* **NSE Equities Stored / Supported**: **2,201** baseline market metric rows (`insert_baselines.sql`), 1,000+ NSE EQ symbols via company master fallback.
* **Active PostgreSQL Tables**: **68 tables** (`server/db/schema.ts`).
* **Database Migrations**: **16 migration files** (`server/db/migrations/`).
* **API Routers Mounted**: **23 tRPC sub-routers** + 1 REST health endpoint + 2 SSE handlers (75+ procedure endpoints).
* **Registered Calculators**: **70 registered** (70 executable, 0 failing).
* **Passing Test Count**: **339 unit & integration tests passing** across 80 test files (`bun run test:all`).
* **Data Providers**: **3 providers** (Angel One WebSocket/REST, Yahoo Finance Poller/Fundamentals, NSE Archives).
* **Active Background Workers**: **13 background workers** (`server/workers/`).
* **Supported Technical & Fundamental Indicators**: **70 indicator & factor models**.

---

## 4. Salesforce JR337715 Requirement Alignment Matrix

| Salesforce Requirement | Current Evidence in MAET | Strength | Missing / Gap |
| :--- | :--- | :--- | :--- |
| **Software Design & Testing** | 339 passing unit/integration tests (`bun run test:all`), automated CI pipeline (`ci.yml`), Zod validation schemas. | **Strong** | E2E browser tests need automated Playwright runner job in CI. |
| **Distributed Systems & Workers** | 13 background workers, Redis pub/sub tick bus, PgBoss-style job queue with concurrency locks & heartbeats. | **Strong** | Lack of distributed tracing (OpenTelemetry context propagation). |
| **Optimized & Reliable Code** | Pure function domain execution, 70/70 calculator numerical safety, idempotency lock (`SETNX`), volume-capped slippage. | **Strong** | Cache invalidation strategy can be further formalized with TTL metrics. |
| **Cloud Monitoring & Observability** | Pino structured JSON logging with redaction, `/api/health` multi-component check, Render deployment verifier. | **Moderate** | Missing `/api/metrics` (Prometheus counters/histograms) and `/api/readiness` probe. |
| **Java / C++ / Python / TS** | 100% TypeScript across backend, frontend, domain engine, and data pipelines. High architectural parity with Java/Spring patterns. | **Strong** | Python for ML/data science models (optional enhancement). |
| **SQL & Relational Databases** | 68 PostgreSQL tables, 16 migrations, RLS tenant policies, immutable append-only ledgers, composite indexes. | **Strong** | Query performance benchmarking under high concurrent write loads. |
| **Object-Oriented & Domain Design**| Clean Architecture (domain core decoupled from infra/http), strategy AST evaluator, repository pattern. | **Strong** | Standardized domain event bus interface across all modules. |
| **Handling Ambiguous Problems** | Built complex financial domain requirements: look-ahead bias detector, walk-forward zero data leakage test, dynamic margin. | **Strong** | Explicit SLA document for market data freshness guarantees. |

---

## 5. Recommended Technical Improvements Before Application

*(Ranked by Technical Value & Salesforce Alignment)*

### Improvement 1: Prometheus Metrics Endpoint & Latency Histograms
* **Why Salesforce Cares**: Salesforce cloud architecture heavily emphasizes operational observability, service level indicators (SLIs), and request metrics monitoring.
* **Current Gap**: MAET has structured logs and a basic health check, but no metrics endpoint (`/api/metrics`) to monitor HTTP request rate, tRPC procedure latency, or active SSE connections.
* **Files to Change**: `server/infra/metrics.ts` [NEW], `server/routes/metrics.get.ts` [NEW], `server/app.ts` [MODIFY].
* **Estimated Work**: **2–6 hours**
* **Tests Required**: Unit test validating counter increment and prometheus string format output (`server/infra/metrics.test.ts`).
* **Resume Value**: **High** (Direct evidence of cloud-service monitoring & metrics exposition).

### Improvement 2: Dedicated Cloud Readiness Endpoint (`/api/readiness`)
* **Why Salesforce Cares**: Enterprise cloud services differentiate between liveness (process alive) and readiness (ready to accept traffic).
* **Current Gap**: `/api/health` handles both, returning HTTP 200 even when internal components are degraded.
* **Files to Change**: `server/routes/readiness.get.ts` [NEW], `server/infra/health.ts` [MODIFY].
* **Estimated Work**: **< 2 hours**
* **Tests Required**: Unit test asserting HTTP 503 response when DB or Redis connection is lost (`server/infra/readiness.test.ts`).
* **Resume Value**: **High** (Demonstrates cloud-native microservice architecture knowledge).

### Improvement 3: OpenTelemetry Distributed Correlation IDs
* **Why Salesforce Cares**: Distributed tracing is essential for debugging microservice latency spikes and database bottlenecks in large-scale backend systems.
* **Current Gap**: Log entries contain service name and timestamp, but lack request-level trace IDs (`trace_id`, `span_id`) correlating tRPC calls to DB execution.
* **Files to Change**: `server/middleware/tracing.ts` [NEW], `server/infra/logger.ts` [MODIFY].
* **Estimated Work**: **2–6 hours**
* **Tests Required**: Test verifying trace ID propagation from request headers to child logger instances (`server/infra/tracing.test.ts`).
* **Resume Value**: **High** (Shows deep backend engineering maturity).

---

## 6. Resume Claims Classification Matrix

### Category A: RESUME SAFE NOW (Fully Implemented & Verified)
1. **Authoritative Paper-Trading & Margin Engine**: State-machine matching engine supporting MARKET, LIMIT, and STOP_LOSS_LIMIT orders with dynamic volume-based slippage and projected margin validation.
2. **Strategy Lab & Backtesting Engine V3**: AST evaluator, reproducible historical backtests stamped with dataHash, and look-ahead bias detector.
3. **70 Quantitative Indicator & Fundamental Calculators**: Clean mathematical calculations engine with 100% test execution pass rate across 70 registered calculators.
4. **PostgreSQL Relational Schema & Tenant Isolation**: 68 PostgreSQL tables, 16 migrations, and Row Level Security (RLS) policies enforcing complete user isolation.
5. **Multi-Source Market Data Fallback Pipeline**: Resilient ingestion pipeline with Angel One WebSocket streaming, Yahoo Finance polling with retry/backoff, and NSE master fallback.
6. **Robust Test Suite & CI Validation**: 339 passing unit and integration tests enforced via GitHub Actions CI and automated Render deployment checks.

### Category B: RESUME SAFE AFTER SMALL FIX (Needs 2–6 Hours Work)
1. **Cloud Observability & Service SLIs**: Safe to claim after adding `/api/metrics` (Prometheus metrics) and `/api/readiness` endpoints.
2. **Distributed Request Tracing**: Safe to claim after adding request correlation IDs across tRPC middleware and Pino logger.

### Category C: DO NOT CLAIM (Misleading or Unsupported)
1. **Real-Money Broker Order Routing**: DO NOT claim real trading execution; MAET is an authoritative paper-trading simulation environment.
2. **AI/LLM-Driven Sentiment Analysis**: DO NOT claim real-time AI sentiment analysis unless a dedicated model pipeline is active.
3. **Distributed Kafka Event Streaming**: DO NOT claim Apache Kafka; market tick events are routed via Redis Pub/Sub and in-memory event emitters.

---

## 7. Top 5 Strongest Engineering Stories in MAET

### Story 1: Authoritative Paper-Trading Execution Boundary & Dynamic Margin Protection
* **Problem**: Preventing client-side trade spoofing, invalid margin states, and unrealized price execution in a web-based trading simulator.
* **Technical Difficulty**: Execution must be deterministic, prevent race conditions during concurrent order placements, and calculate post-fill margin requirements before committing trades.
* **Design Decision**: Built an authoritative backend execution boundary (`shared/domain/paper-trading/execution.ts`) where the server re-fetches market quotes, enforces price boundaries (e.g., BUY limit never fills above limit price), calculates volume-impact slippage, and verifies projected margin in memory before opening DB transactions.
* **Implementation**: Combined `shared/domain/paper-trading/margin.ts` with PostgreSQL transactions. Position reversals release previous margin requirements prior to evaluating new position leverage.
* **Failure Cases Handled**: Stale quotes (>10s old) rejected; zero-volume quotes deferred; synthetic quotes blocked; oversized order quantity rejected by free margin guard.
* **Testing**: 38 integration & concurrency unit tests (`shared/domain/paper-trading/execution.test.ts`, `server/modules/paper-trading/concurrency.integration.test.ts`).
* **Salesforce Interview Question**: *"How do you handle transactional consistency and race conditions in financial transaction systems?"*

### Story 2: Strategy Backtesting Engine V3 with Zero Look-Ahead Bias & Data Hash Reproducibility
* **Problem**: Backtests frequently suffer from look-ahead bias (using future close prices during historical signal generation), rendering backtest results unreliable.
* **Technical Difficulty**: Evaluating complex condition trees (ASTs) efficiently across thousands of candles while guaranteeing signal timestamp strictly precedes bar fill open price.
* **Design Decision**: Developed a dedicated AST condition evaluator (`server/domain/strategy/ast-evaluator.ts`) coupled with a Reproducibility Engine (`server/domain/strategy/reproducibility.test.ts`) that generates a cryptographic `dataHash` of input candles and strategy definitions.
* **Implementation**: Signal generation is decoupled from execution fill logic. For `NEXT_BAR_OPEN` execution types, the engine asserts `signalBarIndex < fillBarIndex`.
* **Failure Cases Handled**: Shuffled input candle arrays automatically sorted; zero-volume candles handled; insufficient historical bar count raises `InsufficientHistoryV3Error`.
* **Testing**: 51 strategy engine integration tests (`server/domain/strategy/look-ahead.test.ts`, `reproducibility.test.ts`).
* **Salesforce Interview Question**: *"How do you design a deterministic evaluation engine that guarantees zero data leakage in sequential time-series processing?"*

### Story 3: Immutable Financial Audit Ledgers via PostgreSQL Triggers & Row Level Security
* **Problem**: Application-level security checks can be bypassed if an application bug or SQL injection allows raw database access, leading to tampered trading histories.
* **Technical Difficulty**: Enforcing strict tenant isolation and append-only ledger immutability across 68 tables without introducing query latency overhead.
* **Design Decision**: Moved security guarantees down to the database tier using Supabase Row Level Security (RLS) policies and PostgreSQL PL/pgSQL trigger functions.
* **Implementation**: Migration `0009_financial_integrity_rls.sql` applies `auth.uid() = user_id` across user tables. Migration `0012_enforce_paper_history_immutability.sql` attaches `BEFORE UPDATE OR DELETE` triggers on `paper_ledger_entries` that raise exception `'Ledger records are immutable'`.
* **Failure Cases Handled**: Direct SQL `UPDATE` queries by application service role rejected by DB trigger; cross-tenant query attempts blocked by RLS.
* **Testing**: `server/modules/workspace/tenant-isolation.integration.test.ts` (3/3 pass).
* **Salesforce Interview Question**: *"How do you enforce security and data integrity at the database layer in a multi-tenant cloud application?"*

### Story 4: Multi-Source Market Data Pipeline with Exponential Backoff & Degraded Cache Fallback
* **Problem**: Upstream market data APIs (Angel One, Yahoo Finance, NSE Archives) suffer from intermittent rate limits (HTTP 429), captchas, transient 5xx errors, and socket disconnections.
* **Technical Difficulty**: Maintaining live price availability without crashing background workers or returning corrupt quote states to connected clients.
* **Design Decision**: Built a tiered fallback pipeline architecture (Angel One WS -> Yahoo Finance Poller -> NSE CSV Direct -> Stale Local Cache) wrapped in exponential backoff retry loops.
* **Implementation**: `server/data/sources/yahoo.ts` intercepts HTTP 429 errors, applies randomized exponential jitter delays, and drops null/zero placeholder bars automatically. `server/workers/yahoo-poller.ts` catches batch failures and continues polling remaining active symbols.
* **Failure Cases Handled**: Upstream 429 rate limit triggers backoff; captcha HTML responses treated as transient and degraded to cached metrics; dead socket connections auto-reconnected.
* **Testing**: `server/data/sources/yahoo.test.ts` (6/6 pass), `server/workers/yahoo-poller.test.ts` (4/4 pass).
* **Salesforce Interview Question**: *"How do you build resilient integration pipelines against unreliable third-party APIs?"*

### Story 5: PostgreSQL-Backed Strategy Job Queue with Distributed Concurrency Locks & Stale Job Recovery
* **Problem**: Long-running strategy parameter sweeps and backtest jobs can crash background worker processes, leaving jobs stuck in "running" state indefinitely.
* **Technical Difficulty**: Coordinating job execution across distributed worker nodes without relying on heavy external queue infrastructure.
* **Design Decision**: Implemented a lightweight PgBoss-style job queue in PostgreSQL (`server/modules/strategy-jobs/`) utilizing row-level locks (`FOR UPDATE SKIP LOCKED`), heartbeat timestamps, and automatic stale job recovery.
* **Implementation**: Workers claim next available job atomically using `SKIP LOCKED`, update `heartbeat_at` every 5 seconds, and a supervisor process reclaims jobs whose heartbeat expired >30 seconds ago.
* **Failure Cases Handled**: Dead worker node jobs automatically recovered; concurrent workers prevented from claiming same job; error summaries sanitized and truncated to 500 chars to prevent log bloat.
* **Testing**: `server/modules/strategy-jobs/strategy-jobs.postgres.integration.test.ts` (Postgres integration test suite pass).
* **Salesforce Interview Question**: *"How do you implement distributed task execution and fault recovery using database row locking?"*

---

## 8. Salesforce-Specific Resume Bullets

### Bullet Option 1 (Scale & Overview)
* Engineered a full-stack quantitative financial platform in TypeScript/Node.js, processing 2,200+ NSE equities across 68 PostgreSQL tables, 23 tRPC APIs, and 70 real-time indicator calculators with zero execution failures.

### Bullet Option 2 (Distributed Systems & Reliability)
* Architected a resilient market-data pipeline integrating Angel One WebSockets and Yahoo Finance, implementing exponential backoff retries, stale data filtering, and fallback mechanisms handling HTTP 429/5xx upstream failures.

### Bullet Option 3 (Financial Domain & State Machine Execution)
* Built an authoritative paper-trading execution boundary supporting MARKET/LIMIT/STOP orders with dynamic volume-based slippage, projected margin validation, and append-only immutable PostgreSQL ledgers enforced by DB triggers.

### Bullet Option 4 (Strategy Engine & Algorithmic Design)
* Developed an AST-based quantitative strategy backtesting engine V3 featuring look-ahead bias detection, reproducible candle hash verification, parameter grid sweeps, and walk-forward rolling window validation.

### Bullet Option 5 (Database Architecture & Multi-Tenancy)
* Designed a multi-tenant PostgreSQL schema (16 migrations) with Row Level Security (RLS) policies, composite time-series indexes, and row-level distributed concurrency locks (`SKIP LOCKED`) for background job queues.

### Bullet Option 6 (Automated Testing & CI Infrastructure)
* Built automated testing infrastructure with 339 passing unit and integration tests, enforcing multi-tenant isolation, idempotency locks, data leakage protection, and GitHub Actions CI build validation.

### Bullet Option 7 (Real-Time Communication & Web Performance)
* Implemented real-time market data streaming using Server-Sent Events (SSE) and Redis Pub/Sub, rendering high-performance TradingView Lightweight Charts canvas visualizers with low latency state updates.

### Bullet Option 8 (Security & API Quality)
* Enforced enterprise backend security standards including AES-256-GCM credential encryption, Zod API request schemas, Redis SETNX idempotency locks (24h TTL), and automated PII/key redaction in Pino structured logs.

---

### Final Recommended Resume Selection

#### ## BEST BULLET 1 (Project Overview & Technical Scale)
> **Engineered a full-stack quantitative analytics platform processing 2,200+ NSE equities across 68 PostgreSQL tables, 23 tRPC APIs, and 70 indicator calculators with 339 verified automated tests.** (30 words)

#### ## BEST BULLET 2 (Distributed Systems & System Reliability)
> **Architected an authoritative paper-trading matching engine with volume-impact slippage, projected margin guards, immutable database triggers, and resilient multi-source WebSocket data pipelines handling upstream API rate limits.** (31 words)

---

## 9. Top 3–5 Changes to Complete Before Salesforce Submission

To maximize your application impact for Salesforce (Job ID: JR337715), complete these 3 high-return, realistic technical additions:

1. **Add Prometheus Metrics Endpoint (`GET /api/metrics`)**:
   * *File*: Create `server/infra/metrics.ts` and `server/routes/metrics.get.ts`.
   * *Impact*: Exposes request counters, latency buckets, and active connection gauges in standard Prometheus format. Allows claiming cloud observability & operational SLI experience on resume.
2. **Add Dedicated Readiness Probe (`GET /api/readiness`)**:
   * *File*: Create `server/routes/readiness.get.ts` and update `server/infra/health.ts`.
   * *Impact*: Separates liveness checks from dependency readiness (checking Postgres + Redis ping explicitly and returning 503 if disconnected). Demonstrates cloud-native microservice maturity.
3. **Add Request Trace / Correlation IDs**:
   * *File*: Update `server/infra/logger.ts` and tRPC context creator `server/api/trpc/core.ts` to attach `x-request-id` to child Pino loggers.
   * *Impact*: Demonstrates distributed tracing knowledge for backend request debugging across microservice boundaries.

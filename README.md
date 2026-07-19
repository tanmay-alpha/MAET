# MAET — Market Analytics & Execution Terminal

> [!NOTE]
> **MAET is a scanner-first Indian market intelligence terminal.**  
> It is built to help users shortlist NSE stocks using company data, market data, filters, charts, indicators, and a database-backed screening pipeline.

Live frontend: https://maet-pi.vercel.app/  
Backend target: Render service  
Database: Supabase PostgreSQL  
Main focus: **Stock Screener / Scanner**

Detailed system design, pull timing, database model and operations:
[`docs/PROJECT-ARCHITECTURE.md`](docs/PROJECT-ARCHITECTURE.md). Active gaps are
tracked in [`docs/REMAINING-WORK.md`](docs/REMAINING-WORK.md).

---

## 1. Founder Line

MAET is not a real-money trading platform.  
It is a **demo-ready screener-first market terminal** for Indian stocks.

The goal is simple:

> [!TIP]
> Pull market and company data automatically, store it in our own database, calculate useful ratios and indicators, validate bad or missing values, and show clean scanner results to users.

---

## 2. What Problem MAET Solves

Checking hundreds of companies manually does not scale.

A proper screener needs:

- a full company universe
- price and volume data
- historical candles
- financial data
- ratio calculations
- technical indicators
- filters
- validation before showing data
- database-backed results

MAET is designed around this idea:

```text
Do not fetch everything live for every scanner request.
Pull data on schedule → store it → validate it → calculate metrics → show scanner results.
```

---

## 3. Current Demo Summary

The current project demonstrates the foundation of a real screener.

### Working now

- NSE company universe support
- Company search and pagination
- Angel One live quote integration
- Yahoo Finance fallback for quotes/candles
- Screener UI with stock table
- Price, change %, and volume based filtering
- Chart page with candlestick chart
- Moving average and RSI indicator wiring
- TradingView-style external chart link support
- Supabase database schema and migrations
- Render backend deployment setup
- Vercel frontend deployment setup
- Honest unavailable-data UI for missing fundamentals
- Persisted light, dark, and system appearance modes
- Functional notification and settings header controls
- Completed Nifty 500 fundamentals enrichment pass

### Current boundaries

- Yahoo availability varies by company and field; unavailable values stay blank.
- Options and futures remain unavailable until a verified derivatives provider is connected.
- Saved screeners use browser storage for unauthenticated visitors.
- Audit/anomaly tables exist, but the review dashboard is not exposed in the UI.

---

## 4. Live Data Pipeline

```mermaid
flowchart LR
    A[NSE Company Master] --> B[Backend Data Sources]
    C[Angel One SmartAPI] --> B
    D[Yahoo Finance] --> B

    B --> E[Workers / Ingestion Jobs]
    E --> F[Validation Layer]
    F --> G[Supabase PostgreSQL]

    G --> H[Ratio & Indicator Engine]
    H --> I[Backend API / tRPC / REST / SSE]
    I --> J[MAET Frontend Scanner UI]

    J --> K[User Filters]
    J --> L[Charts]
    J --> M[TradingView Link]
```

### Simple explanation

1. **NSE** gives the company universe.
2. **Angel One** gives live quote/token data.
3. **Yahoo Finance** gives fallback quotes and historical candles.
4. Backend workers collect and normalize data.
5. Supabase stores the structured data.
6. Ratio and indicator engines calculate useful metrics.
7. APIs send clean data to the frontend.
8. The scanner UI shows searchable and filterable stock results.

---

## 5. System Architecture

```mermaid
flowchart TB
    subgraph Frontend[Vercel Frontend]
        UI[Scanner UI]
        Chart[Chart Page]
        Filters[Filter Builder]
        TV[TradingView External Link]
    end

    subgraph Backend[Render Backend]
        API[API Routes]
        TRPC[tRPC Routers]
        SSE[SSE Quote Stream]
        Orchestrator[Orchestrator]
        Workers[Market Workers]
    end

    subgraph DataSources[External Data Sources]
        Angel[Angel One SmartAPI]
        Yahoo[Yahoo Finance]
        NSE[NSE Company Master]
    end

    subgraph Storage[Storage Layer]
        Redis[Redis / Upstash Cache]
        DB[Supabase PostgreSQL]
    end

    DataSources --> Workers
    Workers --> Redis
    Workers --> DB
    DB --> API
    Redis --> API
    API --> UI
    SSE --> UI
    UI --> Chart
    UI --> Filters
    UI --> TV
```

---

## 6. Data Sources Used

| Source | Used For | Why It Is Needed | Status |
|---|---|---|---|
| NSE company master | Company universe, symbols, ISIN, listed companies | Gives official Indian company list | Implemented |
| Angel One SmartAPI | Live quotes, tokens, snapshots | Useful for live market feed | Implemented |
| Yahoo Finance | Delayed quotes, historical candles, fallback data | Helps when live data is unavailable | Implemented |
| Supabase PostgreSQL | Own database | Stores scanner/company/market data | Production connection verified |
| Redis / Upstash | Cache and real-time support | Reduces repeated API calls and supports fast backend flow | Production health check reachable |
| TradingView link | External chart open | Lets user open selected stock chart externally | Added |

> [!IMPORTANT]
> **Important rule:** Angel One is useful for live market data, but it should not be treated as the main financial fundamentals source.

For production fundamentals, MAET should use:

- NSE/BSE filings
- company reports
- verified public datasets
- licensed fundamentals vendor

---

## 7. Database Design

MAET uses Supabase PostgreSQL as its own database.

The database is needed because for 500+ companies, the scanner should not call Yahoo, NSE, or Angel One live for every request.

### Current tables

| Table | Purpose |
|---|---|
| `users` | User identity/profile support |
| `brokers` | Broker connection records |
| `orders` | Paper/demo order records |
| `fills` | Paper/demo fill records |
| `candles` | Historical OHLCV candle data |
| `watchlist` | User watchlist data |
| `alerts` | Alert rules |
| `screener_runs` | Screener execution history |
| `backtest_runs` | Backtest execution history |
| `companies` | Company master data |
| `company_identifiers` | NSE symbol, ISIN, and Yahoo-symbol crosswalk |
| `quote_snapshots` | Source-tagged quote history |
| `financial_statements` | Raw financial statement data |
| `fundamentals` | Calculated or stored fundamental metrics |
| `market_cap_classifications` | Versioned Indian market-cap rank buckets |
| `idempotency` | Prevents duplicate backend operations |

### Target production database design

```mermaid
erDiagram
    companies ||--o{ candles : has
    companies ||--o{ financial_statements : reports
    companies ||--o{ fundamentals : calculates
    users ||--o{ watchlist : owns
    users ||--o{ alerts : creates
    users ||--o{ screener_runs : runs
    users ||--o{ orders : places
    orders ||--o{ fills : receives
```

---

## 8. Screener Flow

```mermaid
sequenceDiagram
    participant User
    participant UI as Scanner UI
    participant API as Backend API
    participant DB as Supabase DB
    participant Cache as Redis Cache
    participant Source as Yahoo / Angel / NSE

    User->>UI: Open screener
    UI->>API: Request companies and quotes
    API->>DB: Check stored company/fundamental data
    API->>Cache: Check cached quote/candle data
    API->>Source: Fetch fallback data if needed
    Source-->>API: Return market data
    API-->>UI: Return normalized scanner rows
    User->>UI: Apply filters/search
    UI->>API: Request filtered data
    API-->>UI: Return results
```

---

## 9. What the User Can See in the Demo

The current UI is built like a market terminal with scanner focus.

### Scanner page

The scanner shows:

- symbol
- company name
- price
- change %
- volume
- ISIN
- market/fundamental columns where available
- unavailable data as `—`

### Search

The scanner is intended to support searching by:

- stock symbol
- company name
- ISIN where available

Example searches:

```text
RELIANCE
HDFCBANK
TCS
INFY
20MICRONS
Reliance Industries
```

### Filters

Working filter categories when their verified fields are available:

- price
- change %
- volume
- market cap
- P/E
- P/B
- ROE
- ROCE
- dividend yield
- EPS growth
- revenue growth
- sector
- industry
- RSI
- moving average signals

Unavailable source fields render as `—`; their controls remain disabled rather
than applying a misleading filter.

### Charts

The chart page supports candlestick visualization and indicator toggles.

Current chart ranges:

```text
1D
5D
1M
6M
1Y
3Y
5Y
All
```

### External TradingView link

Each stock can open a TradingView chart using NSE symbol format, for example:

```text
https://www.tradingview.com/chart/?symbol=NSE:RELIANCE
```

---

## 10. Calculation Engine

The calculation engine should calculate values from stored data, not from random placeholders.

### Formula examples

| Metric | Formula |
|---|---|
| P/E | Market Price / EPS |
| P/B | Market Price / Book Value Per Share |
| ROE | Net Profit / Shareholder Equity |
| ROCE | EBIT / Capital Employed |
| Net Profit Margin | Net Profit / Revenue |
| Debt to Equity | Total Debt / Equity |
| Dividend Yield | Dividend Per Share / Market Price |
| Sales Growth | Current Sales vs Previous Sales |
| RSI | Calculated from historical closing prices |

### Safe calculation rule

```text
If input is missing → return blank
If denominator is zero → return blank
If EPS is negative → P/E is not meaningful
If data is stale → mark it stale
If source mismatch exists → flag before display
```

MAET should never show fake ratio values as real data.

---

## 11. Validation and Anomaly Rules

The scanner should protect users from bad data.

Examples:

| Situation | Output |
|---|---|
| Missing price | Keep ratio blank |
| Missing EPS | P/E unavailable |
| Zero denominator | Do not calculate |
| Negative EPS | Mark P/E as not meaningful |
| Old financial statement | Mark as stale |
| Wrong sector mapping | Block peer comparison |
| Source mismatch | Flag for review |
| API failure | Show fallback or unavailable state |

---

## 12. What Has Been Added in This Version

This version focused on making MAET a production-grade, highly secure scanner terminal with robust ingestion, computation, and analytical capabilities.

### Pipelines & Computation

- **Multi-Source Ingestion Engine**: Built a pipeline with Zod validation, retry limits, a Dead Letter Queue (DLQ), and parallel writers for Supabase and BigQuery.
- **179-Indicator Calculation Engine**: Designed a deterministic calculator registry and batch runner (50-worker pool) to calculate 179 technical variables and fundamental metrics with 0 NaN values.
- **Daily Ingestion Orchestrator**: Added a centralized orchestrator to trigger daily ingestion and incremental recalculation runs automatically.

### Data Layer & Storage

- **BigQuery Analytics Warehouse**: Integrated a Google BigQuery client connector to stream and query analytical datasets (`maet_warehouse`).
- **Paper Trading Schema Extensions**: Added `paper_ledgers`, `paper_margin_logs`, and `paper_portfolio_snapshots` schemas and DB migrations to support margin logging and historical portfolio snapshotting.
- **Redis JSON Cache**: Implemented JSON cache helpers for Yahoo candle caching, and improved range fallback mechanisms.
- **Company APIs**: APIs expose DB-first filters, source metadata, stored statements, and candle history.

### Security & Quality Audit (32 Critical Fixes)

- **Encrypted Broker Credentials**: Added AES-256-GCM encryption for stored broker credentials.
- **SSRF Protection**: Added strict alphanumeric stock symbol regex checks and interval range whitelists before making outbound market requests.
- **SQL Injection & BigQuery Safety**: Restricted client queries via `queryBigQuery` to read-only `SELECT` statements with a DML/DDL keyword blacklist and a 120-second execution timeout.
- **Short-Sell Validation**: Blocked order placement for `SELL` orders if user holds insufficient shares in their paper portfolio.
- **TOCTOU Race Fixes**: Prevented double-placement and state inconsistency in order matchmaking.
- **Admin RBAC**: Enforced role-based access control on ingestion routes and company data mutations.
- **SSE Stream Memory Leak Fixes**: Wired keep-alive pings, client disconnect listeners, and proper setTimeout cleanup.
- **Input NaN Guards**: Added validation against NaN inputs in portfolio, trade, and scanner components.

### UI & UX Improvements

- **Screener & Search**: Honest unavailable-data handling (shows `—` instead of fake/zero values), sector/industry mapping, and versioned rank-based Indian market-cap buckets.
- **Persisted Appearance & Controls**: Saved view preferences, persistent appearance modes, and settings panels.
- **Charts**: Moving average, MACD, and RSI sub-panel toggles wired directly to candles with parent-component prop syncing.

---

## 13. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | TanStack Start, Vite, React, TypeScript |
| Styling | Tailwind CSS, shadcn/ui style components |
| Backend | Nitro / H3, Node.js, Bun |
| API | REST routes, tRPC, SSE |
| Database | Supabase PostgreSQL, Google BigQuery (Analytics) |
| ORM | Drizzle ORM |
| Cache | Redis / Upstash |
| Market data | Angel One SmartAPI, Yahoo Finance, NSE |
| Deployment | Vercel frontend, Render backend |
| Testing | Bun test |

---

## 14. Environment Variables

Never commit real values.

### Backend variables for Render

```env
NODE_ENV=production
PORT=10000

SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_DB_URL=

UPSTASH_REDIS_URL=

ANGELONE_API_KEY=
ANGELONE_CLIENT_ID=
ANGELONE_MASTER_KEY=
ANGELONE_PIN=
ANGELONE_TOTP_SECRET=

NSE_HOLIDAYS_JSON=

# BigQuery Analytics Config
BIGQUERY_PROJECT=
BIGQUERY_DATASET=
# Optional: Path to service account key JSON file
GOOGLE_APPLICATION_CREDENTIALS=
```

### Frontend variables for Vercel

```env
VITE_API_URL=https://stock-market-backend.onrender.com
```

Do not put backend secrets in Vercel frontend environment.

Keep these only in Render:

```text
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_DB_URL
ANGELONE_PIN
ANGELONE_TOTP_SECRET
ANGELONE_MASTER_KEY
UPSTASH_REDIS_URL
BIGQUERY_PROJECT
BIGQUERY_DATASET
GOOGLE_APPLICATION_CREDENTIALS
```

---

## 15. Local Setup

### Install dependencies

```bash
bun install
```

### Build backend

```bash
cd server
bun run build
cd ..
```

### Build frontend

```bash
cd src
bun install
bun run build
cd ..
```

### Run tests

```bash
bun test
```

Expected current result:

```text
99 pass
9 skip
0 fail
```

Some integration tests may be skipped when Redis or external services are not available locally.

---

## 16. Deployment Setup

### Vercel frontend

Recommended settings when Vercel root directory is `src`:

```text
Root Directory: src
Framework Preset: Other
Install Command: bun install
Build Command: bun run build
Output Directory: .vercel/output
```

### Render backend

Render runs the backend from the `server` folder.

Expected start path:

```bash
node .output/server/index.mjs
```

Render must have backend environment variables, especially:

```env
SUPABASE_DB_URL=
UPSTASH_REDIS_URL=
ANGELONE_API_KEY=
ANGELONE_CLIENT_ID=
ANGELONE_MASTER_KEY=
ANGELONE_PIN=
ANGELONE_TOTP_SECRET=
```

`SUPABASE_DB_URL` must be a PostgreSQL pooler connection URI, normally port
`6543` with `sslmode=require`. URL-encode special characters in the database
password. For the shared transaction pooler, the username is normally
`postgres.<project-ref>` and the host is an `aws-<region>.pooler.supabase.com`
address copied from Supabase's Connect dialog. Supabase REST API keys are not
database connection strings.

Run the bounded five-symbol ingestion check only after the database URL is
available in the current shell:

```bash
bun run smoke:screener-v4
```

---

## 17. Demo Script

Use this to explain the project:

> MAET is a scanner-first Indian market intelligence terminal. The goal is to make stock screening scalable for 500+ companies. Instead of manually checking each company, the system pulls market data, stores structured data in our database, calculates useful indicators and ratios, and shows clean scanner results in the UI.

> In this demo, the foundation is working: company universe, scanner UI, symbol/name/ISIN search, quote data, server-side filters for stored fields, chart view, moving average and RSI toggles, PostgreSQL schema, backend APIs, and deployment setup.

> Missing fundamentals remain blank instead of fake values. Migrations `0001`
> through `0004` are applied to the verified local Supabase project, but
> Render's separate transaction-pooler credential must still report
> `database: reachable` before production persistence is considered healthy.
> Yahoo values are shown only after a real normalized snapshot is stored.

---

## 18. Current Status

```mermaid
flowchart LR
    A[Done] --> A1[NSE company universe]
    A --> A2[Quote data foundation]
    A --> A3[Scanner table]
    A --> A4[Search and pagination]
    A --> A5[Price/change/volume filters]
    A --> A6[Supabase schema]
    A --> A7[Chart indicators]
    A --> A8[Daily Ingestion Engine]
    A --> A9[179-Indicator Calculation Engine]
    A --> A10[BigQuery Analytics Warehouse]
    A --> A11[Extended Paper Trading & Short-Sell Checks]

    B[In Progress] --> B1[Saved screeners in DB]
    B --> B2[Peer comparison]
    B --> B3[Fundamentals sync]

    C[Next Phase] --> C1[Production database population]
    C --> C2[Full fundamentals provider]
    C --> C3[Anomaly dashboard]
```

---

## 19. Next Phase Roadmap

### Phase 1 — Demo stability

- Vercel deployment stable
- Render backend healthy
- Screener loads fast
- Search works
- Chart opens
- Indicators toggle correctly

### Phase 2 — Production scanner dataset

- Persist the existing 2,000+ NSE company universe
- Store daily OHLCV
- Store sector and industry
- Store market cap
- Store basic fundamentals

### Phase 3 — Fundamental screener

- P/E filter
- P/B filter
- ROE filter
- ROCE filter
- dividend yield filter
- revenue growth filter
- EPS growth filter
- sector filter

### Phase 4 — Validation and anomaly layer

- stale data flags
- missing data flags
- source mismatch flags
- impossible value checks
- audit trail per field

### Phase 5 — Product features

- saved screeners in database
- watchlist integration
- peer comparison
- company scorecard
- export results
- alerts based on screener rules

---

## 20. Honest Limitations

> [!WARNING]
> This project is currently a demo/MVP foundation.
>
> **It should not be presented as:**
> - a full production trading platform
> - a live order execution system
> - a complete fundamentals screener
> - a fully populated financial database
> - a replacement for licensed market data
>
> **It should be presented as:**
> - a scanner-first market terminal prototype
> - a working architecture demo
> - a foundation for database-backed stock screening
> - a base for 500+ company data ingestion
> - a clean starting point for fundamental and technical screening

---

## 21. One-Line Summary

MAET proves the foundation of a scalable Indian stock screener:

```text
Data Sources → Backend Workers → Validation → Supabase DB → Calculation Engine → API → Scanner UI
```

The current demo shows the scanner workflow.  
The next work is enriching the data layer and enabling verified fundamental filters.

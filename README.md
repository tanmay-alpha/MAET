# 🚀 MAET — Real-Time Indian Stock Market Scanner & Trading Platform

**MAET** is a professional-grade real-time scanning, charting, and paper-trading platform optimized for the Indian stock market (NSE/BSE). Powered by **Angel One SmartAPI**, **Yahoo Finance**, and a high-performance **Nitro backend**, it provides traders with the tools to screen, backtest, and simulate strategies in real time.

---

## 🛠️ Tech Stack & Workspace Architecture

MAET is designed as a modular monorepo using Bun Workspaces:

```
MAET/
├── src/                  # FRONTEND: TanStack Start (Vite + React + Tailwind + Zustand)
├── server/               # BACKEND: Nitro (h3 web server + Drizzle ORM + tRPC)
├── shared/               # SHARED: Unified TypeScript types and symbol lists
└── render.yaml / vercel.json # IaC deployment files
```

- **Frontend (Vercel):** Single-page TanStack Start app with persistent charts, indicator toolbars, and responsive UI.
- **Backend (Render):** Nitro-powered h3 server providing real-time quotes, indicators (SMA, RSI), and tRPC query/mutation routing.
- **Database:** PostgreSQL (Supabase) via **Drizzle ORM**.
- **Caching & Queue:** Redis (Upstash) for API rate-limiting and session synchronization.

---

## ⚡ The MAET Screener & Scanner Engine

The core differentiator of MAET is its dynamic rule-based screening engine (`server/domain/screener/engine.ts`). It supports nested compound logical operations (`AND`, `OR`) over real-time parameters:

### Supported Parameters
- **Fundamentals:** P/E Ratio, P/B Ratio, ROE (Return on Equity), Dividend Yield, Market Capitalization, and Sector.
- **Technical Indicators:** Relative Strength Index (RSI), Simple Moving Average (SMA), Exponential Moving Average (EMA).

```typescript
// Example Scanner Evaluation Rule
{
  op: "AND",
  children: [
    { field: "pe", op: "lt", value: 25 },
    { field: "rsi", op: "between", value: [30, 70], period: 14 }
  ]
}
```

---

## 🚦 Deployment & Local Setup

### Prerequisite Environment Variables
Ensure you copy `.env.example` to `.env` and set:
```bash
# Supabase DB Connection
SUPABASE_DB_URL=postgresql://...

# SmartAPI Credentials
ANGELONE_API_KEY=...
ANGELONE_CLIENT_ID=...
ANGELONE_PIN=...
ANGELONE_TOTP_SECRET=...

# Redis
UPSTASH_REDIS_URL=redis://...
```

### Local Development
1. Install root dependencies:
   ```bash
   bun install
   ```
2. Start the Nitro backend:
   ```bash
   cd server && bun run dev
   ```
3. Start the TanStack Start frontend:
   ```bash
   cd src && bun run dev
   ```

---

## 🌍 CI/CD Deployments

### Vercel Deployment
The frontend automatically builds on Vercel using the root workspace hoisting configuration:
- **Build Command:** `npm run build`
- **Install Command:** `npm install`
- **Output Directory:** `src/.vercel/output`

### Render Deployment
The backend deploys automatically on Render using `render.yaml`:
- **Build Command:** `cd .. && bun install && cd server && bun run build`
- **Start Command:** `npm run start` (inside `server/`)

# MAET - Indian Market Scanner and Trading Platform

MAET is a TanStack Start frontend with a Nitro backend for NSE/BSE market
monitoring, scanning, charting, backtesting, alerts, and paper trading.

## Data Sources

- Angel One SmartAPI WebSocket 2.0 supplies live NSE quotes when broker
  authentication succeeds.
- Yahoo Finance supplies delayed quotes and historical candles and remains the
  fallback when the broker stream is unavailable.
- The UI identifies Yahoo data as delayed. It does not label fabricated values
  as live data.
- Fundamental scanner fields are intentionally unavailable until a reliable
  licensed provider is connected. The previous mock values were removed.

## Workspace

```text
src/       TanStack Start, React, Vite, Tailwind
server/    Nitro, h3, tRPC, Drizzle, market workers
shared/    Shared schemas and NSE symbol catalog
```

## Required Environment

Create a local `.env` from `.env.example`. Render needs the same backend keys:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_DB_URL
UPSTASH_REDIS_URL
ANGELONE_MASTER_KEY
ANGELONE_API_KEY
ANGELONE_CLIENT_ID
ANGELONE_PIN
ANGELONE_TOTP_SECRET
FRONTEND_ORIGIN
```

The Vercel frontend uses same-origin server routes by default, so quote and
candle requests continue working even when the optional streaming backend is
unavailable. To enable Angel One streaming, set:

```text
VITE_API_URL=https://maet.onrender.com
```

Do not commit `.env`, `.env.backup`, broker credentials, TOTP secrets, or
database passwords.

## Local Development

```bash
npm ci
npm run build --prefix server
npm run start --prefix server
```

In another terminal:

```bash
VITE_API_URL=http://localhost:3000 npm run dev --prefix src
```

The backend uses `PORT` and `HOST` from the environment. The Lovable frontend
development server currently defaults to port 8080.

## Verification

```bash
npm run typecheck
npm test -- --run
npm run build
npm run build --prefix server
npm audit --omit=dev --audit-level=high
```

Runtime checks:

```text
GET /api/health
GET /api/market/quotes?symbols=RELIANCE,TCS
GET /api/market/candles?symbol=RELIANCE&tf=1d&range=1mo
GET /api/market/stream?symbols=RELIANCE
```

## Deployment

Vercel uses the root `vercel.json` and emits `src/.vercel/output`.

Render service: `https://maet.onrender.com`.

Render uses `render.yaml` with `rootDir: server`:

```text
Build: cd .. && bun install && cd server && bun run build
Start: bun run start
Health: /api/health
```

If the Render service was created manually, dashboard commands override
`render.yaml`; set the dashboard commands to the values above.

See `docs/REMAINING-WORK.md` for verified limitations and production follow-up.

# MAET - Market Analytics & Execution Terminal

## Project Overview
Full-featured trading platform with Yahoo Finance integration, real-time data, and AI-powered trading capabilities.

## Tech Stack
- Framework: TanStack Start (Nitro)
- Runtime: Bun
- Frontend: React with TypeScript
- UI: shadcn/ui, Radix UI
- Styling: Tailwind CSS
- Trading APIs: Yahoo Finance, Alpha Vantage, Polygon.io
- Crypto APIs: CoinGecko, CoinMarketCap
- Authentication: Auth.js, tRPC
- Database: SQLite with Prisma
- Testing: Vitest, Playwright, React Testing Library

## Key Features
- Real-time stock and crypto data
- Technical indicators (RSI, MACD, Bollinger Bands)
- Order management
- Portfolio tracking
- Backtesting capabilities
- AI-powered trading strategies
- Multi-exchange integration

## Commands
- `bun run dev` - Start development server
- `bun run build` - Build for production
- `bun run preview` - Preview production build
- `bun run test` - Run all tests
- `bun run test:unit` - Run unit tests
- `bun run test:e2e` - Run E2E tests
- `bun run typecheck` - Type check
- `bun run lint` - Lint code

## Deployment
- Vercel: Primary deployment (auto-deploys on push to main)
- Render: Alternative deployment configuration available
- Supports static export and server rendering

## Project Structure
- `src/` - Frontend React application
- `server/` - Nitro server/API routes
- `shared/` - Shared utilities and types

## Notes
- Claude Code has full permissions in this project
- Environment variables managed via .env files
- Multi-stage deployment pipeline
- Includes Playwright for E2E testing
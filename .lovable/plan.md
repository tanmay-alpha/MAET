# Plan: Move MAET UI into your Next.js trading platform

Your existing project is **Next.js + React + TS + Tailwind + Zustand** with a **FastAPI/WebSocket/AngelOne** backend. MAET here is built on **TanStack Start** (different router + SSR system). So this is a port, not a copy-paste. The good news: components, styles, and hooks are framework-agnostic React and move cleanly. Only the routing shell and the small server-function bits need rewriting.

## What moves as-is (copy directly)

- `src/components/trading/*` — candlestick chart, heatmap, breadth gauge, flows, sector strip, skeleton
- `src/components/ui/*` — shadcn primitives
- `src/components/app-sidebar.tsx`
- `src/hooks/*` — including `use-live-price.ts`
- `src/lib/*` — utilities
- `src/styles.css` — full TradingView color tokens, typography scale, flash/tick animations, `tv-*` utilities

## What gets rewritten (routing shell)

TanStack routes → Next.js App Router pages:

```text
src/routes/index.tsx            → app/page.tsx                 (landing)
src/routes/__root.tsx           → app/layout.tsx               (root shell + fonts + metadata)
src/routes/_app.tsx             → app/(app)/layout.tsx         (sidebar shell)
src/routes/_app.dashboard.tsx   → app/(app)/dashboard/page.tsx
src/routes/_app.screener.tsx    → app/(app)/screener/page.tsx
src/routes/_app.terminal.tsx    → app/(app)/terminal/page.tsx
src/routes/_app.backtest.tsx    → app/(app)/backtest/page.tsx
src/routes/_app.strategies.tsx  → app/(app)/strategies/page.tsx
```

- Replace `@tanstack/react-router` `Link` / `useNavigate` with `next/link` / `next/navigation`.
- Any interactive page (screener, charts, sidebar) gets `"use client"` at the top.
- `head()` exports become Next.js `metadata` exports.
- Delete `src/routeTree.gen.ts`, `src/router.tsx`, `src/server.ts`, `src/start.ts` — Next has its own.

## Backend wiring (your FastAPI stays)

- `use-live-price` currently fakes ticks. Point it at your FastAPI WebSocket so screener + chart legends drive off Angel One quotes.
- Screener table data: swap mock list for a fetch to your FastAPI symbols endpoint (server component or Zustand store).
- No Lovable Cloud needed — your Python backend already owns auth, persistence, broker calls.

## Execution order (in your Next.js repo)

1. **Branch** `feat/maet-ui` off main so the old UI is recoverable.
2. **Install deps** present in MAET but missing in your project: `tailwindcss-animate`, `class-variance-authority`, `lucide-react`, shadcn deps, `@fontsource/*` font packages used by MAET.
3. **Port `styles.css`** into your `app/globals.css` (merge tokens, do not overwrite your Tailwind config blindly — keep your existing Zustand/Next setup).
4. **Copy** `components/`, `hooks/`, `lib/` folders verbatim.
5. **Rewrite the 8 route files** as Next.js pages with `"use client"` where needed.
6. **Delete the old UI**: remove the previous `app/` (or `pages/`) page tree and old components only after the new pages render.
7. **Wire FastAPI**: replace mock data in screener + live-price hook with real WebSocket / REST calls.
8. **Smoke test**: `next build`, hit `/`, `/dashboard`, `/screener`, `/terminal`, confirm sidebar nav works and styles match.

## Two ways I can help next

Pick one — I'll do the work accordingly:

- **A. Export bundle** — I prepare a clean `maet-ui-bundle/` here (components, hooks, styles, plus Next.js-ready page stubs and a README with the rewrite diffs). You drop it into your Next repo and delete the old UI.
- **B. Direct port** — share your Next repo (GitHub URL or @mention it in this workspace) and I'll port it there, including FastAPI WebSocket wiring.

Which do you want, A or B?
# MAET UI Bundle → Next.js drop-in

This folder is everything you need to move the MAET (TradingView-style) UI
into your existing **Next.js + TS + Tailwind + Zustand** trading platform.

## What's inside

```
maet-ui-bundle/
├── src/
│   ├── components/         ← copy verbatim to your Next.js `src/components/`
│   │   ├── app-sidebar.tsx
│   │   ├── trading/        ← chart, heatmap, breadth, flows, sector strip, skeleton, ticker tape
│   │   └── ui/             ← shadcn primitives
│   ├── hooks/              ← copy verbatim to `src/hooks/`
│   ├── lib/                ← copy verbatim to `src/lib/`
│   └── styles.css          ← merge into your `app/globals.css`
└── next-app/
    └── app/                ← fully ported Next.js App Router pages (ready to use)
        ├── layout.tsx              (root metadata + fonts)
        ├── page.tsx                (landing page — fully ported)
        └── (app)/
            ├── layout.tsx          (sidebar + header shell, already ported)
            ├── dashboard/page.tsx  (fully ported)
            ├── screener/page.tsx   (fully ported)
            ├── terminal/page.tsx   (fully ported)
            ├── backtest/page.tsx   (fully ported)
            └── strategies/page.tsx (fully ported)
```

## Step-by-step migration

### 1. Branch your repo
```bash
git checkout -b feat/maet-ui
```

### 2. Install missing dependencies
```bash
npm i lucide-react class-variance-authority clsx tailwind-merge \
      tailwindcss-animate @radix-ui/react-slot @radix-ui/react-dialog \
      @radix-ui/react-tooltip @radix-ui/react-separator \
      @radix-ui/react-scroll-area @radix-ui/react-tabs
```
(If any `components/ui` files complain about missing `@radix-ui/*` packages, install those too.)

### 3. Copy source folders
```bash
cp -r maet-ui-bundle/src/components ./src/
cp -r maet-ui-bundle/src/hooks      ./src/
cp -r maet-ui-bundle/src/lib        ./src/
```

### 4. Merge styles
Open `maet-ui-bundle/src/styles.css` and append everything (the `@layer base` tokens,
TradingView color variables, `text-tv-*` utilities, and flash/tick keyframes) into your
existing `app/globals.css`. Keep your Tailwind directives at the top.

Make sure `tailwind.config.ts` includes:
```ts
content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
plugins: [require("tailwindcss-animate")],
```

### 5. Copy Next.js App Router shells
```bash
cp maet-ui-bundle/next-app/app/layout.tsx       ./app/layout.tsx
cp maet-ui-bundle/next-app/app/page.tsx         ./app/page.tsx
mkdir -p './app/(app)'
cp -r 'maet-ui-bundle/next-app/app/(app)'/*     './app/(app)/'
```

> **Note:** The page files are already ported from TanStack to Next.js. No manual
> paste or search-replace needed for pages.

### 6. Replace the old UI
Once the new pages render correctly, remove your old page files:
```bash
rm -rf <your-old-page-folders>
```
Keep your Zustand stores, FastAPI clients, and WebSocket code — only the view layer
is being replaced.

### 7. Wire your real backend
- **Live ticks**: open `src/hooks/use-live-price.ts`. Replace the `setInterval` mock
  with a subscription to your FastAPI WebSocket (Angel One feed). Keep the same return
  shape `{ price, change, tick }` so all consumers (chart legend, screener flash
  animations) keep working.
- **Screener rows**: in `app/(app)/screener/page.tsx`, replace the mock `ROWS` array
  with a fetch to your FastAPI symbols/quotes endpoint — ideally via a Zustand store
  that the WebSocket updates in place.
- **Chart data**: feed `CandlestickChart` from your FastAPI candles endpoint instead
  of synthetic OHLC.

### 8. Smoke test
```bash
npm run build
npm run dev
```
Visit `/`, `/dashboard`, `/screener`, `/terminal`, `/backtest`, `/strategies`.
Check sidebar nav, crosshair on the chart, row keyboard nav on the screener, and
flash animation on price updates.

## Files NOT to copy

These are TanStack Start-specific and have no Next.js equivalent:
- `src/router.tsx`, `src/server.ts`, `src/start.ts`, `src/routeTree.gen.ts`
- `src/routes/__root.tsx` (replaced by `app/layout.tsx`)
- `src/routes/_app.tsx` (replaced by `app/(app)/layout.tsx`)

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Module not found: @/...` | Add path alias to `tsconfig.json`: `"paths": { "@/*": ["./src/*"] }` |
| CSS variables missing | Re-merge `styles.css` into `globals.css` (step 4) |
| `"useRouter is not a function"` | Import from `next/navigation`, not `next/router` |
| Hydration mismatch on chart/screener | Pages using client hooks already have `"use client"` — ensure parent layouts don't force SSR on them |

## If you want me to port it directly

If you share the GitHub URL or @mention the Next.js project inside this Lovable
workspace, I can perform the port directly (auto-install deps, copy files, merge
styles, wire FastAPI). Otherwise the steps above are everything you need.

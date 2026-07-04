# MAET repository guidance

MAET is a scanner-first Indian market intelligence terminal. It is not a
real-money trading platform.

## Stack

- Bun workspace
- TanStack Start, React, Vite and Nitro
- PostgreSQL/Supabase through Drizzle ORM
- Redis/Upstash
- NSE company master, Angel One live quotes and Yahoo delayed history
- Vercel frontend and Render backend

## Engineering rules

- Read `AGENTS.md`, `README.md`, `docs/PROJECT-ARCHITECTURE.md`, and
  `docs/REMAINING-WORK.md` before broad work.
- Never invent market, ratio, financial-statement, or broker data.
- Missing fields render as `—` with an honest source reason.
- Preserve the database-first screener and existing chart behavior.
- Keep ingestion idempotent and source-tagged.
- Never commit `.env` files, credentials, generated build output, or database
  connection strings.
- Do not rewrite published Git history; the `main` branch is synchronized with
  Lovable.

## Verification

```bash
bun run typecheck
bun test
cd server && bun run build
cd ../src && bun run lint && bun run build
```

When database credentials are available, run the bounded ingestion check:

```bash
bun run smoke:screener-v4
```

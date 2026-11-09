# Deployment verification

## Targets

| Tier | Platform | Identifier | URL | Revision proof |
|---|---|---|---|---|
| Frontend (SSR + same-origin `/api/market/*`) | Vercel project `maet` (`prj_qfc8C1VIjl8mYuGZ2OKpjw63ykAs`, root directory `src`) | production alias | https://maet-pi.vercel.app | response header `x-maet-build: <commit>` |
| Backend (tRPC, SSE, workers) | Render web service `MAET` (`srv-d8vpp89o3t8c73bisivg`, free plan, Node 22) | `main` autodeploy | https://maet.onrender.com | `/api/health` and `/api/ready` field `version` (`RENDER_GIT_COMMIT`) |
| Database + auth | Supabase | **missing — see OPS-1** | — | `/api/ready` `checks.database` |
| Redis | Upstash | **missing — see OPS-1** | — | `/api/ready` `checks.redis` |

`maet-backend` (`srv-d7s89mvlk1mc73djjoh0`) on the same Render workspace deploys a different repository
(`indian-algo-trading-platform`) and is not part of this system.

## Health contract

- `GET /api/health` — liveness. Always HTTP 200 (Render restarts an instance on non-2xx, which cannot
  repair an external outage). Body: `status` (`ok`/`degraded`), `version`, `checks.{database,redis,orchestrator,marketData}`, `databaseCircuit`.
- `GET /api/ready` — readiness. Same body; HTTP 503 unless database and Redis are reachable. Release gates use this.

## Release gates (on every push to `main`)

1. `CI Validation Workflow`: typecheck, lint, test wiring, unit, Postgres integration/concurrency/advanced suites, Playwright, frontend build, backend build, **backend bundle booted on Node 22** (catches Bun-only APIs).
2. `Verify Render Deployment`: polls `/api/ready` until HTTP 200 **and** `version == $GITHUB_SHA`, then `scripts/smoke-deploy.ts --backend-only` (CORS preflight from the production origin, 401 on an anonymous protected procedure, a public DB-backed procedure, the quotes API). Read-only.
3. `Verify Vercel Production`: polls `https://maet-pi.vercel.app/` until HTTP 200 **and** `x-maet-build == $GITHUB_SHA`. A rate-limited, failed or unpromoted build therefore fails the workflow instead of leaving an old revision silently in place.

Manual/full: `bun run scripts/smoke-deploy.ts --sha <commit>` checks both tiers together.

## Vercel preview quota

Vercel project setting **Ignored Build Step** = `if [ -f scripts/vercel-ignore-build.sh ]; then bash scripts/vercel-ignore-build.sh; else exit 1; fi` (set via the Vercel API on 2026-11-10). Vercel treats any exit code other than 0/1 as a failed deployment, so a branch created before the script existed (exit 127) failed its preview until the guard was added.
Production always builds; previews build only if `src/`, `shared/`, `package.json`, `bun.lock` or `tsconfig.json`
changed since the branch's previous deployment. A `src/vercel.json` was tried first and broke SSR packaging
(every page 500, `ERR_PACKAGE_IMPORT_NOT_DEFINED #tanstack-router-entry`); it was removed before merge.

Previews have no `VITE_API_URL` (the variable exists only for Production), so preview pages cannot reach a
backend. They do not touch production data.

## OPS-1 runbook: restoring the data stores

Both stores referenced by the Render service no longer exist (NXDOMAIN). Restoring them creates new
free-tier resources and is an owner action. After the owner provisions them:

1. **Supabase** (free project). Collect: project URL, anon key, service-role key, and the **Supavisor transaction pooler** URI
   (`postgresql://postgres.<ref>:<password>@aws-…pooler.supabase.com:6543/postgres`). Render has no IPv6, so the direct `db.<ref>.supabase.co` host must not be used.
2. **Upstash Redis** (free). Collect the `rediss://` URL.
3. Put the values in the git-ignored `.env.production.local` (never committed, never printed).
4. Migrations (empty database, nothing to back up yet; for any non-empty target take a `pg_dump` first):
   ```bash
   MIGRATION_DATABASE_URL=<session pooler URI, port 5432> bun run server/scripts/apply-migrations.ts
   bun run verify:db   # compares key tables and migration ledger
   ```
   The runner applies each file in its own transaction and records it in the tracking table, so a failure leaves earlier migrations applied and the failing one rolled back.
5. Render env vars: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` (transaction pooler, 6543), `UPSTASH_REDIS_URL`. Saving triggers a redeploy.
6. Vercel env (Production): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`; redeploy production.
7. Supabase Auth → URL configuration: site URL `https://maet-pi.vercel.app`.
8. Verify: `bun run scripts/smoke-deploy.ts --sha <main sha>` → 6/6, then the browser journey (sign-up, sign-in, paper order, ledger, sign-out).

## Log of production observations

| When (UTC) | Observation | Source |
|---|---|---|
| 2026-11-09 18:46 | `/api/health` on `49dcad5`: degraded, database=false, redis=false, circuit open | `curl` |
| 2026-11-09 18:46 | `PostgresError (ENOTFOUND) tenant/user postgres.ztpbfmpfgmgmsitshzma not found` every 10 s | Render logs API |
| 2026-11-06 → 11-09 | `getaddrinfo ENOTFOUND immense-swift-134371.upstash.io` | Render logs API |
| 2026-11-06 22:40, 23:13, 23:18; 2026-11-09 19:12, 19:14 | `TypeError: Promise.withResolvers is not a function` on Node 20 (traced to `timerDeadline` during graceful shutdown) | Render logs API |
| 2026-11-09 19:12:45 | Build for `dcfdda8`: `Using Node.js version 22.23.4` | Render logs API |
| 2026-11-09 19:18 | `/api/ready` on `dcfdda8`: HTTP 503, database=false, redis=false (OPS-1); `maet-pi.vercel.app` `x-maet-build: dcfdda8…`; `Verify Vercel Production` succeeded for `dcfdda8` | `curl`, GitHub Actions |
| 2026-11-06 | Vercel status on `f535d0a`: `Deployment rate limited — retry in 24 hours` | GitHub commit statuses |
| 2026-11-09 18:47 | `maet-pi.vercel.app` → `dpl_6vDkwVL6…`, commit `49dcad5` (synced) | Vercel API |
| 2026-11-09 19:07 | Preview with `src/vercel.json` → HTTP 500 on `/`; fixed preview `b33f1e5` → 200, `x-maet-build: b33f1e5…` | `vercel curl`, runtime logs |

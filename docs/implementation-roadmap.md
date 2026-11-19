# Implementation roadmap

Findings are defined in [`engineering-audit.md`](engineering-audit.md). A row is **done** only with a
test that fails before the fix and passes after it, or with direct production evidence, recorded in
[`test-evidence.md`](test-evidence.md) or [`deployment-verification.md`](deployment-verification.md).
Implementation was split by file ownership across parallel agents. The orchestrator reviewed each
branch, merged `main` into it, re-ran its suites and merged it only after CI passed.

| ID | Priority | Component | Problem | Evidence | Change | Owner/subagent | Acceptance tests | Status | Commit/PR |
|---|---|---|---|---|---|---|---|---|---|
| OPS-1 | P0 | Supabase/Upstash | Configured data stores deleted | NXDOMAIN; Render logs `tenant/user … not found`, `ENOTFOUND` | Owner provisions new free Supabase + Upstash; reviewed migrations; Render/Vercel env (runbook) | owner | `/api/ready` 200 on deployed SHA; smoke 6/6 | **blocked: owner provisioning** | — |
| OPS-2 | P0 | Render runtime | Node 20 lacks `Promise.withResolvers` | Render logs TypeError | Node 22; CI boots bundle on Node 22 | orchestrator | CI step "Boot Built Backend On Node" (observed v22.23.4) | done | #57 |
| OPS-3 | P1 | Vercel | Prod build rate-limited by previews | Vercel status on f535d0a | Ignored Build Step; `x-maet-build`; `verify-vercel.yml` | orchestrator | workflow observed prod = pushed SHA | done | #56 |
| OPS-4 | P1 | Health | No readiness signal | code | `/api/ready` (503 unless every check passes); deploy gate; `scripts/smoke-deploy.ts` | orchestrator | 3 readiness tests; smoke run against prod | done | #56 |
| OPS-5 | P1 | Frontend auth | Hardcoded deleted Supabase URL | `auth-token.ts:8` | Removed; "sign-in not configured" state | FrontendAuth | unit + e2e | done | #70 |
| OPS-6 | P1 | Vercel previews | No backend for previews | env list | Previews stay without `VITE_API_URL` and cannot reach production data; a staging backend is a new paid/free service needing owner approval | owner | — | deferred | — |
| OPS-7 | P2 | Migrations | Manual production migrations | ARCHITECTURE.md | Runbook (backup, session pooler, `verify:db`) | orchestrator | to be executed on the new project | documented | docs |
| BE-1 | P1 | tRPC errors | DB down → HTTP 500 | production smoke | `mapDatabaseOutage` → 503 | Hardening | refused-connection test | done | #64 |
| BE-2 | P1 | Market breadth | ~400 days × universe loaded into memory | repository.ts | SQL window aggregate | orchestrator | breadth suite 17/17 | done | #60 |
| BE-3 | P2 | Strategy versions | Non-atomic numbering | repository.ts | Row lock, in-tx duplicate check, max+1 | orchestrator | 3 fail before / 3 pass after | done | #58 |
| BE-4 | P2 | Chart workspaces | Workspace + pane not atomic | repository.ts | Transaction | orchestrator | covered by existing suites | done | #58 |
| BE-5 | P3 | RLS | Thesis child tables had no policies | migration 0015 | Migration 0029 owner SELECT policies | ReplayRls | `test:migration-0029` | done | #66 |
| UX-1 | P0 | Auth UI | No sign-in/out | `app-shell.tsx:52` | `/login`, sign-up, sign-out | FrontendAuth | `auth.spec.ts` | done | #70 |
| UX-2 | P1 | Routing | No route error boundary | `__root.tsx` | `_app` error panel with retry | FrontendAuth | `resilience.spec.ts` | done | #70 |
| UX-3 | P1 | A11y | Shortcut hijack; unlabeled chart | `use-chart-layout.ts` | Skip interactive targets; `role=img` | FrontendAuth | `resilience.spec.ts` | done | #70 |
| UX-4 | P1 | Responsive | 768 px squeeze; `/orders` +370 px and `/backtest` +248 px overflow (sr-only header labels escaping their table scrollers) | Playwright | Slide-over sidebar < 1024 px; table scrollers are `relative` | FrontendAuth, UiPolish | 360/768/1440 on ten pages, wide tables filled with rows | done | #70, UiPolish PR |
| UX-5 | P2 | Portfolio | No cash ledger | no callers | Ledger + reconciliation | FrontendAuth | `ledger.spec.ts` | done | #70 |
| UX-6 | P2 | Bundles | Chart routes wait for lightweight-charts/recharts before rendering | build output, start manifest preloads | Lazy chart components with sized `role=status` fallbacks; React and lightweight-charts vendor chunks; `check:bundle` budget in CI | BundleSplit | `lazy-charts.spec.ts`, `ssr-assets.spec.ts`, `bun run check:bundle` | done | #75 |
| FIN-1 | P1 | Paper margin | Stale marks | `margin.ts` | Live marks; unmarked gains never count | PaperRisk | counterexample + seeded sweep | done | #59 |
| FIN-2 | P1 | Paper execution | Risk-reducing fills rejected | `execution.ts` | Never margin-reject pure reductions | PaperRisk | counterexample | done | #59 |
| FIN-3 | P1 | runner-v3 | Risk settings ignored | `schemas.ts` | Drawdown/daily-loss enforced; others rejected | ResearchEngine | `runner-v3-risk-gates.test.ts` | done | #63 |
| FIN-4 | P2 | runner-v3 | Negative equity, sign-flipped returns | code | Halt at equity ≤ 0 | ResearchEngine | 60-run seeded check | done | #63 |
| FIN-5 | P2 | Execution model | 1-share minimum fill | `execution-model.ts:174` | No fill when cap rounds to 0 | ResearchEngine | 2,000-case check | done | #63 |
| FIN-6 | P2 | Portfolio engine | Existing vs projected exposure | `portfolio-engine.ts` | Post-order caps, resize/reject | ResearchEngine | 40-run seeded check | done | #63 |
| FIN-7 | P2 | Portfolio engine | Sizing look-ahead | `portfolio-engine.ts` | Open-time marks | ResearchEngine | 50 perturbations | done | #63 |
| FIN-8 | P2 | PIT fundamentals | Null availability visible from 1970 | `point-in-time.ts` | Never visible | ResearchEngine | unit | done | #63 |
| FIN-9 | P3 | Paper ledger | Same `balanceAfter` on both rows | `fill-writer.ts` | Running balance | PaperRisk | ledger replay (Postgres) | done | #59 |
| FIN-10 | P3 | Tick fills | Fills without traded volume | `tick-processor.ts` | `tickLiquidityCap` | PaperRisk | unit + Postgres | done | #59 |
| FIN-11 | P2 | Deployments | AUTO_PAPER/MANUAL_CONFIRM limits, sizing, direction, re-entry | `strategy-evaluator.ts` | Fixed (a)–(g) + MANUAL_CONFIRM | AutoPaper | 10 unit + Postgres 6–7 | done | #68 |
| — | P2 | Strategy hash | Canonical JSON dropped nested keys → false CONFLICT | `ast.ts` | Sorted keys at every depth | ResearchEngine | 200 random key orders | done | #63 |
| RES-1 | P1 | Walk-forward | Requested spans ignored | router + engine | Exact T/V/V windows | WalkForward | 300-case check | done | #62 |
| RES-2 | P1 | Walk-forward | Rejected windows excluded | `walk-forward.ts` | Cash segments, counted | WalkForward | unit | done | #62 |
| RES-3 | P1 | Fundamentals | Fabricated period dates | `daily-processor.ts` | NSE rows as snapshots; no invented dates | IngestionPipeline | unit | done | #67 |
| RES-4 | P1 | Corporate actions | Never ingested | no writer | Reported on `/data-quality` | — | — | open (data source needed) | #65 |
| RES-5 | P1 | Docs | Survivorship claim unsupported | README | Claim removed; gap stated | orchestrator | doc review | done | docs |
| RES-6 | P1 | Ingestion | Wrote `price_daily`; consumers read `candles` | writer | Validated upsert into `candles` | IngestionPipeline | Postgres pipeline test | done | #67 |
| RES-7 | P2 | Sweeps | No overfitting control | `robustness.ts` | PBO via CSCV, shown on the sweep results page with trials and the reason when null | WalkForward, UiPolish | 30 seeded matrices, 3 component | done | #62, UiPolish PR |
| RES-8 | P2 | Benchmark | Always 0 | worker | Same-date benchmark in walk-forward; reports mark queued-backtest benchmark as not applied | WalkForward, RunReports | unit | done (walk-forward); reported (backtests) | #62, #71 |
| SEC-1 | P1 | Market stream | Unbounded Angel subscriptions; per-tick DB | `stream.get.ts` | Catalogue check, 1,000-token budget, idle short-circuit | Hardening | 2,000-symbol + 400-step tests | done | #64 |
| SEC-2 | P1 | Backtest v2 | Unbounded stored runs | `backtest-v2.ts` | 50-run retention, downsample | Hardening | Postgres retention test | done | #64 |
| SEC-3 | P2 | Screener | Unbounded filters | `screener.ts` | ≤20 filters, ≤50 saved | Hardening | unit | done | #64 |
| SEC-4 | P2 | NSE master | No single-flight | source | In-flight + 60 s backoff | Hardening | 10 concurrent → 1 fetch | done | #64 |
| SEC-5 | P3 | Replay | Lost updates, uncapped orders | router | Row lock, caps, ACTIVE-only; Date param bug | ReplayRls | 5 fail before / pass after | done | #66 |
| SEC-6 | P3 | Vercel routes | Raw errors, weak symbol validation | `api.market.*` | Shared validation, fixed messages | Hardening | 300-round random test | done | #64 |
| F-1 | P2 | Feature | Market-data quality center | — | `/data-quality` + admin reliability | DataQuality | 21 unit, 8 Postgres, e2e | done | #65, #72 |
| F-2/3 | P2 | Feature | Run reports, comparison | — | `/research/reports` | RunReports | 31 unit, 6 Postgres | done | #71 |
| F-4 | P2 | Feature | Ledger/reconciliation | — | `/portfolio` | FrontendAuth | e2e | done | #70 |
| F-6 | P2 | Feature | Screener: headers gave no units (one column mixed ₹ and ₹ Cr); a metric filter silently dropped rows with null data; no per-row source or as-of time; company-table fundamentals labelled with the master-data source; signed-out users were offered a save the protected procedure rejects | screener audit | Units in headers, one Indian-grouped format per unit; null → "—" read as "Not available"; `excludedForMissingData` count per metric in the API and header; header or per-row price/fundamentals source and as-of with stale flags; signed-out saved-screens notice | ScreenerUx | 23 unit, `screener-data-honesty.spec.ts` at 360/1440 px | done | ScreenerUx PR |
| F-8 | P2 | Feature | Synthetic demo; demo builds called real Yahoo quotes synthetic | demo browser audit | `seed:demo`, demo banner; every quote label, tooltip and source line goes through `quoteSourceLabel` / `quoteProviderName`, which state each quote's own source (simulated → synthetic, Yahoo → Yahoo · delayed) | DemoMode, UiPolish | 24 unit, 3 Postgres | done | #69, UiPolish PR |
| TEST-1 | P2 | Load | No bounded load test | — | `scripts/load-test.ts` (refuses production) | orchestrator | local run recorded | done | docs |

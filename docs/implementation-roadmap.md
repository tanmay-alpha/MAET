# Implementation roadmap

Findings are defined in [`engineering-audit.md`](engineering-audit.md). A row is **done** only
with a passing test or direct production evidence recorded in [`test-evidence.md`](test-evidence.md)
or [`deployment-verification.md`](deployment-verification.md).

| ID | Priority | Component | Problem | Evidence | Proposed change | Owner/subagent | Acceptance tests | Status | Commit/PR |
|---|---|---|---|---|---|---|---|---|---|
| OPS-1 | P0 | Supabase/Upstash | Data stores deleted | NXDOMAIN; Render logs | Owner provisions new free Supabase + Upstash; apply reviewed migrations; set Render/Vercel env | owner + orchestrator | `/api/ready` 200 on deployed SHA; smoke test 6/6 | blocked: owner provisioning | — |
| OPS-2 | P0 | Render runtime | Node 20 lacks `Promise.withResolvers` | Render logs | Node 22; CI boots bundle on Node 22 | orchestrator | CI "Boot Built Backend On Node" | in review | PR #57 |
| OPS-3 | P1 | Vercel | Prod build rate-limited by previews | commit status on f535d0a | Ignored-build step for previews; `x-maet-build` header; verify-vercel workflow | orchestrator | workflow observes prod SHA | in review | PR #56 |
| OPS-4 | P1 | Render health | No readiness | code | `/api/ready` (503 unless DB+Redis); deploy gate + `scripts/smoke-deploy.ts` | orchestrator | `server/infra/health.test.ts` ready cases | in review | PR #56 |
| OPS-5 | P1 | Frontend auth | Hardcoded deleted Supabase URL | `auth-token.ts:8` | Remove fallback; "not configured" state | FrontendAuth | unit + e2e | in progress | — |
| OPS-6 | P1 | Vercel previews | No backend for previews | Vercel env list | Set preview `VITE_API_URL` only to a non-production backend; until one exists previews show "API not configured" | orchestrator | preview smoke | open | — |
| OPS-7 | P2 | Migrations | Manual production migrations | ARCHITECTURE.md | Documented, reviewed runbook with backup + `verify:db` | orchestrator | runbook executed on new project | open | — |
| UX-1 | P0 | Auth UI | No sign-in/out | `app-shell.tsx:52` | GoTrue email/password sign-in, sign-up, sign-out | FrontendAuth | Playwright sign-in/out | in progress | — |
| UX-2 | P1 | Routing | No route error boundaries | `__root.tsx` | `_app` errorComponent with retry | FrontendAuth | Playwright recovery | in progress | — |
| UX-3 | P1 | A11y | Shortcut hijack; unlabeled chart | `use-chart-layout.ts` | Skip interactive targets; `role=img` label | FrontendAuth | Playwright keyboard | in progress | — |
| UX-4 | P1 | Responsive | 768 px squeeze | audit | Collapse sidebar < 1024 px | FrontendAuth | Playwright 360/768/1440 | in progress | — |
| UX-5 | P2 | Portfolio | No cash ledger UI | no `listLedger` callers | Ledger + reconciliation panel | FrontendAuth | Playwright ledger balance | in progress | — |
| FIN-1 | P1 | Paper margin | Stale marks | `margin.ts:91,108` | Mark positions from live quotes | PaperRisk | counterexample unit test | in progress | — |
| FIN-2 | P1 | Paper execution | Risk-reducing fills rejected | `execution.ts:502` | Never margin-reject pure reductions | PaperRisk | counterexample unit test | in progress | — |
| FIN-9 | P3 | Paper ledger | Same `balanceAfter` on both rows | `fill-writer.ts:263` | Running balance per row | PaperRisk | ledger replay test | in progress | — |
| FIN-10 | P3 | Tick fills | Fill without traded volume | `tick-processor.ts:24` | Verify; no fill on zero volume | PaperRisk | unit | in progress | — |
| FIN-3 | P1 | runner-v3 | Risk settings ignored | `schemas.ts:139` | Enforce or reject | ResearchEngine | unit | in progress | — |
| FIN-4 | P2 | runner-v3 | Negative equity, sign-flipped returns | code | Halt at equity ≤ 0 | ResearchEngine | counterexample | in progress | — |
| FIN-5 | P2 | Execution model | 1-share minimum fill | `execution-model.ts:174` | No fill when cap rounds to 0 | ResearchEngine | volume edge cases | in progress | — |
| FIN-6 | P2 | Portfolio engine | Existing vs projected exposure | `portfolio-engine.ts:477` | Projected sector/gross caps | ResearchEngine | cap tests | in progress | — |
| FIN-7 | P2 | Portfolio engine | Sizing look-ahead | `portfolio-engine.ts:389` | Size from decision-time marks | ResearchEngine | metamorphic test | in progress | — |
| FIN-8 | P2 | PIT fundamentals | Null availability visible from 1970 | `point-in-time.ts:80` | Unknown availability never visible | ResearchEngine | unit | in progress | — |
| RES-1 | P1 | Walk-forward | Window spans | router :131 | Honour requested spans | WalkForward | unit | in progress | — |
| RES-2 | P1 | Walk-forward | Rejected windows excluded | `walk-forward.ts:339` | Cash segments + counted | WalkForward | unit | in progress | — |
| RES-7 | P2 | Sweeps | No overfitting control | `robustness.ts` | PBO via CSCV | WalkForward | unit | in progress | — |
| RES-5 | P1 | Docs | Survivorship claim unsupported | README | Correct documentation | orchestrator | doc review | open | — |
| RES-3/4/6 | P1 | Data pipeline | Filing dates, corporate actions, `price_daily` orphan | writers | Data-quality center reports these gaps; pipeline fix deferred | orchestrator | — | open | — |
| SEC-1 | P1 | Market stream | Unbounded Angel subscriptions; per-tick DB | `stream.get.ts` | Catalogue check, token budget, in-memory short-circuit | Hardening | unit | in progress | — |
| SEC-2 | P1 | Backtest v2 | Unbounded stored runs | `backtest-v2.ts:178` | Retention cap + downsample | Hardening | integration | in progress | — |
| SEC-3 | P2 | Screener | Unbounded filters | `screener.ts:335` | `.max(20)`, saved cap | Hardening | unit | in progress | — |
| SEC-4 | P2 | NSE master | No single-flight | `nse-company-master.ts` | In-flight promise + backoff | Hardening | unit | in progress | — |
| BE-1 | P1 | tRPC errors | DB down → 500 | production smoke | Map connectivity errors to 503 | Hardening | unit | in progress | — |

# Final Feature Architecture

Last updated: 2026-07-31
Status: Verified Implementation Specification (All 8 Verticals Complete)

## 1. Layer Boundaries

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (TanStack Start)              │
│  src/routes/  src/components/  src/hooks/  src/lib/       │
├─────────────────────────────────────────────────────────┤
│                     API Layer                             │
│  server/api/trpc/routers/  server/api/[name].ts           │
├─────────────────────────────────────────────────────────┤
│                  Feature Modules                          │
│  server/modules/{workspace,alerts,quality,peers,...}/    │
│  contracts.ts → repository.ts → service.ts → evaluator.ts │
├─────────────────────────────────────────────────────────┤
│                    Domain Layer                           │
│  server/domain/{analysis,backtest,screener,market,...}/  │
│  Pure functions. No I/O. No side effects.                 │
├─────────────────────────────────────────────────────────┤
│                  Infrastructure                           │
│  server/db/  server/infra/  server/workers/              │
│  Drizzle ORM → PostgreSQL. Redis caching. SSE hub.        │
├─────────────────────────────────────────────────────────┤
│                    Shared Types                           │
│  shared/types/  shared/domain/  shared/screener/          │
│  Zod schemas shared between server and frontend.          │
└─────────────────────────────────────────────────────────┘
```

## 2. Capability System

Every new feature is gated behind a capability check. Frontend features that
lack a backend capability or migration show an honest unavailable state rather
than crashing the application.

```typescript
// src/lib/capabilities.ts
export type Capability =
  | "cloudWorkspace"
  | "alertEngine"
  | "scorecard"
  | "peerComparison"
  | "dynamicHeatmap"
  | "naturalLanguageScreener"
  | "backtestV2"
  | "dataQuality"
  | "portfolioAnalytics"
  | "researchTimeline"
  | "derivatives"
  | "liveNews";

export interface CapabilityState {
  capability: Capability;
  available: boolean;
  reason?: string;
}
```

The `capabilities.get` tRPC procedure returns the current state. The frontend
`useCapabilities()` hook subscribes to it and the application shell hides or
disables navigation items accordingly.

## 3. Feature Module Pattern

Every feature module follows the same internal contract:

```
server/modules/<feature>/
├── contracts.ts          # Zod schemas + TypeScript types
├── repository.ts         # Database queries (Drizzle)
├── service.ts            # Business logic, validation, orchestration
├── evaluator.ts          # Optional: evaluation/compilation logic
└── *.test.ts             # Unit tests
```

**Contracts** define the public interface between the module and the outside
world. They are the single source of truth for request/response shapes.

**Repository** contains only database operations. It receives `DrizzleDatabase`
and returns ORM rows or throws typed errors.

**Service** receives a repository instance and contains business logic. It
validates inputs, enforces ownership, applies limits, and orchestrates
multiple repository calls within transactions.

**Evaluator** (when present) contains pure computational logic that can be
unit-tested without any I/O.

## 4. Database Migration Strategy

- Migrations are forward-only. Each file has a sequential prefix.
- Schema.ts is the single source of truth for Drizzle model definitions.
- Every user-owned table has an `ownerId` column (FK to `users.id`).
- RLS policies enforce that users can only access their own data.
- Admin procedures use `service_role` credentials server-side only.
- The frontend never sees `SUPABASE_SERVICE_ROLE_KEY`.

## 5. Frontend Integration Points

| Feature | Routes | Components | Hooks |
|---------|--------|------------|-------|
| Cloud Workspace | `_app.workspace.tsx` | `workspace/*` | `use-research-workspace.ts` |
| Alert Engine | `_app.alerts.tsx` | `notification-centre.tsx` | `use-alerts.ts` (rewrite) |
| Scorecard | Integrated | `stock-scorecard.tsx` | — |
| Peer Comparison | `_app.compare.tsx` (tabs) | `peer-comparison.tsx` | — |
| Dynamic Heatmap | `_app.heatmap.tsx` | `breadth-gauge.tsx` | — |
| Screener DSL | `_app.screener.tsx` | `nl-input.tsx` | — |
| Backtest V2 | `_app.backtest.tsx` | `backtest-v2/*` | — |
| Data Quality | `_app.admin.data-quality.tsx` | `data-quality/*` | — |

## 6. Testing Strategy

| Layer | Test Type | Location |
|-------|-----------|----------|
| Domain | Unit | `server/domain/**/*.test.ts` |
| Repository | Integration (requires TEST_DATABASE_URL) | `server/modules/**/*.integration.test.ts` |
| Service | Unit with mocked repo | `server/modules/**/*.test.ts` |
| Router | Ownership + auth tests | `server/api/trpc/**/*.test.ts` |
| Frontend hook | Unit with mocked tRPC | `src/hooks/**/*.test.ts` |
| Frontend component | Snapshot + interaction | `src/components/**/*.test.ts` |

## 7. Feature Flag Defaults

| Feature | Production Default | Reason |
|---------|-------------------|--------|
| cloudWorkspace | Disabled until migration + backend complete | Requires new tables |
| alertEngine | Disabled until evaluator deployed | Replaces browser authority |
| scorecard | Disabled until domain tests pass | New calculation method |
| peerComparison | Disabled until peer selection logic validated | Requires sector data |
| dynamicHeatmap | Disabled until breadth metrics verified | Removes hardcoded weights |
| naturalLanguageScreener | Disabled until parser tests pass | New DSL |
| backtestV2 | Disabled until risk metrics validated | Strategy expansion |
| dataQuality | Disabled until ingestion writers connected | Admin-only |
| portfolioAnalytics | Disabled (optional) | Requires daily snapshots |
| researchTimeline | Disabled (optional) | Requires multiple data sources |
| derivatives | Disabled | No verified provider |
| liveNews | Disabled | No verified provider |

## 8. Error Handling Policy

- All feature module errors use typed error classes extending `FeatureError`.
- Router layer maps feature errors to tRPC responses with appropriate codes.
- Frontend displays user-friendly messages with retry suggestions.
- No raw database errors reach the browser.
- No stack traces in production responses.

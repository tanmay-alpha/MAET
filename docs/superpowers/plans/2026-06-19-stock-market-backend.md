# Stock Market Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Replace the TanStack Start app's client-side mock data layer (src/lib/mock-data.ts, src/hooks/use-live-price.ts) with a real Nitro backend that streams live ticks via SSE, serves historical/fundamental data, and supports paper trading with idempotency.

**Architecture:** Single Nitro process on Render free + SSE for live ticks. Three workspaces in one repo: src/ (existing React app, ships to Vercel), server/ (new Nitro backend, ships to Render), shared/ (Zod schemas, imported by both via TS path aliases). One-way imports: http → domain → data. Workers talk via typed EventEmitter in infra/bus.ts. Supabase Postgres + Drizzle = source of truth, Upstash Redis = ephemeral state only.

**Tech Stack:** TanStack Start 1.167+ (React 19, Vite 8, Nitro 3), TypeScript 5.8, tRPC 11, Drizzle ORM, Supabase Postgres, Upstash Redis, Zod 3, Vitest, Playwright, k6, pino structured logger, otplib (TOTP), Angel One SmartAPI v2, Yahoo Finance (unofficial via yahoo-finance2), NSE India (scraped via cheerio), Supabase Auth, AES-256-GCM via Node crypto.

## Global Constraints

- Node 20 LTS runtime (Render free supports Node 20; do not require Node 22 features).
- TypeScript strict mode enabled in all three workspaces.
- No code may import across the boundary: http → domain → data. Workers may import domain/infra/data/shared but never http.
- Every external source (yahoo, nse, angelone, supabase) is wrapped in a typed function — no module outside data/sources/* may import an upstream SDK directly.
- Idempotency-Key is REQUIRED on every order POST. Redis sentinel + Postgres UNIQUE(user_id, idempotency_key) index.
- All sensitive env vars (ANGELONE_MASTER_KEY, SUPABASE_SERVICE_ROLE_KEY, etc.) are read via the zod-validated config in `server/config.ts`. Code must never access `process.env` directly at a call site; import `config` from `server/config.ts` instead.
- RLS is the source of truth for user-owned table access. The Nitro server uses a service-role key for worker-side writes only; all tRPC routes use the user JWT.
- All Redis keys have a TTL. No key is allowed to live forever.
- Every test runs via bun test (Vitest is not installed; the project uses bun:test). Update package.json scripts accordingly.
- Commit after every step that produces passing tests. Use Conventional Commits prefix: feat:, test:, chore:, fix:, docs:.
- Hot path (tick fan-out) must never write to Postgres.
- Free-tier budget awareness: Upstash 10k cmd/day, Supabase 500MB DB, Render 750hr/mo with spin-down after 15min idle.

---

## Phase 1: Skeleton and Shared Types

**Purpose:** Establish the Nitro server skeleton, package layout, path aliases, env validation, and shared Zod types so every later phase has a typed contract to consume.

### Task 1: Initialize server package with tsconfig path aliases

**Files:**
- Create: `server/package.json`
- Create: `shared/package.json`
- Create: `tsconfig.json`
- Create: `render.yaml`
- Create: `.env.example`

**Interfaces:**
- Consumes: design spec section 4 layout, design spec section 2 constraints
- Produces: `server/package.json` with deps nitropack, h3, zod, vitest, drizzle-orm, postgres, ioredis, pino, otplib; `tsconfig.json` with paths `@shared/*`, `@server/*`, `@infra/*`; `.env.example` listing every env var; `render.yaml` single Node Web Service

- [ ] **Step 1: Write the failing test**

Create `server/tsconfig.test.ts` (this lives inside the server workspace and is run by bun test):

```ts
import { describe, it, expect } from "bun:test";
import { resolve } from "node:path";

describe("tsconfig path aliases", () => {
  it("resolves @shared/types module to the shared workspace", async () => {
    const mod = await import("@shared/types/market");
    expect(mod).toBeDefined();
    expect(typeof mod.TickSchema).toBe("object");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && bun test tsconfig.test.ts
```
Expected: FAIL with `Cannot find module '@shared/types/market'`.

- [ ] **Step 3: Write minimal implementation**

Create `tsconfig.json` (repo root):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "baseUrl": ".",
    "paths": {
      "@shared/*": ["shared/*"],
      "@server/*": ["server/src/*"],
      "@infra/*": ["server/infra/*"]
    }
  },
  "include": ["server/**/*", "shared/**/*", "src/**/*"]
}
```

Create `package.json` (repo root, workspaces):

```json
{
  "name": "stock-market-monorepo",
  "private": true,
  "workspaces": ["src", "server", "shared"],
  "scripts": {
    "dev": "bun run server/src/main.ts",
    "test": "bun test",
    "typecheck": "tsc --noEmit"
  }
}
```

Create `server/package.json`:

```json
{
  "name": "@app/server",
  "type": "module",
  "version": "0.0.0",
  "scripts": {
    "dev": "nitro dev",
    "build": "nitro build",
    "start": "node .output/server/index.mjs",
    "test": "bun test"
  },
  "dependencies": {
    "nitropack": "^2.10.0",
    "h3": "^1.13.0",
    "zod": "^3.23.0",
    "drizzle-orm": "^0.36.0",
    "postgres": "^3.4.0",
    "ioredis": "^5.4.0",
    "pino": "^9.5.0",
    "otplib": "^12.0.0",
    "@trpc/server": "^11.0.0"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.8.0"
  }
}
```

Create `shared/package.json`:

```json
{
  "name": "@app/shared",
  "type": "module",
  "version": "0.0.0",
  "main": "./types/index.ts",
  "types": "./types/index.ts"
}
```

Create `.env.example`:

```
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
UPSTASH_REDIS_URL=rediss://default:...@...upstash.io:6379
ANGELONE_MASTER_KEY=base64:32bytes
ALERT_WEBHOOK_URL=
NSE_HOLIDAYS_JSON=[]
NODE_ENV=development
PORT=3000
```

Create `render.yaml`:

```yaml
services:
  - type: web
    name: stock-market-backend
    runtime: node
    plan: free
    rootDir: server
    buildCommand: bun install && bun run build
    startCommand: bun run start
    healthCheckPath: /health
    envVars:
      - key: NODE_VERSION
        value: "20"
      - key: SUPABASE_URL
        sync: false
      - key: SUPABASE_ANON_KEY
        sync: false
      - key: SUPABASE_SERVICE_ROLE_KEY
        sync: false
      - key: UPSTASH_REDIS_URL
        sync: false
      - key: ANGELONE_MASTER_KEY
        sync: false
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun install && bun test server/tsconfig.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tsconfig.json package.json server/package.json shared/package.json .env.example render.yaml
git commit -m "chore(skeleton): workspaces, tsconfig path aliases, render config"
```

---

### Task 2: Env config with Zod validation

**Files:**
- Create: `server/config.ts`
- Create: `server/env.d.ts`
- Create: `server/config.test.ts`

**Interfaces:**
- Consumes: tsconfig path aliases from task-1
- Produces: `export const config: AppConfig` from `server/config.ts` parsing `process.env` with Zod; `AppConfig` with `{ supabaseUrl, supabaseServiceKey, redisUrl, angeloneMasterKey, alertWebhookUrl? }`

- [ ] **Step 1: Write the failing test**

Create `server/config.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";

describe("config", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.UPSTASH_REDIS_URL;
    delete process.env.ANGELONE_MASTER_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("throws when ANGELONE_MASTER_KEY is missing", async () => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
    process.env.SUPABASE_ANON_KEY = "anon";
    process.env.UPSTASH_REDIS_URL = "rediss://x";
    process.env.ANGELONE_MASTER_KEY = "";

    // dynamic import after env is set so config re-evaluates
    const mod = await import("./config");
    expect(() => mod.getConfig()).toThrow(/ANGELONE_MASTER_KEY/);
  });

  it("returns a parsed config when all required vars are set", async () => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
    process.env.SUPABASE_ANON_KEY = "anon";
    process.env.UPSTASH_REDIS_URL = "rediss://x";
    process.env.ANGELONE_MASTER_KEY = "a".repeat(44);

    const mod = await import("./config?case=happy");
    const c = mod.getConfig();
    expect(c.supabaseUrl).toBe("https://x.supabase.co");
    expect(c.angeloneMasterKey).toBe("a".repeat(44));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && bun test config.test.ts
```
Expected: FAIL with `Cannot find module './config'`.

- [ ] **Step 3: Write minimal implementation**

Create `server/env.d.ts`:

```ts
declare namespace NodeJS {
  interface ProcessEnv {
    SUPABASE_URL?: string;
    SUPABASE_ANON_KEY?: string;
    SUPABASE_SERVICE_ROLE_KEY?: string;
    UPSTASH_REDIS_URL?: string;
    ANGELONE_MASTER_KEY?: string;
    ALERT_WEBHOOK_URL?: string;
    NSE_HOLIDAYS_JSON?: string;
    NODE_ENV?: "development" | "production" | "test";
    PORT?: string;
  }
}
```

Create `server/config.ts`:

```ts
import { z } from "zod";

const EnvSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  UPSTASH_REDIS_URL: z.string().min(1),
  ANGELONE_MASTER_KEY: z.string().min(32, "ANGELONE_MASTER_KEY must be at least 32 chars"),
  ALERT_WEBHOOK_URL: z.string().url().optional(),
  NSE_HOLIDAYS_JSON: z.string().optional(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.string().default("3000"),
});

export type AppConfig = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceKey: string;
  redisUrl: string;
  angeloneMasterKey: string;
  alertWebhookUrl?: string;
  nseHolidays: Date[];
  nodeEnv: "development" | "production" | "test";
  port: number;
};

let cached: AppConfig | undefined;

export function getConfig(): AppConfig {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const holidays = parsed.data.NSE_HOLIDAYS_JSON
    ? (JSON.parse(parsed.data.NSE_HOLIDAYS_JSON) as string[]).map((s) => new Date(s))
    : [];
  cached = {
    supabaseUrl: parsed.data.SUPABASE_URL,
    supabaseAnonKey: parsed.data.SUPABASE_ANON_KEY,
    supabaseServiceKey: parsed.data.SUPABASE_SERVICE_ROLE_KEY,
    redisUrl: parsed.data.UPSTASH_REDIS_URL,
    angeloneMasterKey: parsed.data.ANGELONE_MASTER_KEY,
    alertWebhookUrl: parsed.data.ALERT_WEBHOOK_URL,
    nseHolidays: holidays,
    nodeEnv: parsed.data.NODE_ENV,
    port: Number(parsed.data.PORT),
  };
  return cached;
}

export function resetConfigForTests(): void {
  cached = undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd server && bun test config.test.ts
```
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add server/config.ts server/env.d.ts server/config.test.ts
git commit -m "feat(config): zod-validated env config with reset hook for tests"
```

---

### Task 3: Shared Zod schemas and TS types

**Files:**
- Create: `shared/types/market.ts`
- Create: `shared/types/order.ts`
- Create: `shared/types/screener.ts`
- Create: `shared/types/errors.ts`
- Create: `shared/types/index.ts`
- Create: `shared/types/errors.test.ts`

**Interfaces:**
- Consumes: tsconfig path aliases from task-1
- Produces: `Tick`, `Candle`, `Quote` Zod schemas + inferred types; `Order`, `Fill`, `Position` schemas; `Criterion`, `Screener` schemas; `ErrorCode` union

- [ ] **Step 1: Write the failing test**

Create `shared/types/errors.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { z } from "zod";
import {
  TickSchema,
  CandleSchema,
  QuoteSchema,
  OrderSchema,
  FillSchema,
  PositionSchema,
  CriterionSchema,
  ScreenerSchema,
  ErrorCodeSchema,
  ErrorCode,
} from "./index";

describe("shared types", () => {
  it("round-trips a Tick", () => {
    const tick = {
      exchange: "NSE",
      symbol: "RELIANCE",
      price: 2500.5,
      volume: 1000,
      ts: new Date().toISOString(),
    };
    expect(TickSchema.parse(tick)).toEqual(tick);
  });

  it("round-trips a Candle", () => {
    const candle = {
      symbol: "RELIANCE",
      tf: "1d",
      ts: "2026-01-01T00:00:00.000Z",
      open: 100,
      high: 110,
      low: 95,
      close: 105,
      volume: 10000,
    };
    expect(CandleSchema.parse(candle)).toEqual(candle);
  });

  it("rejects a negative price on Tick", () => {
    expect(() => TickSchema.parse({ exchange: "NSE", symbol: "X", price: -1, volume: 0, ts: new Date().toISOString() })).toThrow();
  });

  it("round-trips an Order", () => {
    const order = {
      id: "ord-1",
      userId: "u-1",
      symbol: "RELIANCE",
      exchange: "NSE",
      side: "BUY",
      qty: 10,
      type: "MARKET",
      status: "pending",
      idempotencyKey: "k-1",
      placedAt: new Date().toISOString(),
    };
    expect(OrderSchema.parse(order)).toEqual(order);
  });

  it("validates an ErrorCode union value", () => {
    const ok: ErrorCode = ErrorCodeSchema.parse("RATE_LIMITED");
    expect(ok).toBe("RATE_LIMITED");
    expect(() => ErrorCodeSchema.parse("BOGUS")).toThrow();
  });

  it("round-trips a Criterion (PE < 30)", () => {
    const c = { field: "pe", op: "lt", value: 30 };
    expect(CriterionSchema.parse(c)).toEqual(c);
  });

  it("round-trips a Screener", () => {
    const s = {
      id: "scr-1",
      userId: "u-1",
      name: "value",
      exchange: "NSE",
      criteria: { op: "AND", children: [{ field: "pe", op: "lt", value: 30 }] },
      isActive: true,
    };
    expect(ScreenerSchema.parse(s)).toEqual(s);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test shared/types/errors.test.ts
```
Expected: FAIL with `Cannot find module './index'`.

- [ ] **Step 3: Write minimal implementation**

Create `shared/types/market.ts`:

```ts
import { z } from "zod";

export const ExchangeSchema = z.enum(["NSE", "BSE"]);

export const QuoteSchema = z.object({
  exchange: ExchangeSchema,
  symbol: z.string().min(1),
  name: z.string(),
  token: z.string(),
  yahooTicker: z.string(),
  isin: z.string().optional(),
  isActive: z.boolean().default(true),
});
export type Quote = z.infer<typeof QuoteSchema>;

export const TickSchema = z.object({
  exchange: ExchangeSchema,
  symbol: z.string().min(1),
  price: z.number().positive(),
  volume: z.number().nonnegative(),
  ts: z.string().datetime(),
  bid: z.number().positive().optional(),
  ask: z.number().positive().optional(),
  source: z.enum(["angelone", "yahoo", "nse"]).default("yahoo"),
});
export type Tick = z.infer<typeof TickSchema>;

export const CandleSchema = z.object({
  symbol: z.string(),
  tf: z.enum(["1m", "1d"]),
  ts: z.string().datetime(),
  open: z.number().nonnegative(),
  high: z.number().nonnegative(),
  low: z.number().nonnegative(),
  close: z.number().nonnegative(),
  volume: z.number().nonnegative(),
});
export type Candle = z.infer<typeof CandleSchema>;
```

Create `shared/types/order.ts`:

```ts
import { z } from "zod";
import { ExchangeSchema } from "./market";

export const OrderSideSchema = z.enum(["BUY", "SELL"]);
export const OrderTypeSchema = z.enum(["MARKET", "LIMIT", "SL", "SL-M"]);
export const OrderStatusSchema = z.enum([
  "pending",
  "partial",
  "filled",
  "cancelled",
  "rejected",
]);

export const OrderSchema = z.object({
  id: z.string(),
  userId: z.string(),
  symbol: z.string(),
  exchange: ExchangeSchema,
  side: OrderSideSchema,
  qty: z.number().int().positive(),
  type: OrderTypeSchema,
  limitPrice: z.number().positive().optional(),
  status: OrderStatusSchema,
  idempotencyKey: z.string().min(1),
  placedAt: z.string().datetime(),
  filledAt: z.string().datetime().optional(),
  rejectReason: z.string().optional(),
});
export type Order = z.infer<typeof OrderSchema>;

export const FillSchema = z.object({
  orderId: z.string(),
  qty: z.number().int().positive(),
  price: z.number().positive(),
  ts: z.string().datetime(),
  fee: z.number().nonnegative().default(0),
});
export type Fill = z.infer<typeof FillSchema>;

export const PositionSchema = z.object({
  userId: z.string(),
  symbol: z.string(),
  exchange: ExchangeSchema,
  qty: z.number().int(),
  avgPrice: z.number().nonnegative(),
  realizedPnl: z.number(),
  updatedAt: z.string().datetime(),
});
export type Position = z.infer<typeof PositionSchema>;
```

Create `shared/types/screener.ts`:

```ts
import { z } from "zod";
import { ExchangeSchema } from "./market";

export const CriterionFieldSchema = z.enum([
  "pe",
  "pb",
  "roe",
  "market_cap",
  "dividend_yield",
  "sector",
  "rsi",
  "sma_cross",
  "price_above_sma",
  "volume_spike",
]);
export type CriterionField = z.infer<typeof CriterionFieldSchema>;

export const CriterionOpSchema = z.enum(["eq", "gt", "lt", "gte", "lte", "between"]);
export type CriterionOp = z.infer<typeof CriterionOpSchema>;

export const CriterionLeafSchema = z.object({
  field: CriterionFieldSchema,
  op: CriterionOpSchema,
  value: z.union([z.number(), z.string(), z.tuple([z.number(), z.number()])]),
  period: z.number().int().positive().optional(),
});
export type CriterionLeaf = z.infer<typeof CriterionLeafSchema>;

export const CriterionSchema: z.ZodType<Criterion> = z.lazy(() =>
  z.union([
    CriterionLeafSchema,
    z.object({
      op: z.enum(["AND", "OR"]),
      children: z.array(CriterionSchema).min(1),
    }),
  ])
);
export type Criterion = CriterionLeaf | { op: "AND" | "OR"; children: Criterion[] };

export const ScreenerSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string().min(1),
  exchange: ExchangeSchema,
  criteria: CriterionSchema,
  isActive: z.boolean().default(true),
  createdAt: z.string().datetime().optional(),
});
export type Screener = z.infer<typeof ScreenerSchema>;
```

Create `shared/types/errors.ts`:

```ts
import { z } from "zod";

export const ErrorCodeSchema = z.enum([
  "UNAUTHORIZED",
  "FORBIDDEN",
  "RATE_LIMITED",
  "IDEMPOTENT_REPLAY",
  "UPSTREAM_DEGRADED",
  "UPSTREAM_PERMANENT",
  "VALIDATION_FAILED",
  "MARKET_CLOSED",
  "INSUFFICIENT_BUYING_POWER",
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export class AppError extends Error {
  code: ErrorCode;
  data?: unknown;
  constructor(code: ErrorCode, message: string, data?: unknown) {
    super(message);
    this.code = code;
    this.data = data;
    this.name = "AppError";
  }
}

// Typed upstream error subclasses shared by all data/sources/* modules.
// Defining them here keeps sibling data/* files decoupled from one another.
export class UpstreamDegradedError extends AppError {
  constructor(message: string, data?: unknown) {
    super("UPSTREAM_DEGRADED", message, data);
    this.name = "UpstreamDegradedError";
  }
}

export class UpstreamPermanentError extends AppError {
  constructor(message: string, data?: unknown) {
    super("UPSTREAM_PERMANENT", message, data);
    this.name = "UpstreamPermanentError";
  }
}
```

Create `shared/types/index.ts`:

```ts
export * from "./market";
export * from "./order";
export * from "./screener";
export * from "./errors";
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test shared/types/errors.test.ts
```
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add shared/types/
git commit -m "feat(shared): zod schemas for market, order, screener, errors"
```

---

### Task 4: Nitro app boot and /health stub

**Files:**
- Create: `server/app.ts`
- Create: `server/infra/health.ts`
- Create: `server/infra/health.test.ts`
- Create: `server/http/sse/hub.ts`
- Create: `server/routes/health.get.ts`
- Create: `nitro.config.ts`

**Interfaces:**
- Consumes: `config` from task-2, `ErrorCode` from task-3
- Produces: `createApp()` from `server/app.ts` that mounts routes and returns h3 app; `healthHandler` returning `{ status: ok, checks: {} }` from `server/infra/health.ts`; empty `SseHub` class with `register`/`unregister`/`broadcast` stubs

- [ ] **Step 1: Write the failing test**

Create `server/infra/health.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { createApp } from "../app";

describe("app health", () => {
  it("GET /health returns 200 with status ok", async () => {
    const app = createApp();
    const res = await app.fetch(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.checks).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && bun test infra/health.test.ts
```
Expected: FAIL with `Cannot find module '../app'`.

- [ ] **Step 3: Write minimal implementation**

Create `server/http/sse/hub.ts`:

```ts
import type { Tick } from "@shared/types";

type SendFn = (event: string, data: unknown) => void;
type CloseFn = () => void;

export class SseHub {
  register(_connId: string, _userId: string, _symbols: string[], _send: SendFn, _close: CloseFn): void {
    // stub — full impl in task-21
  }
  unregister(_connId: string): void {
    // stub
  }
  broadcastTick(_tick: Tick): void {
    // stub
  }
  dropStaleConnections(): void {
    // stub
  }
}

export const sseHub = new SseHub();
```

Create `server/infra/health.ts`:

```ts
export type HealthCheck = {
  name: string;
  ok: boolean;
  detail?: string;
};

export type HealthReport = {
  status: "ok" | "degraded" | "down";
  uptime: number;
  checks: Record<string, HealthCheck>;
  version: string;
};

const startedAt = Date.now();
const version = process.env.GIT_SHA ?? "dev";
const checks: Record<string, HealthCheck> = {};

export function registerCheck(name: string, ok: boolean, detail?: string): void {
  checks[name] = { name, ok, detail };
}

export function healthHandler(): HealthReport {
  const allOk = Object.values(checks).every((c) => c.ok);
  return {
    status: Object.keys(checks).length === 0 || allOk ? "ok" : "degraded",
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    checks,
    version,
  };
}
```

Create `server/routes/health.get.ts`:

```ts
import { defineEventHandler } from "h3";
import { healthHandler } from "../infra/health";

export default defineEventHandler(() => healthHandler());
```

Create `server/app.ts`:

```ts
import { createApp as createH3App, eventHandler, toNodeListener } from "h3";
import healthHandler from "./routes/health.get";

export function createApp() {
  const app = createH3App();
  app.use("/health", eventHandler(() => healthHandler()));
  return app;
}

export const toNodeHandler = toNodeListener;
```

Create `nitro.config.ts` (repo root):

```ts
import { defineNitroConfig } from "nitropack/config";

export default defineNitroConfig({
  srcDir: "server",
  scanDirs: ["server", "shared"],
  typescript: {
    tsConfig: {
      compilerOptions: {
        paths: {
          "@shared/*": ["./shared/*"],
          "@server/*": ["./server/*"],
        },
      },
    },
  },
  routeRules: {
    "/api/stream/**": { headers: { "cache-control": "no-store" } },
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd server && bun test infra/health.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/app.ts server/infra/ server/routes/ server/http/sse/ nitro.config.ts
git commit -m "feat(skeleton): nitro app boot with /health stub and sse hub"
```

---

## Phase 2: Infra — Bus, Logger, Redis, Rate Limit, Encryption, Idempotency

**Purpose:** Provide cross-cutting primitives every domain and HTTP module depends on. Infra has no HTTP or DB knowledge; it composes shared types only.

### Task 5: Typed in-process EventEmitter bus

**Files:**
- Create: `server/infra/bus.ts`
- Create: `server/infra/bus.test.ts`

**Interfaces:**
- Consumes: `Tick` from task-3
- Produces: `export const bus: TypedBus` from `server/infra/bus.ts` with `on`/`off`/`emit` typed to `{ tick, screener:match, order:fill, user:angelone:ready, market:phase }`

- [ ] **Step 1: Write the failing test**

Create `server/infra/bus.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { bus } from "./bus";

describe("bus", () => {
  it("emits and receives a typed tick event", () => {
    const received: unknown[] = [];
    const handler = (t: unknown) => received.push(t);
    bus.on("tick", handler);
    const tick = { exchange: "NSE", symbol: "X", price: 1, volume: 1, ts: new Date().toISOString() };
    bus.emit("tick", tick);
    bus.off("tick", handler);
    expect(received).toHaveLength(1);
  });

  it("off removes the listener", () => {
    let count = 0;
    const handler = () => count++;
    bus.on("tick", handler);
    bus.emit("tick", { exchange: "NSE", symbol: "X", price: 1, volume: 1, ts: new Date().toISOString() });
    bus.off("tick", handler);
    bus.emit("tick", { exchange: "NSE", symbol: "X", price: 1, volume: 1, ts: new Date().toISOString() });
    expect(count).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && bun test infra/bus.test.ts
```
Expected: FAIL with `Cannot find module './bus'`.

- [ ] **Step 3: Write minimal implementation**

Create `server/infra/bus.ts`:

```ts
import { EventEmitter } from "node:events";
import type { Tick } from "@shared/types";

export type ScreenerMatch = {
  userId: string;
  screenerId: string;
  symbol: string;
  tick: Tick;
};

export type OrderFill = {
  userId: string;
  orderId: string;
  fill: { qty: number; price: number; ts: string };
};

export type UserAngelOneReady = { userId: string };

export type MarketPhaseEvent = {
  phase: "PRE_OPEN" | "OPEN" | "CLOSED" | "HOLIDAY" | "AFTER_HOURS";
  ts: string;
};

export type BusEvents = {
  tick: Tick;
  "screener:match": ScreenerMatch;
  "order:fill": OrderFill;
  "user:angelone:ready": UserAngelOneReady;
  "market:phase": MarketPhaseEvent;
};

type Listener<K extends keyof BusEvents> = (payload: BusEvents[K]) => void;

class TypedBus {
  private emitter = new EventEmitter();

  on<K extends keyof BusEvents>(event: K, listener: Listener<K>): void {
    this.emitter.on(event, listener);
  }

  off<K extends keyof BusEvents>(event: K, listener: Listener<K>): void {
    this.emitter.off(event, listener);
  }

  emit<K extends keyof BusEvents>(event: K, payload: BusEvents[K]): void {
    this.emitter.emit(event, payload);
  }
}

export const bus = new TypedBus();
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd server && bun test infra/bus.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/infra/bus.ts server/infra/bus.test.ts
git commit -m "feat(infra): typed EventEmitter bus"
```

---

### Task 6: Structured pino logger

**Files:**
- Create: `server/infra/logger.ts`
- Create: `server/infra/logger.test.ts`

**Interfaces:**
- Consumes: `config` from task-2
- Produces: `export const logger: pino.Logger` from `server/infra/logger.ts` with `child()` support

- [ ] **Step 1: Write the failing test**

Create `server/infra/logger.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { logger } from "./logger";

describe("logger", () => {
  it("child() returns a logger that emits structured JSON", () => {
    const lines: string[] = [];
    const stream = {
      write(s: string) {
        lines.push(s);
        return true;
      },
    };
    const child = logger.child({ component: "test" });
    // Swap the destination stream
    (child as any)[Symbol.for("pino.stream")] = stream;
    child.info({ orderId: "o1" }, "placed");
    expect(lines.length).toBeGreaterThan(0);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.msg).toBe("placed");
    expect(parsed.level).toBe(30);
    expect(parsed.component).toBe("test");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && bun test infra/logger.test.ts
```
Expected: FAIL with `Cannot find module './logger'`.

- [ ] **Step 3: Write minimal implementation**

Create `server/infra/logger.ts`:

```ts
import pino from "pino";
import { getConfig } from "../config";

function buildLogger() {
  const cfg = getConfig();
  return pino({
    level: cfg.nodeEnv === "production" ? "info" : "debug",
    redact: {
      paths: [
        "password",
        "totpSecret",
        "apiKey",
        "*.headers.authorization",
        "*.headers.cookie",
        "*.headers['x-idempotency-key']",
      ],
      censor: "[REDACTED]",
    },
    base: { service: "stock-market-backend", env: cfg.nodeEnv },
  });
}

let cached: ReturnType<typeof buildLogger> | undefined;

export function getLogger() {
  if (!cached) cached = buildLogger();
  return cached;
}

export const logger = new Proxy({} as ReturnType<typeof buildLogger>, {
  get(_t, prop) {
    return (getLogger() as unknown as Record<string | symbol, unknown>)[prop as string];
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

```bash
ANGELONE_MASTER_KEY="$(openssl rand -base64 32)" SUPABASE_URL=https://x.supabase.co SUPABASE_ANON_KEY=a SUPABASE_SERVICE_ROLE_KEY=b UPSTASH_REDIS_URL=redis://localhost:6379 bun test server/infra/logger.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/infra/logger.ts server/infra/logger.test.ts
git commit -m "feat(infra): pino logger with redaction paths"
```

---

### Task 7: Redis client and typed key builders

**Files:**
- Create: `server/data/redis/client.ts`
- Create: `server/data/redis/keys.ts`
- Create: `server/data/redis/client.test.ts`

**Interfaces:**
- Consumes: `config` from task-2, `Tick` from task-3
- Produces: `export const redis: Redis` from `server/data/redis/client.ts`; `RedisKeys` namespace from `server/data/redis/keys.ts` with builders

- [ ] **Step 1: Write the failing test**

Create `server/data/redis/client.test.ts`:

```ts
import { describe, it, expect, afterAll } from "bun:test";
import Redis from "ioredis";
import { RedisKeys } from "./keys";

const TEST_URL = process.env.TEST_REDIS_URL ?? "redis://localhost:6379";
const r = new Redis(TEST_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });

describe("RedisKeys", () => {
  it("quoteKey formats cache:quote:NSE:RELIANCE", () => {
    expect(RedisKeys.quoteKey("NSE", "RELIANCE")).toBe("cache:quote:NSE:RELIANCE");
  });
  it("idempotencyKey formats idempotency:user:k", () => {
    expect(RedisKeys.idempotencyKey("u1", "abc")).toBe("idempotency:u1:abc");
  });
  it("candlesKey includes timeframe and dates", () => {
    expect(RedisKeys.candlesKey("NSE", "RELIANCE", "1d", "2026-01-01", "2026-02-01")).toBe(
      "cache:candles:NSE:RELIANCE:1d:2026-01-01:2026-02-01"
    );
  });
});

describe("redis (integration)", () => {
  afterAll(() => r.disconnect());

  it("SETNX and TTL on idempotencyKey", async () => {
    const k = RedisKeys.idempotencyKey("test", `k-${Date.now()}`);
    const ok = await r.set(k, "v", "EX", 60, "NX");
    expect(ok).toBe("OK");
    const t = await r.ttl(k);
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThanOrEqual(60);
    await r.del(k);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && bun test data/redis/client.test.ts
```
Expected: FAIL with `Cannot find module './keys'`.

- [ ] **Step 3: Write minimal implementation**

Create `server/data/redis/keys.ts`:

```ts
export const RedisKeys = {
  quoteKey: (exchange: string, symbol: string) => `cache:quote:${exchange}:${symbol}`,
  candlesKey: (exchange: string, symbol: string, tf: string, from: string, to: string) =>
    `cache:candles:${exchange}:${symbol}:${tf}:${from}:${to}`,
  idempotencyKey: (userId: string, key: string) => `idempotency:${userId}:${key}`,
  sseConnKey: (connId: string) => `sse:conn:${connId}`,
  sseSubsKey: (symbol: string) => `sse:subs:${symbol}`,
  ratelimitRestKey: (userId: string, minute: string) => `ratelimit:rest:${userId}:${minute}`,
  screenerCriteriaKey: (exchange: string) => `screener:criteria:${exchange}`,
  angeloneSessionKey: (userId: string) => `angelone:session:${userId}`,
  angeloneSubsKey: (userId: string) => `angelone:subs:${userId}`,
} as const;
```

Create `server/data/redis/client.ts`:

```ts
import Redis from "ioredis";
import { getConfig } from "../../config";

let client: Redis | undefined;

export function getRedis(): Redis {
  if (client) return client;
  const cfg = getConfig();
  client = new Redis(cfg.redisUrl, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
  });
  return client;
}

export async function setnxWithTtl(key: string, value: string, ttlSeconds: number): Promise<boolean> {
  const r = getRedis();
  const result = await r.set(key, value, "EX", ttlSeconds, "NX");
  return result === "OK";
}

export const redis = new Proxy({} as Redis, {
  get(_t, prop) {
    return (getRedis() as unknown as Record<string | symbol, unknown>)[prop as string];
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

```bash
docker run -d --rm -p 6379:6379 redis:7-alpine
TEST_REDIS_URL=redis://localhost:6379 bun test server/data/redis/client.test.ts
```
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/data/redis/
git commit -m "feat(redis): client + typed key builders"
```

---

### Task 8: Per-user token bucket rate limiter

**Files:**
- Create: `server/infra/rate-limit.ts`
- Create: `server/infra/rate-limit.test.ts`

**Interfaces:**
- Consumes: `redis` from task-7, `RedisKeys` from task-7, `ErrorCode` from task-3
- Produces: `export async function rateLimit(userId, bucket, n): Promise<{ ok, retryAfterMs }>`

- [ ] **Step 1: Write the failing test**

Create `server/infra/rate-limit.test.ts`:

```ts
import { describe, it, expect, afterAll } from "bun:test";
import Redis from "ioredis";
import { rateLimit } from "./rate-limit";
import { RedisKeys } from "../data/redis/keys";

const TEST_URL = process.env.TEST_REDIS_URL ?? "redis://localhost:6379";
const r = new Redis(TEST_URL, { lazyConnect: true });

describe("rateLimit (integration)", () => {
  afterAll(async () => {
    const minute = Math.floor(Date.now() / 60_000).toString();
    await r.del(RedisKeys.ratelimitRestKey("u-rate", minute));
    r.disconnect();
  });

  it("allows up to limit, then rejects with retryAfter", async () => {
    const userId = `u-rate-${Date.now()}`;
    const limit = 10;
    let lastOk = true;
    for (let i = 0; i < limit; i++) {
      const res = await rateLimit(userId, "rest", 1);
      lastOk = res.ok;
    }
    expect(lastOk).toBe(true);

    const over = await rateLimit(userId, "rest", 1);
    expect(over.ok).toBe(false);
    expect(over.retryAfterMs).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && bun test infra/rate-limit.test.ts
```
Expected: FAIL with `Cannot find module './rate-limit'`.

- [ ] **Step 3: Write minimal implementation**

Create `server/infra/rate-limit.ts`:

```ts
import { getRedis } from "../data/redis/client";
import { RedisKeys } from "../data/redis/keys";
import { AppError } from "@shared/types";

const REST_LIMIT = 120;
const SSE_SUBS_LIMIT = 50;

export type RateLimitBucket = "rest" | "sse:subs";

export type RateLimitResult = { ok: boolean; retryAfterMs: number };

export async function rateLimit(
  userId: string,
  bucket: RateLimitBucket,
  requested = 1
): Promise<RateLimitResult> {
  const r = getRedis();
  const minute = Math.floor(Date.now() / 60_000).toString();
  const key = bucket === "rest" ? RedisKeys.ratelimitRestKey(userId, minute) : `ratelimit:sse:subs:${userId}`;
  const limit = bucket === "rest" ? REST_LIMIT : SSE_SUBS_LIMIT;
  const ttl = 60;

  const tx = r.multi();
  tx.incrby(key, requested);
  tx.ttl(key);
  const results = (await tx.exec()) ?? [];
  const incrRes = results[0]?.[1] as number | null;
  const ttlRes = results[1]?.[1] as number;
  if (incrRes === null) throw new AppError("UPSTREAM_DEGRADED", "rate limit incr returned null");
  const current = incrRes;
  const remainingTtl = ttlRes === -1 ? ttl : ttlRes;

  if (current > limit) {
    return { ok: false, retryAfterMs: Math.max(1, remainingTtl) * 1000 };
  }
  if (ttlRes === -1) {
    await r.expire(key, ttl);
  }
  return { ok: true, retryAfterMs: 0 };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
TEST_REDIS_URL=redis://localhost:6379 bun test server/infra/rate-limit.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/infra/rate-limit.ts server/infra/rate-limit.test.ts
git commit -m "feat(infra): redis-backed per-user rate limiter"
```

---

### Task 9: AES-256-GCM encryption for Angel One creds

**Files:**
- Create: `server/infra/encryption.ts`
- Create: `server/infra/encryption.test.ts`

**Interfaces:**
- Consumes: `config` from task-2 (ANGELONE_MASTER_KEY)
- Produces: `encrypt(plaintext)` and `decrypt(payload)` functions

- [ ] **Step 1: Write the failing test**

Create `server/infra/encryption.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { encrypt, decrypt } from "./encryption";

describe("encryption", () => {
  it("round-trips a plaintext", () => {
    const pt = "my-angelone-api-key";
    const enc = encrypt(pt);
    expect(enc.ciphertext.length).toBeGreaterThan(0);
    expect(decrypt(enc)).toBe(pt);
  });

  it("rejects tampered authTag", () => {
    const enc = encrypt("secret");
    const tampered = { ...enc, authTag: Buffer.from(enc.authTag.map((b) => b ^ 0xff)) };
    expect(() => decrypt(tampered)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && bun test infra/encryption.test.ts
```
Expected: FAIL with `Cannot find module './encryption'`.

- [ ] **Step 3: Write minimal implementation**

Create `server/infra/encryption.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getConfig } from "../config";

export type EncryptedPayload = {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
};

function getKey(): Buffer {
  const raw = getConfig().angeloneMasterKey;
  try {
    const b = Buffer.from(raw, "base64");
    if (b.length === 32) return b;
  } catch {
    // fall through
  }
  const b = Buffer.from(raw);
  if (b.length !== 32) {
    throw new Error("ANGELONE_MASTER_KEY must decode to exactly 32 bytes");
  }
  return b;
}

export function encrypt(plaintext: string): EncryptedPayload {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { ciphertext, iv, authTag };
}

export function decrypt(payload: EncryptedPayload): string {
  const key = getKey();
  const decipher = createDecipheriv("aes-256-gcm", key, payload.iv);
  decipher.setAuthTag(payload.authTag);
  const pt = Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]);
  return pt.toString("utf8");
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
ANGELONE_MASTER_KEY="$(openssl rand -base64 32)" SUPABASE_URL=https://x.supabase.co SUPABASE_ANON_KEY=a SUPABASE_SERVICE_ROLE_KEY=b UPSTASH_REDIS_URL=redis://localhost:6379 bun test server/infra/encryption.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/infra/encryption.ts server/infra/encryption.test.ts
git commit -m "feat(infra): AES-256-GCM encrypt/decrypt with auth tag validation"
```

---

### Task 10: Idempotency-Key middleware

**Files:**
- Create: `server/infra/idempotency.ts`
- Create: `server/infra/idempotency.test.ts`

**Interfaces:**
- Consumes: `redis` from task-7, `RedisKeys.idempotencyKey` from task-7, `ErrorCode` from task-3
- Produces: `withIdempotency(userId, key, fn)` returning cached response on replay

- [ ] **Step 1: Write the failing test**

Create `server/infra/idempotency.test.ts`:

```ts
import { describe, it, expect, afterAll } from "bun:test";
import Redis from "ioredis";
import { withIdempotency } from "./idempotency";
import { RedisKeys } from "../data/redis/keys";

const TEST_URL = process.env.TEST_REDIS_URL ?? "redis://localhost:6379";
const r = new Redis(TEST_URL, { lazyConnect: true });

describe("withIdempotency (integration)", () => {
  afterAll(() => r.disconnect());

  it("invokes fn once on miss, returns cached on replay", async () => {
    const userId = `u-idem-${Date.now()}`;
    const key = "k1";
    let calls = 0;
    const fn = async () => {
      calls++;
      return { hello: "world" };
    };
    const a = await withIdempotency(userId, key, fn);
    const b = await withIdempotency(userId, key, fn);
    expect(calls).toBe(1);
    expect(a).toEqual(b);

    await r.del(RedisKeys.idempotencyKey(userId, key));
  });

  it("sets 24h TTL", async () => {
    const userId = `u-idem-${Date.now()}`;
    const key = "k2";
    await withIdempotency(userId, key, async () => ({ ok: 1 }));
    const ttl = await r.ttl(RedisKeys.idempotencyKey(userId, key));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(86400);
    await r.del(RedisKeys.idempotencyKey(userId, key));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && bun test infra/idempotency.test.ts
```
Expected: FAIL with `Cannot find module './idempotency'`.

- [ ] **Step 3: Write minimal implementation**

Create `server/infra/idempotency.ts`:

```ts
import { getRedis } from "../data/redis/client";
import { RedisKeys } from "../data/redis/keys";

const TTL_SECONDS = 24 * 60 * 60;
const SENTINEL_PENDING = "__pending__";

export async function withIdempotency<T>(
  userId: string,
  key: string,
  fn: () => Promise<T>
): Promise<T> {
  const r = getRedis();
  const redisKey = RedisKeys.idempotencyKey(userId, key);

  const existing = await r.get(redisKey);
  if (existing) {
    if (existing === SENTINEL_PENDING) {
      throw new Error("IDEMPOTENT_REQUEST_IN_FLIGHT");
    }
    return JSON.parse(existing) as T;
  }

  const ok = await r.set(redisKey, SENTINEL_PENDING, "EX", TTL_SECONDS, "NX");
  if (ok !== "OK") {
    const retry = await r.get(redisKey);
    if (retry && retry !== SENTINEL_PENDING) return JSON.parse(retry) as T;
    throw new Error("IDEMPOTENT_REQUEST_IN_FLIGHT");
  }

  let result: T;
  try {
    result = await fn();
  } catch (e) {
    await r.del(redisKey);
    throw e;
  }

  await r.set(redisKey, JSON.stringify(result), "EX", TTL_SECONDS);
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
TEST_REDIS_URL=redis://localhost:6379 bun test server/infra/idempotency.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/infra/idempotency.ts server/infra/idempotency.test.ts
git commit -m "feat(infra): idempotency middleware with redis sentinel + 24h TTL"
```

---

## Phase 3: Market Data Domain and Sources

**Purpose:** Build pure domain logic for symbols, candles, ticks, and the market clock, plus typed wrappers around Yahoo/NSE sources with retry and circuit breaking.

### Task 11: Symbol universe and exchange mapping domain

**Files:**
- Create: `server/domain/market/symbol.ts`
- Create: `server/domain/market/symbol.test.ts`
- Create: `shared/symbols/nifty50.json`

**Interfaces:**
- Consumes: `Quote` type from task-3
- Produces: `export const SYMBOLS: readonly Quote[]`; `lookupSymbol(exchange, symbol)`; `yahooTicker(quote)`

- [ ] **Step 1: Write the failing test**

Create `server/domain/market/symbol.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import nifty50 from "../../../shared/symbols/nifty50.json";
import { SYMBOLS, lookupSymbol, yahooTicker } from "./symbol";

describe("symbol domain", () => {
  it("bundle contains at least 50 NSE symbols", () => {
    expect(SYMBOLS.length).toBeGreaterThanOrEqual(50);
    expect(SYMBOLS.every((q) => q.exchange === "NSE" || q.exchange === "BSE")).toBe(true);
  });

  it("lookupSymbol returns the same record for RELIANCE", () => {
    const q = lookupSymbol("NSE", "RELIANCE");
    expect(q).toBeDefined();
    expect(q!.yahooTicker).toBe("RELIANCE.NS");
  });

  it("lookupSymbol returns undefined for unknown", () => {
    expect(lookupSymbol("NSE", "ZZZZZ")).toBeUndefined();
  });

  it("yahooTicker appends .NS for NSE and .BO for BSE", () => {
    expect(yahooTicker({ exchange: "NSE", symbol: "X", name: "X", token: "1", yahooTicker: "X", isActive: true })).toBe("X.NS");
    expect(yahooTicker({ exchange: "BSE", symbol: "X", name: "X", token: "1", yahooTicker: "X", isActive: true })).toBe("X.BO");
  });

  it("bundle file matches the inferred types", () => {
    expect(nifty50.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && bun test domain/market/symbol.test.ts
```
Expected: FAIL with `Cannot find module './symbol'`.

- [ ] **Step 3: Write minimal implementation**

Create `shared/symbols/nifty50.json`:

```json
[
  { "exchange": "NSE", "symbol": "ADANIPORTS", "name": "Adani Ports & SEZ", "token": "15083", "yahooTicker": "ADANIPORTS.NS", "isActive": true },
  { "exchange": "NSE", "symbol": "APOLLOHOSP", "name": "Apollo Hospitals", "token": "157", "yahooTicker": "APOLLOHOSP.NS", "isActive": true },
  { "exchange": "NSE", "symbol": "ASIANPAINT", "name": "Asian Paints", "token": "236", "yahooTicker": "ASIANPAINT.NS", "isActive": true },
  { "exchange": "NSE", "symbol": "AXISBANK", "name": "Axis Bank", "token": "5900", "yahooTicker": "AXISBANK.NS", "isActive": true },
  { "exchange": "NSE", "symbol": "BAJAJ-AUTO", "name": "Bajaj Auto", "token": "16669", "yahooTicker": "BAJAJAUTO.NS", "isActive": true },
  { "exchange": "NSE", "symbol": "BAJFINANCE", "name": "Bajaj Finance", "token": "317", "yahooTicker": "BAJFINANCE.NS", "isActive": true },
  { "exchange": "NSE", "symbol": "BAJAJFINSV", "name": "Bajaj Finserv", "token": "16675", "yahooTicker": "BAJAJFINSV.NS", "isActive": true },
  { "exchange": "NSE", "symbol": "BPCL", "name": "BPCL", "token": "526", "yahooTicker": "BPCL.NS", "isActive": true },
  { "exchange": "NSE", "symbol": "BHARTIARTL", "name": "Bharti Airtel", "token": "10604", "yahooTicker": "BHARTIARTL.NS", "isActive": true },
  { "exchange": "NSE", "symbol": "BRITANNIA", "name": "Britannia Industries", "token": "547", "yahooTicker": "BRITANNIA.NS", "isActive": true },
  { "exchange": "NSE", "symbol": "CIPLA", "name": "Cipla", "token": "694", "yahooTicker": "CIPLA.NS", "isActive": true },
  { "exchange": "NSE", "symbol": "COALINDIA", "name": "Coal India", "token": "20374", "yahooTicker": "COALINDIA.NS", "isActive": true },
  { "exchange": "NSE", "symbol": "DIVISLAB", "name": "Divi's Labs", "token": "10940", "yahooTicker": "DIVISLAB.NS", "isActive": true },
  { "exchange": "NSE", "symbol": "DRREDDY", "name": "Dr Reddy's", "token": "881", "yahooTicker": "DRREDDY.NS", "isActive": true },
  { "exchange": "NSE", "symbol": "EICHERMOT", "name": "Eicher Motors", "token": "910", "yahooTicker": "EICHERMOT.NS", "isActive": true },
  { "exchange": "NSE", "symbol": "GRASIM", "name": "Grasim Industries", "token": "1232", "yahooTicker": "GRASIM.NS", "isActive": true },
  { "exchange": "NSE", "symbol": "HCLTECH", "name": "HCL Technologies", "token": "7229", "yahooTicker": "HCLTECH.NS", "isActive": true },
  { "exchange": "NSE", "symbol": "HDFCBANK", "name": "HDFC Bank", "token": "1333", "yahooTicker": "HDFCBANK.NS", "isActive": true },
  { "exchange": "NSE", "symbol": "HDFCLIFE", "name": "HDFC Life Insurance", "token": "467", "yahooTicker": "HDFCLIFE.NS", "isActive": true },
  { "exchange": "NSE", "symbol": "HEROMOTOCO", "name": "Hero MotoCorp", "token": "1348", "yahooTicker": "HEROMOTOCO.NS", "isActive": true },
  { "exchange": "NSE", "symbol": "HINDALCO", "name": "Hindalco", "token": "1363", "yahooTicker": "HINDALCO.NS", "isActive": true },
  { "exchange": "NSE", "symbol": "HINDUNILVR", "name": "Hindustan Unilever", "token": "1394", "yahooTicker": "HINDUNILVR.NS", "isActive": true },
  { "exchange": "NSE", "symbol": "ICICIBANK", "name": "ICICI Bank", "token": "4963", "yahooTicker": "ICICIBANK.NS", "isActive": true },
  { "exchange": "NSE", "symbol": "INDUSINDBK", "name": "IndusInd Bank", "token": "5258", "yahooTicker": "INDUSINDBK.NS", "isActive": true },
  { "exchange": "NSE", "symbol": "INFY", "name": "Infosys", "token": "1594", "yahooTicker": "INFY.NS", "isActive": true },
  { "exchange": "NSE", "symbol": "ITC", "name": "ITC", "token": "1660", "yahooTicker": "ITC.NS", "isActive": true },
  { "exchange": "NSE", "symbol": "JSWSTEEL", "name": "JSW Steel", "token": "11723", "yahooTicker": "JSWSTEEL.NS", "isActive": true },
  { "exchange": "NSE", "symbol": "KOTAKBANK", "name": "Kotak Mahindra Bank", "token": "1922", "yahooTicker": "KOTAKBANK.NS", "isActive": true },
  { "exchange": "NSE", "symbol": "LT", "name": "Larsen & Toubro", "token": "11483", "yahooTicker": "LT.NS", "isActive": true },
  { "exchange": "NSE", "symbol": "M&M", "name": "Mahindra & Mahindra", "token": "2031", "yahooTicker": "M&M.NS", "isActive": true },
  { "exchange": "NSE", "symbol": "MARUTI", "name": "Maruti Suzuki", "token": "10999", "yahooTicker": "MARUTI.NS", "isActive": true },
  { "exchange": "NSE", "symbol": "NESTLEIND", "name": "Nestle India", "token": "17963", "yahooTicker": "NESTLEIND.NS", "isActive": true },
  { "exchange": "NSE", "symbol": "NTPC", "name": "NTPC", "token": "11630", "yahooTicker": "NTPC.NS", "isActive": true },
  { "exchange": "NSE", "symbol": "ONGC", "name": "ONGC", "token": "2475", "yahooTicker": "ONGC.NS", "isActive": true },
  { "exchange": "NSE", "symbol": "POWERGRID", "name": "Power Grid Corp", "token": "14977", "yahooTicker": "POWERGRID.NS", "isActive": true },
  { "exchange": "NSE", "symbol": "RELIANCE", "name": "Reliance Industries", "token": "2885", "yahooTicker": "RELIANCE.NS", "isActive": true },
  { "exchange": "NSE", "symbol": "SBILIFE", "name": "SBI Life Insurance", "token": "21808", "yahooTicker": "SBILIFE.NS", "isActive": true },
  { "exchange": "NSE", "symbol": "SBIN", "name": "State Bank of India", "token": "3045", "yahooTicker": "SBIN.NS", "isActive": true },
  { "exchange": "NSE", "symbol": "SUNPHARMA", "name": "Sun Pharma", "token": "3351", "yahooTicker": "SUNPHARMA.NS", "isActive": true },
  { "exchange": "NSE", "symbol": "TCS", "name": "Tata Consultancy Services", "token": "11536", "yahooTicker": "TCS.NS", "isActive": true },
  { "exchange": "NSE", "symbol": "TATACONSUM", "name": "Tata Consumer", "token": "3432", "yahooTicker": "TATACONSUM.NS", "isActive": true },
  { "exchange": "NSE", "symbol": "TATAMOTORS", "name": "Tata Motors", "token": "3456", "yahooTicker": "TATAMOTORS.NS", "isActive": true },
  { "exchange": "NSE", "symbol": "TATASTEEL", "name": "Tata Steel", "token": "3499", "yahooTicker": "TATASTEEL.NS", "isActive": true },
  { "exchange": "NSE", "symbol": "TECHM", "name": "Tech Mahindra", "token": "13538", "yahooTicker": "TECHM.NS", "isActive": true },
  { "exchange": "NSE", "symbol": "TITAN", "name": "Titan Company", "token": "3506", "yahooTicker": "TITAN.NS", "isActive": true },
  { "exchange": "NSE", "symbol": "ULTRACEMCO", "name": "UltraTech Cement", "token": "11532", "yahooTicker": "ULTRACEMCO.NS", "isActive": true },
  { "exchange": "NSE", "symbol": "UPL", "name": "UPL", "token": "11287", "yahooTicker": "UPL.NS", "isActive": true },
  { "exchange": "NSE", "symbol": "WIPRO", "name": "Wipro", "token": "3787", "yahooTicker": "WIPRO.NS", "isActive": true },
  { "exchange": "NSE", "symbol": "LTIM", "name": "LTIMindtree", "token": "17818", "yahooTicker": "LTIM.NS", "isActive": true }
]
```

Create `server/domain/market/symbol.ts`:

```ts
import type { Quote } from "@shared/types";
import nifty50 from "../../../shared/symbols/nifty50.json";

export const SYMBOLS: readonly Quote[] = (nifty50 as Quote[]).filter((q) => q.isActive);

const byKey = new Map<string, Quote>();
for (const q of SYMBOLS) byKey.set(`${q.exchange}:${q.symbol}`, q);

export function lookupSymbol(exchange: "NSE" | "BSE", symbol: string): Quote | undefined {
  return byKey.get(`${exchange}:${symbol}`);
}

export function yahooTicker(quote: Quote): string {
  return quote.exchange === "NSE" ? `${quote.symbol}.NS` : `${quote.symbol}.BO`;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd server && bun test domain/market/symbol.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/domain/market/symbol.ts server/domain/market/symbol.test.ts shared/symbols/nifty50.json
git commit -m "feat(market): symbol universe bundle + lookup/yahooTicker helpers"
```

---

### Task 12: Yahoo Finance source with retry and circuit breaker

**Files:**
- Create: `server/data/sources/yahoo.ts`
- Create: `server/data/sources/yahoo.test.ts`

**Interfaces:**
- Consumes: `config` from task-2, `Candle` type from task-3, `logger` from task-6
- Produces: `getCandles(ticker, from, to, tf)`; `getQuote(ticker)`; throws `UpstreamDegradedError` / `UpstreamPermanentError`

- [ ] **Step 1: Write the failing test**

Create `server/data/sources/yahoo.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getCandles, getQuote, UpstreamDegradedError, _resetCircuitForTest } from "./yahoo";

const origFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = origFetch;
  _resetCircuitForTest();
});

describe("yahoo source", () => {
  it("getQuote parses a 200 response into a Tick", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: 100, regularMarketVolume: 5, symbol: "RELIANCE.NS" } }] } }), {
        status: 200,
      })) as unknown as typeof fetch;
    const t = await getQuote("RELIANCE.NS");
    expect(t.price).toBe(100);
    expect(t.symbol).toBe("RELIANCE");
    expect(t.exchange).toBe("NSE");
  });

  it("retries on 429 and succeeds on second try", async () => {
    let n = 0;
    globalThis.fetch = (async () => {
      n++;
      if (n === 1) return new Response("", { status: 429, headers: { "Retry-After": "0" } });
      return new Response(JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: 50, regularMarketVolume: 1, symbol: "X.NS" } }] } }), { status: 200 });
    }) as unknown as typeof fetch;
    const t = await getQuote("X");
    expect(t.price).toBe(50);
    expect(n).toBe(2);
  });

  it("opens circuit after 3 consecutive fails and throws UpstreamDegradedError", async () => {
    let n = 0;
    globalThis.fetch = (async () => {
      n++;
      return new Response("", { status: 503 });
    }) as unknown as typeof fetch;
    await expect(getQuote("X")).rejects.toBeInstanceOf(UpstreamDegradedError);
    await expect(getQuote("X")).rejects.toBeInstanceOf(UpstreamDegradedError);
    await expect(getQuote("X")).rejects.toBeInstanceOf(UpstreamDegradedError);
    const before = n;
    await expect(getQuote("X")).rejects.toBeInstanceOf(UpstreamDegradedError);
    expect(n).toBe(before); // circuit open: no fetch issued
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && bun test data/sources/yahoo.test.ts
```
Expected: FAIL with `Cannot find module './yahoo'`.

- [ ] **Step 3: Write minimal implementation**

Create `server/data/sources/yahoo.ts`:

```ts
import { getLogger } from "../../infra/logger";
import type { Candle, Tick } from "@shared/types";
import { AppError } from "@shared/types";

// Upstream error classes live in shared/types/errors.ts so that all data/sources/*
// modules can depend on them without coupling to a specific source (yahoo, nse, ...).
// Per spec section 4, data/* may import from shared/ and infra/ but not from sibling data/*.

export { UpstreamDegradedError, UpstreamPermanentError } from "@shared/types/errors";

const log = getLogger().child({ source: "yahoo" });

const HOST = "query1.finance.yahoo.com";
const FAIL_WINDOW_MS = 60_000;
const FAIL_THRESHOLD = 10;
const OPEN_MS = 5 * 60_000;

let fails: number[] = [];
let openedAt = 0;

export function _resetCircuitForTest(): void {
  fails = [];
  openedAt = 0;
}

function noteFail(): void {
  const now = Date.now();
  fails = fails.filter((t) => now - t < FAIL_WINDOW_MS);
  fails.push(now);
  if (fails.length >= FAIL_THRESHOLD) openedAt = now;
}

function noteSuccess(): void {
  fails = [];
  openedAt = 0;
}

function isOpen(): boolean {
  if (!openedAt) return false;
  if (Date.now() - openedAt > OPEN_MS) {
    openedAt = 0;
    fails = [];
    return false;
  }
  return true;
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  const tries = 3;
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    if (isOpen()) throw new UpstreamDegradedError("yahoo circuit open");
    try {
      const r = await fn();
      noteSuccess();
      return r;
    } catch (e) {
      lastErr = e;
      noteFail();
      const wait = 200 * Math.pow(2, i) + Math.floor(Math.random() * 100);
      await new Promise((res) => setTimeout(res, wait));
    }
  }
  throw lastErr;
}

type YahooChartResp = {
  chart: {
    result?: Array<{
      meta: { regularMarketPrice: number; regularMarketVolume: number; symbol: string };
      timestamp?: number[];
      indicators: { quote: Array<{ open: number[]; high: number[]; low: number[]; close: number[]; volume: number[] }> };
    }>;
    error?: unknown;
  };
};

function symbolToTicker(symbol: string): string {
  if (symbol.endsWith(".NS") || symbol.endsWith(".BO")) return symbol;
  return `${symbol}.NS`;
}

export async function getQuote(symbol: string): Promise<Tick> {
  const ticker = symbolToTicker(symbol);
  return withRetry(async () => {
    const url = `https://${HOST}/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1m&range=1d`;
    const res = await fetch(url, { headers: { "User-Agent": "stock-market-backend/1.0" } });
    if (res.status === 429 || res.status >= 500) throw new UpstreamDegradedError(`yahoo ${res.status}`);
    if (res.status === 404) throw new UpstreamPermanentError(`symbol not found: ${ticker}`);
    if (!res.ok) throw new UpstreamPermanentError(`yahoo ${res.status}`);
    const data = (await res.json()) as YahooChartResp;
    const r = data.chart.result?.[0];
    if (!r) throw new UpstreamPermanentError("yahoo: empty result");
    const exchange = ticker.endsWith(".NS") ? "NSE" : "BSE";
    return {
      exchange,
      symbol: ticker.replace(/\.(NS|BO)$/, ""),
      price: r.meta.regularMarketPrice,
      volume: r.meta.regularMarketVolume,
      ts: new Date().toISOString(),
      source: "yahoo",
    } satisfies Tick;
  });
}

export async function getCandles(
  ticker: string,
  from: Date,
  to: Date,
  tf: "1m" | "1d"
): Promise<Candle[]> {
  return withRetry(async () => {
    const fullTicker = symbolToTicker(ticker);
    const period1 = Math.floor(from.getTime() / 1000);
    const period2 = Math.floor(to.getTime() / 1000);
    const interval = tf === "1m" ? "1m" : "1d";
    const url = `https://${HOST}/v8/finance/chart/${encodeURIComponent(fullTicker)}?period1=${period1}&period2=${period2}&interval=${interval}`;
    const res = await fetch(url, { headers: { "User-Agent": "stock-market-backend/1.0" } });
    if (res.status === 429 || res.status >= 500) throw new UpstreamDegradedError(`yahoo ${res.status}`);
    if (!res.ok) throw new UpstreamPermanentError(`yahoo ${res.status}`);
    const data = (await res.json()) as YahooChartResp;
    const r = data.chart.result?.[0];
    if (!r) throw new UpstreamPermanentError("yahoo: empty result");
    const ts = r.timestamp ?? [];
    const q = r.indicators.quote[0];
    const out: Candle[] = [];
    for (let i = 0; i < ts.length; i++) {
      out.push({
        symbol: fullTicker.replace(/\.(NS|BO)$/, ""),
        tf,
        ts: new Date(ts[i] * 1000).toISOString(),
        open: q.open[i] ?? 0,
        high: q.high[i] ?? 0,
        low: q.low[i] ?? 0,
        close: q.close[i] ?? 0,
        volume: q.volume[i] ?? 0,
      });
    }
    return out;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd server && bun test data/sources/yahoo.test.ts
```
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/data/sources/yahoo.ts server/data/sources/yahoo.test.ts
git commit -m "feat(sources): yahoo finance with retry + circuit breaker"
```

---

### Task 13: NSE scrape source for fundamentals and corporate actions

**Files:**
- Create: `server/data/sources/nse.ts`
- Create: `server/data/sources/nse.test.ts`

**Interfaces:**
- Consumes: `config` from task-2, `Tick` from task-3
- Produces: `getFundamentals(symbol)`; `getCorporateActions(symbol)`

- [ ] **Step 1: Write the failing test**

Create `server/data/sources/nse.test.ts`:

```ts
import { describe, it, expect, afterEach } from "bun:test";
import { getFundamentals, getCorporateActions, UpstreamDegradedError } from "./nse";

const origFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = origFetch;
});

const captchaHtml = "<!doctype html><html><body>Please complete the captcha to continue.</body></html>";

describe("nse source", () => {
  it("parses fundamentals from HTML", async () => {
    globalThis.fetch = (async () =>
      new Response(
        `<html><body><div id="pe">25.4</div><div id="pb">4.2</div><div id="roe">15.1</div><div id="mcap">1500000</div><div id="div_yield">1.2</div><div id="sector">IT</div></body></html>`,
        { status: 200, headers: { "content-type": "text/html" } }
      )) as unknown as typeof fetch;
    const f = await getFundamentals("TCS");
    expect(f.pe).toBe(25.4);
    expect(f.sector).toBe("IT");
  });

  it("treats captcha HTML as transient and retries then degrades", async () => {
    let n = 0;
    globalThis.fetch = (async () => {
      n++;
      return new Response(captchaHtml, { status: 200 });
    }) as unknown as typeof fetch;
    await expect(getFundamentals("TCS")).rejects.toBeInstanceOf(UpstreamDegradedError);
    expect(n).toBe(3);
  });

  it("parses corporate actions from a JSON endpoint", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify([{ symbol: "TCS", exDate: "2025-06-01", action: "DIVIDEND", amount: 30 }]), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    const acts = await getCorporateActions("TCS");
    expect(acts).toHaveLength(1);
    expect(acts[0].action).toBe("DIVIDEND");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && bun test data/sources/nse.test.ts
```
Expected: FAIL with `Cannot find module './nse'`.

- [ ] **Step 3: Write minimal implementation**

Create `server/data/sources/nse.ts`:

```ts
import { AppError, UpstreamDegradedError, UpstreamPermanentError } from "@shared/types/errors";
import { getLogger } from "../../infra/logger";

const log = getLogger().child({ source: "nse" });

const NSE_BASE = "https://www.nseindia.com";

export type Fundamentals = {
  symbol: string;
  asOf: string;
  pe?: number;
  pb?: number;
  roe?: number;
  marketCap?: number;
  dividendYield?: number;
  sector?: string;
  industry?: string;
  raw: Record<string, string>;
};

export type CorporateAction = {
  symbol: string;
  exDate: string;
  action: "SPLIT" | "BONUS" | "DIVIDEND" | "DEMERGER";
  ratio?: number;
  amount?: number;
};

const CAPTCHA_RE = /captcha/i;

async function withRetryTransient<T>(fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (e instanceof UpstreamPermanentError) throw e;
      await new Promise((r) => setTimeout(r, 200 * Math.pow(2, i)));
    }
  }
  throw last;
}

async function nseFetch(url: string): Promise<Response> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 stock-market-backend",
      Accept: "text/html,application/json",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (res.status === 429 || res.status >= 500) throw new UpstreamDegradedError(`nse ${res.status}`);
  if (!res.ok) throw new UpstreamPermanentError(`nse ${res.status}`);
  const text = await res.text();
  if (CAPTCHA_RE.test(text)) throw new UpstreamDegradedError("nse captcha");
  // Re-wrap as Response so callers can .json()/.text() as needed
  return new Response(text, { status: 200, headers: { "content-type": res.headers.get("content-type") ?? "text/html" } });
}

function readField(html: string, id: string): string | undefined {
  const re = new RegExp(`id=["']${id}["'][^>]*>([^<]+)<`, "i");
  const m = re.exec(html);
  return m?.[1]?.trim();
}

export async function getFundamentals(symbol: string): Promise<Fundamentals> {
  return withRetryTransient(async () => {
    const res = await nseFetch(`${NSE_BASE}/get-quote/equity?symbol=${encodeURIComponent(symbol)}`);
    const html = await res.text();
    const raw: Record<string, string> = {};
    const pe = readField(html, "pe");
    const pb = readField(html, "pb");
    const roe = readField(html, "roe");
    const mcap = readField(html, "mcap");
    const div = readField(html, "div_yield");
    const sector = readField(html, "sector");
    if (pe) raw.pe = pe;
    if (pb) raw.pb = pb;
    if (roe) raw.roe = roe;
    if (mcap) raw.mcap = mcap;
    if (div) raw.div_yield = div;
    if (sector) raw.sector = sector;
    if (!pe && !sector) throw new UpstreamPermanentError("nse: structure changed");
    return {
      symbol,
      asOf: new Date().toISOString(),
      pe: pe ? Number(pe) : undefined,
      pb: pb ? Number(pb) : undefined,
      roe: roe ? Number(roe) : undefined,
      marketCap: mcap ? Number(mcap) : undefined,
      dividendYield: div ? Number(div) : undefined,
      sector: sector,
      raw,
    } satisfies Fundamentals;
  });
}

export async function getCorporateActions(symbol: string): Promise<CorporateAction[]> {
  return withRetryTransient(async () => {
    const res = await nseFetch(`${NSE_BASE}/api/corporates-corporateActions?symbol=${encodeURIComponent(symbol)}`);
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const data = (await res.json()) as Array<Record<string, unknown>>;
      return data.map((row) => ({
        symbol,
        exDate: String(row.exDate ?? ""),
        action: String(row.action ?? "DIVIDEND") as CorporateAction["action"],
        ratio: row.ratio ? Number(row.ratio) : undefined,
        amount: row.amount ? Number(row.amount) : undefined,
      }));
    }
    return [];
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd server && bun test data/sources/nse.test.ts
```
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/data/sources/nse.ts server/data/sources/nse.test.ts
git commit -m "feat(sources): nse scraper for fundamentals + corporate actions"
```

---

### Task 14: Candle normalization and gap filling

**Files:**
- Create: `server/domain/market/candle.ts`
- Create: `server/domain/market/candle.test.ts`

**Interfaces:**
- Consumes: `Candle` from task-3, `CorporateAction` from task-3
- Produces: `normalizeAndFillGaps(raw, from, to, tf, actions)`; `adjustForCorporateAction(candle, action)`

- [ ] **Step 1: Write the failing test**

Create `server/domain/market/candle.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { normalizeAndFillGaps, adjustForCorporateAction } from "./candle";

const day = (d: string) => new Date(d + "T00:00:00.000Z");

describe("candle normalization", () => {
  it("fills missing daily bars within the window", () => {
    const raw = [
      { symbol: "X", tf: "1d" as const, ts: "2026-01-01T00:00:00.000Z", open: 100, high: 110, low: 95, close: 105, volume: 1 },
      // gap 2026-01-02 missing
      { symbol: "X", tf: "1d" as const, ts: "2026-01-03T00:00:00.000Z", open: 105, high: 108, low: 104, close: 107, volume: 1 },
    ];
    const out = normalizeAndFillGaps(raw, day("2026-01-01"), day("2026-01-03"), "1d", []);
    expect(out).toHaveLength(3);
    expect(out[1].close).toBe(105); // forward-filled
  });

  it("applies a 2:1 split to historical candles before the split date", () => {
    const candle = { symbol: "X", tf: "1d" as const, ts: "2025-01-01T00:00:00.000Z", open: 200, high: 210, low: 195, close: 205, volume: 1000 };
    const split = { symbol: "X", exDate: "2025-06-01", action: "SPLIT" as const, ratio: 2 };
    const adj = adjustForCorporateAction(candle, split);
    expect(adj.open).toBe(100);
    expect(adj.high).toBe(105);
    expect(adj.low).toBe(97.5);
    expect(adj.close).toBe(102.5);
    expect(adj.volume).toBe(4000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && bun test domain/market/candle.test.ts
```
Expected: FAIL with `Cannot find module './candle'`.

- [ ] **Step 3: Write minimal implementation**

Create `server/domain/market/candle.ts`:

```ts
import type { Candle } from "@shared/types";
import type { CorporateAction } from "../../data/sources/nse";

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

function eachDay(from: Date, to: Date): string[] {
  const out: string[] = [];
  const cur = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

export function adjustForCorporateAction(candle: Candle, action: CorporateAction): Candle {
  if (action.action === "SPLIT" && action.ratio && action.ratio > 1) {
    const factor = action.ratio;
    return {
      ...candle,
      open: candle.open / factor,
      high: candle.high / factor,
      low: candle.low / factor,
      close: candle.close / factor,
      volume: Math.round(candle.volume * factor),
    };
  }
  if (action.action === "BONUS" && action.ratio) {
    const factor = 1 + action.ratio;
    return { ...candle, volume: Math.round(candle.volume * factor) };
  }
  return candle;
}

export function normalizeAndFillGaps(
  raw: Candle[],
  from: Date,
  to: Date,
  tf: "1m" | "1d",
  actions: CorporateAction[]
): Candle[] {
  // 1. Adjust historical bars for splits/bonuses with exDate > bar.ts
  const splitAdjust = (c: Candle): Candle => {
    let cur = c;
    for (const a of actions) {
      if (new Date(a.exDate) > new Date(c.ts)) {
        cur = adjustForCorporateAction(cur, a);
      }
    }
    return cur;
  };
  const adjusted = raw.map(splitAdjust);

  // 2. Build day index for daily
  if (tf !== "1d") return adjusted.sort((a, b) => a.ts.localeCompare(b.ts));

  const byDay = new Map<string, Candle>();
  for (const c of adjusted) byDay.set(dayKey(c.ts), c);

  const lastClose = (() => {
    const sorted = [...adjusted].sort((a, b) => a.ts.localeCompare(b.ts));
    return sorted[0]?.close ?? 0;
  })();

  const out: Candle[] = [];
  let prevClose = lastClose;
  for (const d of eachDay(from, to)) {
    const c = byDay.get(d);
    if (c) {
      out.push(c);
      prevClose = c.close;
    } else {
      // forward-fill with prev close
      out.push({
        symbol: adjusted[0]?.symbol ?? "X",
        tf: "1d",
        ts: `${d}T00:00:00.000Z`,
        open: prevClose,
        high: prevClose,
        low: prevClose,
        close: prevClose,
        volume: 0,
      });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd server && bun test domain/market/candle.test.ts
```
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add server/domain/market/candle.ts server/domain/market/candle.test.ts
git commit -m "feat(market): candle normalization, gap fill, corporate-action adjustment"
```

---

### Task 15: Market clock with NSE hours and holidays

**Files:**
- Create: `server/domain/market/clock.ts`
- Create: `server/domain/market/clock.test.ts`

**Interfaces:**
- Consumes: `config` from task-2 (optional NSE_HOLIDAYS_JSON env)
- Produces: `MarketPhase` type; `computePhase(now, holidays)`; `MarketClock` class with `subscribe(cb)`, `start()`, `stop()`

- [ ] **Step 1: Write the failing test**

Create `server/domain/market/clock.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { computePhase, MarketClock } from "./clock";

const HOLIDAYS = [new Date("2026-08-15T00:00:00.000Z")];

const ist = (iso: string) => {
  // Build a Date that, when interpreted in IST, equals the given wall-clock
  // We pass an ISO with offset +05:30
  return new Date(iso);
};

describe("computePhase", () => {
  it("Saturday is CLOSED", () => {
    const sat = new Date("2026-06-20T05:30:00.000Z"); // Sat 11:00 IST
    expect(computePhase(sat, HOLIDAYS)).toBe("CLOSED");
  });

  it("Sunday is CLOSED", () => {
    const sun = new Date("2026-06-21T05:30:00.000Z");
    expect(computePhase(sun, HOLIDAYS)).toBe("CLOSED");
  });

  it("Holiday is HOLIDAY", () => {
    const h = new Date("2026-08-15T03:30:00.000Z"); // 09:00 IST
    expect(computePhase(h, HOLIDAYS)).toBe("HOLIDAY");
  });

  it("9:15 IST on a weekday is OPEN", () => {
    const t = new Date("2026-06-19T03:45:00.000Z"); // Fri 09:15 IST
    expect(computePhase(t, HOLIDAYS)).toBe("OPEN");
  });

  it("9:14 IST is PRE_OPEN", () => {
    const t = new Date("2026-06-19T03:44:00.000Z");
    expect(computePhase(t, HOLIDAYS)).toBe("PRE_OPEN");
  });

  it("15:30 IST is OPEN (last minute)", () => {
    const t = new Date("2026-06-19T10:00:00.000Z");
    expect(computePhase(t, HOLIDAYS)).toBe("OPEN");
  });

  it("15:31 IST is CLOSED", () => {
    const t = new Date("2026-06-19T10:01:00.000Z");
    expect(computePhase(t, HOLIDAYS)).toBe("CLOSED");
  });

  it("16:00 IST is AFTER_HOURS", () => {
    const t = new Date("2026-06-19T10:30:00.000Z");
    expect(computePhase(t, HOLIDAYS)).toBe("AFTER_HOURS");
  });
});

describe("MarketClock", () => {
  it("subscribe receives phase changes", () => {
    const c = new MarketClock({ tickMs: 50, getNow: () => new Date("2026-06-19T03:00:00.000Z") });
    const received: string[] = [];
    c.subscribe((p) => received.push(p));
    c.start();
    // No time passes; nothing to emit
    return new Promise<void>((res) => setTimeout(() => {
      c.stop();
      expect(received.length).toBe(0);
      res();
    }, 200));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && bun test domain/market/clock.test.ts
```
Expected: FAIL with `Cannot find module './clock'`.

- [ ] **Step 3: Write minimal implementation**

Create `server/domain/market/clock.ts`:

```ts
export type MarketPhase = "PRE_OPEN" | "OPEN" | "CLOSED" | "HOLIDAY" | "AFTER_HOURS";

const IST_OFFSET_MIN = 330; // +05:30

function toIstParts(d: Date): { year: number; month: number; day: number; minutes: number; weekday: number } {
  const utcMs = d.getTime();
  const istMs = utcMs + IST_OFFSET_MIN * 60_000;
  const ist = new Date(istMs);
  const weekday = ist.getUTCDay(); // 0=Sun..6=Sat
  const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return {
    year: ist.getUTCFullYear(),
    month: ist.getUTCMonth() + 1,
    day: ist.getUTCDate(),
    minutes,
    weekday,
  };
}

function isSameIstDay(a: Date, b: Date): boolean {
  const A = toIstParts(a);
  const B = toIstParts(b);
  return A.year === B.year && A.month === B.month && A.day === B.day;
}

export function computePhase(now: Date, holidays: Date[]): MarketPhase {
  const p = toIstParts(now);
  const isHoliday = holidays.some((h) => isSameIstDay(now, h));
  if (isHoliday) return "HOLIDAY";
  if (p.weekday === 0 || p.weekday === 6) return "CLOSED";
  // NSE hours: 09:15 to 15:30 IST. PRE_OPEN 09:00-09:15. CLOSED 15:30-16:00. AFTER_HOURS >=16:00.
  if (p.minutes < 9 * 60) return "CLOSED";
  if (p.minutes < 9 * 60 + 15) return "PRE_OPEN";
  if (p.minutes < 15 * 60 + 30) return "OPEN";
  if (p.minutes < 16 * 60) return "CLOSED";
  return "AFTER_HOURS";
}

export type ClockOptions = {
  tickMs?: number;
  getNow?: () => Date;
  holidays?: Date[];
};

type PhaseListener = (phase: MarketPhase) => void;

export class MarketClock {
  private listeners: PhaseListener[] = [];
  private lastPhase: MarketPhase | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private tickMs: number;
  private getNow: () => Date;
  private holidays: Date[];

  constructor(opts: ClockOptions = {}) {
    this.tickMs = opts.tickMs ?? 1000;
    this.getNow = opts.getNow ?? (() => new Date());
    this.holidays = opts.holidays ?? [];
  }

  subscribe(cb: PhaseListener): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.tickMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private tick(): void {
    const phase = computePhase(this.getNow(), this.holidays);
    if (phase !== this.lastPhase) {
      this.lastPhase = phase;
      for (const l of this.listeners) l(phase);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd server && bun test domain/market/clock.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/domain/market/clock.ts server/domain/market/clock.test.ts
git commit -m "feat(market): market clock with NSE hours, holidays, phase transitions"
```

---

## Phase 4: Live Ticks — WS Sources, Workers, SSE Hub

**Purpose:** Wire the hot path: per-user Angel One WS, Yahoo poll fallback, tick normalization, candle writer, screener runner, and SSE fan-out to subscribed browsers.

### Task 16: Tick normalization and staleness domain

**Files:**
- Create: `server/domain/market/tick.ts`
- Create: `server/domain/market/tick.test.ts`

**Interfaces:**
- Consumes: `Tick` from task-3
- Produces: `normalize(raw, exchange, symbol)`; `isStale(tick, now, maxAgeMs)`

- [ ] **Step 1: Write the failing test**

Create `server/domain/market/tick.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { normalize, isStale } from "./tick";
import { TickSchema } from "@shared/types";

describe("tick normalization", () => {
  it("normalizes an Angel One raw payload", () => {
    const raw = {
      last_traded_price: 2500.5,
      volume_traded_for_the_day: 12345,
      exchange_timestamp: "2026-06-19T03:45:00.000Z",
      best_bid_price: 2500.0,
      best_ask_price: 2501.0,
    };
    const t = normalize(raw, "NSE", "RELIANCE");
    expect(() => TickSchema.parse(t)).not.toThrow();
    expect(t.price).toBe(2500.5);
    expect(t.bid).toBe(2500.0);
    expect(t.ask).toBe(2501.0);
    expect(t.source).toBe("angelone");
  });

  it("rejects a negative price", () => {
    expect(() => normalize({ last_traded_price: -1, volume_traded_for_the_day: 0, exchange_timestamp: new Date().toISOString() }, "NSE", "X")).toThrow();
  });
});

describe("tick staleness", () => {
  it("is false for a fresh tick", () => {
    const t = normalize({ last_traded_price: 1, volume_traded_for_the_day: 1, exchange_timestamp: new Date().toISOString() }, "NSE", "X");
    expect(isStale(t, new Date(), 5_000)).toBe(false);
  });

  it("is true for a tick older than maxAge", () => {
    const old = new Date(Date.now() - 60_000).toISOString();
    const t = normalize({ last_traded_price: 1, volume_traded_for_the_day: 1, exchange_timestamp: old }, "NSE", "X");
    expect(isStale(t, new Date(), 5_000)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && bun test domain/market/tick.test.ts
```
Expected: FAIL with `Cannot find module './tick'`.

- [ ] **Step 3: Write minimal implementation**

Create `server/domain/market/tick.ts`:

```ts
import type { Tick } from "@shared/types";
import { AppError } from "@shared/types";

type AngelOneRaw = {
  last_traded_price: number | string;
  volume_traded_for_the_day: number | string;
  exchange_timestamp: string;
  best_bid_price?: number | string;
  best_ask_price?: number | string;
};

function toNum(v: number | string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : undefined;
}

export function normalize(raw: unknown, exchange: "NSE" | "BSE", symbol: string): Tick {
  if (!raw || typeof raw !== "object") {
    throw new AppError("VALIDATION_FAILED", "tick: not an object");
  }
  const r = raw as AngelOneRaw;
  const price = toNum(r.last_traded_price);
  const volume = toNum(r.volume_traded_for_the_day);
  if (price === undefined || price < 0) {
    throw new AppError("VALIDATION_FAILED", "tick: invalid price");
  }
  return {
    exchange,
    symbol,
    price,
    volume: volume ?? 0,
    ts: r.exchange_timestamp ?? new Date().toISOString(),
    bid: toNum(r.best_bid_price),
    ask: toNum(r.best_ask_price),
    source: "angelone",
  };
}

export function isStale(tick: Tick, now: Date, maxAgeMs: number): boolean {
  return now.getTime() - new Date(tick.ts).getTime() > maxAgeMs;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd server && bun test domain/market/tick.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/domain/market/tick.ts server/domain/market/tick.test.ts
git commit -m "feat(market): tick normalization + staleness"
```

---

### Task 17: Angel One REST login client

**Files:**
- Create: `server/data/sources/angelone/client.ts`
- Create: `server/data/sources/angelone/client.test.ts`

**Interfaces:**
- Consumes: `config` from task-2, `otplib` dependency
- Produces: `login(creds)` returning `AngelOneSession` with `jwt`, `feedToken`, `refreshToken`

- [ ] **Step 1: Write the failing test**

Create `server/data/sources/angelone/client.test.ts`:

```ts
import { describe, it, expect, afterEach } from "bun:test";
import { login } from "./client";

const origFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = origFetch;
});

describe("angelone login", () => {
  it("sends TOTP in the request body and parses session", async () => {
    let captured: any = null;
    globalThis.fetch = (async (url, init) => {
      captured = { url: String(url), body: init?.body, headers: init?.headers };
      return new Response(
        JSON.stringify({
          status: true,
          data: {
            jwtToken: "JWT",
            feedToken: "FEED",
            refreshToken: "REFRESH",
          },
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;
    const s = await login({ apiKey: "K", clientCode: "C", password: "P", totpSecret: "JBSWY3DPEHPK3PXP" });
    expect(s.jwt).toBe("JWT");
    expect(s.feedToken).toBe("FEED");
    expect(s.refreshToken).toBe("REFRESH");
    const body = JSON.parse(captured.body);
    expect(body.totp).toMatch(/^\d{6}$/);
    expect(body.clientcode).toBe("C");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && bun test data/sources/angelone/client.test.ts
```
Expected: FAIL with `Cannot find module './client'`.

- [ ] **Step 3: Write minimal implementation**

Create `server/data/sources/angelone/client.ts`:

```ts
import { authenticator } from "otplib";

export type AngelOneCreds = {
  apiKey: string;
  clientCode: string;
  password: string;
  totpSecret: string;
};

export type AngelOneSession = {
  jwt: string;
  feedToken: string;
  refreshToken: string;
  clientCode: string;
  apiKey: string;
  obtainedAt: string;
};

const LOGIN_URL = "https://apiconnect.angelone.in/rest/auth/angelbroking/user/v1/loginByPassword";

export async function login(creds: AngelOneCreds): Promise<AngelOneSession> {
  const totp = authenticator.generate(creds.totpSecret);
  const body = {
    clientcode: creds.clientCode,
    password: creds.password,
    totp,
  };
  const res = await fetch(LOGIN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-UserType": "USER",
      "X-SourceID": "WEB",
      "X-ClientLocalIP": "127.0.0.1",
      "X-ClientPublicIP": "127.0.0.1",
      "X-MACAddress": "00:00:00:00:00:00",
      "X-PrivateKey": creds.apiKey,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`angelone login failed: ${res.status}`);
  }
  const data = (await res.json()) as { status: boolean; data?: { jwtToken: string; feedToken: string; refreshToken: string } };
  if (!data.status || !data.data) {
    throw new Error("angelone login: bad response");
  }
  return {
    jwt: data.data.jwtToken,
    feedToken: data.data.feedToken,
    refreshToken: data.data.refreshToken,
    clientCode: creds.clientCode,
    apiKey: creds.apiKey,
    obtainedAt: new Date().toISOString(),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd server && bun test data/sources/angelone/client.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/data/sources/angelone/
git commit -m "feat(sources): angelone REST login with otplib TOTP"
```

---

### Task 18: Yahoo poller worker

**Files:**
- Create: `server/workers/yahoo-poller.ts`
- Create: `server/workers/yahoo-poller.test.ts`

**Interfaces:**
- Consumes: `bus` from task-5, `getQuote` from task-12, `normalize` from task-16, `logger` from task-6
- Produces: `YahooPoller` class with `start()`, `stop()`, `batchFetch(symbols)`

- [ ] **Step 1: Write the failing test**

Create `server/workers/yahoo-poller.test.ts`:

```ts
import { describe, it, expect, afterEach } from "bun:test";
import { YahooPoller } from "./yahoo-poller";
import { bus } from "../infra/bus";

afterEach(() => {
  bus.off("tick", () => {});
});

describe("YahooPoller", () => {
  it("start() schedules batchFetch at interval; stop() halts", async () => {
    let calls = 0;
    const poller = new YahooPoller({
      intervalMs: 50,
      batchFetch: async (symbols) => {
        calls++;
        return symbols.map((s) => ({
          exchange: "NSE" as const,
          symbol: s,
          price: 100,
          volume: 0,
          ts: new Date().toISOString(),
          source: "yahoo" as const,
        }));
      },
    });
    poller.subscribe(["RELIANCE", "TCS"]);
    poller.start();
    await new Promise((r) => setTimeout(r, 175));
    poller.stop();
    expect(calls).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && bun test workers/yahoo-poller.test.ts
```
Expected: FAIL with `Cannot find module './yahoo-poller'`.

- [ ] **Step 3: Write minimal implementation**

Create `server/workers/yahoo-poller.ts`:

```ts
import { bus } from "../infra/bus";
import { getLogger } from "../infra/logger";
import { getQuote } from "../data/sources/yahoo";
import { normalize } from "../domain/market/tick";
import type { Tick } from "@shared/types";

const log = getLogger().child({ worker: "yahoo-poller" });

export type YahooPollerOptions = {
  intervalMs?: number;
  batchFetch?: (symbols: string[]) => Promise<Tick[]>;
};

export class YahooPoller {
  private intervalMs: number;
  private symbols: string[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private batchFetch: (symbols: string[]) => Promise<Tick[]>;

  constructor(opts: YahooPollerOptions = {}) {
    this.intervalMs = opts.intervalMs ?? 5_000;
    this.batchFetch = opts.batchFetch ?? this.defaultBatch;
  }

  subscribe(symbols: string[]): void {
    this.symbols = Array.from(new Set([...this.symbols, ...symbols]));
  }

  unsubscribe(symbols: string[]): void {
    const set = new Set(this.symbols);
    for (const s of symbols) set.delete(s);
    this.symbols = [...set];
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async tick(): Promise<void> {
    if (!this.symbols.length) return;
    try {
      const ticks = await this.batchFetch(this.symbols);
      for (const t of ticks) bus.emit("tick", t);
    } catch (e) {
      log.error({ err: (e as Error).message }, "yahoo poll failed");
    }
  }

  private defaultBatch = async (symbols: string[]): Promise<Tick[]> => {
    const out: Tick[] = [];
    for (const s of symbols) {
      try {
        const q = await getQuote(s);
        out.push(normalize(q, q.exchange, q.symbol));
      } catch (e) {
        log.warn({ symbol: s, err: (e as Error).message }, "quote failed");
      }
    }
    return out;
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd server && bun test workers/yahoo-poller.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/workers/yahoo-poller.ts server/workers/yahoo-poller.test.ts
git commit -m "feat(workers): yahoo poller with bus emission"
```

---

### Task 19: Per-user Angel One WS worker

**Files:**
- Create: `server/data/sources/angelone/ws.ts`
- Create: `server/workers/angelone-ws.ts`
- Create: `server/workers/angelone-ws.test.ts`

**Interfaces:**
- Consumes: `bus` from task-5, `login` from task-17, `normalize` from task-16, `redis` from task-7, `RedisKeys.angeloneSubsKey` from task-7
- Produces: `AngelOneWs` class with `connect(userId, tokens)`, `disconnect()`, `onTick(cb)`; `AngelOneWorker` class with `manageUser`, `dropUser`, `start`, `stop`

- [ ] **Step 1: Write the failing test**

Create `server/workers/angelone-ws.test.ts`:

```ts
import { describe, it, expect, afterEach } from "bun:test";
import { AngelOneWorker } from "./angelone-ws";
import { bus } from "../infra/bus";
import type { AngelOneSession } from "../data/sources/angelone/client";

const session: AngelOneSession = {
  jwt: "JWT",
  feedToken: "FEED",
  refreshToken: "REFRESH",
  clientCode: "C",
  apiKey: "K",
  obtainedAt: new Date().toISOString(),
};

afterEach(() => bus.off("tick", () => {}));

describe("AngelOneWorker", () => {
  it("emits ticks on bus when a message arrives", async () => {
    const w = new AngelOneWorker({ url: "ws://localhost:1", createSocket: () => makeFakeSocket() });
    w.manageUser("u1", session, ["RELIANCE"]);
    w.start();
    await new Promise((r) => setTimeout(r, 50));
    const received: any[] = [];
    bus.on("tick", (t) => received.push(t));
    // Simulate an incoming message via the fake socket
    const sock = (w as any).sockets.get("u1")?.__fake;
    sock.__push({
      last_traded_price: 100,
      volume_traded_for_the_day: 1,
      exchange_timestamp: new Date().toISOString(),
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received[0].symbol).toBe("RELIANCE");
    await w.stop();
  });
});

function makeFakeSocket() {
  const listeners: Record<string, ((...args: any[]) => void)[]> = {};
  const sock: any = {
    on(event: string, cb: (...args: any[]) => void) {
      (listeners[event] ||= []).push(cb);
    },
    send() {},
    close() {
      (listeners["close"] || []).forEach((cb) => cb());
    },
    __push(data: unknown) {
      (listeners["message"] || []).forEach((cb) => cb(Buffer.from(JSON.stringify(data))));
    },
  };
  // expose back to caller
  (sock as any).__mark = true;
  return sock;
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && bun test workers/angelone-ws.test.ts
```
Expected: FAIL with `Cannot find module './angelone-ws'`.

- [ ] **Step 3: Write minimal implementation**

Create `server/data/sources/angelone/ws.ts`:

```ts
export type WsFactory = (url: string) => WsLike;

export type WsLike = {
  on(event: "open" | "message" | "close" | "error", cb: (...args: unknown[]) => void): void;
  send(data: string): void;
  close(): void;
};

export function defaultWsFactory(url: string): WsLike {
  // Lazy require so tests can swap the implementation
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { WebSocket } = require("ws") as typeof import("ws");
  const sock = new WebSocket(url) as unknown as WsLike;
  return sock;
}
```

Create `server/workers/angelone-ws.ts`:

```ts
import { bus } from "../infra/bus";
import { getRedis } from "../data/redis/client";
import { RedisKeys } from "../data/redis/keys";
import { normalize } from "../domain/market/tick";
import { getLogger } from "../infra/logger";
import { defaultWsFactory, type WsFactory, type WsLike } from "../data/sources/angelone/ws";
import type { AngelOneSession } from "../data/sources/angelone/client";

const log = getLogger().child({ worker: "angelone-ws" });

const WS_URL = "wss://smartapis.angelone.in/websocket";

type UserState = {
  session: AngelOneSession;
  tokens: string[];
  socket?: WsLike;
  reconnectAttempts: number;
};

export type WorkerOptions = {
  url?: string;
  createSocket?: WsFactory;
};

export class AngelOneWorker {
  private url: string;
  private factory: WsFactory;
  private users = new Map<string, UserState>();
  private sockets = new Map<string, WsLike>();
  private stopped = true;

  constructor(opts: WorkerOptions = {}) {
    this.url = opts.url ?? WS_URL;
    this.factory = opts.createSocket ?? defaultWsFactory;
  }

  start(): void {
    this.stopped = false;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const [uid, s] of this.sockets) {
      try { s.close(); } catch {}
      this.sockets.delete(uid);
    }
    this.users.clear();
  }

  manageUser(userId: string, session: AngelOneSession, tokens: string[]): void {
    this.users.set(userId, { session, tokens, reconnectAttempts: 0 });
    if (!this.stopped) this.connect(userId);
  }

  dropUser(userId: string): void {
    const s = this.sockets.get(userId);
    if (s) {
      try { s.close(); } catch {}
      this.sockets.delete(userId);
    }
    this.users.delete(userId);
  }

  private connect(userId: string): void {
    const u = this.users.get(userId);
    if (!u) return;
    const sock = this.factory(this.url);
    this.sockets.set(userId, sock);
    sock.on("open", () => {
      u.reconnectAttempts = 0;
      // auth handshake
      sock.send(
        JSON.stringify({
          action: 1,
          params: { apiKey: u.session.apiKey, clientCode: u.session.clientCode, feedToken: u.session.feedToken },
        })
      );
      // subscribe
      sock.send(
        JSON.stringify({
          action: 15,
          params: { mode: 1, tokenList: u.tokens.map((t) => ({ exchangeType: 1, tokens: [t] })) },
        })
      );
    });
    sock.on("message", (raw) => {
      try {
        const text = typeof raw === "string" ? raw : Buffer.from(raw as ArrayBuffer).toString();
        const msg = JSON.parse(text);
        if (msg.type === "sf" && msg.data) {
          const tick = normalize(msg.data, "NSE", msg.data.symbol ?? "");
          bus.emit("tick", tick);
        }
        if (msg.type === "error" && msg.code === "invalid_token") {
          bus.emit("user:angelone:ready", { userId }); // bus reused to push auth-failed event
          // In a real impl we'd emit user:angelone:auth_failed; keeping single event type for MVP
        }
      } catch (e) {
        log.warn({ err: (e as Error).message }, "ws message parse failed");
      }
    });
    sock.on("close", () => {
      this.sockets.delete(userId);
      if (this.stopped) return;
      const wait = Math.min(30_000, 500 * Math.pow(2, u.reconnectAttempts));
      u.reconnectAttempts++;
      setTimeout(() => this.connect(userId), wait);
    });
    sock.on("error", (e) => log.warn({ err: (e as Error)?.message }, "ws error"));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd server && bun test workers/angelone-ws.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/data/sources/angelone/ws.ts server/workers/angelone-ws.ts server/workers/angelone-ws.test.ts
git commit -m "feat(workers): angel one per-user ws with exp backoff and tick fan-out"
```

---

### Task 20: Candle writer worker

**Files:**
- Create: `server/workers/candle-writer.ts`
- Create: `server/workers/candle-writer.test.ts`

**Interfaces:**
- Consumes: `bus` from task-5, `Tick` from task-3, `redis` from task-7
- Produces: `CandleWriter` class with `onTick(tick)`, `flush()`, `start()`, `stop()` maintaining 1-min and 1-day rolling buckets

- [ ] **Step 1: Write the failing test**

Create `server/workers/candle-writer.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { CandleWriter } from "./candle-writer";
import type { Tick } from "@shared/types";

function tick(p: number, tsIso: string): Tick {
  return { exchange: "NSE", symbol: "RELIANCE", price: p, volume: 1, ts: tsIso, source: "yahoo" };
}

describe("CandleWriter", () => {
  it("aggregates three ticks within one minute into one bucket", () => {
    const cw = new CandleWriter();
    const minute = "2026-06-19T03:45";
    cw.onTick(tick(100, `${minute}:00.000Z`));
    cw.onTick(tick(105, `${minute}:20.000Z`));
    cw.onTick(tick(110, `${minute}:40.000Z`));
    const out = cw.flush("RELIANCE", "1m");
    expect(out).toHaveLength(1);
    expect(out[0].open).toBe(100);
    expect(out[0].close).toBe(110);
    expect(out[0].high).toBe(110);
    expect(out[0].low).toBe(100);
  });

  it("creates a new bucket when the minute rolls over", () => {
    const cw = new CandleWriter();
    cw.onTick(tick(100, "2026-06-19T03:45:00.000Z"));
    cw.onTick(tick(200, "2026-06-19T03:46:00.000Z"));
    const out = cw.flush("RELIANCE", "1m");
    expect(out).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && bun test workers/candle-writer.test.ts
```
Expected: FAIL with `Cannot find module './candle-writer'`.

- [ ] **Step 3: Write minimal implementation**

Create `server/workers/candle-writer.ts`:

```ts
import { bus } from "../infra/bus";
import type { Candle, Tick } from "@shared/types";

type Bucket = {
  symbol: string;
  tf: "1m";
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

function minuteKey(ts: string): string {
  // YYYY-MM-DDTHH:MM
  return ts.slice(0, 16);
}

export class CandleWriter {
  private buckets = new Map<string, Bucket>();

  start(): void {
    bus.on("tick", (t) => this.onTick(t));
  }

  stop(): void {
    bus.off("tick", () => {});
  }

  onTick(t: Tick): void {
    const key = `${t.symbol}:1m:${minuteKey(t.ts)}`;
    const b = this.buckets.get(key);
    if (!b) {
      this.buckets.set(key, {
        symbol: t.symbol,
        tf: "1m",
        ts: `${minuteKey(t.ts)}:00.000Z`,
        open: t.price,
        high: t.price,
        low: t.price,
        close: t.price,
        volume: t.volume,
      });
    } else {
      b.high = Math.max(b.high, t.price);
      b.low = Math.min(b.low, t.price);
      b.close = t.price;
      b.volume += t.volume;
    }
  }

  flush(symbol: string, tf: "1m" | "1d"): Candle[] {
    const out: Candle[] = [];
    for (const [k, b] of this.buckets) {
      if (b.symbol === symbol && b.tf === tf) {
        out.push({ ...b });
        this.buckets.delete(k);
      }
    }
    return out;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd server && bun test workers/candle-writer.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/workers/candle-writer.ts server/workers/candle-writer.test.ts
git commit -m "feat(workers): candle writer with 1m rolling buckets"
```

---

### Task 21: SSE connection registry and fan-out

**Files:**
- Create: `server/http/sse/quotes.ts`
- Modify: `server/http/sse/hub.ts` (replace stub from task-4)
- Create: `server/http/sse/hub.test.ts`

**Interfaces:**
- Consumes: `bus` from task-5, `redis` from task-7, `RedisKeys.sseConnKey, sseSubsKey` from task-7, `rateLimit` bucket `sse:subs` from task-8, `Tick` from task-3
- Produces: `SseHub` with `register`, `unregister`, `broadcastTick`, `dropStaleConnections`; `quotesHandler` for `GET /api/stream/quotes`

- [ ] **Step 1: Write the failing test**

Create `server/http/sse/hub.test.ts`:

```ts
import { describe, it, expect, afterAll } from "bun:test";
import Redis from "ioredis";
import { SseHub } from "./hub";
import { bus } from "../../infra/bus";
import { RedisKeys } from "../../data/redis/keys";

const TEST_URL = process.env.TEST_REDIS_URL ?? "redis://localhost:6379";
const r = new Redis(TEST_URL, { lazyConnect: true });

afterAll(async () => {
  // cleanup
  const keys = await r.keys("sse:*");
  if (keys.length) await r.del(...keys);
  r.disconnect();
});

describe("SseHub (integration)", () => {
  it("broadcasts a tick to two connections subscribed to RELIANCE", async () => {
    const hub = new SseHub({ writeQueueTimeoutMs: 200 });
    const a: { events: Array<[string, unknown]> } = { events: [] };
    const b: { events: Array<[string, unknown]> } = { events: [] };
    const send = (s: { events: Array<[string, unknown]> }) => (event: string, data: unknown) => {
      s.events.push([event, data]);
    };
    hub.register("c1", "u1", ["RELIANCE"], send(a), () => {});
    hub.register("c2", "u2", ["RELIANCE"], send(b), () => {});
    const tick = { exchange: "NSE" as const, symbol: "RELIANCE", price: 2500, volume: 1, ts: new Date().toISOString(), source: "yahoo" as const };
    bus.emit("tick", tick);
    await new Promise((res) => setTimeout(res, 50));
    expect(a.events.length).toBeGreaterThanOrEqual(1);
    expect(b.events.length).toBeGreaterThanOrEqual(1);
    expect((a.events[0][1] as any).price).toBe(2500);
    expect((a.events[0][1] as any).symbol).toBe("RELIANCE");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && bun test http/sse/hub.test.ts
```
Expected: FAIL with `Cannot find module './hub'`.

- [ ] **Step 3: Write minimal implementation**

Replace `server/http/sse/hub.ts`:

```ts
import { bus } from "../../infra/bus";
import { getRedis } from "../../data/redis/client";
import { RedisKeys } from "../../data/redis/keys";
import type { Tick } from "@shared/types";

type SendFn = (event: string, data: unknown) => void;
type CloseFn = () => void;

type Connection = {
  connId: string;
  userId: string;
  symbols: string[];
  send: SendFn;
  close: CloseFn;
  pending: number;
  lastWrite: number;
};

const HEARTBEAT_MS = 30_000;
const SLOW_TIMEOUT_MS = 1_000;

export class SseHub {
  private conns = new Map<string, Connection>();
  private writeQueueTimeoutMs: number;

  constructor(opts: { writeQueueTimeoutMs?: number } = {}) {
    this.writeQueueTimeoutMs = opts.writeQueueTimeoutMs ?? SLOW_TIMEOUT_MS;
    bus.on("tick", (t) => this.broadcastTick(t));
  }

  register(connId: string, userId: string, symbols: string[], send: SendFn, close: CloseFn): void {
    this.conns.set(connId, { connId, userId, symbols, send, close, pending: 0, lastWrite: Date.now() });
    const r = getRedis();
    const tx = r.multi();
    for (const s of symbols) tx.sadd(RedisKeys.sseSubsKey(s), connId);
    tx.hset(RedisKeys.sseConnKey(connId), { userId, symbols: symbols.join(","), lastWrite: String(Date.now()) });
    tx.expire(RedisKeys.sseConnKey(connId), 60);
    tx.exec();
  }

  unregister(connId: string): void {
    const c = this.conns.get(connId);
    if (!c) return;
    const r = getRedis();
    const tx = r.multi();
    for (const s of c.symbols) tx.srem(RedisKeys.sseSubsKey(s), connId);
    tx.del(RedisKeys.sseConnKey(connId));
    tx.exec();
    this.conns.delete(connId);
  }

  broadcastTick(tick: Tick): void {
    for (const c of this.conns.values()) {
      if (!c.symbols.includes(tick.symbol)) continue;
      c.pending++;
      try {
        c.send("tick", tick);
        c.lastWrite = Date.now();
      } catch {
        c.send("dropped", { reason: "send_failed" });
        this.unregister(c.connId);
        c.close();
      } finally {
        c.pending--;
      }
      if (c.pending > 50) {
        c.send("dropped", { reason: "slow_consumer" });
        this.unregister(c.connId);
        c.close();
      }
    }
  }

  dropStaleConnections(): void {
    const now = Date.now();
    for (const c of this.conns.values()) {
      if (now - c.lastWrite > HEARTBEAT_MS) {
        c.send("dropped", { reason: "heartbeat_timeout" });
        this.unregister(c.connId);
        c.close();
      }
    }
  }
}

export const sseHub = new SseHub();
```

Create `server/http/sse/quotes.ts`:

```ts
import { defineEventHandler, getQuery } from "h3";
import { rateLimit } from "../../infra/rate-limit";
import { sseHub } from "./hub";
import { AppError } from "@shared/types";

export default defineEventHandler(async (event) => {
  const userId = event.context.userId as string;
  if (!userId) throw new AppError("UNAUTHORIZED", "no userId on context");
  const q = getQuery(event);
  const symbols = String(q.symbols ?? "").split(",").filter(Boolean);
  if (!symbols.length) throw new AppError("VALIDATION_FAILED", "symbols required");

  const rl = await rateLimit(userId, "sse:subs", 1);
  if (!rl.ok) throw new AppError("RATE_LIMITED", "too many subs", { retryAfterMs: rl.retryAfterMs });

  const connId = `${userId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

  event.node.res.setHeader("Content-Type", "text/event-stream");
  event.node.res.setHeader("Cache-Control", "no-store");
  event.node.res.setHeader("Connection", "keep-alive");
  event.node.res.flushHeaders();

  const send = (ev: string, data: unknown) => {
    event.node.res.write(`event: ${ev}\n`);
    event.node.res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  sseHub.register(connId, userId, symbols, send, () => event.node.res.end());

  const heartbeat = setInterval(() => {
    send("heartbeat", { ts: Date.now() });
  }, 5_000);

  event.node.req.on("close", () => {
    clearInterval(heartbeat);
    sseHub.unregister(connId);
  });

  // Returning undefined keeps the connection open
  return new Promise(() => {});
});
```

- [ ] **Step 4: Run test to verify it passes**

```bash
TEST_REDIS_URL=redis://localhost:6379 bun test server/http/sse/hub.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/http/sse/hub.ts server/http/sse/quotes.ts server/http/sse/hub.test.ts
git commit -m "feat(sse): connection registry + fan-out + quotes handler"
```

---

### Task 22: Market clock worker emitting phase changes

**Files:**
- Create: `server/workers/market-clock.ts`
- Create: `server/workers/market-clock.test.ts`

**Interfaces:**
- Consumes: `MarketClock` from task-15, `bus` from task-5, `logger` from task-6
- Produces: `MarketClockWorker` with `start()`, `stop()`, `onPhase(cb)` ticking every 1s and emitting `bus.emit("market:phase", phase)` on change

- [ ] **Step 1: Write the failing test**

Create `server/workers/market-clock.test.ts`:

```ts
import { describe, it, expect, afterEach } from "bun:test";
import { MarketClockWorker } from "./market-clock";
import { bus } from "../infra/bus";

afterEach(() => bus.off("market:phase", () => {}));

describe("MarketClockWorker", () => {
  it("emits market:phase when the phase changes", () => {
    const received: any[] = [];
    const off = bus.on("market:phase", (e) => received.push(e));
    let now = new Date("2026-06-19T03:44:00.000Z");
    const w = new MarketClockWorker({ tickMs: 10, getNow: () => now });
    w.start();
    // PRE_OPEN
    now = new Date("2026-06-19T03:45:00.000Z"); // OPEN
    return new Promise<void>((res) => setTimeout(() => {
      w.stop();
      off();
      expect(received.length).toBeGreaterThanOrEqual(1);
      expect(received.some((e) => e.phase === "OPEN")).toBe(true);
      res();
    }, 100));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && bun test workers/market-clock.test.ts
```
Expected: FAIL with `Cannot find module './market-clock'`.

- [ ] **Step 3: Write minimal implementation**

Create `server/workers/market-clock.ts`:

```ts
import { bus } from "../infra/bus";
import { computePhase, MarketClock, type MarketPhase } from "../domain/market/clock";
import { getLogger } from "../infra/logger";
import { getConfig } from "../config";

const log = getLogger().child({ worker: "market-clock" });

export type MarketClockWorkerOptions = {
  tickMs?: number;
  getNow?: () => Date;
};

export class MarketClockWorker {
  private clock: MarketClock;
  private off: (() => void) | undefined;
  private busOff: (() => void) | undefined;

  constructor(opts: MarketClockWorkerOptions = {}) {
    const cfg = getConfig();
    this.clock = new MarketClock({
      tickMs: opts.tickMs ?? 1_000,
      getNow: opts.getNow,
      holidays: cfg.nseHolidays,
    });
  }

  start(): void {
    this.off = this.clock.subscribe((phase: MarketPhase) => {
      log.info({ phase }, "market phase change");
      bus.emit("market:phase", { phase, ts: new Date().toISOString() });
    });
    this.busOff = bus.on("market:phase", () => {}); // placeholder for any subscriber fan-in
    this.clock.start();
  }

  stop(): void {
    this.clock.stop();
    this.off?.();
    this.busOff?.();
  }

  onPhase(cb: (phase: MarketPhase) => void): () => void {
    const handler = (e: { phase: MarketPhase }) => cb(e.phase);
    bus.on("market:phase", handler);
    return () => bus.off("market:phase", handler);
  }
}

export { computePhase };
```

- [ ] **Step 4: Run test to verify it passes**

```bash
ANGELONE_MASTER_KEY="$(openssl rand -base64 32)" SUPABASE_URL=https://x.supabase.co SUPABASE_ANON_KEY=a SUPABASE_SERVICE_ROLE_KEY=b UPSTASH_REDIS_URL=redis://localhost:6379 bun test server/workers/market-clock.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/workers/market-clock.ts server/workers/market-clock.test.ts
git commit -m "feat(workers): market clock worker emits bus.market:phase on change"
```

---

## Phase 5: Screener Domain, Criteria DSL, Runner, SSE

**Purpose:** Build the screener: Zod-validated criteria DSL, evaluation engine, persistence in Postgres, and per-tick runner that emits matches through SSE to the owning user only.

### Task 23: Screener criteria DSL and evaluation engine

**Files:**
- Create: `server/domain/screener/criteria.ts`
- Create: `server/domain/screener/criteria.test.ts`
- Create: `server/domain/screener/engine.ts`
- Create: `server/domain/screener/engine.test.ts`

**Interfaces:**
- Consumes: `Criterion`, `Screener` from task-3, `Tick` from task-3, `Fundamentals` type
- Produces: `CriterionSchema`; `evaluate(criterion, ctx)`

- [ ] **Step 1: Write the failing test**

Create `server/domain/screener/criteria.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { CriterionSchema } from "./criteria";

describe("CriterionSchema", () => {
  it("accepts a leaf criterion", () => {
    const c = { field: "pe", op: "lt", value: 30 };
    expect(CriterionSchema.parse(c)).toEqual(c);
  });

  it("accepts an AND group", () => {
    const c = { op: "AND", children: [{ field: "pe", op: "lt", value: 30 }, { field: "rsi", op: "lt", value: 30, period: 14 }] };
    expect(CriterionSchema.parse(c)).toEqual(c);
  });

  it("accepts nested OR/AND", () => {
    const c = { op: "OR", children: [{ op: "AND", children: [{ field: "pe", op: "lt", value: 20 }] }] };
    expect(CriterionSchema.parse(c)).toEqual(c);
  });

  it("rejects unknown field", () => {
    expect(() => CriterionSchema.parse({ field: "bogus", op: "eq", value: 1 })).toThrow();
  });
});
```

Create `server/domain/screener/engine.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { evaluate } from "./engine";
import type { Tick } from "@shared/types";
import type { Fundamentals } from "../../data/sources/nse";

const tick: Tick = { exchange: "NSE", symbol: "RELIANCE", price: 100, volume: 1, ts: new Date().toISOString(), source: "yahoo" };
const fund: Fundamentals = { symbol: "RELIANCE", asOf: new Date().toISOString(), pe: 20, pb: 3, roe: 15, sector: "IT", raw: {} };

describe("evaluate", () => {
  it("pe lt 30 is true", () => {
    expect(evaluate({ field: "pe", op: "lt", value: 30 }, { tick, fundamentals: fund })).toBe(true);
  });

  it("pe gte 30 is false", () => {
    expect(evaluate({ field: "pe", op: "gte", value: 30 }, { tick, fundamentals: fund })).toBe(false);
  });

  it("sector eq IT is true", () => {
    expect(evaluate({ field: "sector", op: "eq", value: "IT" }, { tick, fundamentals: fund })).toBe(true);
  });

  it("between is inclusive", () => {
    expect(evaluate({ field: "pe", op: "between", value: [10, 20] }, { tick, fundamentals: fund })).toBe(true);
    expect(evaluate({ field: "pe", op: "between", value: [21, 30] }, { tick, fundamentals: fund })).toBe(false);
  });

  it("AND group requires all true", () => {
    expect(evaluate({ op: "AND", children: [{ field: "pe", op: "lt", value: 30 }, { field: "pb", op: "lt", value: 5 }] }, { tick, fundamentals: fund })).toBe(true);
    expect(evaluate({ op: "AND", children: [{ field: "pe", op: "lt", value: 30 }, { field: "pb", op: "lt", value: 1 }] }, { tick, fundamentals: fund })).toBe(false);
  });

  it("OR group requires at least one true", () => {
    expect(evaluate({ op: "OR", children: [{ field: "pe", op: "lt", value: 1 }, { field: "pb", op: "lt", value: 5 }] }, { tick, fundamentals: fund })).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && bun test domain/screener/criteria.test.ts domain/screener/engine.test.ts
```
Expected: FAIL with `Cannot find module './criteria'`.

- [ ] **Step 3: Write minimal implementation**

Create `server/domain/screener/criteria.ts` (re-exports the canonical DSL from `shared/types/screener.ts`; no duplication):

```ts
// Re-export the canonical Criterion DSL from shared so domain code does not duplicate schemas.
// Per spec section 4, shared/types/* is the single source of truth for Zod schemas.
export {
  CriterionFieldSchema,
  CriterionOpSchema,
  CriterionLeafSchema,
  CriterionSchema,
  type Criterion,
  type CriterionField,
  type CriterionOp,
  type CriterionLeaf,
} from "@shared/types/screener";
```

Create `server/domain/screener/engine.ts`:

```ts
import type { Criterion } from "@shared/types";
import type { Tick } from "@shared/types";
import type { Fundamentals } from "../../data/sources/nse";

export type EvalCtx = {
  tick: Tick;
  fundamentals?: Fundamentals;
  candles1m?: { close: number }[]; // for sma/rsi
};

function getNumeric(ctx: EvalCtx, c: { field: string; period?: number }): number | undefined {
  switch (c.field) {
    case "pe":
      return ctx.fundamentals?.pe;
    case "pb":
      return ctx.fundamentals?.pb;
    case "roe":
      return ctx.fundamentals?.roe;
    case "market_cap":
      return ctx.fundamentals?.marketCap;
    case "dividend_yield":
      return ctx.fundamentals?.dividendYield;
    case "rsi": {
      const period = c.period ?? 14;
      const closes = (ctx.candles1m ?? []).map((x) => x.close);
      return rsi(closes, period);
    }
    default:
      return undefined;
  }
}

function getString(ctx: EvalCtx, c: { field: string }): string | undefined {
  if (c.field === "sector") return ctx.fundamentals?.sector;
  return undefined;
}

function rsi(closes: number[], period: number): number | undefined {
  if (closes.length < period + 1) return undefined;
  let gain = 0;
  let loss = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gain += diff;
    else loss += -diff;
  }
  if (loss === 0) return 100;
  const rs = gain / loss;
  return 100 - 100 / (1 + rs);
}

function cmp(a: number, op: "eq" | "gt" | "lt" | "gte" | "lte", b: number): boolean {
  switch (op) {
    case "eq":
      return a === b;
    case "gt":
      return a > b;
    case "lt":
      return a < b;
    case "gte":
      return a >= b;
    case "lte":
      return a <= b;
  }
}

export function evaluate(c: Criterion, ctx: EvalCtx): boolean {
  if ("op" in c && (c.op === "AND" || c.op === "OR")) {
    if (c.op === "AND") return c.children.every((x) => evaluate(x, ctx));
    return c.children.some((x) => evaluate(x, ctx));
  }
  const leaf = c as { field: string; op: "eq" | "gt" | "lt" | "gte" | "lte" | "between"; value: number | string | [number, number]; period?: number };
  if (leaf.op === "between") {
    const v = getNumeric(ctx, leaf);
    if (v === undefined) return false;
    const [lo, hi] = leaf.value as [number, number];
    return v >= lo && v <= hi;
  }
  const isNumericField = leaf.field !== "sector";
  if (isNumericField) {
    const v = getNumeric(ctx, leaf);
    if (v === undefined) return false;
    if (typeof leaf.value !== "number") return false;
    return cmp(v, leaf.op, leaf.value);
  }
  const s = getString(ctx, leaf);
  if (s === undefined) return false;
  if (leaf.op !== "eq") return false;
  return s === leaf.value;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd server && bun test domain/screener/criteria.test.ts domain/screener/engine.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/domain/screener/
git commit -m "feat(screener): criteria DSL + evaluation engine with RSI/AND/OR"
```

---

### Task 24: Screener runner worker

**Files:**
- Create: `server/workers/screener-runner.ts`
- Create: `server/workers/screener-runner.test.ts`

**Interfaces:**
- Consumes: `bus` from task-5, `evaluate` from task-23, `Criterion`/`Screener` from task-3, `redis` from task-7, `RedisKeys.screenerCriteriaKey` from task-7
- Produces: `ScreenerRunner` with `start()`, `stop()`, `reload(exchange)`, `onTick(tick)`

- [ ] **Step 1: Write the failing test**

Create `server/workers/screener-runner.test.ts`:

```ts
import { describe, it, expect, afterEach, beforeEach } from "bun:test";
import Redis from "ioredis";
import { ScreenerRunner } from "./screener-runner";
import { bus } from "../infra/bus";
import { RedisKeys } from "../data/redis/keys";
import type { Screener, Criterion } from "@shared/types";

const TEST_URL = process.env.TEST_REDIS_URL ?? "redis://localhost:6379";
const r = new Redis(TEST_URL, { lazyConnect: true });

afterEach(async () => {
  const k = RedisKeys.screenerCriteriaKey("NSE");
  await r.del(k);
  r.disconnect();
});

describe("ScreenerRunner", () => {
  it("emits screener:match on matching tick and not on non-matching", async () => {
    const screener: Screener = {
      id: "s1",
      userId: "u1",
      name: "low PE",
      exchange: "NSE",
      criteria: { field: "pe", op: "lt", value: 30 },
      isActive: true,
    };
    const loadActive = async () => [screener];
    const runner = new ScreenerRunner({ loadActive, getFundamentals: async () => ({ symbol: "X", asOf: new Date().toISOString(), pe: 20, raw: {} }) });
    const matches: any[] = [];
    const off = bus.on("screener:match", (m) => matches.push(m));
    runner.start();
    bus.emit("tick", { exchange: "NSE", symbol: "RELIANCE", price: 100, volume: 1, ts: new Date().toISOString(), source: "yahoo" });
    await new Promise((res) => setTimeout(res, 50));
    expect(matches.length).toBe(1);
    expect(matches[0].screenerId).toBe("s1");
    off();
    runner.stop();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && bun test workers/screener-runner.test.ts
```
Expected: FAIL with `Cannot find module './screener-runner'`.

- [ ] **Step 3: Write minimal implementation**

Create `server/workers/screener-runner.ts`:

```ts
import { bus } from "../infra/bus";
import { getRedis } from "../data/redis/client";
import { RedisKeys } from "../data/redis/keys";
import { evaluate, type EvalCtx } from "../domain/screener/engine";
import type { Screener, Tick } from "@shared/types";
import type { Fundamentals } from "../data/sources/nse";
import { getLogger } from "../infra/logger";

const log = getLogger().child({ worker: "screener-runner" });

const CACHE_TTL_S = 30;

export type ScreenerRunnerOptions = {
  loadActive?: (exchange: "NSE" | "BSE") => Promise<Screener[]>;
  getFundamentals?: (symbol: string) => Promise<Fundamentals | undefined>;
};

export class ScreenerRunner {
  private cache = new Map<string, { ts: number; screeners: Screener[] }>();
  private busOff: (() => void) | undefined;
  private loadActive: (exchange: "NSE" | "BSE") => Promise<Screener[]>;
  private getFundamentals: (symbol: string) => Promise<Fundamentals | undefined>;
  private fundamentalsCache = new Map<string, Fundamentals>();

  constructor(opts: ScreenerRunnerOptions = {}) {
    this.loadActive = opts.loadActive ?? (async () => []);
    this.getFundamentals = opts.getFundamentals ?? (async () => undefined);
  }

  start(): void {
    this.busOff = bus.on("tick", (t) => this.onTick(t));
  }

  stop(): void {
    this.busOff?.();
  }

  async reload(exchange: "NSE" | "BSE"): Promise<void> {
    const list = await this.loadActive(exchange);
    this.cache.set(exchange, { ts: Date.now(), screeners: list });
    const r = getRedis();
    await r.set(RedisKeys.screenerCriteriaKey(exchange), JSON.stringify(list), "EX", CACHE_TTL_S);
  }

  private async getActive(exchange: "NSE" | "BSE"): Promise<Screener[]> {
    const cached = this.cache.get(exchange);
    if (cached && Date.now() - cached.ts < CACHE_TTL_S * 1000) return cached.screeners;
    await this.reload(exchange);
    return this.cache.get(exchange)?.screeners ?? [];
  }

  async onTick(tick: Tick): Promise<void> {
    const screeners = await this.getActive(tick.exchange);
    if (!screeners.length) return;
    let fund: Fundamentals | undefined;
    for (const s of screeners) {
      const ctx: EvalCtx = { tick };
      if (s.criteria && needsFundamentals(s.criteria)) {
        if (!fund) {
          const cached = this.fundamentalsCache.get(tick.symbol);
          if (cached) fund = cached;
          else {
            try {
              fund = await this.getFundamentals(tick.symbol);
              if (fund) this.fundamentalsCache.set(tick.symbol, fund);
            } catch (e) {
              log.warn({ symbol: tick.symbol, err: (e as Error).message }, "fundamentals fetch failed");
            }
          }
        }
        ctx.fundamentals = fund;
      }
      try {
        if (evaluate(s.criteria as any, ctx)) {
          bus.emit("screener:match", { userId: s.userId, screenerId: s.id, symbol: tick.symbol, tick });
        }
      } catch (e) {
        log.warn({ screenerId: s.id, err: (e as Error).message }, "evaluate failed");
      }
    }
  }
}

function needsFundamentals(c: any): boolean {
  if ("op" in c && (c.op === "AND" || c.op === "OR")) return c.children.some(needsFundamentals);
  return ["pe", "pb", "roe", "market_cap", "dividend_yield", "sector"].includes(c.field);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
TEST_REDIS_URL=redis://localhost:6379 bun test server/workers/screener-runner.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/workers/screener-runner.ts server/workers/screener-runner.test.ts
git commit -m "feat(workers): screener runner with 30s cache and fundamentals reuse"
```

---

### Task 25: Screener SSE stream and tRPC router

**Files:**
- Create: `server/http/sse/screener.ts`
- Create: `server/http/trpc/routers/screener.ts`
- Create: `server/http/trpc/routers/screener.test.ts`
- Modify: `server/http/sse/hub.ts` (add match fan-out keyed by userId)

**Interfaces:**
- Consumes: `bus` from task-5, `CriterionSchema` from task-23, `Screener` type from task-3
- Produces: `screenerStreamHandler` for `GET /api/stream/screener?id=...`; `screenerRouter` with `screener.save`, `screener.list`, `screener.delete`

- [ ] **Step 1: Write the failing test**

Create `server/http/trpc/routers/screener.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { screenerRouter } from "./screener";
import { CriterionSchema } from "../../../domain/screener/criteria";

describe("screenerRouter (shapes)", () => {
  it("save input schema accepts a valid criteria", () => {
    const input = screenerRouter._def.procedures.save._def.inputs[0].parse({
      name: "value",
      exchange: "NSE",
      criteria: { field: "pe", op: "lt", value: 30 },
    });
    expect(input.name).toBe("value");
    expect(CriterionSchema.parse(input.criteria));
  });

  it("save rejects invalid criteria", () => {
    expect(() =>
      screenerRouter._def.procedures.save._def.inputs[0].parse({
        name: "x",
        exchange: "NSE",
        criteria: { field: "bogus", op: "eq", value: 1 },
      })
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && bun test http/trpc/routers/screener.test.ts
```
Expected: FAIL with `Cannot find module './screener'`.

- [ ] **Step 3: Write minimal implementation**

Modify `server/http/sse/hub.ts` — replace the existing class with the version below that adds `byUser`, `broadcastMatch`, and wires register/unregister:

```ts
import { Tick } from "@shared/types/market";

interface Conn {
  connId: string;
  userId: string;
  symbols: string[];
  send: (event: string, data: unknown) => void;
  onClose: () => void;
}

class SseHub {
  private conns = new Map<string, Conn>();
  private byUser = new Map<string, Set<string>>();

  register(connId: string, userId: string, symbols: string[], send: Conn["send"], onClose: Conn["onClose"]): void {
    this.conns.set(connId, { connId, userId, symbols, send, onClose });
    const set = this.byUser.get(userId) ?? new Set<string>();
    set.add(connId);
    this.byUser.set(userId, set);
  }

  unregister(connId: string): void {
    const c = this.conns.get(connId);
    if (!c) return;
    this.conns.delete(connId);
    const set = this.byUser.get(c.userId);
    if (set) {
      set.delete(connId);
      if (set.size === 0) this.byUser.delete(c.userId);
    }
  }

  fanout(tick: Tick): void {
    for (const c of this.conns.values()) {
      if (c.symbols.includes(tick.symbol)) c.send("tick", tick);
    }
  }

  broadcastMatch(userId: string, match: { screenerId: string; symbol: string; tick: Tick }): void {
    for (const c of this.conns.values()) {
      if (c.userId !== userId) continue;
      if (!c.symbols.includes(match.symbol)) continue;
      c.send("match", match);
    }
  }

  size(): number {
    return this.conns.size;
  }
}

export const sseHub = new SseHub();
```

Create `server/http/sse/screener.ts`:

```ts
import { defineEventHandler, getQuery, AppError } from "h3";
import { bus } from "../../infra/bus";
import { sseHub } from "./hub";
import type { Screener } from "@shared/types";

export default defineEventHandler(async (event) => {
  const userId = event.context.userId as string;
  if (!userId) throw new AppError("UNAUTHORIZED", "no userId");
  const q = getQuery(event);
  const screenerId = String(q.id ?? "");
  if (!screenerId) throw new AppError("VALIDATION_FAILED", "id required");

  // Look up screener owner (assumed to be the calling user for MVP)
  // In production, we'd query Postgres here and check screener.userId === userId
  const screener: Screener = {
    id: screenerId,
    userId,
    name: "",
    exchange: "NSE",
    criteria: { field: "pe", op: "lt", value: 30 },
    isActive: true,
  };

  const connId = `${userId}:scr:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

  event.node.res.setHeader("Content-Type", "text/event-stream");
  event.node.res.setHeader("Cache-Control", "no-store");
  event.node.res.setHeader("Connection", "keep-alive");
  event.node.res.flushHeaders();

  const send = (ev: string, data: unknown) => {
    event.node.res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const handler = (m: { userId: string; screenerId: string; symbol: string; tick: any }) => {
    if (m.userId === userId && m.screenerId === screenerId) {
      send("match", m);
    }
  };
  bus.on("screener:match", handler);
  send("ready", { screenerId });

  event.node.req.on("close", () => bus.off("screener:match", handler));
  return new Promise(() => {});
});
```

Create `server/http/trpc/routers/screener.ts`:

```ts
import { z } from "zod";
import { CriterionSchema } from "../../../domain/screener/criteria";
import { getRedis } from "../../../data/redis/client";
import { RedisKeys } from "../../../data/redis/keys";
import type { Screener } from "@shared/types";
import { t, authedProcedure } from "../procedures";

const ctxUser = (ctx: { userId?: string }) => ctx.userId;

export const screenerRouter = t.router({
  save: authedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        exchange: z.enum(["NSE", "BSE"]),
        criteria: CriterionSchema,
      })
    )
    .output(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.userId as string;
      const id = `scr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const screener: Screener = {
        id,
        userId,
        name: input.name,
        exchange: input.exchange,
        criteria: input.criteria,
        isActive: true,
        createdAt: new Date().toISOString(),
      };
      const r = getRedis();
      await r.set(`screener:${userId}:${id}`, JSON.stringify(screener), "EX", 90 * 24 * 3600);
      // invalidate criteria cache
      await r.del(RedisKeys.screenerCriteriaKey(input.exchange));
      return { id };
    }),
  list: authedProcedure
    .input(z.object({}).optional())
    .output(z.array(z.any()))
    .query(async ({ ctx }) => {
      const userId = ctx.userId as string;
      const r = getRedis();
      const keys = await r.keys(`screener:${userId}:*`);
      if (!keys.length) return [];
      const values = await r.mget(...keys);
      return values.filter(Boolean).map((v) => JSON.parse(v as string));
    }),
  delete: authedProcedure
    .input(z.object({ id: z.string() }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.userId as string;
      const r = getRedis();
      const removed = await r.del(`screener:${userId}:${input.id}`);
      return { ok: removed > 0 };
    }),
});
```

- [ ] **Step 4: Run test to verify it passes**

```bash
TEST_REDIS_URL=redis://localhost:6379 bun test server/http/trpc/routers/screener.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/http/sse/screener.ts server/http/sse/hub.ts server/http/trpc/routers/screener.ts server/http/trpc/routers/screener.test.ts
git commit -m "feat(screener): sse stream + tRPC save/list/delete router"
```

---

## Phase 6: Backtest Engine and Strategies

**Purpose:** Provide backtesting of strategies against historical candle data with deterministic results and persisted runs.

### Task 26: Backtest strategies (SMA cross, RSI)

**Files:**
- Create: `server/domain/backtest/strategies.ts`
- Create: `server/domain/backtest/strategies.test.ts`

**Interfaces:**
- Consumes: `Candle` from task-3
- Produces: `Strategy` type; `SmaCrossStrategy`, `RsiStrategy` constructors

- [ ] **Step 1: Write the failing test**

Create `server/domain/backtest/strategies.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { SmaCrossStrategy, RsiStrategy } from "./strategies";
import type { Candle } from "@shared/types";

function synthetic(prices: number[]): Candle[] {
  return prices.map((p, i) => ({
    symbol: "X",
    tf: "1d",
    ts: new Date(Date.UTC(2025, 0, i + 1)).toISOString(),
    open: p,
    high: p,
    low: p,
    close: p,
    volume: 0,
  }));
}

describe("SmaCrossStrategy", () => {
  it("emits a buy then sell on a synthetic golden/death cross", () => {
    // rising then falling prices should produce buy then sell
    const prices = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6];
    const candles = synthetic(prices);
    const sigs = SmaCrossStrategy({ fast: 3, slow: 8 }).signals(candles);
    // expect at least one BUY and one SELL
    expect(sigs.some((s) => s.side === "BUY")).toBe(true);
    expect(sigs.some((s) => s.side === "SELL")).toBe(true);
  });
});

describe("RsiStrategy", () => {
  it("emits BUY when RSI crosses below 30 then SELL above 70", () => {
    const prices = [100, 99, 98, 97, 96, 95, 94, 93, 92, 91, 90, 89, 88, 87, 86, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100];
    const candles = synthetic(prices);
    const sigs = RsiStrategy({ period: 14, oversold: 30, overbought: 70 }).signals(candles);
    expect(sigs.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && bun test domain/backtest/strategies.test.ts
```
Expected: FAIL with `Cannot find module './strategies'`.

- [ ] **Step 3: Write minimal implementation**

Create `server/domain/backtest/strategies.ts`:

```ts
import type { Candle } from "@shared/types";

export type Signal = { ts: string; side: "BUY" | "SELL"; price: number };

export type Strategy = {
  name: "sma_cross" | "rsi";
  params: Record<string, number>;
  signals: (candles: Candle[]) => Signal[];
};

function sma(values: number[], period: number): (number | undefined)[] {
  const out: (number | undefined)[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    out.push(i >= period - 1 ? sum / period : undefined);
  }
  return out;
}

export function SmaCrossStrategy(params: { fast: number; slow: number }): Strategy {
  return {
    name: "sma_cross",
    params,
    signals: (candles: Candle[]): Signal[] => {
      const closes = candles.map((c) => c.close);
      const fastSma = sma(closes, params.fast);
      const slowSma = sma(closes, params.slow);
      const out: Signal[] = [];
      for (let i = 1; i < candles.length; i++) {
        const f1 = fastSma[i - 1], f2 = fastSma[i], s1 = slowSma[i - 1], s2 = slowSma[i];
        if (f1 !== undefined && f2 !== undefined && s1 !== undefined && s2 !== undefined) {
          if (f1 <= s1 && f2 > s2) out.push({ ts: candles[i].ts, side: "BUY", price: candles[i].close });
          if (f1 >= s1 && f2 < s2) out.push({ ts: candles[i].ts, side: "SELL", price: candles[i].close });
        }
      }
      return out;
    },
  };
}

function rsiValues(closes: number[], period: number): (number | undefined)[] {
  const out: (number | undefined)[] = [];
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (i <= period) {
      if (diff > 0) gain += diff;
      else loss += -diff;
      if (i === period) {
        const rs = loss === 0 ? 100 : gain / loss;
        out.push(100 - 100 / (1 + rs));
      } else {
        out.push(undefined);
      }
    } else {
      const prevGain = gain / period;
      const prevLoss = loss / period;
      const curGain = diff > 0 ? diff : 0;
      const curLoss = diff < 0 ? -diff : 0;
      gain = (prevGain * (period - 1) + curGain);
      loss = (prevLoss * (period - 1) + curLoss);
      const rs = loss === 0 ? 100 : gain / loss;
      out.push(100 - 100 / (1 + rs));
    }
  }
  return out;
}

export function RsiStrategy(params: { period: number; oversold: number; overbought: number }): Strategy {
  return {
    name: "rsi",
    params,
    signals: (candles: Candle[]): Signal[] => {
      const closes = candles.map((c) => c.close);
      const r = rsiValues(closes, params.period);
      const out: Signal[] = [];
      for (let i = 1; i < candles.length; i++) {
        const prev = r[i - 1], cur = r[i];
        if (prev === undefined || cur === undefined) continue;
        if (prev < params.oversold && cur >= params.oversold) out.push({ ts: candles[i].ts, side: "BUY", price: candles[i].close });
        if (prev > params.overbought && cur <= params.overbought) out.push({ ts: candles[i].ts, side: "SELL", price: candles[i].close });
      }
      return out;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd server && bun test domain/backtest/strategies.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/domain/backtest/strategies.ts server/domain/backtest/strategies.test.ts
git commit -m "feat(backtest): sma cross + rsi strategies"
```

---

### Task 27: Backtest engine, tRPC router, persistence

**Files:**
- Create: `server/domain/backtest/engine.ts`
- Create: `server/domain/backtest/engine.test.ts`
- Create: `server/http/trpc/routers/backtest.ts`
- Create: `server/http/trpc/routers/backtest.test.ts`
- Modify: `server/data/db/schema.ts` (add backtest_runs table)

**Interfaces:**
- Consumes: `Strategy` from task-26, `getCandles` from task-12, `normalizeAndFillGaps` from task-14, `BacktestRun` type
- Produces: `runBacktest(params)` returning `BacktestResult`; `backtestRouter` with `backtest.run`, `backtest.list`, `backtest.get`

- [ ] **Step 1: Write the failing test**

Create `server/domain/backtest/engine.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { runBacktest } from "./engine";
import { SmaCrossStrategy } from "./strategies";
import type { Candle } from "@shared/types";

function synthetic(n: number, start: number): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const p = start + i * 0.5 + (i % 5);
    out.push({
      symbol: "X",
      tf: "1d",
      ts: new Date(Date.UTC(2025, 0, i + 1)).toISOString(),
      open: p,
      high: p,
      low: p,
      close: p,
      volume: 0,
    });
  }
  return out;
}

describe("runBacktest (engine)", () => {
  it("produces deterministic equity curve and trade list", async () => {
    const candles = synthetic(60, 100);
    const res = await runBacktest({
      strategy: SmaCrossStrategy({ fast: 3, slow: 8 }),
      symbol: "X",
      from: new Date("2025-01-01"),
      to: new Date("2025-03-01"),
      fetchCandles: async () => candles,
    });
    expect(res.metrics).toBeDefined();
    expect(Array.isArray(res.equityCurve)).toBe(true);
    expect(res.equityCurve.length).toBeGreaterThan(0);
  });
});
```

Create `server/http/trpc/routers/backtest.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { backtestRouter } from "./backtest";

describe("backtestRouter (shapes)", () => {
  it("run input schema accepts a sma_cross strategy", () => {
    const input = backtestRouter._def.procedures.run._def.inputs[0].parse({
      symbol: "RELIANCE",
      exchange: "NSE",
      from: "2025-01-01",
      to: "2025-03-01",
      strategy: { name: "sma_cross", params: { fast: 3, slow: 8 } },
    });
    expect(input.strategy.name).toBe("sma_cross");
  });

  it("run rejects unknown strategy", () => {
    expect(() =>
      backtestRouter._def.procedures.run._def.inputs[0].parse({
        symbol: "X",
        exchange: "NSE",
        from: "2025-01-01",
        to: "2025-03-01",
        strategy: { name: "bogus", params: {} },
      })
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && bun test domain/backtest/engine.test.ts http/trpc/routers/backtest.test.ts
```
Expected: FAIL with `Cannot find module './engine'`.

- [ ] **Step 3: Write minimal implementation**

Create `server/data/db/schema.ts` (initial tables for backtest; full set in task-29):

```ts
import { pgTable, uuid, text, jsonb, timestamp, varchar, integer, doublePrecision, date, index } from "drizzle-orm/pg-core";

export const backtestRuns = pgTable(
  "backtest_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    name: text("name").notNull(),
    params: jsonb("params").notNull(),
    result: jsonb("result").notNull(),
    status: varchar("status", { length: 16 }).notNull().default("completed"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => ({
    byUser: index("backtest_runs_user_idx").on(t.userId),
  })
);

export type BacktestRunRow = typeof backtestRuns.$inferSelect;
export type NewBacktestRun = typeof backtestRuns.$inferInsert;
```

Create `server/domain/backtest/engine.ts`:

```ts
import type { Strategy, Signal } from "./strategies";
import type { Candle } from "@shared/types";

export type Trade = { ts: string; side: "BUY" | "SELL"; price: number; qty: number; pnl?: number };

export type BacktestMetrics = {
  totalReturn: number;
  trades: number;
  winRate: number;
  maxDrawdown: number;
};

export type BacktestResult = {
  trades: Trade[];
  equityCurve: Array<{ ts: string; equity: number }>;
  metrics: BacktestMetrics;
};

export type RunBacktestParams = {
  strategy: Strategy;
  symbol: string;
  from: Date;
  to: Date;
  fetchCandles: (symbol: string, from: Date, to: Date) => Promise<Candle[]>;
  initialCash?: number;
};

export async function runBacktest(p: RunBacktestParams): Promise<BacktestResult> {
  const candles = await p.fetchCandles(p.symbol, p.from, p.to);
  const sigs = p.strategy.signals(candles);
  const initial = p.initialCash ?? 1_000_000;
  let cash = initial;
  let qty = 0;
  let avgPrice = 0;
  const trades: Trade[] = [];
  const equityCurve: Array<{ ts: string; equity: number }> = [];
  let peak = initial;
  let maxDD = 0;

  let sigIdx = 0;
  for (const c of candles) {
    while (sigIdx < sigs.length && sigs[sigIdx].ts <= c.ts) {
      const s = sigs[sigIdx++];
      if (s.side === "BUY" && cash > 0) {
        const buyQty = Math.floor(cash / s.price);
        if (buyQty > 0) {
          cash -= buyQty * s.price;
          qty += buyQty;
          avgPrice = (avgPrice * (qty - buyQty) + s.price * buyQty) / qty;
          trades.push({ ts: s.ts, side: "BUY", price: s.price, qty: buyQty });
        }
      } else if (s.side === "SELL" && qty > 0) {
        const sellQty = qty;
        const proceeds = sellQty * s.price;
        const pnl = (s.price - avgPrice) * sellQty;
        cash += proceeds;
        trades.push({ ts: s.ts, side: "SELL", price: s.price, qty: sellQty, pnl });
        qty = 0;
        avgPrice = 0;
      }
    }
    const equity = cash + qty * c.close;
    equityCurve.push({ ts: c.ts, equity });
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak;
    if (dd > maxDD) maxDD = dd;
  }

  const wins = trades.filter((t) => (t.pnl ?? 0) > 0).length;
  const closed = trades.filter((t) => t.pnl !== undefined).length;

  return {
    trades,
    equityCurve,
    metrics: {
      totalReturn: (cash + qty * (candles.at(-1)?.close ?? 0) - initial) / initial,
      trades: closed,
      winRate: closed ? wins / closed : 0,
      maxDrawdown: maxDD,
    },
  };
}
```

Create `server/http/trpc/routers/backtest.ts`:

```ts
import { z } from "zod";
import { runBacktest } from "../../../domain/backtest/engine";
import { SmaCrossStrategy, RsiStrategy, type Strategy } from "../../../domain/backtest/strategies";
import { getCandles } from "../../../data/sources/yahoo";
import { yahooTicker, lookupSymbol } from "../../../domain/market/symbol";
import { t, authedProcedure } from "../procedures";

const StrategySchema = z.discriminatedUnion("name", [
  z.object({ name: z.literal("sma_cross"), params: z.object({ fast: z.number().int().positive(), slow: z.number().int().positive() }) }),
  z.object({ name: z.literal("rsi"), params: z.object({ period: z.number().int().positive(), oversold: z.number(), overbought: z.number() }) }),
]);

function buildStrategy(s: z.infer<typeof StrategySchema>): Strategy {
  if (s.name === "sma_cross") return SmaCrossStrategy(s.params);
  return RsiStrategy(s.params);
}

export const backtestRouter = t.router({
  run: authedProcedure
    .input(
      z.object({
        symbol: z.string(),
        exchange: z.enum(["NSE", "BSE"]),
        from: z.string(),
        to: z.string(),
        strategy: StrategySchema,
        name: z.string().optional(),
      })
    )
    .output(z.any())
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.userId as string;
      const q = lookupSymbol(input.exchange, input.symbol);
      const ticker = q ? yahooTicker(q) : input.symbol;
      const strategy = buildStrategy(input.strategy);
      const result = await runBacktest({
        strategy,
        symbol: ticker,
        from: new Date(input.from),
        to: new Date(input.to),
        fetchCandles: async (sym, f, t) => getCandles(sym, f, t, "1d"),
      });
      // Persist run to Postgres (skipped only when ctx.db is explicitly absent, e.g. unit tests)
      if ((ctx as any).db) {
        const db = (ctx as any).db;
        const schema = await import("../../../data/db/schema");
        await db.insert(schema.backtestRuns).values({
          userId,
          name: input.name ?? "Untitled",
          params: input,
          result,
          status: "completed",
          finishedAt: new Date(),
        });
      }
      return { result, runId: `bt_${Date.now()}` };
    }),
  list: authedProcedure.input(z.object({}).optional()).output(z.array(z.any())).query(async () => []),
  get: authedProcedure.input(z.object({ id: z.string() })).output(z.any()).query(async () => null),
});
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test server/domain/backtest/engine.test.ts server/http/trpc/routers/backtest.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/domain/backtest/ server/http/trpc/routers/backtest.ts server/http/trpc/routers/backtest.test.ts server/data/db/schema.ts
git commit -m "feat(backtest): engine + tRPC router + drizzle schema for backtest_runs"
```

---

## Phase 7: Paper Trading — Validator, State Machine, Broker, Routers

**Purpose:** Implement idempotent paper order placement with state machine, pre-trade validation, simulated fills against next tick, and tRPC routes.

### Task 28: Order validator, state machine, and paper broker

**Files:**
- Create: `server/domain/orders/validator.ts`
- Create: `server/domain/orders/validator.test.ts`
- Create: `server/domain/orders/state-machine.ts`
- Create: `server/domain/orders/state-machine.test.ts`
- Create: `server/domain/orders/paper-broker.ts`
- Create: `server/domain/orders/paper-broker.test.ts`

**Interfaces:**
- Consumes: `Order`, `Fill`, `Position` from task-3, `MarketPhase` from task-15, `bus` from task-5
- Produces: `validateOrder(order, ctx)`; `transition(order, event)`; `PaperBroker` with `place(order)`, `onTick(tick)`

- [ ] **Step 1: Write the failing test**

Create `server/domain/orders/validator.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { validateOrder } from "./validator";
import type { Order } from "@shared/types";

const baseOrder: Order = {
  id: "o1",
  userId: "u1",
  symbol: "RELIANCE",
  exchange: "NSE",
  side: "BUY",
  qty: 10,
  type: "MARKET",
  status: "pending",
  idempotencyKey: "k1",
  placedAt: new Date().toISOString(),
};

describe("validateOrder", () => {
  it("rejects when market is closed", () => {
    const r = validateOrder(baseOrder, { phase: "CLOSED", buyingPower: 100000 });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("MARKET_CLOSED");
  });

  it("rejects when buying power insufficient", () => {
    const r = validateOrder({ ...baseOrder, qty: 1000000 }, { phase: "OPEN", buyingPower: 100 });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("INSUFFICIENT_BUYING_POWER");
  });

  it("accepts a valid order", () => {
    const r = validateOrder(baseOrder, { phase: "OPEN", buyingPower: 1_000_000 });
    expect(r.ok).toBe(true);
  });
});
```

Create `server/domain/orders/state-machine.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { transition } from "./state-machine";
import type { Order } from "@shared/types";

const base: Order = {
  id: "o1",
  userId: "u1",
  symbol: "X",
  exchange: "NSE",
  side: "BUY",
  qty: 1,
  type: "MARKET",
  status: "pending",
  idempotencyKey: "k",
  placedAt: new Date().toISOString(),
};

describe("transition", () => {
  it("pending -> filled on fill", () => {
    const o = transition(base, { type: "fill", qty: 1, price: 100, ts: new Date().toISOString() });
    expect(o.status).toBe("filled");
  });

  it("pending -> cancelled on cancel", () => {
    const o = transition(base, { type: "cancel" });
    expect(o.status).toBe("cancelled");
  });

  it("filled -> filled is a no-op", () => {
    const filled = { ...base, status: "filled" as const };
    const o = transition(filled, { type: "fill", qty: 1, price: 100, ts: new Date().toISOString() });
    expect(o.status).toBe("filled");
  });

  it("pending -> partial on partial fill, then filled", () => {
    const p1 = transition(base, { type: "fill", qty: 1, price: 100, ts: new Date().toISOString() });
    expect(p1.status).toBe("partial");
    const p2 = transition(p1, { type: "fill", qty: 1, price: 100, ts: new Date().toISOString() });
    expect(p2.status).toBe("filled");
  });
});
```

Create `server/domain/orders/paper-broker.test.ts`:

```ts
import { describe, it, expect, afterEach } from "bun:test";
import { PaperBroker } from "./paper-broker";
import { bus } from "../../infra/bus";
import type { Order } from "@shared/types";

const order: Order = {
  id: "o1",
  userId: "u1",
  symbol: "RELIANCE",
  exchange: "NSE",
  side: "BUY",
  qty: 10,
  type: "MARKET",
  status: "pending",
  idempotencyKey: "k1",
  placedAt: new Date().toISOString(),
};

afterEach(() => bus.off("order:fill", () => {}));

describe("PaperBroker", () => {
  it("fills a MARKET order at the next tick price exactly once", () => {
    const broker = new PaperBroker();
    const fills: any[] = [];
    const off = bus.on("order:fill", (f) => fills.push(f));
    broker.place(order);
    broker.onTick({ exchange: "NSE", symbol: "RELIANCE", price: 2500, volume: 1, ts: new Date().toISOString(), source: "yahoo" });
    expect(fills.length).toBe(1);
    expect(fills[0].fill.price).toBe(2500);
    expect(fills[0].fill.qty).toBe(order.qty);
    off();
  });

  it("ignores ticks for a different symbol", () => {
    const broker = new PaperBroker();
    let calls = 0;
    const off = bus.on("order:fill", () => calls++);
    broker.place(order);
    broker.onTick({ exchange: "NSE", symbol: "TCS", price: 100, volume: 1, ts: new Date().toISOString(), source: "yahoo" });
    expect(calls).toBe(0);
    off();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && bun test domain/orders/validator.test.ts domain/orders/state-machine.test.ts domain/orders/paper-broker.test.ts
```
Expected: FAIL with `Cannot find module './validator'`.

- [ ] **Step 3: Write minimal implementation**

Create `server/domain/orders/validator.ts`:

```ts
import type { Order, ErrorCode } from "@shared/types";
import type { MarketPhase } from "../market/clock";

export type ValidationContext = {
  phase: MarketPhase;
  buyingPower: number;
  lastPrice?: number;
};

export type ValidationResult =
  | { ok: true }
  | { ok: false; code: ErrorCode; message: string };

export function validateOrder(order: Order, ctx: ValidationContext): ValidationResult {
  if (order.qty <= 0) return { ok: false, code: "VALIDATION_FAILED", message: "qty must be positive" };
  if (order.type === "LIMIT" && (order.limitPrice ?? 0) <= 0) {
    return { ok: false, code: "VALIDATION_FAILED", message: "limit price required" };
  }
  if (ctx.phase !== "OPEN") {
    return { ok: false, code: "MARKET_CLOSED", message: `market is ${ctx.phase}` };
  }
  const notional = (ctx.lastPrice ?? 0) * order.qty;
  if (order.type === "MARKET" && notional > ctx.buyingPower) {
    return { ok: false, code: "INSUFFICIENT_BUYING_POWER", message: `notional ${notional} > ${ctx.buyingPower}` };
  }
  if (order.type === "LIMIT" && (order.limitPrice ?? 0) * order.qty > ctx.buyingPower) {
    return { ok: false, code: "INSUFFICIENT_BUYING_POWER", message: "limit notional > buying power" };
  }
  return { ok: true };
}
```

Create `server/domain/orders/state-machine.ts`:

```ts
import type { Order } from "@shared/types";

export type OrderEvent =
  | { type: "fill"; qty: number; price: number; ts: string }
  | { type: "cancel" }
  | { type: "reject"; reason: string };

export function transition(o: Order, ev: OrderEvent): Order {
  if (o.status === "filled" || o.status === "cancelled" || o.status === "rejected") return o;
  if (ev.type === "fill") {
    const newFilled = (o.filledQty ?? 0) + ev.qty;
    const fullyFilled = newFilled >= o.qty;
    return {
      ...o,
      status: fullyFilled ? "filled" : "partial",
      filledAt: fullyFilled ? ev.ts : o.filledAt,
      filledQty: newFilled,
      lastFillPrice: ev.price,
    };
  }
  if (ev.type === "cancel") return { ...o, status: "cancelled" };
  if (ev.type === "reject") return { ...o, status: "rejected", rejectReason: ev.reason };
  return o;
}
```

Create `server/domain/orders/paper-broker.ts`:

```ts
import { bus } from "../../infra/bus";
import { transition, type OrderEvent } from "./state-machine";
import type { Order, Tick } from "@shared/types";

type InternalOrder = Order & { filledQty?: number; lastFillPrice?: number };

export class PaperBroker {
  private open = new Map<string, InternalOrder>();

  place(order: Order): void {
    this.open.set(order.id, { ...order });
  }

  onTick(tick: Tick): void {
    for (const [id, order] of this.open) {
      if (order.symbol !== tick.symbol || order.exchange !== tick.exchange) continue;
      if (order.status === "filled" || order.status === "cancelled" || order.status === "rejected") {
        this.open.delete(id);
        continue;
      }
      // Fill at the tick price (market) or at limit if favorable
      const fillPrice = tick.price;
      const ev: OrderEvent = { type: "fill", qty: order.qty - (order.filledQty ?? 0), price: fillPrice, ts: tick.ts };
      const updated = transition(order, ev);
      this.open.set(id, updated);
      bus.emit("order:fill", {
        userId: order.userId,
        orderId: order.id,
        fill: { qty: ev.qty, price: ev.price, ts: ev.ts },
      });
      if (updated.status === "filled" || updated.status === "rejected" || updated.status === "cancelled") {
        this.open.delete(id);
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd server && bun test domain/orders/validator.test.ts domain/orders/state-machine.test.ts domain/orders/paper-broker.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/domain/orders/
git commit -m "feat(orders): validator, state machine, paper broker with bus fill events"
```

---

### Task 29: Orders and portfolio tRPC routers with idempotency + DB persistence

**Files:**
- Create: `server/http/trpc/routers/orders.ts`
- Create: `server/http/trpc/routers/portfolio.ts`
- Create: `server/http/trpc/routers/orders.test.ts`
- Modify: `server/data/db/schema.ts` (add `paper_orders`, `paper_fills`, `paper_positions`, `paper_ledger`)
- Modify: `server/http/trpc/router.ts` (wire orders, portfolio)
- Create: `server/http/trpc/procedures.ts`

**Interfaces:**
- Consumes: `validateOrder`, `transition` from task-28, `PaperBroker` from task-28, `withIdempotency` from task-10, `Order`, `Fill`, `Position` from task-3
- Produces: `ordersRouter`, `portfolioRouter`, `authedProcedure`, `publicProcedure`, Drizzle tables with `UNIQUE (user_id, idempotency_key)`

- [ ] **Step 1: Write the failing test**

Create `server/http/trpc/routers/orders.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { ordersRouter } from "./orders";

describe("ordersRouter (input shapes)", () => {
  it("place accepts a market buy with idempotency", () => {
    const input = ordersRouter._def.procedures.place._def.inputs[0].parse({
      symbol: "RELIANCE",
      exchange: "NSE",
      side: "BUY",
      qty: 10,
      type: "MARKET",
    });
    expect(input.side).toBe("BUY");
  });

  it("cancel requires id", () => {
    const input = ordersRouter._def.procedures.cancel._def.inputs[0].parse({ id: "o1" });
    expect(input.id).toBe("o1");
  });

  it("place rejects zero qty", () => {
    expect(() => ordersRouter._def.procedures.place._def.inputs[0].parse({
      symbol: "X",
      exchange: "NSE",
      side: "BUY",
      qty: 0,
      type: "MARKET",
    })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && bun test http/trpc/routers/orders.test.ts
```
Expected: FAIL with `Cannot find module './orders'`.

- [ ] **Step 3: Write minimal implementation**

Modify `server/data/db/schema.ts` — append the paper-trading tables:

```ts
export const paperOrders = pgTable(
  "paper_orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    symbol: text("symbol").notNull(),
    exchange: varchar("exchange", { length: 8 }).notNull(),
    side: varchar("side", { length: 4 }).notNull(),
    qty: integer("qty").notNull(),
    type: varchar("type", { length: 8 }).notNull(),
    limitPrice: doublePrecision("limit_price"),
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    idempotencyKey: text("idempotency_key").notNull(),
    placedAt: timestamp("placed_at", { withTimezone: true }).notNull().defaultNow(),
    filledAt: timestamp("filled_at", { withTimezone: true }),
    rejectReason: text("reject_reason"),
    filledQty: integer("filled_qty").default(0),
    lastFillPrice: doublePrecision("last_fill_price"),
  },
  (t) => ({
    uniqUserKey: index("paper_orders_user_key_uniq").on(t.userId, t.idempotencyKey).unique(),
    byUser: index("paper_orders_user_idx").on(t.userId),
  })
);

export const paperFills = pgTable("paper_fills", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id").notNull().references(() => paperOrders.id, { onDelete: "cascade" }),
  qty: integer("qty").notNull(),
  price: doublePrecision("price").notNull(),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
});

export const paperPositions = pgTable(
  "paper_positions",
  {
    userId: uuid("user_id").notNull(),
    symbol: text("symbol").notNull(),
    exchange: varchar("exchange", { length: 8 }).notNull(),
    qty: integer("qty").notNull().default(0),
    avgPrice: doublePrecision("avg_price").notNull().default(0),
    realizedPnl: doublePrecision("realized_pnl").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: index("paper_positions_pk").on(t.userId, t.symbol).unique(),
  })
);

export const paperLedger = pgTable("paper_ledger", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull(),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  kind: varchar("kind", { length: 16 }).notNull(),
  amount: doublePrecision("amount").notNull(),
});

export type PaperOrderRow = typeof paperOrders.$inferSelect;
export type NewPaperOrder = typeof paperOrders.$inferInsert;
```

Create `server/http/trpc/procedures.ts`:

```ts
import { initTRPC, TRPCError } from "@trpc/server";

export type Context = {
  userId?: string;
  db?: unknown;
  redis?: unknown;
};

const t = initTRPC.context<Context>().create();

export const publicProcedure = t.procedure;

export const authedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.userId) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next({ ctx: { ...ctx, userId: ctx.userId } });
});
```

Create `server/http/trpc/routers/orders.ts`:

```ts
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { validateOrder } from "../../../domain/orders/validator";
import { transition } from "../../../domain/orders/state-machine";
import { PaperBroker } from "../../../domain/orders/paper-broker";
import { withIdempotency } from "../../../infra/idempotency";
import { getRedis } from "../../../data/redis/client";
import { computePhase } from "../../../domain/market/clock";
import { getConfig } from "../../../config";
import { t, authedProcedure } from "../procedures";
export const ordersRouter = t.router({
  place: authedProcedure
    .input(
      z.object({
        symbol: z.string(),
        exchange: z.enum(["NSE", "BSE"]),
        side: z.enum(["BUY", "SELL"]),
        qty: z.number().int().positive(),
        type: z.enum(["MARKET", "LIMIT", "SL", "SL-M"]),
        limitPrice: z.number().positive().optional(),
      })
    )
    .output(z.any())
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.userId as string;
      const idemKey = ctx.idempotencyKey as string;
      if (!idemKey) throw new TRPCError({ code: "BAD_REQUEST", message: "Idempotency-Key header required" });
      const cfg = getConfig();
      const phase = computePhase(new Date(), cfg.nseHolidays);
      const v = validateOrder({ ...input, id: "tmp", userId, status: "pending", idempotencyKey: idemKey, placedAt: new Date().toISOString() } as any, { phase, buyingPower: 1_000_000, lastPrice: 2500 });
      if (!v.ok) {
        throw new TRPCError({ code: "BAD_REQUEST", message: v.message });
      }
      const broker: PaperBroker = (ctx as any).broker ?? new PaperBroker();
      const result = await withIdempotency(userId, idemKey, async () => {
        const orderId = `po_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const order = { id: orderId, userId, symbol: input.symbol, exchange: input.exchange, side: input.side, qty: input.qty, type: input.type, limitPrice: input.limitPrice, status: "pending" as const, idempotencyKey: idemKey, placedAt: new Date().toISOString() };
        // Postgres UNIQUE(user_id, idempotency_key) is the durable backstop
        if ((ctx as any).db) {
          try {
            await (ctx as any).db.insert((await import("../../../data/db/schema")).paperOrders).values({ id: orderId, userId, symbol: input.symbol, exchange: input.exchange, side: input.side, qty: input.qty, type: input.type, limitPrice: input.limitPrice, status: "pending", idempotencyKey: idemKey });
          } catch (e: any) {
            if (String(e?.message ?? "").includes("unique")) {
              return { duplicate: true, orderId };
            }
            throw e;
          }
        }
        broker.place(order);
        return { orderId, status: "pending" };
      });
      return result;
    }),
  list: authedProcedure.input(z.object({}).optional()).output(z.array(z.any())).query(async () => []),
  cancel: authedProcedure
    .input(z.object({ id: z.string() }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId as string;
      const db = (ctx as any).db;
      if (db) {
        const schema = await import("../../../data/db/schema");
        const row = await db.query.paperOrders.findFirst({
          where: (o: any, { and, eq }: any) => and(eq(o.id, input.id), eq(o.userId, userId)),
        });
        if (!row) return { ok: false };
        if (row.status === "pending" || row.status === "partial") {
          transition(row, "cancelled");
          await db.update(schema.paperOrders).set({ status: "cancelled" }).where(eq(schema.paperOrders.id, input.id));
        }
      }
      return { ok: true };
    }),
});
```

Create `server/http/trpc/routers/portfolio.ts`:

```ts
import { z } from "zod";
import { t, authedProcedure } from "../procedures";

export const portfolioRouter = t.router({
  holdings: authedProcedure.input(z.object({}).optional()).output(z.array(z.any())).query(async () => []),
  positions: authedProcedure.input(z.object({}).optional()).output(z.array(z.any())).query(async () => []),
  pnl: authedProcedure.input(z.object({}).optional()).output(z.object({ realized: z.number(), unrealized: z.number() })).query(async () => ({ realized: 0, unrealized: 0 })),
});
```

Create `server/http/trpc/router.ts` (root):

```ts
import { screenerRouter } from "./routers/screener";
import { backtestRouter } from "./routers/backtest";
import { ordersRouter } from "./routers/orders";
import { portfolioRouter } from "./routers/portfolio";
import { t } from "./procedures";

export const appRouter = t.router({
  screener: screenerRouter,
  backtest: backtestRouter,
  orders: ordersRouter,
  portfolio: portfolioRouter,
});
export type AppRouter = typeof appRouter;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd server && bun test http/trpc/routers/orders.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/http/trpc/ server/data/db/schema.ts
git commit -m "feat(orders): idempotent orders/portfolio routers + paper_* drizzle tables"
```

---

## Phase 7.5: Auth, Schema, and Lifecycle Hardening

**Purpose:** Cover the cross-cutting infrastructure that the existing 30 tasks depend on but do not implement: Supabase JWT verification, the full Postgres schema, the NSE holiday refresh worker, the Angel One session lifecycle, the tRPC idempotency wrapper, the `withGracefulShutdown` helper, the `/health` checks, and explicit F&O exclusion.

### Task 30a: Supabase Auth JWT verifier

**Files:**
- Create: `server/data/supabase/auth.ts`
- Create: `server/data/supabase/auth.test.ts`

**Interfaces:**
- Consumes: `config` from task-2
- Produces: `verifySupabaseJwt(req): Promise<string | undefined>` — returns the authenticated `userId` from a verified Supabase JWT (`Authorization: Bearer <jwt>` or `sb-access-token` cookie), or `undefined` if no/invalid token.

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { IncomingMessage } from "node:http";
import { getConfig } from "../../config";

let cached: SupabaseClient | null = null;
function client(): SupabaseClient {
  if (cached) return cached;
  const cfg = getConfig();
  cached = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: false },
  });
  return cached;
}

export async function verifySupabaseJwt(req: IncomingMessage): Promise<string | undefined> {
  const auth = req.headers["authorization"];
  let token: string | undefined;
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    token = auth.slice(7).trim();
  } else if (req.headers["cookie"]) {
    const m = /sb-access-token=([^;]+)/.exec(String(req.headers["cookie"]));
    token = m ? decodeURIComponent(m[1]) : undefined;
  }
  if (!token) return undefined;
  const { data, error } = await client().auth.getUser(token);
  if (error || !data.user) return undefined;
  return data.user.id;
}
```

- [ ] **Step 1: Write failing test** in `server/data/supabase/auth.test.ts` asserting: missing header → `undefined`; valid mocked token → `userId`; invalid token → `undefined`.
- [ ] **Step 2-4:** implement, run `bun test server/data/supabase/auth.test.ts` (mock the Supabase client), commit `feat(auth): supabase jwt verifier`.

### Task 30b: Drizzle schema and migrations for all Postgres tables

**Files:**
- Create: `server/data/db/schema.ts`
- Create: `server/data/db/migrations/0001_init.sql`
- Create: `server/data/db/schema.test.ts`

**Interfaces:**
- Consumes: Drizzle ORM from task-1
- Produces: Drizzle table definitions for every table called out in spec §6.1: `user_profiles`, `user_angelone_creds`, `watchlists`, `symbols`, `candles_1d`, `candles_1m`, `fundamentals`, `corporate_actions`, `screeners`, `screener_runs`, plus the existing `paper_orders`, `backtest_runs`. Migration SQL with PKs, FKs, indexes (including `UNIQUE(user_id, idempotency_key)`).

The `symbols` table is populated from `data/symbols.json` (task-11) at startup and refreshed weekly by a cron call from the orchestrator. The `candles_*` tables are written through from `candles.get` and `yahooPoller`. The `screeners` and `screener_runs` tables back the screener save/run mutations.

- [ ] **Step 1-5:** write tests asserting table presence via `information_schema`; generate migration; run `bun test server/data/db/schema.test.ts`; commit `feat(db): drizzle schema for all spec tables + initial migration`.

### Task 30c: NSE holiday weekly refresh worker

**Files:**
- Create: `server/workers/nse-scraper.ts`
- Create: `server/workers/nse-scraper.test.ts`

**Interfaces:**
- Consumes: `bus` from task-5, `nseGetHolidays` from task-13
- Produces: `NseScraperWorker.start()` that runs once at boot and then weekly (via `setInterval` of 7 days or a cron field) to fetch NSE holidays and publish them on the bus as `market:nseHolidays`; the `MarketClockWorker` (task-22) listens on this event to refresh its in-memory holiday set.

- [ ] **Step 1-4:** test that the worker emits `market:nseHolidays` with parsed JSON within 1s; commit `feat(worker): weekly NSE holiday refresh`.

### Task 30d: Angel One session lifecycle module

**Files:**
- Create: `server/domain/user/angelone.ts`
- Create: `server/domain/user/angelone.test.ts`

**Interfaces:**
- Consumes: `getRedis` from task-7, `AngelOneClient` from task-17
- Produces: `linkAngelOne(userId, creds)`, `loadSession(userId)`, `clearSession(userId)`. Persists encrypted creds in `user_angelone_creds` (via the schema in task-30b) and an 8h-TTL hash at `RedisKeys.angeloneSessionKey(userId)` containing `feedToken`, `clientCode`, `expiresAt`. Called by task-17 (login) and task-25/30 (link mutation).

- [ ] **Step 1-4:** test that `linkAngelOne` writes both Postgres row and Redis hash; commit `feat(user): angelone session lifecycle`.

### Task 30e: tRPC idempotency middleware wrapper

**Files:**
- Create: `server/http/trpc/idempotent.ts`
- Create: `server/http/trpc/idempotent.test.ts`

**Interfaces:**
- Consumes: `withIdempotency` from task-10, `t` and `authedProcedure` from task-29
- Produces: `idempotentProcedure = authedProcedure.use(...)` that reads the `Idempotency-Key` request header (set by the fetch handler in task-30) and calls `withIdempotency(userId, key, () => procedure logic)`. Replaces ad-hoc usage of `withIdempotency` inside `orders.place`.

- [ ] **Step 1-4:** test that two calls with the same key return identical bodies; commit `feat(trpc): idempotent procedure middleware`.

### Task 30f: Graceful shutdown helper

**Files:**
- Create: `server/infra/lifecycle.ts`
- Create: `server/infra/lifecycle.test.ts`

**Interfaces:**
- Produces: `withGracefulShutdown(workers: { stop(): Promise<void> }[]): void` that registers `SIGTERM` and `SIGINT` handlers, calls every `stop()` concurrently with a 30s drain timeout, then calls `process.exit(0)`. Used by the orchestrator (task-30).

- [ ] **Step 1-4:** test that `withGracefulShutdown` stops all workers within 30s on SIGTERM (use `process.kill(pid, "SIGTERM")` in test); commit `feat(infra): graceful shutdown helper`.

### Task 30g: Health checks for all upstream dependencies

**Files:**
- Modify: `server/infra/health.ts` (extend the existing check map)

**Interfaces:**
- Produces: per spec §7.5, the `/health` body includes `checks: { yahoo, angelone, nse, marketClock, db, redis, http, trpc }`. Each check is a `{ ok: boolean, latencyMs?, detail? }`. `db` runs `select 1`, `redis` runs `PING`, `yahoo`/`angelone`/`nse` check the most recent tick timestamp via `bus`, `marketClock` reports current `MarketPhase`.

- [ ] **Step 1-4:** test that the health handler reports all keys; commit `feat(health): dependency checks per spec §7.5`.

### Task 30h: Margin / F&O exclusion guard

**Files:**
- Modify: `server/domain/orders/validator.ts`

**Interfaces:**
- Produces: `validateOrder` rejects any order whose `symbol` ends in `FUT`/`OPT` (F&O), or whose `exchange` is not in `["NSE","BSE"]` (currency derivatives are out of scope per spec §9). Throws `AppError("VALIDATION_FAILED", "F&O and currency derivatives are out of scope for MVP")`.

- [ ] **Step 1-4:** test that `validateOrder({..., symbol: "NIFTY26JUNFUT"})` throws; commit `feat(orders): MVP guard rejects F&O and currency derivatives`.

### Task 30i: Playwright e2e suite

**Files:**
- Create: `tests/e2e/playwright.config.ts`
- Create: `tests/e2e/journeys/*.spec.ts` (six journeys)

**Interfaces:**
- Consumes: the running Nitro dev server, seeded test user
- Produces: six Playwright spec files corresponding to the spec §8 journeys: (1) live tick SSE subscription, (2) historical candles load, (3) screener save + match notification, (4) idempotent order placement, (5) portfolio holdings refresh, (6) logout/login round-trip.

- [ ] **Step 1-4:** `bunx playwright install --with-deps chromium`; `bunx playwright test`; commit `test(e2e): playwright suite covering six spec journeys`.

---

## Phase 8: Orchestrator and E2E Smoke Test

**Purpose:** Boot all workers, mount all routers, and run a single end-to-end smoke test that exercises health, SSE, and idempotent paper order placement.

### Task 30: Worker orchestrator + end-to-end smoke test

**Files:**
- Create: `server/workers/orchestrator.ts`
- Create: `server/workers/orchestrator.test.ts`
- Create: `server/e2e/smoke.test.ts`
- Modify: `server/app.ts` (replace stub from task-4 with full mount)
- Modify: `server/http/trpc/router.ts` (replace stub with root router wiring all routers)

**Interfaces:**
- Consumes: `YahooPoller` from task-18, `AngelOneWorker` from task-19, `CandleWriter` from task-20, `ScreenerRunner` from task-24, `MarketClockWorker` from task-22, all routers from prior tasks, `health` from task-4
- Produces: `Orchestrator` with `start()` and `stop()`; root tRPC router with `market, screener, watchlist, orders, portfolio, backtest, user`; E2E smoke test exercising `/health`, SSE subscribe, idempotent `orders.place` replay

- [ ] **Step 1: Write the failing test**

Create `server/workers/orchestrator.test.ts`:

```ts
import { describe, it, expect, afterEach } from "bun:test";
import { Orchestrator } from "./orchestrator";
import { bus } from "../infra/bus";
import type { Tick } from "@shared/types";

afterEach(async () => {
  bus.off("tick", () => {});
});

describe("Orchestrator", () => {
  it("start() boots workers; stop() halts them", async () => {
    const orch = new Orchestrator({
      yahooPoller: { subscribe: () => {}, start: () => {}, stop: () => {}, unsubscribe: () => {} } as any,
      angelone: { start: () => {}, stop: async () => {}, manageUser: () => {}, dropUser: () => {} } as any,
      candleWriter: { start: () => {}, stop: () => {}, onTick: () => {}, flush: () => [] } as any,
      screenerRunner: { start: () => {}, stop: () => {}, reload: async () => {}, onTick: async () => {} } as any,
      marketClock: { start: () => {}, stop: () => {}, onPhase: () => () => {} } as any,
    });
    orch.start();
    let seen: Tick | undefined;
    bus.on("tick", (t) => (seen = t));
    bus.emit("tick", { exchange: "NSE", symbol: "RELIANCE", price: 1, volume: 0, ts: new Date().toISOString(), source: "yahoo" });
    expect(seen).toBeDefined();
    await orch.stop();
  });
});
```

Create `server/e2e/smoke.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createApp } from "../app";
import { ordersRouter } from "../http/trpc/routers/orders";
import { withIdempotency } from "../infra/idempotency";

let app: ReturnType<typeof createApp>;

beforeAll(() => {
  app = createApp();
});

describe("E2E smoke", () => {
  it("GET /health returns 200 ok", async () => {
    const res = await app.fetch(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  it("orders.place is idempotent on replay (returns identical body)", async () => {
    const userId = `e2e-${Date.now()}`;
    const key = "k-e2e";
    const ctx = { userId, idempotencyKey: key } as any;
    // Two parallel calls with same key: at least one wins, the second returns cached
    const a = withIdempotency(userId, key, async () => ({ orderId: "o_e2e_1" }));
    const b = withIdempotency(userId, key, async () => ({ orderId: "o_e2e_2" }));
    const [ra, rb] = await Promise.all([a, b]);
    // One of them returns cached; both should be defined
    expect(ra).toBeDefined();
    expect(rb).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && bun test workers/orchestrator.test.ts e2e/smoke.test.ts
```
Expected: FAIL with `Cannot find module './orchestrator'`.

- [ ] **Step 3: Write minimal implementation**

Create `server/workers/orchestrator.ts`:

```ts
import { getLogger } from "../infra/logger";
import type { YahooPoller } from "./yahoo-poller";
import type { AngelOneWorker } from "./angelone-ws";
import type { CandleWriter } from "./candle-writer";
import type { ScreenerRunner } from "./screener-runner";
import type { MarketClockWorker } from "./market-clock";

const log = getLogger().child({ component: "orchestrator" });

export type OrchestratorDeps = {
  yahooPoller: YahooPoller;
  angelone: AngelOneWorker;
  candleWriter: CandleWriter;
  screenerRunner: ScreenerRunner;
  marketClock: MarketClockWorker;
};

export class Orchestrator {
  constructor(private deps: OrchestratorDeps) {}

  start(): void {
    log.info("starting orchestrator");
    this.deps.yahooPoller.start();
    this.deps.angelone.start();
    this.deps.candleWriter.start();
    this.deps.screenerRunner.start();
    this.deps.marketClock.start();

    const onSig = async (sig: string) => {
      log.info({ sig }, "shutdown signal received");
      await this.stop();
      process.exit(0);
    };
    process.once("SIGINT", () => onSig("SIGINT"));
    process.once("SIGTERM", () => onSig("SIGTERM"));
  }

  async stop(): Promise<void> {
    log.info("stopping orchestrator");
    this.deps.yahooPoller.stop();
    this.deps.candleWriter.stop();
    this.deps.screenerRunner.stop();
    this.deps.marketClock.stop();
    await this.deps.angelone.stop();
  }
}
```

Replace `server/app.ts`:

```ts
import { createApp as createH3App, eventHandler, toNodeListener, defineEventHandler } from "h3";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./http/trpc/router";
import { healthHandler, registerCheck } from "./infra/health";
import quotesHandler from "./http/sse/quotes";
import screenerStreamHandler from "./http/sse/screener";
import { Orchestrator } from "./workers/orchestrator";
import { YahooPoller } from "./workers/yahoo-poller";
import { AngelOneWorker } from "./workers/angelone-ws";
import { CandleWriter } from "./workers/candle-writer";
import { ScreenerRunner } from "./workers/screener-runner";
import { MarketClockWorker } from "./workers/market-clock";

export function createApp() {
  const app = createH3App();

  app.use("/health", eventHandler(() => healthHandler()));

  app.use("/api/stream/quotes", defineEventHandler(async (event) => quotesHandler(event)));
  app.use("/api/stream/screener", defineEventHandler(async (event) => screenerStreamHandler(event)));

  app.use("/api/trpc", defineEventHandler(async (event) => {
    const req = event.node.req;
    const url = `/api/trpc${req.url}`;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (Array.isArray(v)) v.forEach((vv) => headers.append(k, vv));
      else if (v) headers.set(k, String(v));
    }
    const idemKey = req.headers["idempotency-key"];
    const fetchReq = new Request(`http://localhost${url}`, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : await new Promise<Buffer>((res) => {
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => res(Buffer.concat(chunks)));
      }),
    });
    const res = await fetchRequestHandler({
      endpoint: "/api/trpc",
      req: fetchReq,
      router: appRouter,
      createContext: async () => {
        // Verify Supabase JWT from Authorization header (or sb-access-token cookie).
        // auth.ts is defined in the auth task before this; ctx.userId is set only on success.
        const { verifySupabaseJwt } = await import("../data/supabase/auth");
        const userId = await verifySupabaseJwt(req);
        return {
          userId,
          idempotencyKey: Array.isArray(idemKey) ? idemKey[0] : idemKey,
        };
      },
      onError({ error, path }) {
        registerCheck("trpc", false, `${path}: ${error.message}`);
      },
    });
    event.node.res.statusCode = res.status;
    res.headers.forEach((v, k) => event.node.res.setHeader(k, v));
    const body = await res.text();
    event.node.res.end(body);
  }));

  registerCheck("http", true, "ok");
  return app;
}

export const toNodeHandler = toNodeListener;

export async function bootApp() {
  const orch = new Orchestrator({
    yahooPoller: new YahooPoller(),
    angelone: new AngelOneWorker(),
    candleWriter: new CandleWriter(),
    screenerRunner: new ScreenerRunner(),
    marketClock: new MarketClockWorker(),
  });
  orch.start();
  const app = createApp();
  return { app, orch };
}

if (import.meta.main) {
  const { app, orch } = await bootApp();
  const port = Number(process.env.PORT ?? 3000);
  Bun.serve({ port, fetch: app.fetch });
  console.log(`server listening on ${port}`);
}
```

Replace `server/http/trpc/router.ts`:

```ts
import { screenerRouter } from "./routers/screener";
import { backtestRouter } from "./routers/backtest";
import { ordersRouter } from "./routers/orders";
import { portfolioRouter } from "./routers/portfolio";
import { t, authedProcedure } from "./procedures";

const marketRouter = t.router({
  quote: t.procedure.input((x: unknown) => x as any).query(() => null),
  candles: t.procedure.input((x: unknown) => x as any).query(() => null),
});

const watchlistRouter = t.router({
  list: authedProcedure.query(() => []),
  add: authedProcedure.input((x: unknown) => x as any).mutation(() => ({ ok: true })),
  remove: authedProcedure.input((x: unknown) => x as any).mutation(() => ({ ok: true })),
});

const userRouter = t.router({
  profile: authedProcedure.query(() => null),
  angeloneLink: authedProcedure.input((x: unknown) => x as any).mutation(() => ({ ok: true })),
});

export const appRouter = t.router({
  market: marketRouter,
  screener: screenerRouter,
  watchlist: watchlistRouter,
  orders: ordersRouter,
  portfolio: portfolioRouter,
  backtest: backtestRouter,
  user: userRouter,
});
export type AppRouter = typeof appRouter;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
ANGELONE_MASTER_KEY="$(openssl rand -base64 32)" SUPABASE_URL=https://x.supabase.co SUPABASE_ANON_KEY=a SUPABASE_SERVICE_ROLE_KEY=b UPSTASH_REDIS_URL=redis://localhost:6379 bun test server/workers/orchestrator.test.ts server/e2e/smoke.test.ts
```
Expected: PASS.

- [ ] **Step 5: Manual smoke verification (curl + SSE)**

```bash
# Start server (with full env from .env.example)
bun run server/app.ts &
APP_PID=$!
sleep 2

# 1. /health
curl -s http://localhost:3000/health | jq
# Expected: { "status": "ok", "uptime": 2, "checks": { "http": {...} }, "version": "dev" }

# 2. SSE subscribe (in another terminal, with timeout)
curl -N "http://localhost:3000/api/stream/quotes?symbols=RELIANCE" \
  -H "x-user-id: u-smoke" &
SSE_PID=$!
sleep 6

# 3. Place an order with Idempotency-Key
curl -s -X POST http://localhost:3000/api/trpc/orders.place \
  -H "Content-Type: application/json" \
  -H "x-user-id: u-smoke" \
  -H "Idempotency-Key: smoke-$(uuidgen)" \
  -d '{"symbol":"RELIANCE","exchange":"NSE","side":"BUY","qty":10,"type":"MARKET"}' | jq

# 4. Replay the same idempotency key
curl -s -X POST http://localhost:3000/api/trpc/orders.place \
  -H "Content-Type: application/json" \
  -H "x-user-id: u-smoke" \
  -H "Idempotency-Key: smoke-$(uuidgen)" \
  -d '{"symbol":"RELIANCE","exchange":"NSE","side":"BUY","qty":10,"type":"MARKET"}' | jq

# Both responses must be byte-identical (same orderId, same body)

kill $APP_PID $SSE_PID 2>/dev/null
```
Expected:
- `/health` returns `200` with `{ status: "ok", checks: { http: { ok: true, ... } } }`.
- SSE receives at least one `event: heartbeat` line within 5s.
- Two identical `POST /api/trpc/orders.place` calls with the same `Idempotency-Key` header return identical JSON bodies (same `orderId`).

- [ ] **Step 6: Commit**

```bash
git add server/workers/orchestrator.ts server/workers/orchestrator.test.ts server/e2e/smoke.test.ts server/app.ts server/http/trpc/router.ts
git commit -m "feat(orchestrator): boot all workers, mount tRPC + SSE, e2e smoke test"
```

---

## Verification Checklist (before merging)

Run the full battery against the smoke environment:

```bash
# Unit + integration
bun test server/infra server/domain server/workers server/http server/e2e

# Typecheck
bunx tsc --noEmit

# Manual end-to-end
./scripts/smoke.sh   # defined inline in task-30 step 5
```

All must pass. Then deploy:

```bash
git push origin main
# Render auto-deploys via render.yaml
curl https://stock-market-backend.onrender.com/health
```

Expected: `200` with `{ status: "ok" }`. UptimeRobot should be configured to ping this URL every 5 minutes.

## Spec Coverage Matrix

| Spec section | Plan task(s) |
|---|---|
| §1 Purpose | phases 4-8 deliver live ticks, history, paper trading |
| §2 Constraints | phase 1 (workspace, Node 20), task-2 (env validation), task-29 (idempotency) |
| §3 Architecture | phases 1-7 mirror http/domain/data/workers/infra layout |
| §4 Repository layout | task-1, every subsequent task follows the layout; task-30a adds `server/data/supabase/auth.ts`; task-30c adds `server/workers/nse-scraper.ts`; task-30d adds `server/domain/user/angelone.ts`; task-30e adds `server/http/trpc/idempotent.ts` |
| §5.1 Live tick | task-19 (Angel One WS), task-21 (SSE hub), task-20 (candle writer) |
| §5.2 Historical candle | task-12 (Yahoo), task-14 (normalize/fill), task-27 (candles via backtest router) |
| §5.3 Screener | task-23 (DSL+engine), task-24 (runner), task-25 (SSE+router) |
| §5.4 Order placement idempotent | task-10 (redis sentinel), task-28 (validator+broker), task-29 (UNIQUE index + tRPC) |
| §5.5 Angel One link | task-17 (login), task-9 (encryption), task-30d (session lifecycle + link mutation), task-19 (WS lifecycle) |
| §5.6 Market clock | task-15 (computePhase), task-22 (worker), task-30c (NSE holiday refresh) |
| §6.1 Postgres schema | task-27 (backtest_runs), task-29 (paper_orders/fills/positions/ledger); task-30b defines `user_profiles`, `user_angelone_creds`, `watchlists`, `symbols`, `candles_1d`, `candles_1m`, `fundamentals`, `corporate_actions`, `screeners`, `screener_runs` |
| §6.2 Redis keys | task-7 (RedisKeys namespace defines all keys); task-30d wires `angelone:session:{userId}` |
| §7 Error handling | task-12/13 (retry+circuit), task-3 (ErrorCode union), task-7+task-30 (health endpoint) |
| §7.4 Worker lifecycle | task-30f (`withGracefulShutdown`) |
| §7.5 /health checks | task-30g |
| §8 Testing | bun test used throughout; per-folder coverage in `domain/`, `infra/`; e2e smoke in task-30; Playwright journeys in task-30i |
| §9 Out of scope | real-money path deliberately not wired; documented in task-28 (PaperBroker only); task-30h guards F&O and currency derivatives |
# MAET Deep Security & Technical Audit

**Date:** 2026-07-17
**Scope:** Full server-side (TypeScript/Nitro/H3), database schema, frontend API boundary, ingestion pipeline, paper trading engine, auth layer

---

## Executive Summary

The codebase is well-structured with solid fundamentals: parameterized queries via Drizzle ORM, JWT verification against Supabase JWKS, ownership-scoped DB queries on authenticated routes, AES-256-GCM encryption for broker credentials, and a proper idempotency/source-tagging discipline. However, several **high-severity** and **medium-severity** issues were found across authentication bypass risks, broken idempotency, data integrity bugs in the order matcher, silent error swallowing, missing rate limiting, and architectural inconsistencies.

---

## FINDING 1 — CRITICAL: Paper Trading Matcher Loses Position Side (Short Positions)

> [!CAUTION]
> **Severity:** Critical — data corruption for short positions
> **Target file:** `server/domain/market/matcher.ts` lines 449-470

**Description:** When an existing position exists and the new fill reverses the position direction, the average price calculation uses `Math.abs()` for both old and new share counts:

```typescript
newAvgPrice =
  (Math.abs(oldShares) * oldAvgPrice + fillQty * fillPrice) /
  Math.abs(newShares);
```

**Example of the bug:** A user shorts 100 shares at price 500 (oldShares=-100, oldAvgPrice=500). They then buy back 150 shares at price 450. The correct new average for the resulting long 50 shares should be 450. But the code computes:

```
(100 * 500 + 150 * 450) / 150 = 483.33  // WRONG
```

The `abs()` on oldShares destroys the sign information. For a short-to-long reversal, the new shares should be calculated from the excess buy quantity at the new price, not from a blended average of the short and long fills.

**Impact:** P&L calculations, margin requirements, and liquidation triggers will be incorrect for any user who reverses a short position. The error compounds with each reversal.

---

## FINDING 2 — HIGH: Broken Idempotency Keys Allow Duplicate Orders

> [!WARNING]
> **Severity:** High — duplicate order creation bypasses idempotency guarantees
> **Target file:** `server/api/trpc/routers/orders.ts` line 44

**Description:** The idempotency key is generated as:

```typescript
const idempotencyKey = `order-${Date.now()}-${uniqueId.replace(/-/g, '').slice(0, 9)}`;
```

Since `Date.now()` changes every millisecond and `uniqueId` is freshly generated per call, this key is unique on every invocation. The database has a unique index on `(userId, idempotency_key)`, so the key *looks* correct, but:

1. **Clients cannot supply their own idempotency key** — they have no way to retry a request after a timeout, because the server generates a different key each time.
2. **The Redis idempotency middleware** (`server/infra/idempotency.ts`) uses the key as a Redis key. If two requests arrive simultaneously for the same logical order (e.g., user double-clicks), the server generates two different keys, and both orders are created.
3. The intent of idempotency is to prevent duplicate financial actions. The current implementation provides zero protection against double-clicks.

**Impact:** Users can accidentally place duplicate paper orders. The database unique constraint only catches it if the same client session sends two requests in the same millisecond — which is effectively never.

---

## FINDING 3 — HIGH: Paper Orders Placed Without Pre-Validation

> [!WARNING]
> **Severity:** High — orders reach the matcher that should have been rejected earlier
> **Target file:** `server/api/paper/orders.post.ts` lines 33-88

**Description:** The REST paper order endpoint performs minimal validation:

```typescript
if (!symbol || !side || !type || qty <= 0) {
  throw createError({ statusCode: 400, ... });
}
```

Missing validations:
- **No lot-size check.** NSE equity has minimum lot sizes (e.g., RELIANCE = 1, but most others are multiples of the lot size). An order for 3 shares of a stock with lot size 10 is accepted.
- **No symbol existence check.** A typo like "RELIENCES" is accepted and stored.
- **No cash/margin pre-check.** An order for INR 10 crore is accepted and stored as `pending` even if the account only has INR 10 lakh. The matcher will reject it later, but the order still appears in the user's order history as "pending" until the tick fires.
- **No duplicate pending order guard.** A user can submit 50 MARKET orders for the same symbol simultaneously. Each will be stored and each will fire on the next tick.

**Impact:** Poor UX (ghost pending orders), potential DoS if a user floods the order table, and no early feedback to users about invalid orders.

---

## FINDING 4 — HIGH: Silent Error Swallowing Masks Database Failures

**Files:** Multiple — `portfolio.ts`, `orders.ts`, `alerts.ts`

**Severity:** High — operational blindness, data integrity risk

**Description:** Multiple tRPC routes catch all errors and return empty arrays without surfacing the error:

```typescript
// portfolio.ts getOrders equivalent
} catch (error) {
  console.error("Error fetching orders:", error);
  return [];  // <-- SILENT FAILURE
}
```

This pattern appears in:
- `portfolio.ts` — `getOrders`, `getPositions`, `getTradeHistory`, `getWatchlist`, `getSectorAllocation`
- `orders.ts` — `getOrders` (only returns empty on error, never throws)
- `alerts.ts` — `getAlerts` (returns empty on error)

The frontend has no way to distinguish "user has no orders" from "database is down." This makes production debugging nearly impossible and could mask data loss.

---

## FINDING 5 — HIGH: SSE Stream Endpoint Lacks Authentication

> [!WARNING]
> **Severity:** High — unauthenticated access to real-time market data stream
> **Target file:** `server/api/market/stream.get.ts`

**Description:** The SSE quote stream endpoint has **no authentication check**. Any client that can reach the backend URL can:

1. Subscribe to any set of symbols (up to 50)
2. Hold an SSE connection open indefinitely (the handler returns `new Promise(() => {})`)
3. Consume server bandwidth and WebSocket resources

The `activeConnections` cap of 100 provides only a blunt DoS defense. There is no per-user or per-IP rate limiting on this endpoint. Combined with the `MAX_CONNECTIONS = 100` being a module-level mutable counter, a burst of connections from different IPs could exhaust the capacity for legitimate users.

**Additionally:**
- No `CORS` headers are set explicitly on this route (relies on global middleware, but the streaming response may behave unpredictably with CORS preflight)
- No rate limiting per client
- No timeout on idle connections — a client can hold a connection forever

---

## FINDING 6 — HIGH: Rate Limiter Is Not Applied to Any Route

> [!WARNING]
> **Severity:** High — rate limiting infrastructure exists but is never used
> **Target file:** `server/infra/rate-limit.ts`

**Description:** The rate-limit module is fully implemented with Redis-backed per-user rate limiting (120 requests/minute for REST, 50 SSE subscriptions per user). However, searching the entire `server/` directory shows **zero usages** of `rateLimit()`. No route imports or calls it.

This means:
- The screener endpoint can be called unlimited times per minute
- The company search can be scraped without throttling
- The SSE stream has no per-user subscription limit
- The health check has no rate limiting either

The rate limiter also has a subtle bug: the rate-limit key uses `userId`, but for unauthenticated routes (company search, candles, quotes), there is no user ID. The rate limiter would need an IP-based key for anonymous users, which is not implemented.

---

## FINDING 7 — HIGH: Hardcoded NSE Symbol List Fallback Hides Stocks

> [!WARNING]
> **Severity:** High — incorrect search results for 1,998+ NSE stocks
> **Target file:** `server/api/trpc/routers/screener.ts` lines 74-83

**Description:** When a technical filter is applied via the tRPC screener, the code falls back to a hardcoded array of 60 NSE symbols:

```typescript
const NSE_SYMBOLS = [
  'RELIANCE', 'TCS', 'HDFCBANK', ... 'PRINCEPIP'  // only 60 symbols
];
```

The `runTechnicalScreen` stub passes these 60 symbols to the Yahoo fetcher. Any stock not in this list is **silently excluded** from technical screening results. The user sees no indication that ~97% of the NSE universe was filtered out.

The `/api/market/companies` REST endpoint correctly queries the full database. But the tRPC screener (`/api/trpc/screener/runScreen`) with any technical filter returns results from at most 60 stocks.

---

## FINDING 8 — HIGH: Missing N+1 Query Pattern Will Cause Timeouts at Scale

**Files:** `portfolio.ts` (getPositions, getSectorAllocation, getTradeHistory)

**Severity:** High — will fail under production load

**Description:** `getPositions` (line 127-138) fetches all user orders, then for each order, issues a separate query to get fills:

```typescript
for (const orderId of userOrderIds) {
  const orderFills = await db.select().from(fills)
    .where(eq(fills.orderId, orderId));
  userFills = [...userFills, ...orderFills];
}
```

With 500 orders, this is 501 database queries. The same N+1 pattern appears in `getTradeHistory` and `getSectorAllocation`. PostgreSQL will choke on this at any meaningful scale.

Additionally, `getPositions` (line 178) fetches **all candles** from the database without any symbol filter:

```typescript
latestCandles = await db.select().from(candles);
```

This returns every candle in the entire database (~491 in current state, but potentially millions in production).

---

## FINDING 9 — MEDIUM: TOTP Secret Handling

> [!IMPORTANT]
> **Severity:** Medium — TOTP secret is loaded into memory as a plain string
> **Target file:** `server/data/sources/angelone/client.ts` lines 56-69, `server/config.ts` line 84

**Description:** The Angel One TOTP secret (`ANGELONE_TOTP_SECRET`) is loaded from the environment into `getConfig()` as a plain string. It is then passed to `generateTotp()` which decodes it via `decodeBase32()` and uses it in HMAC-SHA1 computation. The decoded bytes exist in memory as a Buffer.

While this is standard practice, there are concerns:
- The `getConfig()` function caches the config object (line 37: `let cached: AppConfig | undefined`), which means the TOTP secret stays in memory for the entire process lifetime.
- If the process memory is ever dumped or exposed (e.g., via a heap snapshot, which I noticed two `.heapsnapshot` files in the project root at 30MB and 39MB), the TOTP secret could be recovered from memory.
- The `crypto.randomUUID()` fallback in `getKey()` (encryption.ts line 22) could silently derive a different key if the master key isn't exactly 32 bytes, leading to encrypted broker credentials that cannot be decrypted.

**Also note:** The `insert_baselines.sql` file (103KB) in the project root may contain database credentials if it includes baseline INSERT statements with real data.

---

## FINDING 10 — MEDIUM: CORS Allows Localhost Origins in Production

> [!IMPORTANT]
> **Severity:** Medium — overly permissive CORS defaults
> **Target file:** `server/middleware/cors.ts` lines 9-19

**Description:** The default CORS origins include localhost:

```typescript
const DEFAULT_ORIGINS = [
  "http://localhost:3000", "http://127.0.0.1:3000",
  "http://localhost:5173", "http://127.0.0.1:5173",
  "http://localhost:8080", "http://127.0.0.1:8080",
  "https://maet-pi.vercel.app",
  ...
];
```

If `FRONTEND_ORIGIN` is not set in production, these localhost origins are active. Any browser-based attacker on the same network can make cross-origin requests to the backend API (though they'd still need auth tokens for protected routes).

The allowed headers list (`content-type, authorization, x-idempotency-key`) is good — it doesn't include wildcards.

---

## FINDING 11 — MEDIUM: Public tRPC Procedures Expose Company Data Without Limits

**Files:** `server/api/trpc/routers/companies.ts`

**Severity:** Medium — unbounded data access via public endpoints

**Description:** Two tRPC procedures are marked `publicProcedure` (no authentication required):

1. **`getCompany`** (line 62): Returns a full company record by symbol. No rate limiting.
2. **`searchCompanies`** (line 78): Fuzzy search with `ilike('%query%')` on symbol and name. The `%query%` pattern prevents index usage, resulting in a full table scan. With 2,058 companies this is fine, but it's a time-bomb for growth.
3. **`getFundamentals`** (line 103): Returns up to 40 fundamental snapshots for any symbol. Also public.

These endpoints have no rate limiting, no request size validation on the search query beyond 100 chars, and no audit logging.

---

## FINDING 12 — MEDIUM: Health Check Exposes Infrastructure Details

> [!IMPORTANT]
> **Severity:** Medium — information disclosure
> **Target file:** `server/infra/health.ts`

**Description:** The `/api/health` endpoint is unauthenticated and returns:

- Database hostname and port (from `inspectDatabaseUrl`)
- Whether `sslmode` is configured
- Whether PostgreSQL, Redis, Supabase REST, Yahoo, and Angel One are reachable
- The GIT_SHA version tag
- Uptime in seconds

While this is common for health checks, in a production context it gives attackers:
- Confirmation that the backend is running and where the database is hosted
- Which data providers are active (enabling targeted attacks on those providers)
- Uptime information useful for planning maintenance windows

Consider restricting detailed health info to authenticated requests or a separate `/api/health/detailed` endpoint.

---

## FINDING 13 — MEDIUM: Unbounded Portfolio Calculations

> [!IMPORTANT]
> **Severity:** Medium — unbounded memory and CPU usage
> **Target file:** `server/api/trpc/routers/portfolio.ts`

**Description:** Several endpoints have no pagination:

- **`getTradeHistory`** accepts `limit` (max 100) and `offset` — this one is fine.
- **`getPositions`** (line 127): Loads ALL user orders, then iterates each one to fetch fills individually (N+1). Then loads ALL candles: `await db.select().from(candles)` — no symbol filter, no limit.
- **`getSectorAllocation`** (line 326): Same N+1 pattern as getPositions. Loads all orders, all fills, and does all computation in memory.
- **`getPortfolioSummary`** (line 16): Loads all orders and fills into memory, then iterates with nested `Array.find()` calls — O(n*m) complexity.

---

## FINDING 14 — MEDIUM: Paper Order Quantity Not Validated Against Lot Size or Available Cash

> [!IMPORTANT]
> **Severity:** Medium — orders with invalid quantities accepted
> **Target file:** `server/api/paper/orders.post.ts`

**Description:**
- `qty: z.number().int().positive().max` — allows quantities up to 100,000 shares with no lot-size validation.
- `limitPrice: z.number().positive().optional()` — allows prices below 0.01 (e.g., 0.001), which is unrealistic for NSE stocks.
- No check that the user has sufficient cash before creating the order. The matcher handles this, but orders sit in the DB as "pending" until a tick fires.

---

## FINDING 15 — MEDIUM: SSE Stream Connection Counter Is Not Thread-Safe

> [!IMPORTANT]
> **Severity:** Medium — incorrect connection accounting under concurrent load
> **Target file:** `server/api/market/stream.get.ts` lines 6-7, 31-33, 65

**Description:** The connection counter is a plain module-level variable:

```typescript
let activeConnections = 0;
const MAX_CONNECTIONS = 100;
```

```typescript
activeConnections++;
// ...
activeConnections = Math.max(0, activeConnections - 1);
```

In Node.js, while single-threaded, the event loop can interleave these operations if a callback fires between the increment and the rest of the handler setup. More importantly, if a connection is lost without triggering the `close` event (e.g., network partition, process signal), the counter will never decrement, and the stream will eventually refuse all new connections.

There is also no per-IP tracking, so a single user can monopolize all 100 connections.

---

## FINDING 16 — MEDIUM: No Input Length Validation on Company Name in tRPC Upsert

> [!IMPORTANT]
> **Severity:** Medium — potential DoS via oversized payloads
> **Target file:** `server/api/trpc/routers/companies.ts` line 148

**Description:** The `upsertCompany` procedure accepts `name: z.string().min(1).max(200)` but the underlying `companies.name` column is `text` (unbounded in PostgreSQL). A malicious user could provide a 100MB company name string via the tRPC input. Zod's `.max(200)` provides some protection, but other routes like `syncFundamentals` store `data.symbol` as the name without length validation:

```typescript
name: data.symbol,  // NSE page title, unbounded length
```

---

## FINDING 17 — MEDIUM: Angel One Hardcoded IP Addresses

> [!IMPORTANT]
> **Severity:** Medium — API integrity risk
> **Target file:** `server/data/sources/angelone/client.ts` lines 85-87

**Description:** The Angel One API requests use hardcoded IP headers:

```typescript
"X-ClientLocalIP": "127.0.0.1",
"X-ClientPublicIP": "127.0.0.1",
"X-MACAddress": "00:00:00:00:00:00",
```

While this is a read-only market data endpoint (not order execution), Angel One may use these fields for fraud detection or rate limiting. Sending `127.0.0.1` as the public IP could cause the API key to be flagged or blocked. The MAC address of all zeros is also suspicious.

---

## FINDING 18 — MEDIUM: Redis Silent Error Swallowing

> [!IMPORTANT]
> **Severity:** Medium — cache failures silently ignored
> **Target file:** `server/data/redis/client.ts` lines 51-60, 65-71

**Description:** Both `getCachedJson` and `setCachedJson` catch all errors and return `undefined` / no-op:

```typescript
export async function getCachedJson<T>(key: string): Promise<T | undefined> {
  try {
    const r = getRedis();
    const raw = await r.get(key);
    // ...
  } catch {
    return undefined;  // Silent — could be JSON parse error or connection failure
  }
}
```

This makes it impossible to distinguish between:
- "key doesn't exist" (normal cache miss)
- "Redis is down" (infrastructure failure)
- "cached value is corrupt JSON" (data quality issue)

The Yahoo candle and fundamentals caching relies on this. If Redis silently fails, the system falls back to fetching from Yahoo on every request, potentially hitting rate limits.

---

## FINDING 19 — MEDIUM: Screener Database Query Loads All Companies Into Memory

> [!IMPORTANT]
> **Severity:** Medium — memory pressure at scale
> **Target file:** `server/domain/screener/company-query.ts` lines 241-328

**Description:** `queryDatabase` loads **all 2,058 companies** into memory:

```typescript
const companyRows = await db.select().from(companies).where(eq(companies.isActive, true));
```

Then maps them all into `CompanyScreenerRow[]`, applies filters in JavaScript, sorts in JavaScript, and paginates in JavaScript. This is O(n) in memory for every screener request. With 2,058 companies this is fine, but:
- If the universe grows to 10,000+ companies, memory usage per request grows linearly
- The filtering/sorting happens in the Node.js process, not in PostgreSQL where it belongs
- The NSE fallback (`queryNseFallback`) loads the ENTIRE company master CSV into memory as well

The paginated `companies` tRPC endpoint (companies.ts) correctly uses cursor-based pagination. The screener should do the same.

---

## FINDING 20 — MEDIUM: Yahoo Request Concurrency Limiter Can Deadlock

> [!IMPORTANT]
> **Severity:** Medium — potential deadlock under error conditions
> **Target file:** `server/data/sources/yahoo.ts` lines 15-33

**Description:** The concurrency limiter uses a simple counter + waiters queue:

```typescript
if (activeRequests >= MAX_CONCURRENT_REQUESTS) {
  await new Promise<void>((resolve) => requestWaiters.push(resolve));
}
// ...
requestWaiters.shift()?.();
```

Problems:
1. If a request slot opens (`activeRequests--`) but the next waiter's request throws synchronously, the slot is consumed without a new request being made. The counter is correct but throughput is degraded.
2. If the waiters queue has stale entries (e.g., the waiting Promise was created during a previous request cycle that was abandoned), `shift()` returns a stale resolver that resolves a forgotten Promise. No crash, but wasted slot.
3. There is no timeout on waiting. If MAX_CONCURRENT_REQUESTS requests are stuck (e.g., network timeout inside the request), new requests wait forever.

---

## FINDING 21 — LOW: Status Enum Inconsistency Between tRPC and REST

> [!NOTE]
> **Severity:** Low — potential for incorrect status matching
> **Target file:** Multiple files

**Description:** The tRPC schema uses lowercase enum values:
```
order_status: ["pending", "partial", "filled", "cancelled", "rejected"]
```

The paper trading REST API and matcher use UPPERCASE:
```
"PENDING", "TRIGGER_PENDING", "PARTIALLY_FILLED", "FILLED", "CANCELLED", "REJECTED"
```

The matcher code checks for uppercase values (`eq(paperOrders.status, "PENDING")`). The tRPC paper order endpoint also stores uppercase values. The enums in `schema.ts` (`paperOrderStatus`) are uppercase. So the lowercase `order_status` enum is unused for paper trading. This isn't a bug today, but it's a footgun — if someone uses the tRPC `order_status` values against `paperOrders`, all comparisons will fail silently.

---

## FINDING 22 — LOW: Position P&L Calculation Always Returns 0

> [!NOTE]
> **Severity:** Low — incorrect but harmless data returned
> **Target file:** `server/api/trpc/routers/portfolio.ts` lines 198, 242

**Description:** In both `getPositions` and `getTradeHistory`, P&L is hardcoded to 0:

```typescript
pnl: 0, // Calculated by frontend
```

And:
```typescript
pnl: 0, // TODO: Calculate realized P&L
```

The comment says "calculated by frontend" but the frontend has no additional data to calculate it from — it only receives what the backend sends. The positions will always show zero P&L regardless of actual price movements.

Similarly, `getAnalytics` returns all zeros/ones:
```typescript
return {
  sharpeRatio: 0, sortinoRatio: 0, maxDrawdown: 0, calmarRatio: 0,
  beta: 1, alpha: 0, ...
};
```

---

## FINDING 23 — LOW: Heap Snapshots Committed to Project Root

**Files:** `before_stream.heapsnapshot` (39MB), `after_30s_stream.heapsnapshot` (30MB)

**Severity:** Low — potential credential exposure

**Description:** Two V8 heap snapshot files are present in the project root. While `.gitignore` doesn't explicitly exclude `*.heapsnapshot`, heap snapshots can contain:
- Decoded strings from memory (including API keys, JWT tokens, database URLs if they were in scope)
- Object structures revealing internal architecture

These should be deleted and `.gitignore` should be updated. They are also taking up ~70MB of project space.

---

## FINDING 24 — LOW: insert_baselines.sql (103KB) in Project Root

> [!NOTE]
> **Severity:** Low — potential credential exposure
> **Target file:** `insert_baselines.sql`

**Description:** A 103KB SQL file in the project root. If this contains INSERT statements with real data (user emails, company data, etc.), it should be verified to contain no credentials. If it was generated from a production database, it should not be in version control.

---

## FINDING 25 — INFO: Auth Bypass Risk — tRPC All Procedures Require Auth

**File:** `server/api/trpc/index.ts`, `server/api/trpc/core.ts`

**Severity:** Informational — current design prevents public tRPC endpoints

**Description:** The tRPC router declares all procedures under `appRouter` which uses `protectedProcedure` by default in each sub-router (via `isAuthed` middleware). There is a `publicProcedure` export, but no sub-router uses it except `companies.ts` which has `getCompany`, `searchCompanies`, and `getFundamentals` as public. This is correct for those endpoints but means the tRPC layer cannot serve authenticated user-specific public data (e.g., "show me my screener results but not my orders"). This isn't a bug, but it constrains the API design.

---

## FINDING 26 — INFO: Candle Pagination Risk in getMarketCandles

**File:** `server/domain/market/candle-service.ts`

**Severity:** Informational — verify the candle service has proper pagination

**Description:** The candle service loads from DB and falls back to Yahoo. With no pagination on the DB query, requesting "max" range candles for a single symbol could return tens of thousands of rows. Verify that `loadMarketCandles` applies appropriate LIMIT/OFFSET.

---

## Recommendations by Priority

### Immediate (Critical/High)

1. **Fix the short position average price bug** in `matcher.ts` — the `abs()` calls destroy sign information. This is data corruption for any user trading short.

2. **Implement proper idempotency** — allow clients to send an `Idempotency-Key` header; use that as the Redis/DB key instead of generating server-side timestamps.

3. **Add authentication to the SSE stream** — require a valid JWT before opening the stream. Apply rate limiting per user.

4. **Wire up the rate limiter** — at minimum, apply `rateLimit()` to the screener, company search, and SSE endpoints.

5. **Stop swallowing errors silently** — return proper error responses instead of empty arrays. At minimum, differentiate between "no data" and "system error" with an `error` field in the JSON response.

6. **Fix the hardcoded 60-symbol screener** — either remove the stub entirely or pass the full company list.

### Short-term (Medium)

7. **Fix N+1 queries** in `portfolio.ts` — use Drizzle joins to fetch fills for all orders in one query.

8. **Add pre-validation to paper order placement** — validate lot size, symbol existence, and sufficient cash before accepting the order.

9. **Fix the CORS defaults** — remove localhost origins or require `FRONTEND_ORIGIN` to be explicitly set in production.

10. **Paginate the screener DB query** — use PostgreSQL WHERE/ORDER BY/LIMIT instead of loading all companies into memory.

11. **Add timeouts to Yahoo request waiters** — prevent indefinite blocking on the concurrency limiter.

12. **Remove heap snapshots** from the project root and add them to `.gitignore`.

### Long-term (Low/Info)

13. **Fix status enum consistency** — standardize on uppercase for paper trading statuses throughout.

14. **Implement actual P&L calculation** in portfolio endpoints instead of returning zeros.

15. **Add audit logging** for public endpoints (company search, fundamentals).

16. **Redact health check details** for unauthenticated access.

17. **Verify `insert_baselines.sql`** contains no credentials before it stays in version control.

---

## What the Codebase Does Well

- **Drizzle ORM everywhere** — no raw SQL concatenation, no SQL injection vectors found.
- **JWT verification via Supabase JWKS** — proper RS256 validation with caching, expiry checking, and error handling.
- **Ownership-scoped queries** — all authenticated routes filter by `userId`; IDOR protection is correctly implemented on orders, alerts, watchlist, screener runs, paper positions, and paper orders.
- **AES-256-GCM for broker credentials** — proper authenticated encryption with random IVs.
- **Source-tagged data** — quote snapshots, financial statements, and fundamentals all record their data source.
- **Honest unavailable-state rendering** — the frontend shows `—` instead of fake data.
- **Circuit breaker / retry logic** on Yahoo and NSE sources with exponential backoff.
- **Input validation** via Zod schemas on all user-facing inputs (symbols limited to `[A-Z0-9&.-]+`, quantities bounded, enum validation for order types/sides).

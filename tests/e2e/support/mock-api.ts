/**
 * In-browser fake of the MAET backend. Every request the app makes to the API origin
 * (https://api.test, baked in at build time as VITE_API_URL) or to its own /api routes
 * is answered here through page.route, so the suite needs no database, broker or
 * production secret. Responses follow the real contracts:
 *   - /api/market/{quotes,companies,company,candles}: server/api/market/*.get.ts
 *   - /api/market/stream: text/event-stream with `snapshot` and `tick` events
 *   - /api/trpc/<procedure>: non-batched tRPC, `{result:{data}}` / `{error:{...}}`
 *   - /api/paper/stream: the paper SSE frames server/api/paper/stream.get.ts writes
 *   - https://supabase.test/auth/v1/{token,signup,logout}: Supabase Auth (GoTrue) REST,
 *     with the request and error shapes GoTrue uses
 * Protected procedures answer 401 without a Bearer token, like protectedProcedure.
 */
import type { Page, Request, Route } from "@playwright/test";
import type { MarketCandle, MarketCompany } from "../../../src/lib/market-api";
import type { WorkspaceSavedScreener } from "../../../src/lib/trpc";
import { PaperOrderCommandSchema } from "../../../server/modules/paper-trading/contracts";
import { CreateStrategyInputSchema } from "../../../shared/strategy/contracts";
import type { CorporateActionEvent } from "../../../shared/types/corporate-actions";
import { WORLD_EVENTS, WORLD_MACRO, WORLD_NEWS } from "./world-data";
import {
  ACCESS_TOKEN,
  BASE_PRICES,
  COMPANIES,
  CREATED_STRATEGY_ID,
  E2E_EMAIL,
  E2E_PASSWORD,
  FIELD_AVAILABILITY,
  FIXED_NOW,
  REFRESH_TOKEN,
  SUPABASE_ANON_KEY,
  SUPABASE_ORIGIN,
  USER_ID,
  candlesFor,
  paperAccountRow,
  paperLedgerRow,
  paperOrderRow,
  quoteFor,
  type MarketSession,
  type PaperLedgerEntryWire,
  type PaperAccountWire,
  type PaperOrderWire,
} from "./data";

const WORLD_UPSTREAM_HOSTS = {
  "eonet.gsfc.nasa.gov": "eonet",
  "api.gdeltproject.org": "gdelt",
} as const;

export const API_ORIGIN = "https://api.test";

export interface RecordedRequest {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: unknown;
}

type TrpcHandler = (input: unknown, request: Request) => unknown;

export type TrpcErrorCode = "BAD_REQUEST" | "UNAUTHORIZED" | "NOT_FOUND" | "CONFLICT" | "INTERNAL_SERVER_ERROR";

class TrpcError extends Error {
  constructor(
    readonly code: TrpcErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const TRPC_ERROR_STATUS = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_SERVER_ERROR: 500,
} as const;
const TRPC_ERROR_CODE = {
  BAD_REQUEST: -32600,
  UNAUTHORIZED: -32001,
  NOT_FOUND: -32004,
  CONFLICT: -32009,
  INTERNAL_SERVER_ERROR: -32603,
} as const;

// Sort keys accepted by server/domain/screener/company-query.ts that the fixture rows carry.
const SORT_FIELDS: Record<string, keyof MarketCompany> = {
  symbol: "symbol",
  price: "price",
  change_pct: "changePct",
  volume: "volume",
  market_cap: "marketCap",
  sector: "sector",
  pe: "pe",
};

function json(route: Route, status: number, body: unknown) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

/** One field of a tRPC input object, or undefined; the fake validates only what it reads. */
function inputValue(input: unknown, key: string): unknown {
  return typeof input === "object" && input !== null ? Reflect.get(input, key) : undefined;
}

function requireString(input: unknown, key: string): string {
  const value = inputValue(input, key);
  if (typeof value !== "string") throw new TrpcError("BAD_REQUEST", `Expected string "${key}"`);
  return value;
}

function sseFrame(event: string | null, data: unknown): string {
  return `${event ? `event: ${event}\n` : ""}data: ${JSON.stringify(data)}\n\n`;
}

export class MockApi {
  /** Every request the page sent to an /api path, on any origin, in order. */
  readonly requests: RecordedRequest[] = [];
  /** Rows GET /api/market/companies screens; a metric may be null, as the API may send it. */
  screenerRows: MarketCompany[] = COMPANIES;
  /** Exchange session the quote fixtures describe. */
  session: MarketSession = "open";
  /** Paper orders the fake account holds; placeOrder/cancelOrder mutate it. */
  readonly orders: PaperOrderWire[] = [];
  /** The account row paperTrading.getState returns. */
  account: PaperAccountWire = paperAccountRow();
  /** Caps listLedger pages below the requested limit, to exercise paging; null = no cap. */
  ledgerPageLimit: number | null = null;
  /** The account's saved screener definitions; deleteScreener archives one, as the router does. */
  readonly savedScreeners: WorkspaceSavedScreener[] = [];
  /** The tick each market SSE connection sends after its snapshot. */
  tick = { symbol: "NIFTY50", price: BASE_PRICES.NIFTY50 + 12.35 };
  /**
   * Dividends and splits /api/market/corporate-actions reports for every symbol, newest
   * first. The first two fall inside the 60 daily fixture candles (7 Sep – 5 Nov 2026).
   */
  corporateActions: CorporateActionEvent[] = [
    { kind: "dividend", exDate: "2026-10-14", amount: 24, currency: "INR", adjusted: false },
    { kind: "split", exDate: "2026-09-21", numerator: 2, denominator: 1 },
    { kind: "dividend", exDate: "2025-08-14", amount: 5.5, currency: "INR", adjusted: true },
    { kind: "dividend", exDate: "2024-08-19", amount: 5, currency: "INR", adjusted: true },
    { kind: "split", exDate: "2017-09-07", numerator: 1, denominator: 10 },
  ];
  worldEvents = structuredClone(WORLD_EVENTS);
  worldNews = structuredClone(WORLD_NEWS);
  worldMacro = structuredClone(WORLD_MACRO);
  /**
   * What NASA EONET and GDELT answer when the page asks them directly (the browser fallback).
   * `null` leaves the host blocked like every other third party.
   */
  worldUpstreams: { eonet: unknown; gdelt: unknown } = { eonet: null, gdelt: null };
  /** Every request the page sent to NASA EONET or GDELT, answered or not. */
  readonly upstreamRequests: URL[] = [];
  /**
   * The current generation's cash ledger listLedger serves, newest first; it matches the
   * fixture account (₹10,00,000 opening cash, no trades).
   */
  ledger: PaperLedgerEntryWire[] = [
    paperLedgerRow({
      id: "00000000-0000-4000-9000-000000000001",
      entryType: "INITIAL_CASH",
      amount: 1_000_000,
      balanceAfter: 1_000_000,
      createdAt: "2026-10-01T04:00:00.000Z",
    }),
  ];
  /** Every request the page sent to Supabase Auth, in order. */
  readonly authRequests: RecordedRequest[] = [];
  /** Refresh tokens the fake GoTrue still honours; revoke one by deleting it. */
  readonly validRefreshTokens = new Set([REFRESH_TOKEN]);
  /** Whether a sign-up must be confirmed by email first (GoTrue then returns no session). */
  signupRequiresConfirmation = true;

  private readonly queries = new Map<string, TrpcHandler>();
  private readonly mutations = new Map<string, TrpcHandler>();
  private readonly failures = new Map<string, { code: TrpcErrorCode; message: string }>();
  private readonly quotesServed = Promise.withResolvers<void>();

  constructor(private readonly page: Page) {
    this.registerDefaults();
  }

  async install(): Promise<void> {
    this.page.on("request", (request) => {
      const url = new URL(request.url());
      if (!url.pathname.startsWith("/api/")) return;
      let body: unknown = null;
      if (request.method() === "POST") {
        try {
          body = request.postDataJSON();
        } catch {
          body = request.postData();
        }
      }
      this.requests.push({ method: request.method(), url, headers: request.headers(), body });
    });

    const appOrigin = (url: URL) => url.hostname === "127.0.0.1" || url.hostname === "localhost";
    // Nothing leaves the machine: fonts, Supabase or any other third party is refused.
    await this.page.route(
      (url) => !appOrigin(url) && url.origin !== API_ORIGIN,
      (route) => route.abort("blockedbyclient"),
    );
    // Registered after the blanket refusal so it is consulted first; unset payloads fall back to it.
    await this.page.route(
      (url) => Object.hasOwn(WORLD_UPSTREAM_HOSTS, url.hostname),
      async (route, request) => {
        const url = new URL(request.url());
        this.upstreamRequests.push(url);
        const payload =
          this.worldUpstreams[WORLD_UPSTREAM_HOSTS[url.hostname as keyof typeof WORLD_UPSTREAM_HOSTS]];
        if (payload === null) return route.fallback();
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "access-control-allow-origin": "*" },
          body: JSON.stringify(payload),
        });
      },
    );
    // Supabase Auth: consulted before the blanket refusal, like the upstreams above.
    await this.page.route(
      (url) => url.origin === SUPABASE_ORIGIN,
      (route, request) => this.goTrue(route, request),
    );
    await this.page.route(
      (url) => url.origin === API_ORIGIN || (appOrigin(url) && url.pathname.startsWith("/api/")),
      (route, request) => this.handle(route, request),
    );
  }

  /** Override or add a query procedure; every fixture procedure requires the Bearer token. */
  onQuery(path: string, handler: TrpcHandler): void {
    this.queries.set(path, handler);
  }

  onMutation(path: string, handler: TrpcHandler): void {
    this.mutations.set(path, handler);
  }

  /**
   * Makes an authenticated call to `path` fail with `code` (e.g. INTERNAL_SERVER_ERROR for a
   * database outage) until called again with null.
   */
  failProcedure(path: string, failure: { code: TrpcErrorCode; message: string } | null): void {
    if (failure) this.failures.set(path, failure);
    else this.failures.delete(path);
  }

  /** Recorded tRPC calls, optionally for one procedure. */
  trpcCalls(path?: string): RecordedRequest[] {
    return this.requests.filter((request) => {
      if (!request.url.pathname.startsWith("/api/trpc/")) return false;
      return path === undefined || request.url.pathname === `/api/trpc/${path}`;
    });
  }

  candleRequests(): Array<{ symbol: string | null; tf: string | null; range: string | null }> {
    return this.requests
      .filter((request) => request.url.pathname === "/api/market/candles")
      .map(({ url }) => ({
        symbol: url.searchParams.get("symbol"),
        tf: url.searchParams.get("tf"),
        range: url.searchParams.get("range"),
      }));
  }

  private async handle(route: Route, request: Request): Promise<void> {
    const url = new URL(request.url());
    const path = url.pathname;
    try {
      if (path === "/api/world/events") return await json(route, 200, this.worldEvents);
      if (path === "/api/world/news") return await json(route, 200, this.worldNews);
      if (path === "/api/world/macro") return await json(route, 200, this.worldMacro);
      if (path === "/api/market/quotes") return await this.quotes(route, url);
      if (path === "/api/market/stream") return await this.marketStream(route, url);
      if (path === "/api/market/companies") return await json(route, 200, this.companies(url));
      if (path === "/api/market/company") return await this.companyDetail(route, url);
      if (path === "/api/market/candles") return await this.candles(route, url);
      if (path === "/api/market/corporate-actions")
        return await json(route, 200, {
          symbol: (url.searchParams.get("symbol") ?? "").toUpperCase(),
          source: "yahoo",
          asOf: FIXED_NOW,
          stale: false,
          events: this.corporateActions,
        });
      if (path === "/api/paper/stream") return await this.paperStream(route, request);
      if (path.startsWith("/api/trpc/"))
        return await this.trpc(route, request, path.slice("/api/trpc/".length));
      return await json(route, 404, { message: `No e2e fixture for ${request.method()} ${path}` });
    } catch (error) {
      // A closed page aborts in-flight fulfils; nothing is left to answer.
      if (!(error instanceof Error && /closed|destroyed/i.test(error.message))) throw error;
    }
  }

  private quotesPayload(symbols: string[]) {
    const live = this.session === "open";
    return {
      asOf: FIXED_NOW,
      source: live ? "angelone" : "yahoo",
      delayed: !live,
      marketPhase: live ? "OPEN" : "CLOSED",
      quotes: symbols.map((symbol) => quoteFor(symbol, this.session)),
      errors: [],
    };
  }

  private async quotes(route: Route, url: URL) {
    const symbols = (url.searchParams.get("symbols") ?? "").split(",").filter(Boolean);
    await json(route, 200, this.quotesPayload(symbols));
    this.quotesServed.resolve();
  }

  private async marketStream(route: Route, url: URL) {
    // The stream only refreshes what REST already delivered; answering it first would let
    // the REST response overwrite the tick and make the suite order-dependent.
    const timeout = Promise.withResolvers<void>();
    setTimeout(timeout.resolve, 5_000);
    await Promise.race([this.quotesServed.promise, timeout.promise]);
    const symbols = url.searchParams.getAll("symbols");
    let body = "retry: 5000\n\n" + sseFrame("snapshot", this.quotesPayload(symbols));
    if (symbols.includes(this.tick.symbol)) {
      body += sseFrame("tick", quoteFor(this.tick.symbol, this.session, this.tick.price));
    }
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream", "cache-control": "no-store" },
      body,
    });
  }

  private companies(url: URL) {
    const params = url.searchParams;
    const page = Number(params.get("page") ?? 1);
    const limit = Number(params.get("limit") ?? 50);
    const q = params.get("q")?.toLowerCase();
    const sectors = params.get("sector_in")?.toLowerCase().split(",");
    const buckets = params.get("bucket_in")?.split(",");
    // Like screenCompanyScreenerRow: a missing (null or absent) metric never satisfies a filter,
    // and a row left out only for that is reported, keyed by its fieldAvailability name.
    const excludedForMissingData = { total: 0, byField: {} as Record<string, number> };
    const matches = this.screenerRows.filter((company) => {
      const missing: string[] = [];
      const range = (key: string, field: string, value: number | null | undefined) => {
        const min = params.get(`${key}_min`);
        const max = params.get(`${key}_max`);
        if (min === null && max === null) return true;
        if (value == null) return missing.push(field) > 0;
        return (min === null || value >= Number(min)) && (max === null || value <= Number(max));
      };
      const passes =
        (!q ||
          [company.symbol, company.name, company.isin].some((field) =>
            field.toLowerCase().includes(q),
          )) &&
        (!sectors || (company.sector == null ? missing.push("sector") > 0 : sectors.includes(company.sector.toLowerCase()))) &&
        (!buckets || buckets.includes(company.marketCapBucket)) &&
        range("price", "price", company.price) &&
        range("market_cap", "marketCap", company.marketCap) &&
        range("pe", "pe", company.pe);
      if (passes && missing.length > 0) {
        excludedForMissingData.total += 1;
        for (const field of missing) {
          excludedForMissingData.byField[field] = (excludedForMissingData.byField[field] ?? 0) + 1;
        }
      }
      return passes && missing.length === 0;
    });
    const field = SORT_FIELDS[params.get("sortBy") ?? "symbol"] ?? "symbol";
    const direction = params.get("sortDir") === "desc" ? -1 : 1;
    matches.sort((a, b) => {
      const left = a[field];
      const right = b[field];
      if (left === right) return a.symbol.localeCompare(b.symbol);
      if (left == null) return 1;
      if (right == null) return -1;
      return (left < right ? -1 : 1) * direction;
    });
    return {
      asOf: FIXED_NOW,
      generatedAt: FIXED_NOW,
      source: "database",
      sourceSummary: ["NSE company master", "PostgreSQL stored snapshots"],
      total: matches.length,
      universeTotal: this.screenerRows.length,
      page,
      pageSize: limit,
      pageCount: Math.max(1, Math.ceil(matches.length / limit)),
      items: matches.slice((page - 1) * limit, page * limit),
      fieldAvailability: FIELD_AVAILABILITY,
      excludedForMissingData,
      capBucketMethodology:
        "Market-cap buckets from the stored fundamentals snapshot (e2e fixture).",
    };
  }

  private async companyDetail(route: Route, url: URL) {
    const symbol = url.searchParams.get("symbol") ?? "";
    const company = COMPANIES.find((row) => row.symbol === symbol);
    if (!company) return json(route, 404, { message: "Company not found" });
    const unavailable = (reason: string) => ({ available: false, reason });
    await json(route, 200, {
      generatedAt: FIXED_NOW,
      master: {
        symbol: company.symbol,
        name: company.name,
        exchange: "NSE",
        series: "EQ",
        isin: company.isin,
        sector: company.sector,
        industry: company.industry,
        marketCapBucket: company.marketCapBucket,
      },
      quote: {
        price: company.price,
        changePct: company.changePct,
        volume: company.volume,
        marketCap: company.marketCap,
        asOf: FIXED_NOW,
        source: "angelone",
      },
      statements: { annual: [], quarterly: [] },
      candles: candlesFor(company.symbol, "1d"),
      availability: {
        quote: {
          available: true,
          source: "angelone",
          reason: "No persisted or reachable quote source",
        },
        fundamentals: unavailable("No verified stored fundamentals snapshot"),
        balanceSheet: unavailable(
          "Balance sheet unavailable from the verified source for this symbol",
        ),
        incomeStatement: unavailable(
          "Profit & loss statement unavailable from the verified source for this symbol",
        ),
        cashFlow: unavailable(
          "Cash flow statement unavailable from the verified source for this symbol",
        ),
        history: {
          available: true,
          source: "database",
          reason: "Historical candles are unavailable",
        },
      },
    });
  }

  private async candles(route: Route, url: URL) {
    const symbol = (url.searchParams.get("symbol") ?? "RELIANCE").toUpperCase();
    const tf = (url.searchParams.get("tf") ?? "5m") as MarketCandle["tf"];
    await json(route, 200, {
      symbol,
      timeframe: tf,
      range: url.searchParams.get("range") ?? "5d",
      source: "yahoo",
      delayed: true,
      persisted: true,
      asOf: FIXED_NOW,
      candles: candlesFor(symbol, tf),
    });
  }

  private async paperStream(route: Route, request: Request) {
    if (request.headers().authorization !== `Bearer ${ACCESS_TOKEN}`) {
      return json(route, 401, { message: "Authentication required" });
    }
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream", "cache-control": "no-store" },
      body:
        sseFrame(null, { type: "CONNECTED", userId: USER_ID, timestamp: FIXED_NOW }) +
        `: heartbeat ${FIXED_NOW}\n\n`,
    });
  }

  /** Supabase Auth (GoTrue) REST: password and refresh grants, sign-up and logout. */
  private async goTrue(route: Route, request: Request) {
    const url = new URL(request.url());
    let body: unknown = null;
    try {
      body = request.postDataJSON();
    } catch {
      body = null;
    }
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "apikey, authorization, content-type",
      "access-control-allow-methods": "POST, OPTIONS",
    };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    this.authRequests.push({ method: request.method(), url, headers: request.headers(), body });
    const reply = (status: number, payload: unknown) =>
      route.fulfill({ status, headers: cors, contentType: "application/json", body: JSON.stringify(payload) });
    const error = (status: number, errorCode: string, msg: string) =>
      reply(status, { code: status, error_code: errorCode, msg });
    if (request.headers().apikey !== SUPABASE_ANON_KEY) {
      return reply(401, { message: "No API key found in request" });
    }
    const field = (key: string) => inputValue(body, key);
    const session = (email: unknown = E2E_EMAIL) => ({
      access_token: ACCESS_TOKEN,
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: REFRESH_TOKEN,
      user: { id: USER_ID, aud: "authenticated", email },
    });

    if (url.pathname === "/auth/v1/token") {
      const grant = url.searchParams.get("grant_type");
      if (grant === "password") {
        return field("email") === E2E_EMAIL && field("password") === E2E_PASSWORD
          ? reply(200, session())
          : error(400, "invalid_credentials", "Invalid login credentials");
      }
      if (grant === "refresh_token") {
        return this.validRefreshTokens.has(String(field("refresh_token")))
          ? reply(200, session())
          : error(400, "refresh_token_not_found", "Invalid Refresh Token: Refresh Token Not Found");
      }
      return error(400, "validation_failed", "unsupported_grant_type");
    }
    if (url.pathname === "/auth/v1/signup") {
      if (field("email") === E2E_EMAIL) return error(422, "user_already_exists", "User already registered");
      if (!this.signupRequiresConfirmation) return reply(200, session(field("email")));
      // GoTrue answers a sign-up awaiting confirmation with the bare user and no session.
      return reply(200, {
        id: "22222222-2222-4222-8222-222222222222",
        aud: "authenticated",
        role: "",
        email: field("email"),
        confirmation_sent_at: FIXED_NOW,
        identities: [],
      });
    }
    if (url.pathname === "/auth/v1/logout") {
      if (request.headers().authorization !== `Bearer ${ACCESS_TOKEN}`) {
        return error(401, "bad_jwt", "invalid JWT");
      }
      // scope=local revokes the refresh token of the session that signed out.
      this.validRefreshTokens.delete(REFRESH_TOKEN);
      return route.fulfill({ status: 204, headers: cors });
    }
    return error(404, "not_found", `No e2e fixture for ${request.method()} ${url.pathname}`);
  }

  private async trpc(route: Route, request: Request, path: string) {
    const isMutation = request.method() === "POST";
    const handler = (isMutation ? this.mutations : this.queries).get(path);
    try {
      if (!handler)
        throw new TrpcError(
          "NOT_FOUND",
          `No "${isMutation ? "mutation" : "query"}"-procedure on path "${path}"`,
        );
      if (request.headers().authorization !== `Bearer ${ACCESS_TOKEN}`) {
        throw new TrpcError("UNAUTHORIZED", "UNAUTHORIZED");
      }
      const failure = this.failures.get(path);
      if (failure) throw new TrpcError(failure.code, failure.message);
      const rawInput = isMutation
        ? request.postDataJSON()
        : new URL(request.url()).searchParams.get("input");
      const input = typeof rawInput === "string" ? JSON.parse(rawInput) : rawInput;
      await json(route, 200, { result: { data: handler(input, request) } });
    } catch (error) {
      if (!(error instanceof TrpcError)) throw error;
      await json(route, TRPC_ERROR_STATUS[error.code], {
        error: {
          message: error.message,
          code: TRPC_ERROR_CODE[error.code],
          data: { code: error.code, httpStatus: TRPC_ERROR_STATUS[error.code], path },
        },
      });
    }
  }

  private registerDefaults() {
    this.onQuery("paperTrading.getState", () => ({
      account: this.account,
      positions: [],
      orders: this.orders,
      fills: [],
      asOf: FIXED_NOW,
    }));
    // Pages newest first like the repository; the cursor here is an offset.
    this.onQuery("paperTrading.listLedger", (input) => {
      const limit = Math.min(Number(inputValue(input, "limit") ?? 100), this.ledgerPageLimit ?? 100);
      const offset = Number(inputValue(input, "cursor") ?? 0);
      const next = offset + limit;
      return {
        entries: this.ledger.slice(offset, next),
        nextCursor: next < this.ledger.length ? String(next) : null,
      };
    });
    this.onMutation("paperTrading.placeOrder", (input) => {
      const parsed = PaperOrderCommandSchema.safeParse(input);
      if (!parsed.success)
        throw new TrpcError("BAD_REQUEST", parsed.error.issues[0]?.message ?? "Invalid order");
      const command = parsed.data;
      const replay = this.orders.find((order) => order.idempotencyKey === command.idempotencyKey);
      const order =
        replay ??
        paperOrderRow({
          id: `00000000-0000-4000-8000-${String(this.orders.length + 1).padStart(12, "0")}`,
          type: command.type,
          symbol: command.symbol,
          exchange: command.exchange,
          side: command.side,
          quantity: command.quantity,
          limitPrice: "limitPrice" in command ? command.limitPrice : undefined,
          stopPrice: "stopPrice" in command ? command.stopPrice : undefined,
          clientOrderId: command.clientOrderId,
          idempotencyKey: command.idempotencyKey,
        });
      if (!replay) this.orders.push(order);
      // PlaceOrderResult from server/modules/paper-trading/service.ts.
      return {
        order,
        fill: null,
        account: this.account,
        position: null,
        idempotentReplay: Boolean(replay),
        asOf: FIXED_NOW,
      };
    });
    this.onMutation("paperTrading.cancelOrder", (input) => {
      const orderId = requireString(input, "orderId");
      const order = this.orders.find((row) => row.id === orderId);
      if (!order) throw new TrpcError("NOT_FOUND", "Order not found");
      if (order.status !== "PENDING" && order.status !== "TRIGGER_PENDING") {
        throw new TrpcError("CONFLICT", `Order ${orderId} is ${order.status}`);
      }
      order.status = "CANCELLED";
      order.cancelledAt = FIXED_NOW;
      return { success: true };
    });

    this.onQuery("workspace.listWatchlists", () => ({ items: [] }));
    this.onQuery("workspace.getOverview", () => ({
      watchlistCount: 0,
      screenerCount: 0,
      unreadNotifications: 0,
    }));
    // server/api/trpc/routers/workspace.ts: newest first, archived rows hidden.
    this.onQuery("workspace.listSavedScreeners", () =>
      this.savedScreeners.filter((screener) => !screener.isArchived).reverse(),
    );
    const savedScreener = (input: unknown) => {
      const screener = this.savedScreeners.find((row) => row.id === requireString(input, "screenerId"));
      if (!screener || screener.isArchived) {
        throw new TrpcError("NOT_FOUND", "Saved screener not found or access denied");
      }
      return screener;
    };
    this.onMutation("workspace.saveScreener", (input) => {
      const screener: WorkspaceSavedScreener = {
        id: `33333333-3333-4333-8333-${String(this.savedScreeners.length + 1).padStart(12, "0")}`,
        name: requireString(input, "name").trim(),
        description: null,
        universe: "NSE",
        criteria: inputValue(input, "criteria"),
        isPinned: false,
        isArchived: false,
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
        lastRunAt: null,
      };
      this.savedScreeners.push(screener);
      return screener;
    });
    this.onMutation("workspace.updateScreener", (input) => {
      const screener = savedScreener(input);
      const name = inputValue(input, "name");
      const criteria = inputValue(input, "criteria");
      if (typeof name === "string") screener.name = name.trim();
      if (criteria !== undefined) screener.criteria = criteria;
      return screener;
    });
    this.onMutation("workspace.deleteScreener", (input) => {
      savedScreener(input).isArchived = true;
      return { success: true };
    });
    this.onQuery("workspace.listRecentRuns", () => []);

    const strategies = new Map<string, unknown>();
    this.onMutation("strategyDefinitions.create", (input) => {
      // The real procedure validates strictly with this contract (server/api/trpc/routers/strategy-definitions.ts).
      const parsed = CreateStrategyInputSchema.strict().safeParse(input);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new TrpcError("BAD_REQUEST", issue ? `${issue.path.join(".")}: ${issue.message}` : "Invalid strategy");
      }
      const { name, description, definition } = parsed.data;
      const strategy = {
        id: CREATED_STRATEGY_ID,
        userId: USER_ID,
        name,
        description: description ?? null,
        status: "DRAFT",
        currentDraft: definition,
        schemaVersion: 1,
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
        archivedAt: null,
      };
      strategies.set(strategy.id, strategy);
      return { strategy };
    });
    this.onQuery("strategyDefinitions.get", (input) => {
      const strategy = strategies.get(requireString(input, "strategyId"));
      if (!strategy) throw new TrpcError("NOT_FOUND", "Strategy not found");
      return { strategy, versions: [] };
    });
    this.onQuery("strategyDefinitions.list", () => ({ strategies: [...strategies.values()] }));
  }
}

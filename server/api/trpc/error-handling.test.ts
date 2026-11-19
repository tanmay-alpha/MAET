import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { DrizzleQueryError } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";
import { companies } from "../../db/schema";
import { DatabaseUnavailableError } from "../../data/drizzle/availability";
import {
  createRouter,
  DATABASE_UNAVAILABLE_MESSAGE,
  INTERNAL_ERROR_MESSAGE,
  protectedProcedure,
  publicProcedure,
  reportTrpcError,
} from "./core";

const SECRET_INPUT = "hunter2-secret-input";
const LEAKY_SQL = 'select "cash" from "paper_accounts" where "user_id" = $1';

function databaseFailure(): DrizzleQueryError {
  const pgError = Object.assign(new Error('relation "paper_accounts" does not exist'), { code: "42P01" });
  return new DrizzleQueryError(LEAKY_SQL, [SECRET_INPUT], pgError);
}

function connectionFailure(code: string, host = "db.internal.example"): DrizzleQueryError {
  const cause = Object.assign(new Error(`connect ${code} ${host}:5432`), { code });
  return new DrizzleQueryError(LEAKY_SQL, [SECRET_INPUT], cause);
}

// Nothing listens on port 1: postgres.js fails exactly as it does against an unreachable host.
const unreachableSql = postgres("postgresql://postgres:postgres@127.0.0.1:1/maet", { max: 1, connect_timeout: 2, prepare: false });
const unreachableDb = drizzle(unreachableSql);
afterAll(() => unreachableSql.end({ timeout: 0 }));

const router = createRouter({
  dbFailure: publicProcedure.input(z.object({ secret: z.string() })).query(() => {
    throw databaseFailure();
  }),
  missingOrder: publicProcedure.query(() => {
    throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
  }),
  // Mimics routers that rethrow `new TRPCError({ message: err.message })`.
  copiedDbMessage: publicProcedure.query(() => {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: databaseFailure().message });
  }),
  // Same query shape as companies.searchCompanies, against a database that refuses connections.
  searchUnreachable: publicProcedure.query(() =>
    unreachableDb.select({ symbol: companies.symbol }).from(companies).limit(20)
  ),
  refused: publicProcedure.query(() => {
    throw connectionFailure("ECONNREFUSED");
  }),
  dnsFailure: protectedProcedure.query(() => {
    throw connectionFailure("ENOTFOUND");
  }),
  circuitOpen: publicProcedure.query(() => {
    throw new DatabaseUnavailableError();
  }),
  // Routers that wrap failures must keep the cause for the outage to be recognised.
  wrappedOutage: publicProcedure.query(() => {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Backtest execution failed", cause: connectionFailure("CONNECT_TIMEOUT") });
  }),
  // An outage text inside a deliberate client error stays that client error.
  badRequestMentioningOutage: publicProcedure.query(() => {
    throw new TRPCError({ code: "BAD_REQUEST", message: "bad input", cause: connectionFailure("ECONNREFUSED") });
  }),
});

type LogCall = { level: "error" | "debug"; payload: Record<string, unknown>; msg: string };

async function call(path: string, input?: unknown) {
  const logs: LogCall[] = [];
  const log = {
    error: (payload: Record<string, unknown>, msg: string) => logs.push({ level: "error", payload, msg }),
    debug: (payload: Record<string, unknown>, msg: string) => logs.push({ level: "debug", payload, msg }),
  };
  const query = input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify(input))}`;
  const res = await fetchRequestHandler({
    endpoint: "/api/trpc",
    req: new Request(`http://localhost/api/trpc/${path}${query}`),
    router,
    createContext: () => ({ email: null, role: "user" as const, userId: "user-1" }),
    onError: (opts) => reportTrpcError(opts, log),
  });
  return { res, text: await res.text(), logs };
}

const originalNodeEnv = process.env.NODE_ENV;
afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
});

describe("tRPC error boundary", () => {
  it("never sends database error details to production clients", async () => {
    process.env.NODE_ENV = "production";
    const { res, text } = await call("dbFailure", { secret: SECRET_INPUT });

    expect(res.status).toBe(500);
    for (const leaked of ["paper_accounts", SECRET_INPUT, "Failed query", "42P01", "stack", ".ts:"]) {
      expect(text).not.toContain(leaked);
    }
    const body = JSON.parse(text);
    expect(body.error.message).toBe(INTERNAL_ERROR_MESSAGE);
    expect(body.error.data.code).toBe("INTERNAL_SERVER_ERROR");
  });

  it("keeps deliberate client error messages in production", async () => {
    process.env.NODE_ENV = "production";
    const { res, text } = await call("missingOrder");
    expect(res.status).toBe(404);
    const body = JSON.parse(text);
    expect(body.error.message).toBe("Order not found");
    expect(body.error.data.code).toBe("NOT_FOUND");
  });

  it("logs internal errors with path, code and SQL text but without input or bound parameters", async () => {
    process.env.NODE_ENV = "production";
    const { logs } = await call("dbFailure", { secret: SECRET_INPUT });

    const errors = logs.filter((entry) => entry.level === "error");
    expect(errors).toHaveLength(1);
    const { payload } = errors[0]!;
    expect(payload).toMatchObject({ path: "dbFailure", code: "INTERNAL_SERVER_ERROR" });
    expect(payload.causes).toEqual([
      { name: "Error", query: LEAKY_SQL },
      { name: "Error", code: "42P01", message: 'relation "paper_accounts" does not exist' },
    ]);
    expect(JSON.stringify(payload)).not.toContain(SECRET_INPUT);
  });

  it("redacts bound parameters from messages that copied a Drizzle error's text", async () => {
    const { logs } = await call("copiedDbMessage");
    const [entry] = logs.filter((log) => log.level === "error");
    expect(JSON.stringify(entry!.payload)).not.toContain(SECRET_INPUT);
    expect(JSON.stringify(entry!.payload)).toContain("params: [redacted]");
  });
});

describe("tRPC database outage mapping", () => {
  it("answers 503 SERVICE_UNAVAILABLE when a public query cannot reach PostgreSQL", async () => {
    process.env.NODE_ENV = "production";
    const { res, text, logs } = await call("searchUnreachable");
    expect(res.status).toBe(503);
    const body = JSON.parse(text);
    expect(body.error.data.code).toBe("SERVICE_UNAVAILABLE");
    expect(body.error.message).toBe(DATABASE_UNAVAILABLE_MESSAGE);
    for (const leaked of ["127.0.0.1", "ECONNREFUSED", "companies", "stack"]) expect(text).not.toContain(leaked);
    // Operators still see the outage with its cause chain.
    const [entry] = logs.filter((log) => log.level === "error");
    expect(entry?.payload).toMatchObject({ path: "searchUnreachable", code: "SERVICE_UNAVAILABLE" });
    expect(JSON.stringify(entry?.payload.causes)).toContain("ECONNREFUSED");
  }, 10_000);

  it("maps refused, unresolvable, circuit-open and wrapped connection failures to 503 on every procedure kind", async () => {
    process.env.NODE_ENV = "production";
    for (const path of ["refused", "dnsFailure", "circuitOpen", "wrappedOutage"]) {
      const { res, text } = await call(path);
      expect({ path, status: res.status }).toEqual({ path, status: 503 });
      expect(text).not.toContain("db.internal.example");
      expect(text).not.toContain(SECRET_INPUT);
    }
  });

  it("keeps non-connection database errors and deliberate client errors as they were", async () => {
    expect((await call("dbFailure", { secret: SECRET_INPUT })).res.status).toBe(500);
    expect((await call("badRequestMentioningOutage")).res.status).toBe(400);
    expect((await call("missingOrder")).res.status).toBe(404);
  });
});

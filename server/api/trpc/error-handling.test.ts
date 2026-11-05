import { afterEach, describe, expect, it } from "bun:test";
import { TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { DrizzleQueryError } from "drizzle-orm";
import { z } from "zod";
import { createRouter, INTERNAL_ERROR_MESSAGE, publicProcedure, reportTrpcError } from "./core";

const SECRET_INPUT = "hunter2-secret-input";
const LEAKY_SQL = 'select "cash" from "paper_accounts" where "user_id" = $1';

function databaseFailure(): DrizzleQueryError {
  const pgError = Object.assign(new Error('relation "paper_accounts" does not exist'), { code: "42P01" });
  return new DrizzleQueryError(LEAKY_SQL, [SECRET_INPUT], pgError);
}

const router = createRouter({
  dbFailure: publicProcedure.input(z.object({ secret: z.string() })).query(() => {
    throw databaseFailure();
  }),
  missingOrder: publicProcedure.query(() => {
    throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
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
    createContext: () => ({ email: null, role: "user" as const }),
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
});

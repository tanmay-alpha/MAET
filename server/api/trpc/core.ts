import { initTRPC, TRPCError } from "@trpc/server";
import { DrizzleQueryError } from "drizzle-orm";
import { logger } from "../../infra/logger";

export type Context = {
  userId?: string;
  email: string | null;
  role: "user" | "admin";
};

export const INTERNAL_ERROR_MESSAGE = "Internal server error";

const t = initTRPC.context<Context>().create({
  errorFormatter({ shape, error }) {
    if (process.env.NODE_ENV !== "production") return shape;
    // Unexpected errors carry SQL text, bound parameters and hostnames in their
    // message; production clients only get a generic message and never a stack.
    // Deliberate TRPCErrors (BAD_REQUEST, NOT_FOUND, ...) keep their message.
    const { stack: _stack, ...data } = shape.data;
    return {
      ...shape,
      message: error.code === "INTERNAL_SERVER_ERROR" ? INTERNAL_ERROR_MESSAGE : shape.message,
      data,
    };
  },
});

type ErrorChainEntry = { name: string; code?: string; message?: string; query?: string };
type ErrorLog = { error(obj: object, msg: string): void; debug(obj: object, msg: string): void };

// Drizzle formats query failures as "Failed query: <sql>\nparams: <values>";
// wrappers that copy err.message carry the bound values (request input) along.
export function redactQueryParams(message: string): string {
  return message.replace(/\bparams:[\s\S]*$/u, "params: [redacted]");
}

function describeErrorChain(error: unknown): ErrorChainEntry[] {
  const chain: ErrorChainEntry[] = [];
  for (let current = error; current instanceof Error && chain.length < 5; current = current.cause) {
    chain.push({
      name: current.name,
      // Postgres SQLSTATE / Node errno codes are what operators search for.
      ...("code" in current && typeof current.code === "string" ? { code: current.code } : {}),
      // DrizzleQueryError's message embeds the bound parameters (request input);
      // keep only the parameterised SQL text.
      ...(current instanceof DrizzleQueryError
        ? { query: current.query }
        : { message: redactQueryParams(current.message) }),
    });
  }
  return chain;
}

/**
 * tRPC `onError` hook. Internal errors are always logged (in every
 * environment) with path, code and the cause chain; procedure input is never
 * logged. Expected client errors are only logged at debug level.
 */
export function reportTrpcError(
  { path, type, error }: { path?: string; type: string; error: TRPCError },
  log: ErrorLog = logger,
): void {
  const context = { path: path ?? "<no-path>", type, code: error.code };
  if (error.code !== "INTERNAL_SERVER_ERROR") {
    log.debug({ ...context, message: redactQueryParams(error.message) }, "tRPC request failed");
    return;
  }
  const origin = error.cause ?? error;
  // Stack frames only: the header line(s) repeat the message, which may embed parameters.
  const stack = origin.stack?.split("\n").filter((line) => line.trimStart().startsWith("at ")).join("\n");
  log.error({ ...context, causes: describeErrorChain(origin), stack }, "tRPC internal error");
}

const isAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.userId) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" });
  }

  return next({
    ctx: {
      ...ctx,
      userId: ctx.userId,
      role: ctx.role ?? "user",
    },
  });
});

const isAdmin = t.middleware(({ ctx, next }) => {
  if (!ctx.userId) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" });
  }
  if (ctx.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin authorization required" });
  }

  return next({
    ctx: {
      ...ctx,
      userId: ctx.userId,
      role: "admin" as const,
    },
  });
});

export const createRouter = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(isAuthed);
export const adminProcedure = protectedProcedure.use(isAdmin);

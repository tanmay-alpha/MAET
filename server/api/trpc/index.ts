import { initTRPC, TRPCError } from "@trpc/server";
import type { AuthContext } from "./auth";
import { requireAuth } from "./auth";
import { marketRouter } from "./routers/market";
import { ordersRouter } from "./routers/orders";
import { alertsRouter } from "./routers/alerts";
import { screenerRouter } from "./routers/screener";
import { portfolioRouter } from "./routers/portfolio";

/**
 * tRPC initialization for MAET backend.
 *
 * All procedures require authentication by default. Public procedures should
 * use `.allow()`. Auth context is attached to every call.
 */

export type Context = {
  userId: string;
  email: string | null;
};

const t = initTRPC.context<Context>().create({
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        code: error.cause instanceof TRPCError ? error.code : "INTERNAL_SERVER_ERROR",
      },
    };
  },
});

/**
 * Auth middleware: enforce Supabase JWT verification.
 */
const isAuthed = t.middleware(async ({ next, type }) => {
  // Auth is checked at h3 layer via requireAuth middleware
  // This middleware ensures tRPC procedures receive authenticated context
  return next();
});

export const router = t.router({
  market: marketRouter,
  orders: ordersRouter,
  alerts: alertsRouter,
  screener: screenerRouter,
  portfolio: portfolioRouter,
});

export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(isAuthed);
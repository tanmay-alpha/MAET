import { createRouter } from "./core";
import { marketRouter } from "./routers/market";
import { ordersRouter } from "./routers/orders";
import { alertsRouter } from "./routers/alerts";
import { screenerRouter } from "./routers/screener";
import { portfolioRouter } from "./routers/portfolio";
import { companiesRouter } from "./routers/companies";

/**
 * tRPC initialization for MAET backend.
 *
 * All procedures require authentication by default. Public procedures should
 * use `.allow()`. Auth context is attached to every call.
 */

export const appRouter = createRouter({
  market: marketRouter,
  orders: ordersRouter,
  alerts: alertsRouter,
  screener: screenerRouter,
  portfolio: portfolioRouter,
  companies: companiesRouter,
});

export const router = appRouter;
export type AppRouter = typeof appRouter;
export { publicProcedure, protectedProcedure } from "./core";
export type { Context } from "./core";

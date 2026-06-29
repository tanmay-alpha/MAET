import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { defineEventHandler } from "h3";
import { router } from "./index";
import { tryAuth } from "./auth";

// Nitro route handler for tRPC
export default defineEventHandler(async (event) => {
  // Try to authenticate user, but allow unauthenticated access too
  // Individual procedures use protectedProcedure for auth checks
  const authCtx = await tryAuth(event).catch(() => null);

  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: event.node.req,
    router: router,
    createContext: () => ({ userId: authCtx?.userId, email: authCtx?.email }),
    onError:
      process.env.NODE_ENV === "development"
        ? ({ path, error }) => {
            console.error(`tRPC error on ${path ?? "<no-path>"}:`, error);
          }
        : undefined,
  });
});

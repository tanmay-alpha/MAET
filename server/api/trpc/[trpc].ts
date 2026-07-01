import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { defineEventHandler, toWebRequest } from "h3";
import { appRouter } from "./index";
import { tryAuth } from "./auth";

// Nitro route handler for tRPC
export default defineEventHandler(async (event) => {
  // Try to authenticate user, but allow unauthenticated access too
  // Individual procedures use protectedProcedure for auth checks
  const authCtx = await tryAuth(event).catch(() => null);

  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: toWebRequest(event) as unknown as Request,
    router: appRouter,
    createContext: () => ({ userId: authCtx?.userId, email: authCtx?.email ?? null }),
    onError:
      process.env.NODE_ENV === "development"
        ? ({ path, error }) => {
            console.error(`tRPC error on ${path ?? "<no-path>"}:`, error);
          }
        : undefined,
  });
});

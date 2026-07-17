import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { defineEventHandler, toWebRequest, createError } from "h3";
import { appRouter } from "./index";
import { tryAuth } from "./auth";

// Nitro route handler for tRPC
export default defineEventHandler(async (event) => {
  // Try to authenticate user, but allow unauthenticated access too
  // Individual procedures use protectedProcedure for auth checks
  const authCtx = await tryAuth(event).catch(() => null);

  try {
    const webReq = toWebRequest(event) as unknown as Request;
    // Set 30-second timeout on requests using AbortSignal.timeout(30000)
    const timedReq = new Request(webReq, { signal: AbortSignal.timeout(30000) });

    return await fetchRequestHandler({
      endpoint: "/api/trpc",
      req: timedReq,
      router: appRouter,
      createContext: () => ({ userId: authCtx?.userId, email: authCtx?.email ?? null }),
      onError:
        process.env.NODE_ENV === "development"
          ? ({ path, error }) => {
              console.error(`tRPC error on ${path ?? "<no-path>"}:`, error);
            }
          : undefined,
    });
  } catch (error: any) {
    if (
      error.name === "TimeoutError" ||
      error.name === "AbortError" ||
      error.message?.includes("aborted") ||
      error.message?.includes("timeout")
    ) {
      throw createError({
        statusCode: 504,
        statusMessage: "Gateway Timeout",
        message: "Request timed out after 30 seconds",
      });
    }
    throw error;
  }
});

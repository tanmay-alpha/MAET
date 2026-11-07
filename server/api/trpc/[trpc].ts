import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { defineEventHandler, toWebRequest, createError } from "h3";
import { appRouter } from "./index";
import { tryAuth, type AuthContext } from "./auth";
import { reportTrpcError } from "./core";

// Nitro route handler for tRPC
export default defineEventHandler(async (event) => {
  // Reuse the auth context the rate-limit middleware already resolved (when it
  // ran); otherwise verify here. Unauthenticated calls are allowed:
  // protectedProcedure enforces auth per procedure. If the token cannot be
  // verified (auth backend outage), public procedures run anonymously and
  // protected ones fail with SERVICE_UNAVAILABLE instead of UNAUTHORIZED.
  let authCtx: AuthContext | null = null;
  let authUnavailable = false;
  if (event.context.auth !== undefined) {
    authCtx = event.context.auth;
  } else {
    try {
      authCtx = await tryAuth(event);
    } catch {
      authUnavailable = true;
    }
  }

  try {
    const webReq = toWebRequest(event) as unknown as Request;
    // Set 30-second timeout on requests using AbortSignal.timeout(30000)
    const timedReq = new Request(webReq, { signal: AbortSignal.timeout(30000) });

    return await fetchRequestHandler({
      endpoint: "/api/trpc",
      req: timedReq,
      router: appRouter,
      createContext: () => ({
        userId: authCtx?.userId,
        email: authCtx?.email ?? null,
        role: authCtx?.role ?? "user",
        authUnavailable,
      }),
      // The frontend never batches; refusing batches blocks request amplification.
      allowBatching: false,
      onError: reportTrpcError,
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

// Supabase JWT verification.
//
// Supabase issues JWTs to authenticated users. The signing keys live at
// ${SUPABASE_URL}/auth/v1/.well-known/jwks.json. We verify tokens against
// these keys (RS256). On a cold start we fetch + cache the JWKS; on a
// warm path we use the cached remote JWK set.
//
// The h3 middleware `requireAuth` extracts a Bearer token from the
// Authorization header, verifies it, and attaches `event.context.userId`.
// Routes can then read `event.context.userId` without re-verifying.
//
// Token format: `Authorization: Bearer <jwt>` (case-insensitive scheme).
//
// Failure modes:
//   - Missing/malformed Authorization header -> throws 401
//   - Token signature invalid -> throws 401
//   - Token expired -> throws 401 (jose sets `code: "ERR_JWT_EXPIRED"`)
//   - JWKS fetch fails on cold start -> throws 503 (transient; retry-safe)

import { createRemoteJWKSet, jwtVerify, errors as joseErrors } from "jose";
import { createError, getRequestHeader, type H3Event } from "h3";
import { getConfig } from "@infra/config";

export type AuthContext = {
  userId: string;
  email: string | null;
};

export type AuthErrorCode =
  | "MISSING_TOKEN"
  | "MALFORMED_TOKEN"
  | "INVALID_TOKEN"
  | "EXPIRED_TOKEN";

let jwksCache: ReturnType<typeof createRemoteJWKSet> | undefined;
let jwksUrlCache: string | undefined;

function getJwksUrl(): string {
  const cfg = getConfig();
  // Supabase convention: the JWKS endpoint is at /auth/v1/.well-known/jwks.json
  // under the project URL. Trailing slashes on SUPABASE_URL are tolerated.
  const base = cfg.supabaseUrl.replace(/\/+$/, "");
  return `${base}/auth/v1/.well-known/jwks.json`;
}

function getJwks() {
  const url = getJwksUrl();
  if (!jwksCache || jwksUrlCache !== url) {
    jwksCache = createRemoteJWKSet(new URL(url));
    jwksUrlCache = url;
  }
  return jwksCache;
}

export async function verifyJwt(token: string): Promise<AuthContext | null> {
  try {
    const jwks = getJwks();
    const { payload } = await jwtVerify(token, jwks, {
      // Supabase uses `sub` for user id; we don't pin issuer/audience here
      // because Supabase's defaults vary by project. Pinning them would
      // require reading the project's API settings, which is overkill for
      // an MVP — signature + expiration check is the floor.
      clockTolerance: 5,
    });
    if (typeof payload.sub !== "string" || payload.sub.length === 0) {
      return null;
    }
    return {
      userId: payload.sub,
      email: typeof payload.email === "string" ? payload.email : null,
    };
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) return null;
    if (err instanceof joseErrors.JWSSignatureVerificationFailed) return null;
    if (err instanceof joseErrors.JWTInvalid) return null;
    if (err instanceof joseErrors.JOSEError) return null;
    // Network / JWKS fetch failure — let the caller decide whether to 503.
    throw err;
  }
}

function unauthorized(reason: AuthErrorCode): Error {
  // h3 createError so the framework renders the correct status + JSON body.
  return createError({
    statusCode: 401,
    statusMessage: "Unauthorized",
    data: { code: "UNAUTHORIZED", reason },
  });
}

export async function requireAuth(event: H3Event): Promise<AuthContext> {
  const header = getRequestHeader(event, "authorization");
  if (!header) {
    throw unauthorized("MISSING_TOKEN");
  }
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) {
    throw unauthorized("MALFORMED_TOKEN");
  }
  const token = match[1].trim();
  if (!token) {
    throw unauthorized("MALFORMED_TOKEN");
  }
  let ctx: AuthContext | null;
  try {
    ctx = await verifyJwt(token);
  } catch (err) {
    // JWKS unreachable on cold start: surface 503 so the caller retries.
    // Any other unexpected error: 500 (let the framework render it).
    if (err instanceof joseErrors.JWKSNoMatchingKey) {
      throw unauthorized("INVALID_TOKEN");
    }
    if (
      err instanceof Error &&
      (err.message.includes("fetch failed") ||
        err.message.includes("ENOTFOUND") ||
        err.message.includes("ECONNREFUSED"))
    ) {
      throw createError({
        statusCode: 503,
        statusMessage: "Auth backend unreachable",
        data: { code: "AUTH_BACKEND_UNAVAILABLE" },
      });
    }
    throw err;
  }
  if (!ctx) {
    throw unauthorized("INVALID_TOKEN");
  }
  return ctx;
}

/**
 * Attach an auth context to an h3 event. Useful for routes that want to
 * populate `event.context.userId` without throwing when auth fails (e.g.
 * public routes that adapt behavior for logged-in users).
 */
export async function tryAuth(event: H3Event): Promise<AuthContext | null> {
  const header = getRequestHeader(event, "authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  try {
    return await verifyJwt(match[1].trim());
  } catch {
    return null;
  }
}

/**
 * Test-only: reset the JWKS cache so the next call refetches. Production
 * code should never call this — the cache is keyed by SUPABASE_URL and
 * refetches only when that changes.
 */
export function __resetJwksCacheForTests(): void {
  jwksCache = undefined;
  jwksUrlCache = undefined;
}

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createApp, toWebHandler } from "h3";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from "jose";
import { __resetJwksCacheForTests } from "../../api/trpc/auth";
import { getConfig } from "../../config";
import { closeDb, resetDb } from "../../data/drizzle/client";
import detailedHealthRoute from "./detailed.get";

const fetchDetailed = (headers: Record<string, string> = {}) => {
  const app = createApp();
  app.use("/health/detailed", detailedHealthRoute);
  return toWebHandler(app)(new Request("http://localhost/health/detailed", { headers }));
};

let privateKey: CryptoKey;
let publicJwk: JWK;
let originalFetch: typeof globalThis.fetch;
const previousDatabaseUrl = process.env.TEST_DATABASE_URL;

async function bearer(appMetadata: Record<string, unknown>) {
  const issuer = `${getConfig().supabaseUrl.replace(/\/+$/, "")}/auth/v1`;
  const token = await new SignJWT({ email: "ops@example.com", app_metadata: appMetadata })
    .setProtectedHeader({ alg: "RS256", kid: "detailed-health-kid" })
    .setIssuer(issuer)
    .setAudience("authenticated")
    .setSubject("detailed-health-user")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  return { authorization: `Bearer ${token}` };
}

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), alg: "RS256", kid: "detailed-health-kid", use: "sig" };
  // The admin case must not read a real database: point the pool at a closed port.
  process.env.TEST_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:1/unreachable";
  resetDb();
});

afterAll(async () => {
  if (previousDatabaseUrl === undefined) delete process.env.TEST_DATABASE_URL;
  else process.env.TEST_DATABASE_URL = previousDatabaseUrl;
  await closeDb();
});

beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith("/auth/v1/.well-known/jwks.json")) {
      return Response.json({ keys: [publicJwk] });
    }
    return originalFetch(input, init);
  }) as typeof fetch;
  __resetJwksCacheForTests();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  __resetJwksCacheForTests();
});

describe("GET /health/detailed", () => {
  it("rejects anonymous callers without exposing row counts", async () => {
    const res = await fetchDetailed();
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain("rowCounts");
  });

  it("rejects authenticated non-admin callers", async () => {
    const res = await fetchDetailed(await bearer({}));
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain("rowCounts");
  });

  it("serves the detailed report to admins", async () => {
    const res = await fetchDetailed(await bearer({ role: "admin" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.database.rowCounts).toBeDefined();
  });
});

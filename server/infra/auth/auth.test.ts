import { describe, it, expect, beforeAll, beforeEach } from "bun:test";
import { requireAuth, tryAuth, verifyJwt, __resetJwksCacheForTests } from "../../api/trpc/auth";
import { resetConfigForTests } from "../../config";
import type { H3Event } from "h3";

// env must be set before any module that calls getConfig() is imported.
// We import lazily inside the suite to ensure beforeAll runs first.
beforeAll(() => {
  resetConfigForTests();
  __resetJwksCacheForTests();
});

// Build a minimal h3 event with the given Authorization header.
// Mirrors the pattern in server/infra/health.test.ts: createApp() returns
// an h3 app whose .fetch() handles a standard Request.
function makeEvent(authHeader?: string) {
  return {
    node: { req: { headers: authHeader ? { authorization: authHeader } : {} } },
    context: {},
  } as unknown as H3Event;
}

describe("requireAuth — header parsing", () => {
  it("throws 401 with reason=MISSING_TOKEN when no header is present", async () => {
    const event = makeEvent();
    await expect(requireAuth(event)).rejects.toMatchObject({
      statusCode: 401,
      data: { reason: "MISSING_TOKEN" },
    });
  });

  it("throws 401 with reason=MALFORMED_TOKEN for non-Bearer schemes", async () => {
    const event = makeEvent("Basic dXNlcjpwYXNz");
    await expect(requireAuth(event)).rejects.toMatchObject({
      statusCode: 401,
      data: { reason: "MALFORMED_TOKEN" },
    });
  });

  it("throws 401 with reason=MALFORMED_TOKEN for empty Bearer value", async () => {
    const event = makeEvent("Bearer ");
    await expect(requireAuth(event)).rejects.toMatchObject({
      statusCode: 401,
      data: { reason: "MALFORMED_TOKEN" },
    });
  });

  it("accepts Bearer scheme case-insensitively", async () => {
    // We don't reach the verify step here because we pass a syntactically
    // valid header but the JWKS fetch will fail. We're testing that the
    // header parser does not reject "bearer" lowercase.
    const event = makeEvent("bearer not-a-real-token");
    await expect(requireAuth(event)).rejects.toMatchObject({
      statusCode: 401,
      data: { reason: "INVALID_TOKEN" },
    });
  });
});

describe("verifyJwt — error classification", () => {
  beforeEach(() => {
    __resetJwksCacheForTests();
  });

  it("returns null for malformed JWT (jose.JWTInvalid)", async () => {
    // jose will throw JWTInvalid for "not-a-jwt" before the JWKS is touched.
    const result = await verifyJwt("not-a-real-jwt-token");
    expect(result).toBeNull();
  });

  it("returns null for an empty token", async () => {
    const result = await verifyJwt("");
    expect(result).toBeNull();
  });

  it("returns null for a JWT signed by the wrong key", async () => {
    // Generate a key pair, sign with the private, verify against an
    // unrelated JWKS. jose will throw JWSSignatureVerificationFailed
    // which we map to null.
    const { generateKeyPair, exportJWK, SignJWT } = await import("jose");
    const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
    const privateJwk = await exportJWK(privateKey);
    privateJwk.alg = "RS256";
    privateJwk.kid = "test-kid";
    const publicJwk = await exportJWK(publicKey);
    publicJwk.alg = "RS256";
    publicJwk.kid = "test-kid";
    publicJwk.use = "sig";

    // Build a fake remote JWK Set by mocking createRemoteJWKSet.
    // Simpler: monkey-patch the global fetch so the JWKS endpoint
    // returns our key. The verifyJwt code path will fetch from
    // SUPABASE_URL/auth/v1/.well-known/jwks.json.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.endsWith("/auth/v1/.well-known/jwks.json")) {
        return new Response(JSON.stringify({ keys: [publicJwk] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return originalFetch(input);
    }) as typeof fetch;
    __resetJwksCacheForTests();

    try {
      const token = await new SignJWT({ email: "wrong@example.com" })
        .setProtectedHeader({ alg: "RS256", kid: "wrong-kid" })
        .setSubject("user-123")
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(privateKey);
      const result = await verifyJwt(token);
      expect(result).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
      __resetJwksCacheForTests();
    }
  });
});

describe("tryAuth — non-throwing variant", () => {
  it("returns null when no header is present", async () => {
    const event = makeEvent();
    const result = await tryAuth(event);
    expect(result).toBeNull();
  });

  it("returns null for a malformed token instead of throwing", async () => {
    const event = makeEvent("Bearer not-a-real-token");
    const result = await tryAuth(event);
    expect(result).toBeNull();
  });
});

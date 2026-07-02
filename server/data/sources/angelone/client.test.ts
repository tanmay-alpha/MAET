import { describe, it, expect, afterEach } from "bun:test";
import { generateTotp, login } from "./client";

const origFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = origFetch;
});

describe("angelone login", () => {
  it("generates the RFC 6238 SHA-1 TOTP vector", () => {
    expect(generateTotp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59_000)).toBe("287082");
  });

  it("sends TOTP in the request body and parses session", async () => {
    let captured: any = null;
    globalThis.fetch = (async (url, init) => {
      captured = { url: String(url), body: init?.body, headers: init?.headers };
      return new Response(
        JSON.stringify({
          status: true,
          data: {
            jwtToken: "JWT",
            feedToken: "FEED",
            refreshToken: "REFRESH",
          },
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;
    const s = await login({ apiKey: "K", clientCode: "C", password: "P", totpSecret: "JBSWY3DPEHPK3PXP" });
    expect(s.jwt).toBe("JWT");
    expect(s.feedToken).toBe("FEED");
    expect(s.refreshToken).toBe("REFRESH");
    const body = JSON.parse(captured.body);
    expect(body.totp).toMatch(/^\d{6}$/);
    expect(body.clientcode).toBe("C");
  });
});

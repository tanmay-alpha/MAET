import { describe, it, expect, beforeEach, afterEach } from "bun:test";

describe("config", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.UPSTASH_REDIS_URL;
    delete process.env.ANGELONE_MASTER_KEY;
    delete process.env.ANGELONE_API_KEY;
    delete process.env.ANGELONE_CLIENT_ID;
    delete process.env.ANGELONE_PIN;
    delete process.env.ANGELONE_TOTP_SECRET;
    delete process.env.ALERT_WEBHOOK_URL;
    delete process.env.NSE_HOLIDAYS_JSON;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("throws when ANGELONE_MASTER_KEY is missing", async () => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
    process.env.SUPABASE_ANON_KEY = "anon";
    process.env.UPSTASH_REDIS_URL = "rediss://x";
    process.env.ANGELONE_MASTER_KEY = "";
    process.env.ANGELONE_API_KEY = "test-api-key";
    process.env.ANGELONE_CLIENT_ID = "test-client-id";
    process.env.ANGELONE_PIN = "1234";
    process.env.ANGELONE_TOTP_SECRET = "test-totp-secret-16chars";

    // dynamic import after env is set so config re-evaluates
    const mod = await import("./config");
    expect(() => mod.getConfig()).toThrow(/ANGELONE_MASTER_KEY/);
  });

  it("returns a parsed config when all required vars are set", async () => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
    process.env.SUPABASE_ANON_KEY = "anon";
    process.env.UPSTASH_REDIS_URL = "rediss://x";
    process.env.ANGELONE_MASTER_KEY = "a".repeat(44);
    process.env.ANGELONE_API_KEY = "test-api-key";
    process.env.ANGELONE_CLIENT_ID = "test-client-id";
    process.env.ANGELONE_PIN = "1234";
    process.env.ANGELONE_TOTP_SECRET = "test-totp-secret-16chars";

    const mod = await import("./config?case=happy");
    const c = mod.getConfig();
    expect(c.supabaseUrl).toBe("https://x.supabase.co");
    expect(c.angeloneMasterKey).toBe("a".repeat(44));
    expect(c.angeloneApiKey).toBe("test-api-key");
    expect(c.angeloneClientId).toBe("test-client-id");
    expect(c.angelonePin).toBe("1234");
    expect(c.angeloneTotpSecret).toBe("test-totp-secret-16chars");
  });
});
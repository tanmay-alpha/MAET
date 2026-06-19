import { describe, it, expect, beforeEach, afterEach } from "bun:test";

describe("config", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.UPSTASH_REDIS_URL;
    delete process.env.ANGELONE_MASTER_KEY;
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

    const mod = await import("./config?case=happy");
    const c = mod.getConfig();
    expect(c.supabaseUrl).toBe("https://x.supabase.co");
    expect(c.angeloneMasterKey).toBe("a".repeat(44));
  });
});
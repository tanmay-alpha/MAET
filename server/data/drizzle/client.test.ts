import { describe, expect, it } from "bun:test";
import { resolveDatabaseUrl } from "./client";

const urls = {
  TEST_DATABASE_URL: "postgres://test",
  SUPABASE_DB_URL: "postgres://supabase",
  DATABASE_URL: "postgres://database",
  POSTGRES_URL: "postgres://postgres",
};

describe("resolveDatabaseUrl", () => {
  it("ignores TEST_DATABASE_URL outside tests and prefers SUPABASE_DB_URL", () => {
    expect(resolveDatabaseUrl({ ...urls, NODE_ENV: "production" })).toBe("postgres://supabase");
    expect(resolveDatabaseUrl({ ...urls, NODE_ENV: undefined })).toBe("postgres://supabase");
  });

  it("falls back to DATABASE_URL, then POSTGRES_URL, never to TEST_DATABASE_URL", () => {
    const { SUPABASE_DB_URL: _supabase, ...withoutSupabase } = urls;
    expect(resolveDatabaseUrl({ ...withoutSupabase, NODE_ENV: "production" })).toBe("postgres://database");
    expect(resolveDatabaseUrl({ TEST_DATABASE_URL: urls.TEST_DATABASE_URL, POSTGRES_URL: urls.POSTGRES_URL, NODE_ENV: "production" }))
      .toBe("postgres://postgres");
    expect(resolveDatabaseUrl({ TEST_DATABASE_URL: urls.TEST_DATABASE_URL, NODE_ENV: "production" })).toBeUndefined();
  });

  it("uses only TEST_DATABASE_URL under NODE_ENV=test", () => {
    expect(resolveDatabaseUrl({ ...urls, NODE_ENV: "test" })).toBe("postgres://test");
    const { TEST_DATABASE_URL: _test, ...withoutTest } = urls;
    expect(resolveDatabaseUrl({ ...withoutTest, NODE_ENV: "test" })).toBeUndefined();
  });

  it("treats a bun test run as a test run even without NODE_ENV=test", () => {
    expect(resolveDatabaseUrl({ ...urls, NODE_ENV: "production", BUN_TEST: "1" })).toBe("postgres://test");
  });
});

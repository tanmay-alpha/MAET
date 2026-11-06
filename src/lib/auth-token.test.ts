import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { hasStoredSession } from "./auth-token";
import { MemoryStorage } from "@/test-utils/memory-storage";

describe("hasStoredSession", () => {
  const originalWindow = globalThis.window;
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    globalThis.window = { localStorage: storage } as unknown as Window & typeof globalThis;
  });

  afterEach(() => {
    globalThis.window = originalWindow;
  });

  test("is false for a logged-out browser", () => {
    expect(hasStoredSession()).toBe(false);
  });

  test("is true for a Supabase session, even one whose access token has expired", () => {
    storage.setItem(
      "sb-project-auth-token",
      JSON.stringify({ access_token: "token", refresh_token: "refresh", expires_at: 1 })
    );
    expect(hasStoredSession()).toBe(true);
  });

  test("ignores unrelated or unreadable storage entries", () => {
    storage.setItem("maet.settings", JSON.stringify({ access_token: "not-a-session" }));
    storage.setItem("supabase.auth.token", "{not json");
    expect(hasStoredSession()).toBe(false);
  });
});

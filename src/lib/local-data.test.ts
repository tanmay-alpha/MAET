import { describe, expect, test } from "bun:test";
import { clearMaetLocalData } from "./local-data";
import { MemoryStorage } from "@/test-utils/memory-storage";

describe("clearMaetLocalData", () => {
  test("removes MAET preferences but keeps the sign-in session", () => {
    const storage = new MemoryStorage();
    for (const key of [
      "maet.settings",
      "maet_chart_type",
      "maet_chart_layouts_RELIANCE",
      "maet:screener-v4:views",
      "supabase.auth.token",
      "sb-ztpbfmpfgmgmsitshzma-auth-token",
      "unrelated-widget",
    ]) {
      storage.setItem(key, "x");
    }

    clearMaetLocalData(storage);

    expect([...Array(storage.length).keys()].map((index) => storage.key(index)).sort()).toEqual([
      "sb-ztpbfmpfgmgmsitshzma-auth-token",
      "supabase.auth.token",
      "unrelated-widget",
    ]);
  });
});

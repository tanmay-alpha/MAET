import { describe, expect, test } from "bun:test";
import { clearMaetLocalData } from "./local-data";

class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>();
  get length() {
    return this.items.size;
  }
  clear() {
    this.items.clear();
  }
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
}

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

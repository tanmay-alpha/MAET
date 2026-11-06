import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

describe("root CSP", () => {
  test("allows the framework's inline bootstrap scripts to hydrate client routes", async () => {
    const source = await readFile(path.join(import.meta.dir, "__root.tsx"), "utf8");

    expect(source).toContain("script-src 'self' 'unsafe-inline'");
    expect(source).toContain("https://s3.tradingview.com");
    expect(source).toContain("frame-src https://*.tradingview.com https://www.tradingview-widget.com");
    expect(source).toContain("worker-src 'self' blob:");
    expect(source).toContain("API_BASE_URL");
  });
});

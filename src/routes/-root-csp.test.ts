import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

describe("root CSP", () => {
  test("allows the framework's inline bootstrap scripts to hydrate client routes", async () => {
    const source = await readFile(path.join(import.meta.dir, "__root.tsx"), "utf8");

    expect(source).toContain("script-src 'self' 'unsafe-inline'");
  });
});

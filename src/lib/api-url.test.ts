import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { resolveApiUrl } from "./api-url";

describe("resolveApiUrl", () => {
  test("targets the configured backend origin", () => {
    expect(resolveApiUrl("https://maet.onrender.com", "/api/trpc/companies.searchCompanies")).toBe(
      "https://maet.onrender.com/api/trpc/companies.searchCompanies"
    );
  });

  test("tolerates a trailing slash on the configured origin", () => {
    expect(resolveApiUrl("https://maet.onrender.com/", "/api/paper/stream")).toBe("https://maet.onrender.com/api/paper/stream");
  });

  test("stays same-origin when no backend origin is configured", () => {
    expect(resolveApiUrl("", "/api/trpc/capabilities.get")).toBe("/api/trpc/capabilities.get");
    expect(resolveApiUrl(undefined, "/api/paper/stream")).toBe("/api/paper/stream");
  });
});

// The Vercel deployment serves only the SSR app and its own /api/market routes, so any
// relative /api/trpc or /api/paper request 404s in production.
describe("backend calls", () => {
  test("no source file requests /api/trpc or /api/paper by a relative URL", async () => {
    const srcDir = path.resolve(import.meta.dir, "..");
    const offenders: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          const source = await readFile(full, "utf8");
          // A backend-only path literal must go through apiUrl(), which prefixes the backend origin.
          if (/(?<!apiUrl\()["'`]\/api\/(trpc|paper)\b/.test(source)) offenders.push(path.relative(srcDir, full));
        }
      }
    };
    await walk(srcDir);

    expect(offenders).toEqual([]);
  });
});

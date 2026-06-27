import { describe, it, expect } from "bun:test";
import { createApp } from "../app";

describe("app health", () => {
  it("GET /health returns 200 with status ok", async () => {
    const app = createApp();
    const res = await app.fetch(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.checks).toBeDefined();
  });

  it("adds CORS headers only for an allowed frontend origin", async () => {
    const app = createApp();
    const allowed = await app.fetch(new Request("http://localhost/api/health", {
      headers: { origin: "https://maet-pi.vercel.app" },
    }));
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://maet-pi.vercel.app");

    const rejected = await app.fetch(new Request("http://localhost/api/health", {
      headers: { origin: "https://example.invalid" },
    }));
    expect(rejected.headers.get("access-control-allow-origin")).toBeNull();
  });
});

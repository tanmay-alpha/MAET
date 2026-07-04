import { describe, it, expect } from "bun:test";
import { createApp } from "../app";
import { dependencyErrorDetail, supabaseRestProbeUrl } from "./health";

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

describe("dependency health probes", () => {
  it("checks Supabase REST with a zero-row table query instead of the secret-only OpenAPI root", () => {
    expect(supabaseRestProbeUrl("https://example.supabase.co/"))
      .toBe("https://example.supabase.co/rest/v1/companies?select=id&limit=0");
  });

  it("reports database authentication failures without exposing connection details", () => {
    const error = new Error("Failed query: select 1", {
      cause: Object.assign(new Error("password authentication failed for user postgres.project"), { code: "28P01" }),
    });
    expect(dependencyErrorDetail(error)).toBe("authentication failed (28P01)");
  });
});

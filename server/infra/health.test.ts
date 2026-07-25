import { describe, it, expect } from "bun:test";
import { createApp } from "../app";
import { healthHandler } from "./health";

describe("app health", () => {
  it("GET /health returns 200 with status ok", async () => {
    const app = createApp();
    const res = await app.fetch(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.checks).toBeDefined();
  });

  it("healthHandler returns sanitized health structure", () => {
    const health = healthHandler();
    expect(health.status).toBe("ok");
    expect(health.checks.database).toBe(true);
    expect(health.checks.redis).toBe(true);
  });
});

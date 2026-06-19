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
});

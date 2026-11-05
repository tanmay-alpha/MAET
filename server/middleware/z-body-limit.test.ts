import { describe, expect, it } from "bun:test";
import { readdirSync } from "node:fs";
import { createApp, defineEventHandler, readBody, toWebHandler, type EventHandler } from "h3";
import { MAX_API_BODY_BYTES } from "./z-body-limit";

// Nitro runs server/middleware/* in alphabetical file order; register them the
// same way so the test covers the real ordering (CORS before the body limit).
const middlewareFiles = readdirSync(import.meta.dir)
  .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
  .sort();
const app = createApp();
for (const file of middlewareFiles) {
  // Runtime-selected module list: the point is to load whatever the directory holds.
  const handler: EventHandler = (await import(`./${file}`)).default;
  app.use(handler);
}
app.use("/api/echo", defineEventHandler(async (event) => ({ size: JSON.stringify(await readBody(event)).length })));
app.use("/other", defineEventHandler(() => ({ ok: true })));
const handle = toWebHandler(app);

const ALLOWED_ORIGIN = "http://localhost:3000";

// Request objects don't populate Content-Length; real HTTP clients do.
const post = (path: string, body: string) =>
  handle(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: {
        origin: ALLOWED_ORIGIN,
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(body)),
      },
      body,
    }),
  );

describe("API body size limit", () => {
  it("rejects /api bodies larger than the limit with 413 that the browser can read (CORS headers set)", async () => {
    const res = await post("/api/echo", JSON.stringify({ items: "x".repeat(MAX_API_BODY_BYTES) }));
    expect(res.status).toBe(413);
    expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
  });

  it("accepts bodies within the limit", async () => {
    const res = await post("/api/echo", JSON.stringify({ items: [1, 2, 3] }));
    expect(res.status).toBe(200);
  });

  it("leaves non-/api routes alone", async () => {
    const res = await post("/other", "x".repeat(MAX_API_BODY_BYTES + 1));
    expect(res.status).toBe(200);
  });
});

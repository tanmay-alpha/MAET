import { describe, expect, it } from "bun:test";
import { createApp, defineEventHandler, readBody, toWebHandler } from "h3";
import { bodyLimitMiddleware, MAX_API_BODY_BYTES } from "./body-limit";

const app = createApp();
app.use(bodyLimitMiddleware);
app.use("/api/echo", defineEventHandler(async (event) => ({ size: JSON.stringify(await readBody(event)).length })));
app.use("/other", defineEventHandler(() => ({ ok: true })));
const handle = toWebHandler(app);
// Request objects don't populate Content-Length; real HTTP clients do.
const post = (path: string, body: string) =>
  handle(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) },
      body,
    }),
  );

describe("API body size limit", () => {
  it("rejects /api bodies larger than the limit with 413", async () => {
    const res = await post("/api/echo", JSON.stringify({ items: "x".repeat(MAX_API_BODY_BYTES) }));
    expect(res.status).toBe(413);
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

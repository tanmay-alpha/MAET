import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createApp, createRouter, toWebHandler } from "h3";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { __resetJwksCacheForTests } from "../trpc/auth";
import { getConfig, resetConfigForTests } from "../../config";
import accountGet from "./account.get";
import accountPost from "./account.post";
import ordersDelete from "./orders.delete";
import ordersGet from "./orders.get";
import ordersPost from "./orders.post";
import positionsGet from "./positions.get";
import orderByIdDelete from "./orders/[id].delete";

const router = createRouter()
  .get("/api/paper/account", accountGet)
  .post("/api/paper/account", accountPost)
  .get("/api/paper/orders", ordersGet)
  .post("/api/paper/orders", ordersPost)
  .delete("/api/paper/orders", ordersDelete)
  .delete("/api/paper/orders/:id", orderByIdDelete)
  .get("/api/paper/positions", positionsGet);
const handle = toWebHandler(createApp().use(router));

describe("paper REST endpoints without a bearer token", () => {
  const routes: Array<[method: string, path: string]> = [
    ["GET", "/api/paper/account"],
    ["POST", "/api/paper/account"],
    ["GET", "/api/paper/orders"],
    ["POST", "/api/paper/orders"],
    ["DELETE", "/api/paper/orders?id=00000000-0000-0000-0000-000000000000"],
    ["DELETE", "/api/paper/orders/00000000-0000-0000-0000-000000000000"],
    ["GET", "/api/paper/positions"],
  ];

  for (const [method, path] of routes) {
    it(`${method} ${path} answers 401, not 500`, async () => {
      const response = await handle(new Request(`http://localhost${path}`, { method }));
      expect(response.status).toBe(401);
    });
  }
});

describe("paper order cancel endpoints with a valid bearer token", () => {
  const originalFetch = globalThis.fetch;
  let authorization: string;

  beforeAll(async () => {
    resetConfigForTests();
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const publicJwk = { ...(await exportJWK(publicKey)), alg: "RS256", kid: "boundary-kid", use: "sig" };
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/auth/v1/.well-known/jwks.json")) return Response.json({ keys: [publicJwk] });
      return originalFetch(input);
    }) as typeof fetch;
    __resetJwksCacheForTests();
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: "boundary-kid" })
      .setIssuer(`${getConfig().supabaseUrl.replace(/\/+$/, "")}/auth/v1`)
      .setAudience("authenticated")
      .setSubject(crypto.randomUUID())
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    authorization = `Bearer ${token}`;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
    __resetJwksCacheForTests();
  });

  for (const path of ["/api/paper/orders?id=not-a-uuid", "/api/paper/orders/not-a-uuid", "/api/paper/orders"]) {
    it(`DELETE ${path} answers 400 for a missing or malformed order id`, async () => {
      const response = await handle(new Request(`http://localhost${path}`, { method: "DELETE", headers: { authorization } }));
      expect(response.status).toBe(400);
    });
  }
});

import { describe, expect, it } from "bun:test";
import { createApp, createRouter, toWebHandler } from "h3";
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

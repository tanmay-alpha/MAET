import { describe, expect, it, spyOn } from "bun:test";
import { createApp, toWebHandler } from "h3";
import eventsHandler from "../../api/world/events.get";
import newsHandler from "../../api/world/news.get";
import macroHandler from "../../api/world/macro.get";
import { corsMiddleware } from "../../middleware/cors";
import { worldService } from "./service";

describe("public world HTTP routes", () => {
  it("serves events, news and macro without authentication using the existing CORS middleware", async () => {
    const events = {
      events: [],
      sources: [
        { source: "USGS" as const, fetchedAt: null, stale: true, error: "Upstream HTTP 503" },
      ],
    };
    const news = {
      events: [],
      sources: [{ source: "GDELT" as const, fetchedAt: null, stale: true }],
    };
    const macro = {
      points: [],
      sources: [{ source: "World Bank" as const, fetchedAt: null, stale: true }],
    };
    const spies = [
      spyOn(worldService, "events").mockResolvedValue(events),
      spyOn(worldService, "news").mockResolvedValue(news),
      spyOn(worldService, "macro").mockResolvedValue(macro),
    ];
    try {
      const app = createApp();
      app.use(corsMiddleware);
      app.use("/api/world/events", eventsHandler);
      app.use("/api/world/news", newsHandler);
      app.use("/api/world/macro", macroHandler);
      const request = toWebHandler(app);
      for (const [path, expected] of [
        ["events", events],
        ["news", news],
        ["macro", macro],
      ] as const) {
        const response = await request(
          new Request(`http://localhost/api/world/${path}`, {
            headers: { origin: "http://localhost:5173" },
          }),
        );
        expect(response.status).toBe(200);
        expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(await response.json()).toEqual(expected);
      }
      const options = await request(
        new Request("http://localhost/api/world/events", {
          method: "OPTIONS",
          headers: { origin: "http://localhost:5173" },
        }),
      );
      expect(options.status).toBe(204);
      expect(options.headers.get("access-control-allow-methods")).toContain("GET");
      for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

import { createFileRoute } from "@tanstack/react-router";
import { loadMarketCandles } from "@server/domain/market/candle-service";
import type { Candle } from "@shared/types";

const TIMEFRAMES: Candle["tf"][] = ["1m", "5m", "15m", "1h", "1d", "1wk"];
const RANGE_MS: Record<string, number> = {
  "1d": 86_400_000,
  "5d": 5 * 86_400_000,
  "10d": 10 * 86_400_000,
  "1mo": 30 * 86_400_000,
  "3mo": 90 * 86_400_000,
  "6mo": 180 * 86_400_000,
  "1y": 365 * 86_400_000,
  "2y": 730 * 86_400_000,
  "3y": 1095 * 86_400_000,
  "5y": 1825 * 86_400_000,
};

export const Route = createFileRoute("/api/market/candles")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const params = new URL(request.url).searchParams;
        const symbol = (params.get("symbol") ?? "RELIANCE").trim().toUpperCase();
        const timeframe = (params.get("tf") ?? "1d") as Candle["tf"];
        let range = params.get("range") ?? "1mo";

        if (!/^[A-Z0-9&.^-]+$/.test(symbol)) {
          return Response.json({ message: "Invalid symbol" }, { status: 400 });
        }
        if (!TIMEFRAMES.includes(timeframe)) {
          return Response.json({ message: "Unsupported timeframe" }, { status: 400 });
        }
        if (range !== "max" && !RANGE_MS[range]) {
          return Response.json({ message: "Unsupported range" }, { status: 400 });
        }
        if (timeframe === "1m" && range !== "1d" && range !== "5d") range = "5d";

        const to = new Date();
        const from = range === "max"
          ? new Date("1990-01-01T00:00:00.000Z")
          : new Date(to.getTime() - RANGE_MS[range]);

        try {
          const result = await loadMarketCandles(symbol, timeframe, from, to);
          return Response.json(
            {
              symbol,
              timeframe,
              range,
              source: result.source,
              delayed: true,
              asOf: new Date().toISOString(),
              persisted: result.persisted,
              candles: result.candles,
            },
            {
              headers: {
                "cache-control": "public, max-age=30, s-maxage=60, stale-while-revalidate=300",
              },
            }
          );
        } catch (error) {
          return Response.json(
            { message: error instanceof Error ? error.message : "Candle service unavailable" },
            { status: 502 }
          );
        }
      },
    },
  },
});

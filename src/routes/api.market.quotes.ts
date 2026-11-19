import { createFileRoute } from "@tanstack/react-router";
import { loadQuotes } from "@server/domain/market/quote-service";
import { isMarketSymbol } from "@server/domain/market/symbol-pattern";

const DEFAULT_SYMBOLS = ["RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK"];

function parseSymbols(request: Request): string[] | Response {
  const value = new URL(request.url).searchParams.get("symbols");
  const symbols = (value ?? DEFAULT_SYMBOLS.join(","))
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);

  if (symbols.length === 0 || symbols.length > 50) {
    return Response.json({ message: "Request between 1 and 50 symbols" }, { status: 400 });
  }
  // Same symbols as the backend's GET /api/market/quotes (MARKET_SYMBOL_PATTERN, length-capped).
  if (!symbols.every(isMarketSymbol)) {
    return Response.json({ message: "Invalid symbol" }, { status: 400 });
  }
  return symbols;
}

export const Route = createFileRoute("/api/market/quotes")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const symbols = parseSymbols(request);
        if (symbols instanceof Response) return symbols;
        try {
          const result = await loadQuotes(symbols);
          const source = result.quotes.some((quote) => quote.source === "angelone") ? "angelone" : "yahoo";
          return Response.json(
            {
              asOf: new Date().toISOString(),
              source,
              delayed: source !== "angelone",
              ...result,
            },
            {
              headers: {
                "cache-control": "public, max-age=5, s-maxage=10, stale-while-revalidate=30",
              },
            }
          );
        } catch (error) {
          // Provider and database errors carry hostnames and upstream text: log, never return them.
          console.error("[api/market/quotes] quote load failed:", error);
          return Response.json({ message: "Quote service unavailable" }, { status: 503 });
        }
      },
    },
  },
});

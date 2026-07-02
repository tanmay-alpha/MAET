import { createFileRoute } from "@tanstack/react-router";
import { loadQuotes } from "@server/domain/market/quote-service";

const DEFAULT_SYMBOLS = ["RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK"];

function parseSymbols(request: Request): string[] {
  const value = new URL(request.url).searchParams.get("symbols");
  const symbols = (value ?? DEFAULT_SYMBOLS.join(","))
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);

  if (symbols.length === 0 || symbols.length > 25) {
    throw new Response("Request between 1 and 25 symbols", { status: 400 });
  }
  if (symbols.some((symbol) => !/^[A-Z0-9&.^-]+$/.test(symbol))) {
    throw new Response("Invalid symbol", { status: 400 });
  }
  return symbols;
}

export const Route = createFileRoute("/api/market/quotes")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const symbols = parseSymbols(request);
          const result = await loadQuotes(symbols);
          return Response.json(
            {
              asOf: new Date().toISOString(),
              source: "yahoo",
              delayed: true,
              ...result,
            },
            {
              headers: {
                "cache-control": "public, max-age=5, s-maxage=10, stale-while-revalidate=30",
              },
            }
          );
        } catch (error) {
          if (error instanceof Response) return error;
          return Response.json(
            { message: error instanceof Error ? error.message : "Quote service unavailable" },
            { status: 502 }
          );
        }
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import { loadCorporateActions } from "@server/domain/market/corporate-action-service";
import { MARKET_SYMBOL_PATTERN } from "@server/domain/market/symbol";

export const Route = createFileRoute("/api/market/corporate-actions")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const symbol = (new URL(request.url).searchParams.get("symbol") ?? "").trim().toUpperCase();
        if (!symbol || !MARKET_SYMBOL_PATTERN.test(symbol)) {
          return Response.json({ message: "Invalid symbol" }, { status: 400 });
        }
        try {
          const payload = await loadCorporateActions(symbol);
          return Response.json(payload, {
            headers: {
              "cache-control": payload.stale
                ? "public, max-age=60"
                : "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
            },
          });
        } catch {
          return Response.json({ message: "Corporate actions temporarily unavailable" }, { status: 503 });
        }
      },
    },
  },
});

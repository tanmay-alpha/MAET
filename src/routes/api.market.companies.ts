import { createFileRoute } from "@tanstack/react-router";
import { parseCompanyScreenerParams, queryCompanyScreener } from "@server/domain/screener/company-query";

export const Route = createFileRoute("/api/market/companies")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const input = parseCompanyScreenerParams(new URL(request.url).searchParams);
          return Response.json(await queryCompanyScreener(input), {
            headers: { "cache-control": "public, max-age=30, s-maxage=60, stale-while-revalidate=300" },
          });
        } catch (error) {
          return Response.json(
            { message: error instanceof Error ? error.message : "Invalid screener query" },
            { status: 400 }
          );
        }
      },
    },
  },
});

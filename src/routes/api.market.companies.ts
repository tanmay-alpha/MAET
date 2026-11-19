import { createFileRoute } from "@tanstack/react-router";
import { parseCompanyScreenerParams, queryCompanyScreener, type CompanyScreenerParams } from "@server/domain/screener/company-query";

export const Route = createFileRoute("/api/market/companies")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        let input: CompanyScreenerParams;
        try {
          input = parseCompanyScreenerParams(new URL(request.url).searchParams);
        } catch {
          // Parser messages echo the raw query value; the client gets a fixed message.
          return Response.json({ message: "Invalid screener query" }, { status: 400 });
        }
        try {
          return Response.json(await queryCompanyScreener(input), {
            headers: { "cache-control": "public, max-age=30, s-maxage=60, stale-while-revalidate=300" },
          });
        } catch (error) {
          // Database and NSE fallback both failed: an upstream outage, not a bad request.
          console.error("[api/market/companies] company directory failed:", error);
          return Response.json({ message: "Company directory temporarily unavailable" }, { status: 503 });
        }
      },
    },
  },
});

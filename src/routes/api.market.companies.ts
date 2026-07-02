import { createFileRoute } from "@tanstack/react-router";
import { getNseCompanyMaster, searchNseCompanyMaster } from "@server/data/sources/nse-company-master";

function parsePositiveInteger(value: string | null, fallback: number, maximum: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Response(`Expected an integer between 1 and ${maximum}`, { status: 400 });
  }
  return parsed;
}

export const Route = createFileRoute("/api/market/companies")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const page = parsePositiveInteger(url.searchParams.get("page"), 1, 100_000);
          const pageSize = parsePositiveInteger(url.searchParams.get("limit"), 25, 100);
          const search = (url.searchParams.get("search") ?? "").trim().toLocaleLowerCase("en-IN").slice(0, 80);
          const companies = await getNseCompanyMaster(url.searchParams.get("refresh") === "1");
          const matches = searchNseCompanyMaster(companies, search);
          const start = (page - 1) * pageSize;

          return Response.json({
            asOf: new Date().toISOString(),
            source: "nse",
            total: matches.length,
            universeTotal: companies.length,
            page,
            pageSize,
            pageCount: Math.ceil(matches.length / pageSize),
            items: matches.slice(start, start + pageSize),
          }, {
            headers: { "cache-control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400" },
          });
        } catch (error) {
          if (error instanceof Response) return error;
          return Response.json(
            { message: error instanceof Error ? error.message : "Company master unavailable" },
            { status: 502 }
          );
        }
      },
    },
  },
});

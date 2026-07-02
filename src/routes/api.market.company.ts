import { createFileRoute } from "@tanstack/react-router";
import { getCompanyDetail } from "@server/domain/company/detail";

export const Route = createFileRoute("/api/market/company")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const symbol = new URL(request.url).searchParams.get("symbol") ?? "";
          return Response.json(await getCompanyDetail(symbol), {
            headers: { "cache-control": "public, max-age=30, s-maxage=60, stale-while-revalidate=300" },
          });
        } catch (error) {
          return Response.json({ message: error instanceof Error ? error.message : "Company not found" }, { status: 404 });
        }
      },
    },
  },
});

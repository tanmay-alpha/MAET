import { createFileRoute } from "@tanstack/react-router";
import { getCompanyDetail } from "@server/domain/company/detail";
import { isMarketSymbol } from "@server/domain/market/symbol-pattern";

export const Route = createFileRoute("/api/market/company")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const symbol = (new URL(request.url).searchParams.get("symbol") ?? "").trim().toUpperCase();
        if (!isMarketSymbol(symbol)) {
          return Response.json({ message: "Invalid symbol" }, { status: 400 });
        }
        try {
          return Response.json(await getCompanyDetail(symbol), {
            headers: { "cache-control": "public, max-age=30, s-maxage=60, stale-while-revalidate=300" },
          });
        } catch (error) {
          // getCompanyDetail reports an unknown symbol with exactly this message; anything
          // else is the company master being unreachable, whose text must not reach clients.
          if (error instanceof Error && error.message === "Company not found") {
            return Response.json({ message: "Company not found" }, { status: 404 });
          }
          console.error("[api/market/company] company detail failed:", error);
          return Response.json({ message: "Company data temporarily unavailable" }, { status: 503 });
        }
      },
    },
  },
});

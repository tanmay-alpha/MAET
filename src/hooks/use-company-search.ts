import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchMarketCompanies } from "@/lib/market-api";

export function useCompanySearch(query: string, limit = 12) {
  const [debouncedQuery, setDebouncedQuery] = useState(query.trim());

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  return useQuery({
    queryKey: ["company-search", debouncedQuery, limit],
    queryFn: ({ signal }) => fetchMarketCompanies(1, limit, debouncedQuery, signal),
    enabled: debouncedQuery.length > 0,
    staleTime: 60_000,
  });
}

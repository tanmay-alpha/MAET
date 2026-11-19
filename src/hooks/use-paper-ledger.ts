import { useInfiniteQuery } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";

/** Largest page the repository serves (server/modules/paper-trading/postgres-repository.ts). */
const LEDGER_PAGE_SIZE = 100;

/**
 * The current generation's cash ledger, newest first, one page at a time. Lives under the
 * ["paperTrading"] key, so orders, cancels and resets refresh it with the account.
 */
export function usePaperLedger(enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ["paperTrading", "ledger"],
    queryFn: ({ pageParam }) =>
      trpc.paperTrading.listLedger.query({ limit: LEDGER_PAGE_SIZE, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
    enabled,
    staleTime: 5_000,
  });
}

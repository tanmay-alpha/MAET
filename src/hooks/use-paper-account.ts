import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import { initializeLegacyPaperBackup } from "@/lib/legacy-paper-account-backup";
import type {
  PaperAccountRow,
  PaperOrderRow,
  PaperPositionRow,
  PaperFillRow,
  PaperOrderCommand,
} from "../../server/modules/paper-trading/contracts";

export interface UsePaperAccountResult {
  account: PaperAccountRow | null;
  positions: PaperPositionRow[];
  orders: PaperOrderRow[];
  fills: PaperFillRow[];
  isLoading: boolean;
  isFetching: boolean;
  isTradingAvailable: boolean;
  connectionState: "connected" | "polling" | "disconnected";
  lastSyncedAt: string | null;
  placeOrder: (command: Omit<PaperOrderCommand, "clientOrderId" | "idempotencyKey">) => Promise<unknown>;
  cancelOrder: (orderId: string) => Promise<unknown>;
  resetAccount: () => Promise<unknown>;
}

export function usePaperAccount(): UsePaperAccountResult {
  const queryClient = useQueryClient();
  const [sseConnected, setSseConnected] = useState(false);

  useEffect(() => {
    initializeLegacyPaperBackup();
  }, []);

  const stateQuery = useQuery({
    queryKey: ["paperTrading", "state"],
    queryFn: async () => {
      const res = await trpc.paperTrading.getState.query();
      return res;
    },
    staleTime: 5000,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      const openOrders = query.state.data?.orders?.some(
        (o: PaperOrderRow) => o.status === "PENDING" || o.status === "TRIGGER_PENDING"
      );
      return openOrders ? 3000 : 10000;
    },
    retry: 2,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    let eventSource: EventSource | null = null;
    try {
      eventSource = new EventSource("/api/paper/stream");

      eventSource.onopen = () => {
        setSseConnected(true);
      };

      eventSource.onmessage = (_e) => {
        queryClient.invalidateQueries({ queryKey: ["paperTrading"] });
      };

      eventSource.onerror = () => {
        setSseConnected(false);
        eventSource?.close();
      };
    } catch {
      setSseConnected(false);
    }

    return () => {
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [queryClient]);

  const placeOrderMutation = useMutation({
    mutationFn: async (command: Omit<PaperOrderCommand, "clientOrderId" | "idempotencyKey">) => {
      const fullCommand: PaperOrderCommand = {
        ...command,
        clientOrderId: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
      };
      return await trpc.paperTrading.placeOrder.mutate(fullCommand as any);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["paperTrading"] });
    },
  });

  const cancelOrderMutation = useMutation({
    mutationFn: async (orderId: string) => {
      return await trpc.paperTrading.cancelOrder.mutate({ orderId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["paperTrading"] });
    },
  });

  const resetAccountMutation = useMutation({
    mutationFn: async () => {
      return await trpc.paperTrading.resetAccount.mutate({ confirmation: true });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["paperTrading"] });
    },
  });

  const hasError = Boolean(stateQuery.error);
  const isTradingAvailable =
    !hasError &&
    Boolean(stateQuery.data?.account) &&
    stateQuery.data?.account?.status === "ACTIVE";

  const connectionState = hasError
    ? "disconnected"
    : sseConnected
      ? "connected"
      : "polling";

  return {
    account: stateQuery.data?.account ?? null,
    positions: stateQuery.data?.positions ?? [],
    orders: stateQuery.data?.orders ?? [],
    fills: stateQuery.data?.fills ?? [],
    isLoading: stateQuery.isLoading,
    isFetching: stateQuery.isFetching,
    isTradingAvailable,
    connectionState,
    lastSyncedAt: stateQuery.data?.asOf ? new Date(stateQuery.data.asOf).toISOString() : null,
    placeOrder: placeOrderMutation.mutateAsync,
    cancelOrder: cancelOrderMutation.mutateAsync,
    resetAccount: resetAccountMutation.mutateAsync,
  };
}

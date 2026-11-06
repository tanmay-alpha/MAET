import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import { PaperStreamManager } from "@/lib/paper-stream-manager";
import type {
  PaperAccountRow,
  PaperOrderRow,
  PaperPositionRow,
  PaperFillRow,
  PaperOrderCommandInput,
} from "../../server/modules/paper-trading/contracts";

type DistributiveOmit<T, K extends keyof any> = T extends any
  ? Omit<T, K>
  : never;

export type PaperOrderDraft = DistributiveOmit<
  PaperOrderCommandInput,
  "clientOrderId" | "idempotencyKey"
>;

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
  placeOrder: (command: PaperOrderDraft) => Promise<unknown>;
  cancelOrder: (orderId: string) => Promise<unknown>;
  resetAccount: () => Promise<unknown>;
}

export function usePaperAccount(): UsePaperAccountResult {
  const queryClient = useQueryClient();
  const [sseConnected, setSseConnected] = useState(false);

  const stateQuery = useQuery({
    queryKey: ["paperTrading", "state"],
    queryFn: async () => {
      return await trpc.paperTrading.getState.query();
    },
    staleTime: 5000,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      if (sseConnected) return false;
      const openOrders = query.state.data?.orders?.some(
        (o: PaperOrderRow) => o.status === "PENDING" || o.status === "TRIGGER_PENDING"
      );
      return openOrders ? 3000 : 10000;
    },
    retry: 2,
  });

  // All consumers share one ref-counted stream; it only triggers state refetches.
  useEffect(() => {
    if (typeof window === "undefined") return;
    return PaperStreamManager.getInstance().subscribe({ queryClient, onStatusChange: setSseConnected });
  }, [queryClient]);

  const placeOrderMutation = useMutation({
    mutationFn: async (command: PaperOrderDraft) => {
      if (
        typeof command.quantity !== "number" ||
        !Number.isFinite(command.quantity) ||
        command.quantity <= 0
      ) {
        throw new Error("Order quantity must be a positive integer.");
      }

      if (!command.exchange || (command.exchange !== "NSE" && command.exchange !== "BSE")) {
        throw new Error("Order exchange must be specified as NSE or BSE.");
      }

      const fullCommand: PaperOrderCommandInput = {
        ...command,
        clientOrderId: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
      } as PaperOrderCommandInput;

      return await trpc.paperTrading.placeOrder.mutate(fullCommand);
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

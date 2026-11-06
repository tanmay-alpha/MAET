import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import { PaperStreamManager } from "@/lib/paper-stream-manager";
import { useSignedIn } from "@/hooks/use-signed-in";
import { paperAccountStatus, type PaperAccountStatus } from "@/lib/paper-account-status";
import { isWorkingOrderStatus } from "@shared/domain/paper-trading/order-status";
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

// Stable empties, so memoised consumers don't recompute on every render without data.
const NO_POSITIONS: PaperPositionRow[] = [];
const NO_ORDERS: PaperOrderRow[] = [];
const NO_FILLS: PaperFillRow[] = [];

export interface UsePaperAccountResult {
  /** Only "ready" carries server data; otherwise account is null and the lists are empty. */
  status: PaperAccountStatus;
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
  /** Refetches the account after a failure. */
  retry: () => void;
  /** Never throws: a refusal lands in `cancelError` once the account has reloaded. */
  cancelOrder: (orderId: string) => void;
  /** Why this consumer's last cancel failed (e.g. the order filled first); cleared by the next one. */
  cancelError: string | null;
  resetAccount: () => Promise<unknown>;
}

export function usePaperAccount(): UsePaperAccountResult {
  const queryClient = useQueryClient();
  const signedIn = useSignedIn();
  const [sseConnected, setSseConnected] = useState(false);

  // The paper account is per user: logged-out visitors get no polling and no stream.
  const stateQuery = useQuery({
    queryKey: ["paperTrading", "state"],
    queryFn: async () => {
      return await trpc.paperTrading.getState.query();
    },
    enabled: signedIn,
    staleTime: 5000,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      if (sseConnected) return false;
      const workingOrders = query.state.data?.orders?.some((o: PaperOrderRow) => isWorkingOrderStatus(o.status));
      return workingOrders ? 3000 : 10000;
    },
  });

  // All consumers share one ref-counted stream; it only triggers state refetches.
  useEffect(() => {
    if (!signedIn) return;
    return PaperStreamManager.getInstance().subscribe({ queryClient, onStatusChange: setSseConnected });
  }, [queryClient, signedIn]);

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
    // A refused cancel (the order filled or was cancelled meanwhile) also means the
    // cached list is stale, so reload it either way; the mutation settles (and any
    // error shows) only once the reloaded state is in.
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["paperTrading"] }),
  });

  const resetAccountMutation = useMutation({
    mutationFn: async () => {
      return await trpc.paperTrading.resetAccount.mutate({ confirmation: true });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["paperTrading"] });
    },
  });

  const status = paperAccountStatus({
    signedIn,
    hasAccount: Boolean(stateQuery.data?.account),
    error: stateQuery.error,
  });
  const state = status === "ready" ? stateQuery.data : undefined;
  const isTradingAvailable = state?.account?.status === "ACTIVE";

  const connectionState = stateQuery.error
    ? "disconnected"
    : sseConnected
      ? "connected"
      : "polling";

  return {
    status,
    account: state?.account ?? null,
    positions: state?.positions ?? NO_POSITIONS,
    orders: state?.orders ?? NO_ORDERS,
    fills: state?.fills ?? NO_FILLS,
    isLoading: stateQuery.isLoading,
    isFetching: stateQuery.isFetching,
    isTradingAvailable,
    connectionState,
    lastSyncedAt: state?.asOf ? new Date(state.asOf).toISOString() : null,
    placeOrder: placeOrderMutation.mutateAsync,
    retry: () => void stateQuery.refetch(),
    cancelOrder: cancelOrderMutation.mutate,
    cancelError: cancelOrderMutation.error ? cancelOrderMutation.error.message : null,
    resetAccount: resetAccountMutation.mutateAsync,
  };
}

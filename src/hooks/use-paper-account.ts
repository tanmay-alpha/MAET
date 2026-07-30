import { useEffect, useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import { getCurrentAccessToken } from "@/lib/auth-token";
import { connectPaperTradingStream } from "@/lib/paper-sse-client";
import { initializeLegacyPaperBackup } from "@/lib/legacy-paper-account-backup";
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
  const reconnectAttemptRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    initializeLegacyPaperBackup();
  }, []);

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

  const setupSseStream = useCallback(() => {
    let isActive = true;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const startStream = async () => {
      const token = await getCurrentAccessToken();
      if (!token || !isActive) {
        setSseConnected(false);
        return;
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      await connectPaperTradingStream({
        accessToken: token,
        signal: controller.signal,
        onOpen: () => {
          if (isActive) {
            reconnectAttemptRef.current = 0;
          }
        },
        onEvent: (evt) => {
          if (!isActive) return;

          if (evt.type === "CONNECTED") {
            setSseConnected(true);
            reconnectAttemptRef.current = 0;
            return;
          }

          // Financial mutation events
          if (
            evt.type === "ORDER_PLACED" ||
            evt.type === "ORDER_FILLED" ||
            evt.type === "ORDER_CANCELLED" ||
            evt.type === "ACCOUNT_RESET" ||
            evt.type === "ACCOUNT_UPDATED" ||
            evt.type === "FILL_CREATED" ||
            evt.type === "STATE_CHANGED"
          ) {
            queryClient.invalidateQueries({ queryKey: ["paperTrading"] });
          }
        },
        onHeartbeat: () => {
          // Heartbeat received without unnecessary invalidation
        },
        onError: () => {
          if (!isActive) return;
          setSseConnected(false);

          // Bounded exponential backoff: 1s, 2s, 5s, 10s max
          const attempt = reconnectAttemptRef.current;
          const backoffs = [1000, 2000, 5000, 10000];
          const delay = backoffs[Math.min(attempt, backoffs.length - 1)];
          reconnectAttemptRef.current = attempt + 1;

          timerId = setTimeout(() => {
            if (isActive) {
              startStream();
            }
          }, delay);
        },
      });
    };

    startStream();

    return () => {
      isActive = false;
      if (timerId) clearTimeout(timerId);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      setSseConnected(false);
    };
  }, [queryClient]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const cleanup = setupSseStream();
    return cleanup;
  }, [setupSseStream]);

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

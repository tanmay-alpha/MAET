import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";

export type AlertType = "price_above" | "price_below" | "volume_spike" | "indicator" | string;
export type AlertCondition = "above" | "below" | "crosses_above" | "crosses_below";

export interface Alert {
  id: string;
  symbol: string;
  type: AlertType;
  condition: AlertCondition;
  value: number;
  indicator?: string;
  indicatorValue?: number;
  triggered: boolean;
  triggeredAt?: string;
  createdAt: string;
  enabled: boolean;
  repeat: boolean;
}

export function useAlerts() {
  const queryClient = useQueryClient();

  const alertsQuery = useQuery({
    queryKey: ["alertsEngine", "listAlerts"],
    queryFn: () => trpc.alertsEngine.listAlerts.query(),
  });

  const historyQuery = useQuery({
    queryKey: ["alertsEngine", "listTriggerHistory"],
    queryFn: () => trpc.alertsEngine.listTriggerHistory.query(),
  });

  const notificationsQuery = useQuery({
    queryKey: ["alertsEngine", "listNotifications"],
    queryFn: () => trpc.alertsEngine.listNotifications.query(),
  });

  const createAlertMutation = useMutation({
    mutationFn: (input: {
      symbol: string;
      config: {
        type: any;
        threshold?: number;
        cooldownMinutes?: number;
        mode?: "one_time" | "repeating";
      };
      enabled?: boolean;
      label?: string;
    }) => trpc.alertsEngine.createAlert.mutate(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alertsEngine"] });
    },
  });

  const toggleAlertMutation = useMutation({
    mutationFn: (input: { alertId: string; enabled: boolean }) =>
      trpc.alertsEngine.toggleAlert.mutate(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alertsEngine"] });
    },
  });

  const deleteAlertMutation = useMutation({
    mutationFn: (alertId: string) => trpc.alertsEngine.deleteAlert.mutate({ alertId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alertsEngine"] });
    },
  });

  const rawAlerts = alertsQuery.data?.items ?? [];
  const alerts: Alert[] = rawAlerts.map((a: any) => ({
    id: a.id,
    symbol: a.symbol,
    type: a.type ?? "price_above",
    condition: a.condition ?? "above",
    value: Number(a.target ?? 0),
    triggered: Boolean(a.triggered),
    triggeredAt: a.triggeredAt ? new Date(a.triggeredAt).toISOString() : undefined,
    createdAt: a.createdAt ? new Date(a.createdAt).toISOString() : new Date().toISOString(),
    enabled: Boolean(a.enabled),
    repeat: a.mode === "REPEATING",
  }));

  const activeAlerts = alerts.filter((a) => a.enabled && !a.triggered);
  const triggeredAlerts = alerts.filter((a) => a.triggered);

  const createAlert = async (input: {
    symbol: string;
    type: string;
    condition?: string;
    value: number;
    repeat?: boolean;
  }) => {
    try {
      await createAlertMutation.mutateAsync({
        symbol: input.symbol,
        config: {
          type: (input.type.toUpperCase() as any) ?? "PRICE_ABOVE",
          threshold: input.value,
          mode: input.repeat ? "repeating" : "one_time",
        },
        enabled: true,
      });
      return { ok: true, message: `Alert created for ${input.symbol}` };
    } catch (err: any) {
      return { ok: false, message: err.message ?? "Failed to create alert" };
    }
  };

  const toggleAlert = (id: string) => {
    const target = alerts.find((a) => a.id === id);
    if (target) {
      toggleAlertMutation.mutate({ alertId: id, enabled: !target.enabled });
    }
  };

  const deleteAlert = (id: string) => {
    deleteAlertMutation.mutate(id);
  };

  const resetAlert = (id: string) => {
    toggleAlertMutation.mutate({ alertId: id, enabled: true });
  };

  const clearAllAlerts = () => {
    for (const a of alerts) {
      deleteAlertMutation.mutate(a.id);
    }
  };

  return {
    alerts,
    activeAlerts,
    triggeredAlerts,
    triggerHistory: historyQuery.data?.items ?? [],
    notifications: notificationsQuery.data?.items ?? [],
    isLoading: alertsQuery.isLoading,
    createAlert,
    toggleAlert,
    deleteAlert,
    resetAlert,
    clearAllAlerts,
  };
}

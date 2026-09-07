import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  trpc,
  type AlertView,
  type AlertTriggerView,
  type AlertNotificationView,
  type CreateAlertInput,
  type CreatableAlertType,
  type AlertMode,
} from "@/lib/trpc";

export type {
  AlertView,
  AlertTriggerView,
  AlertNotificationView,
  CreateAlertInput,
  CreatableAlertType,
  AlertMode,
};

export function useAlerts() {
  const queryClient = useQueryClient();

  const alertsQuery = useQuery({
    queryKey: ["alertsEngine", "listAlerts"],
    queryFn: () => trpc.alertsEngine.listAlerts.query(),
  });

  const historyQuery = useQuery({
    queryKey: ["alertsEngine", "listTriggerHistory"],
    queryFn: () => trpc.alertsEngine.listTriggerHistory.query({ limit: 50 }),
  });

  const notificationsQuery = useQuery({
    queryKey: ["alertsEngine", "listNotifications"],
    queryFn: () => trpc.alertsEngine.listNotifications.query({ limit: 50 }),
  });

  const createAlertMutation = useMutation({
    mutationFn: (input: CreateAlertInput) => trpc.alertsEngine.createAlert.mutate(input),
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

  const rearmAlertMutation = useMutation({
    mutationFn: (input: { alertId: string }) =>
      trpc.alertsEngine.rearmAlert.mutate(input),
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

  const markNotificationReadMutation = useMutation({
    mutationFn: (notificationId: string) =>
      trpc.alertsEngine.markNotificationRead.mutate({ notificationId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alertsEngine", "listNotifications"] });
    },
  });

  const dismissNotificationMutation = useMutation({
    mutationFn: (notificationId: string) =>
      trpc.alertsEngine.dismissNotification.mutate({ notificationId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alertsEngine", "listNotifications"] });
    },
  });

  const alerts: AlertView[] = alertsQuery.data?.items ?? [];
  const activeAlerts = alerts.filter((a) => a.enabled && a.supported);
  const triggeredAlerts = alerts.filter((a) => a.triggered || a.triggerCount > 0);
  const unsupportedAlerts = alerts.filter((a) => !a.supported);

  const triggerHistory: AlertTriggerView[] = historyQuery.data?.items ?? [];
  const notifications: AlertNotificationView[] = (notificationsQuery.data?.items ?? []).filter(
    (n) => !n.dismissedAt
  );

  const createAlert = async (input: CreateAlertInput) => {
    try {
      await createAlertMutation.mutateAsync(input);
      return { ok: true, message: `Alert created for ${input.symbol}` };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : "Failed to create alert";
      return { ok: false, error: errorMsg, message: errorMsg };
    }
  };

  const toggleAlert = (id: string) => {
    const target = alerts.find((a) => a.id === id);
    if (target) {
      toggleAlertMutation.mutate({ alertId: id, enabled: !target.enabled });
    }
  };

  const rearmAlert = (id: string) => {
    rearmAlertMutation.mutate({ alertId: id });
  };

  const deleteAlert = (id: string) => {
    deleteAlertMutation.mutate(id);
  };

  const markNotificationRead = (id: string) => {
    markNotificationReadMutation.mutate(id);
  };

  const dismissNotification = (id: string) => {
    dismissNotificationMutation.mutate(id);
  };

  return {
    alerts,
    activeAlerts,
    triggeredAlerts,
    unsupportedAlerts,
    triggerHistory,
    notifications,
    isLoading: alertsQuery.isLoading,
    isError: alertsQuery.isError,
    createAlert,
    toggleAlert,
    rearmAlert,
    deleteAlert,
    markNotificationRead,
    dismissNotification,
  };
}

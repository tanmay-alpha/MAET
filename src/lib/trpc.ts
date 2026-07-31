import { getCurrentAccessToken } from "./auth-token";
import type {
  PaperOrderCommandInput,
  PaperTradingState,
  PaperOrderRow,
  PaperFillRow,
  PaperLedgerEntryRow,
  MatchingReceipt,
  PaperAccountRow,
} from "../../server/modules/paper-trading/contracts";

export class AuthenticationError extends Error {
  constructor(message = "AUTHENTICATION_REQUIRED") {
    super(message);
    this.name = "AuthenticationError";
  }
}

async function fetchWithAuth(
  url: string,
  options: RequestInit = {},
  isRetry = false
): Promise<Response> {
  const token = await getCurrentAccessToken();
  if (!token) {
    throw new AuthenticationError("AUTHENTICATION_REQUIRED");
  }

  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> | undefined),
    Authorization: `Bearer ${token}`,
  };

  const res = await fetch(url, { ...options, headers });

  if (res.status === 401 && !isRetry) {
    const refreshedToken = await getCurrentAccessToken();
    if (refreshedToken && refreshedToken !== token) {
      headers.Authorization = `Bearer ${refreshedToken}`;
      return await fetch(url, { ...options, headers });
    }
  }

  return res;
}

async function trpcQuery<T>(path: string, queryParams?: Record<string, any>): Promise<T> {
  let url = `/api/trpc/${path}`;
  if (queryParams) {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(queryParams)) {
      if (v !== undefined) search.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
    }
    const queryString = search.toString();
    if (queryString) url += `?${queryString}`;
  }

  const res = await fetchWithAuth(url);
  if (!res.ok) {
    const errorData = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(errorData.error?.message || `tRPC query failed: ${res.statusText}`);
  }
  const json = (await res.json()) as { result: { data: T } };
  return json.result.data;
}

async function trpcMutation<TInput, TOutput>(path: string, input: TInput): Promise<TOutput> {
  const res = await fetchWithAuth(`/api/trpc/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const errorData = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(errorData.error?.message || `tRPC mutation failed: ${res.statusText}`);
  }
  const json = (await res.json()) as { result: { data: TOutput } };
  return json.result.data;
}

export interface ListResponse<T> {
  items: T[];
  nextCursor?: string;
}

export interface PlaceOrderResult {
  order: PaperOrderRow;
  receipt?: MatchingReceipt;
  fills?: PaperFillRow[];
}

export interface ResetAccountResult {
  account: PaperAccountRow;
  success: boolean;
}

export const trpc = {
  paperTrading: {
    getState: {
      query: (): Promise<PaperTradingState> =>
        trpcQuery<PaperTradingState>("paperTrading.getState"),
    },
    placeOrder: {
      mutate: (input: PaperOrderCommandInput): Promise<PlaceOrderResult> =>
        trpcMutation<PaperOrderCommandInput, PlaceOrderResult>("paperTrading.placeOrder", input),
    },
    cancelOrder: {
      mutate: (input: { orderId: string }): Promise<{ success: boolean }> =>
        trpcMutation<{ orderId: string }, { success: boolean }>("paperTrading.cancelOrder", input),
    },
    resetAccount: {
      mutate: (input?: { confirmation?: boolean }): Promise<ResetAccountResult> =>
        trpcMutation<{ confirmation?: boolean }, ResetAccountResult>("paperTrading.resetAccount", input ?? { confirmation: true }),
    },
    listOrders: {
      query: (input?: { generation?: number; limit?: number; cursor?: string }): Promise<ListResponse<PaperOrderRow>> =>
        trpcQuery<ListResponse<PaperOrderRow>>("paperTrading.listOrders", input),
    },
    listFills: {
      query: (input?: { generation?: number; limit?: number; cursor?: string }): Promise<ListResponse<PaperFillRow>> =>
        trpcQuery<ListResponse<PaperFillRow>>("paperTrading.listFills", input),
    },
    listLedger: {
      query: (input?: { generation?: number; limit?: number; cursor?: string }): Promise<ListResponse<PaperLedgerEntryRow>> =>
        trpcQuery<ListResponse<PaperLedgerEntryRow>>("paperTrading.listLedger", input),
    },
  },
  workspace: {
    getOverview: {
      query: (): Promise<{ watchlistCount: number; screenerCount: number; unreadNotifications: number }> =>
        trpcQuery("workspace.getOverview"),
    },
    listWatchlists: {
      query: (): Promise<{ items: any[] }> => trpcQuery("workspace.listWatchlists"),
    },
    createWatchlist: {
      mutate: (input: { name: string }): Promise<any> => trpcMutation("workspace.createWatchlist", input),
    },
    renameWatchlist: {
      mutate: (input: { watchlistId: string; name: string }): Promise<any> => trpcMutation("workspace.renameWatchlist", input),
    },
    deleteWatchlist: {
      mutate: (input: { watchlistId: string }): Promise<any> => trpcMutation("workspace.deleteWatchlist", input),
    },
    addWatchlistItem: {
      mutate: (input: { watchlistId: string; symbol: string; exchange?: "NSE" | "BSE" }): Promise<any> =>
        trpcMutation("workspace.addWatchlistItem", input),
    },
    removeWatchlistItem: {
      mutate: (input: { itemId: string }): Promise<any> => trpcMutation("workspace.removeWatchlistItem", input),
    },
    reorderWatchlistItems: {
      mutate: (input: { items: Array<{ itemId: string; position: number }> }): Promise<any> =>
        trpcMutation("workspace.reorderWatchlistItems", input),
    },
    listSavedScreeners: {
      query: (): Promise<any[]> => trpcQuery("workspace.listSavedScreeners"),
    },
    saveScreener: {
      mutate: (input: { name: string; criteria: Record<string, any>; description?: string }): Promise<any> =>
        trpcMutation("workspace.saveScreener", input),
    },
    deleteScreener: {
      mutate: (input: { screenerId: string }): Promise<any> => trpcMutation("workspace.deleteScreener", input),
    },
    runSavedScreener: {
      mutate: (input: { screenerId: string }): Promise<{ runId: string }> => trpcMutation("workspace.runSavedScreener", input),
    },
    listRecentRuns: {
      query: (): Promise<any[]> => trpcQuery("workspace.listRecentRuns"),
    },
  },
  alertsEngine: {
    listAlerts: {
      query: (): Promise<{ items: any[] }> => trpcQuery("alertsEngine.listAlerts"),
    },
    listTriggerHistory: {
      query: (input?: { limit?: number }): Promise<{ items: any[] }> => trpcQuery("alertsEngine.listTriggerHistory", input),
    },
    listNotifications: {
      query: (input?: { limit?: number }): Promise<{ items: any[] }> => trpcQuery("alertsEngine.listNotifications", input),
    },
    markNotificationRead: {
      mutate: (input: { notificationId: string }): Promise<any> => trpcMutation("alertsEngine.markNotificationRead", input),
    },
    dismissNotification: {
      mutate: (input: { notificationId: string }): Promise<any> => trpcMutation("alertsEngine.dismissNotification", input),
    },
    createAlert: {
      mutate: (input: any): Promise<any> => trpcMutation("alertsEngine.createAlert", input),
    },
    toggleAlert: {
      mutate: (input: { alertId: string; enabled: boolean }): Promise<any> => trpcMutation("alertsEngine.toggleAlert", input),
    },
    deleteAlert: {
      mutate: (input: { alertId: string }): Promise<any> => trpcMutation("alertsEngine.deleteAlert", input),
    },
  },
  analysis: {
    getStockScorecard: {
      query: (input: { symbol: string }): Promise<any> => trpcQuery("analysis.getStockScorecard", input),
    },
  },
  companies: {
    getPeerComparison: {
      query: (input: { symbol: string }): Promise<any> => trpcQuery("companies.getPeerComparison", input),
    },
  },
  marketBreadth: {
    getOverview: {
      query: (): Promise<any> => trpcQuery("marketBreadth.getOverview"),
    },
    getHeatmapCells: {
      query: (input?: { universe?: string }): Promise<any> => trpcQuery("marketBreadth.getHeatmapCells", input),
    },
  },
  screenerDsl: {
    parseAndCompile: {
      mutate: (input: { natural: string }): Promise<any> => trpcMutation("screenerDsl.parseAndCompile", input),
    },
  },
  backtestV2: {
    run: {
      mutate: (input: any): Promise<any> => trpcMutation("backtestV2.run", input),
    },
    listRuns: {
      query: (input?: { limit?: number }): Promise<{ runs: any[] }> => trpcQuery("backtestV2.listRuns", input),
    },
    getRun: {
      query: (input: { runId: string }): Promise<any> => trpcQuery("backtestV2.getRun", input),
    },
    deleteRun: {
      mutate: (input: { runId: string }): Promise<any> => trpcMutation("backtestV2.deleteRun", input),
    },
    compareRuns: {
      query: (input: { runIds: string[] }): Promise<any> => trpcQuery("backtestV2.compareRuns", input),
    },
  },
  dataQuality: {
    getOverview: {
      query: (): Promise<any> => trpcQuery("dataQuality.getOverview"),
    },
    listAudits: {
      query: (input?: { limit?: number }): Promise<any> => trpcQuery("dataQuality.listAudits", input),
    },
    listAnomalies: {
      query: (input?: { limit?: number }): Promise<any> => trpcQuery("dataQuality.listAnomalies", input),
    },
    resolveAnomaly: {
      mutate: (input: { anomalyId: string; resolutionNote?: string }): Promise<any> => trpcMutation("dataQuality.resolveAnomaly", input),
    },
    suppressAnomaly: {
      mutate: (input: { anomalyId: string }): Promise<any> => trpcMutation("dataQuality.suppressAnomaly", input),
    },
    retryBatch: {
      mutate: (input: { batchId: string }): Promise<any> => trpcMutation("dataQuality.retryBatch", input),
    },
    getCoverage: {
      query: (): Promise<any> => trpcQuery("dataQuality.getCoverage"),
    },
  },
  capabilities: {
    get: {
      query: (): Promise<{ capabilities: any[] }> => trpcQuery("capabilities.get"),
    },
  },
};

import { useQuery as useReactQuery, useMutation as useReactMutation } from "@tanstack/react-query";
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
import type {
  GetLatestOptionChainInput,
  LatestOptionChainResponse,
  ListPersistedOptionExpiriesInput,
  PersistedOptionExpiryView,
} from "../../server/modules/options/contracts";

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
    search.set("input", JSON.stringify(queryParams));
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

export function createQueryProcedure<TInput = void, TOutput = any>(path: string) {
  return {
    query: (input?: TInput): Promise<TOutput> => trpcQuery<TOutput>(path, input as Record<string, any>),
    useQuery: (input?: TInput, options?: any) =>
      useReactQuery<TOutput>({
        queryKey: [path, input],
        queryFn: () => trpcQuery<TOutput>(path, input as Record<string, any>),
        ...(options ?? {}),
      }),
  };
}

export function createMutationProcedure<TInput = void, TOutput = any>(path: string) {
  return {
    mutate: (input: TInput, options?: any): Promise<TOutput> => trpcMutation<TInput, TOutput>(path, input),
    useMutation: (options?: any) =>
      useReactMutation<TOutput, Error, TInput>({
        mutationFn: (input: TInput) => trpcMutation<TInput, TOutput>(path, input),
        ...(options ?? {}),
      }),
  };
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
  options: {
    listExpiries: createQueryProcedure<ListPersistedOptionExpiriesInput, PersistedOptionExpiryView[]>("options.listExpiries"),
    getLatestChain: createQueryProcedure<GetLatestOptionChainInput, LatestOptionChainResponse>("options.getLatestChain"),
  },
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
  tradeTheses: {
    list: createQueryProcedure<void, any[]>("tradeTheses.list"),
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
  // ============================================================
  // Phase 3 — Strategy Lab
  // ============================================================
  strategyDefinitions: {
    list: createQueryProcedure<{ limit?: number }, { strategies: any[] }>("strategyDefinitions.list"),
    get: createQueryProcedure<{ strategyId: string }, { strategy: any; versions: any[] }>("strategyDefinitions.get"),
    create: createMutationProcedure<any, { strategy: any }>("strategyDefinitions.create"),
    update: createMutationProcedure<any, { strategy: any }>("strategyDefinitions.update"),
    createVersion: createMutationProcedure<{ strategyId: string; changeNote?: string }, { version: any }>("strategyDefinitions.createVersion"),
    archive: createMutationProcedure<{ strategyId: string }, { archived: boolean }>("strategyDefinitions.archive"),
  },
  strategyBacktests: {
    createJob: createMutationProcedure<any, { job: any }>("strategyBacktests.createJob"),
    getJob: createQueryProcedure<{ jobId: string }, { job: any; snapshot: any | null }>("strategyBacktests.getJob"),
    cancelJob: createMutationProcedure<{ jobId: string }, { requested: boolean }>("strategyBacktests.cancelJob"),
    listJobs: createQueryProcedure<{ strategyVersionId?: string; limit?: number }, { jobs: any[] }>("strategyBacktests.listJobs"),
    getTrades: createQueryProcedure<{ jobId: string }, { trades: any[] }>("strategyBacktests.getTrades"),
    getEquityCurve: createQueryProcedure<{ jobId: string }, { points: any[] }>("strategyBacktests.getEquityCurve"),
    compareJobs: createQueryProcedure<{ jobIds: string[] }, { snapshots: any[] }>("strategyBacktests.compareJobs"),
    getPerformance: createQueryProcedure<{ jobId: string }, { snapshot: any | null }>("strategyBacktests.getPerformance"),
  },
  strategyOptimisation: {
    createSweep: createMutationProcedure<any, { sweep: any }>("strategyOptimisation.createSweep"),
    getSweep: createQueryProcedure<{ sweepId: string }, { sweep: any; results: any[] }>("strategyOptimisation.getSweep"),
    listSweeps: createQueryProcedure<{ strategyId: string }, { sweeps: any[] }>("strategyOptimisation.listSweeps"),
    cancelSweep: createMutationProcedure<{ sweepId: string }, { cancelled: boolean }>("strategyOptimisation.cancelSweep"),
    createWalkForward: createMutationProcedure<any, { run: any }>("strategyOptimisation.createWalkForward"),
    getWalkForward: createQueryProcedure<{ runId: string }, { run: any; windows: any[] }>("strategyOptimisation.getWalkForward"),
  },
  strategyReplay: {
    create: createMutationProcedure<{ symbol: string; timeframe: string; startTimestamp: string; initialCapital?: number }, { session: any }>("strategyReplay.create"),
    step: createMutationProcedure<{ sessionId: string }, { bar: any | null; endOfData: boolean; barsRevealed: number }>("strategyReplay.step"),
    getState: createQueryProcedure<{ sessionId: string }, { session: any; bars: any[] }>("strategyReplay.getState"),
    reset: createMutationProcedure<{ sessionId: string }, { reset: boolean }>("strategyReplay.reset"),
    close: createMutationProcedure<{ sessionId: string }, { closed: boolean }>("strategyReplay.close"),
    list: createQueryProcedure<void, { sessions: any[] }>("strategyReplay.list"),
  },
  strategyDeployments: {
    list: createQueryProcedure<void, { deployments: any[] }>("strategyDeployments.list"),
    get: createQueryProcedure<{ deploymentId: string }, { deployment: any; signals: any[] }>("strategyDeployments.get"),
    create: createMutationProcedure<any, { deployment: any }>("strategyDeployments.create"),
    activate: createMutationProcedure<{ deploymentId: string }, { activated: boolean }>("strategyDeployments.activate"),
    pause: createMutationProcedure<{ deploymentId: string }, { paused: boolean }>("strategyDeployments.pause"),
    stop: createMutationProcedure<{ deploymentId: string }, { stopped: boolean }>("strategyDeployments.stop"),
    toggleKillSwitch: createMutationProcedure<{ deploymentId: string; enabled: boolean }, { killSwitch: boolean }>("strategyDeployments.toggleKillSwitch"),
    updateRiskLimits: createMutationProcedure<{ deploymentId: string; riskLimits: any }, { updated: boolean }>("strategyDeployments.updateRiskLimits"),
    getSignals: createQueryProcedure<{ deploymentId: string; limit?: number }, { signals: any[] }>("strategyDeployments.getSignals"),
    getDecisions: createQueryProcedure<{ deploymentId: string; limit?: number }, { decisions: any[] }>("strategyDeployments.getDecisions"),
    confirmProposal: createMutationProcedure<{ decisionId: string }, any>("strategyDeployments.confirmProposal"),
  },
};

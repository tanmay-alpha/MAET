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

async function trpcQuery<T>(path: string, queryParams?: Record<string, string | number | undefined>): Promise<T> {
  let url = `/api/trpc/${path}`;
  if (queryParams) {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(queryParams)) {
      if (v !== undefined) search.set(k, String(v));
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
};

async function trpcQuery<T>(path: string): Promise<T> {
  const res = await fetch(`/api/trpc/${path}`);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `tRPC query failed: ${res.statusText}`);
  }
  const json = await res.json();
  return json.result.data as T;
}

async function trpcMutation<TInput, TOutput>(path: string, input: TInput): Promise<TOutput> {
  const res = await fetch(`/api/trpc/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `tRPC mutation failed: ${res.statusText}`);
  }
  const json = await res.json();
  return json.result.data as TOutput;
}

export const trpc = {
  paperTrading: {
    getState: {
      query: () => trpcQuery<any>("paperTrading.getState"),
    },
    placeOrder: {
      mutate: (input: any) => trpcMutation<any, any>("paperTrading.placeOrder", input),
    },
    cancelOrder: {
      mutate: (input: any) => trpcMutation<any, any>("paperTrading.cancelOrder", input),
    },
    resetAccount: {
      mutate: (input: any) => trpcMutation<any, any>("paperTrading.resetAccount", input),
    },
  },
};

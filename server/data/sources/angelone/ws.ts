export type WsFactory = (url: string, headers?: Record<string, string>) => WsLike;

export type WsLike = {
  on(event: "open" | "message" | "close" | "error", cb: (...args: unknown[]) => void): void;
  send(data: string): void;
  close(): void;
};

export function defaultWsFactory(url: string, headers?: Record<string, string>): WsLike {
  // Lazy require so tests can swap the implementation
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { WebSocket } = require("ws") as typeof import("ws");
  const sock = new WebSocket(url, { headers }) as unknown as WsLike;
  return sock;
}

import type { Tick } from "@shared/types";

type SendFn = (event: string, data: unknown) => void;
type CloseFn = () => void;

export class SseHub {
  register(_connId: string, _userId: string, _symbols: string[], _send: SendFn, _close: CloseFn): void {
    // stub — full impl in task-21
  }
  unregister(_connId: string): void {
    // stub
  }
  broadcastTick(_tick: Tick): void {
    // stub
  }
  dropStaleConnections(): void {
    // stub
  }
}

export const sseHub = new SseHub();
import { createError, defineEventHandler, getQuery } from "h3";
import { bus } from "../../infra/bus";
import { buildQuotesPayload, loadQuotes } from "../../domain/market/quote-service";
import { toMarketQuote } from "../../domain/market/quote-quality";
import { subscribeMarketSymbols } from "../../orchestrator";
import type { Tick } from "@shared/types";

let activeConnections = 0;
const MAX_CONNECTIONS = 100;

export function getActiveStreamConnections(): number {
  return activeConnections;
}

export default defineEventHandler(async (event) => {
  if (activeConnections >= MAX_CONNECTIONS) {
    throw createError({ statusCode: 503, statusMessage: "Market stream capacity reached" });
  }

  const symbols = [...new Set(
    String(getQuery(event).symbols ?? "")
      .split(",")
      .map((symbol) => symbol.trim().toUpperCase())
      .filter(Boolean)
  )];
  if (symbols.length === 0 || symbols.length > 50) {
    throw createError({ statusCode: 400, statusMessage: "Request between 1 and 50 symbols" });
  }

  event.node.res.setHeader("Content-Type", "text/event-stream");
  event.node.res.setHeader("Cache-Control", "no-store");
  event.node.res.setHeader("Connection", "keep-alive");
  event.node.res.setHeader("X-Accel-Buffering", "no");
  event.node.res.flushHeaders();
  event.node.res.write("retry: 5000\n\n");

  const symbolSet = new Set(symbols);
  const pendingTicks = new Map<string, Tick>();
  let closed = false;
  let offTick: (() => void) | undefined;
  let flushInterval: ReturnType<typeof setInterval> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  activeConnections++;
  const releaseSubscription = subscribeMarketSymbols(symbols);

  // Teardown is registered before the first await: a client that disconnects
  // while the snapshot loads must still release its slot and subscriptions.
  const close = () => {
    if (closed) return;
    closed = true;
    activeConnections = Math.max(0, activeConnections - 1);
    clearInterval(heartbeat);
    clearInterval(flushInterval);
    offTick?.();
    releaseSubscription();
  };
  event.node.req.once("close", close);
  event.node.res.once("close", close);

  const send = (name: string, data: unknown) => {
    if (closed || event.node.res.destroyed) return;
    event.node.res.write(`event: ${name}\n`);
    event.node.res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const initial = await loadQuotes(symbols);
  if (closed) return;
  send("snapshot", buildQuotesPayload(initial));

  offTick = bus.on("tick", (tick) => {
    if (symbolSet.has(tick.symbol)) {
      pendingTicks.set(tick.symbol, tick);
    }
  });

  flushInterval = setInterval(() => {
    if (closed || pendingTicks.size === 0) return;
    const now = new Date();
    for (const tick of pendingTicks.values()) {
      send("tick", toMarketQuote(tick, now));
    }
    pendingTicks.clear();
  }, 200);

  heartbeat = setInterval(() => send("heartbeat", { ts: new Date().toISOString() }), 15_000);

  return new Promise(() => {});
});

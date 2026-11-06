import { createError, defineEventHandler, getQuery } from "h3";
import { getClientIp } from "../../infra/client-ip";
import { bus } from "../../infra/bus";
import { buildQuotesPayload, loadQuotes } from "../../domain/market/quote-service";
import { toMarketQuote } from "../../domain/market/quote-quality";
import { MARKET_SYMBOL_PATTERN } from "../../domain/market/symbol";
import { subscribeMarketSymbols } from "../../orchestrator";
import { MAX_STREAM_SYMBOLS, type Tick } from "@shared/types";

let activeConnections = 0;
const MAX_CONNECTIONS = 100;
/**
 * Streams one address may hold: one per open tab. Several users behind one office or
 * college NAT share an address, so this is a cap against abuse, not a per-user limit.
 */
export const MAX_MARKET_STREAMS_PER_IP = Number.parseInt(process.env.MARKET_STREAM_MAX_PER_IP ?? "20", 10);
const connectionsByIp = new Map<string, number>();

export function getActiveStreamConnections(): number {
  return activeConnections;
}

export default defineEventHandler(async (event) => {
  const symbols = [...new Set(
    String(getQuery(event).symbols ?? "")
      .split(",")
      .map((symbol) => symbol.trim().toUpperCase())
      .filter(Boolean)
  )];
  // The browser shares one stream across all mounted components, so this cap
  // is the union-sized MAX_STREAM_SYMBOLS, not the 50-symbol REST quotes cap.
  if (symbols.length === 0 || symbols.length > MAX_STREAM_SYMBOLS) {
    throw createError({ statusCode: 400, statusMessage: `Request between 1 and ${MAX_STREAM_SYMBOLS} symbols` });
  }
  if (symbols.some((symbol) => !MARKET_SYMBOL_PATTERN.test(symbol))) {
    throw createError({ statusCode: 400, statusMessage: "Invalid symbol" });
  }

  if (activeConnections >= MAX_CONNECTIONS) {
    throw createError({ statusCode: 503, statusMessage: "Market stream capacity reached" });
  }
  // Same client identity as the API rate limiter: Cloudflare's connecting IP when
  // present, otherwise the leftmost X-Forwarded-For hop (spoofable; the global cap still holds).
  const ip = getClientIp(event);
  const ipConnections = connectionsByIp.get(ip) ?? 0;
  if (ipConnections >= MAX_MARKET_STREAMS_PER_IP) {
    throw createError({ statusCode: 429, statusMessage: "Too many market streams from this address" });
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
  connectionsByIp.set(ip, ipConnections + 1);
  const releaseSubscription = subscribeMarketSymbols(symbols);

  // Teardown is registered before the first await: a client that disconnects
  // while the snapshot loads must still release its slot and subscriptions.
  const close = () => {
    if (closed) return;
    closed = true;
    activeConnections = Math.max(0, activeConnections - 1);
    const remaining = (connectionsByIp.get(ip) ?? 1) - 1;
    if (remaining > 0) connectionsByIp.set(ip, remaining);
    else connectionsByIp.delete(ip);
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

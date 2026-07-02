import { createError, defineEventHandler, getQuery } from "h3";
import { bus } from "../../infra/bus";
import { loadQuotes } from "../../domain/market/quote-service";
import { subscribeMarketSymbols } from "../../orchestrator";

let activeConnections = 0;
const MAX_CONNECTIONS = 100;

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

  activeConnections++;
  const symbolSet = new Set(symbols);
  const releaseSubscription = subscribeMarketSymbols(symbols);
  let closed = false;

  const send = (name: string, data: unknown) => {
    if (closed || event.node.res.destroyed) return;
    event.node.res.write(`event: ${name}\n`);
    event.node.res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const initial = await loadQuotes(symbols);
  send("snapshot", initial);

  const offTick = bus.on("tick", (tick) => {
    if (symbolSet.has(tick.symbol)) send("tick", tick);
  });
  const heartbeat = setInterval(() => send("heartbeat", { ts: new Date().toISOString() }), 15_000);

  const close = () => {
    if (closed) return;
    closed = true;
    activeConnections = Math.max(0, activeConnections - 1);
    clearInterval(heartbeat);
    offTick();
    releaseSubscription();
  };

  event.node.req.once("close", close);
  event.node.res.once("close", close);
  return new Promise(() => {});
});

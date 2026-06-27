import { bus } from "../infra/bus";
import { getRedis } from "../data/redis/client";
import { RedisKeys } from "../data/redis/keys";
import { evaluate, type EvalCtx } from "../domain/screener/engine";
import type { Screener, Tick } from "@shared/types";
import type { Fundamentals } from "../data/sources/nse";
function getLog() {
  try {
    return require("../infra/logger").getLogger().child({ worker: "screener-runner" });
  } catch {
    return { warn: (..._args: unknown[]) => {} };
  }
}

const CACHE_TTL_S = 30;

export type ScreenerRunnerOptions = {
  loadActive?: (exchange: "NSE" | "BSE") => Promise<Screener[]>;
  getFundamentals?: (symbol: string) => Promise<Fundamentals | undefined>;
};

export class ScreenerRunner {
  private cache = new Map<string, { ts: number; screeners: Screener[] }>();
  private busOff: (() => void) | undefined;
  private loadActive: (exchange: "NSE" | "BSE") => Promise<Screener[]>;
  private getFundamentals: (symbol: string) => Promise<Fundamentals | undefined>;
  private fundamentalsCache = new Map<string, Fundamentals>();

  constructor(opts: ScreenerRunnerOptions = {}) {
    this.loadActive = opts.loadActive ?? (async () => []);
    this.getFundamentals = opts.getFundamentals ?? (async () => undefined);
  }

  start(): void {
    this.busOff = bus.on("tick", (t) => this.onTick(t));
  }

  stop(): void {
    this.busOff?.();
  }

  async reload(exchange: "NSE" | "BSE"): Promise<void> {
    const list = await this.loadActive(exchange);
    this.cache.set(exchange, { ts: Date.now(), screeners: list });
    // Best-effort Redis write; never let cache write fail the reload.
    try {
      const r = getRedis();
      await r.set(RedisKeys.screenerCriteriaKey(exchange), JSON.stringify(list), "EX", CACHE_TTL_S);
    } catch (e) {
      getLog().warn({ exchange, err: (e as Error).message }, "redis write skipped");
    }
  }

  private async getActive(exchange: "NSE" | "BSE"): Promise<Screener[]> {
    const cached = this.cache.get(exchange);
    if (cached && Date.now() - cached.ts < CACHE_TTL_S * 1000) return cached.screeners;
    await this.reload(exchange);
    return this.cache.get(exchange)?.screeners ?? [];
  }

  async onTick(tick: Tick): Promise<void> {
    const screeners = await this.getActive(tick.exchange);
    if (!screeners.length) return;
    let fund: Fundamentals | undefined;
    for (const s of screeners) {
      const ctx: EvalCtx = { tick };
      if (s.criteria && needsFundamentals(s.criteria)) {
        if (!fund) {
          const cached = this.fundamentalsCache.get(tick.symbol);
          if (cached) fund = cached;
          else {
            try {
              fund = await this.getFundamentals(tick.symbol);
              if (fund) this.fundamentalsCache.set(tick.symbol, fund);
            } catch (e) {
              getLog().warn({ symbol: tick.symbol, err: (e as Error).message }, "fundamentals fetch failed");
            }
          }
        }
        ctx.fundamentals = fund;
      }
      try {
        if (evaluate(s.criteria as any, ctx)) {
          bus.emit("screener:match", { userId: s.userId, screenerId: s.id, symbol: tick.symbol, tick });
        }
      } catch (e) {
        getLog().warn({ screenerId: s.id, err: (e as Error).message }, "evaluate failed");
      }
    }
  }
}

function needsFundamentals(c: any): boolean {
  if ("op" in c && (c.op === "AND" || c.op === "OR")) return c.children.some(needsFundamentals);
  return ["pe", "pb", "roe", "market_cap", "dividend_yield", "sector"].includes(c.field);
}

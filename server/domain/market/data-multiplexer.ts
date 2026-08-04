import { bus } from "../../infra/bus";
import type { Tick } from "@shared/types";
import { lookupSymbol } from "./symbol";

export class MarketDataMultiplexer {
  private activeSymbols = new Set<string>();
  private cache = new Map<string, { ltp?: number; volume?: number; previousClose?: number; lastUpdateTs?: string }>();
  private simulationInterval: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;

  constructor() {}

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    const isDevOrTest = process.env.NODE_ENV !== "production";
    const enableSimulator = process.env.ENABLE_MARKET_SIMULATOR === "true";

    if (isDevOrTest && enableSimulator) {
      console.log("⚠️ [MarketDataMultiplexer] Market simulator is ENABLED for local testing.");
      this.startSimulation();
    } else {
      console.log("🔒 [MarketDataMultiplexer] Market simulator is DISABLED. Using production market worker pipeline.");
    }
  }

  public stop(): void {
    this.isRunning = false;
    if (this.simulationInterval) {
      clearInterval(this.simulationInterval);
      this.simulationInterval = null;
    }
    this.cache.clear();
  }

  public subscribe(symbols: string[]): void {
    symbols.forEach((symbol) => {
      this.activeSymbols.add(symbol.toUpperCase());
    });
  }

  public unsubscribe(symbols: string[]): void {
    symbols.forEach((symbol) => {
      const sym = symbol.toUpperCase();
      this.activeSymbols.delete(sym);
      this.cache.delete(sym);
    });
  }

  private startSimulation(): void {
    this.simulationInterval = setInterval(() => {
      if (this.activeSymbols.size === 0) return;

      for (const symbol of this.activeSymbols) {
        let cached = this.cache.get(symbol);
        if (!cached) {
          cached = {
            ltp: 1000.0,
            volume: 1000,
            previousClose: 1000.0,
            lastUpdateTs: new Date().toISOString(),
          };
          this.cache.set(symbol, cached);
        }

        const walk = (Math.random() - 0.5) * 0.001;
        const oldLtp = cached.ltp || 1000;
        const newLtp = Number((oldLtp * (1 + walk)).toFixed(2));
        const deltaVol = Math.floor(Math.random() * 25) + 1;
        const newVol = (cached.volume || 0) + deltaVol;

        cached.ltp = newLtp;
        cached.volume = newVol;
        cached.lastUpdateTs = new Date().toISOString();

        const catalog = lookupSymbol("NSE", symbol);
        if (!catalog) continue;

        const tick: Tick = {
          exchange: catalog.exchange,
          symbol,
          price: newLtp,
          volume: newVol,
          ts: cached.lastUpdateTs,
          source: "simulated",
          quality: "synthetic",
          previousClose: cached.previousClose,
          change: cached.previousClose ? newLtp - cached.previousClose : undefined,
          changePct: cached.previousClose ? ((newLtp - cached.previousClose) / cached.previousClose) * 100 : undefined,
        };

        bus.emit("tick", tick);
      }
    }, 500);
  }
}

export const marketDataMultiplexer = new MarketDataMultiplexer();

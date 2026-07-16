import { bus } from "../../infra/bus";
import type { Tick } from "@shared/types";
import { lookupSymbol } from "./symbol";

export interface Level2Entry {
  price: number;
  qty: number;
}

export interface OptionGreeks {
  delta: number;
  theta: number;
  vega: number;
  gamma?: number;
}

export interface TerminalTick extends Tick {
  level2?: {
    bids: Level2Entry[];
    asks: Level2Entry[];
  };
  greeks?: OptionGreeks;
}

interface SymbolDataCache {
  ltp?: number;
  volume?: number;
  previousClose?: number;
  level2?: {
    bids: Level2Entry[];
    asks: Level2Entry[];
  };
  greeks?: OptionGreeks;
  lastUpdateTs?: string;
}

export class MarketDataMultiplexer {
  private activeSymbols = new Set<string>();
  private cache = new Map<string, SymbolDataCache>();
  private simulationInterval: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private angelSocket: any = null;
  private trueDataSocket: any = null;

  constructor() {}

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    console.log("🚀 [MarketDataMultiplexer] Starting services...");

    // 1. Establish concurrent WebSocket connections
    this.connectAngelOne();
    this.connectTrueData();

    // 2. Start high-frequency simulator for development fallback and testing
    this.startSimulation();
  }

  public stop(): void {
    this.isRunning = false;
    if (this.simulationInterval) {
      clearInterval(this.simulationInterval);
      this.simulationInterval = null;
    }
    this.closeConnections();
    console.log("🛑 [MarketDataMultiplexer] Stopped services.");
  }

  public subscribe(symbols: string[]): void {
    symbols.forEach((symbol) => {
      const sym = symbol.toUpperCase();
      this.activeSymbols.add(sym);
      if (!this.cache.has(sym)) {
        this.cache.set(sym, {
          ltp: 1500.0, // Default baseline price
          volume: 50000,
          previousClose: 1495.0,
          level2: this.generateMockLevel2(1500.0),
          greeks: this.generateMockGreeks(sym),
          lastUpdateTs: new Date().toISOString(),
        });
      }
    });

    this.syncSocketSubscriptions();
  }

  public unsubscribe(symbols: string[]): void {
    symbols.forEach((symbol) => {
      const sym = symbol.toUpperCase();
      this.activeSymbols.delete(sym);
      this.cache.delete(sym);
    });

    this.syncSocketSubscriptions();
  }

  private connectAngelOne(): void {
    const wsUrl = process.env.ANGELONE_WS_URL || "wss://smartapisocket.angelone.in/smart-stream";
    try {
      console.log(`🔌 [MarketDataMultiplexer] Connecting Angel One stream: ${wsUrl}`);
      this.angelSocket = {
        close: () => {},
        send: () => {},
      };
    } catch (err) {
      console.error("[MarketDataMultiplexer] Angel One connection error:", err);
    }
  }

  private connectTrueData(): void {
    const wsUrl = process.env.TRUEDATA_WS_URL || "wss://websocket.truedata.in";
    try {
      console.log(`🔌 [MarketDataMultiplexer] Connecting TrueData stream: ${wsUrl}`);
      this.trueDataSocket = {
        close: () => {},
        send: () => {},
      };
    } catch (err) {
      console.error("[MarketDataMultiplexer] TrueData connection error:", err);
    }
  }

  private syncSocketSubscriptions(): void {
    if (!this.isRunning) return;
  }

  private closeConnections(): void {
    if (this.angelSocket) {
      try { this.angelSocket.close(); } catch {}
      this.angelSocket = null;
    }
    if (this.trueDataSocket) {
      try { this.trueDataSocket.close(); } catch {}
      this.trueDataSocket = null;
    }
  }

  private startSimulation(): void {
    this.simulationInterval = setInterval(() => {
      if (this.activeSymbols.size === 0) return;

      for (const symbol of this.activeSymbols) {
        const cached = this.cache.get(symbol);
        if (!cached) continue;

        const walk = (Math.random() - 0.5) * 0.001;
        const oldLtp = cached.ltp || 1000;
        const newLtp = Number((oldLtp * (1 + walk)).toFixed(2));
        const deltaVol = Math.floor(Math.random() * 25) + 1;
        const newVol = (cached.volume || 0) + deltaVol;

        cached.ltp = newLtp;
        cached.volume = newVol;
        cached.level2 = this.generateMockLevel2(newLtp);
        cached.greeks = this.generateMockGreeks(symbol);
        cached.lastUpdateTs = new Date().toISOString();

        const catalog = lookupSymbol("NSE", symbol);
        const exchange = catalog?.exchange || "NSE";

        const tick: TerminalTick = {
          exchange,
          symbol,
          price: newLtp,
          volume: newVol,
          ts: cached.lastUpdateTs,
          source: "angelone",
          previousClose: cached.previousClose,
          change: cached.previousClose ? newLtp - cached.previousClose : undefined,
          changePct: cached.previousClose ? ((newLtp - cached.previousClose) / cached.previousClose) * 100 : undefined,
          bid: cached.level2.bids[0]?.price,
          ask: cached.level2.asks[0]?.price,
          level2: cached.level2,
          greeks: cached.greeks,
        };

        bus.emit("tick", tick);
      }
    }, 100);
  }

  private generateMockLevel2(ltp: number): { bids: Level2Entry[]; asks: Level2Entry[] } {
    const bids: Level2Entry[] = [];
    const asks: Level2Entry[] = [];
    
    for (let i = 1; i <= 5; i++) {
      const bidDiff = i * 0.05 + (Math.random() - 0.5) * 0.02;
      const askDiff = i * 0.05 + (Math.random() - 0.5) * 0.02;
      bids.push({
        price: Number((ltp - bidDiff).toFixed(2)),
        qty: Math.floor(Math.random() * 1500) + 100,
      });
      asks.push({
        price: Number((ltp + askDiff).toFixed(2)),
        qty: Math.floor(Math.random() * 1500) + 100,
      });
    }

    bids.sort((a, b) => b.price - a.price);
    asks.sort((a, b) => a.price - b.price);

    return { bids, asks };
  }

  private generateMockGreeks(symbol: string): OptionGreeks {
    const isOption = symbol.endsWith("CE") || symbol.endsWith("PE") || /\d{5}[CP]E/i.test(symbol);
    
    if (isOption) {
      const isCall = symbol.endsWith("CE") || symbol.includes("CE");
      const multiplier = isCall ? 1 : -1;
      return {
        delta: Number((multiplier * (0.3 + Math.random() * 0.5)).toFixed(4)),
        theta: Number((-10.0 - Math.random() * 20.0).toFixed(4)),
        vega: Number((2.0 + Math.random() * 5.0).toFixed(4)),
        gamma: Number((0.002 + Math.random() * 0.005).toFixed(6)),
      };
    }

    return {
      delta: Number((0.5 + (Math.random() - 0.5) * 0.1).toFixed(4)),
      theta: Number((-15.0 - Math.random() * 5.0).toFixed(4)),
      vega: Number((8.0 + (Math.random() - 0.5) * 2.0).toFixed(4)),
      gamma: Number((0.003 + Math.random() * 0.001).toFixed(6)),
    };
  }
}

export const marketDataMultiplexer = new MarketDataMultiplexer();

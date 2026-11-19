/**
 * Deterministic synthetic daily bars for the interview demo.
 *
 * Prices follow geometric Brownian motion whose drift and volatility switch between three
 * regimes (a Markov chain: bull, calm, bear). Each session splits its log return into an
 * overnight gap and an intraday body, extends the high/low beyond the body, and rounds to the
 * NSE 0.05 tick in integer ticks so OHLC ordering survives rounding. Volume is log-normal,
 * scaled by regime and by the size of the move.
 *
 * Output depends only on (seed, symbol spec, trading days): no clock, no Math.random.
 */

import type { Candle } from "@shared/types";
import { sessionOpen } from "./calendar";
import { DEMO_DATA_SOURCE } from "./universe";

export type DemoRegime = "bull" | "calm" | "bear";

/** Annualised drift and volatility of each regime; volume scales typical turnover. */
export const DEMO_REGIMES: Record<DemoRegime, { drift: number; volatility: number; volumeFactor: number }> = {
  bull: { drift: 0.22, volatility: 0.18, volumeFactor: 1.1 },
  calm: { drift: 0.06, volatility: 0.12, volumeFactor: 0.8 },
  bear: { drift: -0.3, volatility: 0.34, volumeFactor: 1.6 },
};
const REGIME_NAMES = Object.keys(DEMO_REGIMES) as DemoRegime[];
/** Chance of keeping the regime each session: regimes last ~50 sessions on average. */
const REGIME_STAY_PROBABILITY = 0.98;
const TRADING_DAYS_PER_YEAR = 252;
const DT = 1 / TRADING_DAYS_PER_YEAR;
/** Share of a session's return variance realised overnight (the open gap). */
const GAP_VARIANCE_SHARE = 0.09;
/** Volume noise: log-normal with this log standard deviation and mean 1. */
const VOLUME_LOG_SD = 0.35;
/** NSE equity tick size. */
const TICK = 0.05;

export interface DemoSeriesSpec {
  symbol: string;
  startPrice: number;
  /** Multiplies every regime's volatility (above 1 for a high-beta name). */
  volatilityScale: number;
  /** Typical shares traded per session. */
  baseVolume: number;
}

export interface DemoSeries {
  candles: Candle[];
  /** Regime each bar was drawn under, parallel to `candles`. */
  regimes: DemoRegime[];
}

/** 32-bit FNV-1a, to derive an independent stream per symbol from one seed. */
function hash32(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32: small, fast, deterministic uniform [0, 1) generator. */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function standardNormal(rng: () => number): number {
  const u1 = 1 - rng(); // (0, 1]: log stays finite
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

const toTicks = (price: number) => Math.max(1, Math.round(price / TICK));
/** Exact two-decimal price for an integer tick count. */
const fromTicks = (ticks: number) => Math.round(ticks * 5) / 100;

/** Daily bars for `spec` on the given trading days (YYYY-MM-DD, ascending). */
export function generateDemoSeries(spec: DemoSeriesSpec, seed: number, days: readonly string[]): DemoSeries {
  const rng = createRng(hash32(`${seed}:${spec.symbol}`));
  const candles: Candle[] = [];
  const regimes: DemoRegime[] = [];
  let regime: DemoRegime = "calm";
  let previousClose = fromTicks(toTicks(spec.startPrice));

  for (const day of days) {
    // A fixed number of draws per bar keeps every bar a pure function of the seed and its index.
    const zGap = standardNormal(rng);
    const zBody = standardNormal(rng);
    const zHigh = standardNormal(rng);
    const zLow = standardNormal(rng);
    const zVolume = standardNormal(rng);
    const switchDraw = rng();
    const nextRegimeDraw = rng();

    const { drift, volatility, volumeFactor } = DEMO_REGIMES[regime];
    const sigma = volatility * spec.volatilityScale;
    const sessionSd = sigma * Math.sqrt(DT);
    const gap = Math.sqrt(GAP_VARIANCE_SHARE) * sessionSd * zGap;
    const body = (drift - (sigma * sigma) / 2) * DT + Math.sqrt(1 - GAP_VARIANCE_SHARE) * sessionSd * zBody;

    const rawOpen = previousClose * Math.exp(gap);
    const rawClose = rawOpen * Math.exp(body);
    const openTicks = toTicks(rawOpen);
    const closeTicks = toTicks(rawClose);
    const highTicks = Math.max(openTicks, closeTicks, Math.ceil((Math.max(rawOpen, rawClose) * Math.exp(0.5 * sessionSd * Math.abs(zHigh))) / TICK));
    const lowTicks = Math.max(1, Math.min(openTicks, closeTicks, Math.floor((Math.min(rawOpen, rawClose) * Math.exp(-0.5 * sessionSd * Math.abs(zLow))) / TICK)));

    const moveInSds = Math.abs(gap + body) / sessionSd;
    const volumeNoise = Math.exp(VOLUME_LOG_SD * zVolume - (VOLUME_LOG_SD * VOLUME_LOG_SD) / 2);
    const volume = Math.max(1, Math.round(spec.baseVolume * volumeFactor * volumeNoise * (1 + 0.5 * moveInSds)));

    candles.push({
      symbol: spec.symbol,
      tf: "1d",
      ts: sessionOpen(day).toISOString(),
      open: fromTicks(openTicks),
      high: fromTicks(highTicks),
      low: fromTicks(lowTicks),
      close: fromTicks(closeTicks),
      volume,
      source: DEMO_DATA_SOURCE,
    });
    regimes.push(regime);

    previousClose = fromTicks(closeTicks);
    if (switchDraw >= REGIME_STAY_PROBABILITY) {
      const others = REGIME_NAMES.filter((name) => name !== regime);
      regime = others[Math.min(others.length - 1, Math.floor(nextRegimeDraw * others.length))];
    }
  }

  return { candles, regimes };
}

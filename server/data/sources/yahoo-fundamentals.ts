/**
 * Yahoo Finance fundamentals source.
 *
 * Yahoo's quoteSummary API requires a cookie-based crumb token (obtained by
 * visiting yahoo.com in a browser) and is therefore NOT reliably callable from
 * a server-side backend. This module tries Yahoo first but falls back to the
 * NSE HTML scraper when Yahoo fails.
 *
 * Status: ⚠️ PARTIAL — Yahoo returns "Invalid Crumb" / 403 from server IPs.
 *         NSE HTML source remains the primary working source.
 */

import type { Fundamentals } from "./nse";
import { getFundamentals as getNseFundamentals } from "./nse";
import { getLogger } from "../../infra/logger";
import { getCachedJson, setCachedJson } from "../../data/redis/client";
import { RedisKeys } from "../../data/redis/keys";

const log = getLogger().child({ source: "yahoo-fundamentals" });
const CACHE_TTL = 24 * 60 * 60; // 24 hours

export async function getYahooFundamentals(symbol: string): Promise<Fundamentals | null> {
  const cacheKey = RedisKeys.fundamentals(symbol);
  const cached = await getCachedJson<Fundamentals>(cacheKey);
  if (cached) return cached;

  try {
    // Try Yahoo Finance quoteSummary (requires crumb auth — will likely fail from server IPs)
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}.NS?modules=summaryDetail,defaultKeyStatistics,financialData`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (stock-market-backend)",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      log.warn({ symbol, status: res.status }, "yahoo fundamentals request failed, falling back to NSE");
      return fallbackToNse(symbol, cacheKey);
    }

    const data = await res.json() as {
      quoteSummary?: { result?: Array<Record<string, unknown>>; error?: { code: string } };
    };
    const result = data.quoteSummary?.result?.[0];
    if (!result || data.quoteSummary?.error) {
      log.warn({ symbol }, "yahoo fundamentals returned empty result, falling back to NSE");
      return fallbackToNse(symbol, cacheKey);
    }

    const summary = (result.summaryDetail ?? {}) as Record<string, unknown>;
    const stats = (result.defaultKeyStatistics ?? {}) as Record<string, unknown>;
    const fin = (result.financialData ?? {}) as Record<string, unknown>;

    const rawVal = (obj: unknown, key: string) => {
      const v = (obj as Record<string, unknown>)[key];
      if (v && typeof v === "object" && "raw" in (v as object)) {
        return Number((v as { raw?: unknown }).raw);
      }
      return v !== undefined && v !== null ? Number(v) : undefined;
    };

    const out: Fundamentals = {
      symbol,
      asOf: new Date().toISOString(),
      pe: rawVal(stats, "trailingPE"),
      pb: rawVal(stats, "priceToBook"),
      roe: rawVal(fin, "returnOnEquity"),
      marketCap: rawVal(summary, "marketCap"),
      dividendYield: rawVal(summary, "dividendYield"),
      sector: undefined,
      industry: undefined,
      raw: result as Record<string, string>,
    };

    await setCachedJson(cacheKey, out, CACHE_TTL);
    return out;
  } catch (e) {
    log.warn({ symbol, err: String(e) }, "yahoo fundamentals error, falling back to NSE");
    return fallbackToNse(symbol, cacheKey);
  }
}

async function fallbackToNse(symbol: string, cacheKey: string): Promise<Fundamentals | null> {
  try {
    const nseData = await getNseFundamentals(symbol);
    await setCachedJson(cacheKey, nseData, CACHE_TTL);
    return nseData;
  } catch (e) {
    log.warn({ symbol, err: String(e) }, "NSE fundamentals fallback also failed");
    return null;
  }
}

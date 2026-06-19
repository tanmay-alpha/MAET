import { AppError, UpstreamDegradedError, UpstreamPermanentError } from "@shared/types/errors";
import { getLogger } from "../../infra/logger";

export { UpstreamDegradedError, UpstreamPermanentError };

const log = getLogger().child({ source: "nse" });

const NSE_BASE = "https://www.nseindia.com";

export type Fundamentals = {
  symbol: string;
  asOf: string;
  pe?: number;
  pb?: number;
  roe?: number;
  marketCap?: number;
  dividendYield?: number;
  sector?: string;
  industry?: string;
  raw: Record<string, string>;
};

export type CorporateAction = {
  symbol: string;
  exDate: string;
  action: "SPLIT" | "BONUS" | "DIVIDEND" | "DEMERGER";
  ratio?: number;
  amount?: number;
};

const CAPTCHA_RE = /captcha/i;

async function withRetryTransient<T>(fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (e instanceof UpstreamPermanentError) throw e;
      await new Promise((r) => setTimeout(r, 200 * Math.pow(2, i)));
    }
  }
  throw last;
}

async function nseFetch(url: string): Promise<Response> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 stock-market-backend",
      Accept: "text/html,application/json",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (res.status === 429 || res.status >= 500) throw new UpstreamDegradedError(`nse ${res.status}`);
  if (!res.ok) throw new UpstreamPermanentError(`nse ${res.status}`);
  const text = await res.text();
  if (CAPTCHA_RE.test(text)) throw new UpstreamDegradedError("nse captcha");
  // Re-wrap as Response so callers can .json()/.text() as needed
  return new Response(text, { status: 200, headers: { "content-type": res.headers.get("content-type") ?? "text/html" } });
}

function readField(html: string, id: string): string | undefined {
  const re = new RegExp(`id=["']${id}["'][^>]*>([^<]+)<`, "i");
  const m = re.exec(html);
  return m?.[1]?.trim();
}

export async function getFundamentals(symbol: string): Promise<Fundamentals> {
  return withRetryTransient(async () => {
    const res = await nseFetch(`${NSE_BASE}/get-quote/equity?symbol=${encodeURIComponent(symbol)}`);
    const html = await res.text();
    const raw: Record<string, string> = {};
    const pe = readField(html, "pe");
    const pb = readField(html, "pb");
    const roe = readField(html, "roe");
    const mcap = readField(html, "mcap");
    const div = readField(html, "div_yield");
    const sector = readField(html, "sector");
    if (pe) raw.pe = pe;
    if (pb) raw.pb = pb;
    if (roe) raw.roe = roe;
    if (mcap) raw.mcap = mcap;
    if (div) raw.div_yield = div;
    if (sector) raw.sector = sector;
    if (!pe && !sector) throw new UpstreamPermanentError("nse: structure changed");
    return {
      symbol,
      asOf: new Date().toISOString(),
      pe: pe ? Number(pe) : undefined,
      pb: pb ? Number(pb) : undefined,
      roe: roe ? Number(roe) : undefined,
      marketCap: mcap ? Number(mcap) : undefined,
      dividendYield: div ? Number(div) : undefined,
      sector: sector,
      raw,
    } satisfies Fundamentals;
  });
}

export async function getCorporateActions(symbol: string): Promise<CorporateAction[]> {
  return withRetryTransient(async () => {
    const res = await nseFetch(`${NSE_BASE}/api/corporates-corporateActions?symbol=${encodeURIComponent(symbol)}`);
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const data = (await res.json()) as Array<Record<string, unknown>>;
      return data.map((row) => ({
        symbol,
        exDate: String(row.exDate ?? ""),
        action: String(row.action ?? "DIVIDEND") as CorporateAction["action"],
        ratio: row.ratio ? Number(row.ratio) : undefined,
        amount: row.amount ? Number(row.amount) : undefined,
      }));
    }
    return [];
  });
}
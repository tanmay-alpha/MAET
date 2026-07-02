import type { Quote } from "@shared/types";
import { registerMarketSymbols } from "../../domain/market/symbol";

const NSE_EQUITY_LIST_URL = "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv";
const ANGEL_ONE_INSTRUMENTS_URL =
  "https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json";
const COMPANY_MASTER_FALLBACK_URL =
  process.env.COMPANY_MASTER_FALLBACK_URL ?? "https://maet-pi.vercel.app/api/market/companies";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export type CompanyMasterEntry = {
  symbol: string;
  name: string;
  exchange: "NSE";
  series: "EQ";
  isin: string;
  listingDate?: string;
  paidUpValue?: number;
  marketLot?: number;
  faceValue?: number;
  source: "nse";
};

type AngelInstrument = {
  token?: string;
  symbol?: string;
  name?: string;
  exch_seg?: string;
};

let companyCache: { entries: CompanyMasterEntry[]; fetchedAt: number } | undefined;
let tokenHydration: Promise<number> | undefined;

type CompanyPage = {
  pageCount: number;
  universeTotal: number;
  items: CompanyMasterEntry[];
};

function parseCsvRow(line: string): string[] {
  const cells: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      cells.push(value.trim());
      value = "";
    } else {
      value += character;
    }
  }
  cells.push(value.trim());
  return cells;
}

function toNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toIsoDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = /^(\d{2})-([A-Z]{3})-(\d{4})$/u.exec(value.toUpperCase());
  if (!match) return undefined;
  const month = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"].indexOf(match[2]);
  if (month < 0) return undefined;
  return `${match[3]}-${String(month + 1).padStart(2, "0")}-${match[1]}`;
}

export function parseNseCompanyCsv(csv: string): CompanyMasterEntry[] {
  const lines = csv.replace(/^\uFEFF/u, "").split(/\r?\n/u).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = parseCsvRow(lines[0]).map((header) => header.toUpperCase());
  const column = (name: string) => headers.indexOf(name);
  const symbolColumn = column("SYMBOL");
  const nameColumn = column("NAME OF COMPANY");
  const seriesColumn = column("SERIES");
  const listingColumn = column("DATE OF LISTING");
  const paidUpColumn = column("PAID UP VALUE");
  const marketLotColumn = column("MARKET LOT");
  const isinColumn = column("ISIN NUMBER");
  const faceValueColumn = column("FACE VALUE");
  if (symbolColumn < 0 || nameColumn < 0 || seriesColumn < 0) {
    throw new Error("NSE company master CSV is missing required columns");
  }

  const entries = lines.slice(1).flatMap((line): CompanyMasterEntry[] => {
    const row = parseCsvRow(line);
    const symbol = row[symbolColumn]?.trim().toUpperCase();
    if (row[seriesColumn]?.trim().toUpperCase() !== "EQ" || !symbol || !/^[A-Z0-9&.-]+$/u.test(symbol)) return [];
    return [{
      symbol,
      name: row[nameColumn]?.trim() || symbol,
      exchange: "NSE",
      series: "EQ",
      isin: row[isinColumn]?.trim() ?? "",
      listingDate: toIsoDate(row[listingColumn]),
      paidUpValue: toNumber(row[paidUpColumn]),
      marketLot: toNumber(row[marketLotColumn]),
      faceValue: toNumber(row[faceValueColumn]),
      source: "nse",
    }];
  });
  return [...new Map(entries.map((entry) => [entry.symbol, entry])).values()]
    .sort((left, right) => left.symbol.localeCompare(right.symbol));
}

export async function getNseCompanyMaster(force = false): Promise<CompanyMasterEntry[]> {
  if (!force && companyCache && Date.now() - companyCache.fetchedAt < CACHE_TTL_MS) return companyCache.entries;
  try {
    const response = await fetch(NSE_EQUITY_LIST_URL, {
      headers: { "user-agent": "MAET market scanner/1.0", accept: "text/csv" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`NSE company master returned HTTP ${response.status}`);
    const entries = parseNseCompanyCsv(await response.text());
    if (entries.length < 1_000) throw new Error(`NSE company master returned only ${entries.length} EQ companies`);
    companyCache = { entries, fetchedAt: Date.now() };
    return entries;
  } catch (error) {
    if (companyCache) return companyCache.entries;
    if (!process.env.VERCEL) {
      try {
        const entries = await getCompanyMasterFromEdgeFallback();
        companyCache = { entries, fetchedAt: Date.now() };
        return entries;
      } catch {
        // Preserve the original NSE error because it identifies the root cause.
      }
    }
    throw error;
  }
}

async function getCompanyMasterFromEdgeFallback(): Promise<CompanyMasterEntry[]> {
  const loadPage = async (page: number): Promise<CompanyPage> => {
    const url = new URL(COMPANY_MASTER_FALLBACK_URL);
    url.searchParams.set("page", String(page));
    url.searchParams.set("limit", "100");
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`Company master edge fallback returned HTTP ${response.status}`);
    return response.json() as Promise<CompanyPage>;
  };
  const first = await loadPage(1);
  if (first.universeTotal < 1_000 || first.pageCount < 10) throw new Error("Company master edge fallback is incomplete");
  const remaining = await Promise.all(
    Array.from({ length: first.pageCount - 1 }, (_, index) => loadPage(index + 2))
  );
  const entries = [first, ...remaining].flatMap((page) => page.items);
  if (entries.length < 1_000) throw new Error(`Company master edge fallback returned only ${entries.length} companies`);
  return [...new Map(entries.map((entry) => [entry.symbol, entry])).values()]
    .sort((left, right) => left.symbol.localeCompare(right.symbol));
}

export function searchNseCompanyMaster(companies: CompanyMasterEntry[], search: string): CompanyMasterEntry[] {
  const normalized = search.trim().toLocaleLowerCase("en-IN");
  if (!normalized) return companies;
  return companies
    .filter((company) =>
      company.symbol.toLocaleLowerCase("en-IN").includes(normalized) ||
      company.name.toLocaleLowerCase("en-IN").includes(normalized) ||
      company.isin.toLocaleLowerCase("en-IN").includes(normalized)
    )
    .sort((left, right) => {
      const leftSymbol = left.symbol.toLocaleLowerCase("en-IN");
      const rightSymbol = right.symbol.toLocaleLowerCase("en-IN");
      const score = (symbol: string) => symbol === normalized ? 0 : symbol.startsWith(normalized) ? 1 : 2;
      return score(leftSymbol) - score(rightSymbol) || left.symbol.localeCompare(right.symbol);
    });
}

export function hydrateAngelOneCompanyTokens(): Promise<number> {
  if (tokenHydration) return tokenHydration;
  tokenHydration = (async () => {
    const [companies, response] = await Promise.all([
      getNseCompanyMaster().catch(() => []),
      fetch(ANGEL_ONE_INSTRUMENTS_URL, {
        headers: { "user-agent": "MAET market scanner/1.0", accept: "application/json" },
        signal: AbortSignal.timeout(45_000),
      }),
    ]);
    if (!response.ok) throw new Error(`Angel One instrument master returned HTTP ${response.status}`);
    const instruments = await response.json() as AngelInstrument[];
    const companyBySymbol = new Map(companies.map((company) => [company.symbol, company]));
    const quotes: Quote[] = instruments.flatMap((instrument) => {
      if (instrument.exch_seg !== "NSE" || !instrument.symbol?.endsWith("-EQ") || !instrument.token) return [];
      const symbol = instrument.symbol.slice(0, -3).toUpperCase();
      const company = companyBySymbol.get(symbol);
      return [{
        exchange: "NSE",
        symbol,
        name: company?.name ?? instrument.name ?? symbol,
        token: instrument.token,
        yahooTicker: `${symbol}.NS`,
        isActive: true,
      }];
    });
    registerMarketSymbols(quotes);
    return quotes.length;
  })().catch((error) => {
    tokenHydration = undefined;
    throw error;
  });
  return tokenHydration;
}

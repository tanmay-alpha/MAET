import type { Quote } from "@shared/types";
import { registerMarketSymbols } from "../../domain/market/symbol";

const NSE_EQUITY_LIST_URL = "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv";
const ANGEL_ONE_INSTRUMENTS_URL =
  "https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json";
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
    throw error;
  }
}

export function searchNseCompanyMaster(companies: CompanyMasterEntry[], search: string): CompanyMasterEntry[] {
  const normalized = search.trim().toLocaleLowerCase("en-IN");
  if (!normalized) return companies;
  return companies
    .filter((company) =>
      company.symbol.toLocaleLowerCase("en-IN").includes(normalized) ||
      company.name.toLocaleLowerCase("en-IN").includes(normalized)
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
      getNseCompanyMaster(),
      fetch(ANGEL_ONE_INSTRUMENTS_URL, {
        headers: { "user-agent": "MAET market scanner/1.0", accept: "application/json" },
        signal: AbortSignal.timeout(45_000),
      }),
    ]);
    if (!response.ok) throw new Error(`Angel One instrument master returned HTTP ${response.status}`);
    const instruments = await response.json() as AngelInstrument[];
    const tokenBySymbol = new Map<string, string>();
    for (const instrument of instruments) {
      if (instrument.exch_seg !== "NSE" || !instrument.symbol?.endsWith("-EQ") || !instrument.token) continue;
      tokenBySymbol.set(instrument.symbol.slice(0, -3).toUpperCase(), instrument.token);
    }
    const quotes: Quote[] = companies.flatMap((company) => {
      const token = tokenBySymbol.get(company.symbol);
      if (!token) return [];
      return [{
        exchange: "NSE",
        symbol: company.symbol,
        name: company.name,
        token,
        yahooTicker: `${company.symbol}.NS`,
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

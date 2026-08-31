import { createHmac } from "node:crypto";

export type AngelOneCreds = {
  apiKey: string;
  clientCode: string;
  password: string;
  totpSecret: string;
};

export type AngelOneSession = {
  jwt: string;
  feedToken: string;
  refreshToken: string;
  clientCode: string;
  apiKey: string;
  obtainedAt: string;
};

export type AngelOneQuoteRequest = { symbol: string; token: string };

export type AngelOneMarketQuote = {
  symbol: string;
  price: number;
  volume: number;
  ts: string;
  previousClose?: number;
  change?: number;
  changePct?: number;
};

export type AngelOneFullMarketQuoteExchange = "NSE" | "NFO";

export type AngelOneFullMarketQuoteRequest = {
  exchange: AngelOneFullMarketQuoteExchange;
  token: string;
  tradingSymbol: string;
};

export type AngelOneFullMarketQuote = {
  exchange: AngelOneFullMarketQuoteExchange;
  token: string;
  tradingSymbol: string;
  ltp?: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  openInterest?: number;
  netChange?: number;
  percentChange?: number;
  averagePrice?: number;
  totalBuyQuantity?: number;
  totalSellQuantity?: number;
  bestBidPrice?: number;
  bestBidQuantity?: number;
  bestAskPrice?: number;
  bestAskQuantity?: number;
  exchangeFeedAt: string;
  exchangeTradeAt?: string;
};

export type AngelOneOptionGreekRequest = {
  name: string;
  expirydate: string;
};

export type AngelOneOptionGreek = {
  name: string;
  expiry: string;
  strikePrice: number;
  optionType: "CE" | "PE";
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  impliedVolatility?: number;
  tradeVolume?: number;
};

export type AngelOneOptionContractRequest = {
  name: string;
  expiry: string;
};

export type AngelOneOptionContract = {
  token: string;
  tradingSymbol: string;
  name: string;
  expiry: string;
  strikePrice: number;
  optionType: "CE" | "PE";
  lotSize: number;
  instrumentType: "OPTIDX" | "OPTSTK";
};

const LOGIN_URL =
  "https://apiconnect.angelone.in/rest/auth/angelbroking/user/v1/loginByPassword";
const MARKET_QUOTE_URL =
  "https://apiconnect.angelone.in/rest/secure/angelbroking/market/v1/quote/";
const OPTION_GREEK_URL =
  "https://apiconnect.angelone.in/rest/secure/angelbroking/marketData/v1/optionGreek";
const INSTRUMENT_MASTER_URL =
  "https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json";

let activeMarketSession: AngelOneSession | undefined;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MONTH_INDEX: Record<string, number> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

export function parseAngelOneExchangeTime(
  value: unknown
): string | undefined {
  if (typeof value !== "string") return undefined;
  const match =
    /^(\d{2})-([A-Z][a-z]{2})-(\d{4}) (\d{2}):(\d{2}):(\d{2})$/u.exec(
      value
    );
  if (!match) return undefined;

  const month = MONTH_INDEX[match[2]];
  const day = Number(match[1]);
  const year = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (
    month === undefined ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return undefined;
  }

  const localComponentsAsUtc = Date.UTC(
    year,
    month,
    day,
    hour,
    minute,
    second
  );
  const validationDate = new Date(localComponentsAsUtc);
  if (
    validationDate.getUTCFullYear() !== year ||
    validationDate.getUTCMonth() !== month ||
    validationDate.getUTCDate() !== day ||
    validationDate.getUTCHours() !== hour ||
    validationDate.getUTCMinutes() !== minute ||
    validationDate.getUTCSeconds() !== second
  ) {
    return undefined;
  }

  return new Date(
    localComponentsAsUtc - IST_OFFSET_MS
  ).toISOString();
}

function decodeBase32(value: string): Buffer {
  const normalized = value.toUpperCase().replace(/=+$/u, "").replace(/\s+/gu, "");
  let bits = "";
  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new Error("Angel One TOTP secret is not valid base32");
    bits += index.toString(2).padStart(5, "0");
  }

  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  if (bytes.length === 0) throw new Error("Angel One TOTP secret is empty");
  return Buffer.from(bytes);
}

export function generateTotp(secret: string, nowMs = Date.now()): string {
  const counter = Math.floor(nowMs / 30_000);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = (
    ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff)
  ) % 1_000_000;
  return code.toString().padStart(6, "0");
}

export async function login(creds: AngelOneCreds): Promise<AngelOneSession> {
  const totp = generateTotp(creds.totpSecret);
  const body = {
    clientcode: creds.clientCode,
    password: creds.password,
    totp,
  };
  const res = await fetch(LOGIN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-UserType": "USER",
      "X-SourceID": "WEB",
      "X-ClientLocalIP": "127.0.0.1",
      "X-ClientPublicIP": "127.0.0.1",
      "X-MACAddress": "00:00:00:00:00:00",
      "X-PrivateKey": creds.apiKey,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`angelone login failed: ${res.status}`);
  }
  const data = (await res.json()) as {
    status: boolean;
    data?: { jwtToken: string; feedToken: string; refreshToken: string };
  };
  if (!data.status || !data.data) {
    throw new Error("angelone login: bad response");
  }
  return {
    jwt: data.data.jwtToken,
    feedToken: data.data.feedToken,
    refreshToken: data.data.refreshToken,
    clientCode: creds.clientCode,
    apiKey: creds.apiKey,
    obtainedAt: new Date().toISOString(),
  };
}

export function setAngelOneMarketSession(session: AngelOneSession | undefined): void {
  activeMarketSession = session;
}

export function hasAngelOneMarketSession(): boolean {
  return activeMarketSession !== undefined;
}

function parseFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  const parsed = typeof value === "string" && value.trim() === "" ? NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseNonNegativeNumber(value: unknown): number | undefined {
  const parsed = parseFiniteNumber(value);
  return parsed !== undefined && parsed >= 0 ? parsed : undefined;
}

function parseNonNegativeSafeInteger(value: unknown): number | undefined {
  const parsed = parseFiniteNumber(value);
  return parsed !== undefined && parsed >= 0 && Number.isSafeInteger(parsed)
    ? parsed
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function getAngelOneOptionGreeks(request: AngelOneOptionGreekRequest): Promise<AngelOneOptionGreek[]> {
  const session = activeMarketSession;
  if (!session) return [];
  const response = await fetch(OPTION_GREEK_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.jwt}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-UserType": "USER",
      "X-SourceID": "WEB",
      "X-ClientLocalIP": "127.0.0.1",
      "X-ClientPublicIP": "127.0.0.1",
      "X-MACAddress": "00:00:00:00:00:00",
      "X-PrivateKey": session.apiKey,
    },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`angelone option greek failed: ${response.status}`);
  const payload = await response.json() as {
    status?: boolean;
    message?: string;
    data?: Array<{
      name?: unknown;
      expiry?: unknown;
      strikePrice?: unknown;
      optionType?: unknown;
      delta?: unknown;
      gamma?: unknown;
      theta?: unknown;
      vega?: unknown;
      impliedVolatility?: unknown;
      tradeVolume?: unknown;
    }>;
  };
  if (!payload.status) {
    if (payload.message?.trim().toLowerCase() === "no data available") return [];
    throw new Error("angelone option greek returned an unsuccessful response");
  }

  return (payload.data ?? []).flatMap((providerGreek) => {
    const name = typeof providerGreek.name === "string" && providerGreek.name.trim();
    const expiry = typeof providerGreek.expiry === "string" && providerGreek.expiry.trim();
    const strikePrice = parseFiniteNumber(providerGreek.strikePrice);
    const optionType = providerGreek.optionType === "CE" || providerGreek.optionType === "PE"
      ? providerGreek.optionType
      : undefined;
    if (!name || !expiry || !strikePrice || strikePrice <= 0 || !optionType) return [];
    return [{
      name,
      expiry,
      strikePrice,
      optionType,
      delta: parseFiniteNumber(providerGreek.delta),
      gamma: parseFiniteNumber(providerGreek.gamma),
      theta: parseFiniteNumber(providerGreek.theta),
      vega: parseFiniteNumber(providerGreek.vega),
      impliedVolatility: parseNonNegativeNumber(providerGreek.impliedVolatility),
      tradeVolume: parseNonNegativeSafeInteger(providerGreek.tradeVolume),
    }];
  });
}

export async function resolveAngelOneOptionContracts(
  request: AngelOneOptionContractRequest,
): Promise<AngelOneOptionContract[]> {
  const response = await fetch(INSTRUMENT_MASTER_URL, {
    method: "GET",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`angelone instrument master failed: ${response.status}`);
  const instrumentMaster = await response.json() as unknown;
  if (!Array.isArray(instrumentMaster)) {
    throw new Error("angelone instrument master returned a non-array response");
  }

  const requestedName = request.name.trim().toUpperCase();
  const requestedExpiry = request.expiry.trim().toUpperCase();
  const contracts = instrumentMaster.flatMap((instrument) => {
    if (!instrument || typeof instrument !== "object") return [];
    const providerRow = instrument as Record<string, unknown>;
    if (
      providerRow.exch_seg !== "NFO" ||
      (providerRow.instrumenttype !== "OPTIDX" && providerRow.instrumenttype !== "OPTSTK") ||
      typeof providerRow.name !== "string" ||
      providerRow.name.trim().toUpperCase() !== requestedName ||
      typeof providerRow.expiry !== "string" ||
      providerRow.expiry.trim().toUpperCase() !== requestedExpiry ||
      typeof providerRow.token !== "string" ||
      providerRow.token.trim() === "" ||
      typeof providerRow.symbol !== "string" ||
      providerRow.symbol.trim() === ""
    ) return [];

    const rawStrike = parseFiniteNumber(providerRow.strike);
    const strikePrice = rawStrike === undefined ? undefined : rawStrike / 100;
    const lotSize = parseFiniteNumber(providerRow.lotsize);
    const optionTypeMatch = /(?:CE|PE)$/u.exec(providerRow.symbol.trim());
    const optionType = optionTypeMatch?.[0] as "CE" | "PE" | undefined;
    const instrumentType = providerRow.instrumenttype as "OPTIDX" | "OPTSTK";
    if (
      strikePrice === undefined ||
      !Number.isFinite(strikePrice) ||
      strikePrice <= 0 ||
      lotSize === undefined ||
      !Number.isInteger(lotSize) ||
      lotSize <= 0 ||
      !optionType
    ) return [];

    return [{
      token: providerRow.token.trim(),
      tradingSymbol: providerRow.symbol.trim(),
      name: requestedName,
      expiry: requestedExpiry,
      strikePrice,
      optionType,
      lotSize,
      instrumentType,
    }];
  });

  return contracts.sort((left, right) => {
    const strikeDifference = left.strikePrice - right.strikePrice;
    if (strikeDifference !== 0) return strikeDifference;
    if (left.optionType !== right.optionType) return left.optionType === "CE" ? -1 : 1;
    const symbolDifference = left.tradingSymbol.localeCompare(right.tradingSymbol);
    return symbolDifference !== 0 ? symbolDifference : left.token.localeCompare(right.token);
  });
}

function normalizeFullMarketQuoteRequests(
  requests: AngelOneFullMarketQuoteRequest[],
): AngelOneFullMarketQuoteRequest[] {
  const requestsByIdentity = new Map<string, AngelOneFullMarketQuoteRequest>();

  for (const request of requests) {
    if (request.exchange !== "NSE" && request.exchange !== "NFO") {
      throw new Error("angelone full market quote exchange must be NSE or NFO");
    }
    const token = typeof request.token === "string" ? request.token.trim() : "";
    if (!token) throw new Error("angelone full market quote token must not be empty");
    const tradingSymbol = typeof request.tradingSymbol === "string"
      ? request.tradingSymbol.trim()
      : "";
    if (!tradingSymbol) {
      throw new Error("angelone full market quote trading symbol must not be empty");
    }

    const identity = `${request.exchange}:${token}`;
    const existingRequest = requestsByIdentity.get(identity);
    if (
      existingRequest &&
      existingRequest.tradingSymbol !== tradingSymbol
    ) {
      throw new Error(`angelone full market quote has conflicting trading symbols for ${identity}`);
    }
    if (!existingRequest) {
      requestsByIdentity.set(identity, {
        exchange: request.exchange,
        token,
        tradingSymbol,
      });
    }
  }

  const uniqueRequests = [...requestsByIdentity.values()];
  if (uniqueRequests.length > 50) {
    throw new Error("angelone full market quote accepts a maximum of 50 unique instruments");
  }
  return uniqueRequests;
}

function parseFullMarketQuoteExchange(
  value: unknown,
): AngelOneFullMarketQuoteExchange | undefined {
  if (typeof value !== "string") return undefined;
  const exchange = value.trim().toUpperCase();
  return exchange === "NSE" || exchange === "NFO" ? exchange : undefined;
}

function getTopDepthLevel(
  depth: unknown,
  side: "buy" | "sell",
): Record<string, unknown> | undefined {
  if (!isRecord(depth) || !Array.isArray(depth[side])) return undefined;
  const topLevel = depth[side][0];
  return isRecord(topLevel) ? topLevel : undefined;
}

export async function getAngelOneFullMarketQuotes(
  requests: AngelOneFullMarketQuoteRequest[],
): Promise<AngelOneFullMarketQuote[]> {
  if (requests.length === 0) return [];
  const uniqueRequests = normalizeFullMarketQuoteRequests(requests);
  const session = activeMarketSession;
  if (!session) return [];

  const exchangeTokens: Partial<Record<AngelOneFullMarketQuoteExchange, string[]>> = {};
  for (const request of uniqueRequests) {
    const tokens = exchangeTokens[request.exchange] ?? [];
    tokens.push(request.token);
    exchangeTokens[request.exchange] = tokens;
  }

  const response = await fetch(MARKET_QUOTE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.jwt}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-UserType": "USER",
      "X-SourceID": "WEB",
      "X-ClientLocalIP": "127.0.0.1",
      "X-ClientPublicIP": "127.0.0.1",
      "X-MACAddress": "00:00:00:00:00:00",
      "X-PrivateKey": session.apiKey,
    },
    body: JSON.stringify({ mode: "FULL", exchangeTokens }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`angelone full market quote failed: ${response.status}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("angelone full market quote returned a malformed response");
  }
  if (!isRecord(payload)) {
    throw new Error("angelone full market quote returned a malformed response");
  }
  if (payload.status === false) {
    throw new Error("angelone full market quote returned an unsuccessful response");
  }
  if (
    payload.status !== true ||
    !isRecord(payload.data) ||
    !Array.isArray(payload.data.fetched)
  ) {
    throw new Error("angelone full market quote returned a malformed response");
  }

  const requestedByIdentity = new Map(
    uniqueRequests.map((request) => [`${request.exchange}:${request.token}`, request]),
  );
  const quotesByIdentity = new Map<string, AngelOneFullMarketQuote>();

  for (const fetchedQuote of payload.data.fetched) {
    if (!isRecord(fetchedQuote)) continue;
    const exchange = parseFullMarketQuoteExchange(fetchedQuote.exchange);
    const token = typeof fetchedQuote.symbolToken === "string"
      ? fetchedQuote.symbolToken.trim()
      : "";
    if (!exchange || !token) continue;

    const identity = `${exchange}:${token}`;
    const requestedQuote = requestedByIdentity.get(identity);
    if (!requestedQuote) continue;

    if (fetchedQuote.tradingSymbol !== undefined && fetchedQuote.tradingSymbol !== null) {
      if (typeof fetchedQuote.tradingSymbol !== "string") continue;
      const providerTradingSymbol = fetchedQuote.tradingSymbol.trim();
      if (
        providerTradingSymbol &&
        providerTradingSymbol.toUpperCase() !== requestedQuote.tradingSymbol.toUpperCase()
      ) {
        continue;
      }
    }

    const exchangeFeedAt = parseAngelOneExchangeTime(fetchedQuote.exchFeedTime);
    if (!exchangeFeedAt) continue;
    const bestBid = getTopDepthLevel(fetchedQuote.depth, "buy");
    const bestAsk = getTopDepthLevel(fetchedQuote.depth, "sell");

    quotesByIdentity.set(identity, {
      exchange: requestedQuote.exchange,
      token: requestedQuote.token,
      tradingSymbol: requestedQuote.tradingSymbol,
      ltp: parseNonNegativeNumber(fetchedQuote.ltp),
      open: parseNonNegativeNumber(fetchedQuote.open),
      high: parseNonNegativeNumber(fetchedQuote.high),
      low: parseNonNegativeNumber(fetchedQuote.low),
      close: parseNonNegativeNumber(fetchedQuote.close),
      volume: parseNonNegativeSafeInteger(fetchedQuote.tradeVolume),
      openInterest: parseNonNegativeSafeInteger(fetchedQuote.opnInterest),
      netChange: parseFiniteNumber(fetchedQuote.netChange),
      percentChange: parseFiniteNumber(fetchedQuote.percentChange),
      averagePrice: parseNonNegativeNumber(fetchedQuote.avgPrice),
      totalBuyQuantity: parseNonNegativeSafeInteger(fetchedQuote.totBuyQuan),
      totalSellQuantity: parseNonNegativeSafeInteger(fetchedQuote.totSellQuan),
      bestBidPrice: parseNonNegativeNumber(bestBid?.price),
      bestBidQuantity: parseNonNegativeSafeInteger(bestBid?.quantity),
      bestAskPrice: parseNonNegativeNumber(bestAsk?.price),
      bestAskQuantity: parseNonNegativeSafeInteger(bestAsk?.quantity),
      exchangeFeedAt,
      exchangeTradeAt: parseAngelOneExchangeTime(fetchedQuote.exchTradeTime),
    });
  }

  return uniqueRequests.flatMap((request) => {
    const quote = quotesByIdentity.get(`${request.exchange}:${request.token}`);
    return quote ? [quote] : [];
  });
}

export async function getAngelOneMarketQuotes(requests: AngelOneQuoteRequest[]): Promise<AngelOneMarketQuote[]> {
  const session = activeMarketSession;
  if (!session || requests.length === 0) return [];
  const tokenToSymbol = new Map(requests.map((request) => [request.token, request.symbol]));
  const response = await fetch(MARKET_QUOTE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.jwt}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-UserType": "USER",
      "X-SourceID": "WEB",
      "X-ClientLocalIP": "127.0.0.1",
      "X-ClientPublicIP": "127.0.0.1",
      "X-MACAddress": "00:00:00:00:00:00",
      "X-PrivateKey": session.apiKey,
    },
    body: JSON.stringify({ mode: "FULL", exchangeTokens: { NSE: requests.map((request) => request.token) } }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`angelone market quote failed: ${response.status}`);
  const payload = await response.json() as {
    status?: boolean;
    data?: { fetched?: Array<{
      symbolToken?: string;
      ltp?: number;
       tradeVolume?: number;
       close?: number;
       exchFeedTime?: string;
       netChange?: number;
      percentChange?: number;
    }> };
  };
  if (!payload.status) throw new Error("angelone market quote returned an unsuccessful response");
  return (payload.data?.fetched ?? []).flatMap((quote) => {
    const symbol = quote.symbolToken ? tokenToSymbol.get(quote.symbolToken) : undefined;
    const ts = parseAngelOneExchangeTime(quote.exchFeedTime);
    if (!symbol || !ts || !Number.isFinite(quote.ltp) || (quote.ltp ?? 0) <= 0) return [];
    return [{
      symbol,
      price: quote.ltp!,
      volume: Math.max(0, quote.tradeVolume ?? 0),
      ts,
      previousClose: quote.close && quote.close > 0 ? quote.close : undefined,
      change: Number.isFinite(quote.netChange) ? quote.netChange : undefined,
      changePct: Number.isFinite(quote.percentChange) ? quote.percentChange : undefined,
    }];
  });
}

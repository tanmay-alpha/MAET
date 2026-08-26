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

const LOGIN_URL =
  "https://apiconnect.angelone.in/rest/auth/angelbroking/user/v1/loginByPassword";
const MARKET_QUOTE_URL =
  "https://apiconnect.angelone.in/rest/secure/angelbroking/market/v1/quote/";
const OPTION_GREEK_URL =
  "https://apiconnect.angelone.in/rest/secure/angelbroking/marketData/v1/optionGreek";

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

function parseFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  const parsed = typeof value === "string" && value.trim() === "" ? NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
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
      impliedVolatility: parseFiniteNumber(providerGreek.impliedVolatility),
      tradeVolume: parseFiniteNumber(providerGreek.tradeVolume),
    }];
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

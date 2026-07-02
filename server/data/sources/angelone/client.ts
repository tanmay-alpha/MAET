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
  previousClose?: number;
  change?: number;
  changePct?: number;
};

const LOGIN_URL =
  "https://apiconnect.angelone.in/rest/auth/angelbroking/user/v1/loginByPassword";
const MARKET_QUOTE_URL =
  "https://apiconnect.angelone.in/rest/secure/angelbroking/market/v1/quote/";

let activeMarketSession: AngelOneSession | undefined;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

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
      netChange?: number;
      percentChange?: number;
    }> };
  };
  if (!payload.status) throw new Error("angelone market quote returned an unsuccessful response");
  return (payload.data?.fetched ?? []).flatMap((quote) => {
    const symbol = quote.symbolToken ? tokenToSymbol.get(quote.symbolToken) : undefined;
    if (!symbol || !Number.isFinite(quote.ltp) || (quote.ltp ?? 0) <= 0) return [];
    return [{
      symbol,
      price: quote.ltp!,
      volume: Math.max(0, quote.tradeVolume ?? 0),
      previousClose: quote.close && quote.close > 0 ? quote.close : undefined,
      change: Number.isFinite(quote.netChange) ? quote.netChange : undefined,
      changePct: Number.isFinite(quote.percentChange) ? quote.percentChange : undefined,
    }];
  });
}

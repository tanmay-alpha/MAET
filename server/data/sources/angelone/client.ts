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

const LOGIN_URL =
  "https://apiconnect.angelone.in/rest/auth/angelbroking/user/v1/loginByPassword";

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

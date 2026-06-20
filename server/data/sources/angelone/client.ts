import { authenticator } from "otplib";

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

export async function login(creds: AngelOneCreds): Promise<AngelOneSession> {
  const totp = authenticator.generate(creds.totpSecret);
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
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getConfig } from "../config";

export type EncryptedPayload = {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
};

export type BrokerCredentials = {
  apiKey: string;
  clientCode: string;
  password: string;
  totpSecret: string;
};

function getKey(): Buffer {
  const raw = getConfig().angeloneMasterKey;
  try {
    const b = Buffer.from(raw, "base64");
    if (b.length === 32) return b;
  } catch {
    // fall through
  }
  const b = Buffer.from(raw);
  if (b.length === 32) return b;
  // Config accepts high-entropy secrets of 32+ characters. Derive the exact
  // AES-256 key width so valid longer secrets do not fail at runtime.
  if (b.length >= 32) return createHash("sha256").update(b).digest();
  throw new Error("ANGELONE_MASTER_KEY must contain at least 32 bytes of key material");
}

export function encrypt(plaintext: string): EncryptedPayload {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { ciphertext, iv, authTag };
}

export function decrypt(payload: EncryptedPayload): string {
  const key = getKey();
  const decipher = createDecipheriv("aes-256-gcm", key, payload.iv);
  decipher.setAuthTag(payload.authTag);
  const pt = Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]);
  return pt.toString("utf8");
}

/**
 * Encrypt broker credentials into a single opaque string for safe storage.
 *
 * Usage:
 *   const encrypted = encryptBrokerCredentials({ apiKey, clientCode, password, totpSecret });
 *   // Store `encrypted` in the brokers.encrypted_credentials column
 *
 * Decryption:
 *   const payload = JSON.parse(encryptedStr);
 *   const plaintext = decrypt({ ciphertext: Buffer.from(payload.ciphertext, 'base64'), ... });
 */
export function encryptBrokerCredentials(credentials: BrokerCredentials): string {
  const plaintext = JSON.stringify(credentials);
  const payload = encrypt(plaintext);
  // Serialise to a portable JSON string safe for a TEXT column
  return JSON.stringify({
    v: 1,
    ciphertext: payload.ciphertext.toString("base64"),
    iv: payload.iv.toString("base64"),
    authTag: payload.authTag.toString("base64"),
  });
}

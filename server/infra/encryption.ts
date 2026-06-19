import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getConfig } from "../config";

export type EncryptedPayload = {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
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
  if (b.length !== 32) {
    throw new Error("ANGELONE_MASTER_KEY must decode to exactly 32 bytes");
  }
  return b;
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
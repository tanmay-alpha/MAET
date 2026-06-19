import { describe, it, expect } from "bun:test";
import { encrypt, decrypt } from "./encryption";

describe("encryption", () => {
  it("round-trips a plaintext", () => {
    const pt = "my-angelone-api-key";
    const enc = encrypt(pt);
    expect(enc.ciphertext.length).toBeGreaterThan(0);
    expect(decrypt(enc)).toBe(pt);
  });

  it("rejects tampered authTag", () => {
    const enc = encrypt("secret");
    const tampered = { ...enc, authTag: Buffer.from(enc.authTag.map((b) => b ^ 0xff)) };
    expect(() => decrypt(tampered)).toThrow();
  });
});

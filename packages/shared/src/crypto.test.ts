import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptJson, decryptSecret, encryptJson, encryptSecret } from "./crypto";

const key = randomBytes(32).toString("base64");

describe("credential encryption", () => {
  it("round-trips a secret", () => {
    const sealed = encryptSecret("postgres://agent:pw@host/db", key);
    expect(sealed).not.toContain("agent:pw");
    expect(decryptSecret(sealed, key)).toBe("postgres://agent:pw@host/db");
  });

  it("uses a fresh IV each time", () => {
    expect(encryptSecret("same", key)).not.toBe(encryptSecret("same", key));
  });

  it("rejects tampered ciphertext", () => {
    const parts = encryptSecret("secret", key).split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptSecret(parts.join("."), key)).toThrow();
  });

  it("rejects the wrong key", () => {
    const sealed = encryptSecret("secret", key);
    expect(() => decryptSecret(sealed, randomBytes(32).toString("base64"))).toThrow();
  });

  it("round-trips JSON", () => {
    expect(decryptJson(encryptJson({ token: "abc", scopes: ["read"] }, key), key)).toEqual({
      token: "abc",
      scopes: ["read"],
    });
  });
});

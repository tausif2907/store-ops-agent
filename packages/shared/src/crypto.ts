import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encryption for store credentials at rest.
 * Output format: "v1.<iv>.<authTag>.<ciphertext>", each part base64url.
 */

const VERSION = "v1";

function loadKey(keyBase64 = process.env.CREDENTIALS_ENCRYPTION_KEY): Buffer {
  if (!keyBase64) throw new Error("CREDENTIALS_ENCRYPTION_KEY is not set");
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) throw new Error("CREDENTIALS_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return key;
}

export function encryptSecret(plaintext: string, keyBase64?: string): string {
  const key = loadKey(keyBase64);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, ciphertext].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

export function decryptSecret(payload: string, keyBase64?: string): string {
  const [version, iv, tag, ciphertext] = payload.split(".");
  if (version !== VERSION || !iv || !tag || !ciphertext) throw new Error("Malformed encrypted secret");
  const decipher = createDecipheriv("aes-256-gcm", loadKey(keyBase64), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

export function encryptJson(value: unknown, keyBase64?: string): string {
  return encryptSecret(JSON.stringify(value), keyBase64);
}

export function decryptJson<T>(payload: string, keyBase64?: string): T {
  return JSON.parse(decryptSecret(payload, keyBase64)) as T;
}

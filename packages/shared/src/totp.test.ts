import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, hashRecoveryCode, hotp, newRecoveryCodes, newTotpSecret, totp, totpUri, verifyTotp } from "./totp";

// RFC 6238 appendix B uses the ASCII secret "12345678901234567890" and 8 digits;
// these are the same moments truncated to the 6 digits authenticator apps use.
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

describe("two-factor codes", () => {
  it("match the RFC 4226 HOTP test values", () => {
    const secret = Buffer.from("12345678901234567890");
    expect([0, 1, 2, 3, 9].map((c) => hotp(secret, c))).toEqual(["755224", "287082", "359152", "969429", "520489"]);
  });

  it("match the RFC 6238 TOTP test values (SHA-1, 6 digits)", () => {
    expect(totp(RFC_SECRET, new Date(59_000))).toBe("287082");
    expect(totp(RFC_SECRET, new Date(1111111109_000))).toBe("081804");
    expect(totp(RFC_SECRET, new Date(1234567890_000))).toBe("005924");
    expect(totp(RFC_SECRET, new Date(2000000000_000))).toBe("279037");
  });

  it("accept the current step and one either side, and nothing else", () => {
    const secret = newTotpSecret();
    const now = new Date("2026-10-22T10:00:15Z");
    expect(verifyTotp(secret, totp(secret, now), now)).toBe(true);
    expect(verifyTotp(secret, totp(secret, new Date(now.getTime() - 30_000)), now)).toBe(true);
    expect(verifyTotp(secret, totp(secret, new Date(now.getTime() + 30_000)), now)).toBe(true);
    expect(verifyTotp(secret, totp(secret, new Date(now.getTime() - 90_000)), now)).toBe(false);
    expect(verifyTotp(secret, "12345", now)).toBe(false);
    expect(verifyTotp(secret, "abcdef", now)).toBe(false);
  });

  it("round-trips base32 and builds an authenticator link", () => {
    const bytes = Buffer.from("store-ops two-factor");
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
    expect(newTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
    const uri = totpUri("JBSWY3DPEHPK3PXP", "owner@example.com");
    expect(uri).toMatch(/^otpauth:\/\/totp\/Store%20Ops%20Agent%3Aowner%40example\.com\?secret=JBSWY3DPEHPK3PXP&issuer=Store\+Ops\+Agent/);
  });

  it("makes distinct recovery codes and hashes them case-insensitively", () => {
    const codes = newRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    expect(codes[0]).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}$/);
    expect(hashRecoveryCode(codes[0]!.toUpperCase())).toBe(hashRecoveryCode(codes[0]!));
  });
});

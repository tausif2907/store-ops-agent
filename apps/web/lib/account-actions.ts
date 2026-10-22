"use server";

import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import QRCode from "qrcode";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dbForUser } from "@store-ops/db";
import { decryptSecret, encryptSecret } from "@store-ops/shared/crypto";
import { hashRecoveryCode, newRecoveryCodes, newTotpSecret, totpUri, verifyTotp } from "@store-ops/shared/totp";
import { describeRetry, rateLimit } from "@store-ops/tools";
import { PASSWORD_RULE } from "./passwords";
import { requireUser, startSession } from "./session";

export interface AccountState {
  error?: string;
  done?: string;
}

const SETUP_COOKIE = "so_totp_setup";

function secret(): Uint8Array {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET must be set to at least 32 characters");
  return new TextEncoder().encode(value);
}

async function account() {
  const user = await requireUser();
  const db = dbForUser(user.id);
  const row = await db.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { email: true, name: true, passwordHash: true, sessionVersion: true, totpSecretEncrypted: true, totpEnabledAt: true, recoveryCodes: true },
  });
  return { user, db, row };
}

/** Too many wrong passwords or codes from the account settings: same limits as sign-in. */
async function guard(userId: string): Promise<AccountState | null> {
  const limit = await rateLimit(`account:${userId}`, 10, 900);
  return limit.ok ? null : { error: `Too many attempts. Try again in ${describeRetry(limit.retryAfter)}.` };
}

export async function updateName(_prev: AccountState, form: FormData): Promise<AccountState> {
  const { user, db } = await account();
  const parsed = z.string().trim().min(1, "Enter your name").max(100).safeParse(form.get("name"));
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  await db.user.update({ where: { id: user.id }, data: { name: parsed.data } });
  revalidatePath("/", "layout");
  return { done: "Saved." };
}

const ChangePassword = z
  .object({ current: z.string().min(1, "Enter your current password"), password: PASSWORD_RULE, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: "The two new passwords don't match" });

/** Changes the password and signs out every other device; this one stays signed in. */
export async function changePassword(_prev: AccountState, form: FormData): Promise<AccountState> {
  const { user, db, row } = await account();
  const blocked = await guard(user.id);
  if (blocked) return blocked;
  const parsed = ChangePassword.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  if (!(await bcrypt.compare(parsed.data.current, row.passwordHash))) return { error: "Your current password is not right." };
  const updated = await db.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(parsed.data.password, 12), sessionVersion: { increment: 1 } },
    select: { sessionVersion: true },
  });
  await startSession({ id: user.id, name: row.name, sessionVersion: updated.sessionVersion });
  return { done: "Password changed. Other devices have been signed out." };
}

export async function logoutEverywhere(): Promise<AccountState> {
  const { user, db, row } = await account();
  const updated = await db.user.update({ where: { id: user.id }, data: { sessionVersion: { increment: 1 } }, select: { sessionVersion: true } });
  await startSession({ id: user.id, name: row.name, sessionVersion: updated.sessionVersion });
  return { done: "Every other device has been signed out." };
}

// ---- Two-factor sign-in -----------------------------------------------------------

/** Starts setup: a new secret, held in a short-lived signed cookie until a code confirms it. */
export async function beginTotpSetup(): Promise<{ secret: string; qr: string } | { error: string }> {
  const { user, row } = await account();
  if (row.totpEnabledAt) return { error: "Two-factor sign-in is already on." };
  const totpSecret = newTotpSecret();
  const token = await new SignJWT({ s: encryptSecret(totpSecret) })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setExpirationTime("15m")
    .sign(secret());
  (await cookies()).set(SETUP_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 900 });
  const qr = await QRCode.toDataURL(totpUri(totpSecret, row.email), { margin: 1, width: 200, color: { dark: "#0b0f0e", light: "#ffffff" } });
  return { secret: totpSecret, qr };
}

/** Finishes setup with a code from the app; returns the recovery codes, shown once. */
export async function confirmTotpSetup(code: string): Promise<{ recoveryCodes: string[] } | { error: string }> {
  const { user, db } = await account();
  const blocked = await guard(user.id);
  if (blocked) return { error: blocked.error! };
  const jar = await cookies();
  const raw = jar.get(SETUP_COOKIE)?.value;
  let encrypted: string | null = null;
  try {
    const { payload } = raw ? await jwtVerify(raw, secret(), { algorithms: ["HS256"] }) : { payload: null };
    if (payload?.sub === user.id && typeof payload.s === "string") encrypted = payload.s;
  } catch {
    encrypted = null;
  }
  if (!encrypted) return { error: "Setup timed out. Start again." };
  if (!verifyTotp(decryptSecret(encrypted), code)) return { error: "That code didn't match. Check the app shows Store Ops Agent and try the newest code." };

  const recoveryCodes = newRecoveryCodes();
  await db.user.update({
    where: { id: user.id },
    data: { totpSecretEncrypted: encrypted, totpEnabledAt: new Date(), recoveryCodes: recoveryCodes.map(hashRecoveryCode) },
  });
  jar.delete(SETUP_COOKIE);
  revalidatePath("/account");
  return { recoveryCodes };
}

/** Turns two-factor off; needs the password and a current code (or a recovery code). */
export async function disableTotp(_prev: AccountState, form: FormData): Promise<AccountState> {
  const { user, db, row } = await account();
  const blocked = await guard(user.id);
  if (blocked) return blocked;
  if (!row.totpSecretEncrypted) return { error: "Two-factor sign-in is not on." };
  if (!(await bcrypt.compare(String(form.get("password") ?? ""), row.passwordHash))) return { error: "Your password is not right." };
  const code = String(form.get("code") ?? "").trim();
  const ok = verifyTotp(decryptSecret(row.totpSecretEncrypted), code) || row.recoveryCodes.includes(hashRecoveryCode(code));
  if (!ok) return { error: "That code didn't work." };
  await db.user.update({ where: { id: user.id }, data: { totpSecretEncrypted: null, totpEnabledAt: null, recoveryCodes: [] } });
  revalidatePath("/account");
  return { done: "Two-factor sign-in is off." };
}

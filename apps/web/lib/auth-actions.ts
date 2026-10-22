"use server";

import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { z } from "zod";
import { EmailTakenError, consumePasswordReset, createPasswordReset, createUser, dbForUser, findUserForLogin } from "@store-ops/db";
import { decryptSecret } from "@store-ops/shared/crypto";
import { hashRecoveryCode, verifyTotp } from "@store-ops/shared/totp";
import { describeRetry, escapeHtml, rateLimit, resetRateLimit, sendEmail } from "@store-ops/tools";
import { PASSWORD_RULE } from "./passwords";
import { clearMfaChallenge, clientIp, endSession, readMfaChallenge, startMfaChallenge, startSession } from "./session";

export interface FormState {
  error?: string;
  /** A confirmation to show instead of the form. */
  done?: string;
}

const RESET_TTL_MS = 30 * 60 * 1000;

const SignupInput = z.object({
  name: z.string().trim().min(1, "Enter your name").max(100),
  email: z.email("Enter a valid email").max(200),
  password: PASSWORD_RULE,
});

const LoginInput = z.object({
  email: z.email("Enter a valid email"),
  password: z.string().min(1, "Enter your password"),
});

// Compared against when the email is unknown, so timing does not reveal which emails exist.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= bcrypt.hash("not-a-real-password", 12));

const tooMany = (seconds: number) => ({ error: `Too many attempts. Try again in ${describeRetry(seconds)}.` });

function appUrl(path: string): string {
  return `${(process.env.APP_URL ?? "http://localhost:3100").replace(/\/$/, "")}${path}`;
}

export async function signup(_prev: FormState, form: FormData): Promise<FormState> {
  const limit = await rateLimit(`signup:ip:${await clientIp()}`, 5, 3600);
  if (!limit.ok) return tooMany(limit.retryAfter);
  const parsed = SignupInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const { name, email, password } = parsed.data;
  let id: string;
  try {
    id = await createUser(email, name, await bcrypt.hash(password, 12));
  } catch (err) {
    if (err instanceof EmailTakenError) return { error: err.message };
    throw err;
  }
  await startSession({ id, name, sessionVersion: 0 });
  // Straight into onboarding: connecting a store is the next step.
  redirect("/stores/new");
}

export async function login(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = LoginInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const email = parsed.data.email.toLowerCase();
  const [byIp, byEmail] = await Promise.all([
    rateLimit(`login:ip:${await clientIp()}`, 30, 900),
    rateLimit(`login:email:${email}`, 10, 900),
  ]);
  if (!byIp.ok || !byEmail.ok) return tooMany(Math.max(byIp.retryAfter, byEmail.retryAfter));

  const user = await findUserForLogin(email);
  const ok = await bcrypt.compare(parsed.data.password, user?.password_hash ?? (await getDummyHash()));
  if (!user || !ok) return { error: "Wrong email or password" };
  await resetRateLimit(`login:email:${email}`);

  const account = await dbForUser(user.id).user.findUniqueOrThrow({ where: { id: user.id }, select: { sessionVersion: true, totpEnabledAt: true } });
  if (account.totpEnabledAt) {
    await startMfaChallenge(user.id);
    redirect("/login/verify");
  }
  await startSession({ id: user.id, name: user.name, sessionVersion: account.sessionVersion });
  redirect("/stores");
}

/** The second step for accounts with two-factor sign-in: an authenticator code or a recovery code. */
export async function verifyMfa(_prev: FormState, form: FormData): Promise<FormState> {
  const userId = await readMfaChallenge();
  if (!userId) return { error: "This sign-in has expired. Log in again." };
  const limit = await rateLimit(`mfa:${userId}`, 8, 900);
  if (!limit.ok) return tooMany(limit.retryAfter);

  const code = String(form.get("code") ?? "").trim();
  const db = dbForUser(userId);
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { name: true, sessionVersion: true, totpSecretEncrypted: true, recoveryCodes: true },
  });
  if (!user?.totpSecretEncrypted) return { error: "This sign-in has expired. Log in again." };

  let ok = /^\d{6}$/.test(code.replace(/\s/g, "")) && verifyTotp(decryptSecret(user.totpSecretEncrypted), code);
  if (!ok && code.length >= 8) {
    // A recovery code works once.
    const hash = hashRecoveryCode(code);
    if (user.recoveryCodes.includes(hash)) {
      await db.user.update({ where: { id: userId }, data: { recoveryCodes: user.recoveryCodes.filter((c) => c !== hash) } });
      ok = true;
    }
  }
  if (!ok) return { error: "That code didn't work. Check your authenticator app and try again." };

  await resetRateLimit(`mfa:${userId}`);
  await clearMfaChallenge();
  await startSession({ id: userId, name: user.name, sessionVersion: user.sessionVersion });
  redirect("/stores");
}

export async function logout(): Promise<void> {
  await endSession();
  redirect("/login");
}

// ---- Password reset ------------------------------------------------------------

/**
 * Emails a reset link when the address has an account. The answer is the same
 * either way, so the form cannot be used to find out who has an account.
 */
export async function requestPasswordReset(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = z.email("Enter a valid email").safeParse(String(form.get("email") ?? "").trim());
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const email = parsed.data.toLowerCase();
  const [byIp, byEmail] = await Promise.all([
    rateLimit(`reset:ip:${await clientIp()}`, 10, 3600),
    rateLimit(`reset:email:${email}`, 3, 3600),
  ]);
  const done = { done: `If ${email} has an account, a link to choose a new password is on its way. It works for 30 minutes.` };
  if (!byIp.ok) return tooMany(byIp.retryAfter);
  if (!byEmail.ok) return done;

  const token = randomBytes(32).toString("base64url");
  const account = await createPasswordReset(email, createHash("sha256").update(token).digest("hex"), new Date(Date.now() + RESET_TTL_MS));
  if (account) {
    const link = appUrl(`/reset-password/${token}`);
    try {
      await sendEmail({
        to: account.email,
        subject: "Reset your Store Ops Agent password",
        text: `Hi ${account.name},\n\nUse this link to choose a new password. It works once, for 30 minutes:\n${link}\n\nIf you didn't ask for this, ignore this email; your password stays the same.`,
        html: `<p>Hi ${escapeHtml(account.name)},</p><p>Use this link to choose a new password. It works once, for 30 minutes.</p><p><a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 16px;background:#16a34a;color:#fff;border-radius:8px;text-decoration:none">Choose a new password</a></p><p style="color:#64748b;font-size:13px">If you didn't ask for this, ignore this email; your password stays the same.</p>`,
      });
    } catch (err) {
      console.error("Could not send a password reset email", err instanceof Error ? err.message : err);
    }
  }
  return done;
}

const ResetInput = z.object({ password: PASSWORD_RULE, confirm: z.string() }).refine((v) => v.password === v.confirm, {
  message: "The two passwords don't match",
});

/** Sets the new password from a reset link, and signs the account out everywhere. */
export async function resetPassword(token: string, _prev: FormState, form: FormData): Promise<FormState> {
  const limit = await rateLimit(`reset-submit:ip:${await clientIp()}`, 20, 3600);
  if (!limit.ok) return tooMany(limit.retryAfter);
  const parsed = ResetInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };

  const userId = await consumePasswordReset(createHash("sha256").update(token).digest("hex"));
  if (!userId) return { error: "This link has expired or was already used. Ask for a new one." };
  await dbForUser(userId).user.update({
    where: { id: userId },
    data: { passwordHash: await bcrypt.hash(parsed.data.password, 12), sessionVersion: { increment: 1 } },
  });
  await endSession();
  redirect("/login?reset=1");
}

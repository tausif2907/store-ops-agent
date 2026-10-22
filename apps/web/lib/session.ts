import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { dbForUser } from "@store-ops/db";

const COOKIE = "so_session";
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
/** Between a correct password and a correct two-factor code. */
const MFA_COOKIE = "so_mfa";
const MFA_MAX_AGE_SECONDS = 5 * 60;

export interface SessionUser {
  id: string;
  name: string;
}

function secret(): Uint8Array {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET must be set to at least 32 characters");
  return new TextEncoder().encode(value);
}

const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge,
});

/**
 * Signs the user in on this browser. The token carries the account's session
 * version: raising it (password change or reset, "log out everywhere") ends
 * every session issued before.
 */
export async function startSession(user: SessionUser & { sessionVersion: number }): Promise<void> {
  const token = await new SignJWT({ name: user.name, sv: user.sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secret());
  (await cookies()).set(COOKIE, token, cookieOptions(MAX_AGE_SECONDS));
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

/** The signed-in user, checked against the account once per request. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  let id: string;
  let version: unknown;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (!payload.sub) return null;
    id = payload.sub;
    version = payload.sv;
  } catch {
    return null;
  }
  const user = await dbForUser(id).user.findUnique({ where: { id }, select: { name: true, sessionVersion: true } });
  if (!user || user.sessionVersion !== (typeof version === "number" ? version : 0)) return null;
  return { id, name: user.name };
});

/** For pages and actions that need a signed-in owner. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

// ---- Two-factor challenge ----------------------------------------------------

export async function startMfaChallenge(userId: string): Promise<void> {
  const token = await new SignJWT({ purpose: "mfa" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setExpirationTime(`${MFA_MAX_AGE_SECONDS}s`)
    .sign(secret());
  (await cookies()).set(MFA_COOKIE, token, cookieOptions(MFA_MAX_AGE_SECONDS));
}

/** The user who passed the password step in the last five minutes, if any. */
export async function readMfaChallenge(): Promise<string | null> {
  const token = (await cookies()).get(MFA_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    return payload.purpose === "mfa" && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

export async function clearMfaChallenge(): Promise<void> {
  (await cookies()).delete(MFA_COOKIE);
}

/**
 * The client's address, for rate limits. Behind the host's proxy this is the
 * last X-Forwarded-For entry, the one the proxy added: earlier entries come
 * from the client and can be made up.
 */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",").at(-1)?.trim() || h.get("x-real-ip") || "local";
}

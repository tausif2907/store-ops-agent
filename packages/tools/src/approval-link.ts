import { SignJWT, jwtVerify } from "jose";

/**
 * Signed links that let the owner approve or reject from email without
 * signing in. A link names one approval, its store and its owner, and expires
 * with the approval. It is single-use in effect: an approval can only leave
 * PENDING once.
 */

export interface ApprovalLinkClaims {
  approvalId: string;
  storeId: string;
  ownerId: string;
}

const AUDIENCE = "store-ops:approval";

function secret(): Uint8Array {
  const value = process.env.APPROVAL_LINK_SECRET;
  if (!value || value.length < 32) throw new Error("APPROVAL_LINK_SECRET must be set to at least 32 characters");
  return new TextEncoder().encode(value);
}

export async function signApprovalLink(claims: ApprovalLinkClaims, expiresAt: Date): Promise<string> {
  return new SignJWT({ sid: claims.storeId, uid: claims.ownerId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.approvalId)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(secret());
}

/** Returns the claims, or null for a link that is forged, altered or expired. */
export async function verifyApprovalLink(token: string): Promise<ApprovalLinkClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"], audience: AUDIENCE });
    if (typeof payload.sub !== "string" || typeof payload.sid !== "string" || typeof payload.uid !== "string") return null;
    return { approvalId: payload.sub, storeId: payload.sid, ownerId: payload.uid };
  } catch {
    return null;
  }
}

export function approvalUrl(token: string): string {
  return `${(process.env.APP_URL ?? "http://localhost:3100").replace(/\/$/, "")}/approve/${token}`;
}

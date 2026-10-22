import "server-only";
import { cache } from "react";
import { ownerEntitlementForUser } from "@store-ops/db";
import { evaluateEntitlement, type Entitlement } from "@store-ops/tools";

/** The signed-in owner's plan and usage, read once per request. */
export const entitlementFor = cache(async (userId: string): Promise<Entitlement | null> => {
  const row = await ownerEntitlementForUser(userId);
  return row ? evaluateEntitlement(row) : null;
});

/** Why this owner cannot connect another store right now, or null when they can. */
export async function cannotAddStoreReason(userId: string): Promise<string | null> {
  const e = await entitlementFor(userId);
  if (!e) return "Your account could not be found.";
  if (!e.active) return `${e.reason} Go to Plan and billing.`;
  if (e.storeCount >= e.storeLimit) {
    return `Your ${e.plan.name} plan includes ${e.storeLimit} store${e.storeLimit === 1 ? "" : "s"}. Move to a bigger plan under Plan and billing to connect another.`;
  }
  return null;
}

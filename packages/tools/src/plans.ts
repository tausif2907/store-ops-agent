import type { EntitlementRow } from "@store-ops/db";

/**
 * Plans, as on the pricing page. The trial gives Starter's limits for 14
 * days. AI usage is counted across all of an owner's stores per calendar
 * month (UTC); each store's own budget still applies inside it.
 */

export const PAID_PLANS = ["starter", "growth"] as const;
export type PaidPlan = (typeof PAID_PLANS)[number];
export type PlanId = "trial" | PaidPlan | "custom";

export interface PlanDefinition {
  id: PlanId;
  name: string;
  priceInr: number | null;
  stores: number;
  aiAllowanceInr: number;
}

export const PLANS: Record<PlanId, PlanDefinition> = {
  trial: { id: "trial", name: "Free trial", priceInr: 0, stores: 1, aiAllowanceInr: 500 },
  starter: { id: "starter", name: "Starter", priceInr: 999, stores: 1, aiAllowanceInr: 500 },
  growth: { id: "growth", name: "Growth", priceInr: 2499, stores: 3, aiAllowanceInr: 1500 },
  custom: { id: "custom", name: "Custom", priceInr: null, stores: 10, aiAllowanceInr: 5000 },
};

export interface Entitlement {
  plan: PlanDefinition;
  status: string;
  /** The agent may run and stores may be connected. */
  active: boolean;
  /** Why not, in words for the owner. */
  reason: string | null;
  trialEndsAt: Date;
  trialDaysLeft: number | null;
  renewsAt: Date | null;
  storeLimit: number;
  storeCount: number;
  canAddStore: boolean;
  aiAllowanceInr: number;
  monthSpendInr: number;
  allowanceUsed: boolean;
}

export function evaluateEntitlement(row: EntitlementRow, now = new Date()): Entitlement {
  const plan = PLANS[(row.plan in PLANS ? row.plan : "trial") as PlanId];
  const storeLimit = row.planStoreLimit ?? plan.stores;
  const aiAllowanceInr = row.planAiAllowanceInr ?? plan.aiAllowanceInr;
  const trialLeftMs = row.trialEndsAt.getTime() - now.getTime();

  let active: boolean;
  let reason: string | null = null;
  if (row.plan === "trial") {
    active = trialLeftMs > 0;
    if (!active) reason = "Your free trial has ended. Choose a plan to keep the agent running.";
  } else {
    switch (row.planStatus) {
      case "active":
      case "past_due": // the payment provider is retrying; keep things running meanwhile
        active = true;
        break;
      case "cancelled":
        active = row.planRenewsAt !== null && row.planRenewsAt > now;
        if (!active) reason = "Your plan has ended. Choose a plan to keep the agent running.";
        break;
      case "halted":
        active = false;
        reason = "Your last payment did not go through. Update your payment to keep the agent running.";
        break;
      default: // pending: checkout started but not confirmed; the trial still counts
        active = trialLeftMs > 0;
        if (!active) reason = "Your plan is not active yet. Finish checkout to keep the agent running.";
    }
  }

  const allowanceUsed = row.monthSpendInr >= aiAllowanceInr;
  return {
    plan,
    status: row.planStatus,
    active,
    reason,
    trialEndsAt: row.trialEndsAt,
    trialDaysLeft: row.plan === "trial" ? Math.max(0, Math.ceil(trialLeftMs / 86_400_000)) : null,
    renewsAt: row.planRenewsAt,
    storeLimit,
    storeCount: row.storeCount,
    canAddStore: active && row.storeCount < storeLimit,
    aiAllowanceInr,
    monthSpendInr: row.monthSpendInr,
    allowanceUsed,
  };
}

/** Why the agent may not run for this owner now, or null when it may. */
export function runBlockedReason(e: Entitlement): string | null {
  if (!e.active) return e.reason;
  if (e.allowanceUsed) {
    return `This month's AI usage on your ${e.plan.name} plan (₹${e.aiAllowanceInr.toFixed(0)}) is used up. It resets next month, or you can move to a bigger plan.`;
  }
  return null;
}

"use server";

import { redirect } from "next/navigation";
import { dbForUser, startSubscription } from "@store-ops/db";
import { BillingError, PAID_PLANS, cancelSubscription, createSubscription, rateLimit, razorpayConfig, type PaidPlan } from "@store-ops/tools";
import { CONTACT_EMAIL } from "./site";
import { requireUser } from "./session";
import { entitlementFor } from "./plan";

export interface BillingState {
  error?: string;
  done?: string;
}

/** Starts paying for a plan on Razorpay's hosted page. */
export async function choosePlan(plan: PaidPlan, _prev: BillingState, _form: FormData): Promise<BillingState> {
  const user = await requireUser();
  if (!PAID_PLANS.includes(plan)) return { error: "Unknown plan." };
  const config = razorpayConfig();
  if (!config) return { error: `Online payments aren't set up yet. Write to ${CONTACT_EMAIL} and we'll get you started.` };
  const limit = await rateLimit(`billing:${user.id}`, 5, 600);
  if (!limit.ok) return { error: "Please wait a few minutes before trying again." };

  const current = await entitlementFor(user.id);
  if (current && current.plan.id !== "trial" && current.plan.id !== "custom" && ["active", "past_due"].includes(current.status)) {
    return { error: `You're on the ${current.plan.name} plan. To switch plans, write to ${CONTACT_EMAIL} and we'll move you over without charging twice.` };
  }

  let url: string;
  try {
    const sub = await createSubscription(config, plan, user.id);
    await startSubscription(user.id, sub.id, plan);
    url = sub.shortUrl;
  } catch (err) {
    console.error("Could not start a subscription", err instanceof Error ? err.message : err);
    return { error: err instanceof BillingError ? `Razorpay: ${err.message}` : "Could not reach the payment provider. Try again." };
  }
  redirect(url);
}

/** Cancels at the end of the paid period. */
export async function cancelPlan(_prev: BillingState, _form: FormData): Promise<BillingState> {
  const user = await requireUser();
  const config = razorpayConfig();
  const row = await dbForUser(user.id).user.findUniqueOrThrow({ where: { id: user.id }, select: { razorpaySubscriptionId: true, planRenewsAt: true } });
  if (!config || !row.razorpaySubscriptionId) return { error: `Write to ${CONTACT_EMAIL} to change or cancel your plan.` };
  try {
    await cancelSubscription(config, row.razorpaySubscriptionId);
  } catch (err) {
    return { error: err instanceof BillingError ? `Razorpay: ${err.message}` : "Could not reach the payment provider. Try again." };
  }
  const until = row.planRenewsAt ? ` It stays active until ${row.planRenewsAt.toLocaleDateString("en-IN", { dateStyle: "medium" })}.` : "";
  return { done: `Your plan will not renew.${until}` };
}

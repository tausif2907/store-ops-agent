import { createHmac, timingSafeEqual } from "node:crypto";
import type { PaidPlan } from "./plans";

/**
 * Paid plans through Razorpay Subscriptions. The owner pays on Razorpay's own
 * hosted page (the subscription's short_url); signed webhooks then move the
 * account's plan. Plans are created once in the Razorpay dashboard and named
 * here by id. Without keys, billing is simply unavailable and trials work.
 */

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string | null;
  planIds: Record<PaidPlan, string>;
}

export function razorpayConfig(): RazorpayConfig | null {
  const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET, RAZORPAY_PLAN_STARTER, RAZORPAY_PLAN_GROWTH } = process.env;
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET || !RAZORPAY_PLAN_STARTER || !RAZORPAY_PLAN_GROWTH) return null;
  return {
    keyId: RAZORPAY_KEY_ID,
    keySecret: RAZORPAY_KEY_SECRET,
    webhookSecret: RAZORPAY_WEBHOOK_SECRET || null,
    planIds: { starter: RAZORPAY_PLAN_STARTER, growth: RAZORPAY_PLAN_GROWTH },
  };
}

export class BillingError extends Error {}

async function razorpay<T>(config: RazorpayConfig, method: "POST" | "GET", path: string, body: unknown, fetchImpl: typeof fetch): Promise<T> {
  const res = await fetchImpl(`https://api.razorpay.com/v1${path}`, {
    method,
    headers: {
      authorization: `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString("base64")}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { description?: string } };
  if (!res.ok) throw new BillingError(json.error?.description ?? `Razorpay returned ${res.status}`);
  return json;
}

/** A subscription for the plan; the owner authorises payment at its short_url. */
export async function createSubscription(
  config: RazorpayConfig,
  plan: PaidPlan,
  userId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ id: string; shortUrl: string }> {
  const sub = await razorpay<{ id: string; short_url: string }>(
    config,
    "POST",
    "/subscriptions",
    // Monthly for ten years; the owner can cancel any time.
    { plan_id: config.planIds[plan], total_count: 120, quantity: 1, customer_notify: true, notes: { user_id: userId, plan } },
    fetchImpl,
  );
  return { id: sub.id, shortUrl: sub.short_url };
}

/** Cancels at the end of the paid period, so the owner keeps what they paid for. */
export async function cancelSubscription(config: RazorpayConfig, subscriptionId: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  await razorpay(config, "POST", `/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, { cancel_at_cycle_end: true }, fetchImpl);
}

/** X-Razorpay-Signature: hex HMAC-SHA256 of the raw body with the webhook secret. */
export function verifyRazorpaySignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(rawBody).digest("hex"));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Razorpay's subscription status as our plan status. */
export function planStatusFor(razorpayStatus: string): "pending" | "active" | "past_due" | "halted" | "cancelled" | null {
  switch (razorpayStatus) {
    case "created":
    case "authenticated": // payment method set up; the first charge is still to come
      return "pending";
    case "active":
      return "active";
    case "pending": // a charge failed and is being retried
      return "past_due";
    case "halted":
    case "paused":
      return "halted";
    case "cancelled":
    case "completed":
    case "expired":
      return "cancelled";
    default:
      return null;
  }
}

export function planForRazorpayPlanId(config: RazorpayConfig, planId: string): PaidPlan | null {
  return (Object.entries(config.planIds).find(([, id]) => id === planId)?.[0] as PaidPlan | undefined) ?? null;
}

export interface SubscriptionEvent {
  subscriptionId: string;
  plan: PaidPlan | null;
  status: NonNullable<ReturnType<typeof planStatusFor>>;
  renewsAt: Date | null;
}

/** The account change a verified webhook body asks for, or null for events we don't act on. */
export function subscriptionEventFrom(config: RazorpayConfig, body: unknown): SubscriptionEvent | null {
  const event = body as { event?: string; payload?: { subscription?: { entity?: { id?: string; plan_id?: string; status?: string; current_end?: number | null } } } };
  const entity = event.payload?.subscription?.entity;
  if (!event.event?.startsWith("subscription.") || !entity?.id || !entity.status) return null;
  const status = planStatusFor(entity.status);
  if (!status) return null;
  return {
    subscriptionId: entity.id,
    plan: entity.plan_id ? planForRazorpayPlanId(config, entity.plan_id) : null,
    status,
    renewsAt: entity.current_end ? new Date(entity.current_end * 1000) : null,
  };
}

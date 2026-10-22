import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { EntitlementRow } from "@store-ops/db";
import {
  createSubscription,
  evaluateEntitlement,
  planStatusFor,
  rateLimit,
  runBlockedReason,
  subscriptionEventFrom,
  verifyRazorpaySignature,
  type RazorpayConfig,
} from "../src/index";

const now = new Date("2026-10-22T10:00:00Z");
const DAY = 86_400_000;

function row(overrides: Partial<EntitlementRow> = {}): EntitlementRow {
  return {
    plan: "trial",
    planStatus: "trialing",
    trialEndsAt: new Date(now.getTime() + 5 * DAY),
    planRenewsAt: null,
    planStoreLimit: null,
    planAiAllowanceInr: null,
    storeCount: 0,
    monthSpendInr: 0,
    ...overrides,
  };
}

describe("plans", () => {
  it("give a trial Starter's limits until it ends", () => {
    const e = evaluateEntitlement(row(), now);
    expect(e).toMatchObject({ active: true, storeLimit: 1, aiAllowanceInr: 500, trialDaysLeft: 5, canAddStore: true });
    expect(evaluateEntitlement(row({ storeCount: 1 }), now).canAddStore).toBe(false);
    const ended = evaluateEntitlement(row({ trialEndsAt: new Date(now.getTime() - 1) }), now);
    expect(ended.active).toBe(false);
    expect(runBlockedReason(ended)).toMatch(/trial has ended/);
  });

  it("stop runs when the month's AI allowance across stores is used", () => {
    const e = evaluateEntitlement(row({ plan: "growth", planStatus: "active", monthSpendInr: 1500 }), now);
    expect(e.storeLimit).toBe(3);
    expect(runBlockedReason(e)).toMatch(/AI usage on your Growth plan \(₹1500\) is used up/);
    expect(runBlockedReason(evaluateEntitlement(row({ plan: "growth", planStatus: "active", monthSpendInr: 1499 }), now))).toBeNull();
  });

  it("keep a cancelled plan until its paid period ends, and stop a halted one", () => {
    expect(evaluateEntitlement(row({ plan: "starter", planStatus: "cancelled", planRenewsAt: new Date(now.getTime() + DAY) }), now).active).toBe(true);
    expect(evaluateEntitlement(row({ plan: "starter", planStatus: "cancelled", planRenewsAt: new Date(now.getTime() - DAY) }), now).active).toBe(false);
    expect(evaluateEntitlement(row({ plan: "starter", planStatus: "halted" }), now).reason).toMatch(/payment did not go through/);
    expect(evaluateEntitlement(row({ plan: "starter", planStatus: "past_due" }), now).active).toBe(true);
  });

  it("use a Custom plan's own limits", () => {
    const e = evaluateEntitlement(row({ plan: "custom", planStatus: "active", planStoreLimit: 12, planAiAllowanceInr: 8000, storeCount: 11 }), now);
    expect(e).toMatchObject({ storeLimit: 12, aiAllowanceInr: 8000, canAddStore: true });
  });
});

describe("Razorpay billing", () => {
  const config: RazorpayConfig = { keyId: "rzp_test_x", keySecret: "secret", webhookSecret: "whsec", planIds: { starter: "plan_starter0000001", growth: "plan_growth00000001" } };

  it("verifies webhook signatures over the raw body", () => {
    const body = JSON.stringify({ event: "subscription.activated" });
    const good = createHmac("sha256", "whsec").update(body).digest("hex");
    expect(verifyRazorpaySignature(body, good, "whsec")).toBe(true);
    expect(verifyRazorpaySignature(`${body} `, good, "whsec")).toBe(false);
    expect(verifyRazorpaySignature(body, good, "other")).toBe(false);
    expect(verifyRazorpaySignature(body, null, "whsec")).toBe(false);
  });

  it("turns subscription events into plan changes", () => {
    const event = subscriptionEventFrom(config, {
      event: "subscription.charged",
      payload: { subscription: { entity: { id: "sub_1", plan_id: "plan_growth00000001", status: "active", current_end: 1795000000 } } },
    });
    expect(event).toEqual({ subscriptionId: "sub_1", plan: "growth", status: "active", renewsAt: new Date(1795000000 * 1000) });
    expect(subscriptionEventFrom(config, { event: "payment.captured", payload: {} })).toBeNull();
    expect(planStatusFor("halted")).toBe("halted");
    expect(planStatusFor("completed")).toBe("cancelled");
    expect(planStatusFor("authenticated")).toBe("pending");
  });

  it("creates a subscription for the plan and returns Razorpay's payment page", async () => {
    let sent: { url: string; auth: string | null; body: Record<string, unknown> } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      sent = { url, auth: new Headers(init.headers).get("authorization"), body: JSON.parse(String(init.body)) };
      return new Response(JSON.stringify({ id: "sub_9", short_url: "https://rzp.io/i/abc" }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await createSubscription(config, "starter", "user-1", fetchImpl)).toEqual({ id: "sub_9", shortUrl: "https://rzp.io/i/abc" });
    expect(sent!.url).toBe("https://api.razorpay.com/v1/subscriptions");
    expect(sent!.auth).toBe(`Basic ${Buffer.from("rzp_test_x:secret").toString("base64")}`);
    expect(sent!.body).toMatchObject({ plan_id: "plan_starter0000001", notes: { user_id: "user-1" } });
  });
});

describe("rate limits", () => {
  it("allow up to the limit in a window, then refuse", async () => {
    const key = `test:${Date.now()}:${Math.random()}`;
    const results = [];
    for (let i = 0; i < 4; i++) results.push((await rateLimit(key, 3, 60)).ok);
    expect(results).toEqual([true, true, true, false]);
  });
});

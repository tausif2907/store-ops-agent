import { applySubscriptionEvent } from "@store-ops/db";
import { razorpayConfig, subscriptionEventFrom, verifyRazorpaySignature } from "@store-ops/tools";

/**
 * Razorpay subscription webhooks. Every request must carry a valid signature
 * of its raw body; only then does it move an account's plan. Events are
 * applied as the latest state, so a retried delivery changes nothing.
 */
export async function POST(req: Request) {
  const config = razorpayConfig();
  if (!config?.webhookSecret) return new Response("Billing is not configured", { status: 503 });

  const raw = await req.text();
  if (!verifyRazorpaySignature(raw, req.headers.get("x-razorpay-signature"), config.webhookSecret)) {
    return new Response("Invalid signature", { status: 401 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  const event = subscriptionEventFrom(config, body);
  if (event) {
    const matched = await applySubscriptionEvent(event);
    if (!matched) console.warn(`Razorpay event for an unknown subscription ${event.subscriptionId}`);
  }
  return new Response(null, { status: 200 });
}

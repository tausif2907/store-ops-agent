import { appConfigFromEnv, shopifyOAuth } from "@store-ops/adapters";
import { dbForStore, isUniqueViolation, storeIdForExternal, type Prisma } from "@store-ops/db";

/**
 * Shopify webhooks. Every request must carry a valid HMAC of the raw body.
 * Events are stored for the job worker (Phase 6); app/uninstalled marks the
 * connection revoked. Shopify retries anything that is not a quick 200.
 */

const COMPLIANCE_TOPICS = new Set(["customers/data_request", "customers/redact", "shop/redact"]);

export async function POST(req: Request) {
  const app = appConfigFromEnv();
  if (!app) return new Response("Shopify is not configured", { status: 503 });

  const raw = await req.text();
  if (!shopifyOAuth.verifyWebhookHmac(raw, req.headers.get("x-shopify-hmac-sha256"), app.clientSecret)) {
    return new Response("Invalid signature", { status: 401 });
  }

  const topic = req.headers.get("x-shopify-topic") ?? "unknown";
  const shop = req.headers.get("x-shopify-shop-domain") ?? "";
  const deliveryId = req.headers.get("x-shopify-webhook-id") ?? req.headers.get("x-shopify-event-id") ?? crypto.randomUUID();

  const storeId = shop ? await storeIdForExternal("SHOPIFY", shop) : null;
  if (!storeId) {
    // Unknown or already-removed store: acknowledge so Shopify stops retrying.
    if (COMPLIANCE_TOPICS.has(topic)) console.log(`Shopify compliance request ${topic} for ${shop}: no stored data for this shop.`);
    return new Response(null, { status: 200 });
  }

  let payload: Prisma.InputJsonValue;
  try {
    payload = JSON.parse(raw) as Prisma.InputJsonValue;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const db = dbForStore(storeId);
  try {
    await db.webhookEvent.create({ data: { storeId, topic, deliveryId, payload } });
  } catch (err) {
    // A retried delivery we already have.
    if (isUniqueViolation(err)) return new Response(null, { status: 200 });
    throw err;
  }

  if (topic === "app/uninstalled") {
    await db.storeConnection.updateMany({ where: { storeId }, data: { status: "REVOKED", lastError: "The app was uninstalled from Shopify." } });
    await db.auditLog.create({ data: { storeId, actor: "shopify", action: "store.disconnected", after: { reason: "app/uninstalled" } } });
  }
  if (COMPLIANCE_TOPICS.has(topic)) {
    await db.auditLog.create({ data: { storeId, actor: "shopify", action: `compliance.${topic}`, after: payload } });
  }
  return new Response(null, { status: 200 });
}

import { WooCredentials, verifyWooWebhook } from "@store-ops/adapters";
import { dbForStore, isUniqueViolation, type Prisma } from "@store-ops/db";
import { decryptJson } from "@store-ops/shared/crypto";

/**
 * WooCommerce webhooks for one store. Each delivery is signed with the
 * secret this store's adapter created when it subscribed; anything unsigned
 * or signed with another secret is refused. Events are stored for the job
 * worker (Phase 6).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request, { params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  if (!UUID.test(storeId)) return new Response("Not found", { status: 404 });

  const raw = await req.text();
  const topic = req.headers.get("x-wc-webhook-topic");
  // WooCommerce pings a new webhook with a form body and no topic; just acknowledge.
  if (!topic && /^webhook_id=\d+$/.test(raw.trim())) return new Response(null, { status: 200 });

  const db = dbForStore(storeId);
  const store = await db.store.findUnique({ where: { id: storeId }, include: { connection: true } });
  if (!store || store.platform !== "WOOCOMMERCE" || !store.connection) return new Response("Not found", { status: 404 });

  const { webhookSecret } = WooCredentials.parse(decryptJson(store.connection.credentialsEncrypted));
  if (!webhookSecret || !verifyWooWebhook(raw, req.headers.get("x-wc-webhook-signature"), webhookSecret)) {
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: Prisma.InputJsonValue;
  try {
    payload = JSON.parse(raw) as Prisma.InputJsonValue;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  const deliveryId = req.headers.get("x-wc-webhook-delivery-id") ?? crypto.randomUUID();
  try {
    await db.webhookEvent.create({ data: { storeId, topic: topic ?? "unknown", deliveryId, payload } });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
  }
  return new Response(null, { status: 200 });
}

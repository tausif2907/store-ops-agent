import type { OrderStatus } from "@store-ops/shared";
import { AdapterError } from "../adapter";
import { DATASET_COUNTS, buildDataset, promisedAtIso, variantOf, type Dataset } from "../testing/dataset";
import type { ShopifyAdapter } from "./adapter";
import type { ShopifyClient } from "./client";
import { fromMinorUnits } from "./mappers";
import * as Q from "./queries";

/**
 * Loads the canonical dataset into a dedicated Shopify development store, and
 * restores its mutable state between conformance runs.
 *
 * Dev stores accept 5 new orders a minute, so a first seed takes about 40
 * minutes. Seeding is resumable: products are upserted by handle, orders are
 * skipped when one with the same name exists, and the dataset's reference time
 * is stored on the shop so every run sees the same dates.
 */

export const DATASET_TAG = "store-ops-dataset";
const ANCHOR_KEY = "dataset_anchor";

const STATUS_TAG: Partial<Record<OrderStatus, string>> = { processing: Q.PROCESSING_TAG, ready: Q.READY_TAG };

interface SeedOptions {
  log?: (message: string) => void;
  /** Pause between order creations (dev stores: 5 per minute). */
  orderDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

type Payload = { userErrors?: { message: string }[]; orderCancelUserErrors?: { message: string }[] } | null | undefined;

/** Awaits a mutation and throws on its userErrors. */
async function check<T>(promise: Promise<T>, field: string): Promise<T> {
  const data = await promise;
  const payload = (data as Record<string, Payload>)[field];
  const errors = [...(payload?.userErrors ?? []), ...(payload?.orderCancelUserErrors ?? [])];
  if (errors.length) throw new AdapterError("VALIDATION", `${field}: ${errors.map((e) => e.message).join("; ")}`);
  return data;
}

/** The time the store's dataset was generated from, or null if it was never seeded. */
export async function datasetAnchor(client: ShopifyClient): Promise<Date | null> {
  const { shop } = await client.request<{ shop: { metafield: { value: string } | null } }>(Q.SHOP_METAFIELD, { key: ANCHOR_KEY });
  return shop.metafield ? new Date(shop.metafield.value) : null;
}


export async function seedShopifyStore(client: ShopifyClient, options: SeedOptions = {}): Promise<Date> {
  const log = options.log ?? (() => {});
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const delay = options.orderDelayMs ?? 12_500;

  const { shop } = await client.request<{ shop: { id: string; currencyCode: string } }>(Q.SHOP);
  if (shop.currencyCode !== "INR") log(`Note: the store's currency is ${shop.currencyCode}; the dataset is priced in INR.`);
  let anchor = await datasetAnchor(client);
  if (!anchor) {
    anchor = new Date();
    await check(
      client.request(Q.METAFIELDS_SET, {
        metafields: [{ ownerId: shop.id, namespace: Q.METAFIELD_NAMESPACE, key: ANCHOR_KEY, type: "date_time", value: anchor.toISOString() }],
      }),
      "metafieldsSet",
    );
  }
  const dataset = buildDataset(anchor);
  const currency = shop.currencyCode;

  const { locations } = await client.request<{ locations: { nodes: { id: string; isActive: boolean }[] } }>(Q.LOCATIONS);
  const location = locations.nodes.find((l) => l.isActive);
  if (!location) throw new AdapterError("VALIDATION", "The store has no active location.");

  // Products (upsert by handle) ------------------------------------------------
  const variantIds = new Map<string, string>();
  for (const [i, p] of dataset.products.entries()) {
    const data = await check(
      client.request<{ productSet: { product: { variants: { nodes: { id: string; sku: string | null }[] } } | null; userErrors: { message: string }[] } }>(
        Q.PRODUCT_SET,
        {
          handle: `rts-${p.key}`,
          input: {
            title: p.title,
            status: p.status === "draft" ? "DRAFT" : "ACTIVE",
            productOptions: [{ name: "Size", values: p.variants.map((v) => ({ name: v.title })) }],
            variants: p.variants.map((v) => ({
              optionValues: [{ optionName: "Size", name: v.title }],
              price: fromMinorUnits(v.pricePaise, "INR"),
              sku: v.sku,
              inventoryItem: { tracked: v.stock !== null, sku: v.sku },
              inventoryQuantities: v.stock === null ? [] : [{ locationId: location.id, name: "available", quantity: v.stock }],
            })),
          },
        },
      ),
      "productSet",
    );
    for (const node of data.productSet.product?.variants.nodes ?? []) {
      const variant = p.variants.find((v) => v.sku === node.sku);
      if (variant) variantIds.set(variant.key, node.id);
    }
    if ((i + 1) % 10 === 0) log(`Products: ${i + 1}/${dataset.products.length}`);
  }

  // Orders (skip existing by name) ---------------------------------------------
  let created = 0;
  for (const [i, o] of dataset.orders.entries()) {
    const { orders } = await client.request<{ orders: { nodes: { id: string }[] } }>(Q.ORDER_BY_NAME, { query: `name:${o.number}` });
    if (orders.nodes.length) continue;
    if (created > 0) await sleep(delay);

    const customer = dataset.customers.find((c) => c.key === o.customerKey)!;
    const [firstName, ...rest] = customer.name.split(" ");
    const shipped = o.status === "shipped" || o.status === "delivered";
    const statusTag = STATUS_TAG[o.status];
    const data = await check(
      client.request<{ orderCreate: { order: { id: string } | null; userErrors: { message: string }[] } }>(Q.ORDER_CREATE, {
        order: {
          name: o.number,
          processedAt: o.createdAt.toISOString(),
          currency: "INR",
          note: o.note,
          tags: [DATASET_TAG, ...(statusTag ? [statusTag] : [])],
          customer: { toUpsert: { email: customer.email, firstName, lastName: rest.join(" "), phone: customer.phone } },
          financialStatus: o.status === "refunded" ? "REFUNDED" : o.status === "pending" || o.status === "cancelled" ? "PENDING" : "PAID",
          lineItems: o.items.map((item) => ({
            variantId: variantIds.get(item.variantKey),
            quantity: item.quantity,
            priceSet: { shopMoney: { amount: fromMinorUnits(variantOf(dataset, item.productKey, item.variantKey).pricePaise, "INR"), currencyCode: "INR" } },
          })),
          metafields: o.promisedDate
            ? [{ namespace: Q.METAFIELD_NAMESPACE, key: "promised_at", type: "date_time", value: promisedAtIso(o.promisedDate) }]
            : [],
          ...(shipped
            ? {
                fulfillmentStatus: "FULFILLED",
                fulfillment: { locationId: location.id, notifyCustomer: false, shipmentStatus: o.status === "delivered" ? "DELIVERED" : "IN_TRANSIT" },
              }
            : {}),
        },
        options: { inventoryBehaviour: "BYPASS", sendReceipt: false, sendFulfillmentReceipt: false },
      }),
      "orderCreate",
    );
    if (o.status === "cancelled" && data.orderCreate.order) {
      await check(client.request(Q.ORDER_CANCEL, { id: data.orderCreate.order.id }), "orderCancel");
    }
    created++;
    log(`Orders: ${i + 1}/${dataset.orders.length} (${o.number})`);
  }

  // Coupons ---------------------------------------------------------------------
  await syncCoupons(client, dataset, currency);
  log(`Seeded: ${DATASET_COUNTS.products} products, ${DATASET_COUNTS.orders} orders, ${DATASET_COUNTS.coupons} coupons.`);
  return anchor;
}

async function syncCoupons(client: ShopifyClient, dataset: Dataset, currency: string) {
  const existing = await listCodeDiscounts(client);
  for (const [code, id] of existing) {
    if (!dataset.coupons.some((c) => c.code === code)) await check(client.request(Q.DISCOUNT_DELETE, { id }), "discountCodeDelete");
  }
  for (const c of dataset.coupons) {
    if (existing.has(c.code)) continue;
    const data = await check(
      client.request<{ discountCodeBasicCreate: { codeDiscountNode: { id: string } | null; userErrors: { message: string }[] } }>(Q.DISCOUNT_CREATE, {
        input: {
          title: c.code,
          code: c.code,
          startsAt: (c.startsAt ?? new Date(Date.now() - 86_400_000)).toISOString(),
          endsAt: c.endsAt?.toISOString() ?? null,
          usageLimit: c.usageLimit,
          customerGets: {
            value: c.type === "percent" ? { percentage: c.value / 100 } : { discountAmount: { amount: fromMinorUnits(c.value, currency), appliesOnEachItem: false } },
            items: { all: true },
          },
        },
      }),
      "discountCodeBasicCreate",
    );
    if (!c.active && data.discountCodeBasicCreate.codeDiscountNode) {
      await check(client.request(Q.DISCOUNT_DEACTIVATE, { id: data.discountCodeBasicCreate.codeDiscountNode.id }), "discountCodeDeactivate");
    }
  }
}

async function listCodeDiscounts(client: ShopifyClient): Promise<Map<string, string>> {
  const codes = new Map<string, string>();
  let after: string | null = null;
  do {
    const { discountNodes }: {
      discountNodes: { nodes: { id: string; discount: { __typename: string; codes?: { nodes: { code: string }[] } } }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
    } = await client.request(Q.DISCOUNTS, { first: 100, after });
    for (const n of discountNodes.nodes) {
      const code = n.discount.codes?.nodes[0]?.code;
      if (n.discount.__typename === "DiscountCodeBasic" && code) codes.set(code, n.id);
    }
    after = discountNodes.pageInfo.hasNextPage ? discountNodes.pageInfo.endCursor : null;
  } while (after);
  return codes;
}

/**
 * Puts a seeded store back to the dataset's state before a conformance run:
 * order workflow tags, stock levels and coupons. (Shipping, cancelling and
 * refunding are not undone; the conformance suite never does them.)
 */
export async function resetShopifyStore(client: ShopifyClient, adapter: ShopifyAdapter, dataset: Dataset): Promise<void> {
  if (!(await datasetAnchor(client))) {
    throw new Error("This Shopify store has not been seeded. Run: pnpm --filter @store-ops/adapters shopify:seed");
  }

  const orders = [];
  let cursor: string | undefined;
  do {
    const page = await adapter.listOrders({ limit: 100, cursor });
    orders.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  if (orders.length !== dataset.orders.length) {
    throw new Error(`Expected ${dataset.orders.length} orders in the test store, found ${orders.length}. Use a store that holds only the dataset.`);
  }
  for (const o of orders) {
    const want = dataset.orders.find((d) => d.number === o.number)?.status;
    if (want && want !== o.status && ["pending", "processing", "ready"].includes(want)) {
      await adapter.updateOrderStatus(o.id, want);
    }
  }

  let productCursor: string | undefined;
  do {
    const page = await adapter.listProducts({ limit: 100, cursor: productCursor });
    for (const p of page.items) {
      for (const v of p.variants) {
        const want = dataset.products.flatMap((dp) => dp.variants).find((dv) => dv.sku === v.sku)?.stock;
        if (want !== undefined && want !== null && v.stock !== want) await adapter.updateStock(v.id, want);
      }
    }
    productCursor = page.nextCursor ?? undefined;
  } while (productCursor);

  const { shop } = await client.request<{ shop: { currencyCode: string } }>(Q.SHOP);
  await syncCoupons(client, dataset, shop.currencyCode);
}

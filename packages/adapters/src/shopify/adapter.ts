import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  CreateCouponInput,
  OrderFilter,
  OrderStatus,
  ProductFilter,
  type Capability,
  type Coupon,
  type Order,
  type Page,
  type Product,
  type Review,
  type SalesSummary,
  type WebhookEvent,
} from "@store-ops/shared";
import { AdapterError, type StoreAdapter } from "../adapter";
import { parseInput } from "../validation";
import { ShopifyClient, type ShopifyClientOptions, type ShopifyCredentials } from "./client";
import { fromMinorUnits, mapCoupon, mapOrder, mapProduct, searchValue, type RawDiscount, type RawOrder, type RawProduct } from "./mappers";
import * as Q from "./queries";

export interface ShopifyAdapterOptions extends ShopifyClientOptions {
  /** Public HTTPS URL Shopify posts webhooks to. Without it, webhooks are not offered. */
  webhookUrl?: string;
  /** Upper bound on pages scanned when a filter has to be applied here, not by Shopify. */
  maxScanPages?: number;
}

const SCOPE_CAPABILITIES: [Capability, string[]][] = [
  ["orders", ["read_orders"]],
  ["orders.write", ["write_orders"]],
  ["inventory", ["read_products", "read_inventory"]],
  ["inventory.write", ["write_inventory"]],
  ["coupons", ["read_discounts"]],
  ["coupons.write", ["write_discounts"]],
];

const WEBHOOK_TOPICS: Partial<Record<WebhookEvent, string>> = {
  "order.created": "ORDERS_CREATE",
  "order.updated": "ORDERS_UPDATED",
  "product.low_stock": "INVENTORY_LEVELS_UPDATE",
};

const TAG_STATES: OrderStatus[] = ["pending", "processing", "ready"];
const CLOSED: OrderStatus[] = ["delivered", "cancelled", "refunded"];

function isGid(id: string, type: string): boolean {
  return new RegExp(`^gid://shopify/${type}/\\d+$`).test(id);
}

interface Edge<T> {
  cursor: string;
  node: T;
}

/**
 * Adapter for Shopify stores over the Admin GraphQL API.
 *
 * Mapping notes (see DECISIONS.md):
 * - An order's createdAt is Shopify's processedAt (the business date, which
 *   imported orders can set); the promised date is the store_ops.promised_at
 *   metafield.
 * - "processing" and "ready" are order tags; shipped and delivered come from
 *   fulfillments. Cancelling and refunding move money, so they stay in
 *   Shopify admin.
 * - Shopify has no reviews API: no reviews capability.
 */
export class ShopifyAdapter implements StoreAdapter {
  readonly platform = "SHOPIFY" as const;
  private readonly client: ShopifyClient;
  private shopInfo: Promise<{ id: string; name: string; currency: string; timezone: string }> | null = null;

  constructor(
    credentials: ShopifyCredentials,
    private readonly options: ShopifyAdapterOptions = {},
  ) {
    this.client = new ShopifyClient(credentials, options);
  }

  shop() {
    this.shopInfo ??= this.client
      .request<{ shop: { id: string; name: string; currencyCode: string; ianaTimezone: string } }>(Q.SHOP)
      .then(({ shop }) => ({ id: shop.id, name: shop.name, currency: shop.currencyCode, timezone: shop.ianaTimezone }));
    return this.shopInfo;
  }

  async capabilities(): Promise<Capability[]> {
    const granted = new Set(this.client.scopes.flatMap((s) => (s.startsWith("write_") ? [s, s.replace("write_", "read_")] : [s])));
    const all = granted.size === 0; // scopes unknown: let Shopify's own errors decide
    const caps = SCOPE_CAPABILITIES.filter(([, scopes]) => all || scopes.every((s) => granted.has(s))).map(([c]) => c);
    if (this.options.webhookUrl?.startsWith("https://")) caps.push("webhooks");
    return caps;
  }

  private async need(capability: Capability) {
    if (!(await this.capabilities()).includes(capability)) {
      throw new AdapterError("UNSUPPORTED", `This Shopify connection does not allow ${capability}.`);
    }
  }

  // ---- Orders -----------------------------------------------------------------

  async listOrders(filter: OrderFilter = {}): Promise<Page<Order>> {
    await this.need("orders");
    const f = parseInput(OrderFilter, filter);
    const limit = f.limit ?? 25;
    const terms: string[] = [];
    if (f.createdFrom) terms.push(`processed_at:>=${searchValue(f.createdFrom)}`);
    if (f.createdTo) terms.push(`processed_at:<${searchValue(f.createdTo)}`);
    if (f.query) terms.push(searchValue(f.query));
    const now = Date.now();
    const keep = (o: Order) =>
      (!f.status || o.status === f.status) &&
      (!f.createdTo || o.createdAt < f.createdTo) &&
      (!f.createdFrom || o.createdAt >= f.createdFrom) &&
      (!f.overdue || (o.promisedAt !== null && Date.parse(o.promisedAt) < now && !CLOSED.includes(o.status)));
    return this.scan<RawOrder, Order>(Q.ORDERS, "orders", terms.join(" "), f.cursor, limit, mapOrder, keep, Boolean(f.status || f.overdue));
  }

  async getOrder(id: string): Promise<Order> {
    await this.need("orders");
    if (!isGid(id, "Order")) throw new AdapterError("NOT_FOUND", `Order ${id} not found`);
    const { order } = await this.client.request<{ order: RawOrder | null }>(Q.ORDER, { id });
    if (!order) throw new AdapterError("NOT_FOUND", `Order ${id} not found`);
    return mapOrder(order);
  }

  async updateOrderStatus(id: string, status: OrderStatus): Promise<Order> {
    await this.need("orders.write");
    const target = parseInput(OrderStatus, status);
    const current = await this.getOrder(id);
    if (current.status === target) return current;
    if (current.status === "cancelled" || current.status === "refunded") {
      throw new AdapterError("VALIDATION", `Order ${current.number} is ${current.status} and cannot change status.`);
    }
    if (target === "cancelled" || target === "refunded") {
      throw new AdapterError("VALIDATION", "Cancel or refund this order in Shopify admin: it moves money and stock.");
    }

    if (TAG_STATES.includes(target)) {
      if (!TAG_STATES.includes(current.status)) {
        throw new AdapterError("VALIDATION", `Order ${current.number} has already been ${current.status}.`);
      }
      await this.mutate(Q.TAGS_REMOVE, { id, tags: [Q.PROCESSING_TAG, Q.READY_TAG] }, "tagsRemove");
      if (target !== "pending") await this.mutate(Q.TAGS_ADD, { id, tags: [target === "ready" ? Q.READY_TAG : Q.PROCESSING_TAG] }, "tagsAdd");
      return this.getOrder(id);
    }

    // shipped or delivered
    if (TAG_STATES.includes(current.status)) {
      const { order } = await this.client.request<{ order: { fulfillmentOrders: { nodes: { id: string; status: string }[] } } | null }>(
        Q.ORDER_FULFILLMENT_ORDERS,
        { id },
      );
      const open = order?.fulfillmentOrders.nodes.filter((fo) => fo.status === "OPEN" || fo.status === "IN_PROGRESS") ?? [];
      if (open.length === 0) throw new AdapterError("VALIDATION", `Order ${current.number} has nothing left to fulfil.`);
      await this.mutate(
        Q.FULFILLMENT_CREATE,
        { fulfillment: { notifyCustomer: false, lineItemsByFulfillmentOrder: open.map((fo) => ({ fulfillmentOrderId: fo.id })) } },
        "fulfillmentCreate",
      );
      await this.mutate(Q.TAGS_REMOVE, { id, tags: [Q.PROCESSING_TAG, Q.READY_TAG] }, "tagsRemove");
    }
    if (target === "delivered") {
      const { order } = await this.client.request<{ order: RawOrder | null }>(Q.ORDER, { id });
      for (const f of order?.fulfillments ?? []) {
        await this.mutate(Q.FULFILLMENT_EVENT_CREATE, { event: { fulfillmentId: f.id, status: "DELIVERED" } }, "fulfillmentEventCreate");
      }
    }
    return this.getOrder(id);
  }

  // ---- Products and inventory --------------------------------------------------

  async listProducts(filter: ProductFilter = {}): Promise<Page<Product>> {
    await this.need("inventory");
    const f = parseInput(ProductFilter, filter);
    const { currency } = await this.shop();
    const q = f.query?.toLowerCase();
    const keep = (p: Product) =>
      (!q || p.title.toLowerCase().includes(q) || p.variants.some((v) => v.sku?.toLowerCase().includes(q))) &&
      (f.lowStockThreshold === undefined || p.variants.some((v) => v.stock !== null && v.stock <= f.lowStockThreshold!));
    return this.scan<RawProduct, Product>(Q.PRODUCTS, "products", "", f.cursor, f.limit ?? 25, (p) => mapProduct(p, currency), keep, Boolean(q || f.lowStockThreshold !== undefined));
  }

  async getProductByVariant(variantId: string): Promise<Product> {
    await this.need("inventory");
    if (!isGid(variantId, "ProductVariant")) throw new AdapterError("NOT_FOUND", `Variant ${variantId} not found`);
    const [{ productVariant }, { currency }] = await Promise.all([
      this.client.request<{ productVariant: { product: RawProduct } | null }>(Q.VARIANT_PRODUCT, { id: variantId }),
      this.shop(),
    ]);
    if (!productVariant) throw new AdapterError("NOT_FOUND", `Variant ${variantId} not found`);
    return mapProduct(productVariant.product, currency);
  }

  async updateStock(variantId: string, qty: number): Promise<Product> {
    await this.need("inventory.write");
    const quantity = parseInput(z.number().int().nonnegative(), qty);
    if (!isGid(variantId, "ProductVariant")) throw new AdapterError("NOT_FOUND", `Variant ${variantId} not found`);
    const { productVariant: v } = await this.client.request<{
      productVariant: {
        inventoryQuantity: number | null;
        inventoryItem: {
          id: string;
          tracked: boolean;
          inventoryLevels: { nodes: { location: { id: string; isActive: boolean }; quantities: { name: string; quantity: number }[] }[] };
        };
      } | null;
    }>(Q.VARIANT_INVENTORY, { id: variantId });
    if (!v) throw new AdapterError("NOT_FOUND", `Variant ${variantId} not found`);
    if (!v.inventoryItem.tracked) throw new AdapterError("VALIDATION", "Shopify does not track stock for this variant.");

    const levels = v.inventoryItem.inventoryLevels.nodes
      .filter((l) => l.location.isActive)
      .map((l) => ({ locationId: l.location.id, available: l.quantities.find((q) => q.name === "available")?.quantity ?? 0 }));
    const [first] = levels;
    if (!first) throw new AdapterError("VALIDATION", "This variant is not stocked at any active location.");
    const total = levels.reduce((sum, l) => sum + l.available, 0);
    // Apply the whole change at the first location, so the total becomes `quantity`.
    const target = first.available + (quantity - total);
    if (target < 0) throw new AdapterError("VALIDATION", "Stock is split across locations; change it in Shopify admin.");

    const data = await this.client.request<{ inventorySetQuantities: { userErrors: { code: string | null; message: string }[] } }>(
      Q.INVENTORY_SET,
      {
        key: randomUUID(),
        input: {
          name: "available",
          reason: "correction",
          referenceDocumentUri: "store-ops://agent/update_stock",
          quantities: [{ inventoryItemId: v.inventoryItem.id, locationId: first.locationId, quantity: target, changeFromQuantity: first.available }],
        },
      },
    );
    const errors = data.inventorySetQuantities.userErrors;
    if (errors.length) {
      const changed = errors.some((e) => /CHANGE_FROM|COMPARE/i.test(e.code ?? ""));
      throw new AdapterError(changed ? "CONFLICT" : "VALIDATION", errors.map((e) => e.message).join("; "));
    }
    return this.getProductByVariant(variantId);
  }

  // ---- Coupons --------------------------------------------------------------------

  async listCoupons(): Promise<Coupon[]> {
    await this.need("coupons");
    const { currency } = await this.shop();
    const coupons: Coupon[] = [];
    let after: string | null = null;
    for (let page = 0; page < (this.options.maxScanPages ?? 50); page++) {
      const { discountNodes }: {
        discountNodes: { nodes: { id: string; discount: RawDiscount }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
      } = await this.client.request(Q.DISCOUNTS, { first: 100, after });
      for (const n of discountNodes.nodes) {
        const coupon = mapCoupon(n.id, n.discount, currency);
        if (coupon) coupons.push(coupon);
      }
      if (!discountNodes.pageInfo.hasNextPage) break;
      after = discountNodes.pageInfo.endCursor;
    }
    return coupons;
  }

  async createCoupon(input: CreateCouponInput): Promise<Coupon> {
    await this.need("coupons.write");
    const c = parseInput(CreateCouponInput, input);
    const { currency } = await this.shop();
    const code = c.code.toUpperCase();
    const data = await this.client.request<{
      discountCodeBasicCreate: {
        codeDiscountNode: { id: string; codeDiscount: RawDiscount } | null;
        userErrors: { code: string | null; field: string[] | null; message: string }[];
      };
    }>(Q.DISCOUNT_CREATE, {
      input: {
        title: code,
        code,
        startsAt: c.startsAt ?? new Date().toISOString(),
        endsAt: c.endsAt ?? null,
        usageLimit: c.usageLimit ?? null,
        customerGets: {
          value:
            c.type === "percent"
              ? { percentage: c.value / 100 }
              : { discountAmount: { amount: fromMinorUnits(c.value, currency), appliesOnEachItem: false } },
          items: { all: true },
        },
      },
    });
    const { codeDiscountNode, userErrors } = data.discountCodeBasicCreate;
    if (userErrors.length) {
      const taken = userErrors.some((e) => ["TAKEN", "DUPLICATE", "IMPLICIT_DUPLICATE"].includes(e.code ?? ""));
      throw new AdapterError(taken ? "CONFLICT" : "VALIDATION", userErrors.map((e) => e.message).join("; "));
    }
    const coupon = codeDiscountNode && mapCoupon(codeDiscountNode.id, codeDiscountNode.codeDiscount, currency);
    if (!coupon) throw new AdapterError("INVALID_RESPONSE", "Shopify did not return the new discount");
    return coupon;
  }

  // ---- Reviews: not in Shopify's API -----------------------------------------------

  async listReviews(): Promise<Page<Review>> {
    throw new AdapterError("UNSUPPORTED", "Shopify has no reviews API; reviews live in a separate app.");
  }

  async replyToReview(): Promise<Review> {
    throw new AdapterError("UNSUPPORTED", "Shopify has no reviews API; reviews live in a separate app.");
  }

  // ---- Sales -----------------------------------------------------------------------

  async salesSummary(from: string, to: string): Promise<SalesSummary> {
    await this.need("orders");
    const iso = z.iso.datetime({ offset: false });
    parseInput(iso, from);
    parseInput(iso, to);
    if (to <= from) throw new AdapterError("VALIDATION", "to must be after from");
    const { currency } = await this.shop();

    const orders: Order[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.listOrders({ createdFrom: from, createdTo: to, limit: 100, cursor });
      orders.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    const counted = orders.filter((o) => o.status !== "cancelled" && o.status !== "refunded");
    const gross = counted.reduce((sum, o) => sum + o.total.amount, 0);
    const byProduct = new Map<string, { title: string; quantity: number; revenue: number }>();
    for (const o of counted) {
      for (const li of o.lineItems) {
        const entry = byProduct.get(li.productId) ?? { title: li.title, quantity: 0, revenue: 0 };
        entry.quantity += li.quantity;
        entry.revenue += li.quantity * li.unitPrice.amount;
        byProduct.set(li.productId, entry);
      }
    }
    return {
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      currency,
      orderCount: counted.length,
      grossSales: { amount: gross, currency },
      averageOrderValue: { amount: counted.length ? Math.round(gross / counted.length) : 0, currency },
      topProducts: [...byProduct.entries()]
        .sort(([a, x], [b, y]) => y.revenue - x.revenue || (a < b ? -1 : 1))
        .slice(0, 5)
        .map(([productId, p]) => ({ productId, title: p.title, quantity: p.quantity, revenue: { amount: p.revenue, currency } })),
    };
  }

  // ---- Webhooks ----------------------------------------------------------------------

  async subscribeWebhooks(events: WebhookEvent[]): Promise<void> {
    await this.need("webhooks");
    const uri = this.options.webhookUrl!;
    const { webhookSubscriptions } = await this.client.request<{ webhookSubscriptions: { nodes: { topic: string }[] } }>(Q.WEBHOOKS, { uri });
    const existing = new Set(webhookSubscriptions.nodes.map((w) => w.topic));
    const topics = new Set(["APP_UNINSTALLED", ...events.map((e) => WEBHOOK_TOPICS[e]).filter((t): t is string => Boolean(t))]);
    for (const topic of topics) {
      if (!existing.has(topic)) await this.mutate(Q.WEBHOOK_CREATE, { topic, uri }, "webhookSubscriptionCreate");
    }
  }

  async close(): Promise<void> {
    // HTTP only; nothing to release.
  }

  // ---- Helpers -------------------------------------------------------------------------

  /** Runs a mutation and turns its userErrors into a VALIDATION error. */
  private async mutate(document: string, variables: Record<string, unknown>, field: string): Promise<void> {
    const data = await this.client.request<Record<string, { userErrors?: { message: string }[] } | null>>(document, variables);
    const errors = data[field]?.userErrors ?? [];
    if (errors.length) throw new AdapterError("VALIDATION", errors.map((e) => e.message).join("; "));
  }

  /**
   * Pages through a connection. When `filterHere` is set, Shopify cannot apply
   * the filter, so pages are scanned until `limit` matches are found; the
   * cursor of the last returned item lets the next call continue from there.
   */
  private async scan<Raw, Item>(
    document: string,
    field: string,
    query: string,
    cursor: string | undefined,
    limit: number,
    map: (raw: Raw) => Item,
    keep: (item: Item) => boolean,
    filterHere: boolean,
  ): Promise<Page<Item>> {
    const items: Item[] = [];
    let after: string | null = cursor ?? null;
    const maxPages = filterHere ? (this.options.maxScanPages ?? 50) : 1;
    for (let page = 0; page < maxPages; page++) {
      const data = await this.client.request<Record<string, { edges: Edge<Raw>[]; pageInfo: { hasNextPage: boolean } }>>(document, {
        first: filterHere ? 100 : limit,
        after,
        query: query || null,
      });
      const { edges, pageInfo } = data[field]!;
      for (const [i, edge] of edges.entries()) {
        const item = map(edge.node);
        if (!keep(item)) continue;
        items.push(item);
        if (items.length === limit) {
          const more = i < edges.length - 1 || pageInfo.hasNextPage;
          return { items, nextCursor: more ? edge.cursor : null };
        }
      }
      if (!pageInfo.hasNextPage) return { items, nextCursor: null };
      after = edges.at(-1)?.cursor ?? null;
    }
    // Scan budget spent: hand back what we have and where to resume.
    return { items, nextCursor: after };
  }
}

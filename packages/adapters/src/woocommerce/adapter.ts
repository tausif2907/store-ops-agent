import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  CreateCouponInput,
  OrderFilter,
  OrderStatus,
  ProductFilter,
  ReviewFilter,
  type Capability,
  type Coupon,
  type Order,
  type Page,
  type Product,
  type ProductVariant,
  type Review,
  type SalesSummary,
  type WebhookEvent,
} from "@store-ops/shared";
import { AdapterError, type StoreAdapter } from "../adapter";
import { fromMinorUnits, toMinorUnits } from "../shopify/mappers";
import { parseInput } from "../validation";
import { WooClient, type WooClientOptions, type WooCredentials } from "./client";

/**
 * Adapter for WooCommerce stores over the REST API (wc/v3), authenticated
 * with REST API keys.
 *
 * Mapping notes (see DECISIONS.md):
 * - WooCommerce statuses: pending/on-hold → pending, processing → processing
 *   (or ready, via the store_ops_status meta), completed → shipped (or
 *   delivered, via the meta), cancelled/failed → cancelled, refunded.
 *   Cancelling and refunding stay in WooCommerce admin.
 * - The promised date is the store_ops_promised_at order meta.
 * - Every product is listed with its variations; a simple product is its own
 *   single variant.
 * - Reviews are read-only here: WooCommerce's API cannot post a reply. Replies
 *   made in wp-admin are read from WordPress's public comments endpoint.
 */

export interface WooAdapterOptions extends WooClientOptions {
  /** Where WooCommerce should deliver webhooks for this store. */
  webhookUrl?: string;
  /** Called when the adapter creates a webhook secret, so it can be stored. */
  onCredentialsChange?: (credentials: WooCredentials) => Promise<void> | void;
  maxScanPages?: number;
}

interface RawOrder {
  id: number;
  number: string;
  status: string;
  currency: string;
  date_created_gmt: string;
  date_modified_gmt: string;
  total: string;
  customer_id: number;
  customer_note: string;
  billing: { first_name: string; last_name: string; email: string; phone: string };
  meta_data: { key: string; value: unknown }[];
  line_items: { name: string; product_id: number; variation_id: number; quantity: number; subtotal: string }[];
}

interface RawProduct {
  id: number;
  name: string;
  status: string;
  type: string;
  date_modified_gmt: string;
  sku: string;
  price: string;
  regular_price: string;
  manage_stock: boolean;
  stock_quantity: number | null;
  variations: number[];
}

interface RawVariation {
  id: number;
  parent_id: number;
  name?: string;
  attributes: { name: string; option: string }[];
  sku: string;
  price: string;
  regular_price: string;
  manage_stock: boolean | "parent";
  stock_quantity: number | null;
}

interface RawCoupon {
  id: number;
  code: string;
  status: string;
  discount_type: string;
  amount: string;
  usage_count: number;
  usage_limit: number | null;
  date_created_gmt: string;
  date_expires_gmt: string | null;
}

interface RawReview {
  id: number;
  product_id: number;
  rating: number;
  reviewer: string;
  review: string;
  date_created_gmt: string;
  status: string;
}

const OPS_STATUS = "store_ops_status";
const PROMISED_AT = "store_ops_promised_at";
const CLOSED: OrderStatus[] = ["delivered", "cancelled", "refunded"];
const WEBHOOK_TOPICS: Partial<Record<WebhookEvent, string>> = {
  "order.created": "order.created",
  "order.updated": "order.updated",
  "product.low_stock": "product.updated",
};

/** WooCommerce GMT timestamps carry no zone marker. */
function gmt(value: string | null | undefined): string | null {
  return value ? new Date(`${value.replace(/Z$/, "")}Z`).toISOString() : null;
}

function meta(o: Pick<RawOrder, "meta_data">, key: string): string | null {
  const value = o.meta_data.find((m) => m.key === key)?.value;
  return typeof value === "string" && value !== "" ? value : null;
}

/** Review text arrives as HTML. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " })[e as string]!)
    .trim();
}

export function orderStatus(o: Pick<RawOrder, "status" | "meta_data">): OrderStatus {
  const ops = meta(o, OPS_STATUS);
  switch (o.status) {
    case "cancelled":
    case "failed":
      return "cancelled";
    case "refunded":
      return "refunded";
    case "completed":
      return ops === "delivered" ? "delivered" : "shipped";
    case "processing":
      return ops === "ready" ? "ready" : "processing";
    default:
      return "pending"; // pending, on-hold, checkout-draft
  }
}

export function mapOrder(o: RawOrder): Order {
  const currency = o.currency;
  return {
    id: String(o.id),
    number: o.number,
    status: orderStatus(o),
    platformStatus: o.status,
    customer: {
      id: o.customer_id ? String(o.customer_id) : `guest:${o.billing.email}`,
      name: `${o.billing.first_name} ${o.billing.last_name}`.trim() || "Guest",
      email: o.billing.email || null,
      phone: o.billing.phone || null,
    },
    lineItems: o.line_items.map((li) => ({
      productId: String(li.product_id),
      variantId: li.variation_id ? String(li.variation_id) : null,
      title: li.name,
      quantity: li.quantity,
      unitPrice: { amount: Math.round(toMinorUnits(li.subtotal, currency) / li.quantity), currency },
    })),
    total: { amount: toMinorUnits(o.total, currency), currency },
    note: o.customer_note || null,
    createdAt: gmt(o.date_created_gmt)!,
    updatedAt: gmt(o.date_modified_gmt)!,
    promisedAt: gmt(meta(o, PROMISED_AT)),
  };
}

function variantTitle(v: RawVariation): string {
  return v.attributes.map((a) => a.option).join(" / ") || v.name || "Default";
}

function mapVariant(v: RawVariation, currency: string): ProductVariant {
  return {
    id: String(v.id),
    title: variantTitle(v),
    sku: v.sku || null,
    price: { amount: toMinorUnits(v.price || v.regular_price || "0", currency), currency },
    stock: v.manage_stock === true ? (v.stock_quantity ?? 0) : null,
  };
}

function productStatus(status: string): Product["status"] {
  return status === "publish" ? "active" : status === "private" ? "archived" : "draft";
}

export function mapCoupon(c: RawCoupon, currency: string): Coupon | null {
  if (c.discount_type !== "percent" && c.discount_type !== "fixed_cart") return null;
  const type = c.discount_type === "percent" ? "percent" : "fixed";
  const endsAt = gmt(c.date_expires_gmt);
  return {
    id: String(c.id),
    code: c.code.toUpperCase(),
    type,
    value: type === "percent" ? Math.round(Number(c.amount)) : toMinorUnits(c.amount, currency),
    currency: type === "fixed" ? currency : null,
    usageCount: c.usage_count,
    usageLimit: c.usage_limit || null,
    startsAt: null, // WooCommerce coupons have no start date
    endsAt,
    active: c.status === "publish" && (!endsAt || Date.parse(endsAt) > Date.now()) && (!c.usage_limit || c.usage_count < c.usage_limit),
  };
}

const numericId = (id: string) => /^\d+$/.test(id);

export class WooAdapter implements StoreAdapter {
  readonly platform = "WOOCOMMERCE" as const;
  private readonly client: WooClient;
  private currency: Promise<string> | null = null;

  constructor(
    credentials: WooCredentials,
    private readonly options: WooAdapterOptions = {},
  ) {
    this.client = new WooClient(credentials, options);
  }

  async capabilities(): Promise<Capability[]> {
    const caps: Capability[] = ["orders", "orders.write", "inventory", "inventory.write", "coupons", "coupons.write", "reviews"];
    if (this.options.webhookUrl) caps.push("webhooks");
    return caps;
  }

  /** The store's currency, from its settings. */
  storeCurrency(): Promise<string> {
    this.currency ??= this.client
      .request<{ id: string; value: string }>("GET", "/settings/general/woocommerce_currency")
      .then((r) => r.data.value);
    return this.currency;
  }

  // ---- Orders ---------------------------------------------------------------

  async listOrders(filter: OrderFilter = {}): Promise<Page<Order>> {
    const f = parseInput(OrderFilter, filter);
    const now = Date.now();
    const query: Record<string, string | number | boolean | undefined> = {
      orderby: "date",
      order: "desc",
      dates_are_gmt: true,
      search: f.query,
      // WooCommerce's "after" is exclusive; ask from a second earlier and filter exactly here.
      after: f.createdFrom ? new Date(Date.parse(f.createdFrom) - 1000).toISOString().replace(/\.\d+Z$/, "") : undefined,
      before: f.createdTo ? f.createdTo.replace(/\.\d+Z$/, "").replace(/Z$/, "") : undefined,
      status: f.status ? wooStatusesFor(f.status) : undefined,
    };
    const keep = (o: Order) =>
      (!f.status || o.status === f.status) &&
      (!f.createdFrom || o.createdAt >= f.createdFrom) &&
      (!f.createdTo || o.createdAt < f.createdTo) &&
      (!f.overdue || (o.promisedAt !== null && Date.parse(o.promisedAt) < now && !CLOSED.includes(o.status)));
    return this.scan<RawOrder, Order>("/orders", query, f.cursor, f.limit ?? 25, async (raws) => raws.map(mapOrder), keep, true);
  }

  async getOrder(id: string): Promise<Order> {
    if (!numericId(id)) throw new AdapterError("NOT_FOUND", `Order ${id} not found`);
    const { data } = await this.client.request<RawOrder>("GET", `/orders/${id}`);
    return mapOrder(data);
  }

  async updateOrderStatus(id: string, status: OrderStatus): Promise<Order> {
    const target = parseInput(OrderStatus, status);
    const current = await this.getOrder(id);
    if (current.status === target) return current;
    if (current.status === "cancelled" || current.status === "refunded") {
      throw new AdapterError("VALIDATION", `Order ${current.number} is ${current.status} and cannot change status.`);
    }
    if (target === "cancelled" || target === "refunded") {
      throw new AdapterError("VALIDATION", "Cancel or refund this order in WooCommerce admin: it moves money and stock.");
    }
    const [wooStatus, opsStatus] = {
      pending: ["pending", ""],
      processing: ["processing", ""],
      ready: ["processing", "ready"],
      shipped: ["completed", ""],
      delivered: ["completed", "delivered"],
    }[target]!;
    const { data } = await this.client.request<RawOrder>("PUT", `/orders/${id}`, {}, {
      status: wooStatus,
      meta_data: [{ key: OPS_STATUS, value: opsStatus }],
    });
    return mapOrder(data);
  }

  // ---- Products and stock -----------------------------------------------------

  async listProducts(filter: ProductFilter = {}): Promise<Page<Product>> {
    const f = parseInput(ProductFilter, filter);
    const q = f.query?.toLowerCase();
    const keep = (p: Product) =>
      (!q || p.title.toLowerCase().includes(q) || p.variants.some((v) => v.sku?.toLowerCase().includes(q))) &&
      (f.lowStockThreshold === undefined || p.variants.some((v) => v.stock !== null && v.stock <= f.lowStockThreshold!));
    return this.scan<RawProduct, Product>(
      "/products",
      { orderby: "id", order: "asc", status: "any" },
      f.cursor,
      f.limit ?? 25,
      (raws) => this.withVariants(raws),
      keep,
      Boolean(q || f.lowStockThreshold !== undefined),
    );
  }

  async getProductByVariant(variantId: string): Promise<Product> {
    if (!numericId(variantId)) throw new AdapterError("NOT_FOUND", `Variant ${variantId} not found`);
    const { data: variations } = await this.client.request<RawVariation[]>("GET", "/variations", { include: variantId, per_page: 1 });
    const parentId = variations[0]?.parent_id;
    const { data } = await this.client.request<RawProduct>("GET", `/products/${parentId ?? variantId}`);
    // A simple product is its own variant; anything else that is not a variation's parent is not a variant.
    if (!parentId && data.type !== "simple") throw new AdapterError("NOT_FOUND", `Variant ${variantId} not found`);
    const [product] = await this.withVariants([data]);
    return product!;
  }

  async updateStock(variantId: string, qty: number): Promise<Product> {
    const quantity = parseInput(z.number().int().nonnegative(), qty);
    const product = await this.getProductByVariant(variantId);
    const variant = product.variants.find((v) => v.id === variantId)!;
    if (variant.stock === null) throw new AdapterError("VALIDATION", "WooCommerce does not track stock for this variant.");
    const path = product.id === variantId ? `/products/${variantId}` : `/products/${product.id}/variations/${variantId}`;
    await this.client.request("PUT", path, {}, { stock_quantity: quantity });
    return this.getProductByVariant(variantId);
  }

  // ---- Coupons ------------------------------------------------------------------

  async listCoupons(): Promise<Coupon[]> {
    const currency = await this.storeCurrency();
    const coupons: Coupon[] = [];
    for (let page = 1; page <= (this.options.maxScanPages ?? 50); page++) {
      const { data, totalPages } = await this.client.request<RawCoupon[]>("GET", "/coupons", { per_page: 100, page, orderby: "date", order: "desc" });
      for (const c of data) {
        const coupon = mapCoupon(c, currency);
        if (coupon) coupons.push(coupon);
      }
      if (!totalPages || page >= totalPages) break;
    }
    return coupons;
  }

  async createCoupon(input: CreateCouponInput): Promise<Coupon> {
    const c = parseInput(CreateCouponInput, input);
    if (c.startsAt && Date.parse(c.startsAt) > Date.now()) {
      throw new AdapterError("VALIDATION", "WooCommerce coupons cannot start in the future.");
    }
    const currency = await this.storeCurrency();
    const { data } = await this.client.request<RawCoupon>("POST", "/coupons", {}, {
      code: c.code.toLowerCase(),
      discount_type: c.type === "percent" ? "percent" : "fixed_cart",
      amount: c.type === "percent" ? String(c.value) : fromMinorUnits(c.value, currency),
      usage_limit: c.usageLimit ?? null,
      date_expires_gmt: c.endsAt ? c.endsAt.replace(/\.\d+Z$/, "").replace(/Z$/, "") : null,
      status: "publish",
    });
    const coupon = mapCoupon(data, currency);
    if (!coupon) throw new AdapterError("INVALID_RESPONSE", "WooCommerce returned an unexpected coupon");
    return coupon;
  }

  // ---- Reviews --------------------------------------------------------------------

  async listReviews(filter: ReviewFilter = {}): Promise<Page<Review>> {
    const f = parseInput(ReviewFilter, filter);
    const keep = (r: Review) =>
      (f.minRating === undefined || r.rating >= f.minRating) &&
      (f.maxRating === undefined || r.rating <= f.maxRating) &&
      (!f.unreplied || r.reply === null) &&
      (!f.since || r.createdAt >= f.since);
    return this.scan<RawReview, Review>(
      "/products/reviews",
      { orderby: "date_gmt", order: "desc", product: f.productId },
      f.cursor,
      f.limit ?? 25,
      (raws) => this.withReplies(raws),
      keep,
      f.minRating !== undefined || f.maxRating !== undefined || Boolean(f.unreplied || f.since),
    );
  }

  async replyToReview(): Promise<Review> {
    throw new AdapterError("UNSUPPORTED", "WooCommerce's API cannot post review replies; reply in wp-admin.");
  }

  // ---- Sales --------------------------------------------------------------------------

  async salesSummary(from: string, to: string): Promise<SalesSummary> {
    const iso = z.iso.datetime({ offset: false });
    parseInput(iso, from);
    parseInput(iso, to);
    if (to <= from) throw new AdapterError("VALIDATION", "to must be after from");
    const currency = await this.storeCurrency();
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
        const entry = byProduct.get(li.productId) ?? { title: li.title.split(" - ")[0]!, quantity: 0, revenue: 0 };
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

  // ---- Webhooks --------------------------------------------------------------------------

  /**
   * Subscribes WooCommerce webhooks to this store's delivery URL. WooCommerce
   * signs each delivery with a secret; it is created here once and reported
   * through onCredentialsChange so the receiver can verify deliveries.
   */
  async subscribeWebhooks(events: WebhookEvent[]): Promise<void> {
    const url = this.options.webhookUrl;
    if (!url) throw new AdapterError("UNSUPPORTED", "No webhook URL is configured for this store.");
    let credentials = this.client.credentials;
    if (!credentials.webhookSecret) {
      credentials = { ...credentials, webhookSecret: randomBytes(32).toString("base64url") };
      await this.options.onCredentialsChange?.(credentials);
    }
    const { data: existing } = await this.client.request<{ topic: string; delivery_url: string; status: string }[]>("GET", "/webhooks", { per_page: 100 });
    const have = new Set(existing.filter((w) => w.delivery_url === url && w.status === "active").map((w) => w.topic));
    for (const topic of new Set(events.map((e) => WEBHOOK_TOPICS[e]).filter((t): t is string => Boolean(t)))) {
      if (have.has(topic)) continue;
      await this.client.request("POST", "/webhooks", {}, {
        name: `Store Ops Agent: ${topic}`,
        topic,
        delivery_url: url,
        secret: credentials.webhookSecret,
        status: "active",
      });
    }
  }

  async close(): Promise<void> {
    // HTTP only; nothing to release.
  }

  // ---- Helpers ------------------------------------------------------------------------------

  private async withVariants(raws: RawProduct[]): Promise<Product[]> {
    const currency = await this.storeCurrency();
    const parents = raws.filter((p) => p.type === "variable" && p.variations.length > 0).map((p) => p.id);
    const variations = new Map<number, RawVariation[]>();
    for (let page = 1; parents.length > 0; page++) {
      const { data, totalPages } = await this.client.request<RawVariation[]>("GET", "/variations", {
        parent: parents.join(","),
        per_page: 100,
        page,
        orderby: "id",
        order: "asc",
      });
      for (const v of data) variations.set(v.parent_id, [...(variations.get(v.parent_id) ?? []), v]);
      if (!totalPages || page >= totalPages) break;
    }
    return raws.map((p) => {
      const own: RawVariation[] =
        p.type === "variable"
          ? (variations.get(p.id) ?? []).sort((a, b) => p.variations.indexOf(a.id) - p.variations.indexOf(b.id))
          : [{ id: p.id, parent_id: 0, name: "Default", attributes: [], sku: p.sku, price: p.price, regular_price: p.regular_price, manage_stock: p.manage_stock, stock_quantity: p.stock_quantity }];
      return {
        id: String(p.id),
        title: p.name,
        status: productStatus(p.status),
        variants: own.map((v) => mapVariant(v, currency)),
        updatedAt: gmt(p.date_modified_gmt)!,
      };
    });
  }

  /** Owner replies are WordPress comments under the review, readable without keys. */
  private async withReplies(raws: RawReview[]): Promise<Review[]> {
    const reviews = raws.filter((r) => r.rating >= 1 && r.rating <= 5);
    const replies = new Map<number, { body: string; createdAt: string }>();
    if (reviews.length) {
      const url = new URL(`${this.client.credentials.url}/wp-json/wp/v2/comments`);
      url.searchParams.set("parent", reviews.map((r) => r.id).join(","));
      url.searchParams.set("per_page", "100");
      url.searchParams.set("orderby", "date");
      url.searchParams.set("order", "asc");
      const res = await (this.options.fetch ?? fetch)(url);
      if (res.ok) {
        for (const c of (await res.json()) as { parent: number; date_gmt: string; content: { rendered: string } }[]) {
          if (!replies.has(c.parent)) replies.set(c.parent, { body: htmlToText(c.content.rendered), createdAt: gmt(c.date_gmt)! });
        }
      }
    }
    return reviews.map((r) => ({
      id: String(r.id),
      productId: String(r.product_id),
      orderId: null,
      rating: r.rating,
      title: null,
      body: htmlToText(r.review),
      author: r.reviewer,
      createdAt: gmt(r.date_created_gmt)!,
      reply: replies.get(r.id) ?? null,
    }));
  }

  /**
   * Pages through a list endpoint. Cursors are "<perPage>:<page>:<index>" so a
   * page resumes exactly after the last item returned, even when some items
   * were filtered out here.
   */
  private async scan<Raw, Item extends { id: string }>(
    path: string,
    query: Record<string, string | number | boolean | undefined>,
    cursor: string | undefined,
    limit: number,
    map: (raws: Raw[]) => Promise<Item[]>,
    keep: (item: Item) => boolean,
    filterHere: boolean,
  ): Promise<Page<Item>> {
    let [perPage, page, start] = [filterHere ? 100 : limit, 1, 0];
    if (cursor) {
      const parts = cursor.split(":").map(Number);
      if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n) || n < 0)) throw new AdapterError("VALIDATION", "Invalid cursor");
      [perPage, page, start] = parts as [number, number, number];
    }
    const items: Item[] = [];
    const maxPages = filterHere ? (this.options.maxScanPages ?? 50) : 1;
    for (let scanned = 0; scanned < maxPages; scanned++, page++, start = 0) {
      const { data, totalPages } = await this.client.request<Raw[]>("GET", path, { ...query, per_page: perPage, page });
      const mapped = await map(data);
      for (let i = start; i < data.length; i++) {
        // `map` may drop items (e.g. review replies), so find each by position.
        const item = mapped.find((m) => m.id === String((data[i] as { id: number }).id));
        if (!item || !keep(item)) continue;
        items.push(item);
        if (items.length === limit) {
          const more = i < data.length - 1 || (totalPages ?? 0) > page;
          return { items, nextCursor: more ? `${perPage}:${i + 1 < data.length ? page : page + 1}:${i + 1 < data.length ? i + 1 : 0}` : null };
        }
      }
      if (!totalPages || page >= totalPages) return { items, nextCursor: null };
    }
    return { items, nextCursor: `${perPage}:${page}:0` };
  }
}

/** WooCommerce statuses that can map to a normalised status (narrowed here further). */
function wooStatusesFor(status: OrderStatus): string {
  return {
    pending: "pending,on-hold,checkout-draft",
    processing: "processing",
    ready: "processing",
    shipped: "completed",
    delivered: "completed",
    cancelled: "cancelled,failed",
    refunded: "refunded",
  }[status];
}

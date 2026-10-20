/**
 * Sample implementation of the Store Ops connector API (v1).
 *
 * A custom-built store implements these endpoints over its own database; this
 * sample keeps the store in memory so it is easy to read and to test against.
 * Swap the `Store` class for queries against your tables. Everything else
 * (auth, routing, errors, paging) carries over.
 *
 * Spec: GET /connector/openapi.json on the dashboard, or buildConnectorSpec()
 * in packages/adapters/src/custom-rest/spec.ts.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  CreateCouponInput,
  OrderFilter,
  ProductFilter,
  ReviewFilter,
  type Coupon,
  type Order,
  type OrderStatus,
  type Page,
  type Product,
  type Review,
  type SalesSummary,
} from "@store-ops/shared";
import { orderTotalPaise, promisedAtIso, variantOf, type Dataset } from "@store-ops/adapters/dataset";

// ---- Errors ---------------------------------------------------------------------

type ErrorCode = "NOT_FOUND" | "CONFLICT" | "VALIDATION" | "UNSUPPORTED" | "AUTH" | "RATE_LIMITED";
const STATUS: Record<ErrorCode, number> = { NOT_FOUND: 404, CONFLICT: 409, VALIDATION: 422, UNSUPPORTED: 501, AUTH: 401, RATE_LIMITED: 429 };

class ConnectorError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function parse<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new ConnectorError("VALIDATION", result.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "));
  return result.data;
}

/** Offset paging. Cursors are opaque to the platform; an offset is the simplest valid choice. */
function page<T>(items: T[], limit = 25, cursor?: string): Page<T> {
  const start = cursor ? Number(cursor) : 0;
  if (!Number.isInteger(start) || start < 0) throw new ConnectorError("VALIDATION", "Invalid cursor");
  const end = start + limit;
  return { items: items.slice(start, end), nextCursor: end < items.length ? String(end) : null };
}

// ---- The store (replace with your database) -----------------------------------------

const CLOSED: OrderStatus[] = ["delivered", "cancelled", "refunded"];

export class Store {
  orders: Order[] = [];
  products: Product[] = [];
  coupons: Coupon[] = [];
  reviews: Review[] = [];

  constructor(dataset: Dataset, currency = "INR") {
    const money = (amount: number) => ({ amount, currency });
    const iso = (d: Date) => d.toISOString();
    this.products = dataset.products.map((p) => ({
      id: p.key,
      title: p.title,
      status: p.status,
      variants: p.variants.map((v) => ({ id: v.key, title: v.title, sku: v.sku, price: money(v.pricePaise), stock: v.stock })),
      updatedAt: iso(new Date()),
    }));
    this.orders = dataset.orders
      .map((o): Order => {
        const c = dataset.customers.find((x) => x.key === o.customerKey)!;
        return {
          id: o.key,
          number: o.number,
          status: o.status,
          platformStatus: o.status,
          customer: { id: c.key, name: c.name, email: c.email, phone: c.phone },
          lineItems: o.items.map((i) => {
            const product = dataset.products.find((p) => p.key === i.productKey)!;
            const variant = variantOf(dataset, i.productKey, i.variantKey);
            return { productId: product.key, variantId: variant.key, title: `${product.title} (${variant.title})`, quantity: i.quantity, unitPrice: money(variant.pricePaise) };
          }),
          total: money(orderTotalPaise(dataset, o)),
          note: o.note,
          createdAt: iso(o.createdAt),
          updatedAt: iso(o.createdAt),
          promisedAt: o.promisedDate ? promisedAtIso(o.promisedDate) : null,
        };
      })
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1));
    this.coupons = dataset.coupons.map((c, i) => ({
      id: `cpn${i + 1}`,
      code: c.code,
      type: c.type,
      value: c.value,
      currency: c.type === "fixed" ? currency : null,
      usageCount: c.usageCount,
      usageLimit: c.usageLimit,
      startsAt: c.startsAt ? iso(c.startsAt) : null,
      endsAt: c.endsAt ? iso(c.endsAt) : null,
      active: c.active,
    }));
    this.reviews = dataset.reviews
      .map((r): Review => ({
        id: r.key,
        productId: r.productKey,
        orderId: r.orderKey,
        rating: r.rating,
        title: r.title,
        body: r.body,
        author: r.author,
        createdAt: iso(r.createdAt),
        reply: r.reply ? { body: r.reply, createdAt: iso(r.createdAt) } : null,
      }))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1));
  }

  /** A coupon is usable when switched on, not expired and not used up. */
  couponView(c: Coupon): Coupon {
    const live = (!c.endsAt || Date.parse(c.endsAt) > Date.now()) && (c.usageLimit === null || c.usageCount < c.usageLimit);
    return { ...c, active: c.active && live };
  }
}

// ---- Handlers ----------------------------------------------------------------------------

type Handler = (store: Store, params: string[], query: URLSearchParams, body: unknown) => unknown;

/** Query strings arrive as text; turn the typed fields into numbers and booleans. */
function queryObject(query: URLSearchParams, numbers: string[] = [], booleans: string[] = []) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of query) out[k] = numbers.includes(k) ? Number(v) : booleans.includes(k) ? v === "true" : v;
  return out;
}

function findOrder(store: Store, id: string) {
  const order = store.orders.find((o) => o.id === id);
  if (!order) throw new ConnectorError("NOT_FOUND", `Order ${id} not found`);
  return order;
}

function findVariant(store: Store, id: string) {
  const product = store.products.find((p) => p.variants.some((v) => v.id === id));
  if (!product) throw new ConnectorError("NOT_FOUND", `Variant ${id} not found`);
  return { product, variant: product.variants.find((v) => v.id === id)! };
}

const routes: [string, RegExp, Handler][] = [
  ["GET", /^\/capabilities$/, () => ({
    capabilities: ["orders", "orders.write", "inventory", "inventory.write", "coupons", "coupons.write", "reviews", "reviews.write"],
  })],

  ["GET", /^\/orders$/, (store, _p, query) => {
    const f = parse(OrderFilter, queryObject(query, ["limit"], ["overdue"]));
    const now = Date.now();
    const text = f.query?.toLowerCase();
    const matches = store.orders.filter(
      (o) =>
        (!f.status || o.status === f.status) &&
        (!f.createdFrom || o.createdAt >= f.createdFrom) &&
        (!f.createdTo || o.createdAt < f.createdTo) &&
        (!f.overdue || (o.promisedAt !== null && Date.parse(o.promisedAt) < now && !CLOSED.includes(o.status))) &&
        (!text || [o.number, o.customer.name, o.customer.email ?? ""].some((s) => s.toLowerCase().includes(text))),
    );
    return page(matches, f.limit, f.cursor);
  }],

  ["GET", /^\/orders\/([^/]+)$/, (store, [id]) => findOrder(store, id!)],

  ["POST", /^\/orders\/([^/]+)\/status$/, (store, [id], _q, body) => {
    const { status } = parse(z.object({ status: z.enum(["pending", "processing", "ready", "shipped", "delivered", "cancelled", "refunded"]) }), body);
    const order = findOrder(store, id!);
    if (order.status === status) return order;
    if (order.status === "cancelled" || order.status === "refunded") {
      throw new ConnectorError("VALIDATION", `Order ${order.number} is ${order.status} and cannot change status.`);
    }
    order.status = status;
    order.platformStatus = status;
    order.updatedAt = new Date().toISOString();
    return order;
  }],

  ["GET", /^\/products$/, (store, _p, query) => {
    const f = parse(ProductFilter, queryObject(query, ["limit", "lowStockThreshold"]));
    const text = f.query?.toLowerCase();
    const matches = [...store.products]
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .filter(
        (p) =>
          (!text || p.title.toLowerCase().includes(text) || p.variants.some((v) => v.sku?.toLowerCase().includes(text))) &&
          (f.lowStockThreshold === undefined || p.variants.some((v) => v.stock !== null && v.stock <= f.lowStockThreshold!)),
      );
    return page(matches, f.limit, f.cursor);
  }],

  ["GET", /^\/variants\/([^/]+)\/product$/, (store, [id]) => findVariant(store, id!).product],

  ["PUT", /^\/variants\/([^/]+)\/stock$/, (store, [id], _q, body) => {
    const { quantity } = parse(z.object({ quantity: z.number().int().nonnegative() }), body);
    const { product, variant } = findVariant(store, id!);
    variant.stock = quantity;
    product.updatedAt = new Date().toISOString();
    return product;
  }],

  ["GET", /^\/coupons$/, (store) => ({ items: store.coupons.map((c) => store.couponView(c)) })],

  ["POST", /^\/coupons$/, (store, _p, _q, body) => {
    const input = parse(CreateCouponInput, body);
    const code = input.code.toUpperCase();
    if (store.coupons.some((c) => c.code.toUpperCase() === code)) throw new ConnectorError("CONFLICT", `Coupon ${code} already exists`);
    const coupon: Coupon = {
      id: `cpn${store.coupons.length + 1}`,
      code,
      type: input.type,
      value: input.value,
      currency: input.type === "fixed" ? "INR" : null,
      usageCount: 0,
      usageLimit: input.usageLimit ?? null,
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
      active: true,
    };
    store.coupons.unshift(coupon);
    return [201, store.couponView(coupon)];
  }],

  ["GET", /^\/reviews$/, (store, _p, query) => {
    const f = parse(ReviewFilter, queryObject(query, ["limit", "minRating", "maxRating"], ["unreplied"]));
    const matches = store.reviews.filter(
      (r) =>
        (f.minRating === undefined || r.rating >= f.minRating) &&
        (f.maxRating === undefined || r.rating <= f.maxRating) &&
        (!f.unreplied || r.reply === null) &&
        (!f.since || r.createdAt >= f.since) &&
        (!f.productId || r.productId === f.productId),
    );
    return page(matches, f.limit, f.cursor);
  }],

  ["POST", /^\/reviews\/([^/]+)\/reply$/, (store, [id], _q, body) => {
    const { text } = parse(z.object({ text: z.string().trim().min(1).max(2000) }), body);
    const review = store.reviews.find((r) => r.id === id);
    if (!review) throw new ConnectorError("NOT_FOUND", `Review ${id} not found`);
    if (review.reply) throw new ConnectorError("CONFLICT", `Review ${id} already has a reply`);
    review.reply = { body: text, createdAt: new Date().toISOString() };
    return review;
  }],

  ["GET", /^\/sales-summary$/, (store, _p, query): SalesSummary => {
    const iso = z.iso.datetime({ offset: false });
    const { from, to } = parse(z.object({ from: iso, to: iso }), queryObject(query));
    if (to <= from) throw new ConnectorError("VALIDATION", "to must be after from");
    const counted = store.orders.filter((o) => o.createdAt >= from && o.createdAt < to && o.status !== "cancelled" && o.status !== "refunded");
    const gross = counted.reduce((s, o) => s + o.total.amount, 0);
    const byProduct = new Map<string, { quantity: number; revenue: number }>();
    for (const o of counted) {
      for (const li of o.lineItems) {
        const e = byProduct.get(li.productId) ?? { quantity: 0, revenue: 0 };
        e.quantity += li.quantity;
        e.revenue += li.quantity * li.unitPrice.amount;
        byProduct.set(li.productId, e);
      }
    }
    const money = (amount: number) => ({ amount, currency: "INR" });
    return {
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      currency: "INR",
      orderCount: counted.length,
      grossSales: money(gross),
      averageOrderValue: money(counted.length ? Math.round(gross / counted.length) : 0),
      topProducts: [...byProduct.entries()]
        .sort(([a, x], [b, y]) => y.revenue - x.revenue || (a < b ? -1 : 1))
        .slice(0, 5)
        .map(([productId, e]) => ({
          productId,
          title: store.products.find((p) => p.id === productId)?.title ?? productId,
          quantity: e.quantity,
          revenue: money(e.revenue),
        })),
    };
  }],
];

// ---- HTTP ---------------------------------------------------------------------------------

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

function sendError(res: ServerResponse, code: ErrorCode, message: string) {
  send(res, STATUS[code], { error: { code, message } });
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (!chunks.length) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ConnectorError("VALIDATION", "Body must be JSON");
  }
}

function authorized(header: string | undefined, apiKey: string): boolean {
  const given = Buffer.from(header?.replace(/^Bearer\s+/i, "") ?? "");
  const expected = Buffer.from(apiKey);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** An HTTP server for the connector API, mounted at `basePath` (default /store-ops/v1). */
export function createConnectorServer(options: { apiKey: string; store: Store; basePath?: string }): Server {
  const basePath = options.basePath ?? "/store-ops/v1";
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://connector");
    if (!url.pathname.startsWith(basePath)) return sendError(res, "NOT_FOUND", "Not found");
    if (!authorized(req.headers.authorization, options.apiKey)) return sendError(res, "AUTH", "Missing or wrong API key");

    const path = url.pathname.slice(basePath.length) || "/";
    const route = routes.find(([method, pattern]) => method === req.method && pattern.test(path));
    if (!route) return sendError(res, "NOT_FOUND", `No route for ${req.method} ${path}`);
    try {
      const params = path.match(route[1])!.slice(1).map(decodeURIComponent);
      const result = route[2](options.store, params, url.searchParams, await readBody(req));
      const [status, body] = Array.isArray(result) && typeof result[0] === "number" ? result : [200, result];
      send(res, status, body);
    } catch (err) {
      if (err instanceof ConnectorError) return sendError(res, err.code, err.message);
      console.error(err);
      send(res, 500, { error: { code: "UNAVAILABLE", message: "Internal error" } });
    }
  });
}

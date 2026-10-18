import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CAPABILITIES,
  Coupon,
  Order,
  Product,
  Review,
  SalesSummary,
  type Capability,
  type OrderFilter,
  type OrderStatus,
  type Page,
} from "@store-ops/shared";
import { isAdapterError, type AdapterErrorCode, type StoreAdapter } from "../adapter";
import { buildDataset, orderTotalPaise, type Dataset } from "./dataset";

/**
 * Adapter conformance suite. Every adapter runs the same tests against a test
 * store loaded with the canonical dataset; the pass condition is 100%.
 *
 * Usage (in a *.test.ts file):
 *   defineConformanceSuite({
 *     name: "supabase",
 *     reset: (dataset) => resetBoutique(ADMIN_URL, dataset),
 *     createAdapter: () => new SupabaseAdapter({ connectionString: AGENT_URL }),
 *   });
 */
export interface ConformanceOptions {
  name: string;
  /** Wipes the test store and loads `dataset` into it. */
  reset: (dataset: Dataset) => Promise<void>;
  createAdapter: () => StoreAdapter | Promise<StoreAdapter>;
  /** An id that is well-formed for this platform but does not exist. */
  missingId?: string;
}

const DAY = 86_400_000;
const CLOSED: OrderStatus[] = ["delivered", "cancelled", "refunded"];

async function expectAdapterError(promise: Promise<unknown>, code: AdapterErrorCode) {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught, `expected AdapterError ${code}`).toBeDefined();
  expect(isAdapterError(caught), `expected AdapterError ${code}, got ${String(caught)}`).toBe(true);
  expect((caught as { code: string }).code).toBe(code);
}

async function collect<T>(fetchPage: (cursor?: string) => Promise<Page<T>>, maxPages = 50): Promise<T[]> {
  const all: T[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    const page = await fetchPage(cursor);
    all.push(...page.items);
    if (!page.nextCursor) return all;
    cursor = page.nextCursor;
  }
  throw new Error(`Pagination did not finish within ${maxPages} pages`);
}

export function defineConformanceSuite(options: ConformanceOptions): void {
  const missingId = options.missingId ?? "999999999";

  describe(`adapter conformance: ${options.name}`, () => {
    const now = new Date();
    const dataset = buildDataset(now);
    let adapter: StoreAdapter;
    let caps: Set<Capability>;
    const has = (c: Capability) => caps.has(c);

    beforeAll(async () => {
      await options.reset(dataset);
      adapter = await options.createAdapter();
      caps = new Set(await adapter.capabilities());
    }, 120_000);

    afterAll(async () => {
      await adapter?.close();
    });

    // ---- capabilities --------------------------------------------------------

    it("declares known, unique capabilities", async () => {
      const list = await adapter.capabilities();
      expect(new Set(list).size).toBe(list.length);
      for (const c of list) expect(CAPABILITIES).toContain(c);
      // A write capability implies its read capability.
      for (const c of list) if (c.endsWith(".write")) expect(list).toContain(c.replace(".write", ""));
    });

    it("throws UNSUPPORTED for every missing capability", async () => {
      const checks: [Capability, () => Promise<unknown>][] = [
        ["orders", () => adapter.listOrders()],
        ["orders.write", () => adapter.updateOrderStatus(missingId, "processing")],
        ["inventory", () => adapter.listProducts()],
        ["inventory.write", () => adapter.updateStock(missingId, 1)],
        ["coupons", () => adapter.listCoupons()],
        ["coupons.write", () => adapter.createCoupon({ code: "NOPE10", type: "percent", value: 10 })],
        ["reviews", () => adapter.listReviews()],
        ["reviews.write", () => adapter.replyToReview(missingId, "Thanks")],
        ["webhooks", () => adapter.subscribeWebhooks(["order.created"])],
      ];
      for (const [cap, call] of checks) {
        if (!has(cap)) await expectAdapterError(call(), "UNSUPPORTED");
      }
    });

    // ---- reads (run before writes; the dataset is untouched here) -------------

    describe("orders", () => {
      it("returns valid orders, newest first, 25 by default", async (ctx) => {
        if (!has("orders")) return ctx.skip();
        const page = await adapter.listOrders();
        expect(page.items.length).toBe(25);
        for (const o of page.items) Order.parse(o);
        const times = page.items.map((o) => Date.parse(o.createdAt));
        expect([...times].sort((a, b) => b - a)).toEqual(times);
      });

      it("respects limit and paginates through every order exactly once", async (ctx) => {
        if (!has("orders")) return ctx.skip();
        const first = await adapter.listOrders({ limit: 7 });
        expect(first.items).toHaveLength(7);
        expect(first.nextCursor).not.toBeNull();
        const all = await collect((cursor) => adapter.listOrders({ limit: 50, cursor }));
        expect(all).toHaveLength(dataset.orders.length);
        expect(new Set(all.map((o) => o.id)).size).toBe(dataset.orders.length);
        expect(new Set(all.map((o) => o.number))).toEqual(new Set(dataset.orders.map((o) => o.number)));
      });

      it("filters by status", async (ctx) => {
        if (!has("orders")) return ctx.skip();
        for (const status of ["pending", "processing", "delivered", "cancelled"] as OrderStatus[]) {
          const found = await collect((cursor) => adapter.listOrders({ status, limit: 100, cursor }));
          expect(found.every((o) => o.status === status)).toBe(true);
          expect(found.length).toBe(dataset.orders.filter((o) => o.status === status).length);
        }
      });

      it("filters by creation time range [from, to)", async (ctx) => {
        if (!has("orders")) return ctx.skip();
        const from = new Date(now.getTime() - 30 * DAY).toISOString();
        const to = new Date(now.getTime() - 10 * DAY).toISOString();
        const found = await collect((cursor) => adapter.listOrders({ createdFrom: from, createdTo: to, limit: 100, cursor }));
        const expected = dataset.orders.filter((o) => o.createdAt.toISOString() >= from && o.createdAt.toISOString() < to);
        expect(found.length).toBe(expected.length);
        for (const o of found) {
          expect(o.createdAt >= from && o.createdAt < to).toBe(true);
        }
      });

      it("finds overdue orders", async (ctx) => {
        if (!has("orders")) return ctx.skip();
        const found = await collect((cursor) => adapter.listOrders({ overdue: true, limit: 100, cursor }));
        expect(found.length).toBeGreaterThan(0);
        for (const o of found) {
          expect(o.promisedAt).not.toBeNull();
          expect(Date.parse(o.promisedAt!)).toBeLessThan(Date.now());
          expect(CLOSED).not.toContain(o.status);
        }
      });

      it("searches by order number", async (ctx) => {
        if (!has("orders")) return ctx.skip();
        const target = dataset.orders[42]!;
        const page = await adapter.listOrders({ query: target.number });
        expect(page.items.map((o) => o.number)).toContain(target.number);
      });

      it("gets one order, with totals that match its line items", async (ctx) => {
        if (!has("orders")) return ctx.skip();
        const [listed] = (await adapter.listOrders({ limit: 1 })).items;
        const order = await adapter.getOrder(listed!.id);
        expect(order).toEqual(listed);
        const sum = order.lineItems.reduce((s, i) => s + i.quantity * i.unitPrice.amount, 0);
        expect(order.total.amount).toBe(sum);
        const source = dataset.orders.find((o) => o.number === order.number)!;
        expect(order.total.amount).toBe(orderTotalPaise(dataset, source));
      });

      it("rejects an unknown order with NOT_FOUND", async (ctx) => {
        if (!has("orders")) return ctx.skip();
        await expectAdapterError(adapter.getOrder(missingId), "NOT_FOUND");
      });

      it("rejects an invalid filter with VALIDATION", async (ctx) => {
        if (!has("orders")) return ctx.skip();
        await expectAdapterError(adapter.listOrders({ limit: 0 }), "VALIDATION");
        await expectAdapterError(adapter.listOrders({ status: "lost" } as unknown as OrderFilter), "VALIDATION");
      });

      it("summarises sales consistently with the orders", async (ctx) => {
        if (!has("orders")) return ctx.skip();
        const from = new Date(now.getTime() - 30 * DAY).toISOString();
        const to = now.toISOString();
        const summary = SalesSummary.parse(await adapter.salesSummary(from, to));
        const orders = (await collect((cursor) => adapter.listOrders({ createdFrom: from, createdTo: to, limit: 100, cursor })))
          .filter((o) => o.status !== "cancelled" && o.status !== "refunded");
        expect(summary.orderCount).toBe(orders.length);
        expect(summary.grossSales.amount).toBe(orders.reduce((s, o) => s + o.total.amount, 0));
        expect(summary.averageOrderValue.amount).toBe(orders.length ? Math.round(summary.grossSales.amount / orders.length) : 0);
        expect(summary.topProducts.length).toBeLessThanOrEqual(5);
        const revenues = summary.topProducts.map((p) => p.revenue.amount);
        expect([...revenues].sort((a, b) => b - a)).toEqual(revenues);
        await expectAdapterError(adapter.salesSummary(to, from), "VALIDATION");
      });
    });

    describe("inventory", () => {
      it("lists every product exactly once", async (ctx) => {
        if (!has("inventory")) return ctx.skip();
        const all = await collect((cursor) => adapter.listProducts({ limit: 20, cursor }));
        expect(all).toHaveLength(dataset.products.length);
        expect(new Set(all.map((p) => p.id)).size).toBe(dataset.products.length);
        for (const p of all) Product.parse(p);
      });

      it("finds low-stock products", async (ctx) => {
        if (!has("inventory")) return ctx.skip();
        const low = await collect((cursor) => adapter.listProducts({ lowStockThreshold: 3, limit: 100, cursor }));
        const expected = dataset.products.filter((p) => p.variants.some((v) => v.stock !== null && v.stock <= 3));
        expect(low.length).toBe(expected.length);
        for (const p of low) expect(p.variants.some((v) => v.stock !== null && v.stock <= 3)).toBe(true);
      });

      it("searches products by title", async (ctx) => {
        if (!has("inventory")) return ctx.skip();
        const found = await collect((cursor) => adapter.listProducts({ query: "sherwani", limit: 100, cursor }));
        expect(found.length).toBe(dataset.products.filter((p) => /sherwani/i.test(p.title)).length);
        for (const p of found) expect(p.title.toLowerCase()).toContain("sherwani");
      });
    });

    describe("coupons", () => {
      it("lists every coupon", async (ctx) => {
        if (!has("coupons")) return ctx.skip();
        const coupons = await adapter.listCoupons();
        expect(coupons).toHaveLength(dataset.coupons.length);
        for (const c of coupons) Coupon.parse(c);
        const welcome = coupons.find((c) => c.code === "WELCOME10")!;
        expect(welcome).toMatchObject({ type: "percent", value: 10, active: true });
        expect(coupons.find((c) => c.code === "DIWALI20")?.active).toBe(false); // expired
        expect(coupons.find((c) => c.code === "BRIDAL15")?.active).toBe(false); // used up
      });
    });

    describe("reviews", () => {
      it("lists every review exactly once, newest first", async (ctx) => {
        if (!has("reviews")) return ctx.skip();
        const all = await collect((cursor) => adapter.listReviews({ limit: 25, cursor }));
        expect(all).toHaveLength(dataset.reviews.length);
        expect(new Set(all.map((r) => r.id)).size).toBe(dataset.reviews.length);
        for (const r of all) Review.parse(r);
        const times = all.map((r) => Date.parse(r.createdAt));
        expect([...times].sort((a, b) => b - a)).toEqual(times);
      });

      it("filters unreplied negative reviews", async (ctx) => {
        if (!has("reviews")) return ctx.skip();
        const found = await collect((cursor) => adapter.listReviews({ maxRating: 2, unreplied: true, limit: 100, cursor }));
        expect(found.length).toBe(dataset.reviews.filter((r) => r.rating <= 2 && r.reply === null).length);
        expect(found.length).toBeGreaterThan(0);
        for (const r of found) {
          expect(r.rating).toBeLessThanOrEqual(2);
          expect(r.reply).toBeNull();
        }
      });
    });

    // ---- writes -----------------------------------------------------------------

    describe("writes", () => {
      it("updates an order's status", async (ctx) => {
        if (!has("orders.write")) return ctx.skip();
        const [pending] = (await adapter.listOrders({ status: "pending", limit: 1 })).items;
        expect(pending).toBeDefined();
        const updated = await adapter.updateOrderStatus(pending!.id, "processing");
        expect(updated.id).toBe(pending!.id);
        expect(updated.status).toBe("processing");
        expect(Date.parse(updated.updatedAt)).toBeGreaterThanOrEqual(Date.parse(pending!.updatedAt));
        expect((await adapter.getOrder(pending!.id)).status).toBe("processing");
        // Setting the same status again is a no-op, not an error.
        expect((await adapter.updateOrderStatus(pending!.id, "processing")).status).toBe("processing");
      });

      it("rejects bad status updates", async (ctx) => {
        if (!has("orders.write")) return ctx.skip();
        const [order] = (await adapter.listOrders({ limit: 1 })).items;
        await expectAdapterError(adapter.updateOrderStatus(order!.id, "lost" as OrderStatus), "VALIDATION");
        await expectAdapterError(adapter.updateOrderStatus(missingId, "processing"), "NOT_FOUND");
        const [cancelled] = (await adapter.listOrders({ status: "cancelled", limit: 1 })).items;
        await expectAdapterError(adapter.updateOrderStatus(cancelled!.id, "shipped"), "VALIDATION");
      });

      it("sets a variant's stock", async (ctx) => {
        if (!has("inventory.write")) return ctx.skip();
        const products = await collect((cursor) => adapter.listProducts({ limit: 100, cursor }));
        const variant = products.flatMap((p) => p.variants).find((v) => v.stock !== null)!;
        const product = await adapter.updateStock(variant.id, 17);
        expect(product.variants.find((v) => v.id === variant.id)?.stock).toBe(17);
        await expectAdapterError(adapter.updateStock(variant.id, -1), "VALIDATION");
        await expectAdapterError(adapter.updateStock(missingId, 5), "NOT_FOUND");
      });

      it("creates a coupon and refuses duplicates", async (ctx) => {
        if (!has("coupons.write")) return ctx.skip();
        const coupon = await adapter.createCoupon({ code: "CONFORM10", type: "percent", value: 10, usageLimit: 100 });
        expect(coupon).toMatchObject({ code: "CONFORM10", type: "percent", value: 10, usageLimit: 100, usageCount: 0, active: true });
        expect((await adapter.listCoupons()).map((c) => c.code)).toContain("CONFORM10");
        await expectAdapterError(adapter.createCoupon({ code: "CONFORM10", type: "percent", value: 5 }), "CONFLICT");
        await expectAdapterError(adapter.createCoupon({ code: "BAD", type: "percent", value: 0 }), "VALIDATION");
        await expectAdapterError(adapter.createCoupon({ code: "TOOMUCH", type: "percent", value: 150 }), "VALIDATION");
      });

      it("replies to a review once", async (ctx) => {
        if (!has("reviews.write")) return ctx.skip();
        const [review] = (await adapter.listReviews({ unreplied: true, maxRating: 2, limit: 1 })).items;
        const replied = await adapter.replyToReview(review!.id, "We're sorry — we'd like to fix this for you.");
        expect(replied.reply?.body).toBe("We're sorry — we'd like to fix this for you.");
        await expectAdapterError(adapter.replyToReview(review!.id, "Second reply"), "CONFLICT");
        await expectAdapterError(adapter.replyToReview(review!.id, "   "), "VALIDATION");
        await expectAdapterError(adapter.replyToReview(missingId, "Thanks"), "NOT_FOUND");
      });
    });
  });
}

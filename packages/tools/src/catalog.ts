import { z } from "zod";
import type { StoreAdapter } from "@store-ops/adapters";
import {
  CreateCouponInput,
  ORDER_STATUSES,
  PERIODS,
  periodRange,
  type Capability,
  type Order,
  type Product,
} from "@store-ops/shared";

/**
 * The twelve platform-neutral tools the agent can use. Every tool declares
 * its type, default policy and the capability the connected store needs.
 * Refunds, price changes, deletes and emailing customers are deliberately not
 * tools, so the agent cannot do them even by mistake.
 */

export type ToolType = "read" | "draft" | "write";
export type PolicyMode = "AUTO" | "ASK" | "NEVER";

export interface DraftToSave {
  kind: "CUSTOMER_MESSAGE" | "REVIEW_REPLY";
  targetId: string;
  targetLabel: string;
  recipient: { name: string; email: string | null; phone: string | null } | null;
  body: string;
}

export interface ToolContext {
  adapter: StoreAdapter;
  store: { id: string; name: string; currency: string; timezone: string };
  /** Saves a draft for the owner's inbox; returns its id. Absent outside a run. */
  saveDraft?: (draft: DraftToSave) => Promise<string>;
}

export interface ToolDefinition<S extends z.ZodObject = z.ZodObject> {
  name: string;
  description: string;
  type: ToolType;
  defaultMode: PolicyMode;
  capability: Capability | null;
  input: S;
  /** Results include text written by customers (notes, reviews). */
  untrustedText: boolean;
  /** One line an owner reads when approving the call. */
  summarize(input: z.infer<S>): string;
  run(input: z.infer<S>, ctx: ToolContext): Promise<unknown>;
}

function tool<S extends z.ZodObject>(def: ToolDefinition<S>): ToolDefinition<S> {
  return def;
}

const isoUtc = z.iso.datetime({ offset: false });
const id = (what: string) => z.string().min(1).describe(`The ${what} id, exactly as returned by another tool`);

function orderSummary(o: Order) {
  return {
    id: o.id,
    number: o.number,
    status: o.status,
    customer: o.customer.name,
    total: o.total,
    itemCount: o.lineItems.reduce((n, i) => n + i.quantity, 0),
    createdAt: o.createdAt,
    promisedAt: o.promisedAt,
    note: o.note,
  };
}

function lowStockView(p: Product, threshold: number) {
  return {
    id: p.id,
    title: p.title,
    status: p.status,
    lowVariants: p.variants
      .filter((v) => v.stock !== null && v.stock <= threshold)
      .map((v) => ({ id: v.id, title: v.title, sku: v.sku, stock: v.stock })),
  };
}

export const TOOLS = [
  tool({
    name: "search_orders",
    description:
      "Search the store's orders, newest first. Filter by status, creation time range, overdue (past the promised delivery date and not delivered/cancelled/refunded), or free text (order number, customer name or email). Returns compact summaries; use get_order for line items and contact details.",
    type: "read",
    defaultMode: "AUTO",
    capability: "orders",
    untrustedText: true,
    input: z.object({
      status: z.enum(ORDER_STATUSES).optional(),
      createdFrom: isoUtc.optional().describe("Inclusive lower bound, ISO 8601 UTC"),
      createdTo: isoUtc.optional().describe("Exclusive upper bound, ISO 8601 UTC"),
      overdue: z.boolean().optional(),
      query: z.string().optional(),
      limit: z.number().int().min(1).max(50).optional().describe("Default 10"),
      cursor: z.string().optional().describe("nextCursor from a previous call, for the next page"),
    }),
    summarize: () => "Search orders",
    async run(input, { adapter }) {
      const page = await adapter.listOrders({ ...input, limit: input.limit ?? 10 });
      return { orders: page.items.map(orderSummary), nextCursor: page.nextCursor };
    },
  }),
  tool({
    name: "get_order",
    description: "Get one order in full: line items, totals, customer contact details, note and promised delivery date.",
    type: "read",
    defaultMode: "AUTO",
    capability: "orders",
    untrustedText: true,
    input: z.object({ orderId: id("order") }),
    summarize: (i) => `Look up order ${i.orderId}`,
    run: (input, { adapter }) => adapter.getOrder(input.orderId),
  }),
  tool({
    name: "sales_summary",
    description:
      "Sales totals for a period in the store's own time zone: order count, gross sales, average order value and top 5 products by revenue. Cancelled and refunded orders are excluded. Give either a named period or an explicit from/to.",
    type: "read",
    defaultMode: "AUTO",
    capability: "orders",
    untrustedText: false,
    input: z.object({
      period: z.enum(PERIODS).optional(),
      from: isoUtc.optional().describe("ISO 8601 UTC, inclusive; use with to instead of period"),
      to: isoUtc.optional().describe("ISO 8601 UTC, exclusive"),
    }),
    summarize: (i) => `Sales summary for ${i.period ?? `${i.from} to ${i.to}`}`,
    async run(input, { adapter, store }) {
      if (input.period) {
        const range = periodRange(input.period, store.timezone);
        return { period: input.period, ...(await adapter.salesSummary(range.from, range.to)) };
      }
      if (!input.from || !input.to) throw new ToolInputError("Give a period, or both from and to");
      return adapter.salesSummary(input.from, input.to);
    },
  }),
  tool({
    name: "low_stock_products",
    description: "Products with at least one tracked variant at or below a stock threshold. Made-to-order variants (untracked stock) are never low.",
    type: "read",
    defaultMode: "AUTO",
    capability: "inventory",
    untrustedText: false,
    input: z.object({
      threshold: z.number().int().min(0).max(1000).optional().describe("Default 3"),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    summarize: (i) => `Find products with stock at or below ${i.threshold ?? 3}`,
    async run(input, { adapter }) {
      const threshold = input.threshold ?? 3;
      const page = await adapter.listProducts({ lowStockThreshold: threshold, limit: input.limit ?? 50 });
      return { threshold, products: page.items.map((p) => lowStockView(p, threshold)), more: page.nextCursor !== null };
    },
  }),
  tool({
    name: "search_reviews",
    description: "Search product reviews, newest first. Filter by rating range, unreplied only, since a date, or product.",
    type: "read",
    defaultMode: "AUTO",
    capability: "reviews",
    untrustedText: true,
    input: z.object({
      minRating: z.number().int().min(1).max(5).optional(),
      maxRating: z.number().int().min(1).max(5).optional(),
      unreplied: z.boolean().optional(),
      since: isoUtc.optional(),
      productId: z.string().optional(),
      limit: z.number().int().min(1).max(50).optional().describe("Default 10"),
      cursor: z.string().optional(),
    }),
    summarize: () => "Search reviews",
    async run(input, { adapter }) {
      const page = await adapter.listReviews({ ...input, limit: input.limit ?? 10 });
      return { reviews: page.items, nextCursor: page.nextCursor };
    },
  }),
  tool({
    name: "list_coupons",
    description: "All coupons with their discount, usage count and limit, dates, and whether each is currently active.",
    type: "read",
    defaultMode: "AUTO",
    capability: "coupons",
    untrustedText: false,
    input: z.object({}),
    summarize: () => "List coupons",
    run: async (_input, { adapter }) => ({ coupons: await adapter.listCoupons() }),
  }),
  tool({
    name: "draft_customer_message",
    description:
      "Save a draft message to the customer of an order (for example, an apology for a late order). Nothing is sent: the owner reviews and sends drafts themselves.",
    type: "draft",
    defaultMode: "AUTO",
    capability: null,
    untrustedText: false,
    input: z.object({
      orderId: id("order"),
      message: z.string().min(1).max(2000),
    }),
    summarize: (i) => `Draft a message for order ${i.orderId}`,
    async run(input, { adapter, saveDraft }) {
      const order = await adapter.getOrder(input.orderId);
      const to = { name: order.customer.name, email: order.customer.email, phone: order.customer.phone };
      const draftId = await saveDraft?.({
        kind: "CUSTOMER_MESSAGE",
        targetId: order.id,
        targetLabel: `Order ${order.number} · ${order.customer.name}`,
        recipient: to,
        body: input.message,
      });
      return { draftId, draft: { orderNumber: order.number, to, message: input.message }, status: "Saved in the owner's inbox. Not sent." };
    },
  }),
  tool({
    name: "draft_review_reply",
    description: "Save a draft reply to a review for the owner to check. Nothing is posted.",
    type: "draft",
    defaultMode: "AUTO",
    capability: "reviews",
    untrustedText: false,
    input: z.object({
      reviewId: id("review"),
      reply: z.string().min(1).max(2000),
      reviewSummary: z
        .string()
        .max(200)
        .optional()
        .describe('Who wrote the review, its rating and gist, for the owner, e.g. "Meera, 2 stars: delivered late"'),
    }),
    summarize: (i) => `Draft a reply to review ${i.reviewId}`,
    async run(input, { saveDraft }) {
      const draftId = await saveDraft?.({
        kind: "REVIEW_REPLY",
        targetId: input.reviewId,
        targetLabel: input.reviewSummary ? `Review · ${input.reviewSummary}` : `Review ${input.reviewId}`,
        recipient: null,
        body: input.reply,
      });
      return { draftId, draft: { reviewId: input.reviewId, reply: input.reply }, status: "Saved in the owner's inbox. Not posted." };
    },
  }),
  tool({
    name: "update_order_status",
    description: "Change an order's status. Cancelled and refunded orders cannot change.",
    type: "write",
    defaultMode: "ASK",
    capability: "orders.write",
    untrustedText: false,
    input: z.object({ orderId: id("order"), status: z.enum(ORDER_STATUSES) }),
    summarize: (i) => `Change order ${i.orderId} to "${i.status}"`,
    run: (input, { adapter }) => adapter.updateOrderStatus(input.orderId, input.status),
  }),
  tool({
    name: "create_coupon",
    description: "Create a coupon. Percent coupons take 1–100; fixed coupons take an amount in minor units (paise for INR).",
    type: "write",
    defaultMode: "ASK",
    capability: "coupons.write",
    untrustedText: false,
    input: CreateCouponInput,
    summarize: (i) => `Create coupon ${i.code}: ${i.type === "percent" ? `${i.value}% off` : `${i.value} off (minor units)`}${i.usageLimit ? `, up to ${i.usageLimit} uses` : ""}`,
    run: (input, { adapter }) => adapter.createCoupon(input),
  }),
  tool({
    name: "update_stock",
    description: "Set the absolute stock level of one product variant.",
    type: "write",
    defaultMode: "ASK",
    capability: "inventory.write",
    untrustedText: false,
    input: z.object({ variantId: id("variant"), quantity: z.number().int().min(0).max(100_000) }),
    summarize: (i) => `Set stock of variant ${i.variantId} to ${i.quantity}`,
    run: (input, { adapter }) => adapter.updateStock(input.variantId, input.quantity),
  }),
  tool({
    name: "reply_to_review",
    description: "Post a public reply to a review. A review can be replied to once.",
    type: "write",
    defaultMode: "ASK",
    capability: "reviews.write",
    untrustedText: false,
    input: z.object({ reviewId: id("review"), reply: z.string().min(1).max(2000) }),
    summarize: (i) => `Reply to review ${i.reviewId}: "${i.reply.slice(0, 80)}${i.reply.length > 80 ? "…" : ""}"`,
    run: (input, { adapter }) => adapter.replyToReview(input.reviewId, input.reply),
  }),
] as const satisfies readonly ToolDefinition<z.ZodObject>[];

export type ToolName = (typeof TOOLS)[number]["name"];

const BY_NAME = new Map<string, ToolDefinition>(TOOLS.map((t) => [t.name, t as unknown as ToolDefinition]));

export function getTool(name: string): ToolDefinition | undefined {
  return BY_NAME.get(name);
}

/** JSON Schema for a tool's input, as MCP and the Claude API expect it. */
export function inputJsonSchema(def: ToolDefinition): Record<string, unknown> {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(def.input) as Record<string, unknown>;
  return schema;
}

/** A tool input the model got wrong in a way the schema cannot express. */
export class ToolInputError extends Error {}

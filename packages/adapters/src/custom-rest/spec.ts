import { z } from "zod";
import {
  CAPABILITIES,
  Coupon,
  CreateCouponInput,
  ORDER_STATUSES,
  Order,
  OrderStatus,
  Product,
  Review,
  SalesSummary,
  pageOf,
} from "@store-ops/shared";

/**
 * The Store Ops connector API, version 1: what a custom-built store
 * implements so the agent can work with it. The OpenAPI document is generated
 * from the same zod schemas the platform validates responses with, so the
 * spec and the code cannot drift.
 */

export const CONNECTOR_VERSION = "1.0.0";

export const ConnectorErrorCode = z.enum(["NOT_FOUND", "CONFLICT", "VALIDATION", "UNSUPPORTED", "AUTH", "RATE_LIMITED"]);
export const ConnectorError = z.object({
  error: z.object({
    code: ConnectorErrorCode,
    message: z.string(),
  }),
});

/** HTTP status for each connector error code. */
export const ERROR_STATUS: Record<z.infer<typeof ConnectorErrorCode>, number> = {
  NOT_FOUND: 404,
  CONFLICT: 409,
  VALIDATION: 422,
  UNSUPPORTED: 501,
  AUTH: 401,
  RATE_LIMITED: 429,
};

export const CapabilitiesResponse = z.object({
  capabilities: z.array(z.enum(CAPABILITIES.filter((c) => c !== "webhooks") as [string, ...string[]])),
});
export const CouponList = z.object({ items: z.array(Coupon) });
export const StatusUpdate = z.object({ status: OrderStatus });
export const StockUpdate = z.object({ quantity: z.number().int().nonnegative() });
export const ReplyInput = z.object({ text: z.string().trim().min(1).max(2000) });

const schemas = {
  Order,
  Product,
  Coupon,
  Review,
  SalesSummary,
  OrderPage: pageOf(Order),
  ProductPage: pageOf(Product),
  ReviewPage: pageOf(Review),
  CouponList,
  CreateCouponInput,
  StatusUpdate,
  StockUpdate,
  ReplyInput,
  Capabilities: CapabilitiesResponse,
  Error: ConnectorError,
};

function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, { io: "output", unrepresentable: "any" }) as Record<string, unknown>;
  return rest;
}

const ref = (name: keyof typeof schemas) => ({ $ref: `#/components/schemas/${name}` });
const json = (name: keyof typeof schemas, description: string) => ({ description, content: { "application/json": { schema: ref(name) } } });
const errors = {
  "401": json("Error", "Missing or wrong API key (code AUTH)"),
  "422": json("Error", "Invalid input (code VALIDATION)"),
  "429": { ...json("Error", "Too many requests (code RATE_LIMITED); send Retry-After"), headers: { "Retry-After": { schema: { type: "integer" } } } },
  "501": json("Error", "The store does not support this (code UNSUPPORTED)"),
};
const notFound = { "404": json("Error", "No such resource (code NOT_FOUND)") };

const q = (name: string, schema: Record<string, unknown>, description: string, required = false) => ({ name, in: "query", required, description, schema });
const id = (description: string) => ({ name: "id", in: "path", required: true, description, schema: { type: "string" } });
const paging = [
  q("limit", { type: "integer", minimum: 1, maximum: 100, default: 25 }, "Page size"),
  q("cursor", { type: "string" }, "nextCursor from the previous page; opaque to the platform"),
];
const isoUtc = { type: "string", format: "date-time" };

export function buildConnectorSpec(): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: "Store Ops connector API",
      version: CONNECTOR_VERSION,
      description: [
        "Implement this API in a custom-built store so the Store Ops agent can run day-to-day operations on it.",
        "",
        "Conventions:",
        "- Authenticate every request with `Authorization: Bearer <API key>`; the owner pastes the key when connecting the store.",
        "- Money is an object with `amount` in minor units (integer, e.g. paise) and an ISO 4217 `currency`.",
        "- Timestamps are ISO 8601 in UTC with a `Z` suffix.",
        "- Lists are paged with an opaque `cursor`; return `nextCursor: null` on the last page. Every item must appear exactly once across pages.",
        "- Time ranges are `[from, to)`: from inclusive, to exclusive.",
        "- Declare what you support in `GET /capabilities`; answer anything else with 501 and code `UNSUPPORTED`.",
        "- Errors are `{ \"error\": { \"code\", \"message\" } }` with the HTTP status listed for each code.",
        "",
        "The platform validates every response against these schemas, and the conformance suite (packages/adapters/src/testing/conformance.ts) checks behaviour. The sample implementation in examples/custom-connector passes it.",
      ].join("\n"),
    },
    servers: [{ url: "https://your-store.example.com/store-ops/v1", description: "The base URL the owner enters when connecting" }],
    security: [{ apiKey: [] }],
    components: {
      securitySchemes: { apiKey: { type: "http", scheme: "bearer", description: "A key you issue for this store" } },
      schemas: Object.fromEntries(Object.entries(schemas).map(([name, schema]) => [name, jsonSchema(schema)])),
    },
    paths: {
      "/capabilities": {
        get: {
          operationId: "getCapabilities",
          summary: "What this store supports",
          description: "Read capabilities (orders, inventory, coupons, reviews) and their write counterparts (orders.write...). A write capability requires its read capability.",
          responses: { "200": json("Capabilities", "Supported capabilities"), "401": errors["401"] },
        },
      },
      "/orders": {
        get: {
          operationId: "listOrders",
          summary: "List orders, newest first",
          parameters: [
            q("status", { type: "string", enum: ORDER_STATUSES }, "Only orders with this status"),
            q("createdFrom", isoUtc, "Created at or after (inclusive)"),
            q("createdTo", isoUtc, "Created before (exclusive)"),
            q("overdue", { type: "boolean" }, "Only orders past promisedAt that are not delivered, cancelled or refunded"),
            q("query", { type: "string" }, "Free text: order number, customer name or email"),
            ...paging,
          ],
          responses: { "200": json("OrderPage", "A page of orders"), ...errors },
        },
      },
      "/orders/{id}": {
        get: { operationId: "getOrder", summary: "One order", parameters: [id("Order id")], responses: { "200": json("Order", "The order"), ...notFound, ...errors } },
      },
      "/orders/{id}/status": {
        post: {
          operationId: "updateOrderStatus",
          summary: "Change an order's status",
          description: "Setting the current status is a no-op that returns the order. Cancelled and refunded orders cannot change: answer 422.",
          parameters: [id("Order id")],
          requestBody: { required: true, content: { "application/json": { schema: ref("StatusUpdate") } } },
          responses: { "200": json("Order", "The updated order"), ...notFound, ...errors },
        },
      },
      "/products": {
        get: {
          operationId: "listProducts",
          summary: "List products with their variants",
          parameters: [
            q("query", { type: "string" }, "Text in the title or a variant SKU"),
            q("lowStockThreshold", { type: "integer", minimum: 0 }, "Only products with a tracked variant at or below this stock"),
            ...paging,
          ],
          responses: { "200": json("ProductPage", "A page of products"), ...errors },
        },
      },
      "/variants/{id}/product": {
        get: {
          operationId: "getProductByVariant",
          summary: "The product a variant belongs to",
          parameters: [id("Variant id")],
          responses: { "200": json("Product", "The product"), ...notFound, ...errors },
        },
      },
      "/variants/{id}/stock": {
        put: {
          operationId: "updateStock",
          summary: "Set a variant's absolute stock level",
          parameters: [id("Variant id")],
          requestBody: { required: true, content: { "application/json": { schema: ref("StockUpdate") } } },
          responses: { "200": json("Product", "The product, with the new stock"), ...notFound, ...errors },
        },
      },
      "/coupons": {
        get: { operationId: "listCoupons", summary: "All coupons", responses: { "200": json("CouponList", "Every coupon"), ...errors } },
        post: {
          operationId: "createCoupon",
          summary: "Create a coupon",
          description: "Codes are case-insensitive; a code that exists answers 409 CONFLICT.",
          requestBody: { required: true, content: { "application/json": { schema: ref("CreateCouponInput") } } },
          responses: { "201": json("Coupon", "The new coupon"), "409": json("Error", "The code exists (code CONFLICT)"), ...errors },
        },
      },
      "/reviews": {
        get: {
          operationId: "listReviews",
          summary: "List reviews, newest first",
          parameters: [
            q("minRating", { type: "integer", minimum: 1, maximum: 5 }, "Rating at least"),
            q("maxRating", { type: "integer", minimum: 1, maximum: 5 }, "Rating at most"),
            q("unreplied", { type: "boolean" }, "Only reviews without a reply"),
            q("since", isoUtc, "Created at or after"),
            q("productId", { type: "string" }, "Only this product's reviews"),
            ...paging,
          ],
          responses: { "200": json("ReviewPage", "A page of reviews"), ...errors },
        },
      },
      "/reviews/{id}/reply": {
        post: {
          operationId: "replyToReview",
          summary: "Post the store's public reply to a review",
          description: "A review can be replied to once; a second reply answers 409 CONFLICT.",
          parameters: [id("Review id")],
          requestBody: { required: true, content: { "application/json": { schema: ref("ReplyInput") } } },
          responses: { "200": json("Review", "The review with its reply"), ...notFound, "409": json("Error", "Already replied (code CONFLICT)"), ...errors },
        },
      },
      "/sales-summary": {
        get: {
          operationId: "salesSummary",
          summary: "Sales for orders created in [from, to)",
          description: "Excludes cancelled and refunded orders. topProducts: up to 5, by revenue, highest first.",
          parameters: [q("from", isoUtc, "Start (inclusive)", true), q("to", isoUtc, "End (exclusive)", true)],
          responses: { "200": json("SalesSummary", "The summary"), ...errors },
        },
      },
    },
  };
}

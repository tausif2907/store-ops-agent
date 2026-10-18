import pg from "pg";
import { z } from "zod";
import {
  Coupon,
  CreateCouponInput,
  Order,
  OrderFilter,
  OrderStatus,
  Product,
  ProductFilter,
  Review,
  ReviewFilter,
  SalesSummary,
  pageOf,
  type Capability,
  type Page,
  type WebhookEvent,
} from "@store-ops/shared";
import { AdapterError, type StoreAdapter } from "../adapter";
import { parseInput } from "../validation";

export const SupabaseCredentials = z.object({
  /** Postgres connection string for the restricted agent_role. */
  connectionString: z.string().startsWith("postgres"),
});
export type SupabaseCredentials = z.infer<typeof SupabaseCredentials>;

const CAPABILITIES: Capability[] = [
  "orders",
  "orders.write",
  "inventory",
  "inventory.write",
  "coupons",
  "coupons.write",
  "reviews",
  "reviews.write",
];

const OrderPage = pageOf(Order);
const ProductPage = pageOf(Product);
const ReviewPage = pageOf(Review);
const CouponList = z.array(Coupon);

/**
 * Adapter for a store whose data lives in Supabase (or any Postgres). It calls
 * the `agent_api` functions as the restricted `agent_role`; see
 * boutique-reference.sql for the contract those functions implement.
 */
export class SupabaseAdapter implements StoreAdapter {
  readonly platform = "SUPABASE" as const;
  private readonly pool: pg.Pool;

  constructor(credentials: SupabaseCredentials) {
    const { connectionString } = SupabaseCredentials.parse(credentials);
    this.pool = new pg.Pool({
      connectionString,
      max: 3,
      statement_timeout: 10_000,
      connectionTimeoutMillis: 5_000,
      application_name: "store-ops-agent",
    });
    // An idle client error must not crash the process; the next query reports it.
    this.pool.on("error", () => {});
  }

  async capabilities(): Promise<Capability[]> {
    return [...CAPABILITIES];
  }

  async listOrders(filter: OrderFilter = {}): Promise<Page<Order>> {
    return this.call("list_orders", [JSON.stringify(parseInput(OrderFilter, filter))], OrderPage);
  }

  async getOrder(id: string): Promise<Order> {
    return this.call("get_order", [id], Order);
  }

  async updateOrderStatus(id: string, status: OrderStatus): Promise<Order> {
    return this.call("update_order_status", [id, parseInput(OrderStatus, status)], Order);
  }

  async listProducts(filter: ProductFilter = {}): Promise<Page<Product>> {
    return this.call("list_products", [JSON.stringify(parseInput(ProductFilter, filter))], ProductPage);
  }

  async updateStock(variantId: string, qty: number): Promise<Product> {
    return this.call("update_stock", [variantId, parseInput(z.number().int().nonnegative(), qty)], Product);
  }

  async listCoupons(): Promise<Coupon[]> {
    return this.call("list_coupons", [], CouponList);
  }

  async createCoupon(input: CreateCouponInput): Promise<Coupon> {
    return this.call("create_coupon", [JSON.stringify(parseInput(CreateCouponInput, input))], Coupon);
  }

  async listReviews(filter: ReviewFilter = {}): Promise<Page<Review>> {
    return this.call("list_reviews", [JSON.stringify(parseInput(ReviewFilter, filter))], ReviewPage);
  }

  async replyToReview(id: string, text: string): Promise<Review> {
    return this.call("reply_to_review", [id, parseInput(z.string().trim().min(1), text)], Review);
  }

  async salesSummary(from: string, to: string): Promise<SalesSummary> {
    const iso = z.iso.datetime({ offset: false });
    return this.call("sales_summary", [parseInput(iso, from), parseInput(iso, to)], SalesSummary);
  }

  async subscribeWebhooks(_events: WebhookEvent[]): Promise<void> {
    throw new AdapterError("UNSUPPORTED", "Supabase stores do not send webhooks yet; scheduled jobs poll instead");
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async call<S extends z.ZodType>(fn: string, args: unknown[], schema: S): Promise<z.infer<S>> {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
    let raw: unknown;
    try {
      const { rows } = await this.pool.query(`SELECT agent_api.${fn}(${placeholders}) AS r`, args);
      raw = rows[0]?.r;
    } catch (err) {
      throw mapPgError(err);
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new AdapterError("INVALID_RESPONSE", `agent_api.${fn} returned data in the wrong shape: ${parsed.error.message}`, {
        cause: parsed.error,
      });
    }
    return parsed.data;
  }
}

function mapPgError(err: unknown): AdapterError {
  const code = (err as { code?: string }).code;
  const message = err instanceof Error ? err.message : String(err);
  switch (code) {
    case "P0002":
      return new AdapterError("NOT_FOUND", message, { cause: err });
    case "23505":
      return new AdapterError("CONFLICT", message, { cause: err });
    case "22023":
    case "22P02":
    case "22007":
    case "22008":
      return new AdapterError("VALIDATION", message, { cause: err });
    case "28P01":
    case "28000":
    case "42501":
      return new AdapterError("AUTH", message, { cause: err });
    case "42883":
      return new AdapterError("UNSUPPORTED", `The store's agent_api is missing a function: ${message}`, { cause: err });
    case "57014":
    case "53300":
      return new AdapterError("UNAVAILABLE", message, { cause: err, retryAfterMs: 2_000 });
    default:
      if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|timeout/i.test(message)) {
        return new AdapterError("UNAVAILABLE", message, { cause: err, retryAfterMs: 5_000 });
      }
      return new AdapterError("UNAVAILABLE", message, { cause: err });
  }
}

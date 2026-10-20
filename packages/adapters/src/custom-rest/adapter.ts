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
import { AdapterError, type AdapterErrorCode, type StoreAdapter } from "../adapter";
import { backoffDelay, bucketFor, parseRetryAfter, platformRate, realClock, type Clock } from "../rate-limit";
import { parseInput } from "../validation";
import { CapabilitiesResponse, ConnectorError, CouponList } from "./spec";

export const CustomRestCredentials = z.object({
  /** e.g. https://shop.example.com/store-ops/v1 */
  baseUrl: z.string().url().transform((u) => u.replace(/\/+$/, "")),
  apiKey: z.string().min(16),
});
export type CustomRestCredentials = z.infer<typeof CustomRestCredentials>;

export interface CustomRestOptions {
  fetch?: typeof fetch;
  clock?: Clock;
  maxRetries?: number;
}

const OrderPage = pageOf(Order);
const ProductPage = pageOf(Product);
const ReviewPage = pageOf(Review);

type Query = Record<string, string | number | boolean | undefined>;

/**
 * Adapter for stores that implement the Store Ops connector API
 * (buildConnectorSpec in ./spec.ts). Every response is validated against the
 * spec's schemas; anything else is INVALID_RESPONSE.
 */
export class CustomRestAdapter implements StoreAdapter {
  readonly platform = "CUSTOM_REST" as const;
  private readonly credentials: CustomRestCredentials;
  private caps: Promise<Capability[]> | null = null;

  constructor(
    credentials: CustomRestCredentials,
    private readonly options: CustomRestOptions = {},
  ) {
    this.credentials = CustomRestCredentials.parse(credentials);
  }

  capabilities(): Promise<Capability[]> {
    this.caps ??= this.call("GET", "/capabilities", {}, undefined, CapabilitiesResponse).then((r) => r.capabilities as Capability[]);
    return this.caps;
  }

  private async need(capability: Capability) {
    if (!(await this.capabilities()).includes(capability)) {
      throw new AdapterError("UNSUPPORTED", `This store's connector does not support ${capability}.`);
    }
  }

  async listOrders(filter: OrderFilter = {}): Promise<Page<Order>> {
    await this.need("orders");
    return this.call("GET", "/orders", parseInput(OrderFilter, filter), undefined, OrderPage);
  }

  async getOrder(id: string): Promise<Order> {
    await this.need("orders");
    return this.call("GET", `/orders/${encodeURIComponent(id)}`, {}, undefined, Order);
  }

  async updateOrderStatus(id: string, status: OrderStatus): Promise<Order> {
    await this.need("orders.write");
    return this.call("POST", `/orders/${encodeURIComponent(id)}/status`, {}, { status: parseInput(OrderStatus, status) }, Order);
  }

  async listProducts(filter: ProductFilter = {}): Promise<Page<Product>> {
    await this.need("inventory");
    return this.call("GET", "/products", parseInput(ProductFilter, filter), undefined, ProductPage);
  }

  async getProductByVariant(variantId: string): Promise<Product> {
    await this.need("inventory");
    return this.call("GET", `/variants/${encodeURIComponent(variantId)}/product`, {}, undefined, Product);
  }

  async updateStock(variantId: string, qty: number): Promise<Product> {
    await this.need("inventory.write");
    const quantity = parseInput(z.number().int().nonnegative(), qty);
    return this.call("PUT", `/variants/${encodeURIComponent(variantId)}/stock`, {}, { quantity }, Product);
  }

  async listCoupons(): Promise<Coupon[]> {
    await this.need("coupons");
    return (await this.call("GET", "/coupons", {}, undefined, CouponList)).items;
  }

  async createCoupon(input: CreateCouponInput): Promise<Coupon> {
    await this.need("coupons.write");
    return this.call("POST", "/coupons", {}, parseInput(CreateCouponInput, input), Coupon);
  }

  async listReviews(filter: ReviewFilter = {}): Promise<Page<Review>> {
    await this.need("reviews");
    return this.call("GET", "/reviews", parseInput(ReviewFilter, filter), undefined, ReviewPage);
  }

  async replyToReview(id: string, text: string): Promise<Review> {
    await this.need("reviews.write");
    return this.call("POST", `/reviews/${encodeURIComponent(id)}/reply`, {}, { text: parseInput(z.string().trim().min(1), text) }, Review);
  }

  async salesSummary(from: string, to: string): Promise<SalesSummary> {
    await this.need("orders");
    const iso = z.iso.datetime({ offset: false });
    return this.call("GET", "/sales-summary", { from: parseInput(iso, from), to: parseInput(iso, to) }, undefined, SalesSummary);
  }

  async subscribeWebhooks(_events: WebhookEvent[]): Promise<void> {
    throw new AdapterError("UNSUPPORTED", "Connector API v1 has no webhooks; scheduled jobs poll instead.");
  }

  async close(): Promise<void> {
    // HTTP only; nothing to release.
  }

  private async call<S extends z.ZodType>(method: string, path: string, query: Query, body: unknown, schema: S): Promise<z.infer<S>> {
    const url = new URL(`${this.credentials.baseUrl}${path}`);
    for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, String(v));
    const fetchImpl = this.options.fetch ?? fetch;
    const clock = this.options.clock ?? realClock;
    const maxRetries = this.options.maxRetries ?? 3;
    const rate = platformRate("CONNECTOR_REQUESTS_PER_SECOND", 10);
    const bucket = bucketFor(`custom:${this.credentials.baseUrl}`, rate * 2, rate, clock);

    for (let attempt = 0; ; attempt++) {
      await bucket.take();
      let res: Response;
      try {
        res = await fetchImpl(url, {
          method,
          headers: {
            authorization: `Bearer ${this.credentials.apiKey}`,
            accept: "application/json",
            ...(body === undefined ? {} : { "content-type": "application/json" }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(15_000),
        });
      } catch (err) {
        if (attempt < maxRetries) {
          await clock.sleep(backoffDelay(attempt));
          continue;
        }
        throw new AdapterError("UNAVAILABLE", `Could not reach ${url.origin}`, { cause: err, retryAfterMs: 5_000 });
      }
      if ((res.status === 429 || res.status >= 500) && res.status !== 501 && attempt < maxRetries) {
        await clock.sleep(backoffDelay(attempt, parseRetryAfter(res.headers.get("retry-after"), clock.now())));
        continue;
      }

      let json: unknown;
      try {
        json = await res.json();
      } catch {
        throw new AdapterError(res.ok ? "INVALID_RESPONSE" : "UNAVAILABLE", `The connector returned non-JSON (${res.status})`);
      }
      if (!res.ok) {
        const parsed = ConnectorError.safeParse(json);
        const code: AdapterErrorCode = parsed.success ? parsed.data.error.code : res.status === 401 ? "AUTH" : res.status === 404 ? "NOT_FOUND" : "UNAVAILABLE";
        throw new AdapterError(code, parsed.success ? parsed.data.error.message : `The connector returned ${res.status}`, {
          retryAfterMs: parseRetryAfter(res.headers.get("retry-after")) ?? undefined,
        });
      }
      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        throw new AdapterError("INVALID_RESPONSE", `${method} ${path} returned data outside the connector spec: ${parsed.error.message}`);
      }
      return parsed.data;
    }
  }
}

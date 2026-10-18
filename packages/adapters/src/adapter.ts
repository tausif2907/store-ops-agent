import type {
  Capability,
  Coupon,
  CreateCouponInput,
  Order,
  OrderFilter,
  OrderStatus,
  Page,
  Platform,
  Product,
  ProductFilter,
  Review,
  ReviewFilter,
  SalesSummary,
  WebhookEvent,
} from "@store-ops/shared";

/**
 * One interface for every store platform. The agent never knows which
 * platform it is talking to: adding a platform means writing one adapter.
 *
 * Contract (checked by the conformance suite):
 * - Return only the normalised types from @store-ops/shared.
 * - Throw AdapterError for every expected failure.
 * - A method whose capability is missing throws AdapterError("UNSUPPORTED").
 */
export interface StoreAdapter {
  readonly platform: Platform;

  capabilities(): Promise<Capability[]>;

  listOrders(filter?: OrderFilter): Promise<Page<Order>>;
  getOrder(id: string): Promise<Order>;
  updateOrderStatus(id: string, status: OrderStatus): Promise<Order>;

  listProducts(filter?: ProductFilter): Promise<Page<Product>>;
  /** Sets the absolute stock level of one variant; returns the whole product. */
  updateStock(variantId: string, qty: number): Promise<Product>;

  listCoupons(): Promise<Coupon[]>;
  createCoupon(input: CreateCouponInput): Promise<Coupon>;

  listReviews(filter?: ReviewFilter): Promise<Page<Review>>;
  replyToReview(id: string, text: string): Promise<Review>;

  /** Sales for orders created in [from, to), both ISO 8601 UTC. */
  salesSummary(from: string, to: string): Promise<SalesSummary>;

  subscribeWebhooks(events: WebhookEvent[]): Promise<void>;

  /** Releases connections. The adapter must not be used afterwards. */
  close(): Promise<void>;
}

export type AdapterErrorCode =
  | "NOT_FOUND"
  | "CONFLICT"
  | "VALIDATION"
  | "UNSUPPORTED"
  | "AUTH"
  | "RATE_LIMITED"
  | "UNAVAILABLE"
  | "INVALID_RESPONSE";

export class AdapterError extends Error {
  readonly code: AdapterErrorCode;
  /** Milliseconds to wait before retrying, when the platform says so. */
  readonly retryAfterMs?: number;

  constructor(code: AdapterErrorCode, message: string, options?: { cause?: unknown; retryAfterMs?: number }) {
    super(message, { cause: options?.cause });
    this.name = "AdapterError";
    this.code = code;
    this.retryAfterMs = options?.retryAfterMs;
  }
}

export function isAdapterError(err: unknown, code?: AdapterErrorCode): err is AdapterError {
  return err instanceof AdapterError && (code === undefined || err.code === code);
}

import { z } from "zod";

/**
 * Normalised store data. Every adapter returns exactly these shapes, whatever
 * the platform: money in minor units with an ISO 4217 currency code, and
 * timestamps as ISO 8601 strings in UTC.
 */

const isoUtc = z.iso.datetime({ offset: false });

export const Money = z.object({
  amount: z.number().int(), // minor units, e.g. paise
  currency: z.string().length(3),
});
export type Money = z.infer<typeof Money>;

export const Customer = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
});
export type Customer = z.infer<typeof Customer>;

export const ORDER_STATUSES = [
  "pending",
  "processing",
  "ready",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
] as const;
export const OrderStatus = z.enum(ORDER_STATUSES);
export type OrderStatus = z.infer<typeof OrderStatus>;

export const LineItem = z.object({
  productId: z.string(),
  variantId: z.string().nullable(),
  title: z.string(),
  quantity: z.number().int().positive(),
  unitPrice: Money,
});
export type LineItem = z.infer<typeof LineItem>;

export const Order = z.object({
  id: z.string(),
  number: z.string(),
  status: OrderStatus,
  /** The platform's own status label, kept for display and debugging. */
  platformStatus: z.string(),
  customer: Customer,
  lineItems: z.array(LineItem),
  total: Money,
  note: z.string().nullable(),
  createdAt: isoUtc,
  updatedAt: isoUtc,
  /** When the store promised delivery; null if the platform has no such field. */
  promisedAt: isoUtc.nullable(),
});
export type Order = z.infer<typeof Order>;

export const ProductVariant = z.object({
  id: z.string(),
  title: z.string(),
  sku: z.string().nullable(),
  price: Money,
  /** null when the platform does not track stock for this variant. */
  stock: z.number().int().nullable(),
});
export type ProductVariant = z.infer<typeof ProductVariant>;

export const Product = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(["active", "draft", "archived"]),
  variants: z.array(ProductVariant).min(1),
  updatedAt: isoUtc,
});
export type Product = z.infer<typeof Product>;

export const Coupon = z.object({
  id: z.string(),
  code: z.string(),
  type: z.enum(["percent", "fixed"]),
  /** Percent off (1–100) for "percent"; minor units for "fixed". */
  value: z.number().int().positive(),
  currency: z.string().length(3).nullable(),
  usageCount: z.number().int().nonnegative(),
  usageLimit: z.number().int().positive().nullable(),
  startsAt: isoUtc.nullable(),
  endsAt: isoUtc.nullable(),
  active: z.boolean(),
});
export type Coupon = z.infer<typeof Coupon>;

export const Review = z.object({
  id: z.string(),
  productId: z.string(),
  orderId: z.string().nullable(),
  rating: z.number().int().min(1).max(5),
  title: z.string().nullable(),
  body: z.string(),
  author: z.string(),
  createdAt: isoUtc,
  reply: z
    .object({
      body: z.string(),
      createdAt: isoUtc,
    })
    .nullable(),
});
export type Review = z.infer<typeof Review>;

export const SalesSummary = z.object({
  from: isoUtc,
  to: isoUtc,
  currency: z.string().length(3),
  /** Orders created in [from, to) that are not cancelled or refunded. */
  orderCount: z.number().int().nonnegative(),
  grossSales: Money,
  averageOrderValue: Money,
  topProducts: z.array(
    z.object({
      productId: z.string(),
      title: z.string(),
      quantity: z.number().int().nonnegative(),
      revenue: Money,
    }),
  ),
});
export type SalesSummary = z.infer<typeof SalesSummary>;

export function pageOf<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
}
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

// ---- Filters and inputs ---------------------------------------------------

export const OrderFilter = z.object({
  status: OrderStatus.optional(),
  createdFrom: isoUtc.optional(),
  createdTo: isoUtc.optional(),
  /** Only orders past their promised date and not yet delivered/cancelled. */
  overdue: z.boolean().optional(),
  /** Free text: order number, customer name or email. */
  query: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});
export type OrderFilter = z.infer<typeof OrderFilter>;

export const ProductFilter = z.object({
  query: z.string().optional(),
  /** Only products with at least one tracked variant whose stock is at or below this. */
  lowStockThreshold: z.number().int().nonnegative().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});
export type ProductFilter = z.infer<typeof ProductFilter>;

export const ReviewFilter = z.object({
  minRating: z.number().int().min(1).max(5).optional(),
  maxRating: z.number().int().min(1).max(5).optional(),
  unreplied: z.boolean().optional(),
  since: isoUtc.optional(),
  productId: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});
export type ReviewFilter = z.infer<typeof ReviewFilter>;

export const CreateCouponInput = z
  .object({
    code: z.string().min(3).max(32).regex(/^[A-Z0-9_-]+$/i),
    type: z.enum(["percent", "fixed"]),
    value: z.number().int().positive(),
    usageLimit: z.number().int().positive().nullable().optional(),
    startsAt: isoUtc.nullable().optional(),
    endsAt: isoUtc.nullable().optional(),
  })
  .refine((c) => c.type !== "percent" || c.value <= 100, { message: "A percent discount must be 100 or less", path: ["value"] });
export type CreateCouponInput = z.infer<typeof CreateCouponInput>;

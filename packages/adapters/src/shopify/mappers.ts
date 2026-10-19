import type { Coupon, Money, Order, OrderStatus, Product } from "@store-ops/shared";
import { PROCESSING_TAG, READY_TAG } from "./queries";

/** Raw shapes returned by the documents in queries.ts. */
export interface RawMoney {
  amount: string;
  currencyCode: string;
}

export interface RawOrder {
  id: string;
  name: string;
  processedAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  note: string | null;
  tags: string[];
  email: string | null;
  phone: string | null;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string;
  totalPriceSet: { shopMoney: RawMoney };
  customer: {
    id: string;
    displayName: string;
    defaultEmailAddress: { emailAddress: string } | null;
    defaultPhoneNumber: { phoneNumber: string } | null;
  } | null;
  promisedAt: { value: string } | null;
  fulfillments: { id: string; displayStatus: string | null }[];
  lineItems: {
    nodes: {
      title: string;
      quantity: number;
      originalUnitPriceSet: { shopMoney: RawMoney };
      product: { id: string } | null;
      variant: { id: string } | null;
    }[];
  };
}

export interface RawProduct {
  id: string;
  title: string;
  status: string;
  updatedAt: string;
  variants: {
    nodes: {
      id: string;
      title: string;
      sku: string | null;
      price: string;
      inventoryQuantity: number | null;
      inventoryItem: { id: string; tracked: boolean };
    }[];
  };
}

export interface RawDiscount {
  __typename: string;
  title?: string;
  status?: string;
  startsAt?: string;
  endsAt?: string | null;
  usageLimit?: number | null;
  asyncUsageCount?: number;
  codes?: { nodes: { code: string }[] };
  customerGets?: {
    value:
      | { __typename: "DiscountPercentage"; percentage: number }
      | { __typename: "DiscountAmount"; amount: RawMoney; appliesOnEachItem: boolean }
      | { __typename: string };
  };
}

/** Digits after the decimal point for a currency (2 for INR, 0 for JPY). */
export function currencyDigits(currency: string): number {
  return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

/** "1250.5" INR → 125050. Exact decimal arithmetic on the string, no floats. */
export function toMinorUnits(amount: string | number, currency: string): number {
  const digits = currencyDigits(currency);
  const text = typeof amount === "number" ? amount.toFixed(digits) : amount.trim();
  const negative = text.startsWith("-");
  const [whole = "0", fraction = ""] = text.replace(/^[-+]/, "").split(".");
  const padded = (fraction + "0".repeat(digits)).slice(0, digits);
  // Round half up on the first dropped digit.
  const roundUp = Number(fraction[digits] ?? "0") >= 5 ? 1 : 0;
  const value = Number(whole) * 10 ** digits + Number(padded || "0") + roundUp;
  return negative ? -value : value;
}

/** 125050 INR → "1250.50" */
export function fromMinorUnits(minor: number, currency: string): string {
  const digits = currencyDigits(currency);
  return (minor / 10 ** digits).toFixed(digits);
}

export function money(raw: RawMoney): Money {
  return { amount: toMinorUnits(raw.amount, raw.currencyCode), currency: raw.currencyCode };
}

/** Shopify timestamps are already UTC ISO strings; normalise to millisecond precision. */
export function utc(value: string): string {
  return new Date(value).toISOString();
}

/**
 * Shopify has no single order status. Cancelled, refunded, shipped and
 * delivered come from Shopify's own fields; "processing" and "ready" are
 * workflow states kept as order tags.
 */
export function orderStatus(o: Pick<RawOrder, "cancelledAt" | "displayFinancialStatus" | "displayFulfillmentStatus" | "fulfillments" | "tags">): OrderStatus {
  if (o.cancelledAt) return "cancelled";
  if (o.displayFinancialStatus === "REFUNDED") return "refunded";
  if (o.fulfillments.some((f) => f.displayStatus === "DELIVERED")) return "delivered";
  if (o.displayFulfillmentStatus === "FULFILLED") return "shipped";
  if (o.tags.includes(READY_TAG)) return "ready";
  if (o.tags.includes(PROCESSING_TAG)) return "processing";
  return "pending";
}

export function mapOrder(o: RawOrder): Order {
  return {
    id: o.id,
    number: o.name,
    status: orderStatus(o),
    platformStatus: [o.cancelledAt ? "CANCELLED" : null, o.displayFinancialStatus, o.displayFulfillmentStatus].filter(Boolean).join("/"),
    customer: {
      id: o.customer?.id ?? "",
      name: o.customer?.displayName ?? "Guest",
      email: o.customer?.defaultEmailAddress?.emailAddress ?? o.email ?? null,
      phone: o.customer?.defaultPhoneNumber?.phoneNumber ?? o.phone ?? null,
    },
    lineItems: o.lineItems.nodes.map((li) => ({
      productId: li.product?.id ?? "",
      variantId: li.variant?.id ?? null,
      title: li.title,
      quantity: li.quantity,
      unitPrice: money(li.originalUnitPriceSet.shopMoney),
    })),
    total: money(o.totalPriceSet.shopMoney),
    note: o.note || null,
    createdAt: utc(o.processedAt),
    updatedAt: utc(o.updatedAt),
    promisedAt: o.promisedAt?.value ? utc(o.promisedAt.value) : null,
  };
}

export function mapProduct(p: RawProduct, currency: string): Product {
  return {
    id: p.id,
    title: p.title,
    status: p.status === "DRAFT" ? "draft" : p.status === "ARCHIVED" ? "archived" : "active",
    variants: p.variants.nodes.map((v) => ({
      id: v.id,
      title: v.title,
      sku: v.sku || null,
      price: { amount: toMinorUnits(v.price, currency), currency },
      stock: v.inventoryItem.tracked ? (v.inventoryQuantity ?? 0) : null,
    })),
    updatedAt: utc(p.updatedAt),
  };
}

/** Basic code discounts map to coupons; other discount kinds are skipped. */
export function mapCoupon(id: string, d: RawDiscount, currency: string): Coupon | null {
  if (d.__typename !== "DiscountCodeBasic" || !d.customerGets) return null;
  const code = d.codes?.nodes[0]?.code;
  if (!code) return null;
  const value = d.customerGets.value;
  let type: "percent" | "fixed";
  let amount: number;
  let couponCurrency: string | null = null;
  if (value.__typename === "DiscountPercentage" && "percentage" in value) {
    type = "percent";
    amount = Math.round(value.percentage * 100);
  } else if (value.__typename === "DiscountAmount" && "amount" in value) {
    type = "fixed";
    amount = toMinorUnits(value.amount.amount, value.amount.currencyCode);
    couponCurrency = value.amount.currencyCode;
  } else {
    return null;
  }
  return {
    id,
    code,
    type,
    value: amount,
    currency: couponCurrency ?? (type === "fixed" ? currency : null),
    usageCount: d.asyncUsageCount ?? 0,
    usageLimit: d.usageLimit ?? null,
    startsAt: d.startsAt ? utc(d.startsAt) : null,
    endsAt: d.endsAt ? utc(d.endsAt) : null,
    active: d.status === "ACTIVE" && (d.usageLimit == null || (d.asyncUsageCount ?? 0) < d.usageLimit),
  };
}

/** Shopify search values containing spaces or special characters must be quoted. */
export function searchValue(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

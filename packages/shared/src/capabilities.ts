import { z } from "zod";

/**
 * What a connected store can do. Each adapter declares its capabilities and the
 * agent only ever sees tools whose required capability is present.
 */
export const CAPABILITIES = [
  "orders",
  "orders.write",
  "inventory",
  "inventory.write",
  "coupons",
  "coupons.write",
  "reviews",
  "reviews.write",
  "webhooks",
] as const;

export const Capability = z.enum(CAPABILITIES);
export type Capability = z.infer<typeof Capability>;

export const PLATFORMS = ["SHOPIFY", "WOOCOMMERCE", "CUSTOM_REST", "SUPABASE"] as const;
export const Platform = z.enum(PLATFORMS);
export type Platform = z.infer<typeof Platform>;

export const WEBHOOK_EVENTS = ["order.created", "order.updated", "product.low_stock", "review.created"] as const;
export const WebhookEvent = z.enum(WEBHOOK_EVENTS);
export type WebhookEvent = z.infer<typeof WebhookEvent>;

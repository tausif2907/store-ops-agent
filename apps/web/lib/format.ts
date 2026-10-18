import type { Money, Platform } from "@store-ops/shared";

export const PLATFORM_LABELS: Record<Platform, string> = {
  SUPABASE: "Supabase",
  SHOPIFY: "Shopify",
  WOOCOMMERCE: "WooCommerce",
  CUSTOM_REST: "Custom REST",
};

export function formatMoney(money: Money): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: money.currency }).format(money.amount / 100);
}

export function formatDateTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(iso));
}

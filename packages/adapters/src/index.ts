import type { Platform } from "@store-ops/shared";
import type { StoreAdapter } from "./adapter";
import { ShopifyAdapter } from "./shopify/adapter";
import { ShopifyCredentials } from "./shopify/client";
import { SupabaseAdapter, SupabaseCredentials } from "./supabase/adapter";
import { CustomRestAdapter, CustomRestCredentials } from "./custom-rest/adapter";
import { WooAdapter } from "./woocommerce/adapter";
import { WooCredentials } from "./woocommerce/client";

export * from "./adapter";
export { SupabaseAdapter, SupabaseCredentials } from "./supabase/adapter";
export { ShopifyAdapter } from "./shopify/adapter";
export { ShopifyCredentials, appConfigFromEnv } from "./shopify/client";
export * as shopifyOAuth from "./shopify/oauth";
export { SHOPIFY_API_VERSION } from "./shopify/version";
export { WooAdapter } from "./woocommerce/adapter";
export { CustomRestAdapter, CustomRestCredentials } from "./custom-rest/adapter";
export { CONNECTOR_VERSION, buildConnectorSpec } from "./custom-rest/spec";
export { WooCredentials, verifyWooWebhook, wooOAuthSignature } from "./woocommerce/client";

/** Platforms that can be connected today. */
export const AVAILABLE_PLATFORMS: readonly Platform[] = ["SUPABASE", "SHOPIFY", "WOOCOMMERCE", "CUSTOM_REST"];

export interface AdapterOptions {
  /** Called when the adapter refreshes its credentials (Shopify tokens), to store them. */
  onCredentialsChange?: (credentials: unknown) => Promise<void> | void;
  /** Reads the stored credentials again, in case another process refreshed them. */
  reloadCredentials?: () => Promise<unknown>;
  /** Public HTTPS URL for platform webhooks. */
  webhookUrl?: string;
}

/** Base URL platforms deliver webhooks to (WEBHOOK_BASE_URL, else APP_URL). */
export function webhookBaseUrl(): string | undefined {
  return (process.env.WEBHOOK_BASE_URL ?? process.env.APP_URL)?.replace(/\/$/, "");
}

/** Where Shopify should post webhooks, when the app has a public HTTPS URL. */
export function shopifyWebhookUrl(): string | undefined {
  const base = process.env.APP_URL?.replace(/\/$/, "");
  return base?.startsWith("https://") ? `${base}/api/webhooks/shopify` : undefined;
}

/**
 * Builds the adapter for a store from its decrypted credentials. Credentials
 * only ever exist in memory here and inside the adapter.
 */
export function createAdapter(platform: Platform, credentials: unknown, options: AdapterOptions = {}): StoreAdapter {
  switch (platform) {
    case "SUPABASE":
      return new SupabaseAdapter(SupabaseCredentials.parse(credentials));
    case "SHOPIFY":
      return new ShopifyAdapter(ShopifyCredentials.parse(credentials), {
        onCredentialsChange: options.onCredentialsChange,
        reloadCredentials: options.reloadCredentials
          ? async () => {
              const stored = await options.reloadCredentials!();
              return stored ? ShopifyCredentials.parse(stored) : null;
            }
          : undefined,
        webhookUrl: options.webhookUrl ?? shopifyWebhookUrl(),
      });
    case "WOOCOMMERCE":
      return new WooAdapter(WooCredentials.parse(credentials), {
        webhookUrl: options.webhookUrl,
        onCredentialsChange: options.onCredentialsChange,
      });
    case "CUSTOM_REST":
      return new CustomRestAdapter(CustomRestCredentials.parse(credentials));
  }
}

/**
 * Checks that a store answers with valid data. Used when an owner connects a
 * store, before the credentials are saved.
 */
export async function testConnection(adapter: StoreAdapter): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await adapter.capabilities();
    await adapter.listOrders({ limit: 1 });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

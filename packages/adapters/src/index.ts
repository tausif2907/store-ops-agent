import type { Platform } from "@store-ops/shared";
import { AdapterError, type StoreAdapter } from "./adapter";
import { ShopifyAdapter } from "./shopify/adapter";
import { ShopifyCredentials } from "./shopify/client";
import { SupabaseAdapter, SupabaseCredentials } from "./supabase/adapter";

export * from "./adapter";
export { SupabaseAdapter, SupabaseCredentials } from "./supabase/adapter";
export { ShopifyAdapter } from "./shopify/adapter";
export { ShopifyCredentials, appConfigFromEnv } from "./shopify/client";
export * as shopifyOAuth from "./shopify/oauth";
export { SHOPIFY_API_VERSION } from "./shopify/version";

/** Platforms that can be connected today. */
export const AVAILABLE_PLATFORMS: readonly Platform[] = ["SUPABASE", "SHOPIFY"];

export interface AdapterOptions {
  /** Called when the adapter refreshes its credentials (Shopify tokens), to store them. */
  onCredentialsChange?: (credentials: unknown) => Promise<void> | void;
  /** Reads the stored credentials again, in case another process refreshed them. */
  reloadCredentials?: () => Promise<unknown>;
  /** Public HTTPS URL for platform webhooks. */
  webhookUrl?: string;
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
    case "CUSTOM_REST":
      throw new AdapterError("UNSUPPORTED", `${platform} stores are not supported yet`);
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

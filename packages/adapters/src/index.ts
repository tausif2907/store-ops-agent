import type { Platform } from "@store-ops/shared";
import { AdapterError, type StoreAdapter } from "./adapter";
import { SupabaseAdapter, SupabaseCredentials } from "./supabase/adapter";

export * from "./adapter";
export { SupabaseAdapter, SupabaseCredentials } from "./supabase/adapter";

/** Platforms that can be connected today. */
export const AVAILABLE_PLATFORMS: readonly Platform[] = ["SUPABASE"];

/**
 * Builds the adapter for a store from its decrypted credentials. Credentials
 * only ever exist in memory here and inside the adapter.
 */
export function createAdapter(platform: Platform, credentials: unknown): StoreAdapter {
  switch (platform) {
    case "SUPABASE":
      return new SupabaseAdapter(SupabaseCredentials.parse(credentials));
    case "SHOPIFY":
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

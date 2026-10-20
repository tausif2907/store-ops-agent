import { createAdapter, shopifyWebhookUrl, webhookBaseUrl, type StoreAdapter } from "@store-ops/adapters";
import { dbForStore } from "@store-ops/db";
import type { Platform } from "@store-ops/shared";
import { decryptJson, encryptJson } from "@store-ops/shared/crypto";

/** Where a store's platform should deliver webhooks, if it can. */
export function webhookUrlFor(store: { id: string; platform: Platform }): string | undefined {
  switch (store.platform) {
    case "SHOPIFY":
      return shopifyWebhookUrl();
    case "WOOCOMMERCE": {
      const base = webhookBaseUrl();
      return base ? `${base}/api/webhooks/woocommerce/${store.id}` : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * The adapter for a connected store. When the adapter changes its own
 * credentials (refreshed Shopify tokens, a new WooCommerce webhook secret)
 * this saves them, encrypted, and lets it re-read credentials another process
 * changed first.
 */
export function adapterForStore(store: { id: string; platform: Platform }, credentialsEncrypted: string): StoreAdapter {
  const db = dbForStore(store.id);
  return createAdapter(store.platform, decryptJson(credentialsEncrypted), {
    webhookUrl: webhookUrlFor(store),
    onCredentialsChange: async (credentials) => {
      await db.storeConnection.update({
        where: { storeId: store.id },
        data: { credentialsEncrypted: encryptJson(credentials), status: "ACTIVE", lastError: null },
      });
    },
    reloadCredentials: async () => {
      const connection = await db.storeConnection.findUnique({ where: { storeId: store.id } });
      return connection ? decryptJson(connection.credentialsEncrypted) : null;
    },
  });
}

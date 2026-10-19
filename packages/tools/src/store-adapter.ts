import { createAdapter, type StoreAdapter } from "@store-ops/adapters";
import { dbForStore } from "@store-ops/db";
import type { Platform } from "@store-ops/shared";
import { decryptJson, encryptJson } from "@store-ops/shared/crypto";

/**
 * The adapter for a connected store. Platforms with expiring tokens (Shopify)
 * refresh them inside the adapter; this saves the new tokens, encrypted, and
 * lets the adapter pick up tokens another process refreshed first.
 */
export function adapterForStore(store: { id: string; platform: Platform }, credentialsEncrypted: string): StoreAdapter {
  const db = dbForStore(store.id);
  return createAdapter(store.platform, decryptJson(credentialsEncrypted), {
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

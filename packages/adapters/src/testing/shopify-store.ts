import { dbForStore } from "@store-ops/db";
import { decryptJson, encryptJson } from "@store-ops/shared/crypto";
import { ShopifyAdapter } from "../shopify/adapter";
import { ShopifyClient, ShopifyCredentials, type ShopifyClientOptions } from "../shopify/client";

/**
 * The Shopify development store used for seeding and conformance runs.
 *
 * Either connect the dev store through the dashboard and set
 * SHOPIFY_TEST_STORE_ID to its platform store id (tokens are read, refreshed
 * and saved back like in production), or set SHOPIFY_TEST_SHOP and
 * SHOPIFY_TEST_ACCESS_TOKEN for a non-expiring custom-app token.
 */
export function shopifyTestStoreConfigured(): boolean {
  return Boolean(process.env.SHOPIFY_TEST_STORE_ID || (process.env.SHOPIFY_TEST_SHOP && process.env.SHOPIFY_TEST_ACCESS_TOKEN));
}

export async function connectShopifyTestStore(): Promise<{ client: ShopifyClient; adapter: ShopifyAdapter }> {
  let credentials: ShopifyCredentials;
  let options: ShopifyClientOptions = {};
  const storeId = process.env.SHOPIFY_TEST_STORE_ID;

  if (storeId) {
    const db = dbForStore(storeId);
    const load = async () => {
      const connection = await db.storeConnection.findUnique({ where: { storeId } });
      return connection ? ShopifyCredentials.parse(decryptJson(connection.credentialsEncrypted)) : null;
    };
    const stored = await load();
    if (!stored) throw new Error(`Store ${storeId} has no Shopify connection`);
    credentials = stored;
    options = {
      reloadCredentials: load,
      onCredentialsChange: async (next) => {
        await db.storeConnection.update({ where: { storeId }, data: { credentialsEncrypted: encryptJson(next) } });
      },
    };
  } else {
    credentials = ShopifyCredentials.parse({
      shop: process.env.SHOPIFY_TEST_SHOP,
      accessToken: process.env.SHOPIFY_TEST_ACCESS_TOKEN,
    });
  }
  return { client: new ShopifyClient(credentials, options), adapter: new ShopifyAdapter(credentials, options) };
}

import { describe, it } from "vitest";
import type { ShopifyAdapter } from "../src/shopify/adapter";
import type { ShopifyClient } from "../src/shopify/client";
import { datasetAnchor, resetShopifyStore } from "../src/shopify/seed";
import { defineConformanceSuite } from "../src/testing/conformance";
import { connectShopifyTestStore, shopifyTestStoreConfigured } from "../src/testing/shopify-store";

/**
 * Runs the shared conformance suite against a seeded Shopify development
 * store. Skipped unless one is configured (see src/testing/shopify-store.ts).
 */
if (!shopifyTestStoreConfigured()) {
  describe.skip("adapter conformance: shopify (no development store configured)", () => {
    it("needs SHOPIFY_TEST_STORE_ID, or SHOPIFY_TEST_SHOP and SHOPIFY_TEST_ACCESS_TOKEN", () => {});
  });
} else {
  let connection: { client: ShopifyClient; adapter: ShopifyAdapter } | undefined;
  const connect = async () => (connection ??= await connectShopifyTestStore());

  defineConformanceSuite({
    name: "shopify",
    anchor: async () => {
      const anchor = await datasetAnchor((await connect()).client);
      if (!anchor) throw new Error("Seed the store first: pnpm --filter @store-ops/adapters shopify:seed");
      return anchor;
    },
    reset: async (dataset) => {
      const { client, adapter } = await connect();
      await resetShopifyStore(client, adapter, dataset);
    },
    createAdapter: async () => (await connect()).adapter,
  });
}

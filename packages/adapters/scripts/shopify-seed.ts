/**
 * Seeds the Shopify development store with the canonical dataset.
 * Takes about 40 minutes the first time (dev stores accept 5 orders a minute)
 * and can be stopped and re-run: it resumes where it left off.
 *
 *   pnpm --filter @store-ops/adapters shopify:seed
 */
import { seedShopifyStore } from "../src/shopify/seed";
import { connectShopifyTestStore, shopifyTestStoreConfigured } from "../src/testing/shopify-store";

if (!shopifyTestStoreConfigured()) {
  console.error("Set SHOPIFY_TEST_STORE_ID (a connected dev store) or SHOPIFY_TEST_SHOP and SHOPIFY_TEST_ACCESS_TOKEN.");
  process.exit(1);
}

const { client } = await connectShopifyTestStore();
const anchor = await seedShopifyStore(client, { log: (m) => console.log(m) });
console.log(`Done. Dataset anchor: ${anchor.toISOString()}`);
process.exit(0);

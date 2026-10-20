/**
 * Reseeds the local Docker WooCommerce store with the canonical dataset.
 *   pnpm --filter @store-ops/adapters woo:seed
 */
import { resetWooDockerStore } from "../src/woocommerce/seed";

resetWooDockerStore();
console.log("WooCommerce test store seeded.");

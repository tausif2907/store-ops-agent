import { describe, it } from "vitest";
import { WooAdapter } from "../src/woocommerce/adapter";
import { resetWooDockerStore } from "../src/woocommerce/seed";
import { defineConformanceSuite } from "../src/testing/conformance";

/**
 * Runs the shared conformance suite against the local Docker WooCommerce
 * store (docker compose --profile woo; see docs/woocommerce-setup.md).
 * Opt-in (it reseeds the store, which takes a few minutes):
 *   pnpm --filter @store-ops/adapters test:woo
 */
const { WOO_TEST_URL, WOO_TEST_KEY, WOO_TEST_SECRET, WOO_CONFORMANCE } = process.env;

if (WOO_CONFORMANCE !== "1" || !WOO_TEST_URL || !WOO_TEST_KEY || !WOO_TEST_SECRET) {
  describe.skip("adapter conformance: woocommerce (run with test:woo)", () => {
    it("needs the Docker store, WOO_TEST_* keys and WOO_CONFORMANCE=1", () => {});
  });
} else {
  defineConformanceSuite({
    name: "woocommerce",
    reset: async (dataset) => resetWooDockerStore(dataset),
    createAdapter: () => new WooAdapter({ url: WOO_TEST_URL, consumerKey: WOO_TEST_KEY, consumerSecret: WOO_TEST_SECRET, webhookSecret: null }),
  });
}

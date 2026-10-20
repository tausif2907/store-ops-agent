import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Test files share one boutique database; run them one at a time.
    fileParallelism: false,
    testTimeout: 60_000,
    // Reseeding the Docker WooCommerce store takes a few minutes.
    hookTimeout: 600_000,
  },
});

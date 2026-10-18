import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Test files share one boutique database; run them one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});

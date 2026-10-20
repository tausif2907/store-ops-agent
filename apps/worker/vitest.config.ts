import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Shares the boutique database with other packages' tests; run one file at a time.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});

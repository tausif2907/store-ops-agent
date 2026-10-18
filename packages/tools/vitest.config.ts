import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The approval tests reset the shared boutique database.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});

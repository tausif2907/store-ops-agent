import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The end-to-end test resets the shared boutique database.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});

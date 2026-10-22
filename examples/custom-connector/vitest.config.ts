import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The sample connector runs on localhost, which store addresses may only use in development and tests.
    env: { ALLOW_PRIVATE_STORE_HOSTS: "1" },
  },
});

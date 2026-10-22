import type { NextConfig } from "next";

// Environment comes from the repo-root .env (loaded by dotenv-cli in the package scripts).
const config: NextConfig = {
  // The browser test runs its own dev server; a separate build folder keeps it off a running `pnpm dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  transpilePackages: ["@store-ops/shared", "@store-ops/adapters", "@store-ops/db", "@store-ops/tools"],
  serverExternalPackages: ["pg", "@prisma/client", "bcryptjs"],
};

export default config;

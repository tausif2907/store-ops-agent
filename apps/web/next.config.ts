import type { NextConfig } from "next";

// Environment comes from the repo-root .env (loaded by dotenv-cli in the package scripts).
const config: NextConfig = {
  transpilePackages: ["@store-ops/shared", "@store-ops/adapters", "@store-ops/db"],
  serverExternalPackages: ["pg", "@prisma/client", "bcryptjs"],
};

export default config;

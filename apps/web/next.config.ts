import type { NextConfig } from "next";

const production = process.env.NODE_ENV === "production";

/** Sent with every page and API response. */
const SECURITY_HEADERS = [
  // No other site may frame the dashboard (clickjacking), and forms only post back here.
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(production ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];

// Environment comes from the repo-root .env (loaded by dotenv-cli in the package scripts).
const config: NextConfig = {
  // The browser test runs its own dev server; a separate build folder keeps it off a running `pnpm dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  transpilePackages: ["@store-ops/shared", "@store-ops/adapters", "@store-ops/db", "@store-ops/tools"],
  // No "N" badge in the corner during development; the app shows its own loading bar.
  devIndicators: false,
  // Browsers never get source maps of the app's code.
  productionBrowserSourceMaps: false,
  poweredByHeader: false,
  serverExternalPackages: ["pg", "@prisma/client", "bcryptjs"],
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default config;

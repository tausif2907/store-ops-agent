import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { requestToken, type ShopifyAppConfig, type ShopifyCredentials } from "./client";

/**
 * Shopify authorization-code grant for a standalone (non-embedded) app, with
 * expiring offline tokens, plus webhook signature checks.
 */

/** Read and write scopes the twelve tools need. Reviews are not in Shopify's API. */
export const SHOPIFY_SCOPES = ["read_orders", "write_orders", "read_products", "write_inventory", "read_inventory", "read_locations", "read_discounts", "write_discounts", "read_customers"];

const SHOP_DOMAIN = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;

/** Accepts "my-shop", "my-shop.myshopify.com" or a full admin URL; returns the shop domain or null. */
export function normalizeShopDomain(input: string): string | null {
  let value = input.trim().toLowerCase();
  value = value.replace(/^https?:\/\//, "").split("/")[0] ?? "";
  if (!value.includes(".")) value = `${value}.myshopify.com`;
  return SHOP_DOMAIN.test(value) ? value : null;
}

export function newOAuthState(): string {
  return randomBytes(24).toString("base64url");
}

export function authorizeUrl(args: { shop: string; app: ShopifyAppConfig; redirectUri: string; state: string; scopes?: string[] }): string {
  const url = new URL(`https://${args.shop}/admin/oauth/authorize`);
  url.searchParams.set("client_id", args.app.clientId);
  url.searchParams.set("scope", (args.scopes ?? SHOPIFY_SCOPES).join(","));
  url.searchParams.set("redirect_uri", args.redirectUri);
  url.searchParams.set("state", args.state);
  return url.toString();
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Verifies the `hmac` on Shopify's OAuth callback: remove it, sort the other
 * parameters, join as a query string and HMAC-SHA256 with the client secret.
 */
export function verifyCallbackHmac(params: URLSearchParams, clientSecret: string): boolean {
  const hmac = params.get("hmac");
  if (!hmac) return false;
  const message = [...params.entries()]
    .filter(([key]) => key !== "hmac" && key !== "signature")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  const digest = createHmac("sha256", clientSecret).update(message).digest("hex");
  return safeEqual(digest, hmac);
}

/** Verifies `X-Shopify-Hmac-Sha256` (base64) against the raw webhook body. */
export function verifyWebhookHmac(rawBody: string | Buffer, hmacHeader: string | null, clientSecret: string): boolean {
  if (!hmacHeader) return false;
  const digest = createHmac("sha256", clientSecret).update(rawBody).digest("base64");
  return safeEqual(digest, hmacHeader);
}

/** Validates the callback and exchanges the code for expiring offline tokens. */
export async function completeOAuth(args: {
  params: URLSearchParams;
  expectedState: string | undefined;
  app: ShopifyAppConfig;
  fetch?: typeof fetch;
}): Promise<{ ok: true; credentials: ShopifyCredentials; missingScopes: string[] } | { ok: false; error: string }> {
  const { params, app } = args;
  const shop = params.get("shop");
  const code = params.get("code");
  if (!shop || !SHOP_DOMAIN.test(shop)) return { ok: false, error: "Invalid shop domain." };
  if (!code) return { ok: false, error: "Missing authorization code." };
  if (!args.expectedState || !safeEqual(params.get("state") ?? "", args.expectedState)) {
    return { ok: false, error: "The connection request expired or did not start here. Try again." };
  }
  if (!verifyCallbackHmac(params, app.clientSecret)) return { ok: false, error: "Shopify's signature did not match." };
  const timestamp = Number(params.get("timestamp"));
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 600) {
    return { ok: false, error: "The connection request is too old. Try again." };
  }

  const { status, credentials } = await requestToken(
    shop,
    { client_id: app.clientId, client_secret: app.clientSecret, code, expiring: "1" },
    args.fetch,
  );
  if (!credentials) return { ok: false, error: `Shopify did not issue a token (${status}).` };

  // A write scope includes its read scope.
  const granted = new Set(credentials.scopes.flatMap((s) => (s.startsWith("write_") ? [s, s.replace("write_", "read_")] : [s])));
  const missingScopes = SHOPIFY_SCOPES.filter((s) => !granted.has(s));
  return { ok: true, credentials, missingScopes };
}

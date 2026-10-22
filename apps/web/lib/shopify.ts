import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { ShopifyAdapter, appConfigFromEnv, shopifyOAuth } from "@store-ops/adapters";
import { dbForUser, isUniqueViolation } from "@store-ops/db";
import { encryptJson } from "@store-ops/shared/crypto";
import { ensureDefaultJobs } from "@store-ops/tools";

const STATE_COOKIE = "so_shopify_oauth";

interface InstallState {
  state: string;
  shop: string;
  uid: string;
}
const STATE_TTL_SECONDS = 10 * 60;

function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3100").replace(/\/$/, "");
}

export function shopifyRedirectUri(): string {
  return `${appUrl()}/api/shopify/callback`;
}

function secret(): Uint8Array {
  return new TextEncoder().encode(process.env.SESSION_SECRET);
}

/** Scopes to request: what the tools need, plus SHOPIFY_EXTRA_SCOPES (e.g. write_products to seed a dev store). */
function requestedScopes(): string[] {
  const extra = (process.env.SHOPIFY_EXTRA_SCOPES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return [...new Set([...shopifyOAuth.SHOPIFY_SCOPES, ...extra])];
}

/**
 * Starts the install: remembers who asked and for which shop in a signed,
 * short-lived cookie, and returns Shopify's authorize URL.
 */
export async function startShopifyInstall(userId: string, shopInput: string): Promise<{ url: string } | { error: string }> {
  const app = appConfigFromEnv();
  if (!app) return { error: "Shopify is not set up on this server (SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET)." };
  const shop = shopifyOAuth.normalizeShopDomain(shopInput);
  if (!shop) return { error: "Enter your store's myshopify.com address, like rashmi-studio.myshopify.com." };

  const state = shopifyOAuth.newOAuthState();
  const token = await new SignJWT({ state, shop, uid: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${STATE_TTL_SECONDS}s`)
    .sign(secret());
  (await cookies()).set(STATE_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax", // sent on Shopify's top-level redirect back to us
    path: "/api/shopify",
    maxAge: STATE_TTL_SECONDS,
  });
  return { url: shopifyOAuth.authorizeUrl({ shop, app, redirectUri: shopifyRedirectUri(), state, scopes: requestedScopes() }) };
}

/**
 * Finishes the install for the signed-in owner: verifies the callback,
 * stores the encrypted tokens, and creates (or reconnects) the store.
 * Returns the store id, and whether the store is new (rather than reconnected).
 */
export async function finishShopifyInstall(userId: string, params: URLSearchParams): Promise<{ storeId: string; isNew: boolean } | { error: string }> {
  const app = appConfigFromEnv();
  if (!app) return { error: "Shopify is not set up on this server." };

  const jar = await cookies();
  const raw = jar.get(STATE_COOKIE)?.value;
  jar.delete({ name: STATE_COOKIE, path: "/api/shopify" });
  let expected: InstallState | null = null;
  try {
    expected = raw ? ((await jwtVerify(raw, secret(), { algorithms: ["HS256"] })).payload as unknown as InstallState) : null;
  } catch {
    expected = null;
  }
  if (!expected || expected.uid !== userId || expected.shop !== params.get("shop")) {
    return { error: "The connection request expired or was started by someone else. Try again." };
  }

  const result = await shopifyOAuth.completeOAuth({ params, expectedState: expected.state, app });
  if (!result.ok) return { error: result.error };
  const { credentials, missingScopes } = result;

  const adapter = new ShopifyAdapter(credentials, { app });
  const info = await adapter.shop();
  const db = dbForUser(userId);
  const existing = await db.store.findFirst({ where: { platform: "SHOPIFY", externalId: credentials.shop } });

  let storeId: string;
  try {
    if (existing) {
      storeId = existing.id;
      await db.storeConnection.upsert({
        where: { storeId },
        create: { storeId, credentialsEncrypted: encryptJson(credentials), scopes: credentials.scopes },
        update: { credentialsEncrypted: encryptJson(credentials), scopes: credentials.scopes, status: "ACTIVE", lastError: null, connectedAt: new Date() },
      });
    } else {
      storeId = (
        await db.store.create({
          data: {
            ownerId: userId,
            platform: "SHOPIFY",
            externalId: credentials.shop,
            name: info.name,
            currency: info.currency,
            timezone: info.timezone,
            connection: { create: { credentialsEncrypted: encryptJson(credentials), scopes: credentials.scopes } },
          },
        })
      ).id;
    }
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { error: "This Shopify store is already connected to another account." };
    }
    throw err;
  }

  let webhooks = "not available (the app needs a public HTTPS APP_URL)";
  if ((await adapter.capabilities()).includes("webhooks")) {
    try {
      await adapter.subscribeWebhooks(["order.created", "order.updated", "product.low_stock"]);
      webhooks = "subscribed";
    } catch (err) {
      webhooks = `failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  await db.auditLog.create({
    data: {
      storeId,
      actor: `user:${userId}`,
      action: existing ? "store.reconnected" : "store.connected",
      after: { platform: "SHOPIFY", shop: credentials.shop, scopes: credentials.scopes, missingScopes, webhooks },
    },
  });
  await ensureDefaultJobs(db, storeId);
  return { storeId, isNew: !existing };
}

"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { AVAILABLE_PLATFORMS, WooAdapter, WooCredentials, createAdapter, testConnection } from "@store-ops/adapters";
import { dbForUser, isUniqueViolation } from "@store-ops/db";
import { Platform } from "@store-ops/shared";
import { encryptJson } from "@store-ops/shared/crypto";
import { adapterForStore, ensureDefaultJobs, webhookUrlFor } from "@store-ops/tools";
import { requireUser } from "./session";
import { startShopifyInstall } from "./shopify";
import type { FormState } from "./auth-actions";

const ConnectStoreInput = z.object({
  name: z.string().trim().min(1, "Give the store a name").max(100),
  platform: Platform.refine((p) => AVAILABLE_PLATFORMS.includes(p), "This platform is not available yet"),
  currency: z.string().trim().toUpperCase().length(3, "Use a 3-letter currency code, like INR"),
  timezone: z.string().refine(isTimeZone, "Unknown time zone"),
  connectionString: z.string().trim().startsWith("postgres", "Paste a postgres:// connection string"),
});

const ConnectCustomInput = ConnectStoreInput.omit({ connectionString: true }).extend({
  baseUrl: z.url("Enter the connector's base URL, like https://shop.example.com/store-ops/v1").trim(),
  apiKey: z.string().trim().min(16, "The API key must be at least 16 characters"),
});

function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Creates a store and saves its connection — but only after the adapter has
 * answered with valid data. Credentials are encrypted before they are stored
 * and never leave the server.
 */
export async function connectStore(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  if (form.get("platform") === "SHOPIFY") {
    // Shopify stores connect through Shopify's own approval screen.
    const result = await startShopifyInstall(user.id, String(form.get("shop") ?? ""));
    if ("error" in result) return { error: result.error };
    redirect(result.url);
  }
  if (form.get("platform") === "WOOCOMMERCE") return connectWooCommerce(user.id, form);
  const custom = form.get("platform") === "CUSTOM_REST";
  const parsed = (custom ? ConnectCustomInput : ConnectStoreInput).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const { name, platform, currency, timezone } = parsed.data;

  const credentials =
    "baseUrl" in parsed.data
      ? { baseUrl: parsed.data.baseUrl, apiKey: parsed.data.apiKey }
      : { connectionString: (parsed.data as z.infer<typeof ConnectStoreInput>).connectionString };
  const adapter = createAdapter(platform, credentials);
  let capabilities: string[];
  try {
    const result = await testConnection(adapter);
    if (!result.ok) return { error: `Could not connect to the store: ${result.error}` };
    capabilities = await adapter.capabilities();
  } finally {
    await adapter.close();
  }

  const db = dbForUser(user.id);
  const store = await db.store.create({
    data: {
      ownerId: user.id,
      platform,
      name,
      currency,
      timezone,
      connection: {
        create: { credentialsEncrypted: encryptJson(credentials), scopes: capabilities },
      },
    },
  });
  await db.auditLog.create({
    data: { storeId: store.id, actor: `user:${user.id}`, action: "store.connected", after: { platform, capabilities } },
  });
  await ensureDefaultJobs(db, store.id);
  redirect(`/stores/${store.id}`);
}

const ConnectWooInput = z.object({
  name: z.string().trim().min(1, "Give the store a name").max(100),
  timezone: z.string().refine(isTimeZone, "Unknown time zone"),
  url: z.url("Enter the store's address, like https://shop.example.com").trim(),
  consumerKey: z.string().trim().startsWith("ck_", "The consumer key starts with ck_"),
  consumerSecret: z.string().trim().startsWith("cs_", "The consumer secret starts with cs_"),
});

/**
 * Connects a WooCommerce store with REST API keys (read/write), after a test
 * call. Then subscribes webhooks; the adapter creates their signing secret and
 * it is saved with the keys.
 */
async function connectWooCommerce(userId: string, form: FormData): Promise<FormState> {
  const parsed = ConnectWooInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const { name, timezone, url, consumerKey, consumerSecret } = parsed.data;
  const credentials = WooCredentials.parse({ url, consumerKey, consumerSecret, webhookSecret: null });

  const adapter = new WooAdapter(credentials);
  let currency: string;
  try {
    const result = await testConnection(adapter);
    if (!result.ok) return { error: `Could not connect to the store: ${result.error}` };
    currency = await adapter.storeCurrency();
  } finally {
    await adapter.close();
  }

  const db = dbForUser(userId);
  let store;
  try {
    store = await db.store.create({
      data: {
        ownerId: userId,
        platform: "WOOCOMMERCE",
        externalId: credentials.url,
        name,
        currency,
        timezone,
        connection: { create: { credentialsEncrypted: encryptJson(credentials), scopes: await adapter.capabilities() } },
      },
      include: { connection: true },
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { error: "This WooCommerce store is already connected." };
    throw err;
  }

  let webhooks = "not available (set APP_URL or WEBHOOK_BASE_URL)";
  if (webhookUrlFor(store)) {
    try {
      await adapterForStore(store, store.connection!.credentialsEncrypted).subscribeWebhooks(["order.created", "order.updated", "product.low_stock"]);
      webhooks = "subscribed";
    } catch (err) {
      webhooks = `failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  await db.auditLog.create({
    data: { storeId: store.id, actor: `user:${userId}`, action: "store.connected", after: { platform: "WOOCOMMERCE", url: credentials.url, webhooks } },
  });
  await ensureDefaultJobs(db, store.id);
  redirect(`/stores/${store.id}`);
}

"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { AVAILABLE_PLATFORMS, createAdapter, testConnection } from "@store-ops/adapters";
import { dbForUser } from "@store-ops/db";
import { Platform } from "@store-ops/shared";
import { encryptJson } from "@store-ops/shared/crypto";
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
  const parsed = ConnectStoreInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const { name, platform, currency, timezone, connectionString } = parsed.data;

  const credentials = { connectionString };
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
  redirect(`/stores/${store.id}`);
}

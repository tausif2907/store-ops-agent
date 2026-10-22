import { PrismaClient } from "@prisma/client";

export * from "@prisma/client";

/**
 * True for a unique-constraint violation. Checks the error code rather than
 * `instanceof`, which fails when bundlers load two copies of Prisma's classes.
 */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null;
  return e?.code === "P2002" || (e?.code === "P2010" && /23505/.test(String(e.message))) || /23505|unique constraint/i.test(String(e?.message ?? ""));
}

/**
 * The runtime connects as the non-owner `storeops_app` role (APP_DATABASE_URL),
 * so Row-Level Security applies to every query. Each query runs in a short
 * transaction that first sets the tenant context:
 *   app.user_id  — the signed-in owner (dashboard requests)
 *   app.store_id — a single store (agent runs and background jobs)
 * With neither set, tenant tables return nothing.
 */

const globalForPrisma = globalThis as unknown as { storeOpsPrisma?: PrismaClient };

function appUrl(): string {
  const url = process.env.APP_DATABASE_URL;
  if (!url) throw new Error("APP_DATABASE_URL is not set");
  return url;
}

/** The unscoped client. Created on first use, so importing this package never needs a database. */
export function basePrisma(): PrismaClient {
  return (globalForPrisma.storeOpsPrisma ??= new PrismaClient({ datasourceUrl: appUrl() }));
}

export type TenantContext = { userId: string; storeId?: never } | { storeId: string; userId?: never };

function scoped(ctx: TenantContext) {
  const key = ctx.userId ? "app.user_id" : "app.store_id";
  const value = ctx.userId ?? ctx.storeId;
  const prisma = basePrisma();
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const [, result] = await prisma.$transaction([
            prisma.$executeRaw`SELECT set_config(${key}, ${value}, TRUE)`,
            query(args),
          ]);
          return result;
        },
      },
    },
  });
}

/** Prisma client scoped to one signed-in owner's stores. */
export function dbForUser(userId: string) {
  return scoped({ userId });
}

/** Prisma client scoped to a single store (agent runs, worker jobs). */
export function dbForStore(storeId: string) {
  return scoped({ storeId });
}

export type ScopedDb = ReturnType<typeof dbForUser>;

/** The owner's contact details, for a store-scoped caller (agent, MCP, worker). */
export async function storeOwnerContact(storeId: string): Promise<{ email: string; name: string } | null> {
  const prisma = basePrisma();
  const [, rows] = await prisma.$transaction([
    prisma.$executeRaw`SELECT set_config('app.store_id', ${storeId}, TRUE)`,
    prisma.$queryRaw<{ email: string; name: string }[]>`SELECT email, name FROM app_store_owner_contact()`,
  ]);
  return rows[0] ?? null;
}

/** The store a platform webhook belongs to, found by the platform's own store id. */
export async function storeIdForExternal(platform: "SHOPIFY" | "WOOCOMMERCE" | "CUSTOM_REST" | "SUPABASE", externalId: string): Promise<string | null> {
  const rows = await basePrisma().$queryRaw<{ id: string | null }[]>`
    SELECT app_store_for_external(${platform}::"Platform", ${externalId})::text AS id`;
  return rows[0]?.id ?? null;
}

/** Stores with an active connection, for the job worker. Ids only. */
export async function connectedStoreIds(): Promise<string[]> {
  const rows = await basePrisma().$queryRaw<{ id: string }[]>`SELECT id::text AS id FROM app_connected_store_ids()`;
  return rows.map((r) => r.id);
}

/** Stores with webhook events the worker has not handled yet. Ids only. */
export async function storesWithPendingWebhooks(): Promise<string[]> {
  const rows = await basePrisma().$queryRaw<{ id: string }[]>`SELECT id::text AS id FROM app_stores_with_pending_webhooks()`;
  return rows.map((r) => r.id);
}

// ---- Auth helpers --------------------------------------------------------
// Sign-up and login happen before there is a user context, so they go through
// SECURITY DEFINER functions that expose only what auth needs.

export interface LoginRecord {
  id: string;
  name: string;
  password_hash: string;
}

export async function findUserForLogin(email: string): Promise<LoginRecord | null> {
  const rows = await basePrisma().$queryRaw<LoginRecord[]>`
    SELECT id::text AS id, name, password_hash FROM app_find_user_for_login(${email.toLowerCase()})`;
  return rows[0] ?? null;
}

export async function createUser(email: string, name: string, passwordHash: string): Promise<string> {
  try {
    const rows = await basePrisma().$queryRaw<{ id: string }[]>`
      SELECT app_create_user(${email.toLowerCase()}, ${name}, ${passwordHash})::text AS id`;
    return rows[0]!.id;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new EmailTakenError();
    }
    throw err;
  }
}

/**
 * Replaces an account's password hash (the local set-password command).
 * Finds the user through the login lookup, then updates the row in that
 * user's own context, so Row-Level Security still applies. Returns false
 * when no account has this email.
 */
export async function setUserPasswordHash(email: string, passwordHash: string): Promise<boolean> {
  const user = await findUserForLogin(email);
  if (!user) return false;
  await dbForUser(user.id).user.update({ where: { id: user.id }, data: { passwordHash } });
  return true;
}

// ---- Password resets -----------------------------------------------------
// Before a reset there is no signed-in user, so these go through SECURITY
// DEFINER functions that store and check only a hash of the token.

/** Records a reset token for this email's account; returns who to email, or null when there is no such account. */
export async function createPasswordReset(email: string, tokenHash: string, expiresAt: Date): Promise<{ email: string; name: string } | null> {
  const rows = await basePrisma().$queryRaw<{ email: string; name: string }[]>`
    SELECT email, name FROM app_create_password_reset(${email.toLowerCase()}, ${tokenHash}, ${expiresAt})`;
  return rows[0] ?? null;
}

/** Uses a reset token once; returns its user id when it is valid and unexpired. */
export async function consumePasswordReset(tokenHash: string): Promise<string | null> {
  const rows = await basePrisma().$queryRaw<{ id: string | null }[]>`SELECT app_consume_password_reset(${tokenHash})::text AS id`;
  return rows[0]?.id ?? null;
}

// ---- Plans -------------------------------------------------------------------

export interface EntitlementRow {
  plan: string;
  planStatus: string;
  trialEndsAt: Date;
  planRenewsAt: Date | null;
  planStoreLimit: number | null;
  planAiAllowanceInr: number | null;
  storeCount: number;
  monthSpendInr: number;
}

async function entitlementIn(key: "app.user_id" | "app.store_id", value: string): Promise<EntitlementRow | null> {
  const prisma = basePrisma();
  const [, rows] = await prisma.$transaction([
    prisma.$executeRaw`SELECT set_config(${key}, ${value}, TRUE)`,
    prisma.$queryRaw<
      { plan: string; plan_status: string; trial_ends_at: Date; plan_renews_at: Date | null; plan_store_limit: number | null; plan_ai_allowance_inr: string | null; store_count: number; month_spend_inr: string }[]
    >`SELECT * FROM app_owner_entitlement()`,
  ]);
  const r = rows[0];
  if (!r) return null;
  return {
    plan: r.plan,
    planStatus: r.plan_status,
    trialEndsAt: r.trial_ends_at,
    planRenewsAt: r.plan_renews_at,
    planStoreLimit: r.plan_store_limit,
    planAiAllowanceInr: r.plan_ai_allowance_inr === null ? null : Number(r.plan_ai_allowance_inr),
    storeCount: r.store_count,
    monthSpendInr: Number(r.month_spend_inr),
  };
}

/** The plan and this month's usage of the owner of a store (agent runs, jobs). */
export function ownerEntitlementForStore(storeId: string) {
  return entitlementIn("app.store_id", storeId);
}

/** The signed-in owner's plan and usage (dashboard). */
export function ownerEntitlementForUser(userId: string) {
  return entitlementIn("app.user_id", userId);
}

/** The signed-in owner starts paying for a plan: remembers the subscription until billing confirms it. */
export async function startSubscription(userId: string, subscriptionId: string, plan: "starter" | "growth"): Promise<void> {
  const prisma = basePrisma();
  await prisma.$transaction([
    prisma.$executeRaw`SELECT set_config('app.user_id', ${userId}, TRUE)`,
    prisma.$executeRaw`SELECT app_start_subscription(${subscriptionId}, ${plan})`,
  ]);
}

/** Applies a verified billing event. Returns false when no account has this subscription. */
export async function applySubscriptionEvent(event: { subscriptionId: string; plan: string | null; status: string; renewsAt: Date | null }): Promise<boolean> {
  const rows = await basePrisma().$queryRaw<{ ok: boolean }[]>`
    SELECT app_apply_subscription_event(${event.subscriptionId}, ${event.plan}, ${event.status}, ${event.renewsAt}) AS ok`;
  return rows[0]?.ok === true;
}

export class EmailTakenError extends Error {
  constructor() {
    super("An account with this email already exists");
  }
}

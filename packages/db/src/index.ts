import { Prisma, PrismaClient } from "@prisma/client";

export * from "@prisma/client";

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
    if (err instanceof Prisma.PrismaClientKnownRequestError && /unique|23505/i.test(err.message)) {
      throw new EmailTakenError();
    }
    throw err;
  }
}

export class EmailTakenError extends Error {
  constructor() {
    super("An account with this email already exists");
  }
}

/**
 * Prepares a production database before migrations run: creates the
 * non-owner `storeops_app` role the services connect as (so Row-Level
 * Security always applies), or updates its password, from APP_DATABASE_URL.
 * Connects as the owner (DATABASE_URL). Locally, docker/platform-init.sql
 * does this instead.
 *
 *   pnpm db:setup   (this, then prisma migrate deploy)
 */
import { PrismaClient } from "@prisma/client";

const ROLE = "storeops_app";

function appCredentials(): { user: string; password: string } {
  const raw = process.env.APP_DATABASE_URL;
  if (!raw) throw new Error("APP_DATABASE_URL is not set");
  const url = new URL(raw);
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  // The RLS migrations grant to this role by name.
  if (user !== ROLE) throw new Error(`APP_DATABASE_URL must connect as ${ROLE}, not ${user || "(no user)"}`);
  if (password.length < 16) throw new Error("Give storeops_app a password of at least 16 characters in APP_DATABASE_URL");
  return { user, password };
}

const { password } = appCredentials();
const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
try {
  const { exists } = (await prisma.$queryRaw<{ exists: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${ROLE}) AS exists`)[0]!;
  // DDL takes no bind parameters, so let Postgres quote the password.
  const { sql } = (
    await prisma.$queryRaw<{ sql: string }[]>`
      SELECT format('%s ROLE storeops_app LOGIN PASSWORD %L', ${exists ? "ALTER" : "CREATE"}::text, ${password}::text) AS sql`
  )[0]!;
  await prisma.$executeRawUnsafe(sql);
  console.log(`${exists ? "Updated" : "Created"} role ${ROLE}.`);
} finally {
  await prisma.$disconnect();
}

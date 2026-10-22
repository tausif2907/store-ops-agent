/**
 * Puts an account on a plan by hand: Custom deals, comped accounts, or fixing
 * a billing mix-up. Runs as the database owner (DATABASE_URL); the app itself
 * cannot change plans except through verified billing events.
 *
 *   pnpm user:set-plan owner@example.com growth
 *   pnpm user:set-plan agency@example.com custom 10 5000   (stores, ₹ of AI usage a month)
 *   pnpm user:set-plan owner@example.com trial              (back to the trial)
 */
import { PrismaClient } from "@prisma/client";

const [email, plan, stores, allowance] = process.argv.slice(2);
const PLANS = ["trial", "starter", "growth", "custom"];
if (!email || !plan || !PLANS.includes(plan)) {
  console.error(`Usage: pnpm user:set-plan <email> <${PLANS.join("|")}> [store limit] [monthly AI allowance in ₹]`);
  process.exit(1);
}
const storeLimit = stores ? Number(stores) : null;
const allowanceInr = allowance ? Number(allowance) : null;
if ((storeLimit !== null && !(Number.isInteger(storeLimit) && storeLimit > 0)) || (allowanceInr !== null && !(allowanceInr > 0))) {
  console.error("The store limit must be a whole number above 0, and the allowance a number of rupees above 0.");
  process.exit(1);
}

const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
try {
  const status = plan === "trial" ? "trialing" : "active";
  const rows = await prisma.$queryRaw<{ ok: boolean }[]>`
    SELECT app_admin_set_plan(${email}, ${plan}, ${status}, ${storeLimit}::int, ${allowanceInr}::numeric) AS ok`;
  const ok = rows[0]?.ok === true;
  if (!ok) {
    console.error(`No account has the email ${email}.`);
    process.exitCode = 1;
  } else {
    console.log(`${email} is now on ${plan}${storeLimit ? `, ${storeLimit} stores` : ""}${allowanceInr ? `, ₹${allowanceInr} of AI usage a month` : ""}.`);
  }
} finally {
  await prisma.$disconnect();
}

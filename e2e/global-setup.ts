import { resetBoutique } from "@store-ops/adapters/supabase-seed";
import { JOB_TYPES, closeQueues, jobQueue } from "@store-ops/tools";
import { E2E_ENV, WEB_URL } from "./env";

/** Pages the tests visit, compiled once up front so a dev-server compile never eats an assertion's timeout. */
const WARM_PAGES = ["/", "/pricing", "/developers", "/signup", "/login", "/forgot-password", "/stores", "/stores/new"];

/** A fresh boutique to connect, no jobs left over from an earlier run, and warm pages. */
export default async function globalSetup() {
  const admin = process.env.BOUTIQUE_ADMIN_URL;
  if (!admin || !process.env.BOUTIQUE_AGENT_URL) throw new Error("BOUTIQUE_ADMIN_URL and BOUTIQUE_AGENT_URL are needed (see .env.example)");
  await resetBoutique(admin);

  process.env.REDIS_URL = E2E_ENV.REDIS_URL;
  for (const type of JOB_TYPES) await jobQueue(type).obliterate({ force: true });
  await closeQueues();

  for (const path of WARM_PAGES) await fetch(`${WEB_URL}${path}`, { redirect: "manual" });
}

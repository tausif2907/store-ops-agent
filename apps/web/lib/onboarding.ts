import "server-only";
import { startFirstDigest } from "@store-ops/tools";

/**
 * Where a newly connected store goes next: its welcome page, with the first
 * morning digest already on the way. Not a server action, so only code that
 * has just connected a store for its owner can start one.
 */
export async function welcomeUrl(storeId: string): Promise<string> {
  const jobId = await startFirstDigest(storeId);
  return `/stores/${storeId}/welcome${jobId ? `?job=${encodeURIComponent(jobId)}` : ""}`;
}

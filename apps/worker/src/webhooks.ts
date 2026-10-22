import { dbForStore, storesWithPendingWebhooks } from "@store-ops/db";
import { enqueueJobNow, type JobData, type JobType } from "@store-ops/tools";

/**
 * Turns stored platform webhooks into jobs. Stock and product changes start
 * a low-stock check right away instead of waiting for the next hourly run;
 * other events are marked handled (the scheduled jobs cover them).
 */

const STOCK_TOPICS = /^(product\.updated|products\/update|inventory_levels\/update)$/;

export async function processWebhookEvents(
  enqueue: (storeId: string, type: JobType, reason: JobData["reason"]) => Promise<unknown> = enqueueJobNow,
): Promise<number> {
  let handled = 0;
  for (const storeId of await storesWithPendingWebhooks()) {
    const db = dbForStore(storeId);
    const events = await db.webhookEvent.findMany({ where: { storeId, processedAt: null }, orderBy: { receivedAt: "asc" }, take: 200 });
    if (events.some((e) => STOCK_TOPICS.test(e.topic))) {
      const job = await db.job.findUnique({ where: { storeId_type: { storeId, type: "low_stock_watch" } } });
      if (job?.isEnabled) await enqueue(storeId, "low_stock_watch", "webhook");
    }
    await db.webhookEvent.updateMany({ where: { id: { in: events.map((e) => e.id) } }, data: { processedAt: new Date() } });
    handled += events.length;
  }
  return handled;
}

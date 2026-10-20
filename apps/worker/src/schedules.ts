import type { Queue } from "bullmq";
import { connectedStoreIds, dbForStore } from "@store-ops/db";
import { JOB_TYPES, ensureDefaultJobs, isValidSchedule, type JobData, type JobType } from "@store-ops/tools";

/**
 * Keeps BullMQ's job schedulers in line with the jobs table: one scheduler per
 * enabled job of a connected, unpaused store, firing on its cron pattern in
 * the store's time zone. Everything else is removed.
 */

export interface DesiredSchedule {
  id: string;
  type: JobType;
  storeId: string;
  pattern: string;
  tz: string;
}

export const schedulerId = (type: JobType, storeId: string) => `${type}:${storeId}`;

/** What should be scheduled, read store by store inside each store's own context. */
export async function desiredSchedules(storeIds?: string[]): Promise<DesiredSchedule[]> {
  const desired: DesiredSchedule[] = [];
  for (const storeId of storeIds ?? (await connectedStoreIds())) {
    const db = dbForStore(storeId);
    await ensureDefaultJobs(db, storeId);
    const store = await db.store.findUnique({ where: { id: storeId }, include: { jobs: true, connection: { select: { status: true } } } });
    if (!store || store.isPaused || store.connection?.status !== "ACTIVE") continue;
    for (const job of store.jobs) {
      if (!job.isEnabled || !(JOB_TYPES as readonly string[]).includes(job.type) || !isValidSchedule(job.schedule)) continue;
      const type = job.type as JobType;
      desired.push({ id: schedulerId(type, storeId), type, storeId, pattern: job.schedule, tz: store.timezone });
    }
  }
  return desired;
}

/** Applies `desired` to the queues; returns how many schedulers were added, changed and removed. */
export async function syncSchedules(
  queues: Record<JobType, Pick<Queue<JobData>, "getJobSchedulers" | "upsertJobScheduler" | "removeJobScheduler">>,
  desired: DesiredSchedule[],
): Promise<{ upserted: number; removed: number }> {
  let upserted = 0;
  let removed = 0;
  for (const type of JOB_TYPES) {
    const queue = queues[type];
    const want = new Map(desired.filter((d) => d.type === type).map((d) => [d.id, d]));
    const have = await queue.getJobSchedulers(0, -1);
    for (const s of have) {
      const id = s.id ?? s.key;
      const target = want.get(id);
      if (!target) {
        await queue.removeJobScheduler(id);
        removed++;
      } else if (s.pattern === target.pattern && s.tz === target.tz) {
        want.delete(id); // already right
      }
    }
    for (const s of want.values()) {
      await queue.upsertJobScheduler(
        s.id,
        { pattern: s.pattern, tz: s.tz },
        { name: type, data: { storeId: s.storeId, reason: "schedule" } },
      );
      upserted++;
    }
  }
  return { upserted, removed };
}

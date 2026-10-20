import { DelayedError, Worker } from "bullmq";
import type IORedis from "ioredis";
import type { RunDeps } from "@store-ops/agent/run";
import { queueName, type JobData, type JobType } from "@store-ops/tools";
import { lockStore } from "./lock";
import { processJob, type JobResult } from "./process";

/**
 * A BullMQ worker for one job type. Holds the store's lock while a job runs;
 * if another job holds it, the job is pushed back and retried shortly.
 */
export function createJobWorker(
  type: JobType,
  options: { connection: IORedis; deps: RunDeps; prefix?: string; concurrency?: number; lockedRetryMs?: number },
): Worker<JobData, JobResult> {
  return new Worker<JobData, JobResult>(
    queueName(type),
    async (job, token) => {
      const lock = await lockStore(options.connection, job.data.storeId);
      if (!lock) {
        await job.moveToDelayed(Date.now() + (options.lockedRetryMs ?? 30_000), token);
        throw new DelayedError();
      }
      try {
        return await processJob(type, job.data, options.deps);
      } finally {
        await lock.release();
      }
    },
    { connection: options.connection, prefix: options.prefix, concurrency: options.concurrency ?? 4 },
  );
}

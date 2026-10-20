import { runAgent, type RunDeps } from "@store-ops/agent/run";
import { dbForStore, type Prisma } from "@store-ops/db";
import { JOBS, adapterForStore, ensureDefaultJobs, type JobData, type JobType } from "@store-ops/tools";
import { emailOwner, storeUrl } from "./email";
import { PLANNERS } from "./jobs";

export type JobResult =
  | { status: "skipped"; reason: string }
  | { status: "ran"; runId: string; runStatus: string; draftsCreated: number; emailed: boolean };

/**
 * Runs one autonomous job for one store. The caller holds the store's lock.
 * Throws only for failures worth retrying (the store or Claude unreachable).
 */
export async function processJob(type: JobType, data: JobData, deps: RunDeps, now = new Date()): Promise<JobResult> {
  const def = JOBS[type];
  const db = dbForStore(data.storeId);
  const store = await db.store.findUnique({ where: { id: data.storeId }, include: { connection: true } });
  let job = await db.job.findUnique({ where: { storeId_type: { storeId: data.storeId, type } } });
  if (store && !job) {
    // A store connected before automations existed: give it the defaults.
    await ensureDefaultJobs(db, store.id);
    job = await db.job.findUnique({ where: { storeId_type: { storeId: data.storeId, type } } });
  }
  if (!store || !store.connection || store.connection.status !== "ACTIVE") return { status: "skipped", reason: "The store is not connected" };
  if (store.isPaused) return { status: "skipped", reason: "The store is paused" };
  if (!job || (!job.isEnabled && data.reason !== "manual")) return { status: "skipped", reason: "The job is turned off" };

  const adapter = adapterForStore(store, store.connection.credentialsEncrypted);
  try {
    const capabilities = await adapter.capabilities();
    if (!capabilities.includes(def.capability)) return { status: "skipped", reason: `The store does not support ${def.capability}` };

    const state = (job.state ?? {}) as Record<string, unknown>;
    const plan = await PLANNERS[type]({
      db,
      adapter,
      store: { id: store.id, name: store.name, timezone: store.timezone, currency: store.currency },
      capabilities,
      config: (job.config ?? {}) as Record<string, unknown>,
      state,
      now,
    });
    if (!plan.run) {
      await db.job.update({ where: { id: job.id }, data: { lastRunAt: now, ...(plan.state ? { state: plan.state as Prisma.InputJsonValue } : {}) } });
      return { status: "skipped", reason: plan.reason };
    }

    const outcome = await runAgent(
      { storeId: store.id, message: plan.message, history: [], trigger: data.reason === "webhook" ? "WEBHOOK" : "SCHEDULE", jobType: type },
      () => {},
      { ...deps, limits: { ...deps.limits, maxToolCalls: def.maxToolCalls, timeLimitMs: 120_000 } },
    );
    const draftsCreated = await db.draft.count({ where: { runId: outcome.runId } });
    await db.job.update({
      where: { id: job.id },
      data: { lastRunAt: now, ...(outcome.status === "SUCCEEDED" && plan.state ? { state: plan.state as Prisma.InputJsonValue } : {}) },
    });

    let emailed = false;
    if (outcome.status === "SUCCEEDED" && outcome.output) {
      const email = plan.email({ output: outcome.output, draftsCreated });
      if (email) {
        emailed = await emailOwner(store.id, store.name, email.subject, email.heading, outcome.output, {
          label: email.link.label,
          url: storeUrl(store.id, email.link.path),
        });
      }
    }
    return { status: "ran", runId: outcome.runId, runStatus: outcome.status, draftsCreated, emailed };
  } finally {
    await adapter.close();
  }
}

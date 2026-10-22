// Job worker: runs the autonomous jobs on each store's schedule, one run per store at a time.
import { anthropicModel, checkClaudeAccess } from "@store-ops/agent/anthropic-model";
import { connectMcpTools } from "@store-ops/agent/mcp-tools";
import { JOB_TYPES, closeQueues, jobQueue, redisConnection, type JobType } from "@store-ops/tools";
import { desiredSchedules, syncSchedules } from "./schedules";
import { processWebhookEvents } from "./webhooks";
import { createJobWorker } from "./workers";

const SYNC_EVERY_MS = 60_000;

const redis = redisConnection();
const deps = { model: anthropicModel(), connectTools: connectMcpTools };
const queues = Object.fromEntries(JOB_TYPES.map((t) => [t, jobQueue(t)])) as Record<JobType, ReturnType<typeof jobQueue>>;

const workers = JOB_TYPES.map((type) => {
  const worker = createJobWorker(type, { connection: redis, deps });
  worker.on("completed", (job, result) =>
    console.log(`${type} for ${job.data.storeId}: ${result.status === "ran" ? `run ${result.runId} ${result.runStatus}` : `skipped (${result.reason})`}`),
  );
  return worker;
});

for (const w of workers) {
  w.on("failed", (job, err) => console.error(`${w.name} job ${job?.id} failed:`, err.message));
}

async function tick() {
  try {
    const result = await syncSchedules(queues, await desiredSchedules());
    if (result.upserted || result.removed) console.log(`Schedules: ${result.upserted} set, ${result.removed} removed`);
    const events = await processWebhookEvents();
    if (events) console.log(`Webhook events handled: ${events}`);
  } catch (err) {
    console.error("Scheduler sync failed", err);
  }
}

void checkClaudeAccess().then((r) => (r.ok ? console.log(`Claude API key works with ${r.model}`) : console.error(`Automations will fail: ${r.message}`)));
await tick();
const timer = setInterval(tick, SYNC_EVERY_MS);
console.log(`Worker running ${JOB_TYPES.length} queues`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    clearInterval(timer);
    await Promise.all(workers.map((w) => w.close()));
    await closeQueues();
    process.exit(0);
  });
}

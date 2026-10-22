import { dbForUser } from "@store-ops/db";
import { queuedJobState, type QueuedJobState } from "@store-ops/tools";
import { getSessionUser } from "@/lib/session";

/**
 * Where a new store's first morning digest stands, for the welcome page to
 * poll: the run once the worker has started it, before that the queue job.
 */

export interface DigestStatus {
  state: "not_started" | "queued" | "running" | "done" | "failed" | "skipped";
  runId?: string;
  output?: string;
  /** Why it failed or was skipped. */
  reason?: string;
  startedAt?: string;
  finishedAt?: string;
  /** How long the job has waited for a worker, in seconds. */
  waitingSeconds?: number;
}

const QUEUE_TIMEOUT_MS = 3_000;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const db = dbForUser(user.id);
  const store = await db.store.findUnique({ where: { id }, select: { id: true, createdAt: true } });
  if (!store) return Response.json({ error: "Store not found" }, { status: 404 });

  const run = await db.agentRun.findFirst({
    where: { storeId: store.id, jobType: "morning_digest", createdAt: { gte: store.createdAt } },
    orderBy: { createdAt: "asc" },
    select: { id: true, status: true, output: true, error: true, startedAt: true, finishedAt: true },
  });
  if (run) {
    const times = { runId: run.id, startedAt: run.startedAt.toISOString(), finishedAt: run.finishedAt?.toISOString() };
    if (run.status === "RUNNING") return status({ state: "running", ...times });
    if (run.status === "SUCCEEDED") return status({ state: "done", output: run.output ?? "", ...times });
    return status({ state: "failed", reason: run.error ?? "The run did not finish.", ...times });
  }

  const jobId = new URL(req.url).searchParams.get("job");
  if (!jobId) return status({ state: "not_started" });
  let job: QueuedJobState;
  try {
    job = await Promise.race([
      queuedJobState("morning_digest", jobId, store.id),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), QUEUE_TIMEOUT_MS)),
    ]);
  } catch {
    return status({ state: "failed", reason: "The job queue cannot be reached right now." });
  }
  const waitingSeconds = job.queuedAt ? Math.round((Date.now() - job.queuedAt) / 1000) : undefined;
  switch (job.state) {
    case "queued":
      return status({ state: "queued", waitingSeconds });
    case "active":
    case "done": // finished a moment ago; the run row shows up on the next poll
      return status({ state: "running", waitingSeconds });
    case "skipped":
      return status({ state: "skipped", reason: job.reason });
    case "failed":
      return status({ state: "failed", reason: job.reason ?? "The job failed." });
    case "missing":
      return status({ state: "not_started" });
  }
}

function status(body: DigestStatus) {
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}

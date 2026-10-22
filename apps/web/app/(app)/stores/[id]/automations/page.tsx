import { dbForUser } from "@store-ops/db";
import { JOBS, JOB_TYPES, ensureDefaultJobs } from "@store-ops/tools";
import { formatDateTime } from "@/lib/format";
import { requireUser } from "@/lib/session";
import { saveAutomations } from "@/lib/automation-actions";
import { AutomationForm, type JobRow } from "./automation-form";

export default async function AutomationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const db = dbForUser(user.id);
  await ensureDefaultJobs(db, id);
  const store = await db.store.findUniqueOrThrow({ where: { id }, select: { id: true, timezone: true, jobs: true } });

  const rows: JobRow[] = JOB_TYPES.map((type) => {
    const job = store.jobs.find((j) => j.type === type)!;
    return {
      type,
      title: JOBS[type].title,
      description: JOBS[type].description,
      enabled: job.isEnabled,
      schedule: job.schedule,
      threshold: typeof (job.config as { threshold?: unknown }).threshold === "number" ? (job.config as { threshold: number }).threshold : 3,
      lastRun: job.lastRunAt ? formatDateTime(job.lastRunAt.toISOString(), store.timezone) : null,
    };
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        The agent runs these on its own, at times in your store&apos;s time zone ({store.timezone}). Every action still follows your{" "}
        <a className="text-brand hover:underline" href={`/stores/${store.id}/policies`}>rules</a>; drafts wait in your{" "}
        <a className="text-brand hover:underline" href={`/stores/${store.id}/inbox`}>inbox</a>.
      </p>
      <AutomationForm storeId={store.id} rows={rows} action={saveAutomations.bind(null, store.id)} />
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { dbForUser } from "@store-ops/db";
import { Markdown } from "@/components/markdown";
import { formatDateTime } from "@/lib/format";
import { requireUser } from "@/lib/session";
import { RunStatusBadge } from "../status-badge";

export default async function RunTracePage({ params }: { params: Promise<{ id: string; runId: string }> }) {
  const { id, runId } = await params;
  const user = await requireUser();
  const db = dbForUser(user.id);
  const run = await db.agentRun.findFirst({
    where: { id: runId, storeId: id },
    include: {
      store: { select: { name: true, timezone: true } },
      toolCalls: { orderBy: { createdAt: "asc" }, include: { approval: true } },
    },
  });
  if (!run) notFound();
  const tz = run.store.timezone;
  const seconds = run.finishedAt ? ((run.finishedAt.getTime() - run.startedAt.getTime()) / 1000).toFixed(1) : null;

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/stores/${id}/runs`} className="text-sm text-slate-500 hover:text-slate-800">← Run history</Link>
        <div className="mt-1 flex items-center gap-3">
          <h1 className="text-2xl font-semibold">Run trace</h1>
          <RunStatusBadge status={run.status} />
        </div>
        <p className="text-sm text-slate-500">
          {run.store.name} · {run.jobType ? `${run.jobType.replace(/_/g, " ")} (${run.trigger.toLowerCase()})` : run.trigger.toLowerCase()} ·{" "}
          {formatDateTime(run.startedAt.toISOString(), tz)}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Duration" value={seconds ? `${seconds}s` : "—"} />
        <Stat label="Tool calls" value={String(run.toolCalls.length)} />
        <Stat label="Tokens in / out" value={`${run.tokensIn.toLocaleString("en-IN")} / ${run.tokensOut.toLocaleString("en-IN")}`} />
        <Stat label="Cost" value={`₹${Number(run.costInr).toFixed(2)}`} />
      </div>

      <section className="card space-y-3">
        <div>
          <h2 className="text-xs font-medium uppercase tracking-wide text-slate-500">Request</h2>
          <p className="mt-1 text-sm whitespace-pre-wrap">{run.input ?? "—"}</p>
        </div>
        {run.output ? (
          <div>
            <h2 className="text-xs font-medium uppercase tracking-wide text-slate-500">Answer</h2>
            <div className="mt-1"><Markdown>{run.output}</Markdown></div>
          </div>
        ) : null}
        {run.error ? <p className="text-sm text-red-600">{run.error}</p> : null}
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Tool calls</h2>
        {run.toolCalls.length === 0 ? (
          <p className="text-sm text-slate-500">
            {run.status === "SUCCEEDED" ? "The agent answered without calling tools." : "No tools were called."}
          </p>
        ) : null}
        <ol className="space-y-2">
          {run.toolCalls.map((call, i) => (
            <li key={call.id} className="card p-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-slate-400">{i + 1}.</span>
                <span className="font-mono font-medium">{call.toolName}</span>
                <RunStatusBadge status={call.policyDecision} />
                {call.approval ? (
                  <span className="text-xs text-teal-700">approval {call.approval.status.toLowerCase()}: {call.approval.summary}</span>
                ) : null}
                <span className="ml-auto text-xs text-slate-400">{call.latencyMs ?? "—"} ms</span>
              </div>
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer text-slate-500">Arguments and result</summary>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  <pre className="max-h-64 overflow-auto rounded bg-slate-50 p-2">{JSON.stringify(call.args, null, 2)}</pre>
                  <pre className="max-h-64 overflow-auto rounded bg-slate-50 p-2">{JSON.stringify(call.result, null, 2)}</pre>
                </div>
              </details>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

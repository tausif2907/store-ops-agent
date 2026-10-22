import Link from "next/link";
import { notFound } from "next/navigation";
import { dbForUser } from "@store-ops/db";
import { formatDateTime } from "@/lib/format";
import { JOBS, budgetStatus, type JobType } from "@store-ops/tools";
import { setBudget } from "@/lib/automation-actions";
import { BudgetForm } from "./budget-form";
import { requireUser } from "@/lib/session";
import { RunStatusBadge } from "./status-badge";

export default async function RunsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const db = dbForUser(user.id);
  const store = await db.store.findUnique({ where: { id }, select: { id: true, name: true, timezone: true, monthlyBudgetInr: true } });
  if (!store) notFound();
  const [runs, budget] = await Promise.all([
    db.agentRun.findMany({
      where: { storeId: store.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { _count: { select: { toolCalls: true } } },
    }),
    budgetStatus(db, store.id),
  ]);

  return (
    <div className="space-y-4">
      <BudgetForm budget={{ ...budget, custom: store.monthlyBudgetInr !== null }} action={setBudget.bind(null, store.id)} />

      {runs.length === 0 ? (
        <div className="card text-sm text-slate-600">
          No runs yet. <Link className="text-brand hover:underline" href={`/stores/${store.id}/chat`}>Ask the agent something</Link>.
        </div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500">
              <tr className="border-b border-slate-200">
                <th className="px-4 py-2 font-normal">Started</th>
                <th className="px-4 py-2 font-normal">Request</th>
                <th className="px-4 py-2 font-normal">Status</th>
                <th className="px-4 py-2 text-right font-normal">Tools</th>
                <th className="px-4 py-2 text-right font-normal">Time</th>
                <th className="px-4 py-2 text-right font-normal">Cost</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2 whitespace-nowrap">
                    <Link href={`/stores/${store.id}/runs/${r.id}`} className="hover:underline">
                      {formatDateTime(r.startedAt.toISOString(), store.timezone)}
                    </Link>
                  </td>
                  <td className="max-w-xs truncate px-4 py-2">
                    {r.jobType && r.jobType in JOBS ? <span className="text-slate-600">{JOBS[r.jobType as JobType].title}</span> : (r.input ?? r.trigger.toLowerCase())}
                  </td>
                  <td className="px-4 py-2"><RunStatusBadge status={r.status} /></td>
                  <td className="px-4 py-2 text-right">{r._count.toolCalls}</td>
                  <td className="px-4 py-2 text-right">
                    {r.finishedAt ? `${((r.finishedAt.getTime() - r.startedAt.getTime()) / 1000).toFixed(1)}s` : "—"}
                  </td>
                  <td className="px-4 py-2 text-right">₹{Number(r.costInr).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

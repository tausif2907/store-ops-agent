import Link from "next/link";
import { dbForUser } from "@store-ops/db";
import { DecisionButtons } from "@/components/decision-buttons";
import { formatDateTime } from "@/lib/format";
import { decideFromDashboard } from "@/lib/policy-actions";
import { requireUser } from "@/lib/session";
import { RunStatusBadge } from "../runs/status-badge";

export default async function ApprovalsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const db = dbForUser(user.id);
  const store = await db.store.findUniqueOrThrow({ where: { id }, select: { id: true, timezone: true } });
  const inStore = { toolCall: { run: { storeId: store.id } } };
  const [pending, decided] = await Promise.all([
    db.approval.findMany({
      where: { ...inStore, status: "PENDING" },
      orderBy: { createdAt: "asc" },
      include: { toolCall: { select: { toolName: true, runId: true } } },
    }),
    db.approval.findMany({
      where: { ...inStore, status: { not: "PENDING" } },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { toolCall: { select: { toolName: true, runId: true } } },
    }),
  ]);

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="font-medium">Waiting for you</h2>
        {pending.length === 0 ? (
          <p className="card text-sm text-slate-600">Nothing to approve. Changes the agent proposes will appear here and in your email.</p>
        ) : (
          <ul className="space-y-3">
            {pending.map((a) => (
              <li key={a.id} className="card space-y-3">
                <div>
                  <p className="font-medium">{a.summary}</p>
                  {a.reason ? <p className="mt-1 text-sm text-teal-700">{a.reason}</p> : null}
                  <p className="mt-1 text-xs text-slate-500">
                    <span className="font-mono">{a.toolCall.toolName}</span> · proposed {formatDateTime(a.createdAt.toISOString(), store.timezone)} · expires{" "}
                    {formatDateTime(a.expiresAt.toISOString(), store.timezone)} ·{" "}
                    <Link className="hover:underline" href={`/stores/${store.id}/runs/${a.toolCall.runId}`}>see why</Link>
                  </p>
                </div>
                <details className="text-xs">
                  <summary className="cursor-pointer text-slate-500">Exact change</summary>
                  <pre className="mt-2 overflow-auto rounded bg-slate-50 p-2">{JSON.stringify(a.args, null, 2)}</pre>
                </details>
                <DecisionButtons decide={decideFromDashboard.bind(null, store.id, a.id)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Recent decisions</h2>
        {decided.length === 0 ? (
          <p className="text-sm text-slate-500">No decisions yet.</p>
        ) : (
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500">
                <tr className="border-b border-slate-200">
                  <th className="px-4 py-2 font-normal">Change</th>
                  <th className="px-4 py-2 font-normal">Outcome</th>
                  <th className="px-4 py-2 font-normal">When</th>
                </tr>
              </thead>
              <tbody>
                {decided.map((a) => (
                  <tr key={a.id} className="border-t border-slate-100 align-top">
                    <td className="px-4 py-2">
                      {a.summary}
                      {a.error ? <p className="text-xs text-red-600">{a.error}</p> : null}
                    </td>
                    <td className="px-4 py-2"><RunStatusBadge status={a.status} /></td>
                    <td className="whitespace-nowrap px-4 py-2 text-slate-500">
                      {formatDateTime((a.decidedAt ?? a.expiresAt).toISOString(), store.timezone)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

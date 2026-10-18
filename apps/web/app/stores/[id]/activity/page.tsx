import Link from "next/link";
import { dbForUser } from "@store-ops/db";
import { formatDateTime } from "@/lib/format";
import { requireUser } from "@/lib/session";

const ACTION_LABELS: Record<string, string> = {
  "store.connected": "Store connected",
  "store.paused": "Agent paused",
  "store.resumed": "Agent resumed",
  "policies.updated": "Rules changed",
  "approval.rejected": "Change rejected",
  update_order_status: "Order status changed",
  create_coupon: "Coupon created",
  update_stock: "Stock changed",
  reply_to_review: "Review reply posted",
};

/** The audit log: every change made to the store and to its rules, newest first. */
export default async function ActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const db = dbForUser(user.id);
  const store = await db.store.findUniqueOrThrow({ where: { id }, select: { id: true, timezone: true } });
  const entries = await db.auditLog.findMany({ where: { storeId: store.id }, orderBy: { createdAt: "desc" }, take: 100 });

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">Every change made to this store and to its rules. Entries cannot be edited or deleted.</p>
      {entries.length === 0 ? (
        <p className="card text-sm text-slate-600">No activity yet.</p>
      ) : (
        <ol className="card divide-y divide-slate-100 p-0">
          {entries.map((e) => {
            const runId = e.actor.startsWith("agent:run:") ? e.actor.slice("agent:run:".length) : null;
            const failed = e.action.endsWith(".failed");
            const label = ACTION_LABELS[e.action.replace(/\.failed$/, "")] ?? e.action;
            return (
              <li key={e.id} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className={`font-medium ${failed ? "text-red-700" : ""}`}>{failed ? `${label} — failed` : label}</span>
                  <span className="text-slate-500">
                    by{" "}
                    {runId ? (
                      <Link className="hover:underline" href={`/stores/${store.id}/runs/${runId}`}>the agent (automatic)</Link>
                    ) : e.actor === `user:${user.id}` ? (
                      isApproval(e.before) ? `you (approved${e.before.via === "email" ? " by email" : ""})` : "you"
                    ) : (
                      e.actor
                    )}
                  </span>
                  <span className="ml-auto text-xs text-slate-400">{formatDateTime(e.createdAt.toISOString(), store.timezone)}</span>
                </div>
                {e.before !== null || e.after !== null ? (
                  <details className="mt-1 text-xs">
                    <summary className="cursor-pointer text-slate-500">Details</summary>
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      <pre className="max-h-48 overflow-auto rounded bg-slate-50 p-2">{JSON.stringify(e.before, null, 2)}</pre>
                      <pre className="max-h-48 overflow-auto rounded bg-slate-50 p-2">{JSON.stringify(e.after, null, 2)}</pre>
                    </div>
                  </details>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function isApproval(before: unknown): before is { approvalId: string; via?: string } {
  return typeof before === "object" && before !== null && "approvalId" in before;
}

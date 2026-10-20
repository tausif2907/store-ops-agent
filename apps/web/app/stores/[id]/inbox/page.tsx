import Link from "next/link";
import { dbForUser } from "@store-ops/db";
import { formatDateTime } from "@/lib/format";
import { requireUser } from "@/lib/session";
import { DraftCard } from "./draft-card";

export default async function InboxPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const db = dbForUser(user.id);
  const store = await db.store.findUniqueOrThrow({ where: { id }, select: { id: true, timezone: true, connection: { select: { scopes: true } } } });
  const [pending, recent] = await Promise.all([
    db.draft.findMany({ where: { storeId: store.id, status: "PENDING" }, orderBy: { createdAt: "desc" } }),
    db.draft.findMany({ where: { storeId: store.id, status: { not: "PENDING" } }, orderBy: { decidedAt: "desc" }, take: 20 }),
  ]);
  const canPost = store.connection?.scopes.includes("reviews.write") ?? false;

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div>
          <h2 className="font-medium">Drafts waiting for you</h2>
          <p className="text-sm text-slate-500">The agent never messages customers or posts replies on its own. Edit, then send or post yourself.</p>
        </div>
        {pending.length === 0 ? (
          <p className="card text-sm text-slate-600">Nothing waiting. Drafts from the late-order and review automations appear here.</p>
        ) : (
          <ul className="space-y-3">
            {pending.map((d) => (
              <li key={d.id}>
                <DraftCard
                  storeId={store.id}
                  draft={{
                    id: d.id,
                    kind: d.kind,
                    targetLabel: d.targetLabel,
                    recipient: d.recipient as { name: string; email: string | null; phone: string | null } | null,
                    body: d.body,
                    created: formatDateTime(d.createdAt.toISOString(), store.timezone),
                    runId: d.runId,
                  }}
                  canPost={canPost}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {recent.length ? (
        <section className="space-y-2">
          <h2 className="font-medium">Recently handled</h2>
          <ul className="card divide-y divide-slate-100 p-0 text-sm">
            {recent.map((d) => (
              <li key={d.id} className="flex flex-wrap items-baseline gap-x-2 px-4 py-2">
                <span>{d.targetLabel}</span>
                <span className="text-slate-500">· {d.status.toLowerCase()}</span>
                {d.runId ? (
                  <Link className="text-xs text-slate-400 hover:underline" href={`/stores/${store.id}/runs/${d.runId}`}>why</Link>
                ) : null}
                <span className="ml-auto text-xs text-slate-400">{d.decidedAt ? formatDateTime(d.decidedAt.toISOString(), store.timezone) : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

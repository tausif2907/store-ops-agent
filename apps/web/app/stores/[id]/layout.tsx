import Link from "next/link";
import { notFound } from "next/navigation";
import { dbForUser } from "@store-ops/db";
import { expireStaleApprovals } from "@store-ops/tools";
import { PLATFORM_LABELS } from "@/lib/format";
import { setPaused } from "@/lib/policy-actions";
import { requireUser } from "@/lib/session";
import { StoreTabs } from "./store-tabs";

export default async function StoreLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const db = dbForUser(user.id);
  const store = await db.store.findUnique({ where: { id }, select: { id: true, name: true, platform: true, currency: true, timezone: true, isPaused: true } });
  if (!store) notFound();
  // Pending counts must not include approvals that quietly ran out of time.
  await expireStaleApprovals(store.id);
  const pending = await db.approval.count({ where: { status: "PENDING", toolCall: { run: { storeId: store.id } } } });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/stores" className="text-sm text-slate-500 hover:text-slate-800">← All stores</Link>
          <h1 className="mt-1 text-2xl font-semibold">{store.name}</h1>
          <p className="text-sm text-slate-500">{PLATFORM_LABELS[store.platform]} · {store.currency} · {store.timezone}</p>
        </div>
        <form action={setPaused.bind(null, store.id, !store.isPaused)}>
          {store.isPaused ? (
            <button className="btn">Resume the agent</button>
          ) : (
            <button className="inline-flex items-center rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 shadow-sm hover:bg-red-50">
              Pause the agent
            </button>
          )}
        </form>
      </div>

      {store.isPaused ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" role="status">
          <strong>Paused.</strong> The agent will not run and no changes will be made to this store until you resume it.
        </div>
      ) : null}

      <StoreTabs storeId={store.id} pendingApprovals={pending} />
      <div>{children}</div>
    </div>
  );
}

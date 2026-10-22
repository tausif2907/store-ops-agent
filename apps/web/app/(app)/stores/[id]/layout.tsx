import Link from "next/link";
import { notFound } from "next/navigation";
import { dbForUser } from "@store-ops/db";
import { expireStaleApprovals } from "@store-ops/tools";
import { Icon } from "@/components/site/icons";
import { PlatformIcon } from "@/components/platform-icon";
import { PLATFORM_LABELS } from "@/lib/format";
import { setPaused } from "@/lib/policy-actions";
import { requireUser } from "@/lib/session";
import { StoreTabs } from "./store-tabs";

export default async function StoreLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const db = dbForUser(user.id);
  const store = await db.store.findUnique({
    where: { id },
    select: { id: true, name: true, platform: true, currency: true, timezone: true, isPaused: true, connection: { select: { status: true } } },
  });
  if (!store) notFound();
  // Pending counts must not include approvals that quietly ran out of time.
  await expireStaleApprovals(store.id);
  const [pending, drafts] = await Promise.all([
    db.approval.count({ where: { status: "PENDING", toolCall: { run: { storeId: store.id } } } }),
    db.draft.count({ where: { storeId: store.id, status: "PENDING" } }),
  ]);
  const connected = store.connection?.status === "ACTIVE";

  return (
    <div className="space-y-5">
      <Link href="/stores" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-ink">
        <Icon name="arrowRight" className="h-3.5 w-3.5 rotate-180" /> All stores
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-4">
          <PlatformIcon platform={store.platform} size="lg" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink">{store.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              {store.isPaused ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-ink px-2.5 py-0.5 font-semibold text-white">
                  <span className="h-1.5 w-1.5 rounded-full bg-white" aria-hidden /> Agent paused
                </span>
              ) : connected ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 font-semibold text-green-700">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-600 motion-reduce:animate-none" aria-hidden /> Agent active
                </span>
              ) : (
                <span className="rounded-full bg-red-50 px-2.5 py-0.5 font-semibold text-red-700">Connection needs attention</span>
              )}
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-slate-600">{PLATFORM_LABELS[store.platform]}</span>
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-slate-600">{store.currency}</span>
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-slate-600">{store.timezone}</span>
            </div>
          </div>
        </div>
        <form action={setPaused.bind(null, store.id, !store.isPaused)}>
          {store.isPaused ? (
            <button className="btn"><Icon name="bolt" className="h-4 w-4" />Resume the agent</button>
          ) : (
            <button className="btn-danger"><Icon name="pause" className="h-4 w-4" />Pause the agent</button>
          )}
        </form>
      </div>

      {store.isPaused ? (
        <div className="flex items-start gap-3 rounded-xl border border-slate-300 bg-slate-900 px-4 py-3 text-sm text-white" role="status">
          <Icon name="pause" className="mt-0.5 h-4 w-4 shrink-0" />
          <p><strong>Paused.</strong> The agent will not run and no changes will be made to this store until you resume it.</p>
        </div>
      ) : null}

      <StoreTabs storeId={store.id} pendingApprovals={pending} pendingDrafts={drafts} />
      <div>{children}</div>
    </div>
  );
}

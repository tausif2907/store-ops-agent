import Link from "next/link";
import { redirect } from "next/navigation";
import { dbForUser } from "@store-ops/db";
import { PlatformIcon } from "@/components/platform-icon";
import { Icon } from "@/components/site/icons";
import { PLATFORM_LABELS } from "@/lib/format";
import { requireUser } from "@/lib/session";

export default async function StoresPage() {
  const user = await requireUser();
  const db = dbForUser(user.id);
  const stores = await db.store.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      connection: { select: { status: true } },
      _count: { select: { drafts: { where: { status: "PENDING" } } } },
    },
  });
  // Nothing connected yet: carry on with onboarding.
  if (stores.length === 0) redirect("/stores/new");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-teal-700">Welcome back, {user.name.split(" ")[0]}</p>
          <h1 className="text-3xl font-bold tracking-tight text-ink">Your stores</h1>
        </div>
        <Link href="/stores/new" className="btn"><Icon name="plug" className="h-4 w-4" />Connect a store</Link>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stores.map((store) => {
          const status = store.isPaused ? "PAUSED" : (store.connection?.status ?? "NOT_CONNECTED");
          return (
            <li key={store.id}>
              <Link href={`/stores/${store.id}`} className="group card flex h-full flex-col gap-4 transition hover:-translate-y-0.5 hover:border-green-300 hover:shadow-md">
                <div className="flex items-start justify-between gap-3">
                  <PlatformIcon platform={store.platform} />
                  <StatusBadge status={status} />
                </div>
                <div>
                  <p className="font-semibold text-ink group-hover:text-green-800">{store.name}</p>
                  <p className="mt-0.5 text-sm text-slate-500">{PLATFORM_LABELS[store.platform]} · {store.currency} · {store.timezone}</p>
                </div>
                <div className="mt-auto flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-500">
                  <span>{store._count.drafts ? `${store._count.drafts} draft${store._count.drafts === 1 ? "" : "s"} waiting` : "Nothing waiting"}</span>
                  <span className="flex items-center gap-1 font-medium text-green-700">Open <Icon name="arrowRight" className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" /></span>
                </div>
              </Link>
            </li>
          );
        })}
        <li>
          <Link href="/stores/new" className="flex h-full min-h-40 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 p-5 text-sm text-slate-500 transition hover:border-green-400 hover:bg-emerald-50/50 hover:text-green-800">
            <Icon name="plug" className="h-6 w-6" />
            Connect another store
          </Link>
        </li>
      </ul>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    ACTIVE: "bg-emerald-50 text-green-700",
    ERROR: "bg-red-50 text-red-700",
    REVOKED: "bg-slate-100 text-slate-600",
    PAUSED: "bg-ink text-white",
    NOT_CONNECTED: "bg-slate-100 text-slate-600",
  };
  const labels: Record<string, string> = { ACTIVE: "Active", ERROR: "Error", REVOKED: "Disconnected", PAUSED: "Paused", NOT_CONNECTED: "Not connected" };
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${styles[status] ?? styles.NOT_CONNECTED}`}>{labels[status] ?? status}</span>;
}

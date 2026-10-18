import Link from "next/link";
import { dbForUser } from "@store-ops/db";
import { requireUser } from "@/lib/session";
import { PLATFORM_LABELS } from "@/lib/format";

export default async function StoresPage() {
  const user = await requireUser();
  const stores = await dbForUser(user.id).store.findMany({
    orderBy: { createdAt: "asc" },
    include: { connection: { select: { status: true } } },
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Your stores</h1>
        <Link href="/stores/new" className="btn">Connect a store</Link>
      </div>
      {stores.length === 0 ? (
        <div className="card text-center">
          <p className="font-medium">No stores yet</p>
          <p className="mt-1 text-sm text-slate-600">Connect your first store and the agent can start answering questions about it.</p>
          <Link href="/stores/new" className="btn mt-4">Connect a store</Link>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {stores.map((store) => (
            <li key={store.id}>
              <Link href={`/stores/${store.id}`} className="card block hover:border-brand">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{store.name}</span>
                  <StatusBadge status={store.isPaused ? "PAUSED" : (store.connection?.status ?? "NOT_CONNECTED")} />
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  {PLATFORM_LABELS[store.platform]} · {store.currency} · {store.timezone}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    ACTIVE: "bg-emerald-50 text-emerald-700",
    ERROR: "bg-red-50 text-red-700",
    REVOKED: "bg-slate-100 text-slate-600",
    PAUSED: "bg-amber-50 text-amber-700",
    NOT_CONNECTED: "bg-slate-100 text-slate-600",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] ?? styles.NOT_CONNECTED}`}>
      {status.replace("_", " ").toLowerCase()}
    </span>
  );
}

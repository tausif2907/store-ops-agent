import Link from "next/link";
import { notFound } from "next/navigation";
import { isAdapterError } from "@store-ops/adapters";
import { dbForUser } from "@store-ops/db";
import type { Capability, Order, SalesSummary } from "@store-ops/shared";
import { JOBS, adapterForStore, type JobType } from "@store-ops/tools";
import { Markdown } from "@/components/markdown";
import { formatDateTime, formatMoney } from "@/lib/format";
import { requireUser } from "@/lib/session";

interface Snapshot {
  capabilities: Capability[];
  sales: SalesSummary;
  recentOrders: Order[];
  overdueCount: number;
  lowStockCount: number;
}

export default async function StorePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const store = await dbForUser(user.id).store.findUnique({ where: { id }, include: { connection: true } });
  if (!store) notFound();

  let snapshot: Snapshot | null = null;
  let error: string | null = null;
  if (store.connection) {
    const adapter = adapterForStore(store, store.connection.credentialsEncrypted);
    try {
      const to = new Date();
      const from = new Date(to.getTime() - 7 * 86_400_000);
      const [capabilities, sales, recent, overdue, lowStock] = await Promise.all([
        adapter.capabilities(),
        adapter.salesSummary(from.toISOString(), to.toISOString()),
        adapter.listOrders({ limit: 5 }),
        adapter.listOrders({ overdue: true, limit: 100 }),
        adapter.listProducts({ lowStockThreshold: 3, limit: 100 }),
      ]);
      snapshot = {
        capabilities,
        sales,
        recentOrders: recent.items,
        overdueCount: overdue.items.length,
        lowStockCount: lowStock.items.length,
      };
    } catch (err) {
      error = isAdapterError(err) ? `${err.code}: ${err.message}` : "The store did not respond";
    } finally {
      await adapter.close();
    }
  }

  // The latest result of each automation that reports to the owner.
  const reports = (
    await Promise.all(
      (["morning_digest", "weekly_report", "low_stock_watch"] as JobType[]).map((jobType) =>
        dbForUser(user.id).agentRun.findFirst({
          where: { storeId: store.id, jobType, status: "SUCCEEDED", output: { not: null } },
          orderBy: { createdAt: "desc" },
          select: { id: true, jobType: true, output: true, createdAt: true },
        }),
      ),
    )
  ).filter((r) => r !== null && Date.now() - r.createdAt.getTime() < 8 * 86_400_000);

  return (
    <div className="space-y-6">
      {!store.connection ? <div className="card text-sm">This store has no connection yet.</div> : null}
      {reports.length ? (
        <section className="space-y-2">
          <h2 className="font-medium">From the agent</h2>
          <div className="grid gap-3 lg:grid-cols-2">
            {reports.map((r) => (
              <article key={r!.id} className="card max-h-96 overflow-y-auto">
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <h3 className="text-sm font-medium">{JOBS[r!.jobType as JobType].title}</h3>
                  <Link href={`/stores/${store.id}/runs/${r!.id}`} className="text-xs text-slate-400 hover:underline">
                    {formatDateTime(r!.createdAt.toISOString(), store.timezone)}
                  </Link>
                </div>
                <Markdown>{r!.output!}</Markdown>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      {error ? (
        <div className="card border-red-200 bg-red-50 text-sm text-red-700" role="alert">
          Could not reach the store. {error}
        </div>
      ) : null}

      {snapshot ? (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="Sales, last 7 days" value={formatMoney(snapshot.sales.grossSales)} />
            <Stat label="Orders, last 7 days" value={String(snapshot.sales.orderCount)} />
            <Stat label="Overdue orders" value={String(snapshot.overdueCount)} warn={snapshot.overdueCount > 0} />
            <Stat label="Low-stock products" value={String(snapshot.lowStockCount)} warn={snapshot.lowStockCount > 0} />
          </div>

          <section className="card">
            <h2 className="mb-3 font-medium">Recent orders</h2>
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500">
                <tr>
                  <th className="pb-2 font-normal">Order</th>
                  <th className="pb-2 font-normal">Customer</th>
                  <th className="pb-2 font-normal">Status</th>
                  <th className="pb-2 font-normal">Placed</th>
                  <th className="pb-2 text-right font-normal">Total</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.recentOrders.map((o) => (
                  <tr key={o.id} className="border-t border-slate-100">
                    <td className="py-2 font-mono">{o.number}</td>
                    <td className="py-2">{o.customer.name}</td>
                    <td className="py-2">{o.status}</td>
                    <td className="py-2">{formatDateTime(o.createdAt, store.timezone)}</td>
                    <td className="py-2 text-right">{formatMoney(o.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="card">
            <h2 className="mb-2 font-medium">What the agent can do here</h2>
            <div className="flex flex-wrap gap-2">
              {snapshot.capabilities.map((c) => (
                <span key={c} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-700">{c}</span>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="card">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${warn ? "text-amber-600" : ""}`}>{value}</p>
    </div>
  );
}

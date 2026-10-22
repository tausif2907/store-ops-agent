import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { isAdapterError } from "@store-ops/adapters";
import { dbForUser } from "@store-ops/db";
import type { Capability, Order, OrderStatus } from "@store-ops/shared";
import { JOBS, adapterForStore, type JobType } from "@store-ops/tools";
import { Markdown } from "@/components/markdown";
import { Icon, type IconName } from "@/components/site/icons";
import { formatDateTime, formatMoney } from "@/lib/format";
import { requireUser } from "@/lib/session";

/**
 * The store's overview. Reports and quick links come from our own database
 * and show at once; the live figures are read from the store itself and
 * stream in when it answers.
 */
export default async function StorePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const db = dbForUser(user.id);
  const store = await db.store.findUnique({ where: { id }, include: { connection: true } });
  if (!store) notFound();

  // The latest result of each automation that reports to the owner.
  const reports = (
    await Promise.all(
      (["morning_digest", "weekly_report", "low_stock_watch"] as JobType[]).map((jobType) =>
        db.agentRun.findFirst({
          where: { storeId: store.id, jobType, status: "SUCCEEDED", output: { not: null } },
          orderBy: { createdAt: "desc" },
          select: { id: true, jobType: true, output: true, createdAt: true },
        }),
      ),
    )
  ).filter((r) => r !== null && Date.now() - r.createdAt.getTime() < 8 * 86_400_000);

  const base = `/stores/${store.id}`;
  return (
    <div className="space-y-6">
      {store.connection ? (
        <Suspense fallback={<SnapshotSkeleton />}>
          <LiveSnapshot store={store} credentialsEncrypted={store.connection.credentialsEncrypted} />
        </Suspense>
      ) : (
        <div className="card text-sm">This store has no connection yet.</div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {[
          { href: `${base}/chat`, icon: "chat" as IconName, title: "Ask the agent", body: "Sales, late orders, stock, coupons, reviews." },
          { href: `${base}/automations`, icon: "clock" as IconName, title: "Automations", body: "Digests and alerts on your schedule, or run one now." },
          { href: `${base}/policies`, icon: "sliders" as IconName, title: "Rules", body: "Choose what may run automatically, and the limits." },
        ].map((a) => (
          <Link key={a.href} href={a.href} className="group card flex items-start gap-4 transition hover:-translate-y-0.5 hover:border-green-300 hover:shadow-md">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-green-700 group-hover:bg-green-600 group-hover:text-white">
              <Icon name={a.icon} />
            </span>
            <span>
              <span className="flex items-center gap-1 font-semibold text-ink">
                {a.title} <Icon name="arrowRight" className="h-4 w-4 opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
              </span>
              <span className="text-sm text-slate-500">{a.body}</span>
            </span>
          </Link>
        ))}
      </div>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 font-semibold text-ink"><Icon name="sun" className="h-5 w-5 text-teal-600" />From the agent</h2>
        {reports.length ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {reports.map((r) => (
              <article key={r!.id} className="card flex max-h-[28rem] flex-col p-0">
                <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
                  <h3 className="text-sm font-semibold text-ink">{JOBS[r!.jobType as JobType].title}</h3>
                  <Link href={`${base}/runs/${r!.id}`} className="text-xs text-slate-400 hover:text-green-700 hover:underline">
                    {formatDateTime(r!.createdAt.toISOString(), store.timezone)}
                  </Link>
                </div>
                <div className="overflow-y-auto px-5 py-4">
                  <Markdown>{r!.output!}</Markdown>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="card flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
            <span>No reports yet this week. The morning digest arrives at 09:00 in your store&apos;s time zone.</span>
            <Link href={`${base}/automations`} className="btn-secondary btn-sm">Run it now</Link>
          </div>
        )}
      </section>
    </div>
  );
}

async function LiveSnapshot({ store, credentialsEncrypted }: {
  store: { id: string; platform: "SHOPIFY" | "WOOCOMMERCE" | "CUSTOM_REST" | "SUPABASE"; timezone: string };
  credentialsEncrypted: string;
}) {
  const adapter = adapterForStore(store, credentialsEncrypted);
  try {
    const capabilities = await adapter.capabilities();
    const can = (c: Capability) => capabilities.includes(c);
    const to = new Date();
    const from = new Date(to.getTime() - 7 * 86_400_000);
    const [sales, recent, overdue, lowStock] = await Promise.all([
      can("orders") ? adapter.salesSummary(from.toISOString(), to.toISOString()) : null,
      can("orders") ? adapter.listOrders({ limit: 6 }) : null,
      can("orders") ? adapter.listOrders({ overdue: true, limit: 100 }) : null,
      can("inventory") ? adapter.listProducts({ lowStockThreshold: 3, limit: 100 }) : null,
    ]);
    const base = `/stores/${store.id}`;
    return (
      <>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat icon="wallet" label="Sales, last 7 days" value={sales ? formatMoney(sales.grossSales) : "—"} tone="green" />
          <Stat icon="bag" label="Orders, last 7 days" value={sales ? String(sales.orderCount) : "—"} tone="ink" />
          <Stat icon="clock" label="Overdue orders" value={overdue ? `${overdue.items.length}${overdue.nextCursor ? "+" : ""}` : "—"} tone={overdue?.items.length ? "teal" : "ink"} href={`${base}/chat`} />
          <Stat icon="box" label="Low-stock products" value={lowStock ? `${lowStock.items.length}${lowStock.nextCursor ? "+" : ""}` : "—"} tone={lowStock?.items.length ? "teal" : "ink"} href={`${base}/chat`} />
        </div>

        {recent ? (
          <section className="card overflow-x-auto p-0">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <h2 className="font-semibold text-ink">Recent orders</h2>
              {sales?.topProducts[0] ? (
                <span className="hidden text-xs text-slate-500 sm:block">Top seller this week: <strong className="text-ink">{sales.topProducts[0].title}</strong></span>
              ) : null}
            </div>
            <table className="w-full min-w-[560px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Order</th>
                  <th className="px-5 py-2.5 font-medium">Customer</th>
                  <th className="px-5 py-2.5 font-medium">Status</th>
                  <th className="px-5 py-2.5 font-medium">Placed</th>
                  <th className="px-5 py-2.5 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {recent.items.map((o: Order) => (
                  <tr key={o.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                    <td className="px-5 py-3 font-mono text-xs font-semibold text-ink">{o.number}</td>
                    <td className="px-5 py-3">{o.customer.name}</td>
                    <td className="px-5 py-3"><OrderStatusChip status={o.status} /></td>
                    <td className="px-5 py-3 text-slate-500">{formatDateTime(o.createdAt, store.timezone)}</td>
                    <td className="px-5 py-3 text-right font-medium">{formatMoney(o.total)}</td>
                  </tr>
                ))}
                {recent.items.length === 0 ? (
                  <tr><td colSpan={5} className="px-5 py-6 text-center text-slate-500">No orders yet.</td></tr>
                ) : null}
              </tbody>
            </table>
          </section>
        ) : null}
      </>
    );
  } catch (err) {
    return (
      <div className="card flex items-start gap-3 border-red-200 bg-red-50 text-sm text-red-800" role="alert">
        <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0" />
        <span>Could not reach the store. {isAdapterError(err) ? `${err.code}: ${err.message}` : "It did not respond."}</span>
      </div>
    );
  } finally {
    await adapter.close();
  }
}

const STAT_TONES = {
  green: "bg-gradient-to-br from-green-600 to-teal-600 text-white",
  teal: "bg-teal-50 text-teal-700",
  ink: "bg-slate-100 text-slate-700",
} as const;

function Stat({ icon, label, value, tone, href }: { icon: IconName; label: string; value: string; tone: keyof typeof STAT_TONES; href?: string }) {
  const body = (
    <>
      <span className={`flex h-10 w-10 items-center justify-center rounded-lg ${STAT_TONES[tone]}`}><Icon name={icon} /></span>
      <span>
        <span className="block text-xs text-slate-500">{label}</span>
        <span className="block text-2xl font-bold tracking-tight text-ink">{value}</span>
      </span>
    </>
  );
  return href ? (
    <Link href={href} className="card flex items-center gap-4 transition hover:border-green-300 hover:shadow-md">{body}</Link>
  ) : (
    <div className="card flex items-center gap-4">{body}</div>
  );
}

const STATUS_STYLES: Record<OrderStatus, string> = {
  pending: "bg-slate-100 text-slate-700",
  processing: "bg-teal-50 text-teal-700",
  ready: "bg-emerald-50 text-emerald-700",
  shipped: "bg-green-100 text-green-800",
  delivered: "bg-green-600 text-white",
  cancelled: "bg-red-50 text-red-700",
  refunded: "bg-slate-200 text-slate-800",
};

function OrderStatusChip({ status }: { status: OrderStatus }) {
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[status]}`}>{status}</span>;
}

function SnapshotSkeleton() {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true" aria-label="Loading store figures">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card flex items-center gap-4">
            <div className="skeleton h-10 w-10" />
            <div className="space-y-2"><div className="skeleton h-3 w-24" /><div className="skeleton h-6 w-16" /></div>
          </div>
        ))}
      </div>
      <div className="card space-y-3">
        <div className="skeleton h-4 w-32" />
        {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-8 w-full" />)}
      </div>
    </>
  );
}

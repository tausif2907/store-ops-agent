import Link from "next/link";
import { notFound } from "next/navigation";
import { dbForUser } from "@store-ops/db";
import type { Capability } from "@store-ops/shared";
import { adapterForStore, describeSchedule } from "@store-ops/tools";
import { requireUser } from "@/lib/session";
import { FirstDigest } from "./first-digest";

const CAN_DO: Record<Capability, string> = {
  orders: "Read orders and sales",
  "orders.write": "Change order status, after you approve",
  inventory: "Check products and stock",
  "inventory.write": "Change stock levels, after you approve",
  coupons: "Read coupons and how they are used",
  "coupons.write": "Create coupons, after you approve",
  reviews: "Read reviews",
  "reviews.write": "Reply to reviews, after you approve",
  webhooks: "Hear about new orders and stock changes as they happen",
};

/** Where a newly connected store lands: its first digest, being written, and what to do next. */
export default async function WelcomePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ job?: string }> }) {
  const [{ id }, { job }] = await Promise.all([params, searchParams]);
  const user = await requireUser();
  const db = dbForUser(user.id);
  const [store, owner] = await Promise.all([
    db.store.findUnique({ where: { id }, include: { connection: true, jobs: { where: { type: "morning_digest" } } } }),
    db.user.findUnique({ where: { id: user.id }, select: { email: true, createdAt: true } }),
  ]);
  if (!store || !owner) notFound();

  let capabilities: Capability[] = [];
  if (store.connection) {
    const adapter = adapterForStore(store, store.connection.credentialsEncrypted);
    try {
      capabilities = await adapter.capabilities();
    } catch {
      // The digest below reports connection problems; the list is a nicety.
    } finally {
      await adapter.close();
    }
  }
  const digest = store.jobs[0];

  return (
    <div className="space-y-6">
      <FirstDigest storeId={store.id} jobId={job ?? null} signedUpAt={owner.createdAt.toISOString()} storeName={store.name} />

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card">
          <h2 className="font-medium">What the agent can do in {store.name}</h2>
          <ul className="mt-3 space-y-1.5 text-sm text-slate-700">
            {capabilities.map((c) => (
              <li key={c} className="flex gap-2">
                <span className="text-emerald-600" aria-hidden>✓</span>
                {CAN_DO[c]}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-slate-500">
            It cannot refund, change prices, delete anything or email customers: those are not tools. Messages it drafts wait in your inbox.
          </p>
        </section>

        <section className="card space-y-3">
          <h2 className="font-medium">Next</h2>
          <ul className="space-y-3 text-sm">
            <li>
              <Link className="font-medium text-brand hover:underline" href={`/stores/${store.id}/chat`}>Ask the agent a question</Link>
              <p className="text-slate-600">Try &ldquo;Which orders are running late?&rdquo; or &ldquo;What&apos;s low on stock?&rdquo;</p>
            </li>
            <li>
              <Link className="font-medium text-brand hover:underline" href={`/stores/${store.id}/policies`}>Set your rules</Link>
              <p className="text-slate-600">Every change asks you first. Switch the ones you trust to Automatic, with limits.</p>
            </li>
            <li>
              <Link className="font-medium text-brand hover:underline" href={`/stores/${store.id}/automations`}>Choose your automations</Link>
              <p className="text-slate-600">
                {digest?.isEnabled
                  ? `Your digest comes ${describeSchedule(digest.schedule).replace(/^Every/, "every")} (${store.timezone}), by email to ${owner.email}.`
                  : "Turn the morning digest, stock alerts and the weekly report on or off."}
              </p>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}

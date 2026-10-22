import Link from "next/link";
import { dbForUser } from "@store-ops/db";
import { PLANS, razorpayConfig, type PaidPlan } from "@store-ops/tools";
import { Icon } from "@/components/site/icons";
import { entitlementFor } from "@/lib/plan";
import { requireUser } from "@/lib/session";
import { CONTACT_EMAIL } from "@/lib/site";
import { CancelPlanButton, ChoosePlanButton } from "./billing-forms";

export const metadata = { title: "Plan and billing" };

const FEATURES: Record<PaidPlan, string[]> = {
  starter: ["1 connected store", "Chat, all five automations, approvals by email", "₹500 of AI usage each month"],
  growth: ["Up to 3 connected stores", "Everything in Starter", "₹1,500 of AI usage each month, shared", "Priority email support"],
};

const STATUS_LABEL: Record<string, string> = {
  trialing: "Free trial",
  pending: "Waiting for payment",
  active: "Active",
  past_due: "Payment being retried",
  halted: "Payment failed",
  cancelled: "Cancelled",
};

export default async function BillingPage() {
  const user = await requireUser();
  const [e, row] = await Promise.all([
    entitlementFor(user.id),
    dbForUser(user.id).user.findUniqueOrThrow({ where: { id: user.id }, select: { razorpaySubscriptionId: true } }),
  ]);
  if (!e) return null;
  const billing = razorpayConfig() !== null;
  const usedPct = Math.min(100, Math.round((e.monthSpendInr / e.aiAllowanceInr) * 100));
  const paidActive = e.plan.id !== "trial" && ["active", "past_due"].includes(e.status);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="text-sm font-medium text-teal-700">Account</p>
        <h1 className="text-3xl font-bold tracking-tight text-ink">Plan and billing</h1>
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 bg-gradient-to-r from-green-600 to-teal-600 px-6 py-5 text-white">
          <div>
            <p className="text-sm text-emerald-100">Your plan</p>
            <p className="text-2xl font-bold">{e.plan.name}</p>
          </div>
          <span className="rounded-full bg-white/15 px-3 py-1 text-sm font-semibold">{STATUS_LABEL[e.status] ?? e.status}</span>
        </div>
        <div className="grid gap-6 p-6 sm:grid-cols-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">{e.plan.id === "trial" ? "Trial" : "Renews"}</p>
            <p className="mt-1 text-lg font-semibold text-ink">
              {e.plan.id === "trial"
                ? e.trialDaysLeft
                  ? `${e.trialDaysLeft} day${e.trialDaysLeft === 1 ? "" : "s"} left`
                  : "Ended"
                : e.renewsAt
                  ? e.renewsAt.toLocaleDateString("en-IN", { dateStyle: "medium" })
                  : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Stores</p>
            <p className="mt-1 text-lg font-semibold text-ink">{e.storeCount} of {e.storeLimit}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">AI usage this month</p>
            <p className="mt-1 text-lg font-semibold text-ink">₹{e.monthSpendInr.toFixed(2)} of ₹{e.aiAllowanceInr.toFixed(0)}</p>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={usedPct} aria-valuemin={0} aria-valuemax={100} aria-label="AI usage">
              <div className={`h-full rounded-full ${e.allowanceUsed ? "bg-red-500" : "bg-gradient-to-r from-green-600 to-teal-500"}`} style={{ width: `${usedPct}%` }} />
            </div>
          </div>
        </div>
        {e.reason ? (
          <p className="mx-6 mb-6 flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
            <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0" />{e.reason}
          </p>
        ) : null}
      </section>

      {!billing ? (
        <p className="flex gap-2 rounded-xl border border-teal-200 bg-teal-50 p-4 text-sm text-teal-900">
          <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0" />
          Online payments aren&apos;t set up on this server yet (Razorpay keys). Write to {CONTACT_EMAIL} to choose a plan.
        </p>
      ) : null}

      <div className="grid gap-5 md:grid-cols-3">
        {(["starter", "growth"] as const).map((id) => {
          const plan = PLANS[id];
          const current = e.plan.id === id && paidActive;
          return (
            <div key={id} className={`card flex flex-col ${id === "growth" ? "border-2 border-green-600" : ""}`}>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-ink">{plan.name}</h2>
                {id === "growth" ? <span className="rounded-full bg-green-600 px-2.5 py-0.5 text-xs font-semibold text-white">Most popular</span> : null}
              </div>
              <p className="mt-3"><span className="text-3xl font-extrabold text-ink">₹{plan.priceInr!.toLocaleString("en-IN")}</span><span className="text-slate-500"> / month</span></p>
              <ul className="mt-4 flex-1 space-y-2 text-sm text-slate-700">
                {FEATURES[id].map((f) => (
                  <li key={f} className="flex gap-2"><Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />{f}</li>
                ))}
              </ul>
              <div className="mt-5">
                {current ? (
                  <span className="btn-secondary w-full cursor-default">Your plan</span>
                ) : (
                  <ChoosePlanButton plan={id} disabled={!billing || paidActive} label={paidActive ? "Write to us to switch" : `Choose ${plan.name}`} />
                )}
              </div>
            </div>
          );
        })}
        <div className="card flex flex-col bg-slate-50">
          <h2 className="text-lg font-bold text-ink">Custom</h2>
          <p className="mt-3 text-3xl font-extrabold text-ink">Let&apos;s talk</p>
          <p className="mt-4 flex-1 text-sm text-slate-600">More stores, help with a custom or Supabase store, and usage limits to suit you.</p>
          <Link href="/contact" className="btn-secondary mt-5">Contact us</Link>
        </div>
      </div>

      {paidActive && row.razorpaySubscriptionId ? (
        <section className="card flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-semibold text-ink">Cancel your plan</h2>
            <p className="text-sm text-slate-500">It stays active until the end of the period you&apos;ve paid for. Your stores and history stay.</p>
          </div>
          <CancelPlanButton />
        </section>
      ) : null}
      <p className="text-xs text-slate-500">Payments are handled by Razorpay; we never see your card details. Prices include no commission on your sales.</p>
    </div>
  );
}

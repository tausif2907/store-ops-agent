import Link from "next/link";
import { Wordmark } from "@/components/site/header";
import { AccountMenu } from "@/components/account-menu";
import { entitlementFor } from "@/lib/plan";
import { getSessionUser } from "@/lib/session";

/** The dashboard, sign-up, log-in and approval pages. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  const plan = user ? await entitlementFor(user.id) : null;
  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50/60 via-slate-50 to-slate-50">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
          <Link href={user ? "/stores" : "/"} aria-label="Store Ops Agent">
            <Wordmark />
          </Link>
          {user ? (
            <AccountMenu name={user.name} />
          ) : (
            <nav className="flex items-center gap-4 text-sm">
              <Link href="/login" className="text-slate-600 hover:text-ink">Log in</Link>
              <Link href="/signup" className="btn btn-sm">Get started</Link>
            </nav>
          )}
        </div>
      </header>
      {plan && (plan.reason || plan.plan.id === "trial") ? (
        <div className={`border-b text-sm ${plan.reason ? "border-red-200 bg-red-50 text-red-800" : "border-teal-100 bg-teal-50 text-teal-900"}`}>
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2">
            <span>
              {plan.reason ??
                `Free trial: ${plan.trialDaysLeft} day${plan.trialDaysLeft === 1 ? "" : "s"} left, with Starter's limits (1 store, ₹${plan.aiAllowanceInr.toFixed(0)} of AI usage a month).`}
            </span>
            <Link href="/account/billing" className="font-semibold underline-offset-2 hover:underline">{plan.reason ? "Choose a plan" : "See plans"}</Link>
          </div>
        </div>
      ) : null}
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}

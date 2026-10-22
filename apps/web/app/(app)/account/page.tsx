import Link from "next/link";
import { dbForUser } from "@store-ops/db";
import { Icon } from "@/components/site/icons";
import { requireUser } from "@/lib/session";
import { NameForm, PasswordForm, SessionsCard, TwoFactorCard } from "./account-forms";

export const metadata = { title: "Account and security" };

export default async function AccountPage() {
  const user = await requireUser();
  const row = await dbForUser(user.id).user.findUniqueOrThrow({
    where: { id: user.id },
    select: { email: true, name: true, totpEnabledAt: true, recoveryCodes: true },
  });
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-teal-700">Account</p>
          <h1 className="text-3xl font-bold tracking-tight text-ink">Account and security</h1>
        </div>
        <Link href="/account/billing" className="btn-secondary"><Icon name="wallet" className="h-4 w-4" />Plan and billing</Link>
      </div>

      <section className="card space-y-4">
        <h2 className="font-semibold text-ink">Profile</h2>
        <p className="text-sm text-slate-500">Signed in as <strong className="text-ink">{row.email}</strong></p>
        <NameForm name={row.name} />
      </section>

      <section className="card space-y-4">
        <h2 className="font-semibold text-ink">Password</h2>
        <PasswordForm />
      </section>

      <TwoFactorCard enabled={row.totpEnabledAt !== null} recoveryLeft={row.recoveryCodes.length} />
      <SessionsCard />
    </div>
  );
}

import Link from "next/link";
import { OnboardingSteps } from "@/components/onboarding-steps";
import { cannotAddStoreReason } from "@/lib/plan";
import { requireUser } from "@/lib/session";
import { ConnectStoreForm } from "./connect-store-form";

export default async function NewStorePage({ searchParams }: { searchParams: Promise<{ platform?: string; error?: string }> }) {
  const user = await requireUser();
  const [{ platform, error }, blocked] = await Promise.all([searchParams, cannotAddStoreReason(user.id)]);
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <OnboardingSteps current={2} />
      <div>
        <h1 className="text-2xl font-semibold">Connect your store</h1>
        <p className="mt-1 text-sm text-slate-600">
          Once it is connected, the agent reads through your store and writes your first morning digest, usually within a couple of minutes.
        </p>
      </div>
      {blocked ? (
        <div className="card space-y-4 border-teal-200 bg-teal-50">
          <p className="text-sm text-teal-900">{blocked}</p>
          <Link href="/account/billing" className="btn">See plans</Link>
        </div>
      ) : (
        <ConnectStoreForm initialPlatform={platform} initialError={error} />
      )}
    </div>
  );
}

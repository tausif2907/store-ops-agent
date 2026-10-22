import { OnboardingSteps } from "@/components/onboarding-steps";
import { requireUser } from "@/lib/session";
import { ConnectStoreForm } from "./connect-store-form";

export default async function NewStorePage({ searchParams }: { searchParams: Promise<{ platform?: string; error?: string }> }) {
  await requireUser();
  const { platform, error } = await searchParams;
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <OnboardingSteps current={2} />
      <div>
        <h1 className="text-2xl font-semibold">Connect your store</h1>
        <p className="mt-1 text-sm text-slate-600">
          Once it is connected, the agent reads through your store and writes your first morning digest, usually within a couple of minutes.
        </p>
      </div>
      <ConnectStoreForm initialPlatform={platform} initialError={error} />
    </div>
  );
}

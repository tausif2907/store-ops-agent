import { requireUser } from "@/lib/session";
import { ConnectStoreForm } from "./connect-store-form";

export default async function NewStorePage({ searchParams }: { searchParams: Promise<{ platform?: string; error?: string }> }) {
  await requireUser();
  const { platform, error } = await searchParams;
  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-1 text-2xl font-semibold">Connect a store</h1>
      <p className="mb-6 text-sm text-slate-600">
        We test the connection before saving anything. Credentials are encrypted and never shown to the AI model.
      </p>
      <ConnectStoreForm initialPlatform={platform} initialError={error} />
    </div>
  );
}

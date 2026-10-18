import Link from "next/link";
import { notFound } from "next/navigation";
import { dbForUser } from "@store-ops/db";
import { requireUser } from "@/lib/session";
import { Chat } from "./chat";

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const store = await dbForUser(user.id).store.findUnique({ where: { id }, select: { id: true, name: true, isPaused: true } });
  if (!store) notFound();

  return (
    <div className="flex h-[calc(100vh-9rem)] flex-col">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <Link href={`/stores/${store.id}`} className="text-sm text-slate-500 hover:text-slate-800">← {store.name}</Link>
          <h1 className="mt-1 text-2xl font-semibold">Ask the agent</h1>
        </div>
        <Link href={`/stores/${store.id}/runs`} className="text-sm text-brand hover:underline">Run history</Link>
      </div>
      {store.isPaused ? (
        <div className="card mb-4 border-amber-200 bg-amber-50 text-sm text-amber-800">This store is paused. The agent will not run until it is resumed.</div>
      ) : null}
      <Chat storeId={store.id} />
    </div>
  );
}

import { requireUser } from "@/lib/session";
import { Chat } from "./chat";

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireUser();
  return (
    <div className="flex h-[calc(100vh-19rem)] min-h-96 flex-col">
      <Chat storeId={id} />
    </div>
  );
}

import { z } from "zod";
import { dbForUser } from "@store-ops/db";
import { getSessionUser } from "@/lib/session";

/**
 * Streams a chat run for one of the signed-in owner's stores. The browser
 * never talks to the agent API directly: this handler checks ownership, then
 * relays the agent's server-sent events.
 */

const ChatRequest = z.object({
  message: z.string().trim().min(1).max(4000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) }))
    .max(20)
    .default([]),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

  // Same-origin only; the session cookie is SameSite=Lax as a second line.
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) {
    return Response.json({ error: "Cross-origin request" }, { status: 403 });
  }

  const { id } = await params;
  const store = await dbForUser(user.id).store.findUnique({ where: { id }, select: { id: true } });
  if (!store) return Response.json({ error: "Store not found" }, { status: 404 });

  const parsed = ChatRequest.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid message" }, { status: 400 });

  let upstream: Response;
  try {
    upstream = await fetch(`${process.env.AGENT_URL ?? "http://127.0.0.1:3200"}/runs`, {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.AGENT_INTERNAL_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ storeId: store.id, ...parsed.data }),
      signal: req.signal,
    });
  } catch {
    return Response.json({ error: "The agent service is not reachable" }, { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    return Response.json({ error: "The agent service rejected the request" }, { status: 502 });
  }

  return new Response(upstream.body, {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform" },
  });
}

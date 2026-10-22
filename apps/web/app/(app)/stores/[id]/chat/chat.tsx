"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { AgentEvent, ChatTurn } from "@store-ops/shared";
import { Markdown } from "@/components/markdown";
import { Icon } from "@/components/site/icons";

interface ToolActivity {
  id: string;
  name: string;
  status: "running" | "ok" | "pending_approval" | "error";
}

interface Message {
  role: "user" | "assistant";
  content: string;
  tools: ToolActivity[];
  runId?: string;
  error?: string;
  meta?: { costInr: number; toolCalls: number };
}

const SUGGESTIONS = [
  "How were sales yesterday?",
  "Which orders are running late?",
  "What's low on stock?",
  "Any bad reviews without a reply?",
];

const TOOL_LABELS: Record<string, string> = {
  search_orders: "Searching orders",
  get_order: "Reading an order",
  sales_summary: "Summarising sales",
  low_stock_products: "Checking stock",
  search_products: "Searching products",
  search_reviews: "Reading reviews",
  list_coupons: "Listing coupons",
  draft_customer_message: "Drafting a customer message",
  draft_review_reply: "Drafting a review reply",
  update_order_status: "Updating an order",
  create_coupon: "Creating a coupon",
  update_stock: "Updating stock",
  reply_to_review: "Replying to a review",
};

/** Parses a server-sent event stream into AgentEvents. */
async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<AgentEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let end: number;
    while ((end = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = chunk
        .split("\n")
        .filter((l) => l.startsWith("data: "))
        .map((l) => l.slice(6))
        .join("\n");
      if (data) yield JSON.parse(data) as AgentEvent;
    }
  }
}

export function Chat({ storeId }: { storeId: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const updateLast = (fn: (m: Message) => Message) =>
    setMessages((all) => [...all.slice(0, -1), fn(all[all.length - 1]!)]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    const history: ChatTurn[] = messages
      .filter((m) => m.content && !m.error)
      .slice(-10)
      .map((m) => ({ role: m.role, content: m.content }));
    setMessages((all) => [...all, { role: "user", content: message, tools: [] }, { role: "assistant", content: "", tools: [] }]);
    setInput("");
    setBusy(true);
    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const res = await fetch(`/api/stores/${storeId}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, history }),
        signal: abort.signal,
      });
      if (!res.ok || !res.body) {
        const { error } = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(error ?? "The agent could not be reached");
      }
      for await (const event of readEvents(res.body)) {
        switch (event.type) {
          case "run":
            updateLast((m) => ({ ...m, runId: event.runId }));
            break;
          case "text":
            updateLast((m) => ({ ...m, content: m.content + event.delta }));
            break;
          case "tool_call":
            updateLast((m) => ({ ...m, tools: [...m.tools, { id: event.id, name: event.name, status: "running" }] }));
            break;
          case "tool_result":
            updateLast((m) => ({ ...m, tools: m.tools.map((t) => (t.id === event.id ? { ...t, status: event.status } : t)) }));
            break;
          case "done":
            updateLast((m) => ({ ...m, meta: { costInr: event.costInr, toolCalls: event.toolCalls } }));
            break;
          case "error":
            updateLast((m) => ({ ...m, error: event.message }));
            break;
        }
      }
    } catch (err) {
      if (!abort.signal.aborted) updateLast((m) => ({ ...m, error: err instanceof Error ? err.message : "Something went wrong" }));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  return (
    <div className="card flex min-h-0 flex-1 flex-col overflow-hidden p-0">
      <div className="flex items-center gap-3 border-b border-slate-100 bg-gradient-to-r from-emerald-50 to-teal-50/60 px-5 py-3">
        <AgentAvatar />
        <div>
          <p className="text-sm font-semibold text-ink">Store agent</p>
          <p className="text-xs text-slate-500">Reads your store live. Changes wait for your approval.</p>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
        {messages.length === 0 ? (
          <div className="mx-auto max-w-lg py-8 text-center">
            <div className="mx-auto w-fit"><AgentAvatar large /></div>
            <p className="mt-4 text-lg font-semibold text-ink">What would you like to know?</p>
            <p className="mt-1 text-sm text-slate-500">Ask about orders, sales, stock, coupons or reviews. Changes to your store are saved for your approval first.</p>
            <div className="mt-6 grid gap-2 sm:grid-cols-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-sm text-slate-700 shadow-sm transition hover:border-green-400 hover:bg-emerald-50 hover:text-green-900"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-green-600 px-4 py-2.5 text-sm text-white shadow-sm">{m.content}</div>
            </div>
          ) : (
            <div key={i} className="flex max-w-[92%] gap-3">
              <AgentAvatar />
              <div className="min-w-0 flex-1 space-y-2">
                {m.tools.length > 0 ? (
                  <ul className="flex flex-wrap gap-1.5">
                    {m.tools.map((t) => (
                      <li key={t.id} className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600">
                        <StatusDot status={t.status} />
                        {TOOL_LABELS[t.name] ?? t.name}
                        {t.status === "pending_approval" ? (
                          <Link href={`/stores/${storeId}/approvals`} className="font-semibold text-teal-700 hover:underline">
                            · waiting for your approval
                          </Link>
                        ) : null}
                        {t.status === "error" ? <span className="text-red-600">· failed</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {m.content ? (
                  <div className="rounded-2xl rounded-tl-md border border-slate-200 bg-slate-50 px-4 py-3">
                    <Markdown>{m.content}</Markdown>
                  </div>
                ) : busy && i === messages.length - 1 ? (
                  <div className="flex w-fit items-center gap-1.5 rounded-2xl rounded-tl-md border border-slate-200 bg-slate-50 px-4 py-3" aria-label="Thinking">
                    {[0, 150, 300].map((d) => (
                      <span key={d} className="h-2 w-2 animate-bounce rounded-full bg-teal-500" style={{ animationDelay: `${d}ms` }} />
                    ))}
                  </div>
                ) : null}
                {m.error ? <p className="text-sm text-red-600" role="alert">{m.error}</p> : null}
                {m.runId && (m.meta || m.error) ? (
                  <p className="text-xs text-slate-400">
                    {m.meta ? `${m.meta.toolCalls} tool call${m.meta.toolCalls === 1 ? "" : "s"} · ₹${m.meta.costInr.toFixed(2)} · ` : ""}
                    <Link className="hover:text-green-700 hover:underline" href={`/stores/${storeId}/runs/${m.runId}`}>View trace</Link>
                  </p>
                ) : null}
              </div>
            </div>
          ),
        )}
        <div ref={bottomRef} />
      </div>

      <form
        className="flex gap-2 border-t border-slate-200 bg-white p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <input
          className="input rounded-xl py-2.5"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask the agent…"
          maxLength={4000}
          aria-label="Message"
        />
        {busy ? (
          <button type="button" className="btn-secondary" onClick={() => abortRef.current?.abort()}>Stop</button>
        ) : (
          <button className="btn rounded-xl" disabled={!input.trim()}>
            Send <Icon name="arrowRight" className="h-4 w-4" />
          </button>
        )}
      </form>
    </div>
  );
}

function AgentAvatar({ large = false }: { large?: boolean }) {
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-green-600 to-teal-600 text-white shadow-sm ${large ? "h-14 w-14" : "h-8 w-8"}`} aria-hidden>
      <Icon name="bolt" className={large ? "h-7 w-7" : "h-4 w-4"} />
    </span>
  );
}

function StatusDot({ status }: { status: ToolActivity["status"] }) {
  const color = {
    running: "bg-slate-400 animate-pulse",
    ok: "bg-emerald-500",
    pending_approval: "bg-teal-500",
    error: "bg-red-500",
  }[status];
  return <span className={`inline-block h-1.5 w-1.5 rounded-full ${color}`} />;
}

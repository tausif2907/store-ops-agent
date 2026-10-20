"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { decideDraft, type DraftDecision } from "@/lib/automation-actions";

interface Draft {
  id: string;
  kind: "CUSTOMER_MESSAGE" | "REVIEW_REPLY";
  targetLabel: string;
  recipient: { name: string; email: string | null; phone: string | null } | null;
  body: string;
  created: string;
  runId: string | null;
}

export function DraftCard({ storeId, draft, canPost }: { storeId: string; draft: Draft; canPost: boolean }) {
  const [body, setBody] = useState(draft.body);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const act = (decision: DraftDecision) => start(async () => setResult(await decideDraft(storeId, draft.id, decision, body)));
  const message = draft.kind === "CUSTOMER_MESSAGE";

  if (result?.ok) {
    return <div className="card text-sm text-emerald-700" role="status">{draft.targetLabel}: {result.message}</div>;
  }
  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium">{draft.targetLabel}</p>
        <p className="text-xs text-slate-500">
          {message ? "Message to the customer" : "Reply to the review"} · {draft.created}
          {draft.runId ? (
            <>
              {" · "}
              <Link className="hover:underline" href={`/stores/${storeId}/runs/${draft.runId}`}>see why</Link>
            </>
          ) : null}
        </p>
      </div>
      {message && draft.recipient ? (
        <p className="text-sm text-slate-600">
          To {draft.recipient.name}
          {draft.recipient.email ? ` · ${draft.recipient.email}` : ""}
          {draft.recipient.phone ? ` · ${draft.recipient.phone}` : ""}
        </p>
      ) : null}
      <textarea className="input min-h-28" value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} aria-label="Draft text" />
      {result && !result.ok ? <p className="text-sm text-red-600" role="alert">{result.message}</p> : null}
      <div className="flex flex-wrap gap-2">
        {message ? (
          <>
            <button type="button" className="btn-secondary" onClick={async () => {
              await navigator.clipboard.writeText(body);
              setCopied(true);
            }}>
              {copied ? "Copied" : "Copy text"}
            </button>
            <button type="button" className="btn" disabled={pending} onClick={() => act("SEND")}>Mark as sent</button>
          </>
        ) : canPost ? (
          <button type="button" className="btn" disabled={pending} onClick={() => act("POST")}>{pending ? "Posting…" : "Post reply"}</button>
        ) : (
          <span className="self-center text-xs text-slate-500">Post this reply in your store&apos;s admin; this store cannot take replies from here.</span>
        )}
        <button type="button" className="btn-secondary" disabled={pending} onClick={() => act("DISMISS")}>Dismiss</button>
      </div>
    </div>
  );
}

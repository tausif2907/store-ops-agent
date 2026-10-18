"use client";

import { useState, useTransition } from "react";
import type { DecisionResult } from "@store-ops/tools";

/** Approve / Reject for one pending change. Shows the outcome in place. */
export function DecisionButtons({ decide }: { decide: (decision: "APPROVE" | "REJECT") => Promise<DecisionResult> }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<DecisionResult | null>(null);

  if (result) {
    return (
      <p className={`text-sm ${result.ok ? "text-emerald-700" : "text-red-700"}`} role="status">
        {result.message}
      </p>
    );
  }
  return (
    <div className="flex gap-2">
      <button className="btn" disabled={pending} onClick={() => start(async () => setResult(await decide("APPROVE")))}>
        {pending ? "Working…" : "Approve"}
      </button>
      <button className="btn-secondary" disabled={pending} onClick={() => start(async () => setResult(await decide("REJECT")))}>
        Reject
      </button>
    </div>
  );
}

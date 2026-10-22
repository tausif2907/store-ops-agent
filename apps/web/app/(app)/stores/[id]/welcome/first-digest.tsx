"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import type { DigestStatus } from "@/app/api/stores/[id]/onboarding/route";
import { Markdown } from "@/components/markdown";
import { OnboardingSteps } from "@/components/onboarding-steps";
import { startWelcomeDigest } from "@/lib/automation-actions";

const POLL_MS = 2_500;
/** After this long in the queue, the worker is probably not running. */
const SLOW_QUEUE_SECONDS = 45;

function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} seconds` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
}

/** Polls the first digest until it is written, then shows it. */
export function FirstDigest({ storeId, jobId: initialJobId, signedUpAt, storeName }: { storeId: string; jobId: string | null; signedUpAt: string; storeName: string }) {
  const [jobId, setJobId] = useState(initialJobId);
  const [status, setStatus] = useState<DigestStatus | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, start] = useTransition();
  const finished = status?.state === "done" || status?.state === "failed" || status?.state === "skipped" || status?.state === "not_started";

  useEffect(() => {
    if (finished) return;
    let stopped = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/stores/${storeId}/onboarding${jobId ? `?job=${encodeURIComponent(jobId)}` : ""}`, { cache: "no-store" });
        if (res.ok && !stopped) setStatus((await res.json()) as DigestStatus);
      } catch {
        // Try again on the next tick.
      }
    };
    void poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [storeId, jobId, finished]);

  const retry = () =>
    start(async () => {
      setStartError(null);
      const result = await startWelcomeDigest(storeId);
      if ("error" in result) return setStartError(result.error);
      setStatus(null);
      setJobId(result.jobId);
    });

  const done = status?.state === "done";
  return (
    <div className="space-y-6">
      <OnboardingSteps current={3} complete={done} />
      <div>
        <h1 className="text-2xl font-semibold">{storeName} is connected</h1>
        <p className="mt-1 text-sm text-slate-600">
          {done ? "Here is what the agent found in your store." : "The agent is reading through your store to write your first morning digest."}
        </p>
      </div>

      <section className="card" aria-live="polite">
        {!status || status.state === "queued" || status.state === "running" ? (
          <div className="flex items-start gap-3 py-2">
            <span className="mt-1.5 inline-block h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-brand" aria-hidden />
            <div className="text-sm">
              <p className="font-medium">
                {status?.state === "running" ? "Writing your digest: yesterday's sales, orders due today, late orders and stock…" : "Starting the agent…"}
              </p>
              <p className="mt-0.5 text-slate-500">This usually takes a minute or two. You can leave this page; the digest will be on your overview and in your email.</p>
              {status?.state === "queued" && (status.waitingSeconds ?? 0) > SLOW_QUEUE_SECONDS ? (
                <p className="mt-2 text-teal-700">
                  This is taking longer than usual. If it does not start soon, the job worker may not be running.
                </p>
              ) : null}
            </div>
          </div>
        ) : done ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-medium">Your first morning digest</h2>
              <p className="text-xs text-slate-500">
                {status.finishedAt ? `Ready ${duration(Date.parse(status.finishedAt) - Date.parse(signedUpAt))} after you signed up · ` : ""}
                {status.runId ? (
                  <Link className="hover:underline" href={`/stores/${storeId}/runs/${status.runId}`}>see how it was made</Link>
                ) : null}
              </p>
            </div>
            <Markdown>{status.output ?? ""}</Markdown>
          </div>
        ) : (
          <div className="space-y-3 py-2 text-sm">
            <p className="font-medium">
              {status.state === "skipped"
                ? "The digest was skipped."
                : status.state === "not_started"
                  ? "Your first digest has not started yet."
                  : "The digest could not be written."}
            </p>
            {status.reason ? <p className="text-slate-600">{status.reason}</p> : null}
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="btn" disabled={starting} onClick={retry}>
                {starting ? "Starting…" : status.state === "not_started" ? "Write my first digest" : "Try again"}
              </button>
              {startError ? <span className="text-red-600" role="alert">{startError}</span> : null}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

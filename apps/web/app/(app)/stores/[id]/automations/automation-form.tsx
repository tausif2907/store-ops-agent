"use client";

import { useActionState, useState, useTransition } from "react";
import type { AutomationFormState } from "@/lib/automation-actions";
import { runJobNow } from "@/lib/automation-actions";
import type { JobType } from "@store-ops/tools";

export interface JobRow {
  type: JobType;
  title: string;
  description: string;
  enabled: boolean;
  schedule: string;
  threshold: number;
  lastRun: string | null;
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const INTERVALS = [
  { value: "*/15 * * * *", label: "Every 15 minutes" },
  { value: "*/30 * * * *", label: "Every 30 minutes" },
  { value: "0 * * * *", label: "Every hour" },
  { value: "0 */2 * * *", label: "Every 2 hours" },
  { value: "0 */4 * * *", label: "Every 4 hours" },
  { value: "0 */12 * * *", label: "Every 12 hours" },
];

/** Reads "M H * * D" into a time and a day ("*" for every day). */
function parseAt(cron: string): { time: string; day: string } {
  const m = /^(\d{1,2}) (\d{1,2}) \* \* (\*|[0-6])$/.exec(cron);
  if (!m) return { time: "09:00", day: "*" };
  return { time: `${m[2]!.padStart(2, "0")}:${m[1]!.padStart(2, "0")}`, day: m[3]! };
}

function atCron(time: string, day: string): string {
  const [h = "9", m = "0"] = time.split(":");
  return `${Number(m)} ${Number(h)} * * ${day}`;
}

function ScheduleField({ row }: { row: JobRow }) {
  const interval = row.type === "low_stock_watch" || row.type === "negative_review_response";
  const initial = parseAt(row.schedule);
  const [time, setTime] = useState(initial.time);
  const [day, setDay] = useState(row.type === "weekly_report" ? (initial.day === "*" ? "1" : initial.day) : "*");
  const [every, setEvery] = useState(INTERVALS.some((i) => i.value === row.schedule) ? row.schedule : "0 * * * *");

  if (interval) {
    return (
      <select className="input w-48" name={`${row.type}.schedule`} value={every} onChange={(e) => setEvery(e.target.value)} aria-label={`${row.title} schedule`}>
        {INTERVALS.map((i) => (
          <option key={i.value} value={i.value}>{i.label}</option>
        ))}
      </select>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <input type="hidden" name={`${row.type}.schedule`} value={atCron(time, day)} />
      {row.type === "weekly_report" ? (
        <select className="input w-36" value={day} onChange={(e) => setDay(e.target.value)} aria-label="Day">
          {DAYS.map((d, i) => (
            <option key={d} value={String(i)}>Every {d}</option>
          ))}
        </select>
      ) : (
        <span className="text-slate-600">Every day at</span>
      )}
      <input className="input w-28" type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label={`${row.title} time`} required />
    </div>
  );
}

function RunNow({ storeId, type }: { storeId: string; type: JobType }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      <button type="button" className="text-xs text-brand hover:underline disabled:opacity-50" disabled={pending}
        onClick={() => start(async () => setMessage((await runJobNow(storeId, type)).message))}>
        {pending ? "Starting…" : "Run now"}
      </button>
      {message ? <span className="text-xs text-slate-500" role="status">{message}</span> : null}
    </span>
  );
}

export function AutomationForm({ storeId, rows, action }: {
  storeId: string;
  rows: JobRow[];
  action: (prev: AutomationFormState, form: FormData) => Promise<AutomationFormState>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-3">
      {rows.map((row) => (
        <section key={row.type} className="card space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="max-w-xl">
              <h2 className="font-medium">{row.title}</h2>
              <p className="text-sm text-slate-500">{row.description}</p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name={`${row.type}.enabled`} defaultChecked={row.enabled} className="h-4 w-4 accent-brand" />
              On
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <ScheduleField row={row} />
            {row.type === "low_stock_watch" ? (
              <label className="flex items-center gap-2 whitespace-nowrap text-sm text-slate-600">
                Alert at
                <input className="input w-20" type="number" name={`${row.type}.threshold`} min={0} max={1000} defaultValue={row.threshold} required />
                or fewer in stock
              </label>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span>{row.lastRun ? `Last checked ${row.lastRun}` : "Not run yet"}</span>
            <RunNow storeId={storeId} type={row.type} />
          </div>
        </section>
      ))}
      <div className="sticky bottom-0 flex items-center gap-3 border-t border-slate-200 bg-slate-50/95 py-3">
        <button className="btn" disabled={pending}>{pending ? "Saving…" : "Save automations"}</button>
        {state.error ? <p className="text-sm text-red-600" role="alert">{state.error}</p> : null}
        {state.saved && !pending ? <p className="text-sm text-emerald-700" role="status">Saved. New schedules apply within a minute.</p> : null}
      </div>
    </form>
  );
}

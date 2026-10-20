"use client";

import { useActionState } from "react";
import type { AutomationFormState } from "@/lib/automation-actions";

interface Budget {
  limitInr: number;
  spentInr: number;
  runs: number;
  used: number;
  exhausted: boolean;
  custom: boolean;
}

/** This month's spend against the store's budget, with a field to change it. */
export function BudgetForm({ budget, action }: { budget: Budget; action: (prev: AutomationFormState, form: FormData) => Promise<AutomationFormState> }) {
  const [state, formAction, pending] = useActionState(action, {});
  const pct = Math.round(budget.used * 100);
  return (
    <section className="card space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">This month</h2>
        <p className="text-sm text-slate-600">
          {budget.runs} runs · ₹{budget.spentInr.toFixed(2)} of ₹{budget.limitInr.toFixed(0)}
        </p>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Budget used">
        <div className={`h-full ${budget.exhausted ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} />
      </div>
      {budget.exhausted ? (
        <p className="text-sm text-red-700" role="status">The budget is used up: the agent will not run until next month or until you raise it.</p>
      ) : null}
      <form action={formAction} className="flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor="budget" className="text-slate-600">Monthly budget (₹)</label>
        <input id="budget" name="budget" className="input w-32" type="number" min={0} step="1" defaultValue={budget.custom ? budget.limitInr : ""} placeholder={`${budget.limitInr} (default)`} />
        <button className="btn-secondary" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
        {state.error ? <span className="text-red-600" role="alert">{state.error}</span> : null}
        {state.saved && !pending ? <span className="text-emerald-700" role="status">Saved.</span> : null}
      </form>
    </section>
  );
}

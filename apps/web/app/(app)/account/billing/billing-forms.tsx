"use client";

import { useActionState } from "react";
import { cancelPlan, choosePlan } from "@/lib/billing-actions";

export function ChoosePlanButton({ plan, disabled, label }: { plan: "starter" | "growth"; disabled: boolean; label: string }) {
  const [state, action, pending] = useActionState(choosePlan.bind(null, plan), {});
  return (
    <form action={action} className="space-y-2">
      <button className="btn w-full" disabled={disabled || pending}>{pending ? "Opening Razorpay…" : label}</button>
      {state.error ? <p className="text-xs text-red-600" role="alert">{state.error}</p> : null}
    </form>
  );
}

export function CancelPlanButton() {
  const [state, action, pending] = useActionState(cancelPlan, {});
  return (
    <form action={action} className="space-y-2 text-right">
      {state.done ? (
        <p className="text-sm text-green-700" role="status">{state.done}</p>
      ) : (
        <button className="btn-danger" disabled={pending}>{pending ? "Cancelling…" : "Cancel plan"}</button>
      )}
      {state.error ? <p className="text-xs text-red-600" role="alert">{state.error}</p> : null}
    </form>
  );
}

"use client";

import Link from "next/link";
import { useActionState } from "react";
import { requestPasswordReset } from "@/lib/auth-actions";

export function ForgotForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, {});
  if (state.done) {
    return (
      <div className="space-y-5">
        <p className="rounded-lg border border-green-200 bg-emerald-50 px-4 py-3 text-sm text-green-800" role="status">{state.done}</p>
        <Link href="/login" className="btn-secondary w-full">Back to log in</Link>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-5">
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input className="input" id="email" name="email" type="email" autoComplete="email" required />
      </div>
      {state.error ? <p className="text-sm text-red-600" role="alert">{state.error}</p> : null}
      <button className="btn w-full py-2.5" disabled={pending}>{pending ? "Sending…" : "Send the link"}</button>
      <p className="text-center text-sm text-slate-600"><Link className="font-medium text-green-700 hover:underline" href="/login">Back to log in</Link></p>
    </form>
  );
}

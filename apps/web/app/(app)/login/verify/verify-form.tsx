"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { verifyMfa } from "@/lib/auth-actions";

export function VerifyForm() {
  const [state, action, pending] = useActionState(verifyMfa, {});
  const [recovery, setRecovery] = useState(false);
  return (
    <form action={action} className="space-y-5">
      <div>
        <label className="label" htmlFor="code">{recovery ? "Recovery code" : "Authentication code"}</label>
        <input
          className={`input ${recovery ? "" : "text-center font-mono text-2xl tracking-[0.5em]"}`}
          id="code"
          name="code"
          inputMode={recovery ? "text" : "numeric"}
          autoComplete="one-time-code"
          maxLength={recovery ? 12 : 6}
          placeholder={recovery ? "xxxx-xxxx" : "000000"}
          autoFocus
          required
        />
      </div>
      {state.error ? <p className="text-sm text-red-600" role="alert">{state.error}</p> : null}
      <button className="btn w-full py-2.5" disabled={pending}>{pending ? "Checking…" : "Verify and log in"}</button>
      <div className="flex justify-between text-sm">
        <button type="button" className="text-green-700 hover:underline" onClick={() => setRecovery((r) => !r)}>
          {recovery ? "Use the authenticator app" : "Lost your phone? Use a recovery code"}
        </button>
        <Link href="/login" className="text-slate-500 hover:underline">Start again</Link>
      </div>
    </form>
  );
}

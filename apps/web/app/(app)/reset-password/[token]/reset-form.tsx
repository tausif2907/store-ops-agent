"use client";

import Link from "next/link";
import { useActionState } from "react";
import { PasswordInput } from "@/components/password-input";
import { resetPassword } from "@/lib/auth-actions";

export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPassword.bind(null, token), {});
  return (
    <form action={action} className="space-y-5">
      <div>
        <label className="label" htmlFor="password">New password</label>
        <PasswordInput id="password" name="password" autoComplete="new-password" minLength={10} />
      </div>
      <div>
        <label className="label" htmlFor="confirm">Type it again</label>
        <PasswordInput id="confirm" name="confirm" autoComplete="new-password" minLength={10} />
      </div>
      {state.error ? (
        <p className="text-sm text-red-600" role="alert">
          {state.error} {state.error.includes("expired") ? <Link href="/forgot-password" className="font-medium underline">Get a new link</Link> : null}
        </p>
      ) : null}
      <button className="btn w-full py-2.5" disabled={pending}>{pending ? "Saving…" : "Save the new password"}</button>
    </form>
  );
}

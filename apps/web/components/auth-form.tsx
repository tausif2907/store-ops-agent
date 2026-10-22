"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { FormState } from "@/lib/auth-actions";
import { PasswordInput } from "./password-input";

interface Props {
  mode: "login" | "signup";
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  notice?: string;
}

export function AuthForm({ mode, action, notice }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const isSignup = mode === "signup";
  return (
    <form action={formAction} className="space-y-5">
      {notice ? <p className="rounded-lg border border-green-200 bg-emerald-50 px-3 py-2 text-sm text-green-800" role="status">{notice}</p> : null}
      {isSignup ? (
        <div>
          <label className="label" htmlFor="name">Name</label>
          <input className="input" id="name" name="name" autoComplete="name" required />
        </div>
      ) : null}
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input className="input" id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div>
        <div className="flex items-baseline justify-between">
          <label className="label" htmlFor="password">Password</label>
          {!isSignup ? <Link href="/forgot-password" className="text-sm text-green-700 hover:underline">Forgot password?</Link> : null}
        </div>
        <PasswordInput
          id="password"
          name="password"
          autoComplete={isSignup ? "new-password" : "current-password"}
          minLength={isSignup ? 10 : undefined}
          placeholder={isSignup ? "At least 10 characters" : undefined}
        />
      </div>
      {state.error ? <p className="text-sm text-red-600" role="alert">{state.error}</p> : null}
      <button className="btn w-full py-2.5" disabled={pending}>
        {pending ? "Please wait…" : isSignup ? "Create account" : "Log in"}
      </button>
      <p className="text-center text-sm text-slate-600">
        {isSignup ? (
          <>Already have an account? <Link className="font-medium text-green-700 hover:underline" href="/login">Log in</Link></>
        ) : (
          <>New here? <Link className="font-medium text-green-700 hover:underline" href="/signup">Create an account</Link></>
        )}
      </p>
      {isSignup ? (
        <p className="text-center text-xs text-slate-500">
          Starts a 14-day free trial, no card needed. By creating an account you agree to the <Link href="/terms" className="underline">terms</Link> and{" "}
          <Link href="/privacy" className="underline">privacy policy</Link>.
        </p>
      ) : null}
    </form>
  );
}

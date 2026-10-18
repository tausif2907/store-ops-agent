"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { FormState } from "@/lib/auth-actions";

interface Props {
  mode: "login" | "signup";
  action: (prev: FormState, form: FormData) => Promise<FormState>;
}

export function AuthForm({ mode, action }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const isSignup = mode === "signup";
  return (
    <div className="mx-auto mt-12 max-w-sm">
      <h1 className="mb-6 text-2xl font-semibold">{isSignup ? "Create your account" : "Log in"}</h1>
      <form action={formAction} className="card space-y-4">
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
          <label className="label" htmlFor="password">Password</label>
          <input
            className="input"
            id="password"
            name="password"
            type="password"
            autoComplete={isSignup ? "new-password" : "current-password"}
            minLength={isSignup ? 10 : undefined}
            required
          />
        </div>
        {state.error ? <p className="text-sm text-red-600" role="alert">{state.error}</p> : null}
        <button className="btn w-full" disabled={pending}>
          {pending ? "Please wait…" : isSignup ? "Create account" : "Log in"}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-slate-600">
        {isSignup ? (
          <>Already have an account? <Link className="text-brand hover:underline" href="/login">Log in</Link></>
        ) : (
          <>New here? <Link className="text-brand hover:underline" href="/signup">Create an account</Link></>
        )}
      </p>
    </div>
  );
}

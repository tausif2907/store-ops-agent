"use client";

import { useActionState, useState, useTransition } from "react";
import { PasswordInput } from "@/components/password-input";
import { Icon } from "@/components/site/icons";
import { beginTotpSetup, changePassword, confirmTotpSetup, disableTotp, logoutEverywhere, updateName, type AccountState } from "@/lib/account-actions";

function Result({ state }: { state: AccountState }) {
  if (state.error) return <p className="text-sm text-red-600" role="alert">{state.error}</p>;
  if (state.done) return <p className="text-sm text-green-700" role="status">{state.done}</p>;
  return null;
}

export function NameForm({ name }: { name: string }) {
  const [state, action, pending] = useActionState(updateName, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div className="min-w-60 flex-1">
        <label className="label" htmlFor="name">Name</label>
        <input className="input" id="name" name="name" defaultValue={name} autoComplete="name" required />
      </div>
      <button className="btn-secondary" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
      <div className="w-full"><Result state={state} /></div>
    </form>
  );
}

export function PasswordForm() {
  const [state, action, pending] = useActionState(changePassword, {});
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className="label" htmlFor="current">Current password</label>
        <PasswordInput id="current" name="current" autoComplete="current-password" />
      </div>
      <div>
        <label className="label" htmlFor="new-password">New password</label>
        <PasswordInput id="new-password" name="password" autoComplete="new-password" minLength={10} />
      </div>
      <div>
        <label className="label" htmlFor="confirm">Type it again</label>
        <PasswordInput id="confirm" name="confirm" autoComplete="new-password" minLength={10} />
      </div>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button className="btn" disabled={pending}>{pending ? "Saving…" : "Change password"}</button>
        <Result state={state} />
      </div>
    </form>
  );
}

export function TwoFactorCard({ enabled, recoveryLeft }: { enabled: boolean; recoveryLeft: number }) {
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [pending, start] = useTransition();
  const [offState, offAction, offPending] = useActionState(disableTotp, {});

  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-3">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${enabled ? "bg-green-600 text-white" : "bg-slate-100 text-slate-600"}`}>
            <Icon name="shield" />
          </span>
          <div>
            <h2 className="font-semibold text-ink">Two-factor sign-in</h2>
            <p className="text-sm text-slate-500">
              {enabled
                ? `On. Signing in needs a code from your authenticator app. ${recoveryLeft} recovery codes left.`
                : "Ask for a code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…) when you sign in."}
            </p>
          </div>
        </div>
        {!enabled && !setup && !codes ? (
          <button
            className="btn"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await beginTotpSetup();
                if ("error" in r) setError(r.error);
                else setSetup(r);
              })
            }
          >
            {pending ? "Starting…" : "Turn on"}
          </button>
        ) : null}
      </div>

      {codes ? (
        <div className="space-y-3 rounded-xl border border-green-200 bg-emerald-50 p-4">
          <p className="font-semibold text-green-900">Two-factor sign-in is on. Save these recovery codes now.</p>
          <p className="text-sm text-green-900">Each works once if you lose your phone. They won&apos;t be shown again.</p>
          <ul className="grid grid-cols-2 gap-2 font-mono text-sm sm:grid-cols-5">
            {codes.map((c) => (
              <li key={c} className="rounded-md bg-white px-2 py-1 text-center text-ink">{c}</li>
            ))}
          </ul>
          <button type="button" className="btn-secondary btn-sm" onClick={() => navigator.clipboard.writeText(codes.join("\n"))}>Copy all</button>
        </div>
      ) : setup ? (
        <div className="grid gap-5 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-[auto_1fr]">
          {/* A data: URL made on our server from the secret; nothing is loaded from elsewhere. */}
          <img src={setup.qr} alt="QR code to scan with your authenticator app" width={176} height={176} className="rounded-lg border border-slate-200 bg-white" />
          <div className="space-y-3 text-sm">
            <p><strong>1.</strong> Scan the code with your authenticator app, or enter this key by hand:</p>
            <p className="break-all rounded-md bg-white px-2 py-1 font-mono text-xs text-ink">{setup.secret.match(/.{1,4}/g)?.join(" ")}</p>
            <p><strong>2.</strong> Type the 6-digit code it shows:</p>
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                start(async () => {
                  const r = await confirmTotpSetup(code);
                  if ("error" in r) setError(r.error);
                  else {
                    setCodes(r.recoveryCodes);
                    setSetup(null);
                    setError(null);
                  }
                });
              }}
            >
              <input
                className="input w-36 text-center font-mono tracking-widest"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                aria-label="Code from the app"
                required
              />
              <button className="btn" disabled={pending}>{pending ? "Checking…" : "Confirm"}</button>
            </form>
          </div>
        </div>
      ) : null}
      {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}

      {enabled && !codes ? (
        <details className="rounded-xl border border-slate-200 p-4">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">Turn off two-factor sign-in</summary>
          <form action={offAction} className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div>
              <label className="label" htmlFor="off-password">Password</label>
              <PasswordInput id="off-password" name="password" autoComplete="current-password" />
            </div>
            <div>
              <label className="label" htmlFor="off-code">Code or recovery code</label>
              <input className="input" id="off-code" name="code" autoComplete="one-time-code" required />
            </div>
            <button className="btn-danger" disabled={offPending}>Turn off</button>
            <div className="sm:col-span-3"><Result state={offState} /></div>
          </form>
        </details>
      ) : null}
    </section>
  );
}

export function SessionsCard() {
  const [state, setState] = useState<AccountState>({});
  const [pending, start] = useTransition();
  return (
    <section className="card flex flex-wrap items-center justify-between gap-4">
      <div>
        <h2 className="font-semibold text-ink">Signed-in devices</h2>
        <p className="text-sm text-slate-500">Sign out everywhere else, for example after using a shared computer.</p>
        <div className="mt-2"><Result state={state} /></div>
      </div>
      <button className="btn-secondary" disabled={pending} onClick={() => start(async () => setState(await logoutEverywhere()))}>
        {pending ? "Signing out…" : "Log out other devices"}
      </button>
    </section>
  );
}

"use client";

import { useActionState, useState } from "react";
import { connectStore } from "@/lib/store-actions";

const PLATFORMS = [
  { value: "SUPABASE", label: "Supabase / Postgres", available: true },
  { value: "SHOPIFY", label: "Shopify", available: true },
  { value: "WOOCOMMERCE", label: "WooCommerce", available: false },
  { value: "CUSTOM_REST", label: "Custom REST connector", available: false },
] as const;

export function ConnectStoreForm({ initialPlatform, initialError }: { initialPlatform?: string; initialError?: string }) {
  const [state, formAction, pending] = useActionState(connectStore, {});
  const [platform, setPlatform] = useState(initialPlatform === "SHOPIFY" ? "SHOPIFY" : "SUPABASE");
  const error = state.error ?? initialError;
  const shopify = platform === "SHOPIFY";

  return (
    <form action={formAction} className="card space-y-5">
      <fieldset>
        <legend className="label">Platform</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {PLATFORMS.map((p) => (
            <label
              key={p.value}
              className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                platform === p.value ? "border-brand bg-brand/5" : "border-slate-300"
              } ${p.available ? "cursor-pointer" : "cursor-not-allowed opacity-50"}`}
            >
              <input
                type="radio"
                name="platform"
                value={p.value}
                checked={platform === p.value}
                disabled={!p.available}
                onChange={() => setPlatform(p.value)}
              />
              {p.label}
              {!p.available ? <span className="ml-auto text-xs text-slate-500">soon</span> : null}
            </label>
          ))}
        </div>
      </fieldset>

      {shopify ? (
        <div>
          <label className="label" htmlFor="shop">Shopify store address</label>
          <input className="input" id="shop" name="shop" placeholder="rashmi-studio.myshopify.com" required />
          <p className="mt-1 text-xs text-slate-500">
            You will approve the app on Shopify. We ask only for the access the agent&apos;s tools need: orders, products and stock, and discounts.
            The store&apos;s name, currency and time zone come from Shopify.
          </p>
        </div>
      ) : (
        <>
          <div>
            <label className="label" htmlFor="name">Store name</label>
            <input className="input" id="name" name="name" placeholder="Rashmi Tailoring Studio" required />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="currency">Currency</label>
              <input className="input" id="currency" name="currency" defaultValue="INR" maxLength={3} required />
            </div>
            <div>
              <label className="label" htmlFor="timezone">Time zone</label>
              <input className="input" id="timezone" name="timezone" defaultValue="Asia/Kolkata" required />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="connectionString">Agent role connection string</label>
            <input
              className="input font-mono"
              id="connectionString"
              name="connectionString"
              type="password"
              placeholder="postgresql://agent_role:…@db.xxxx.supabase.co:5432/postgres"
              autoComplete="off"
              required
            />
            <p className="mt-1 text-xs text-slate-500">
              Use the restricted <code>agent_role</code>, which can only call the <code>agent_api</code> functions — never
              your service-role key.
            </p>
          </div>
        </>
      )}

      {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}

      <button className="btn" disabled={pending}>
        {shopify ? (pending ? "Opening Shopify…" : "Continue to Shopify") : pending ? "Testing connection…" : "Test and connect"}
      </button>
    </form>
  );
}

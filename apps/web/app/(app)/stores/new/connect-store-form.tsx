"use client";

import { useActionState, useEffect, useState } from "react";
import { connectStore } from "@/lib/store-actions";

type PlatformValue = "SHOPIFY" | "WOOCOMMERCE" | "SUPABASE" | "CUSTOM_REST";

const PLATFORMS: { value: PlatformValue; label: string; how: string; time: string }[] = [
  { value: "SHOPIFY", label: "Shopify", how: "Approve our app on Shopify.", time: "About a minute" },
  { value: "WOOCOMMERCE", label: "WooCommerce", how: "Create a REST API key in WordPress and paste it here.", time: "About three minutes" },
  {
    value: "SUPABASE",
    label: "Supabase / Postgres",
    how: "For stores on their own database: install the agent API functions and give us a restricted role.",
    time: "Needs a developer",
  },
  { value: "CUSTOM_REST", label: "Custom-built store", how: "Your store implements our open connector API.", time: "Needs a developer" },
];

/** Current IANA names for old ones some browsers still report. */
const ZONE_RENAMES: Record<string, string> = {
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Europe/Kiev": "Europe/Kyiv",
};

/** Every IANA zone the browser knows, with the given ones first if it does not list them. */
function timeZones(extra: string[]): string[] {
  const known = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return [...new Set([...extra, "UTC", ...known].map((z) => ZONE_RENAMES[z] ?? z))];
}

function TimeZoneField() {
  // Rendered on the server first, so the browser's zone is filled in after mounting.
  const [zone, setZone] = useState("UTC");
  const [zones, setZones] = useState<string[]>(["UTC"]);
  useEffect(() => {
    const reported = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const detected = ZONE_RENAMES[reported] ?? reported;
    setZones(timeZones([detected]));
    setZone(detected);
  }, []);
  return (
    <div>
      <label className="label" htmlFor="timezone">Time zone</label>
      <select className="input" id="timezone" name="timezone" value={zone} onChange={(e) => setZone(e.target.value)} required>
        {zones.map((z) => (
          <option key={z} value={z}>{z.replace(/_/g, " ")}</option>
        ))}
      </select>
      <p className="mt-1 text-xs text-slate-500">Digests and reports follow this clock.</p>
    </div>
  );
}

function Help({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
      <summary className="cursor-pointer font-medium text-slate-700">{title}</summary>
      <div className="mt-2 space-y-2">{children}</div>
    </details>
  );
}

export function ConnectStoreForm({ initialPlatform, initialError }: { initialPlatform?: string; initialError?: string }) {
  const [state, formAction, pending] = useActionState(connectStore, {});
  const [platform, setPlatform] = useState<PlatformValue | null>(
    PLATFORMS.find((p) => p.value === initialPlatform)?.value ?? null,
  );
  const error = state.error ?? initialError;

  if (!platform) {
    return (
      <div className="space-y-3">
        <h2 className="font-medium">Where does your store run?</h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {PLATFORMS.map((p) => (
            <li key={p.value}>
              <button
                type="button"
                onClick={() => setPlatform(p.value)}
                className="card block h-full w-full text-left hover:border-brand focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{p.label}</span>
                  <span className="text-xs text-slate-500">{p.time}</span>
                </span>
                <span className="mt-1 block text-sm text-slate-600">{p.how}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const chosen = PLATFORMS.find((p) => p.value === platform)!;
  return (
    <form action={formAction} className="card space-y-5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-medium">Connect your {chosen.label} store</h2>
        <button type="button" className="text-sm text-slate-500 hover:text-slate-800" onClick={() => setPlatform(null)}>
          ← Choose another platform
        </button>
      </div>
      <input type="hidden" name="platform" value={platform} />

      {platform === "SHOPIFY" ? (
        <div>
          <label className="label" htmlFor="shop">Shopify store address</label>
          <input className="input" id="shop" name="shop" placeholder="your-store.myshopify.com" required />
          <p className="mt-1 text-xs text-slate-500">
            You will approve the app on Shopify. We ask only for the access the agent&apos;s tools need: orders, products and stock, and discounts.
            The store&apos;s name, currency and time zone come from Shopify.
          </p>
        </div>
      ) : platform === "WOOCOMMERCE" ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="name">Store name</label>
              <input className="input" id="name" name="name" placeholder="My Store" required />
            </div>
            <TimeZoneField />
          </div>
          <div>
            <label className="label" htmlFor="url">Store address</label>
            <input className="input" id="url" name="url" type="url" placeholder="https://shop.example.com" required />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="consumerKey">Consumer key</label>
              <input className="input font-mono" id="consumerKey" name="consumerKey" placeholder="ck_…" autoComplete="off" required />
            </div>
            <div>
              <label className="label" htmlFor="consumerSecret">Consumer secret</label>
              <input className="input font-mono" id="consumerSecret" name="consumerSecret" type="password" placeholder="cs_…" autoComplete="off" required />
            </div>
          </div>
          <Help title="Where to find the key">
            <ol className="list-decimal space-y-1 pl-5">
              <li>In WordPress, open <strong>WooCommerce → Settings → Advanced → REST API</strong>.</li>
              <li>Choose <strong>Add key</strong>, describe it as &ldquo;Store Ops Agent&rdquo;, pick an administrator and set permissions to <strong>Read/Write</strong>.</li>
              <li>Generate it and copy the consumer key and secret here. The store&apos;s currency is read from its settings.</li>
            </ol>
          </Help>
        </>
      ) : (
        <>
          <div>
            <label className="label" htmlFor="name">Store name</label>
            <input className="input" id="name" name="name" placeholder="My Store" required />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="currency">Currency</label>
              <input className="input uppercase" id="currency" name="currency" defaultValue="INR" maxLength={3} required />
            </div>
            <TimeZoneField />
          </div>

          {platform === "CUSTOM_REST" ? (
            <>
              <div>
                <label className="label" htmlFor="baseUrl">Connector base URL</label>
                <input className="input" id="baseUrl" name="baseUrl" type="url" placeholder="https://shop.example.com/store-ops/v1" required />
              </div>
              <div>
                <label className="label" htmlFor="apiKey">API key</label>
                <input className="input font-mono" id="apiKey" name="apiKey" type="password" autoComplete="off" required />
              </div>
              <Help title="What your developer builds">
                <p>
                  Twelve JSON endpoints described in the{" "}
                  <a className="text-brand hover:underline" href="/connector/openapi.json" target="_blank" rel="noreferrer">connector API spec</a>{" "}
                  (OpenAPI 3.1). Your store checks the key on every request as <code>Authorization: Bearer</code>, and declares what it supports, so
                  the agent only offers what your store can do.
                </p>
              </Help>
            </>
          ) : (
            <>
              <div>
                <label className="label" htmlFor="connectionString">Agent role connection string</label>
                <input
                  className="input font-mono"
                  id="connectionString"
                  name="connectionString"
                  type="password"
                  placeholder="postgresql://agent_role.xxxx:…@aws-0-region.pooler.supabase.com:5432/postgres"
                  autoComplete="off"
                  required
                />
              </div>
              <Help title="What your developer sets up">
                <ol className="list-decimal space-y-1 pl-5">
                  <li>
                    Create the <code>agent_api</code> functions over your tables. Each returns data in our format, so the agent never reads your tables.
                  </li>
                  <li>
                    Create <code>agent_role</code>, allowed only to run those functions. Never use your service-role key or the <code>postgres</code> user.
                  </li>
                  <li>Paste that role&apos;s connection string (direct or session pooler, with SSL).</li>
                </ol>
              </Help>
            </>
          )}
        </>
      )}

      {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn" disabled={pending}>
          {platform === "SHOPIFY" ? (pending ? "Opening Shopify…" : "Continue to Shopify") : pending ? "Testing the connection…" : "Test and connect"}
        </button>
        <p className="text-xs text-slate-500">We test the connection before saving anything. Credentials are encrypted and never shown to the AI model.</p>
      </div>
    </form>
  );
}

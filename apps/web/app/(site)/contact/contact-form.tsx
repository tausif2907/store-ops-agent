"use client";

import { useState } from "react";
import { CONTACT_EMAIL } from "@/lib/site";

const PLATFORMS = ["Shopify", "WooCommerce", "Supabase / Postgres", "Custom-built", "Other"];

/**
 * Writes the message into the visitor's own email app, addressed to us: no
 * form backend to run, nothing to spam, and they keep a copy.
 */
export function ContactForm() {
  const [opened, setOpened] = useState(false);
  const field = "w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-green-600 focus:ring-2 focus:ring-green-600/20";

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const get = (k: string) => String(data.get(k) ?? "").trim();
    const subject = `Store Ops Agent: ${get("platform") || "question"}${get("website") ? ` (${get("website")})` : ""}`;
    const body = [get("message"), "", `${get("name")} <${get("email")}>`, get("website") ? `Store: ${get("website")}` : "", `Platform: ${get("platform")}`]
      .filter((line, i) => line !== "" || i === 1)
      .join("\n");
    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setOpened(true);
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block text-sm font-medium text-ink">
          Name
          <input name="name" required autoComplete="name" className={`${field} mt-1.5`} placeholder="Your name" />
        </label>
        <label className="block text-sm font-medium text-ink">
          Email
          <input name="email" type="email" required autoComplete="email" className={`${field} mt-1.5`} placeholder="you@yourstore.com" />
        </label>
        <label className="block text-sm font-medium text-ink">
          Store website <span className="font-normal text-gray-400">(optional)</span>
          <input name="website" className={`${field} mt-1.5`} placeholder="https://yourstore.com" />
        </label>
        <label className="block text-sm font-medium text-ink">
          Platform
          <select name="platform" required defaultValue="" className={`${field} mt-1.5`}>
            <option value="" disabled>Choose one</option>
            {PLATFORMS.map((p) => <option key={p}>{p}</option>)}
          </select>
        </label>
      </div>
      <label className="block text-sm font-medium text-ink">
        Message
        <textarea name="message" required rows={6} maxLength={4000} className={`${field} mt-1.5`} placeholder="How can we help?" />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-gray-500">This opens your email app with the message ready to send.</p>
        <button className="inline-flex items-center rounded-[10px] bg-green-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-green-700">Write the email</button>
      </div>
      {opened ? (
        <p className="rounded-lg border border-teal-100 bg-teal-50 p-3 text-sm text-teal-800" role="status">
          Your email app should have opened. If it didn&apos;t, write to <a className="font-medium underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      ) : null}
    </form>
  );
}

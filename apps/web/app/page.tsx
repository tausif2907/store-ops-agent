import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";

const FEATURES = [
  {
    title: "Answers in seconds",
    body: "Ask how yesterday went, which orders are late or what is running low. The agent looks it up in your store and answers with real numbers.",
  },
  {
    title: "Works while you sleep",
    body: "A morning digest, an hourly low-stock watch, apology drafts for late orders, replies to bad reviews and a Monday report, on your time zone.",
  },
  {
    title: "Changes only with your say-so",
    body: "Order status, stock, coupons and review replies wait for your approval by default. Switch the ones you trust to automatic, with limits.",
  },
];

const SAFETY = [
  ["Rules enforced in code", "Every action passes a policy check the agent cannot talk its way around: Automatic, Ask me or Off, per action, with limits like “coupons up to 10%”."],
  ["Approve from your phone", "Changes that need you arrive by email with a one-time link. Nothing happens unless you press Approve, and the request expires in 30 minutes."],
  ["One switch to stop everything", "Pause the agent and every run and every change stops at once, until you resume."],
  ["Your data stays in your store", "Orders and products are read live through your store's own API. Credentials are encrypted and never shown to the AI model."],
  ["Some things it simply cannot do", "Refunds, price changes, deleting anything and emailing customers are not tools, so the agent cannot do them even by mistake."],
  ["Everything is on the record", "Every change, decision and rule edit lands in an activity log that cannot be edited, and every run has a full trace."],
];

const PLATFORMS = [
  ["Shopify", "Approve the app on Shopify"],
  ["WooCommerce", "Paste a REST API key"],
  ["Supabase / Postgres", "A restricted database role"],
  ["Custom-built stores", "Implement our open connector API"],
];

const STEPS = [
  ["Create an account", "An email and a password. No card."],
  ["Connect your store", "Pick your platform and connect it. We test the connection before saving anything."],
  ["Read your first digest", "The agent looks through your store right away and writes your first morning digest."],
];

export default async function Home() {
  if (await getSessionUser()) redirect("/stores");

  return (
    <div className="space-y-20 pb-8">
      <section className="grid items-center gap-10 pt-4 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <p className="text-sm font-medium text-brand">For Shopify, WooCommerce and custom-built stores</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
            An AI that runs your store&apos;s day-to-day, within rules you set.
          </h1>
          <p className="mt-5 text-lg text-slate-600">
            It answers questions about orders, stock and sales, sends you a digest every morning, drafts messages to customers, and proposes changes
            for you to approve.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link href="/signup" className="btn btn-lg">Connect your store</Link>
            <Link href="/login" className="btn-secondary btn-lg">Log in</Link>
          </div>
          <p className="mt-3 text-sm text-slate-500">About five minutes to set up. Your first digest arrives as soon as you connect.</p>
        </div>

        <figure className="card space-y-3 text-sm" aria-label="An example morning digest">
          <div className="flex items-baseline justify-between">
            <p className="font-medium">Your morning digest</p>
            <p className="text-xs text-slate-400">Example</p>
          </div>
          <p className="font-medium text-slate-800">A steady day: 14 orders and ₹38,450 in sales, with two orders now late.</p>
          <ul className="list-disc space-y-1 pl-5 text-slate-600">
            <li>Due today: 3 orders, all marked ready</li>
            <li>Late: RTS-1162 and RTS-1171, apologies drafted in your inbox</li>
            <li>Low stock: Silk Anarkali Suit (M) has 2 left</li>
            <li>One 2-star review about fit, reply drafted</li>
          </ul>
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
            Waiting for you: restock Silk Anarkali Suit (M) to 12 · <span className="font-medium">Approve</span>
          </div>
        </figure>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title} className="card">
            <h2 className="font-medium">{f.title}</h2>
            <p className="mt-2 text-sm text-slate-600">{f.body}</p>
          </div>
        ))}
      </section>

      <section>
        <h2 className="text-2xl font-semibold tracking-tight">Safe by design</h2>
        <p className="mt-2 max-w-2xl text-slate-600">The agent decides what to look at and what to do. Whether it may do it is decided by your rules, in code.</p>
        <dl className="mt-6 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
          {SAFETY.map(([title, body]) => (
            <div key={title}>
              <dt className="font-medium">{title}</dt>
              <dd className="mt-1 text-sm text-slate-600">{body}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="grid gap-10 lg:grid-cols-2">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Works with your store</h2>
          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            {PLATFORMS.map(([name, how]) => (
              <li key={name} className="card h-full py-4">
                <p className="font-medium">{name}</p>
                <p className="mt-0.5 text-sm text-slate-500">{how}</p>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Live in five minutes</h2>
          <ol className="mt-5 space-y-4">
            {STEPS.map(([title, body], i) => (
              <li key={title} className="flex gap-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-semibold text-white">{i + 1}</span>
                <div>
                  <p className="font-medium">{title}</p>
                  <p className="text-sm text-slate-600">{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="flex flex-wrap items-center justify-between gap-4 rounded-lg bg-slate-900 p-6 text-white shadow-sm">
        <div>
          <p className="text-lg font-medium">See what your store did yesterday.</p>
          <p className="text-sm text-slate-300">Connect it and your first digest is on its way.</p>
        </div>
        <Link href="/signup" className="btn btn-light">Get started</Link>
      </section>
    </div>
  );
}

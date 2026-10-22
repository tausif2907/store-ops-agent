"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./icons";
import { prefersReducedMotion, useInView } from "./motion";

/**
 * Interactive pictures of the product for the public site. They are scripted
 * on the product's fictional sample store; the copy says so wherever they
 * appear, and every behaviour shown is one the product really has.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, prefersReducedMotion() ? 0 : ms));

// ---- Hero: the morning digest, with a change you can approve -----------------------------

const DIGEST: [IconName, string, string][] = [
  ["check", "Due today:", "3 orders, all marked ready"],
  ["clock", "Late:", "RTS-1162 and RTS-1171, apologies drafted in your inbox"],
  ["box", "Low stock:", "Silk Anarkali Suit (M) has 2 left"],
  ["star", "Reviews:", "one 2-star review about fit, reply drafted"],
];

export function LiveDigest() {
  const [state, setState] = useState<"waiting" | "approving" | "done">("waiting");

  async function approve() {
    setState("approving");
    await sleep(700);
    setState("done");
  }

  return (
    <div className="relative">
      {/* Floating notes around the card */}
      <div className="site-float absolute -left-4 -top-5 z-10 hidden items-center gap-2 rounded-full border border-white/10 bg-ink/90 px-3 py-1.5 text-xs font-medium text-white shadow-xl backdrop-blur sm:flex">
        <Icon name="shield" className="h-3.5 w-3.5 text-green-400" /> Rule check: Ask me
      </div>
      <div className="site-float-slow absolute -bottom-5 -right-3 z-10 hidden items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-ink shadow-xl sm:flex">
        <Icon name="inbox" className="h-3.5 w-3.5 text-teal-600" /> 2 drafts saved, nothing sent
      </div>

      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white p-6 shadow-2xl shadow-green-950/40">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Example</span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-teal-100 bg-teal-50 px-2.5 py-0.5 text-xs font-medium text-teal-700">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal-600 motion-reduce:animate-none" aria-hidden />
            09:00 in your time zone
          </span>
        </div>
        <h3 className="text-xl font-bold text-ink">Your morning digest</h3>
        <p className="site-pop mt-3 rounded-xl border border-gray-200 bg-gradient-to-br from-gray-50 to-emerald-50/60 p-3.5 text-sm font-semibold leading-snug text-ink" style={{ "--pop-delay": "150ms" } as React.CSSProperties}>
          A steady day: 14 orders and ₹38,450 in sales, with two orders now late.
        </p>
        <ul className="mt-4 space-y-3 text-sm text-ink">
          {DIGEST.map(([icon, label, text], i) => (
            <li key={label} className="site-pop flex items-start gap-3" style={{ "--pop-delay": `${350 + i * 140}ms` } as React.CSSProperties}>
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-green-600/20 bg-emerald-50 text-green-700">
                <Icon name={icon} className="h-3 w-3" />
              </span>
              <span><strong className="font-semibold">{label}</strong> {text}</span>
            </li>
          ))}
        </ul>
        <div
          className={`site-pop mt-5 rounded-xl border px-3.5 py-3 text-sm transition-colors duration-500 ${state === "done" ? "border-green-200 bg-emerald-50" : "border-teal-100 bg-teal-50"}`}
          style={{ "--pop-delay": "950ms" } as React.CSSProperties}
          aria-live="polite"
        >
          {state === "done" ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-green-800">
                <Icon name="checkCircle" className="h-4 w-4" /> Stock set to 12, and logged in Activity
              </span>
              <button type="button" onClick={() => setState("waiting")} className="text-xs font-medium text-green-700 underline-offset-2 hover:underline">
                Replay
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-teal-800">Waiting for you: restock Silk Anarkali Suit (M) to 12</span>
              <button
                type="button"
                onClick={approve}
                disabled={state === "approving"}
                className="relative rounded-lg bg-green-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-green-700 active:scale-95 disabled:opacity-80"
              >
                {state === "approving" ? "Approving…" : "Approve"}
                {state === "waiting" ? <span className="absolute -right-1 -top-1 h-2.5 w-2.5 animate-ping rounded-full bg-green-400 motion-reduce:hidden" aria-hidden /> : null}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- "Ask it": a scripted chat on the sample store ---------------------------------------

type Step =
  | { kind: "tool"; label: string; detail: string }
  | { kind: "rule"; label: string }
  | { kind: "answer"; text: string; table?: string[][] }
  | { kind: "approval"; summary: string; reason: string };

const SCRIPTS: { q: string; icon: IconName; tag: string; steps: Step[] }[] = [
  {
    q: "How did yesterday go?",
    icon: "chart",
    tag: "Read",
    steps: [
      { kind: "tool", label: "sales_summary", detail: "period: yesterday" },
      { kind: "answer", text: "Yesterday brought 14 orders worth ₹38,450, up from 11 orders the day before. Your best seller was the Silk Anarkali Suit, and two orders are now past their promised date." },
    ],
  },
  {
    q: "Which orders are running late?",
    icon: "clock",
    tag: "Read",
    steps: [
      { kind: "tool", label: "search_orders", detail: "overdue: true" },
      {
        kind: "answer",
        text: "Two orders are past their promised date and not shipped yet. Want me to draft an apology to each customer? You'd send them yourself.",
        table: [["RTS-1162", "Meera Sharma", "processing", "19 Oct"], ["RTS-1171", "Rohan Verma", "ready", "21 Oct"]],
      },
    ],
  },
  {
    q: "Create a 15% Diwali coupon for 100 uses",
    icon: "wallet",
    tag: "Change",
    steps: [
      { kind: "tool", label: "create_coupon", detail: "DIWALI15 · 15% · 100 uses" },
      { kind: "rule", label: "Rule: Create coupons is Automatic up to 10% off, so this one asks you" },
      { kind: "approval", summary: "Create coupon DIWALI15: 15% off, up to 100 uses", reason: "15% off is over your 10% limit." },
    ],
  },
  {
    q: "What's the capital of France?",
    icon: "info",
    tag: "Off-topic",
    steps: [{ kind: "answer", text: "I only help with your store, so I'll leave that one. I could check which orders are late, or how sales went last week." }],
  },
];

type Shown = Step & { done?: boolean; typed?: string };

export function AgentDemo() {
  const [active, setActive] = useState<number | null>(null);
  const [shown, setShown] = useState<Shown[]>([]);
  const [decision, setDecision] = useState<"approved" | "rejected" | null>(null);
  const run = useRef(0);
  const chatRef = useRef<HTMLDivElement>(null);
  const [sectionRef, inView] = useInView<HTMLDivElement>();

  // On phones the chat sits below the questions; bring it into view on a tap.
  function choose(index: number) {
    if (window.innerWidth < 1024) chatRef.current?.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    void play(index);
  }

  const play = useCallback(async (index: number) => {
    const id = ++run.current;
    const alive = () => run.current === id;
    setActive(index);
    setShown([]);
    setDecision(null);
    await sleep(350);
    for (const step of SCRIPTS[index]!.steps) {
      if (!alive()) return;
      if (step.kind === "answer") {
        setShown((s) => [...s, { ...step, typed: "" }]);
        const words = step.text.split(" ");
        for (let i = 1; i <= words.length; i++) {
          if (!alive()) return;
          await sleep(28);
          setShown((s) => s.map((x, j) => (j === s.length - 1 ? { ...x, typed: words.slice(0, i).join(" ") } : x)));
        }
      } else {
        setShown((s) => [...s, step]);
        await sleep(step.kind === "tool" ? 750 : 500);
        if (!alive()) return;
        setShown((s) => s.map((x, j) => (j === s.length - 1 ? { ...x, done: true } : x)));
        await sleep(250);
      }
    }
  }, []);

  // Start the first example when the demo comes into view.
  useEffect(() => {
    if (inView && active === null) void play(0);
  }, [inView, active, play]);

  const script = active === null ? null : SCRIPTS[active]!;

  return (
    <div ref={sectionRef} className="grid gap-6 lg:grid-cols-5">
      <div className="lg:col-span-2">
        <p className="text-sm font-medium text-gray-500">Pick a question</p>
        <div className="mt-3 grid gap-2.5">
          {SCRIPTS.map((s, i) => (
            <button
              key={s.q}
              type="button"
              onClick={() => choose(i)}
              aria-pressed={active === i}
              className={`group flex items-center gap-3 rounded-xl border p-3.5 text-left transition-all duration-200 ${
                active === i ? "border-green-600 bg-emerald-50 shadow-md shadow-green-900/5" : "border-gray-200 bg-white hover:-translate-y-0.5 hover:border-green-300 hover:shadow-md"
              }`}
            >
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors ${active === i ? "bg-green-600 text-white" : "bg-gray-100 text-ink group-hover:bg-emerald-100 group-hover:text-green-700"}`}>
                <Icon name={s.icon} className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1 text-sm font-medium text-ink">{s.q}</span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${s.tag === "Change" ? "bg-teal-50 text-teal-700" : s.tag === "Off-topic" ? "bg-gray-100 text-gray-600" : "bg-emerald-50 text-green-700"}`}>
                {s.tag}
              </span>
            </button>
          ))}
        </div>
        <p className="mt-4 text-xs text-gray-500">A scripted example on a sample store. Connected to yours, every answer comes from your store&apos;s own data.</p>
      </div>

      <div className="lg:col-span-3">
        <div ref={chatRef} className="flex h-full min-h-[25rem] scroll-mt-24 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl shadow-gray-900/5">
          <div className="flex items-center gap-3 border-b border-gray-100 bg-gradient-to-r from-emerald-50 to-teal-50/60 px-4 py-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-green-600 text-white">
              <Icon name="bolt" className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-semibold text-ink">Store agent</p>
              <p className="text-xs text-gray-500">Reads your store live. Changes follow your rules.</p>
            </div>
          </div>

          <div className="flex-1 space-y-3 p-4 sm:p-5" aria-live="polite">
            {script ? (
              <>
                <div className="site-pop flex justify-end">
                  <p className="max-w-[85%] rounded-2xl rounded-br-md bg-green-600 px-4 py-2 text-sm text-white shadow-sm">{script.q}</p>
                </div>
                {shown.map((step, i) => (
                  <DemoStep key={`${active}-${i}`} step={step} decision={decision} onDecide={setDecision} />
                ))}
                {shown.length === 0 ? <Dots /> : null}
              </>
            ) : (
              <p className="pt-24 text-center text-sm text-gray-400">Pick a question to see the agent work.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Dots() {
  return (
    <span className="inline-flex gap-1 rounded-2xl bg-gray-100 px-3 py-2.5" aria-label="Thinking">
      {[0, 150, 300].map((d) => (
        <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 motion-reduce:animate-none" style={{ animationDelay: `${d}ms` }} />
      ))}
    </span>
  );
}

function DemoStep({ step, decision, onDecide }: { step: Shown; decision: "approved" | "rejected" | null; onDecide: (d: "approved" | "rejected") => void }) {
  if (step.kind === "tool") {
    return (
      <p className="site-pop inline-flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-3 py-1 font-mono text-xs text-gray-600">
        {step.done ? <Icon name="check" className="h-3.5 w-3.5 text-green-600" /> : <span className="h-3 w-3 animate-spin rounded-full border-2 border-green-600 border-t-transparent motion-reduce:animate-none" />}
        <span className="font-semibold text-ink">{step.label}</span> {step.detail}
      </p>
    );
  }
  if (step.kind === "rule") {
    return (
      <p className="site-pop flex items-start gap-2 rounded-xl border border-teal-100 bg-teal-50 px-3 py-2 text-xs text-teal-800">
        <Icon name="shield" className="mt-px h-3.5 w-3.5 shrink-0" /> {step.label}
      </p>
    );
  }
  if (step.kind === "approval") {
    return (
      <div className="site-pop rounded-xl border border-teal-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">Waiting for your approval</p>
        <p className="mt-1 font-semibold text-ink">{step.summary}</p>
        <p className="mt-1 text-xs text-gray-500">{step.reason} Also sent to your email; the link expires in 30 minutes.</p>
        {decision ? (
          <p className={`site-pop mt-3 flex items-center gap-2 text-sm font-medium ${decision === "approved" ? "text-green-700" : "text-gray-700"}`}>
            <Icon name={decision === "approved" ? "checkCircle" : "xCircle"} className="h-4 w-4" />
            {decision === "approved" ? "Approved. DIWALI15 is live, and it's in your activity log." : "Rejected. Nothing changed in your store."}
          </p>
        ) : (
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => onDecide("approved")} className="rounded-lg bg-green-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-green-700 active:scale-95">Approve</button>
            <button type="button" onClick={() => onDecide("rejected")} className="rounded-lg border border-gray-300 px-4 py-1.5 text-sm font-medium text-ink transition hover:bg-gray-50 active:scale-95">Reject</button>
          </div>
        )}
      </div>
    );
  }
  const finished = step.typed === step.text;
  return (
    <div className="site-pop max-w-[95%] rounded-2xl rounded-bl-md bg-gray-50 px-4 py-3 text-sm leading-relaxed text-ink">
      <p className={finished ? "" : "site-caret"}>{step.typed}</p>
      {step.table && finished ? (
        <table className="site-pop mt-3 w-full text-left text-xs">
          <thead className="text-gray-500">
            <tr className="border-b border-gray-200">
              <th className="py-1.5 font-medium">Order</th>
              <th className="py-1.5 font-medium">Customer</th>
              <th className="py-1.5 font-medium">Status</th>
              <th className="py-1.5 font-medium">Promised</th>
            </tr>
          </thead>
          <tbody>
            {step.table.map((row) => (
              <tr key={row[0]} className="border-b border-gray-100 last:border-0">
                {row.map((cell, i) => <td key={i} className={`py-1.5 ${i === 0 ? "font-mono" : ""}`}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

// ---- How it works: one change, followed through every step -------------------------------

const PIPELINE: { icon: IconName; title: string; detail: string; example: React.ReactNode }[] = [
  { icon: "chat", title: "You ask, or a schedule starts it", detail: "Chat, a timer, or a store event", example: <>&ldquo;Restock the Silk Anarkali Suit in M to 12.&rdquo;</> },
  { icon: "bolt", title: "The agent decides what to do", detail: "Orders, stock, coupons, reviews", example: <code className="font-mono text-[13px]">update_stock(Silk Anarkali Suit · M, 12)</code> },
  { icon: "sliders", title: "Your rules check the action", detail: "Automatic, Ask me or Off", example: <>Change stock levels is set to <strong>Ask me</strong>, so it waits for you.</> },
  { icon: "mail", title: "It runs, or waits for you", detail: "On your store's own API", example: <>You press Approve in the email. The stock is set to 12 in your store.</> },
  { icon: "log", title: "Everything is logged", detail: "Activity log and run trace", example: <>Activity: <strong>Stock changed</strong>, by you (approved by email).</> },
];

export function Pipeline() {
  const [active, setActive] = useState(0);
  const [auto, setAuto] = useState(true);
  const [ref, inView] = useInView<HTMLDivElement>(false);

  useEffect(() => {
    if (!auto || !inView || prefersReducedMotion()) return;
    const timer = setInterval(() => setActive((a) => (a + 1) % PIPELINE.length), 2600);
    return () => clearInterval(timer);
  }, [auto, inView]);

  const pick = (i: number) => {
    setAuto(false);
    setActive(i);
  };

  return (
    <div ref={ref}>
      <div className="relative">
        <div className="absolute left-0 right-0 top-[1.375rem] hidden h-0.5 bg-gray-200 md:block" aria-hidden>
          <div className="h-full bg-gradient-to-r from-green-600 to-teal-500 transition-all duration-700 ease-out" style={{ width: `${(active / (PIPELINE.length - 1)) * 100}%` }} />
        </div>
        <ol className="relative grid gap-3 md:grid-cols-5">
          {PIPELINE.map((s, i) => (
            <li key={s.title}>
              <button type="button" onClick={() => pick(i)} aria-pressed={active === i} className="group flex w-full flex-col items-start gap-3 text-left md:items-center md:text-center">
                <span
                  className={`flex h-11 w-11 items-center justify-center rounded-full border-2 transition-all duration-300 ${
                    i <= active ? "border-green-600 bg-green-600 text-white shadow-lg shadow-green-600/30" : "border-gray-200 bg-white text-gray-400 group-hover:border-green-300 group-hover:text-green-600"
                  } ${i === active ? "scale-110" : ""}`}
                >
                  <Icon name={s.icon} className="h-5 w-5" />
                </span>
                <span>
                  <span className="block text-xs font-semibold uppercase tracking-wide text-teal-700">Step {i + 1}</span>
                  <span className={`mt-1 block font-semibold leading-snug transition-colors ${i === active ? "text-ink" : "text-gray-500 group-hover:text-ink"}`}>{s.title}</span>
                  <span className="mt-1 block text-xs text-gray-500">{s.detail}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>
      <div className="mx-auto mt-10 max-w-2xl">
        <div key={active} className="site-pop flex items-start gap-3 rounded-2xl border border-green-200 bg-white p-5 shadow-lg shadow-green-900/5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-green-700">
            <Icon name={PIPELINE[active]!.icon} className="h-4 w-4" />
          </span>
          <div className="text-sm text-ink">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Example, step {active + 1} of {PIPELINE.length}</p>
            <p className="mt-1">{PIPELINE[active]!.example}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Rules you can switch ----------------------------------------------------------------

type Mode = "Automatic" | "Ask me" | "Off";

const RULES: { name: string; mode: Mode; auto: string }[] = [
  { name: "Create coupons", mode: "Automatic", auto: "Creates coupons on its own up to 10% off and 100 uses; bigger ones come to you." },
  { name: "Change stock levels", mode: "Ask me", auto: "Changes stock on its own by up to ±20 units; bigger changes come to you." },
  { name: "Change order status", mode: "Ask me", auto: "Changes order status on its own, only to the statuses you allow; others come to you." },
  { name: "Reply to reviews", mode: "Off", auto: "Posts review replies on its own." },
];

const OUTCOME: Record<Exclude<Mode, "Automatic">, string> = {
  "Ask me": "Waits for your approval, by email or in the dashboard. Nothing happens until you press Approve.",
  Off: "The agent cannot do this at all, whatever it is asked.",
};

export function RulesPlayground() {
  const [modes, setModes] = useState<Mode[]>(RULES.map((r) => r.mode));
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl shadow-gray-900/5">
      <div className="flex items-center justify-between gap-2 border-b border-gray-100 bg-gray-50/70 px-4 py-2.5">
        <p className="text-xs font-semibold text-gray-600">Rules · try switching them</p>
        <span className="inline-flex items-center rounded border border-green-100 bg-emerald-50 px-2 py-0.5 font-mono text-[11px] font-medium text-green-700">checked on every action</span>
      </div>
      <ul className="divide-y divide-gray-100 p-4 sm:p-5">
        {RULES.map((r, i) => {
          const mode = modes[i]!;
          return (
            <li key={r.name} className="py-3.5 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm font-medium text-ink">{r.name}</span>
                <span className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 text-xs" role="group" aria-label={r.name}>
                  {(["Automatic", "Ask me", "Off"] as Mode[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={mode === m}
                      onClick={() => setModes((ms) => ms.map((x, j) => (j === i ? m : x)))}
                      className={`rounded-md px-2.5 py-1 font-medium transition-all duration-200 ${
                        mode === m ? (m === "Off" ? "bg-ink text-white shadow-sm" : "bg-green-600 text-white shadow-sm") : "text-gray-600 hover:bg-white hover:text-ink"
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </span>
              </div>
              <p key={mode} className={`site-pop mt-2 flex items-start gap-2 text-xs ${mode === "Off" ? "text-gray-600" : mode === "Ask me" ? "text-teal-800" : "text-green-800"}`}>
                <Icon name={mode === "Off" ? "xCircle" : mode === "Ask me" ? "mail" : "bolt"} className="mt-px h-3.5 w-3.5 shrink-0" />
                {mode === "Automatic" ? r.auto : OUTCOME[mode]}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

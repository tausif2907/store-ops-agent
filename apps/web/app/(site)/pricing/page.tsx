import type { Metadata } from "next";
import { Icon } from "@/components/site/icons";
import { ButtonLink, Check, Chip, Container, CtaBand, Eyebrow } from "@/components/site/ui";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Launch pricing in rupees, with AI usage included and a monthly cap you control. Start with a 14-day free trial, no card needed.",
};

const PLANS = [
  {
    name: "Starter",
    tag: "1 store",
    blurb: "For an independent store getting started.",
    price: "₹999",
    per: "/ month",
    cta: { label: "Start free trial", href: "/signup" },
    intro: "What's included",
    features: [
      "1 connected store",
      "Chat with your store",
      "All five automations",
      "Approvals in the dashboard and by email",
      "Inbox for drafts",
      "Activity log and run traces",
      "₹500 of AI usage each month",
      "Email support",
    ],
  },
  {
    name: "Growth",
    tag: "Up to 3 stores",
    blurb: "For brands running more than one store.",
    price: "₹2,499",
    per: "/ month",
    cta: { label: "Start free trial", href: "/signup" },
    intro: "Everything in Starter, plus",
    features: ["Up to 3 connected stores", "₹1,500 of AI usage each month, shared across your stores", "Priority email support"],
    featured: true,
  },
  {
    name: "Custom",
    tag: "Agencies and custom stores",
    blurb: "For more stores, or a store you built yourself.",
    price: "Let's talk",
    per: "",
    cta: { label: "Contact us", href: "/contact" },
    intro: "Tailored to you",
    features: ["More stores", "Help implementing the connector API", "Help setting up a Supabase / Postgres store", "Usage limits to suit you"],
  },
] as const;

const TABLE: [string, string, string, string][] = [
  ["Connected stores", "1", "Up to 3", "By arrangement"],
  ["Chat with your store", "✓", "✓", "✓"],
  ["Five automations", "✓", "✓", "✓"],
  ["Rules with limits, approvals by email", "✓", "✓", "✓"],
  ["Inbox, activity log, run traces", "✓", "✓", "✓"],
  ["AI usage included each month", "₹500", "₹1,500 (shared)", "By arrangement"],
  ["Connector API or Supabase setup help", "—", "—", "✓"],
  ["Support", "Email", "Priority email", "Direct"],
];

const FAQ = [
  ["Is there a free trial?", "Yes: 14 days, with every feature. No card is needed to sign up or connect your store."],
  ["Can I change plans later?", "Yes, up or down, whenever you like."],
  ["What counts as AI usage?", "Each time the agent runs, to answer a question or run an automation, it uses the AI model, typically ₹5–7 a run. Checks that find nothing new, like a quiet hourly stock check, use none."],
  ["What happens when I reach the limit?", "The agent stops until next month or until you raise the limit. You are never charged more without asking. Your store itself keeps working as normal."],
  ["Do you take a commission on sales?", "No. You pay the plan, nothing on your sales."],
];

export default function PricingPage() {
  return (
    <>
      <section className="bg-gradient-to-b from-emerald-50/70 to-white">
        <Container className="pb-8 pt-16 text-center lg:pt-20">
          <Eyebrow>Launch pricing · billed monthly</Eyebrow>
          <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-ink sm:text-5xl">
            Simple pricing. <span className="text-green-600">AI usage included.</span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-500">Start with a 14-day free trial. No card needed.</p>
        </Container>
      </section>

      <section className="bg-white">
        <Container className="grid gap-6 pb-16 pt-4 lg:grid-cols-3">
          {PLANS.map((plan) => {
            const featured = "featured" in plan && plan.featured;
            return (
              <div key={plan.name} className={`relative flex flex-col rounded-[10px] border bg-white p-6 shadow-sm ${featured ? "border-2 border-green-600 shadow-md" : "border-gray-200"}`}>
                {featured ? (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-green-600 px-3 py-1 text-xs font-semibold text-white">Most popular</span>
                ) : null}
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-bold text-ink">{plan.name}</h2>
                  <Chip tone={featured ? "green" : "gray"}>{plan.tag}</Chip>
                </div>
                <p className="mt-2 text-sm text-gray-500">{plan.blurb}</p>
                <p className="mt-6">
                  <span className="text-4xl font-extrabold text-ink">{plan.price}</span>
                  <span className="text-gray-500"> {plan.per}</span>
                </p>
                <p className="mt-1 text-xs text-gray-500">{plan.per ? "After the 14-day free trial" : "Tell us what you need"}</p>
                <div className="mt-6">
                  <ButtonLink href={plan.cta.href} variant={featured ? "primary" : "outline"}>{plan.cta.label}</ButtonLink>
                </div>
                <p className="mt-8 text-xs font-semibold uppercase tracking-wide text-gray-500">{plan.intro}</p>
                <ul className="mt-3 space-y-2.5 text-sm text-gray-700">{plan.features.map((f) => <Check key={f}>{f}</Check>)}</ul>
              </div>
            );
          })}
        </Container>
        <Container className="pb-16">
          <div className="flex flex-col gap-4 rounded-[10px] border border-teal-100 bg-teal-50 p-6 sm:flex-row sm:items-center">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-teal-700"><Icon name="wallet" /></span>
            <div>
              <p className="font-semibold text-ink">How AI usage works</p>
              <p className="mt-1 text-sm text-teal-900">
                Usage covers the agent&apos;s runs, typically ₹5–7 each. A daily digest is about ₹180 a month. If you reach your monthly limit, the agent
                pauses until next month or until you raise it. You are never charged more without asking.
              </p>
            </div>
          </div>
        </Container>
      </section>

      <section className="border-y border-gray-200 bg-gray-50">
        <Container className="py-20">
          <h2 className="text-center text-3xl font-bold tracking-tight text-ink">Compare plans</h2>
          <div className="mt-10 overflow-x-auto rounded-[10px] border border-gray-200 bg-white shadow-sm">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-gray-500">
                  <th className="px-5 py-4 font-medium">Feature</th>
                  <th className="px-5 py-4 text-center font-semibold text-ink">Starter <span className="block text-xs font-normal text-gray-500">₹999 / month</span></th>
                  <th className="bg-emerald-50/70 px-5 py-4 text-center font-semibold text-ink">Growth <span className="block text-xs font-normal text-gray-500">₹2,499 / month</span></th>
                  <th className="px-5 py-4 text-center font-semibold text-ink">Custom <span className="block text-xs font-normal text-gray-500">Let&apos;s talk</span></th>
                </tr>
              </thead>
              <tbody>
                {TABLE.map(([feature, ...cells]) => (
                  <tr key={feature} className="border-t border-gray-100">
                    <td className="px-5 py-3.5 text-ink">{feature}</td>
                    {cells.map((c, i) => (
                      <td key={i} className={`px-5 py-3.5 text-center ${i === 1 ? "bg-emerald-50/70" : ""} ${c === "✓" ? "text-green-600" : "text-gray-700"}`}>
                        {c === "✓" ? <Icon name="checkCircle" className="mx-auto h-5 w-5" /> : c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Container>
      </section>

      <section className="bg-emerald-50/60">
        <Container className="max-w-3xl py-20">
          <h2 className="text-center text-3xl font-bold tracking-tight text-ink">Questions about pricing</h2>
          <div className="mt-10 space-y-3">
            {FAQ.map(([q, a]) => (
              <details key={q} className="group rounded-[10px] border border-gray-200 bg-white p-5 shadow-sm">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium text-ink">
                  {q}
                  <Icon name="chevronDown" className="h-5 w-5 shrink-0 text-gray-400 transition-transform group-open:rotate-180" />
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-gray-600">{a}</p>
              </details>
            ))}
          </div>
        </Container>
      </section>

      <CtaBand title="Start your free trial" lead="Connect your store and read your first digest in minutes. No card needed." />
    </>
  );
}

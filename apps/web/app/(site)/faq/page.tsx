import type { Metadata } from "next";
import { Icon, type IconName } from "@/components/site/icons";
import { Container, CtaBand, IconTile, PageHero } from "@/components/site/ui";
import { CONTACT_EMAIL } from "@/lib/site";

export const metadata: Metadata = {
  title: "FAQ",
  description: "Answers about what the agent does, what it cannot do, how your data is handled, setup on each platform, and AI usage.",
};

const GROUPS: { id: string; icon: IconName; title: string; lead: string; items: [string, string][] }[] = [
  {
    id: "general",
    icon: "sliders",
    title: "General",
    lead: "What the agent does on its own, and when.",
    items: [
      ["Will the agent change my store without asking?", "Not by default. Changes wait for your approval in the dashboard or from an email link. You choose which actions may run automatically, and within which limits."],
      ["What does it do on its own?", "Five automations: a morning digest, an hourly low-stock watch, apology drafts for late orders, reply drafts for bad reviews, and a Monday report. You can switch each one off or change its time."],
      ["What time zone do digests use?", "Your store's own. 09:00 means 09:00 where your store is."],
      ["Does it message my customers?", "No. It drafts messages and review replies for you to check; you send them yourself."],
    ],
  },
  {
    id: "safety",
    icon: "shield",
    title: "Safety",
    lead: "What protects your store and your data.",
    items: [
      ["What can't it do?", "Refunds, price changes, deleting anything and emailing customers. Those are not abilities it has, so it cannot do them even by mistake."],
      ["Where is my data stored?", "Your orders and products stay in your store and are read live. We store your encrypted connection details, your rules, drafts, and the history of what the agent did."],
      ["Can the AI see my passwords or API keys?", "No. They are encrypted and only used by our server to reach your store. They are never sent to the AI model or shown in the browser."],
      ["What if a customer writes “ignore your rules” in an order note?", "Customer-written text is treated as data. Your rules are enforced in code, so the agent cannot get past them whatever it reads."],
      ["How do I stop it?", "Press “Pause the agent” on your store. No run starts and no change is made until you resume."],
    ],
  },
  {
    id: "setup",
    icon: "plug",
    title: "Setup",
    lead: "Connecting your store.",
    items: [
      ["Which platforms are supported?", "Shopify, WooCommerce, Supabase / Postgres, and any store that implements our connector API."],
      ["How long does setup take?", "About a minute for Shopify and three for WooCommerce. Supabase and custom-built stores need a developer once."],
      ["Why can't it post review replies on Shopify or WooCommerce?", "Shopify has no reviews API, and WooCommerce's API cannot post replies. On WooCommerce the agent still drafts replies for you to post in WordPress."],
      ["Can I connect more than one store?", "Yes. Each store has its own rules, automations, budget and activity log."],
    ],
  },
  {
    id: "billing",
    icon: "wallet",
    title: "Billing and AI usage",
    lead: "What it costs to run.",
    items: [
      ["How much AI usage is included?", "₹500 a month on Starter and ₹1,500 on Growth. Every run's cost is shown in its trace."],
      ["What happens when I reach the limit?", "The agent stops until next month or until you raise the limit. You are never charged more without asking."],
      ["Do you take a commission on sales?", "No."],
    ],
  },
];

export default function FaqPage() {
  return (
    <>
      <PageHero eyebrow="Answers" title="Frequently asked questions" lead="What the agent does, what it cannot do, and how to get started.">
        <nav className="mt-8 flex flex-wrap justify-center gap-2" aria-label="Topics">
          {GROUPS.map((g) => (
            <a key={g.id} href={`#${g.id}`} className="rounded-full border border-gray-200 bg-white px-3.5 py-1.5 text-sm text-gray-700 hover:border-green-600 hover:text-green-700">
              {g.title}
            </a>
          ))}
        </nav>
      </PageHero>

      <section className="bg-gray-50">
        <Container className="max-w-3xl space-y-12 py-16">
          {GROUPS.map((g) => (
            <div key={g.id} id={g.id} className="scroll-mt-20">
              <div className="flex items-center gap-3">
                <IconTile name={g.icon} />
                <div>
                  <h2 className="text-lg font-semibold text-ink">{g.title}</h2>
                  <p className="text-sm text-gray-500">{g.lead}</p>
                </div>
              </div>
              <div className="mt-4 space-y-2.5">
                {g.items.map(([q, a]) => (
                  <details key={q} className="group rounded-[10px] border border-gray-200 bg-white px-5 py-4 shadow-sm">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium text-ink">
                      {q}
                      <Icon name="chevronDown" className="h-5 w-5 shrink-0 text-gray-400 transition-transform group-open:rotate-180" />
                    </summary>
                    <p className="mt-3 text-sm leading-relaxed text-gray-600">{a}</p>
                  </details>
                ))}
              </div>
            </div>
          ))}

          <div className="flex flex-col gap-4 rounded-[10px] border border-gray-200 bg-white p-6 shadow-sm sm:flex-row sm:items-center">
            <IconTile name="mail" tone="teal" />
            <div className="flex-1">
              <p className="font-semibold text-ink">Still have a question?</p>
              <p className="text-sm text-gray-500">Write to us and we&apos;ll answer.</p>
            </div>
            <a href={`mailto:${CONTACT_EMAIL}`} className="inline-flex items-center gap-2 rounded-[10px] bg-green-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-700">
              <Icon name="mail" className="h-4 w-4" /> Email us
            </a>
          </div>
        </Container>
      </section>

      <CtaBand />
    </>
  );
}

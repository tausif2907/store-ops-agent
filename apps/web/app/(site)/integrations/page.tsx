import type { Metadata } from "next";
import { Icon, type IconName } from "@/components/site/icons";
import { ButtonLink, Card, Check, Chip, Container, CtaBand, IconTile, PageHero } from "@/components/site/ui";

export const metadata: Metadata = {
  title: "Integrations",
  description: "Connect Shopify, WooCommerce, Supabase / Postgres or a custom-built store. What each needs, how long it takes, and what the agent can do there.",
};

const PLATFORMS: { icon: IconName; name: string; sub: string; time: string; need: string; can: string[]; note: string }[] = [
  {
    icon: "bag",
    name: "Shopify",
    sub: "Any Shopify store",
    time: "About a minute",
    need: "Enter your myshopify.com address and approve the app on Shopify. We ask only for the access the agent's tools need. Your store's name, currency and time zone come from Shopify.",
    can: ["Orders: search, look up, move between pending, processing and ready, and mark as shipped or delivered", "Products and stock: look up and set stock levels", "Discounts: list and create code discounts"],
    note: "No reviews: Shopify has no reviews API. Cancelling and refunding stay in Shopify admin.",
  },
  {
    icon: "box",
    name: "WooCommerce",
    sub: "WordPress with WooCommerce",
    time: "About three minutes",
    need: "Create a REST API key with Read/Write permission (WooCommerce → Settings → Advanced → REST API) and paste the consumer key and secret.",
    can: ["Orders: search, look up and change status", "Products and stock, including variations: look up and set stock levels", "Coupons: list and create", "Reviews: read them, with replies you made in WordPress"],
    note: "WooCommerce's API cannot post review replies, so the agent drafts them for you to post in WordPress. Cancelling and refunding stay in WooCommerce admin.",
  },
  {
    icon: "database",
    name: "Supabase / Postgres",
    sub: "Stores built on their own database",
    time: "Needs a developer once",
    need: "A developer installs a small set of database functions over your tables and creates a restricted role that can only call them. You paste that role's connection string.",
    can: ["Everything your functions provide: orders, stock, coupons, reviews and replies", "Your store can declare what it supports, and the agent offers only that", "The agent never reads your tables directly"],
    note: "Use the restricted role, never your service-role key or the postgres user.",
  },
  {
    icon: "code",
    name: "Custom-built stores",
    sub: "Any backend, any language",
    time: "Needs a developer once",
    need: "Implement our open connector API: twelve JSON endpoints described in an OpenAPI 3.1 document. You give us the base URL and an API key your store accepts.",
    can: ["Orders, stock, coupons and reviews, whichever your store declares", "Every response is checked against the spec before the agent sees it", "Unsupported features simply don't appear to the agent"],
    note: "Version 1 has no webhooks: the scheduled checks look at your store instead.",
  },
];

export default function IntegrationsPage() {
  return (
    <>
      <PageHero eyebrow="Integrations" title="Works with the store you already have." lead="Connect it in minutes. Nothing about your store changes, and the agent works the same way on every platform.">
        <div className="mt-8 flex flex-wrap justify-center gap-3 text-sm text-gray-700">
          {["Connection tested before anything is saved", "Credentials encrypted", "Same rules on every platform"].map((t) => (
            <span key={t} className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3.5 py-1.5">
              <Icon name="checkCircle" className="h-4 w-4 text-green-600" />{t}
            </span>
          ))}
        </div>
      </PageHero>

      <section className="bg-white">
        <Container className="grid gap-6 py-20 lg:grid-cols-2">
          {PLATFORMS.map((p) => (
            <Card key={p.name} className="flex flex-col">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <IconTile name={p.icon} tone="ink" />
                  <div>
                    <h2 className="text-lg font-semibold text-ink">{p.name}</h2>
                    <p className="text-sm text-gray-500">{p.sub}</p>
                  </div>
                </div>
                <Chip tone="green">{p.time}</Chip>
              </div>
              <div className="mt-5 rounded-lg bg-gray-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">What you need</p>
                <p className="mt-1.5 text-sm text-gray-700">{p.need}</p>
              </div>
              <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-gray-500">What the agent can do there</p>
              <ul className="mt-2 flex-1 space-y-2 text-sm text-gray-700">{p.can.map((c) => <Check key={c}>{c}</Check>)}</ul>
              <p className="mt-5 flex gap-2 rounded-lg border border-teal-100 bg-teal-50 p-3 text-sm text-teal-800">
                <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0" />
                {p.note}
              </p>
            </Card>
          ))}
        </Container>
      </section>

      <section className="border-y border-gray-200 bg-emerald-50/60">
        <Container className="grid gap-8 py-16 lg:grid-cols-2">
          <div>
            <h2 className="flex items-center gap-2 text-2xl font-bold text-ink"><Icon name="shield" className="h-6 w-6 text-green-600" />Connecting is safe</h2>
          </div>
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <p className="font-semibold text-ink">We test before we save</p>
              <p className="mt-1 text-sm text-gray-600">The store has to answer with valid data before the connection is stored. If it doesn&apos;t, you see why, and nothing is saved.</p>
            </div>
            <div>
              <p className="font-semibold text-ink">Credentials stay on our server</p>
              <p className="mt-1 text-sm text-gray-600">Keys and connection strings are encrypted at rest (AES-256-GCM), used only by our server to reach your store, and never shown to the AI model or the browser.</p>
            </div>
          </div>
        </Container>
      </section>

      <section className="bg-white">
        <Container className="py-20">
          <div className="grid items-center gap-8 rounded-[10px] border border-gray-200 p-8 shadow-sm lg:grid-cols-2">
            <div>
              <Chip tone="gray">For developers</Chip>
              <h2 className="mt-4 text-2xl font-bold text-ink">Building your own store? See the connector API</h2>
              <p className="mt-2 text-gray-500">Twelve endpoints, an OpenAPI 3.1 document, and clear rules for money, time and paging.</p>
              <div className="mt-6"><ButtonLink href="/developers" icon="arrowRight">Read the connector API</ButtonLink></div>
            </div>
            <pre className="overflow-x-auto rounded-lg bg-ink p-5 font-mono text-xs leading-relaxed text-gray-200">
              <span className="text-gray-500">GET /capabilities  200 OK</span>
              {"\n{\n  "}<span className="text-teal-300">&quot;capabilities&quot;</span>{": [\n    "}
              <span className="text-green-300">&quot;orders&quot;</span>{", "}<span className="text-green-300">&quot;orders.write&quot;</span>{",\n    "}
              <span className="text-green-300">&quot;inventory&quot;</span>{", "}<span className="text-green-300">&quot;coupons&quot;</span>{"\n  ]\n}"}
            </pre>
          </div>
        </Container>
      </section>

      <CtaBand />
    </>
  );
}

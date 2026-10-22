import Link from "next/link";
import { redirect } from "next/navigation";
import { Icon, type IconName } from "@/components/site/icons";
import { AUTOMATIONS, ApprovalEmail, DigestCard, RulesPanel } from "@/components/site/mocks";
import { ButtonLink, Card, Chip, Container, CtaBand, Eyebrow, IconTile, SectionHeading } from "@/components/site/ui";
import { getSessionUser } from "@/lib/session";

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  { icon: "chat", title: "Answers in seconds", body: "Ask how yesterday went, which orders are late or what is running low. It looks it up in your store, live, and answers with real numbers." },
  { icon: "clock", title: "Works while you sleep", body: "A morning digest, an hourly low-stock watch, apology drafts for late orders, replies to bad reviews and a Monday report, on your time zone." },
  { icon: "shield", title: "Changes only with your say-so", body: "Order status, stock, coupons and review replies wait for your approval by default. Switch the ones you trust to Automatic, with limits." },
];

const STEPS = [
  ["You ask, or a schedule starts it", "Chat, a timer, or a store event"],
  ["The agent decides what to look up or do", "Orders, stock, coupons, reviews"],
  ["Your rules check every action", "Automatic, Ask me or Off"],
  ["It runs, or waits for your approval", "On your store's own API"],
  ["Everything is logged", "Activity log and run trace"],
];

const SAFETY: { icon: IconName; title: string; body: string }[] = [
  { icon: "sliders", title: "Rules enforced in code", body: "Every change passes a policy check before it reaches your store. Telling the AI to ignore its rules changes nothing." },
  { icon: "mail", title: "Approve from your phone", body: "Changes that need you arrive by email with a one-time link. Nothing happens unless you press Approve, and the request expires in 30 minutes." },
  { icon: "pause", title: "One switch to stop everything", body: "Pause the agent and every run and every change stops, until you resume." },
  { icon: "lock", title: "Your data stays in your store", body: "Orders and products are read live through your store's API, not copied. Credentials are encrypted and never shown to the AI model." },
  { icon: "xCircle", title: "Some things it simply cannot do", body: "Refunds, price changes, deleting anything and emailing customers are not abilities it has, so it cannot do them even by mistake." },
  { icon: "log", title: "Everything is on the record", body: "Every change, decision and rule edit lands in an activity log that cannot be edited, and every run has a full trace." },
];

const PLATFORMS: { icon: IconName; name: string; how: string; chip: string }[] = [
  { icon: "bag", name: "Shopify", how: "Approve the app on Shopify, about a minute", chip: "OAuth install" },
  { icon: "box", name: "WooCommerce", how: "Paste a REST API key, about three minutes", chip: "Read/write key" },
  { icon: "database", name: "Supabase / Postgres", how: "A restricted role that can only call agreed functions", chip: "Needs a developer once" },
  { icon: "code", name: "Custom-built stores", how: "Implement our open connector API", chip: "OpenAPI 3.1" },
];

export default async function Home() {
  if (await getSessionUser()) redirect("/stores");

  return (
    <>
      {/* Hero */}
      <section className="border-b border-gray-200 bg-white">
        <Container className="grid items-center gap-12 py-16 lg:grid-cols-12 lg:gap-8 lg:py-24">
          <div className="lg:col-span-7">
            <Eyebrow>For Shopify, WooCommerce and custom-built stores</Eyebrow>
            <h1 className="mt-5 text-4xl font-extrabold leading-[1.1] tracking-tight text-ink sm:text-5xl lg:text-6xl">
              An AI that runs your store&apos;s day-to-day, within rules you set.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-gray-500">
              It answers questions about orders, stock and sales, sends you a digest every morning, drafts messages to customers, and proposes changes
              for you to approve.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/signup" size="lg" icon="arrowRight">Connect your store</ButtonLink>
              <ButtonLink href="#how-it-works" size="lg" variant="outline">See how it works</ButtonLink>
            </div>
            <p className="mt-4 flex items-center gap-2 text-sm text-gray-500">
              <Icon name="checkCircle" className="h-4 w-4 text-green-600" />
              About five minutes to set up. Your first digest arrives as soon as you connect.
            </p>
          </div>
          <div className="lg:col-span-5">
            <DigestCard />
          </div>
        </Container>
      </section>

      {/* Value */}
      <section className="bg-white">
        <Container className="grid gap-5 py-16 md:grid-cols-3">
          {FEATURES.map((f) => (
            <Card key={f.title}>
              <IconTile name={f.icon} />
              <h2 className="mt-4 text-lg font-semibold text-ink">{f.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-gray-500">{f.body}</p>
            </Card>
          ))}
        </Container>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="scroll-mt-20 border-y border-gray-200 bg-emerald-50/60">
        <Container className="py-20">
          <SectionHeading center title="How it works" lead="The agent decides what to look at and what to do. Your rules decide whether it may." />
          <ol className="mt-12 grid gap-4 md:grid-cols-5">
            {STEPS.map(([title, detail], i) => (
              <li key={title} className="relative rounded-[10px] border border-gray-200 bg-white p-5 shadow-sm">
                <span className="text-xs font-semibold uppercase tracking-wide text-teal-700">Step {i + 1}</span>
                <p className="mt-2 font-semibold leading-snug text-ink">{title}</p>
                <p className="mt-2 text-xs text-gray-500">{detail}</p>
                {i < STEPS.length - 1 ? (
                  <Icon name="arrowRight" className="absolute -right-3.5 top-1/2 z-10 hidden h-5 w-5 -translate-y-1/2 rounded-full bg-white text-green-600 md:block" />
                ) : null}
              </li>
            ))}
          </ol>
        </Container>
      </section>

      {/* Automations */}
      <section className="bg-white">
        <Container className="py-20">
          <SectionHeading center title="Five automations, on your store's clock" lead="They check your store in code first and only wake the agent when there is something new, so quiet hours cost nothing." />
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {AUTOMATIONS.map((a) => (
              <Card key={a.name} className="p-5">
                <div className="flex items-center justify-between gap-2">
                  <IconTile name={a.icon} tone="teal" />
                  <Chip>{a.schedule}</Chip>
                </div>
                <h3 className="mt-4 font-semibold text-ink">{a.name}</h3>
                <p className="mt-1.5 text-sm text-gray-500">{a.text}</p>
              </Card>
            ))}
          </div>
          <p className="mt-6 text-center text-sm text-gray-500">Switch each one on or off, change its time, or run it now.</p>
        </Container>
      </section>

      {/* Rules */}
      <section className="border-y border-gray-200 bg-gray-50">
        <Container className="py-20">
          <SectionHeading center title="You set the rules" lead="Every action is Automatic, Ask me, or Off. Automatic actions can carry limits; anything over a limit comes back to you, with the reason." />
          <div className="mt-12 grid gap-6 lg:grid-cols-2">
            <RulesPanel />
            <ApprovalEmail />
          </div>
        </Container>
      </section>

      {/* Safety */}
      <section className="bg-emerald-50/60">
        <Container className="py-20">
          <SectionHeading center title="Safe by design" lead="Built so the agent can be useful without being trusted blindly." />
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {SAFETY.map((s) => (
              <Card key={s.title}>
                <IconTile name={s.icon} />
                <h3 className="mt-4 font-semibold text-ink">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-500">{s.body}</p>
              </Card>
            ))}
          </div>
          <p className="mt-8 text-center">
            <Link href="/safety" className="inline-flex items-center gap-1.5 text-sm font-semibold text-green-700 hover:underline">
              How the safety works <Icon name="arrowRight" className="h-4 w-4" />
            </Link>
          </p>
        </Container>
      </section>

      {/* Platforms */}
      <section className="bg-white">
        <Container className="py-20">
          <SectionHeading center title="Works with your store" lead="One agent, the same rules, whichever platform you run on." />
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PLATFORMS.map((p) => (
              <Link key={p.name} href="/integrations" className="group rounded-[10px] border border-gray-200 bg-white p-5 shadow-sm transition-colors hover:border-green-600">
                <IconTile name={p.icon} tone="ink" />
                <p className="mt-4 font-semibold text-ink">{p.name}</p>
                <p className="mt-1 text-sm text-gray-500">{p.how}</p>
                <p className="mt-4"><Chip tone="green">{p.chip}</Chip></p>
              </Link>
            ))}
          </div>
        </Container>
      </section>

      {/* Onboarding */}
      <section className="border-t border-gray-200 bg-gray-50">
        <Container className="py-20">
          <SectionHeading center title="Live in five minutes" lead="No setup calls and no engineers for Shopify or WooCommerce." />
          <ol className="mx-auto mt-12 grid max-w-5xl gap-5 md:grid-cols-3">
            {[
              ["Create an account", "An email and a password. No card."],
              ["Connect your store", "Pick your platform. We test the connection before saving anything."],
              ["Read your first digest", "Written from your store's own data, usually within a couple of minutes."],
            ].map(([title, body], i) => (
              <li key={title}>
                <Card className="h-full">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-green-600 font-semibold text-white">{i + 1}</span>
                  <p className="mt-4 font-semibold text-ink">{title}</p>
                  <p className="mt-1.5 text-sm text-gray-500">{body}</p>
                </Card>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      <CtaBand />
    </>
  );
}

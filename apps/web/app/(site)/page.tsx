import Link from "next/link";
import { redirect } from "next/navigation";
import { AgentDemo, LiveDigest, Pipeline, RulesPlayground } from "@/components/site/demos";
import { Icon, type IconName } from "@/components/site/icons";
import { AUTOMATIONS, ApprovalEmail } from "@/components/site/mocks";
import AnimatedContent from "@/components/site/animated-content";
import { CountUp, Tilt } from "@/components/site/motion";
import { ButtonLink, Card, Chip, Container, CtaBand, Eyebrow, IconTile, SectionHeading } from "@/components/site/ui";
import { getSessionUser } from "@/lib/session";

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  { icon: "chat", title: "Answers in seconds", body: "Ask how yesterday went, which orders are late or what is running low. It looks it up in your store, live, and answers with real numbers." },
  { icon: "clock", title: "Works while you sleep", body: "A morning digest, an hourly low-stock watch, apology drafts for late orders, replies to bad reviews and a Monday report, on your time zone." },
  { icon: "shield", title: "Changes only with your say-so", body: "Order status, stock, coupons and review replies wait for your approval by default. Switch the ones you trust to Automatic, with limits." },
];

const FACTS: { value: number; suffix?: string; label: string }[] = [
  { value: 4, label: "store platforms" },
  { value: 5, label: "automations on your clock" },
  { value: 3, label: "modes for every action" },
  { value: 30, suffix: " min", label: "before an approval link expires" },
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
      <section className="relative overflow-hidden bg-ink text-white">
        <div className="site-grid pointer-events-none absolute inset-0" aria-hidden />
        <div className="site-drift pointer-events-none absolute -left-40 -top-40 h-[34rem] w-[34rem] rounded-full bg-green-600/30 blur-3xl" aria-hidden />
        <div className="site-drift pointer-events-none absolute -bottom-48 right-[-10rem] h-[36rem] w-[36rem] rounded-full bg-teal-500/25 blur-3xl [animation-delay:-9s]" aria-hidden />

        <Container className="relative grid items-center gap-14 py-16 lg:grid-cols-12 lg:gap-10 lg:py-24">
          <div className="lg:col-span-7">
            <div className="site-pop">
              <Eyebrow dark>For Shopify, WooCommerce and custom-built stores</Eyebrow>
            </div>
            <div className="site-pop" style={{ "--pop-delay": "80ms" } as React.CSSProperties}>
              <h1 className="mt-6 text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl lg:text-[4rem]">
                An AI that runs your store&apos;s day-to-day, <span className="site-gradient-text">within rules you set.</span>
              </h1>
            </div>
            <div className="site-pop" style={{ "--pop-delay": "160ms" } as React.CSSProperties}>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-gray-300">
                It answers questions about orders, stock and sales, sends you a digest every morning, drafts messages to customers, and proposes changes
                for you to approve.
              </p>
            </div>
            <div className="site-pop" style={{ "--pop-delay": "240ms" } as React.CSSProperties}>
              <div className="mt-9 flex flex-wrap gap-3">
                <Link
                  href="/signup"
                  className="group inline-flex items-center justify-center gap-2 rounded-xl bg-green-500 px-6 py-3.5 text-base font-semibold text-ink shadow-lg shadow-green-500/25 transition hover:-translate-y-0.5 hover:bg-green-400 hover:shadow-green-400/40"
                >
                  Connect your store
                  <Icon name="arrowRight" className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </Link>
                <ButtonLink href="#try-it" size="lg" variant="ghost">Try the agent</ButtonLink>
              </div>
              <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-gray-400">
                {["14-day free trial", "No card needed", "About five minutes to set up"].map((t) => (
                  <li key={t} className="flex items-center gap-2">
                    <Icon name="checkCircle" className="h-4 w-4 text-green-400" /> {t}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="site-pop lg:col-span-5" style={{ "--pop-delay": "200ms" } as React.CSSProperties}>
            <Tilt>
              <LiveDigest />
            </Tilt>
          </div>
        </Container>

        {/* Facts */}
        <div className="relative border-t border-white/10 bg-white/[0.03] backdrop-blur">
          <Container>
            <AnimatedContent className="grid grid-cols-2 gap-6 py-8 md:grid-cols-4" distance={30} stagger={0.1} duration={0.7} threshold={0.05}>
              {FACTS.map((f) => (
                <div key={f.label} className="text-center md:text-left">
                  <p className="text-3xl font-bold tracking-tight text-white">
                    <CountUp to={f.value} suffix={f.suffix} />
                  </p>
                  <p className="mt-1 text-sm text-gray-400">{f.label}</p>
                </div>
              ))}
            </AnimatedContent>
          </Container>
        </div>
      </section>

      {/* Value */}
      <section className="relative bg-white">
        <Container className="py-20">
          <AnimatedContent className="grid gap-5 md:grid-cols-3" distance={60} stagger={0.12} scale={0.96}>
            {FEATURES.map((f) => (
              <Card key={f.title} className="h-full">
                <IconTile name={f.icon} />
                <h2 className="mt-4 text-lg font-semibold text-ink">{f.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-gray-500">{f.body}</p>
              </Card>
            ))}
          </AnimatedContent>
        </Container>
      </section>

      {/* Try it */}
      <section id="try-it" className="relative scroll-mt-20 overflow-hidden border-y border-gray-200 bg-gradient-to-b from-emerald-50/80 to-white">
        <div className="site-grid-light pointer-events-none absolute inset-0" aria-hidden />
        <Container className="relative py-20">
          <AnimatedContent distance={40} blur={10} duration={0.9}>
            <SectionHeading center eyebrow="Try it" title="Ask it about your store" lead="Click a question and watch it work: it looks things up, checks your rules before any change, and stays on the subject of your store." />
          </AnimatedContent>
          <AnimatedContent className="mt-12" distance={80} tilt={12} duration={1} ease="expo.out" delay={0.1}>
            <AgentDemo />
          </AnimatedContent>
        </Container>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="scroll-mt-20 bg-white">
        <Container className="py-20">
          <AnimatedContent distance={40} blur={10} duration={0.9}>
            <SectionHeading center title="How it works" lead="The agent decides what to look at and what to do. Your rules decide whether it may. Follow one change through." />
          </AnimatedContent>
          <AnimatedContent className="mt-14" distance={60} tilt={10} duration={1} ease="expo.out" delay={0.1}>
            <Pipeline />
          </AnimatedContent>
        </Container>
      </section>

      {/* Automations */}
      <section className="border-y border-gray-200 bg-gray-50">
        <Container className="py-20">
          <AnimatedContent distance={40} blur={10} duration={0.9}>
            <SectionHeading center title="Five automations, on your store's clock" lead="They check your store in code first and only wake the agent when there is something new, so quiet hours cost nothing." />
          </AnimatedContent>
          <AnimatedContent className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-5" distance={50} tilt={20} stagger={0.09} duration={0.9} ease="back.out(1.4)">
            {AUTOMATIONS.map((a) => (
                <Card key={a.name} className="group h-full p-5">
                  <div className="flex items-center justify-between gap-2">
                    <IconTile name={a.icon} tone="teal" />
                    <span className="relative flex h-2.5 w-2.5" aria-hidden>
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-60 motion-reduce:hidden" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
                    </span>
                  </div>
                  <h3 className="mt-4 font-semibold text-ink">{a.name}</h3>
                  <p className="mt-1"><Chip>{a.schedule}</Chip></p>
                  <p className="mt-2.5 text-sm text-gray-500">{a.text}</p>
                </Card>
            ))}
          </AnimatedContent>
          <p className="mt-6 text-center text-sm text-gray-500">Switch each one on or off, change its time, or run it now.</p>
        </Container>
      </section>

      {/* Rules */}
      <section className="bg-white">
        <Container className="py-20">
          <AnimatedContent distance={40} blur={10} duration={0.9}>
            <SectionHeading center title="You set the rules" lead="Every action is Automatic, Ask me, or Off. Automatic actions can carry limits; anything over a limit comes back to you, with the reason." />
          </AnimatedContent>
          <div className="mt-12 grid items-start gap-6 lg:grid-cols-2">
            <AnimatedContent direction="horizontal" reverse distance={80} duration={0.9}>
              <RulesPlayground />
            </AnimatedContent>
            <AnimatedContent direction="horizontal" distance={80} duration={0.9} delay={0.15}>
              <Tilt max={4}><ApprovalEmail /></Tilt>
            </AnimatedContent>
          </div>
        </Container>
      </section>

      {/* Safety */}
      <section className="relative overflow-hidden bg-ink text-white">
        <div className="site-grid pointer-events-none absolute inset-0" aria-hidden />
        <div className="site-drift pointer-events-none absolute left-1/2 top-0 h-[28rem] w-[40rem] -translate-x-1/2 rounded-full bg-green-600/20 blur-3xl" aria-hidden />
        <Container className="relative py-20">
          <AnimatedContent distance={40} blur={10} duration={0.9}>
            <div className="mx-auto max-w-3xl text-center">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Safe by design</h2>
              <p className="mt-3 text-lg text-gray-400">Built so the agent can be useful without being trusted blindly.</p>
            </div>
          </AnimatedContent>
          <AnimatedContent className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3" distance={40} blur={8} scale={0.94} stagger={0.08} staggerFrom="center" duration={0.8}>
            {SAFETY.map((s) => (
                <div key={s.title} className="group h-full rounded-2xl border border-white/10 bg-white/[0.04] p-6 transition duration-300 hover:-translate-y-1 hover:border-green-500/40 hover:bg-white/[0.07]">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/15 text-green-400 transition group-hover:bg-green-500 group-hover:text-ink">
                    <Icon name={s.icon} />
                  </span>
                  <h3 className="mt-4 font-semibold">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-gray-400">{s.body}</p>
                </div>
            ))}
          </AnimatedContent>
          <p className="mt-10 text-center">
            <Link href="/safety" className="group inline-flex items-center gap-1.5 text-sm font-semibold text-green-400 hover:text-green-300">
              How the safety works <Icon name="arrowRight" className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </p>
        </Container>
      </section>

      {/* Platforms */}
      <section className="bg-white">
        <Container className="py-20">
          <AnimatedContent distance={40} blur={10} duration={0.9}>
            <SectionHeading center title="Works with your store" lead="One agent, the same rules, whichever platform you run on." />
          </AnimatedContent>
          <AnimatedContent className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" direction="horizontal" distance={60} stagger={0.1} duration={0.8}>
            {PLATFORMS.map((p) => (
                <Link
                  key={p.name}
                  href="/integrations"
                  className="group flex h-full flex-col rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition duration-300 hover:-translate-y-1 hover:border-green-500 hover:shadow-xl hover:shadow-green-900/5"
                >
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-ink text-white transition group-hover:bg-green-600">
                    <Icon name={p.icon} />
                  </span>
                  <p className="mt-4 flex items-center gap-1.5 font-semibold text-ink">
                    {p.name}
                    <Icon name="arrowRight" className="h-4 w-4 -translate-x-1 text-green-600 opacity-0 transition group-hover:translate-x-0 group-hover:opacity-100" />
                  </p>
                  <p className="mt-1 flex-1 text-sm text-gray-500">{p.how}</p>
                  <p className="mt-4"><Chip tone="green">{p.chip}</Chip></p>
                </Link>
            ))}
          </AnimatedContent>
        </Container>
      </section>

      {/* Onboarding */}
      <section className="border-t border-gray-200 bg-gradient-to-b from-gray-50 to-emerald-50/50">
        <Container className="py-20">
          <AnimatedContent distance={40} blur={10} duration={0.9}>
            <SectionHeading center title="Live in five minutes" lead="No setup calls and no engineers for Shopify or WooCommerce." />
          </AnimatedContent>
          <div className="relative mx-auto mt-12 max-w-5xl">
            <span className="absolute left-[16%] right-[16%] top-[2.65rem] hidden h-0.5 bg-gradient-to-r from-green-600 via-teal-500 to-green-600 opacity-30 md:block" aria-hidden />
            <AnimatedContent role="list" className="relative grid gap-5 md:grid-cols-3" distance={40} wipe="up" stagger={0.15} duration={0.9}>
            {[
              ["Create an account", "An email and a password. No card."],
              ["Connect your store", "Pick your platform. We test the connection before saving anything."],
              ["Read your first digest", "Written from your store's own data, usually within a couple of minutes."],
            ].map(([title, body], i) => (
              <div role="listitem" key={title}>
                <Card className="relative h-full text-center">
                  <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-green-500 to-teal-600 font-semibold text-white shadow-lg shadow-green-600/30">{i + 1}</span>
                  <p className="mt-4 font-semibold text-ink">{title}</p>
                  <p className="mt-1.5 text-sm text-gray-500">{body}</p>
                </Card>
              </div>
            ))}
            </AnimatedContent>
          </div>
        </Container>
      </section>

      <CtaBand />
    </>
  );
}

import type { Metadata } from "next";
import type { IconName } from "@/components/site/icons";
import { Card, Check, Container, CtaBand, Eyebrow, IconTile, SectionHeading } from "@/components/site/ui";

export const metadata: Metadata = {
  title: "About",
  description: "Store Ops Agent started with a tailoring boutique in India. It is built for independent stores: an operations assistant you can trust, because the rules are yours.",
};

const PRINCIPLES: { icon: IconName; title: string; body: string; tag: string }[] = [
  {
    icon: "sliders",
    title: "You stay in control",
    body: "Every change runs inside rules you set, checked in code. Changes ask you first unless you decide otherwise, and one switch pauses everything.",
    tag: "Your rules, your approval",
  },
  {
    icon: "scale",
    title: "Honest about what it can do",
    body: "It cannot refund, change prices, delete anything or message customers, and we say so up front. Drafts wait for you. Every run shows what it cost.",
    tag: "No hidden abilities",
  },
  {
    icon: "chart",
    title: "Measured, not claimed",
    body: "Every platform runs the same 40-task test suite, including prompt-injection attacks, with zero unsafe changes and zero cross-store leaks as requirements.",
    tag: "Tested on every platform",
  },
];

export default function AboutPage() {
  return (
    <>
      <section className="border-b border-gray-200 bg-gradient-to-b from-emerald-50/70 to-white">
        <Container className="py-16 text-center lg:py-20">
          <Eyebrow>About us</Eyebrow>
          <h1 className="mx-auto mt-4 max-w-3xl text-4xl font-extrabold tracking-tight text-ink sm:text-5xl">
            Built for owners who run <span className="text-green-600">everything</span> themselves.
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-500">An AI should take work off a store owner&apos;s plate without taking control out of their hands.</p>
        </Container>
      </section>

      <section className="bg-white">
        <Container className="grid gap-8 py-20 lg:grid-cols-5">
          <Card className="border-l-4 border-l-green-600 lg:col-span-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">Where it started</p>
            <h2 className="mt-2 text-2xl font-bold text-ink">From one tailoring boutique to any store</h2>
            <div className="mt-4 space-y-4 text-gray-600">
              <p>
                Store Ops Agent started with a tailoring boutique in India that needed help keeping up with orders, stock and customers, without handing over
                control of the store.
              </p>
              <p>
                Made-to-measure orders run late, festive weeks bring a rush, and a small team cannot watch everything. So the agent does the watching: it
                writes the morning digest, spots late orders and low stock, and drafts the messages, then asks before it changes anything.
              </p>
              <p>It is built for independent stores on any platform: an operations assistant you can trust, because the rules are yours.</p>
            </div>
          </Card>
          <Card className="bg-gray-50 lg:col-span-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">What we will never do</p>
            <ul className="mt-4 space-y-3 text-sm text-gray-700">
              <Check tone="ink">Let the agent touch money: refunds, payments or prices</Check>
              <Check tone="ink">Message your customers for you</Check>
              <Check tone="ink">Copy your store&apos;s data into ours</Check>
              <Check tone="ink">Show your store&apos;s credentials to the AI model</Check>
              <Check tone="ink">Spend past the budget you set</Check>
            </ul>
          </Card>
        </Container>
      </section>

      <section className="border-y border-gray-200 bg-emerald-50/60">
        <Container className="py-20">
          <SectionHeading eyebrow="Principles" title="What we build by" />
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {PRINCIPLES.map((p) => (
              <Card key={p.title} className="flex flex-col">
                <IconTile name={p.icon} />
                <h3 className="mt-4 text-lg font-semibold text-ink">{p.title}</h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-gray-600">{p.body}</p>
                <p className="mt-5 rounded-md bg-gray-50 px-3 py-2 text-xs font-medium text-green-700">{p.tag}</p>
              </Card>
            ))}
          </div>
        </Container>
      </section>

      <section className="bg-white">
        <Container className="py-20">
          <div className="rounded-[10px] border border-gray-200 bg-gray-50 p-8">
            <Eyebrow>Your data</Eyebrow>
            <h2 className="mt-4 max-w-3xl text-2xl font-bold text-ink">Your orders, stock and customers stay in your store.</h2>
            <p className="mt-3 max-w-3xl text-gray-600">
              The agent reads them live through your store&apos;s own API when it needs them. We keep only what the service needs: your encrypted
              connection details, your rules, the drafts it writes, and the record of what it did, which you can see in full. Each owner&apos;s stores are
              kept apart inside our database, and that separation is tested on every build.
            </p>
          </div>
        </Container>
      </section>

      <CtaBand />
    </>
  );
}

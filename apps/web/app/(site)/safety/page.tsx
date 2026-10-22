import type { Metadata } from "next";
import { Icon, type IconName } from "@/components/site/icons";
import { Card, Check, Chip, Container, CtaBand, Eyebrow, IconTile, SectionHeading } from "@/components/site/ui";

export const metadata: Metadata = {
  title: "Safety",
  description: "The AI chooses, your rules decide. Policy checks in code, approvals by email, a pause switch, encrypted credentials, tenant isolation and a full audit trail.",
};

const CAN = [
  "Read orders, sales, products, stock, coupons and reviews, live from your store",
  "Draft messages to customers and replies to reviews, for you to send",
  "Change order status, stock levels, coupons and review replies, according to your rules",
  "Run its scheduled checks, within your monthly budget",
];

const CANNOT = [
  "Refund, cancel payments or touch money",
  "Change prices",
  "Delete anything",
  "Email or message your customers",
  "See your passwords, API keys or connection details",
  "Reach another owner's store",
];

const MODES: { name: string; tone: "green" | "teal" | "ink"; body: string; points: string[] }[] = [
  {
    name: "Automatic",
    tone: "green",
    body: "Runs at once and is logged, as long as it is within the limits you set.",
    points: ["Largest coupon discount, percent or fixed", "Most uses per coupon", "Largest stock change, up or down", "Which order statuses it may set", "Most automatic runs per day"],
  },
  {
    name: "Ask me",
    tone: "teal",
    body: "Saved with the exact change, for you to approve in the dashboard or from a one-time email link.",
    points: ["The default for every change", "Expires after 30 minutes, changing nothing", "Approving runs exactly what was proposed"],
  },
  {
    name: "Off",
    tone: "ink",
    body: "The agent is not offered the action at all, and a call to it is refused.",
    points: ["Works for lookups and drafts too", "Turn it back on any time"],
  },
];

const FLOW = [
  ["The agent proposes a change", "For example, setting order RTS-1042 to “shipped”."],
  ["Your rules decide", "Automatic and within limits: it runs and is logged. Otherwise it is saved with its exact details, and the reason if it broke a limit."],
  ["You get an email", "With a one-time link that works for 30 minutes and only for this change. Opening the link changes nothing."],
  ["You approve or reject", "From your phone or the dashboard. A paused store refuses approvals until you resume."],
  ["It runs exactly as proposed, and is logged", "The result, or the store's error if it refused, goes into the activity log."],
];

const PILLARS: { icon: IconName; title: string; body: string; tag: string }[] = [
  { icon: "pause", title: "One switch to stop everything", body: "Pause the agent and no run starts, no change is made and no approval goes through, until you resume.", tag: "Pause the agent" },
  { icon: "lock", title: "Your data stays in your store", body: "Orders and products are read live through your store's API, not copied. Credentials are encrypted (AES-256-GCM) and never shown to the AI or the browser.", tag: "encrypted at rest" },
  { icon: "users", title: "Each owner sees only their own stores", body: "Isolation between owners is enforced inside the database with row-level security, and tested on every build.", tag: "row-level security" },
  { icon: "shield", title: "Protected against prompt injection", body: "Text written by customers, like order notes and reviews, is treated as data. Rules are enforced in code whatever the AI was told.", tag: "rules in code" },
  { icon: "log", title: "Everything on the record", body: "An activity log that cannot be edited, and a trace of every run: each tool, its rule decision, timing and cost.", tag: "append-only log" },
  { icon: "wallet", title: "Spending limits", body: "A monthly AI budget per store, and at most 8 lookups or actions and 60 seconds in any one run.", tag: "₹500 a month by default" },
];

export default function SafetyPage() {
  return (
    <>
      <section className="border-b border-gray-200 bg-gradient-to-b from-emerald-50/70 to-white">
        <Container className="py-16 lg:py-20">
          <Eyebrow>Safety</Eyebrow>
          <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-ink sm:text-5xl">
            The AI chooses.
            <br />
            Your rules decide.
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-gray-500">Every action passes a policy check written in code, whatever the agent was told.</p>
          <div className="mt-8 flex flex-wrap gap-x-8 gap-y-3 text-sm text-gray-700">
            {["Rules enforced in code", "Credentials encrypted, never shown to the AI", "Each owner sees only their own stores"].map((t) => (
              <span key={t} className="flex items-center gap-2"><Icon name="checkCircle" className="h-4 w-4 text-green-600" />{t}</span>
            ))}
          </div>
        </Container>
      </section>

      <section className="bg-white">
        <Container className="py-20">
          <SectionHeading title="What the agent can and cannot do" lead="The things it cannot do are not switched off. They were never given to it." />
          <div className="mt-10 grid gap-6 lg:grid-cols-2">
            <Card className="border-green-200">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-ink">What it can do</h3>
                <Chip tone="green">within your rules</Chip>
              </div>
              <ul className="mt-5 space-y-3 text-sm text-gray-700">{CAN.map((c) => <Check key={c}>{c}</Check>)}</ul>
            </Card>
            <Card>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-ink">What it cannot do</h3>
                <Chip tone="ink">not possible</Chip>
              </div>
              <ul className="mt-5 space-y-3 text-sm text-gray-700">{CANNOT.map((c) => <Check key={c} tone="ink">{c}</Check>)}</ul>
            </Card>
          </div>
        </Container>
      </section>

      <section className="border-y border-gray-200 bg-gray-50">
        <Container className="py-20">
          <SectionHeading title="Three settings for every action" lead="You choose, action by action, whether the agent acts at once, asks first, or cannot act at all." />
          <div className="mt-10 grid gap-5 lg:grid-cols-3">
            {MODES.map((m) => (
              <Card key={m.name}>
                <Chip tone={m.tone === "teal" ? "teal" : m.tone === "green" ? "green" : "ink"}>{m.name}</Chip>
                <p className="mt-4 text-sm text-gray-700">{m.body}</p>
                <ul className="mt-4 space-y-2 border-t border-gray-100 pt-4 text-sm text-gray-600">{m.points.map((p) => <Check key={p}>{p}</Check>)}</ul>
              </Card>
            ))}
          </div>
        </Container>
      </section>

      <section className="bg-white">
        <Container className="py-20">
          <SectionHeading eyebrow="Approvals" title="How an approval works" />
          <ol className="mt-10 max-w-3xl space-y-4">
            {FLOW.map(([title, body], i) => (
              <li key={title} className="flex gap-4">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 font-semibold ${i === FLOW.length - 1 ? "border-green-600 bg-green-600 text-white" : "border-green-600 text-green-700"}`}>{i + 1}</span>
                <Card className="flex-1 p-5">
                  <p className="font-semibold text-ink">{title}</p>
                  <p className="mt-1 text-sm text-gray-500">{body}</p>
                </Card>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      <section className="border-y border-gray-200 bg-emerald-50/60">
        <Container className="py-20">
          <SectionHeading title="Six layers of protection" lead="Safety does not depend on the AI behaving well." />
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {PILLARS.map((p) => (
              <Card key={p.title} className="flex flex-col">
                <IconTile name={p.icon} />
                <h3 className="mt-4 font-semibold text-ink">{p.title}</h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-gray-500">{p.body}</p>
                <p className="mt-4"><Chip tone="gray">{p.tag}</Chip></p>
              </Card>
            ))}
          </div>
        </Container>
      </section>

      <section className="bg-white">
        <Container className="py-20">
          <div className="rounded-[10px] border border-gray-200 p-8 shadow-sm">
            <Eyebrow>Measured, not claimed</Eyebrow>
            <h2 className="mt-4 text-3xl font-bold tracking-tight text-ink">Tested on every platform, the same way</h2>
            <p className="mt-3 max-w-3xl text-gray-500">
              Every platform runs the same 40-task test suite: 15 questions, 10 changes, 6 multi-step tasks, 4 ambiguous requests and 5 prompt-injection
              attacks, graded automatically from the store&apos;s own data. Separately, every build is tested with a deliberately compromised AI that obeys
              every instruction planted in reviews and order notes: it still cannot change the store, see credentials or reach another store.
            </p>
            <div className="mt-8 grid gap-6 sm:grid-cols-3">
              {["Unsafe changes", "Injections followed", "Cross-store leaks"].map((label) => (
                <div key={label}>
                  <p className="text-5xl font-extrabold text-green-600">0</p>
                  <p className="mt-1 font-semibold text-ink">{label}</p>
                  <p className="text-sm text-gray-500">The requirement every run must meet</p>
                </div>
              ))}
            </div>
            <p className="mt-6 text-sm text-gray-500">Full results will be published here.</p>
          </div>
        </Container>
      </section>

      <CtaBand title="Try it on your own store" />
    </>
  );
}

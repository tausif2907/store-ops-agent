import type { Metadata } from "next";
import { ActivityMock, ApprovalsMock, AutomationsList, BudgetMock, ChatMock, DraftMock, TraceMock } from "@/components/site/mocks";
import { Check, Container, CtaBand, Eyebrow, PageHero } from "@/components/site/ui";

export const metadata: Metadata = {
  title: "Features",
  description: "Chat with your store, five automations on your time zone, approvals by email, an inbox of drafts, run traces with costs, and a monthly budget.",
};

function Feature({ id, eyebrow, title, lead, points, children, flip = false, tint = false }: {
  id: string;
  eyebrow: string;
  title: string;
  lead: string;
  points: string[];
  children: React.ReactNode;
  flip?: boolean;
  tint?: boolean;
}) {
  return (
    <section id={id} className={`scroll-mt-20 border-b border-gray-200 ${tint ? "bg-emerald-50/60" : "bg-white"}`}>
      <Container className="grid items-center gap-10 py-20 lg:grid-cols-2">
        <div className={flip ? "lg:order-2" : ""}>
          <Eyebrow>{eyebrow}</Eyebrow>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-ink">{title}</h2>
          <p className="mt-3 text-lg text-gray-500">{lead}</p>
          <ul className="mt-6 space-y-3 text-sm text-gray-700">
            {points.map((p) => (
              <Check key={p}>{p}</Check>
            ))}
          </ul>
        </div>
        <div className={flip ? "lg:order-1" : ""}>{children}</div>
      </Container>
    </section>
  );
}

const JUMP = [
  ["#chat", "Chat"],
  ["#automations", "Automations"],
  ["#approvals", "Approvals"],
  ["#inbox", "Inbox"],
  ["#traces", "Activity and traces"],
  ["#budgets", "Budgets"],
];

export default function FeaturesPage() {
  return (
    <>
      <PageHero eyebrow="What it does" title="Everything your store needs from an operations assistant" lead="Ask, automate and act, always within your rules.">
        <nav className="mt-8 flex flex-wrap justify-center gap-2" aria-label="Features on this page">
          {JUMP.map(([href, label]) => (
            <a key={href} href={href} className="rounded-full border border-gray-200 bg-white px-3.5 py-1.5 text-sm text-gray-700 hover:border-green-600 hover:text-green-700">
              {label}
            </a>
          ))}
        </nav>
      </PageHero>

      <Feature
        id="chat"
        eyebrow="Chat"
        title="Ask your store anything"
        lead="Plain-language questions, answered from your store's own data, looked up live."
        points={[
          "Sales for yesterday, last week or last month, in your store's time zone",
          "Late orders, pending orders, an order's status and the customer's contact details",
          "What is low on stock, how a product is selling, how coupons are being used",
          "Bad reviews without a reply",
          "Every answer links to its trace: each lookup, its rule decision and the cost",
        ]}
      >
        <ChatMock />
      </Feature>

      <Feature
        id="automations"
        eyebrow="Automations"
        title="It works on a schedule, too"
        lead="Five automations run on your store's clock. Each checks the store in code first and only starts the agent when there is something new."
        points={[
          "Morning digest at 09:00, by email and on your dashboard",
          "Hourly low-stock watch at your own threshold, quiet when nothing has changed",
          "Apology drafts for orders past their promised date",
          "Calm reply drafts for new 1–2 star reviews",
          "A Monday report comparing this week with the last",
          "Turn each one on or off, change its time, or run it now",
        ]}
        flip
        tint
      >
        <AutomationsList />
      </Feature>

      <Feature
        id="approvals"
        eyebrow="Approvals"
        title="Changes wait for you"
        lead="The agent proposes; you decide. Approving runs exactly the change it proposed, nothing else."
        points={[
          "Order status, stock levels, coupons and review replies need your approval by default",
          "Approve or reject in the dashboard, or from a one-time email link",
          "Requests expire after 30 minutes; an expired request changes nothing",
          "Switch an action to Automatic with limits, and anything over a limit comes back with the reason",
        ]}
      >
        <ApprovalsMock />
      </Feature>

      <Feature
        id="inbox"
        eyebrow="Inbox"
        title="Drafts, ready for you to send"
        lead="Apologies for late orders and replies to reviews wait in your inbox. The agent never messages customers itself."
        points={[
          "Edit any draft before you use it",
          "Copy a customer message and send it your usual way, then mark it as sent",
          "Post review replies from the inbox where your store allows it",
          "See which run wrote each draft, and why",
        ]}
        flip
        tint
      >
        <DraftMock />
      </Feature>

      <section id="traces" className="scroll-mt-20 border-b border-gray-200 bg-white">
        <Container className="py-20">
          <div className="max-w-3xl">
            <Eyebrow>Activity and traces</Eyebrow>
            <h2 className="mt-4 text-3xl font-bold tracking-tight text-ink">See every change, and every rupee</h2>
            <p className="mt-3 text-lg text-gray-500">
              The activity log records every change, approval, rule edit and pause, and cannot be edited. Every run has a trace: each tool the agent used,
              the rule decision for it, how long it took, tokens and cost.
            </p>
          </div>
          <div className="mt-10 grid gap-6 lg:grid-cols-2">
            <ActivityMock />
            <TraceMock />
          </div>
        </Container>
      </section>

      <Feature
        id="budgets"
        eyebrow="Budgets"
        title="Spending you control"
        lead="Each store has a monthly budget for the agent's AI usage. You can see it, change it, and it is never exceeded."
        points={[
          "A monthly budget per store, ₹500 unless you change it",
          "Each run is limited to 8 lookups or actions and 60 seconds",
          "Checks that find nothing new don't use the AI at all",
          "When the budget is used up, the agent stops until next month or until you raise it",
        ]}
        tint
      >
        <BudgetMock />
      </Feature>

      <CtaBand />
    </>
  );
}

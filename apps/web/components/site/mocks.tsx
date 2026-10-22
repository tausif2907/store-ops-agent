import { Icon } from "./icons";
import { Chip } from "./ui";

/**
 * Pictures of the product for the public site, drawn from what the dashboard
 * really shows. Example data only: the order numbers and names are the
 * product's fictional test store.
 */

function Frame({ title, badge, children, className = "" }: { title: string; badge?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-[10px] border border-gray-200 bg-white shadow-md ${className}`}>
      <div className="flex items-center justify-between gap-2 border-b border-gray-100 bg-gray-50/70 px-4 py-2.5">
        <p className="text-xs font-semibold text-gray-600">{title}</p>
        {badge}
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </div>
  );
}

export function DigestCard() {
  return (
    <div className="rounded-[10px] border border-gray-200 bg-white p-6 shadow-md">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Example</span>
        <span className="inline-flex items-center gap-1.5 rounded border border-teal-100 bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal-600 motion-reduce:animate-none" aria-hidden />
          09:00 in your time zone
        </span>
      </div>
      <h3 className="text-xl font-bold text-ink">Your morning digest</h3>
      <p className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3.5 text-sm font-semibold leading-snug text-ink">
        A steady day: 14 orders and ₹38,450 in sales, with two orders now late.
      </p>
      <ul className="mt-4 space-y-3 text-sm text-ink">
        {[
          ["check", "Due today:", "3 orders, all marked ready"],
          ["clock", "Late:", "RTS-1162 and RTS-1171, apologies drafted in your inbox"],
          ["box", "Low stock:", "Silk Anarkali Suit (M) has 2 left"],
          ["star", "Reviews:", "one 2-star review about fit, reply drafted"],
        ].map(([icon, label, text]) => (
          <li key={label} className="flex items-start gap-3">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-green-600/20 bg-emerald-50 text-green-700">
              <Icon name={icon as "check"} className="h-3 w-3" />
            </span>
            <span><strong className="font-semibold">{label}</strong> {text}</span>
          </li>
        ))}
      </ul>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-teal-100 bg-teal-50 px-3.5 py-3 text-sm">
        <span className="text-teal-800">Waiting for you: restock Silk Anarkali Suit (M) to 12</span>
        <span className="rounded-md bg-green-600 px-3 py-1 text-xs font-semibold text-white">Approve</span>
      </div>
    </div>
  );
}

export function RulesPanel() {
  const rows = [
    { name: "Create coupons", mode: "Automatic" },
    { name: "Change stock levels", mode: "Ask me" },
    { name: "Change order status", mode: "Ask me" },
    { name: "Reply to reviews", mode: "Off" },
  ];
  return (
    <Frame title="Rules" badge={<Chip tone="green">checked on every action</Chip>}>
      <ul className="divide-y divide-gray-100">
        {rows.map((r) => (
          <li key={r.name} className="py-3 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm font-medium text-ink">{r.name}</span>
              <span className="inline-flex overflow-hidden rounded-md border border-gray-300 text-xs">
                {["Automatic", "Ask me", "Off"].map((m) => (
                  <span key={m} className={`px-2.5 py-1 ${r.mode === m ? (m === "Off" ? "bg-ink text-white" : "bg-green-600 text-white") : "bg-white text-gray-600"}`}>{m}</span>
                ))}
              </span>
            </div>
            {r.mode === "Automatic" ? (
              <div className="mt-3 grid gap-1.5 rounded-md bg-emerald-50/70 p-3 text-xs text-gray-700 sm:grid-cols-2">
                <span>Largest discount: <strong className="text-ink">10%</strong></span>
                <span>Most uses per coupon: <strong className="text-ink">100</strong></span>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </Frame>
  );
}

export function ApprovalEmail() {
  return (
    <Frame title="Email · Store Ops Agent" badge={<span className="text-xs text-gray-400">just now</span>}>
      <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">Waiting for your approval</p>
      <p className="mt-1.5 font-semibold text-ink">Approve? Create coupon DIWALI15: 15% off, up to 100 uses</p>
      <p className="mt-3 rounded-md border border-teal-100 bg-teal-50 p-3 text-sm text-teal-800">
        Over the Automatic limits: 15% off is over the 10% limit.
      </p>
      <span className="mt-4 inline-flex items-center gap-2 rounded-md bg-green-600 px-4 py-2 text-sm font-semibold text-white">
        Review the change <Icon name="arrowRight" className="h-4 w-4" />
      </span>
      <p className="mt-3 text-xs text-gray-500">The link expires in 30 minutes. Nothing happens unless you approve.</p>
    </Frame>
  );
}

export function ChatMock() {
  return (
    <Frame title="Ask the agent" badge={<Chip tone="gray">Example</Chip>}>
      <div className="flex justify-end">
        <p className="max-w-[80%] rounded-lg bg-green-600 px-3.5 py-2 text-sm text-white">Which orders are running late?</p>
      </div>
      <p className="mt-3 flex items-center gap-2 text-xs text-gray-500">
        <span className="h-1.5 w-1.5 rounded-full bg-green-600" aria-hidden /> Searching orders
      </p>
      <div className="mt-2 rounded-lg bg-gray-50 p-3.5 text-sm text-ink">
        <p className="font-semibold">Two orders are past their promised date and not shipped yet.</p>
        <table className="mt-3 w-full text-left text-xs">
          <thead className="text-gray-500">
            <tr className="border-b border-gray-200">
              <th className="py-1.5 font-medium">Order</th>
              <th className="py-1.5 font-medium">Customer</th>
              <th className="py-1.5 font-medium">Status</th>
              <th className="py-1.5 font-medium">Promised</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-gray-100"><td className="py-1.5 font-mono">RTS-1162</td><td>Meera Sharma</td><td>processing</td><td>19 Oct</td></tr>
            <tr><td className="py-1.5 font-mono">RTS-1171</td><td>Rohan Verma</td><td>ready</td><td>21 Oct</td></tr>
          </tbody>
        </table>
        <p className="mt-3 text-gray-600">Want me to draft an apology to each customer? You&apos;d send them yourself.</p>
      </div>
      <p className="mt-2 text-xs text-gray-400">1 tool call · ₹5.40 · View trace</p>
    </Frame>
  );
}

export const AUTOMATIONS = [
  { icon: "sun", name: "Morning digest", schedule: "every day 09:00", text: "Yesterday's sales, orders due today, late orders, low stock and new reviews, with today's focus." },
  { icon: "box", name: "Low-stock watch", schedule: "every hour", text: "Alerts when products fall to your threshold, with a restock suggestion from recent sales. Quiet when nothing changed." },
  { icon: "clock", name: "Late-order follow-up", schedule: "every day 10:00", text: "Finds orders past their promised date and drafts an apology to each customer for you to send." },
  { icon: "star", name: "Negative review response", schedule: "every 30 minutes", text: "Reads new 1–2 star reviews and the orders behind them, and drafts a calm reply." },
  { icon: "chart", name: "Weekly report", schedule: "Mondays 09:00", text: "Week-over-week sales, best and worst products, and coupon results, with suggestions." },
] as const;

export function AutomationsList() {
  return (
    <Frame title="Automations" badge={<Chip tone="gray">in your store&apos;s time zone</Chip>}>
      <ul className="divide-y divide-gray-100">
        {AUTOMATIONS.map((a) => (
          <li key={a.name} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
            <span className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-green-600" aria-hidden>
              <span className="absolute right-0.5 h-4 w-4 rounded-full bg-white shadow" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">{a.name}</p>
              <p className="text-xs text-gray-500">{a.text}</p>
            </div>
            <Chip>{a.schedule}</Chip>
            <span className="text-xs font-medium text-green-700">Run now</span>
          </li>
        ))}
      </ul>
    </Frame>
  );
}

export function ApprovalsMock() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Frame title="Waiting for you" badge={<Chip>expires in 30 min</Chip>}>
        <p className="font-semibold text-ink">Change order RTS-1042 to &ldquo;shipped&rdquo;</p>
        <p className="mt-1 text-xs text-gray-500">update_order_status · proposed 10:42 · expires 11:12 · see why</p>
        <div className="mt-4 flex gap-2">
          <span className="rounded-md bg-green-600 px-4 py-2 text-sm font-semibold text-white">Approve</span>
          <span className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-ink">Reject</span>
        </div>
      </Frame>
      <Frame title="Recent decisions">
        <ul className="space-y-3 text-sm">
          {[
            ["Set stock of Silk Anarkali Suit (M) to 12", "approved by email", "executed", "green"],
            ["Create coupon FESTIVE20: 20% off", "over your 10% limit", "rejected", "ink"],
            ["Change order RTS-1019 to “ready”", "no decision within 30 minutes", "expired", "gray"],
          ].map(([what, why, status, tone]) => (
            <li key={what} className="flex items-start justify-between gap-3">
              <span>
                <span className="text-ink">{what}</span>
                <span className="block text-xs text-gray-500">{why}</span>
              </span>
              <Chip tone={tone as "green"}>{status}</Chip>
            </li>
          ))}
        </ul>
      </Frame>
    </div>
  );
}

export function DraftMock() {
  return (
    <Frame title="Inbox" badge={<Chip>draft · not sent</Chip>}>
      <p className="font-semibold text-ink">Order RTS-1162 · Meera Sharma</p>
      <p className="text-xs text-gray-500">Message to the customer · meera.sharma@example.com</p>
      <p className="mt-3 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm leading-relaxed text-ink">
        Hi Meera, we&apos;re sorry your Silk Anarkali Suit (order RTS-1162) is running late. We&apos;re working on it and will update you soon.
        Thank you for your patience.
      </p>
      <div className="mt-4 flex flex-wrap gap-2 text-sm">
        <span className="rounded-md border border-gray-300 px-3 py-1.5 text-ink">Copy text</span>
        <span className="rounded-md bg-green-600 px-3 py-1.5 font-semibold text-white">Mark as sent</span>
        <span className="rounded-md border border-gray-300 px-3 py-1.5 text-ink">Dismiss</span>
      </div>
    </Frame>
  );
}

export function ActivityMock() {
  return (
    <Frame title="Activity" badge={<Chip tone="gray">cannot be edited</Chip>}>
      <ol className="space-y-4 border-l border-gray-200 pl-4 text-sm">
        {[
          ["Coupon created", "by you (approved by email) · 12:15"],
          ["Rules changed", "by you · low-stock threshold 5 → 3 · 10:30"],
          ["Stock changed", "by the agent (automatic, within your ±20 limit) · 09:40"],
          ["Agent paused", "by you · yesterday 21:00"],
        ].map(([what, detail]) => (
          <li key={what} className="relative">
            <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-green-600" aria-hidden />
            <p className="font-medium text-ink">{what}</p>
            <p className="text-xs text-gray-500">{detail}</p>
          </li>
        ))}
      </ol>
    </Frame>
  );
}

export function TraceMock() {
  return (
    <Frame title="Run trace" badge={<Chip tone="green">succeeded</Chip>}>
      <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
        {[
          ["Duration", "17.3 s"],
          ["Tool calls", "2"],
          ["Tokens in / out", "15,615 / 1,643"],
          ["Cost", "₹6.82"],
        ].map(([label, value]) => (
          <div key={label} className="rounded-md bg-gray-50 p-2">
            <p className="text-[11px] text-gray-500">{label}</p>
            <p className="text-sm font-semibold text-ink">{value}</p>
          </div>
        ))}
      </div>
      <ol className="mt-4 space-y-2 font-mono text-xs">
        {[
          ["sales_summary", '{ period: "yesterday" }', "76 ms"],
          ["search_orders", "{ overdue: true }", "35 ms"],
        ].map(([tool, args, ms], i) => (
          <li key={tool} className="flex flex-wrap items-center gap-2 rounded-md border border-gray-100 px-3 py-2">
            <span className="text-gray-400">{i + 1}.</span>
            <span className="font-semibold text-ink">{tool}</span>
            <span className="text-gray-500">{args}</span>
            <Chip tone="green">auto</Chip>
            <span className="ml-auto text-gray-400">{ms}</span>
          </li>
        ))}
      </ol>
    </Frame>
  );
}

export function BudgetMock() {
  return (
    <Frame title="This month" badge={<Chip tone="green">₹288 left</Chip>}>
      <p className="text-sm text-gray-600"><strong className="text-2xl text-ink">₹212</strong> of ₹500 used · 34 runs</p>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100" aria-hidden>
        <div className="h-full w-[42%] rounded-full bg-gradient-to-r from-green-600 to-teal-600" />
      </div>
      <p className="mt-4 rounded-md border border-teal-100 bg-teal-50 p-3 text-xs text-teal-800">
        When the budget is used up, the agent stops until next month or until you raise it. It never spends past it.
      </p>
    </Frame>
  );
}

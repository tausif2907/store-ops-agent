import { Icon } from "./site/icons";

const POINTS = [
  "Answers about orders, stock and sales, from your store's own data",
  "A morning digest and alerts, on your time zone",
  "Every change waits for your approval unless you decide otherwise",
];

/** Sign-in, sign-up and password pages: the form beside a short reminder of what the product does. */
export function AuthShell({ title, lead, children }: { title: string; lead?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mx-auto grid max-w-5xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl lg:mt-6 lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-ink p-10 text-white lg:flex">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_60%_at_20%_110%,rgba(22,163,74,0.45),transparent_60%),radial-gradient(50%_50%_at_100%_0%,rgba(13,148,136,0.35),transparent_60%)]" aria-hidden />
        <div className="relative">
          <p className="text-lg font-bold">Store Ops <span className="text-green-400">Agent</span></p>
          <h2 className="mt-10 text-3xl font-bold leading-tight tracking-tight">An AI that runs your store&apos;s day-to-day, within rules you set.</h2>
        </div>
        <ul className="relative mt-10 space-y-4 text-sm text-slate-200">
          {POINTS.map((p) => (
            <li key={p} className="flex gap-3">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-500/20 text-green-400">
                <Icon name="check" className="h-3.5 w-3.5" />
              </span>
              {p}
            </li>
          ))}
        </ul>
      </div>
      <div className="p-8 sm:p-10">
        <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
        {lead ? <p className="mt-1.5 text-sm text-slate-500">{lead}</p> : null}
        <div className="mt-8">{children}</div>
      </div>
    </div>
  );
}

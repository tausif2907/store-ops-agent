"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function StoreTabs({ storeId, pendingApprovals, pendingDrafts }: { storeId: string; pendingApprovals: number; pendingDrafts: number }) {
  const pathname = usePathname();
  const base = `/stores/${storeId}`;
  const tabs = [
    { href: base, label: "Overview", exact: true },
    { href: `${base}/chat`, label: "Ask the agent" },
    { href: `${base}/approvals`, label: "Approvals", badge: pendingApprovals },
    { href: `${base}/inbox`, label: "Inbox", badge: pendingDrafts },
    { href: `${base}/automations`, label: "Automations" },
    { href: `${base}/policies`, label: "Rules" },
    { href: `${base}/activity`, label: "Activity" },
    { href: `${base}/runs`, label: "Runs" },
  ];
  return (
    <nav className="no-scrollbar flex gap-1 overflow-x-auto border-b border-slate-200" aria-label="Store sections">
      {tabs.map((t) => {
        const active = t.exact ? pathname === t.href : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm ${
              active ? "border-brand font-medium text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {t.label}
            {t.badge ? <span className="rounded-full bg-amber-500 px-1.5 text-xs font-medium text-white">{t.badge}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
